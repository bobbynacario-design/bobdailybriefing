// radar/backfill-benchmarks.js
//
// ONE-OFF (idempotent, safe to re-run). Adds the `benchmarks` block to radar
// docs written before scoring.js started emitting it.
//
// Why it exists: SPY and QQQ are fetched for regime + as benchmarks but are
// deliberately never scored, so their closes never reached the stored doc. The
// Decisions tab needs a benchmark level on BOTH the decision date and the close
// date to express a result as benchmark-EXCESS rather than raw return. Without
// this backfill, excess would only ever work for calls logged after the change
// shipped — every existing open position would be stuck on raw return.
//
// BTC is already a scored signal, so its close is read out of the doc itself
// rather than re-fetched.
//
// Only ADDS the field. Never touches signals, regime, asOf or generatedAt, and
// skips any doc that already has a benchmarks block (pass --overwrite to redo).
//
// Run:  cd radar ; node backfill-benchmarks.js [--dry-run] [--overwrite]

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CONFIG } from './config.js';

var __dirname = dirname(fileURLToPath(import.meta.url));

(function loadDotEnv() {
  try {
    var p = join(__dirname, '.env');
    if (!existsSync(p)) return;
    readFileSync(p, 'utf8').split(/\r?\n/).forEach(function (line) {
      if (/^\s*(#|$)/.test(line)) return;
      var m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    });
  } catch (e) { console.warn('.env load failed:', e.message); }
})();

var PROJECT_ID = 'pokerhq-a67e4';
var COLL = 'briefings-bob';
var DRY = process.argv.includes('--dry-run');
var OVERWRITE = process.argv.includes('--overwrite');

var ALPACA_KEY = process.env.APCA_API_KEY_ID || process.env.ALPACA_KEY_ID || '';
var ALPACA_SECRET = process.env.APCA_API_SECRET_KEY || process.env.ALPACA_SECRET_KEY || '';

// Which symbols are used as benchmarks, and which of those are equities that
// need an Alpaca pull (BTC comes from the doc's own signals).
var BENCH = [];
(CONFIG.watchlist || []).forEach(function (i) {
  if (i.benchmark && BENCH.indexOf(i.benchmark) < 0) BENCH.push(i.benchmark);
});
var EQUITY_BENCH = BENCH.filter(function (b) { return b !== 'BTC'; });

// Minimal one-shot bar fetch. Deliberately NOT importing refresh-radar.js: that
// module runs the whole radar on import, and adding an isMain guard to a
// working scheduled job to serve a one-off script is the wrong trade.
async function fetchCloses(symbols, days) {
  if (!ALPACA_KEY || !ALPACA_SECRET) throw new Error('Missing Alpaca credentials in radar/.env');
  var byDate = {};
  symbols.forEach(function (s) { byDate[s] = {}; });
  var start = new Date(Date.now() - days * 86400000).toISOString();
  var pageToken = null;
  do {
    var url = 'https://data.alpaca.markets/v2/stocks/bars'
      + '?symbols=' + encodeURIComponent(symbols.join(','))
      + '&timeframe=1Day&adjustment=split&feed=iex&limit=10000'
      + '&start=' + encodeURIComponent(start)
      + (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '');
    var res = await fetch(url, {
      headers: { 'APCA-API-KEY-ID': ALPACA_KEY, 'APCA-API-SECRET-KEY': ALPACA_SECRET }
    });
    if (!res.ok) throw new Error('Alpaca ' + res.status + ': ' + (await res.text()).slice(0, 300));
    var json = await res.json();
    Object.keys(json.bars || {}).forEach(function (sym) {
      (json.bars[sym] || []).forEach(function (b) {
        byDate[sym][String(b.t).slice(0, 10)] = Math.round(b.c * 100) / 100;
      });
    });
    pageToken = json.next_page_token || null;
  } while (pageToken);
  return byDate;
}

function initAdmin() {
  var keyPath = join(__dirname, 'serviceAccountKey.json');
  if (existsSync(keyPath)) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), projectId: PROJECT_ID });
  } else {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  }
  return getFirestore();
}

async function main() {
  console.log('Benchmarks in use: ' + BENCH.join(', ') + '  (Alpaca pull: ' + EQUITY_BENCH.join(', ') + ')');
  var db = initAdmin();

  var snap = await db.collection(COLL).get();
  var radarDocs = [];
  snap.forEach(function (d) {
    if (/^radar-\d{4}-\d{2}-\d{2}$/.test(d.id)) radarDocs.push({ id: d.id, data: d.data() });
  });
  radarDocs.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  console.log('Found ' + radarDocs.length + ' dated radar docs.');
  if (!radarDocs.length) { console.log('Nothing to do.'); return; }

  var closes = await fetchCloses(EQUITY_BENCH, 400);
  EQUITY_BENCH.forEach(function (s) {
    console.log('  ' + s + ': ' + Object.keys(closes[s]).length + ' daily closes fetched');
  });

  var patched = 0, skipped = 0, missing = [];
  for (var i = 0; i < radarDocs.length; i++) {
    var doc = radarDocs[i];
    var d = doc.data;
    if (d.benchmarks && Object.keys(d.benchmarks).length && !OVERWRITE) { skipped++; continue; }

    // Benchmark level must be the SAME bar date the signals were scored on.
    var asOf = d.asOf;
    if (!asOf) { missing.push(doc.id + ' (no asOf)'); continue; }

    var bm = {};
    EQUITY_BENCH.forEach(function (s) {
      if (closes[s][asOf] != null) bm[s] = closes[s][asOf];
    });
    // BTC is a scored signal — take its close straight from this doc.
    var btc = (d.signals || []).filter(function (s) { return s.symbol === 'BTC'; })[0];
    if (BENCH.indexOf('BTC') >= 0 && btc && btc.close != null) bm.BTC = btc.close;

    var have = Object.keys(bm);
    if (have.length < BENCH.length) {
      missing.push(doc.id + ' asOf=' + asOf + ' got[' + have.join(',') + ']');
    }
    if (!have.length) continue;

    console.log((DRY ? '  would patch ' : '  patching ') + doc.id + ' asOf=' + asOf +
      ' -> ' + JSON.stringify(bm));
    if (!DRY) {
      await db.collection(COLL).doc(doc.id).set({ benchmarks: bm }, { merge: true });
    }
    patched++;
  }

  console.log('\n' + (DRY ? '[dry-run] would patch ' : 'patched ') + patched +
    ', already had benchmarks ' + skipped + ', incomplete ' + missing.length);
  if (missing.length) missing.forEach(function (m) { console.log('  incomplete: ' + m); });
}

main().then(function () { process.exit(0); }).catch(function (e) {
  console.error('\nbackfill-benchmarks failed:', e.message || e);
  process.exit(1);
});
