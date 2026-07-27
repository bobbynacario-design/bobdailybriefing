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
//   set OPENAI_API_KEY=...         (optional — enables V2 catalyst tagging)
//   node refresh-radar.js
//
// A run is a no-op if today's radar-<PHT date> doc already exists (so the 08:30
// catch-up trigger costs nothing when the 06:00 run succeeded). Pass --force
// (or RADAR_FORCE=1) to re-run and overwrite the day.
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
import { lookup as dnsLookup } from 'dns/promises';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CONFIG } from './config.js';
import { scoreUniverse } from './scoring.js';
import { buildJournal } from './journal.js';
import { buildPhSnapshot, writePhSnapshot } from './ph-snapshot.js';
import { extractUsage, recordUsage } from '../lib/llm-usage.js';
import { recordRunHealth, makeStage } from '../lib/feed-health.js';
import { computeDrift, groupByUid } from '../lib/decision-drift.js';

var __dirname = dirname(fileURLToPath(import.meta.url));

// ── run banner ──
// refresh.log is append-only and used to have no timestamps, so a run that
// started 97 minutes late (Task Scheduler catch-up after a Modern-Standby
// resume) was indistinguishable from one that never happened. Every run now
// brackets itself with a stamped header/footer.

function nowStamp() {
  var d = new Date();
  var pht = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(d).replace(', ', ' ');
  return pht + ' PHT (' + d.toISOString() + ')';
}

var RUN_STARTED = Date.now();
console.log('\n===== refresh-radar run started ' + nowStamp() + ' =====');

function runFooter(outcome) {
  console.log('===== refresh-radar ' + outcome + ' ' + nowStamp() +
    ' after ' + Math.round((Date.now() - RUN_STARTED) / 1000) + 's =====');
}

