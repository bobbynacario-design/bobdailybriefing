// radar/refresh-radar.js
//
// Runner for the Daily Briefer Market Radar. This is the ONLY file that does
// I/O: it fetches daily bars (Alpaca for equities/ETFs, CoinGecko for crypto),
// hands them to the pure engine in scoring.js, and writes one Firestore doc per
// day plus a `radar-latest` pointer. scoring.js never sees any of this.
//
// Run locally on the Windows box:
//   cd radar
//   npm install
//   set APCA_API_KEY_ID=...        (or ALPACA_KEY_ID)
//   set APCA_API_SECRET_KEY=...    (or ALPACA_SECRET_KEY)
//   node refresh-radar.js
//
// Firestore auth (firebase-admin, Admin SDK — bypasses security rules):
//   place a service-account key at radar/serviceAccountKey.json (gitignored),
//   OR set GOOGLE_APPLICATION_CREDENTIALS to a key file path.
//
// To promote this to a scheduled Cloud Function later, wrap fetchAll() +
// scoreUniverse() + writeDoc() in an onSchedule handler. scoring.js is untouched.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CONFIG } from './config.js';
import { scoreUniverse } from './scoring.js';

var __dirname = dirname(fileURLToPath(import.meta.url));

var PROJECT_ID = 'pokerhq-a67e4';
var COLL = 'briefings-bob';

var ALPACA_KEY = process.env.APCA_API_KEY_ID || process.env.ALPACA_KEY_ID || '';
var ALPACA_SECRET = process.env.APCA_API_SECRET_KEY || process.env.ALPACA_SECRET_KEY || '';

// ── helpers ──

function isoDateOf(d) {
  return d.toISOString().slice(0, 10);
}

