// miro/refresh-miro.js
//
// Runner for the Event-Markets "scenario read". This is the ONLY file that does
// I/O: it fetches a curated set of Polymarket markets from the free Gamma API,
// (Lane 2) runs a small persona panel via OpenAI, hands everything to the PURE
// engine in scenario.js, and writes one Firestore doc per day plus a `miro-latest`
// pointer. The pure modules never see any of this.
//
// LANE 1 (this commit): fetch markets + write the doc with implied prices only.
// The panel is stubbed (no LLM cost) so the data pipeline + tab can be proven
// cheaply before wiring the scenario engine in Lane 2.
//
// Run locally on the Windows box:
//   cd miro
//   npm install
//   node refresh-miro.js
//
// Secrets: reuses radar's. Env (OPENAI_API_KEY, optional) is read from miro/.env
// if present, else radar/.env. Firestore auth uses miro/serviceAccountKey.json if
// present, else radar/serviceAccountKey.json (same project, pokerhq-a67e4), else
// application default credentials. So there is no new secret setup.
//
// To promote to a scheduled Cloud Function later, wrap fetchMarkets() +
// aggregatePanel() + writeDoc() in an onSchedule handler. scenario.js is untouched.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CONFIG } from './config.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var __radar = join(__dirname, '..', 'radar');

// Load env from miro/.env then radar/.env (gitignored). Format: KEY=value per
// line; # comments and blank lines ignored. Real env vars and earlier files win.
(function loadDotEnv() {
  [join(__dirname, '.env'), join(__radar, '.env')].forEach(function (p) {
    try {
      if (!existsSync(p)) return;
      readFileSync(p, 'utf8').split(/\r?\n/).forEach(function (line) {
        if (/^\s*(#|$)/.test(line)) return;
        var m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (!m) return;
        var val = m[2].replace(/^['"]|['"]$/g, '');
        if (process.env[m[1]] === undefined) process.env[m[1]] = val;
      });
      console.log('Loaded ' + p);
    } catch (e) { console.warn('.env load failed (' + p + '):', e.message); }
  });
})();

var PROJECT_ID = 'pokerhq-a67e4';
var COLL = 'briefings-bob';
var GAMMA = 'https://gamma-api.polymarket.com';

// ── helpers ──

// Today's date in Philippine time (PHT, UTC+8), as YYYY-MM-DD — the doc id.
// Mirrors radar so both features key off the same local day.
function phtDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// fetch with retry + backoff — this box's network intermittently ECONNRESETs,
// so a single transient failure should not abort an unattended run.
async function fetchRetry(url, opts, label) {
  var attempts = 4;
  var lastErr;
  for (var i = 0; i < attempts; i++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      lastErr = e;
      var code = (e && e.cause && e.cause.code) || e.message;
      console.log('  ' + (label || 'fetch') + ' transient error (' + code + '), retry ' + (i + 1) + '/' + (attempts - 1));
      await new Promise(function (r) { setTimeout(r, 1500 * (i + 1)); });
    }
  }
  throw lastErr;
}

// Gamma returns `outcomes` / `outcomePrices` as JSON-encoded STRINGS. Parse
// defensively (some fields can already be arrays depending on the endpoint).
function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return []; } }
  return [];
}

function num(v) { var n = Number(v); return isNaN(n) ? null : n; }

// ── data: curated Polymarket markets via the free Gamma API (no auth) ──
// One request fetches all curated slugs (repeated `slug` query params). We map
// each back to its config entry and pull P(YES) from the outcome arrays.