// Load radar/.env (gitignored) into process.env before any keys are read, so a
// single local file holds all secrets — no per-run env setup, Task-Scheduler-friendly.
// Format: KEY=value per line; # comments and blank lines ignored. Real env vars win.
(function loadDotEnv() {
  try {
    var p = join(__dirname, '.env');
    if (!existsSync(p)) return;
    readFileSync(p, 'utf8').split(/\r?\n/).forEach(function (line) {
      if (/^\s*(#|$)/.test(line)) return;
      var m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) return;
      var val = m[2].replace(/^['"]|['"]$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    });
    console.log('Loaded radar/.env');
  } catch (e) { console.warn('.env load failed:', e.message); }
})();

var PROJECT_ID = 'pokerhq-a67e4';
var COLL = 'briefings-bob';

var ALPACA_KEY = process.env.APCA_API_KEY_ID || process.env.ALPACA_KEY_ID || '';
var ALPACA_SECRET = process.env.APCA_API_SECRET_KEY || process.env.ALPACA_SECRET_KEY || '';

// V2 — catalyst tagging (display-only). Reuses the app's OpenAI integration
// (same /v1/responses endpoint + web_search tool as the briefing function).
// Optional: if no key is set, the run still completes and writes signals
// without catalysts, so the radar never depends on the news layer.
var OPENAI_KEY = process.env.OPENAI_API_KEY || '';
var OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';

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
// Budget ~22s (1.5/3/6/12) so a brief mid-run drop is survivable; a cold link
// at startup is handled by waitForNetwork() below, not here.
async function fetchRetry(url, opts, label) {
  var attempts = 5;
  var lastErr;
  for (var i = 0; i < attempts; i++) {
    try {
      var res = await fetch(url, opts);
      return res;
    } catch (e) {
      lastErr = e;
      var code = (e && e.cause && e.cause.code) || e.message;
      console.log('  ' + (label || 'fetch') + ' transient error (' + code + '), attempt ' + (i + 1) + '/' + attempts);
      if (i === attempts - 1) break;
      await new Promise(function (r) { setTimeout(r, Math.min(1500 * Math.pow(2, i), 12000)); });
    }
  }
  throw lastErr;
}

// ── network preflight ──
// The scheduled run fires at 06:00, and on this Modern-Standby (S0) box it
// often starts seconds after a resume — before Wi-Fi has associated and DNS is
// up. fetchRetry's ladder is a mid-session safety net, far too short for that:
// runs died on the very first Alpaca call with four ENOTFOUNDs inside 15s
// (2026-07-04/05/09/11/25). Wait for real connectivity before touching any API.

var NET_WAIT_MS = Number(process.env.RADAR_NET_WAIT_MS || 300000); // 5 min
var NET_PROBE_HOST = process.env.RADAR_NET_PROBE_HOST || 'data.alpaca.markets';

async function waitForNetwork() {
  var started = Date.now();
  var deadline = started + NET_WAIT_MS;
  var attempt = 0;
  for (;;) {
    attempt++;
    try {
      await dnsLookup(NET_PROBE_HOST);
      // DNS can answer from cache while the link is still dead, so make one
      // real request too. Any HTTP status proves the path works.
      await fetch('https://' + NET_PROBE_HOST + '/', {
        method: 'HEAD', signal: AbortSignal.timeout(8000)
      });
      if (attempt > 1) {
        console.log('Network ready after ' + Math.round((Date.now() - started) / 1000) +
          's (' + attempt + ' probes).');
      }
      return;
    } catch (e) {
      // dns.lookup puts the code on .code; undici fetch nests it under .cause.
      var code = (e && e.cause && e.cause.code) || (e && e.code) || e.name || e.message;
      if (Date.now() >= deadline) {
        throw new Error('no network after ' + Math.round(NET_WAIT_MS / 1000) +
          's waiting on ' + NET_PROBE_HOST + ' (last: ' + code + ')');
      }
      if (attempt === 1) console.log('Waiting for network to come up (' + code + ')...');
      await new Promise(function (r) { setTimeout(r, 5000); });
    }
  }
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
  // ~400 calendar days back comfortably covers a full 252-trading-day year
  // (needed for an honest 52-week high/low) plus the 160 SMA/return bars.
  var start = daysAgoIso(400);
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
      + '/market_chart?vs_currency=usd&days=365&interval=daily';
    try {
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
    } catch (e) {
      out[sym] = [];
      console.log('  ' + sym + ' crypto bars skipped: ' + (e.message || e));
    }
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

// ── V2: catalyst tagging via OpenAI (display-only) ──
// Pulls the text out of an OpenAI /v1/responses payload (mirrors the app's
// briefing function, which uses the same endpoint).
function extractText(json) {
  if (typeof json.output_text === 'string' && json.output_text) return json.output_text;
  var chunks = [];
  (json.output || []).forEach(function (item) {
    (item.content || []).forEach(function (c) {
      if (c && typeof c.text === 'string') chunks.push(c.text);
    });
  });
  return chunks.join('\n');
}

// Strip ```json fences and parse the first JSON object found.
function parseLooseJson(raw) {
  var s = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  var start = s.indexOf('{');
  var end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in model output');
  return JSON.parse(s.slice(start, end + 1));
}

// For each scored signal, ask OpenAI (with web_search) for the single most
// relevant recent catalyst and an event type. Returns a map symbol -> {catalyst,
// eventType}. Never throws: any failure logs and yields {} so the daily run
// still writes the (catalyst-free) signals.
async function fetchCatalysts(signals) {
  if (!OPENAI_KEY) {
    console.log('OPENAI_API_KEY not set — skipping catalyst tagging (signals written without catalysts).');
    return { catalysts: {}, usage: null };
  }
  var list = signals.map(function (s) {
    return s.symbol + ' (' + s.theme + ', ' + s.status + ', 20d vs ' + s.benchmark + ': ' +
      (s.relStrength20d == null ? 'n/a' : s.relStrength20d) + ' pts)';
  }).join('\n');

  var EVENT_TYPES = 'earnings | guidance | product | macro | regulatory | analyst | partnership | legal | supply | none';
  var prompt =
    'You are tagging market catalysts for a personal daily market radar. For EACH ticker below, ' +
    'search recent news (roughly the last 7 days) and identify the single most relevant catalyst or ' +
    'news item currently driving it.\n\n' +
    'Return STRICT JSON only — an object keyed by ticker symbol, each value an object with:\n' +
    '  "catalyst": one factual plain sentence (<=140 chars) describing the news/driver. NO advice, ' +
    'NO "buy"/"sell"/"should", no price targets. If nothing material is found, use "".\n' +
    '  "eventType": one of [' + EVENT_TYPES + '].\n' +
    '  "asOf": the news date as YYYY-MM-DD if known, else "recent".\n\n' +
    'Tickers (crypto symbols are the coins themselves):\n' + list + '\n\n' +
    'Output JSON only, no prose, no code fences.';

  var body = {
    model: OPENAI_MODEL,
    input: [
      { role: 'system', content: 'You produce factual, concise JSON. Return strict JSON only. Never give financial advice.' },
      { role: 'user', content: prompt }
    ],
    tools: [{ type: 'web_search', search_context_size: 'low' }],
    tool_choice: 'auto'
  };

  try {
    console.log('Tagging catalysts via OpenAI (' + OPENAI_MODEL + ', web_search) for ' + signals.length + ' symbols...');
    var res = await fetchRetry('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 'OpenAI');
    var text = await res.text();
    if (!res.ok) {
      console.log('  OpenAI error ' + res.status + ': ' + text.slice(0, 200) + ' — skipping catalysts.');
      return { catalysts: {}, usage: null };
    }
    var json = JSON.parse(text);
    var map = parseLooseJson(extractText(json));
    var clean = {};
    Object.keys(map).forEach(function (sym) {
      var v = map[sym] || {};
      clean[sym.toUpperCase()] = {
        catalyst: typeof v.catalyst === 'string' ? v.catalyst.slice(0, 200) : '',
        eventType: typeof v.eventType === 'string' ? v.eventType.toLowerCase() : 'none',
        asOf: typeof v.asOf === 'string' ? v.asOf : 'recent'
      };
    });
    return { catalysts: clean, usage: extractUsage(json) };
  } catch (e) {
    console.log('  Catalyst tagging failed (' + (e.message || e) + ') — skipping catalysts.');
    return { catalysts: {}, usage: null };
  }
}

// ── PH market snapshot (NOT scored — no free historical per-stock PSE feed) ──
// Moved to radar/ph-snapshot.js so the after-close run (radar/refresh-ph.js) can
// reuse it without re-running the whole US radar. buildPhSnapshot is imported.

// ── Firestore (Admin SDK) ──

var _db = null;

function initAdmin() {
  if (_db) return _db; // initializeApp throws if called twice
  var keyPath = join(__dirname, 'serviceAccountKey.json');
  if (existsSync(keyPath)) {
    var sa = JSON.parse(readFileSync(keyPath, 'utf8'));
    initializeApp({ credential: cert(sa), projectId: PROJECT_ID });
    console.log('firebase-admin: using radar/serviceAccountKey.json');
  } else {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    console.log('firebase-admin: using application default credentials');
  }
  _db = getFirestore();
  return _db;
}

async function writeDoc(db, dateKey, doc) {
  // No `uid` field: the front end reads these under the rule that allows reads
  // of briefings-bob docs that carry no uid. Admin SDK writes bypass rules.
  await db.collection(COLL).doc('radar-' + dateKey).set(doc);
  await db.collection(COLL).doc('radar-latest').set({ value: dateKey });
}

// ── decision drift digest ──
// Reads Bob's open calls and writes, per owner, the ones whose setup no longer
// reads the way it did. The Admin SDK bypasses rules so it can see the
// uid-scoped journal — which means the OUTPUT must carry the owner's uid, or
// the briefings-bob read rule (`!('uid' in resource.data)`) would expose one
// user's positions to every signed-in account.
async function writeDecisionDrift(db, result, dateKey) {
  var snap = await db.collection('journal-bob').get();
  var decisions = [];
  snap.forEach(function (d) {
    var v = d.data() || {};
    v.id = d.id;
    decisions.push(v);
  });

  var signalsBySymbol = {};
  (result.signals || []).forEach(function (s) {
    if (s && s.symbol) signalsBySymbol[String(s.symbol).toUpperCase()] = s;
  });

  var byUid = groupByUid(decisions);
  var uids = Object.keys(byUid);
  var totalFlagged = 0;
  for (var i = 0; i < uids.length; i++) {
    var uid = uids[i];
    var items = computeDrift(byUid[uid], signalsBySymbol);
    totalFlagged += items.length;
    // Written even when empty, so the app can tell "checked, all clear" apart
    // from "never ran" — the same distinction feed-health draws.
    await db.collection(COLL).doc('radar-drift-' + uid).set({
      uid: uid,
      generatedAt: new Date().toISOString(),
      asOf: result.asOf,
      dateKey: dateKey,
      openTracked: byUid[uid].filter(function (d) {
        return (d.status || 'open') !== 'closed' && (d.action || 'watched') !== 'skipped';
      }).length,
      items: items
    });
  }
  console.log('decision drift: ' + totalFlagged + ' flagged across ' + uids.length +
    ' owner' + (uids.length === 1 ? '' : 's') + ' (' + decisions.length + ' journal entries scanned).');
}

// ── main ──

// Which step the run is on, so a failure reports where it died rather than just
// that it died. Read by the top-level catch.
var STAGE = makeStage('start');

async function main() {
  STAGE.set('network');
  await waitForNetwork();

  STAGE.set('init');
  var dateKey = phtDateKey();
  var db = initAdmin();

  // Idempotence guard. The 08:30 catch-up trigger exists only to cover a 06:00
  // run that never fired or died on a cold network; when 06:00 succeeded there
  // is no new data and no reason to pay for a second OpenAI catalyst call.
  if (process.env.RADAR_FORCE === '1' || process.argv.includes('--force')) {
    console.log('--force: re-running and overwriting radar-' + dateKey + '.');
  } else {
    var existing = await db.collection(COLL).doc('radar-' + dateKey).get();
    if (existing.exists) {
      var prev = existing.data() || {};
      console.log('radar-' + dateKey + ' already written at ' +
        (prev.generatedAt || '?') + ' — nothing to do (--force to re-run).');
      // Still record the run: the app needs to know the 08:30 catch-up fired and
      // found the feed healthy, not that nothing happened at all.
      await recordRunHealth(db, 'radar', {
        status: 'skipped', asOf: prev.asOf || dateKey,
        durationMs: Date.now() - RUN_STARTED,
        message: 'already written at ' + (prev.generatedAt || '?')
      });
      return;
    }
  }

  STAGE.set('fetch-bars');
  var barsByAsset = await fetchAll();

  var counts = Object.keys(barsByAsset).map(function (s) {
    return s + ':' + (barsByAsset[s] ? barsByAsset[s].length : 0);
  });
  console.log('Bars loaded -> ' + counts.join('  '));

  STAGE.set('score');
  var result = scoreUniverse(barsByAsset, CONFIG);

  // V2: tag each signal with a recent catalyst (display-only; score unchanged).
  STAGE.set('catalysts');
  var catResult = await fetchCatalysts(result.signals);
  var catalysts = catResult.catalysts;
  var tagged = 0;
  result.signals.forEach(function (s) {
    var c = catalysts[s.symbol];
    if (c && c.catalyst) {
      s.catalyst = c.catalyst;
      s.eventType = c.eventType || 'none';
      s.catalystAsOf = c.asOf || 'recent';
      tagged++;
    } else {
      s.catalyst = '';
      s.eventType = 'none';
      s.catalystAsOf = '';
    }
  });
  console.log('Catalysts tagged: ' + tagged + '/' + result.signals.length);

  var doc = {
    generatedAt: new Date().toISOString(),
    asOf: result.asOf,
    regime: result.regime,
    // Benchmark closes (SPY/QQQ/BTC). The index symbols are not scored, so
    // without this the app can only express a decision's result as a raw
    // return, never as excess over the benchmark that signal was judged against.
    benchmarks: result.benchmarks,
    signals: result.signals
  };

  console.log('\n===== briefings-bob/radar-' + dateKey + ' =====');
  console.log(JSON.stringify(doc, null, 2));

  // V3: rebuild the calibration journal from the same bars (pure, deterministic
  // re-scoring). buildJournal returns the full doc body; we only stamp the
  // time/data fields (the I/O concerns) and write it.
  STAGE.set('journal');
  var journalBody = buildJournal(barsByAsset, CONFIG, CONFIG.journal);
  var journalDoc = Object.assign({
    generatedAt: new Date().toISOString(),
    asOf: result.asOf
  }, journalBody);

  console.log('\n===== radar-journal calibration (H=' + journalBody.journalConfig.horizonBars +
    ', ' + journalBody.journalConfig.entryMode + ', benchmark-excess) =====');
  ['confirmed', 'forming', 'invalidated'].forEach(function (st) {
    var g = journalBody.byStatus[st];
    console.log('  ' + st.padEnd(12) + ' n=' + String(g.n).padStart(4) +
      '  winRate=' + (g.winRate == null ? '—' : g.winRate + '%') +
      '  avgFwd=' + (g.avgForwardReturn == null ? '—' : g.avgForwardReturn + '%') +
      '  excessWin=' + (g.excessWinRate == null ? '—' : g.excessWinRate + '%') +
      '  avgExcess=' + (g.avgExcessReturn == null ? '—' : g.avgExcessReturn + '%') +
      '  amb=' + g.ambiguousN);
  });
  ['80-100', '60-79', '40-59', '0-39'].forEach(function (bk) {
    var g = journalBody.byScoreBucket[bk];
    console.log('  score ' + bk.padEnd(7) + ' n=' + String(g.n).padStart(4) +
      '  avgExcess=' + (g.avgExcessReturn == null ? '—' : g.avgExcessReturn + '%') +
      '  excessWin=' + (g.excessWinRate == null ? '—' : g.excessWinRate + '%'));
  });
  console.log('  counts: raw=' + journalBody.counts.raw + ' nonOverlapping=' + journalBody.counts.nonOverlapping +
    ' uniqueDates=' + journalBody.counts.uniqueDates + ' pending=' + journalBody.counts.pending);
  journalBody.caveats.forEach(function (c) { console.log('  caveat: ' + c); });

  // Does the score RANK correctly day to day, and does the answer depend on the
  // tape? The bucket table above pools the whole window and cannot separate the
  // two; this is the diagnostic that can.
  var ic = journalBody.informationCoefficient;
  console.log('\n  --- ranking skill (information coefficient) ---');
  console.log('    meanIC=' + (ic.meanIC == null ? '—' : ic.meanIC) +
    '  median=' + (ic.medianIC == null ? '—' : ic.medianIC) +
    '  sd=' + (ic.stdIC == null ? '—' : ic.stdIC) +
    '  days+=' + (ic.positiveDayRate == null ? '—' : ic.positiveDayRate + '%') +
    '  nDates=' + ic.nDates);
  console.log('    t=' + (ic.tStat == null ? '—' : ic.tStat) +
    '  overlap-adj t=' + (ic.tStatOverlapAdj == null ? '—' : ic.tStatOverlapAdj) +
    '  (effective windows ' + (ic.effectiveNDates == null ? '—' : ic.effectiveNDates) + ')');
  console.log('    verdict: ' + ic.verdict);

  console.log('\n  --- by market regime ---');
  ['risk-on', 'mixed', 'risk-off'].forEach(function (r) {
    var g = journalBody.byRegime[r] || {};
    console.log('    ' + r.padEnd(9) +
      ' n=' + String(g.n == null ? 0 : g.n).padStart(4) +
      '  dates=' + String(g.dates == null ? 0 : g.dates).padStart(3) +
      '  avgExcess=' + (g.avgExcessReturn == null ? '—' : g.avgExcessReturn + '%') +
      '  meanIC=' + (g.meanIC == null ? '—' : g.meanIC) +
      '  band 80-100 vs 0-39 = ' + (g.spread == null ? '—' : (g.spread > 0 ? '+' : '') + g.spread + 'pp'));
  });
  console.log('  ' + journalBody.regimeCoverage.note);

  var wc = journalBody.weightCalibration;
  console.log('\n  --- weight calibration (holdout from ' + wc.holdoutFrom + ') ---');
  ['trend', 'volume', 'relStrength', 'riskQuality', 'regime'].forEach(function (c) {
    var g = wc.components[c] || {};
    console.log('    ' + c.padEnd(12) +
      ' spreadFit=' + (g.spreadFit == null ? '—' : g.spreadFit + 'pp') +
      '  spreadHoldout=' + (g.spreadHoldout == null ? '—' : g.spreadHoldout + 'pp') +
      '  robust=' + (g.robust ? 'YES' : 'no') +
      '   w ' + wc.currentWeights[c] + ' -> ' + wc.suggestedWeights[c]);
  });
  console.log('  ' + wc.note);

  STAGE.set('write');
  await writeDoc(db, dateKey, doc);
  await db.collection(COLL).doc('radar-journal').set(journalDoc);
  console.log('\nWrote briefings-bob/radar-' + dateKey + ', radar-latest = ' + dateKey + ', and radar-journal.');

  // The radar itself is now safely written — record health before the optional
  // PH leg so a PH failure can never mask a good radar run.
  await recordRunHealth(db, 'radar', {
    status: 'ok', asOf: result.asOf, durationMs: Date.now() - RUN_STARTED
  });

  // Record the catalyst call's token usage to the shared LLM cost ledger (no-throw).
  if (catResult.usage) await recordUsage(db, 'radar-catalyst', OPENAI_MODEL, catResult.usage, dateKey, 1);

  // Decision drift digest (non-fatal — never blocks or invalidates the radar).
  STAGE.set('drift');
  try {
    await writeDecisionDrift(db, result, dateKey);
  } catch (e) {
    console.log('decision drift skipped: ' + (e.message || e));
  }

  // PH snapshot (non-fatal — never blocks the radar write).
  STAGE.set('ph');
  try {
    var ph = await buildPhSnapshot(CONFIG);
    var phDoc = Object.assign({ generatedAt: new Date().toISOString(), asOf: ph.index.asOf }, ph);
    var wrote = await writePhSnapshot(db, COLL, phDoc);
    if (wrote) console.log('Wrote radar-ph snapshot (PSEi ' + ph.index.close + ' ' + ph.index.currency +
      ', ' + ph.proxies.length + ' proxies).');
    await recordRunHealth(db, 'ph', {
      status: wrote ? 'ok' : 'skipped', asOf: ph.index.asOf,
      message: wrote ? '' : 'stored snapshot is newer'
    });
  } catch (e) {
    console.log('PH snapshot skipped: ' + (e.message || e));
    await recordRunHealth(db, 'ph', {
      status: 'failed', stage: 'build-snapshot', message: e.message || String(e)
    });
  }
}

main().then(function () {
  runFooter('OK');
  process.exit(0);
}).catch(async function (e) {
  console.error('\nrefresh-radar failed:', e.message || e);
  // Record the failure and WHERE it died, so the app shows a cause instead of
  // silent staleness. _db is null when the run never got past waitForNetwork —
  // nothing to write with, and the app infers "never ran" from a stale
  // lastRunAt, which is the correct reading anyway.
  if (_db) {
    await recordRunHealth(_db, 'radar', {
      status: 'failed', stage: STAGE.get(),
      durationMs: Date.now() - RUN_STARTED, message: e.message || String(e)
    });
  }
  runFooter('FAILED');
  process.exit(1);
});