// Today's date in Philippine time (PHT, UTC+8), as YYYY-MM-DD — used as the doc id.
function phtDateKey() {
  var parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

function daysAgoIso(n) {
  var d = new Date(Date.now() - n * 86400000);
  return d.toISOString();
}

// fetch with retry + backoff. This box's network intermittently resets
// connections (ECONNRESET), so a single transient failure should not abort
// the whole run — important for unattended Task Scheduler runs.
async function fetchRetry(url, opts, label) {
  var attempts = 4;
  var lastErr;
  for (var i = 0; i < attempts; i++) {
    try {
      var res = await fetch(url, opts);
      return res;
    } catch (e) {
      lastErr = e;
      var code = (e && e.cause && e.cause.code) || e.message;
      console.log('  ' + (label || 'fetch') + ' transient error (' + code + '), retry ' + (i + 1) + '/' + (attempts - 1));
      await new Promise(function (r) { setTimeout(r, 1500 * (i + 1)); });
    }
  }
  throw lastErr;
}

// ── data: Alpaca daily bars for all equity/ETF symbols ──

async function fetchEquityBars(symbols) {
  if (!ALPACA_KEY || !ALPACA_SECRET) {
    throw new Error('Missing Alpaca credentials (APCA_API_KEY_ID / APCA_API_SECRET_KEY).');
  }
  var out = {};
  symbols.forEach(function (s) { out[s] = []; });
  var headers = {
    'APCA-API-KEY-ID': ALPACA_KEY,
    'APCA-API-SECRET-KEY': ALPACA_SECRET
  };
  // ~320 calendar days back comfortably covers the 160 trading bars we want.
  var start = daysAgoIso(320);
  var pageToken = null;
  do {
    var url = 'https://data.alpaca.markets/v2/stocks/bars'
      + '?symbols=' + encodeURIComponent(symbols.join(','))
      + '&timeframe=1Day&adjustment=split&feed=iex&limit=10000'
      + '&start=' + encodeURIComponent(start)
      + (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '');
    var res = await fetchRetry(url, { headers: headers }, 'Alpaca');
    if (!res.ok) {
      var body = await res.text();
      throw new Error('Alpaca ' + res.status + ': ' + body.slice(0, 300));
    }
    var json = await res.json();
    var bars = json.bars || {};
    Object.keys(bars).forEach(function (sym) {
      (bars[sym] || []).forEach(function (b) {
        out[sym].push({
          date: String(b.t).slice(0, 10),
          open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v
        });
      });
    });
    pageToken = json.next_page_token || null;
  } while (pageToken);
  return out;
}

// ── data: CoinGecko daily close + volume for crypto ──
// Free tier (no key). market_chart gives prices + total_volumes but no OHLC, so
// high/low are set to the daily close (a proxy). This only affects the stop level
// and the close-below-stop check for crypto; trend/volume/relStrength are exact.

async function fetchCryptoBars(symbolToId) {
  var out = {};
  var syms = Object.keys(symbolToId);
  for (var i = 0; i < syms.length; i++) {
    var sym = syms[i];
    var id = symbolToId[sym];
    var url = 'https://api.coingecko.com/api/v3/coins/' + id
      + '/market_chart?vs_currency=usd&days=200&interval=daily';
    var res = await fetchRetry(url, { headers: { 'accept': 'application/json' } }, 'CoinGecko ' + sym);
    if (!res.ok) {
      var body = await res.text();
      throw new Error('CoinGecko ' + sym + ' ' + res.status + ': ' + body.slice(0, 200));
    }
    var json = await res.json();
    var prices = json.prices || [];
    var vols = json.total_volumes || [];
    var volByDay = {};
    vols.forEach(function (v) { volByDay[isoDateOf(new Date(v[0]))] = v[1]; });
    var bars = [];
    var seen = {};
    prices.forEach(function (p) {
      var day = isoDateOf(new Date(p[0]));
      if (seen[day]) return; // collapse to one bar per day
      seen[day] = true;
      var c = p[1];
      bars.push({ date: day, open: c, high: c, low: c, close: c, volume: volByDay[day] || 0 });
    });
    out[sym] = bars;
    // gentle pacing for the free tier
    if (i < syms.length - 1) await new Promise(function (r) { setTimeout(r, 1500); });
  }
  return out;
}

async function fetchAll() {
  var equitySymbols = CONFIG.watchlist
    .map(function (w) { return w.symbol; })
    .filter(function (s) { return !CONFIG.coingeckoIds[s]; });
  var cryptoIds = CONFIG.coingeckoIds;

  console.log('Fetching equity bars for ' + equitySymbols.length + ' symbols...');
  var equity = await fetchEquityBars(equitySymbols);
  console.log('Fetching crypto bars for ' + Object.keys(cryptoIds).length + ' coins...');
  var crypto = await fetchCryptoBars(cryptoIds);

  var barsByAsset = {};
  Object.keys(equity).forEach(function (s) { barsByAsset[s] = equity[s]; });
  Object.keys(crypto).forEach(function (s) { barsByAsset[s] = crypto[s]; });
  return barsByAsset;
}

// ── Firestore (Admin SDK) ──

function initAdmin() {
  var keyPath = join(__dirname, 'serviceAccountKey.json');
  if (existsSync(keyPath)) {
    var sa = JSON.parse(readFileSync(keyPath, 'utf8'));
    initializeApp({ credential: cert(sa), projectId: PROJECT_ID });
    console.log('firebase-admin: using radar/serviceAccountKey.json');
  } else {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    console.log('firebase-admin: using application default credentials');
  }
  return getFirestore();
}

async function writeDoc(db, dateKey, doc) {
  // No `uid` field: the front end reads these under the rule that allows reads
  // of briefings-bob docs that carry no uid. Admin SDK writes bypass rules.
  await db.collection(COLL).doc('radar-' + dateKey).set(doc);
  await db.collection(COLL).doc('radar-latest').set({ value: dateKey });
}

// ── main ──

async function main() {
  var barsByAsset = await fetchAll();

  var counts = Object.keys(barsByAsset).map(function (s) {
    return s + ':' + (barsByAsset[s] ? barsByAsset[s].length : 0);
  });
  console.log('Bars loaded -> ' + counts.join('  '));

  var result = scoreUniverse(barsByAsset, CONFIG);
  var dateKey = phtDateKey();

  var doc = {
    generatedAt: new Date().toISOString(),
    asOf: result.asOf,
    regime: result.regime,
    signals: result.signals
  };

  console.log('\n===== briefings-bob/radar-' + dateKey + ' =====');
  console.log(JSON.stringify(doc, null, 2));

  var db = initAdmin();
  await writeDoc(db, dateKey, doc);
  console.log('\nWrote briefings-bob/radar-' + dateKey + ' and radar-latest = ' + dateKey);
}

main().then(function () {
  process.exit(0);
}).catch(function (e) {
  console.error('\nrefresh-radar failed:', e.message || e);
  process.exit(1);
});