async function fetchMarkets(markets) {
  var qs = markets.map(function (m) { return 'slug=' + encodeURIComponent(m.slug); }).join('&');
  var url = GAMMA + '/markets?limit=500&' + qs;
  var res = await fetchRetry(url, { headers: { 'accept': 'application/json' } }, 'Gamma');
  if (!res.ok) {
    var body = await res.text();
    throw new Error('Gamma ' + res.status + ': ' + body.slice(0, 300));
  }
  var raw = await res.json();
  var bySlug = {};
  (raw || []).forEach(function (r) { if (r && r.slug) bySlug[r.slug] = r; });

  var out = [];
  markets.forEach(function (cfg) {
    var r = bySlug[cfg.slug];
    if (!r) {
      console.log('  market not found on Gamma: ' + cfg.slug + ' (skipped)');
      return;
    }
    var outcomes = parseArr(r.outcomes);
    var prices = parseArr(r.outcomePrices);
    var yesIdx = outcomes.findIndex(function (o) {
      return String(o).toLowerCase() === String(cfg.yesOutcome || 'Yes').toLowerCase();
    });
    if (yesIdx < 0) yesIdx = 0;
    var impliedYes = num(prices[yesIdx]);
    if (impliedYes === null) {
      console.log('  no price for ' + cfg.slug + ' (skipped)');
      return;
    }
    out.push({
      slug: cfg.slug,
      label: cfg.label,
      theme: cfg.theme,
      question: r.question || cfg.label,
      yesOutcome: outcomes[yesIdx] != null ? String(outcomes[yesIdx]) : (cfg.yesOutcome || 'Yes'),
      impliedYes: impliedYes,
      endDate: r.endDateIso || (r.endDate ? String(r.endDate).slice(0, 10) : null),
      volumeNum: num(r.volumeNum),
      liquidityNum: num(r.liquidityNum),
      closed: !!r.closed,
      conditionId: r.conditionId || null,
      // Lane 2 fills these; null here keeps the doc shape stable for the front end.
      panelProb: null,
      panelDispersion: null,
      haircutProb: null,
      edge: null,
      gate: null,
      gateReason: null
    });
  });
  return out;
}

// ── Firestore (Admin SDK — bypasses security rules) ──

function initAdmin() {
  var local = join(__dirname, 'serviceAccountKey.json');
  var shared = join(__radar, 'serviceAccountKey.json');
  var keyPath = existsSync(local) ? local : (existsSync(shared) ? shared : null);
  if (keyPath) {
    var sa = JSON.parse(readFileSync(keyPath, 'utf8'));
    initializeApp({ credential: cert(sa), projectId: PROJECT_ID });
    console.log('firebase-admin: using ' + keyPath);
  } else {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    console.log('firebase-admin: using application default credentials');
  }
  return getFirestore();
}

async function writeDoc(db, dateKey, doc) {
  // No `uid` field: the front end reads briefings-bob docs that carry no uid
  // (rule: !('uid' in resource.data)). Admin SDK writes bypass rules anyway.
  await db.collection(COLL).doc('miro-' + dateKey).set(doc);
  await db.collection(COLL).doc('miro-latest').set({ value: dateKey });
}

// ── main ──

async function main() {
  console.log('Fetching ' + CONFIG.markets.length + ' curated markets from Polymarket Gamma...');
  var marketsData = await fetchMarkets(CONFIG.markets);
  console.log('Got ' + marketsData.length + ' markets.');

  var dateKey = phtDateKey();
  var doc = {
    generatedAt: new Date().toISOString(),
    asOf: dateKey,
    lane: 1,                 // bumped as the scenario engine (2) / journal (3) ship
    disclaimer: 'Research framing only — implied probabilities from Polymarket. Not advice, not a recommendation, no execution. The scenario panel and edge gate arrive in a later lane.',
    markets: marketsData
  };

  console.log('\n===== briefings-bob/miro-' + dateKey + ' =====');
  marketsData.forEach(function (m) {
    console.log('  ' + (m.label || m.slug).padEnd(34) +
      '  implied YES ' + (m.impliedYes * 100).toFixed(1) + '%' +
      '  vol ' + (m.volumeNum == null ? '—' : Math.round(m.volumeNum)) +
      '  liq ' + (m.liquidityNum == null ? '—' : Math.round(m.liquidityNum)) +
      (m.closed ? '  [CLOSED]' : ''));
  });

  var db = initAdmin();
  await writeDoc(db, dateKey, doc);
  console.log('\nWrote briefings-bob/miro-' + dateKey + ' and miro-latest = ' + dateKey + '.');
}

main().then(function () {
  process.exit(0);
}).catch(function (e) {
  console.error('\nrefresh-miro failed:', e.message || e);
  process.exit(1);
});
