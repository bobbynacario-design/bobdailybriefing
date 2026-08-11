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
import { aggregatePanel } from './scenario.js';
import { buildMiroJournal } from './journal-miro.js';
import { enrichMarketChanges } from './briefing.js';
import { extractUsage, addUsage, recordUsage } from '../lib/llm-usage.js';
import { recordRunHealth, makeStage } from '../lib/feed-health.js';
import { fetchRetry } from '../lib/http.js';

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
var CLOB = 'https://clob.polymarket.com';

// Scenario panel (Lane 2). Reuses the app's OpenAI integration (same
// /v1/responses endpoint + model as the radar's catalyst tagging). Optional: if
// no key is set the run still completes and writes implied-only markets, so the
// feature never hard-depends on the panel.
var OPENAI_KEY = process.env.OPENAI_API_KEY || '';
var OPENAI_MODEL = process.env.OPENAI_MODEL || CONFIG.panel.model || 'gpt-5.5';

// ── panel provider ────────────────────────────────────────────────────────
// 'openai' speaks /v1/responses; 'compatible' speaks /v1/chat/completions, which
// is what every free and cheap alternative offers (local Ollama, DeepSeek, Qwen,
// GLM, Kimi, OpenRouter). Only 'openai' has a hosted web_search tool, and that
// costs nothing to give up because webSearch is already off on cost grounds.
var PANEL_PROVIDER = (process.env.MIRO_PANEL_PROVIDER || CONFIG.panel.provider || 'openai').toLowerCase();
var IS_COMPATIBLE = PANEL_PROVIDER !== 'openai';
var PANEL_MODEL = process.env.MIRO_PANEL_MODEL || OPENAI_MODEL;
var PANEL_BASE_URL = (process.env.MIRO_PANEL_BASE_URL || CONFIG.panel.baseUrl ||
  (IS_COMPATIBLE ? (CONFIG.panel.compatibleDefaultBaseUrl || 'http://localhost:11434/v1')
                 : 'https://api.openai.com/v1')).replace(/\/+$/, '');
// A local endpoint needs no key, so requiring one would block the zero-cost case.
// Deliberately NO fallback from a compatible provider to OPENAI_API_KEY: that
// would send an OpenAI credential to whatever third-party host MIRO_PANEL_BASE_URL
// points at. A remote compatible provider must be given its own key explicitly.
var PANEL_KEY = process.env.MIRO_PANEL_API_KEY || (IS_COMPATIBLE ? '' : OPENAI_KEY);
function isLocalEndpoint(u) { return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(u); }
// Opt-in only — see panelRequest for why a default value is unsafe.
var PANEL_TEMPERATURE = process.env.MIRO_PANEL_TEMPERATURE != null && process.env.MIRO_PANEL_TEMPERATURE !== ''
  ? Number(process.env.MIRO_PANEL_TEMPERATURE) : null;

// Constrained JSON output. Small local models are the reason: qwen2.5:7b returned
// 41/45 reads and silently dropped whole slugs, including the highest-edge market.
// json_object mode forces syntactically valid JSON, which removes the fenced and
// truncated-output failure modes. It canNOT fix a model that simply omits keys, so
// this is a partial mitigation and the read counts still have to be watched.
//
// ON by default for compatible providers, but NOT trusted: `panelJsonMode` is
// switched off for the rest of the run if a provider rejects it (see runPanel).
// Set MIRO_PANEL_JSON_MODE=0 to disable outright.
var PANEL_JSON_MODE = process.env.MIRO_PANEL_JSON_MODE === '0' ? false : true;
var panelJsonMode = PANEL_JSON_MODE;   // mutable: cleared on a provider rejection
var PANEL_KEY_REQUIRED = !IS_COMPATIBLE || !isLocalEndpoint(PANEL_BASE_URL);

// What the cost ledger and the journal record. A hosted model is keyed by its own
// name; anything local is prefixed so the Help tab can price it at a true $0
// rather than showing it "unpriced", which would imply the rate is merely unknown.
var PANEL_MODEL_LABEL = (IS_COMPATIBLE && isLocalEndpoint(PANEL_BASE_URL))
  ? 'local/' + PANEL_MODEL
  : (IS_COMPATIBLE ? PANEL_PROVIDER + '/' + PANEL_MODEL : PANEL_MODEL);

// Provenance stamped onto every written doc (Lane C).
var SCENARIO_VERSION = '1.1.0';
var JOURNAL_VERSION = '1.1.0';

// CLI flags: --dry-run (compute + log, skip Firestore writes), --no-openai (skip
// the panel and write implied-only — fast, free smoke test).
var ARGV = process.argv.slice(2);
var DRY_RUN = ARGV.indexOf('--dry-run') !== -1;
var NO_OPENAI = ARGV.indexOf('--no-openai') !== -1;

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
    var tokenIds = parseArr(r.clobTokenIds);
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
      priority: cfg.priority == null ? 3 : cfg.priority,
      why: cfg.why || '',
      question: r.question || cfg.label,
      yesOutcome: outcomes[yesIdx] != null ? String(outcomes[yesIdx]) : (cfg.yesOutcome || 'Yes'),
      impliedYes: impliedYes,
      endDate: r.endDateIso || (r.endDate ? String(r.endDate).slice(0, 10) : null),
      volumeNum: num(r.volumeNum),
      volume24hr: num(r.volume24hr),
      liquidityNum: num(r.liquidityNum),
      closed: !!r.closed,
      conditionId: r.conditionId || null,
      resolutionSource: r.resolutionSource || '',
      umaResolutionStatus: r.umaResolutionStatus || '',
      yesTokenId: tokenIds[yesIdx] != null ? String(tokenIds[yesIdx]) : null,
      // Order-book fields (Lane B) filled by fetchBooks(); null here keeps shape.
      yesBid: null, yesAsk: null, mid: null, spread: null, depthTop: null,
      // Panel fields (Lane 2) filled by aggregatePanel(); null keeps FE shape stable.
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

// ── data: executable order book via the free Polymarket CLOB API (Lane B) ──
// For each market's YES token, read top-of-book so edge is computed against the
// price you could actually HIT (ask to buy YES, bid to sell YES), with the spread
// paid implicitly and top-of-book depth gated. Non-fatal per market: a missing
// book just leaves the market on the implied-price fallback (noBook).
async function fetchBooks(markets) {
  for (var i = 0; i < markets.length; i++) {
    var m = markets[i];
    if (!m.yesTokenId) continue;
    try {
      var res = await fetchRetry(CLOB + '/book?token_id=' + encodeURIComponent(m.yesTokenId),
        { headers: { 'accept': 'application/json' } }, 'CLOB ' + m.slug);
      if (!res.ok) { console.log('  book ' + m.slug + ' HTTP ' + res.status + ' — implied-only'); continue; }
      var b = await res.json();
      var bids = b.bids || [], asks = b.asks || [];
      var bestBid = null, bestBidSz = 0, bestAsk = null, bestAskSz = 0;
      bids.forEach(function (o) { var p = num(o.price); if (p != null && (bestBid === null || p > bestBid)) { bestBid = p; bestBidSz = num(o.size) || 0; } });
      asks.forEach(function (o) { var p = num(o.price); if (p != null && (bestAsk === null || p < bestAsk)) { bestAsk = p; bestAskSz = num(o.size) || 0; } });
      if (bestBid === null || bestAsk === null) { console.log('  book ' + m.slug + ' empty — implied-only'); continue; }
      m.yesBid = bestBid;
      m.yesAsk = bestAsk;
      m.mid = (bestBid + bestAsk) / 2;
      m.spread = bestAsk - bestBid;
      m.depthTop = Math.min(bestBidSz, bestAskSz);
    } catch (e) {
      console.log('  book ' + m.slug + ' failed (' + (e.message || e) + ') — implied-only');
    }
  }
}

// ── scenario panel via OpenAI (Lane 2) ──
// Pull text out of an OpenAI /v1/responses payload (mirrors the radar).
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

// Text out of an OpenAI-COMPATIBLE /v1/chat/completions payload. Falls back to
// reasoning_content because reasoning models (DeepSeek-R1 and its distills, which
// are the obvious free choices here) sometimes leave `content` empty and put the
// answer there instead — without this the parse would fail on exactly the models
// this adapter exists to enable.
function extractChatText(json) {
  var c = (json && json.choices || [])[0];
  var m = c && c.message;
  if (!m) return '';
  if (typeof m.content === 'string' && m.content.trim()) return m.content;
  if (typeof m.reasoning_content === 'string') return m.reasoning_content;
  return '';
}
function panelText(json) { return IS_COMPATIBLE ? extractChatText(json) : extractText(json); }

// Build the request for whichever shape the provider speaks.
function panelRequest(systemMsg, userPrompt, wantSearch) {
  if (IS_COMPATIBLE) {
    return {
      url: PANEL_BASE_URL + '/chat/completions',
      // NO temperature unless explicitly asked for. Reasoning models reject a
      // custom value outright — a live test against gpt-5.5 returned HTTP 400
      // "does not support 0.2 with this model", and DeepSeek-R1 and its distills
      // behave the same way. Those are exactly the free models this adapter
      // exists to enable, so a hardcoded temperature would have broken the main
      // use case. Omitting it is accepted everywhere; set MIRO_PANEL_TEMPERATURE
      // only for a model known to allow it.
      body: Object.assign({
        model: PANEL_MODEL,
        messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: userPrompt }],
        stream: false
      },
      PANEL_TEMPERATURE == null ? {} : { temperature: PANEL_TEMPERATURE },
      // Both prompts already contain the word "JSON", which OpenAI's json_object
      // mode requires; without it the request is rejected.
      panelJsonMode ? { response_format: { type: 'json_object' } } : {})
    };
  }
  var body = {
    model: PANEL_MODEL,
    input: [{ role: 'system', content: systemMsg }, { role: 'user', content: userPrompt }]
  };
  if (wantSearch) {
    body.tools = [{ type: 'web_search', search_context_size: 'low' }];
    body.tool_choice = 'auto';
  }
  return { url: PANEL_BASE_URL + '/responses', body: body };
}
function panelHeaders() {
  var h = { 'Content-Type': 'application/json' };
  if (PANEL_KEY) h['Authorization'] = 'Bearer ' + PANEL_KEY;
  return h;
}

// Strip ```json fences and parse the first JSON object found.
function parseLooseJson(raw) {
  var s = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  var start = s.indexOf('{');
  var end = s.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in model output');
  return JSON.parse(s.slice(start, end + 1));
}

// One OpenAI call per persona — each returns a probability for EVERY market in a
// single response (cheap: ~N persona calls per run, not personas*markets). The
// personas are deliberately diverse and BLIND to the market price, so their reads
// are less correlated than asking one model the same way N times. Returns a map
// slug -> [prob, prob, ...] across personas. Never throws.
async function runPanel(markets, config) {
  var readsBySlug = {};
  markets.forEach(function (m) { readsBySlug[m.slug] = []; });
  var usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  var calls = 0;

  // A local endpoint needs no key, so the guard asks whether THIS provider needs
  // one rather than always demanding OPENAI_API_KEY.
  if (PANEL_KEY_REQUIRED && !PANEL_KEY) {
    console.log((IS_COMPATIBLE ? 'MIRO_PANEL_API_KEY' : 'OPENAI_API_KEY') +
      ' not set — skipping scenario panel (markets written implied-only).');
    return { reads: readsBySlug, usage: usage, calls: calls };
  }
  // Hosted web_search exists only on OpenAI's /v1/responses. Say so rather than
  // silently producing ungrounded reads while config still claims grounding.
  if (IS_COMPATIBLE && config.panel.webSearch) {
    console.log('NOTE: provider "' + PANEL_PROVIDER + '" has no hosted web_search — running ungrounded.');
  }

  var list = markets.map(function (m) {
    return '- slug "' + m.slug + '": ' + m.question +
      (m.endDate ? ' (resolves ' + m.endDate + ')' : '');
  }).join('\n');

  var personas = config.panel.personas;
  console.log('Running scenario panel: ' + personas.length + ' personas x ' + markets.length +
    ' markets via ' + PANEL_MODEL_LABEL + ' @ ' + PANEL_BASE_URL + '...');

  for (var i = 0; i < personas.length; i++) {
    var p = personas[i];
    var prompt =
      'You are estimating the probability that each event below resolves YES. ' +
      'You are NOT given any market price — form your OWN independent view from base rates and evidence.\n\n' +
      'IMPORTANT — stay price-blind: do NOT consult or rely on prediction-market or ' +
      'betting-odds sources (Polymarket, Kalshi, Manifold, Metaculus, sportsbooks, odds ' +
      'aggregators) or articles that quote market-implied probabilities. Use primary and ' +
      'base-rate evidence only (official sources, mainstream news, standings/polls/data).\n\n' +
      'Persona: ' + p.brief + '\n\n' +
      'Markets:\n' + list + '\n\n' +
      'Return STRICT JSON only — an object keyed by the exact slug string, each value a single number ' +
      'between 0 and 1 (your probability the market resolves YES). No prose, no code fences, no extra keys.';

    // web_search only ever applies on the 'openai' provider; panelRequest ignores
    // the flag otherwise, so a stale `webSearch: true` cannot produce a body a
    // compatible endpoint would reject.
    var req = panelRequest(
      'You are a calibrated probabilistic forecaster. Avoid overconfidence. Return strict JSON only. Never give financial advice.',
      prompt,
      !IS_COMPATIBLE && config.panel.webSearch
    );

    try {
      var res = await fetchRetry(req.url, {
        method: 'POST',
        headers: panelHeaders(),
        body: JSON.stringify(req.body)
      }, PANEL_PROVIDER + '(' + p.id + ')');
      var text = await res.text();

      // Not every compatible provider accepts response_format. Rather than lose
      // the persona, drop the constraint for the REST of the run and retry once.
      // Learned the hard way from temperature: an unsupported optional parameter
      // must degrade, not fail the call.
      // Scoped to IS_COMPATIBLE because response_format is only ever sent there;
      // without that guard a 400 on the OpenAI path whose message merely contains
      // "format" would trigger a pointless retry.
      if (!res.ok && IS_COMPATIBLE && panelJsonMode && res.status === 400 &&
          /response_format|json_object/i.test(text)) {
        console.log('  provider rejected response_format — disabling JSON mode for this run.');
        panelJsonMode = false;
        req = panelRequest(
          'You are a calibrated probabilistic forecaster. Avoid overconfidence. Return strict JSON only. Never give financial advice.',
          prompt,
          !IS_COMPATIBLE && config.panel.webSearch
        );
        res = await fetchRetry(req.url, {
          method: 'POST',
          headers: panelHeaders(),
          body: JSON.stringify(req.body)
        }, PANEL_PROVIDER + '(' + p.id + ' retry)');
        text = await res.text();
      }

      if (!res.ok) { console.log('  persona ' + p.id + ' HTTP ' + res.status + ' — skipped: ' + text.slice(0, 160)); continue; }
      var pj = JSON.parse(text);
      var map = parseLooseJson(panelText(pj));
      usage = addUsage(usage, extractUsage(pj));   // count tokens even if parse below is partial
      calls += 1;
      var got = 0;
      markets.forEach(function (m) {
        var v = Number(map[m.slug]);
        if (isFinite(v) && v >= 0 && v <= 1) { readsBySlug[m.slug].push(v); got++; }
      });
      console.log('  persona ' + p.id + ': ' + got + '/' + markets.length + ' reads');
    } catch (e) {
      console.log('  persona ' + p.id + ' failed (' + (e.message || e) + ') — skipped.');
    }
  }
  return { reads: readsBySlug, usage: usage, calls: calls };
}

// ── Firestore (Admin SDK — bypasses security rules) ──

var _db = null;
var STAGE = makeStage('start');
var RUN_STARTED = Date.now();

function initAdmin() {
  if (_db) return _db; // initializeApp throws if called twice
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
  _db = getFirestore();
  return _db;
}

async function writeDoc(db, dateKey, doc) {
  // No `uid` field: the front end reads briefings-bob docs that carry no uid
  // (rule: !('uid' in resource.data)). Admin SDK writes bypass rules anyway.
  var batch = db.batch();
  batch.set(db.collection(COLL).doc('miro-' + dateKey), doc);
  batch.set(db.collection(COLL).doc('miro-latest'), { value: dateKey });
  await batch.commit();
}

async function loadMiroControl(db) {
  try {
    var snap = await db.collection(COLL).doc('miro-control').get();
    return snap.exists ? (snap.data() || {}) : {};
  } catch (e) {
    console.warn('miro-control read failed (continuing with OpenAI enabled):', e.message || e);
    return {};
  }
}

async function loadPreviousMiro(db) {
  try {
    var pointer = await db.collection(COLL).doc('miro-latest').get();
    var value = pointer.exists && pointer.data() && pointer.data().value;
    if (!value) return null;
    var snap = await db.collection(COLL).doc('miro-' + value).get();
    return snap.exists ? (snap.data() || null) : null;
  } catch (e) {
    console.warn('previous Markets snapshot read failed:', e.message || e);
    return null;
  }
}

// ── main ──

async function main() {
  STAGE.set('fetch-markets');
  console.log('Fetching ' + CONFIG.markets.length + ' curated markets from Polymarket Gamma...');
  var marketsData = await fetchMarkets(CONFIG.markets);
  console.log('Got ' + marketsData.length + ' markets.');

  // Lane B: read the executable order book so edge is vs the price you can hit.
  STAGE.set('fetch-books');
  console.log('Fetching order books from Polymarket CLOB...');
  await fetchBooks(marketsData);

  STAGE.set('init');
  var db = initAdmin();
  var previousDoc = await loadPreviousMiro(db);
  var control = await loadMiroControl(db);
  var controlPaused = control.llmPaused === true;

  // Lane 2: run the persona panel (independent of price), attach the reads, and
  // let the PURE engine compute haircut prob, executable edge, and the gate.
  var panel;
  if (NO_OPENAI || controlPaused) {
    console.log((NO_OPENAI ? '--no-openai' : 'miro-control llmPaused=true') + ': skipping panel (implied-only).');
    var emptyReads = {};
    marketsData.forEach(function (m) { emptyReads[m.slug] = []; });
    panel = { reads: emptyReads, usage: null, calls: 0 };
  } else {
    panel = await runPanel(marketsData, CONFIG);
  }
  var readsBySlug = panel.reads;
  marketsData.forEach(function (m) { m.panelReads = readsBySlug[m.slug] || []; });
  marketsData = aggregatePanel(marketsData, CONFIG);
  // Drop the raw reads from the persisted doc (keep panelN as the count).
  marketsData.forEach(function (m) { delete m.panelReads; });
  var briefing = enrichMarketChanges(marketsData, previousDoc);
  marketsData = briefing.markets;

  var dateKey = phtDateKey();
  var meta = {
    scenarioVersion: SCENARIO_VERSION,
    journalVersion: JOURNAL_VERSION,
    model: ((!PANEL_KEY_REQUIRED || PANEL_KEY) && !NO_OPENAI && !controlPaused) ? PANEL_MODEL_LABEL : 'none',
    panelProvider: PANEL_PROVIDER,
    llmPaused: controlPaused,
    llmPausedSource: controlPaused ? 'briefings-bob/miro-control' : '',
    priceSource: 'polymarket-clob-book (mid); gamma outcomePrices fallback',
    panelWebSearch: !!CONFIG.panel.webSearch,
    priceBlindSourcePolicy: CONFIG.panel.webSearch
      ? 'panel price-blind; web_search instructed to exclude prediction-market/odds sources'
      : 'panel price-blind; web_search OFF — personas run on training knowledge and base rates, so reads are weaker on fast-moving events',
    costAssumption: 'spread paid implicitly + slippage ' + CONFIG.fees.slippage,
    gates: CONFIG.edgeGate,
    warnings: [
      'Research framing only — no execution path, never a bet.',
      'Panel uses one model family; personas are prompted perspectives, not statistically independent forecasters.',
      'Prediction markets are often close to efficient — expect little or no edge.',
      'Thin or wide-spread markets can show paper edge that is not tradeable.'
    ]
  };
  var doc = {
    generatedAt: new Date().toISOString(),
    asOf: dateKey,
    lane: 3,
    meta: meta,
    disclaimer: 'Research framing only. Implied probabilities are Polymarket prices; the panel read is an independent, uncertainty-haircut estimate compared to that price. The verdict is a research flag — not advice, not a recommendation, no execution.',
    markets: marketsData,
    changes: briefing.changes
  };

  console.log('\n===== briefings-bob/miro-' + dateKey + ' =====');
  marketsData.forEach(function (m) {
    var book = m.yesBid == null ? 'no-book' :
      (m.yesBid * 100).toFixed(1) + '/' + (m.yesAsk * 100).toFixed(1) + 'c sprd ' + (m.spread * 100).toFixed(1) + 'c';
    var panel = m.haircutProb == null ? 'panel n/a (implied only)' :
      ('panel ' + (m.haircutProb * 100).toFixed(1) + '% (' + m.panelN + ' reads, ±' +
        (m.panelDispersion * 100).toFixed(1) + ')  edge ' +
        (m.edge >= 0 ? '+' : '') + (m.edge * 100).toFixed(1) + 'pts ' + m.edgeSide +
        '  [' + m.gate + (m.gateReason ? ':' + m.gateReason : '') + ']');
    console.log('  ' + (m.label || m.slug).padEnd(30) +
      '  mkt ' + (m.impliedYes * 100).toFixed(1) + '%  ' + book + '  ' + panel);
  });

  if (DRY_RUN) {
    console.log('\n--dry-run: NOT writing miro-' + dateKey + ' / miro-latest.');
  } else {
    await writeDoc(db, dateKey, doc);
    console.log('\nWrote briefings-bob/miro-' + dateKey + ' and miro-latest = ' + dateKey + '.');
    // Record the panel's token usage to the shared LLM cost ledger (no-throw).
    if (panel.calls > 0) await recordUsage(db, 'miro-panel', PANEL_MODEL_LABEL, panel.usage, dateKey, panel.calls);
  }

  // ── Lane 3: resolution journal (Brier ours vs market price) ──
  // Load the rolling journal, catch any resolutions (including markets that have
  // since dropped out of the curated list but are still open in the journal), and
  // let the PURE engine update the accumulated record.
  var priorJournal = (await db.collection(COLL).doc('miro-journal').get()).data() || null;

  // Markets to check for resolution = today's curated set PLUS any still-open
  // journal slugs no longer in the config (so a removed market still gets scored).
  var openSlugs = (priorJournal && priorJournal.open) ? Object.keys(priorJournal.open) : [];
  var haveSlugs = {};
  marketsData.forEach(function (m) { haveSlugs[m.slug] = true; });
  var extraSlugs = openSlugs.filter(function (s) { return !haveSlugs[s]; });
  var extra = [];
  if (extraSlugs.length) {
    console.log('Checking ' + extraSlugs.length + ' off-list open market(s) for resolution...');
    extra = await fetchMarkets(extraSlugs.map(function (s) { return { slug: s, label: s, theme: '', yesOutcome: 'Yes' }; }));
  }

  var allForResolution = marketsData.concat(extra);

  // A closed market settles to ~1/0; treat the YES price as the outcome, and keep
  // an audit trail (source / UMA status / method) so a bad resolution is explainable.
  var resolutions = allForResolution
    .filter(function (m) { return m.closed; })
    .map(function (m) {
      return {
        slug: m.slug, outcome: m.impliedYes >= 0.5 ? 1 : 0, resolvedDate: dateKey,
        resolutionSource: m.resolutionSource || '',
        resolutionStatus: m.umaResolutionStatus || '',
        method: 'auto-closed-price', confidence: 1
      };
    });

  // Today's executable price for EVERY open/known market (drives CLV trails).
  var todayPrices = allForResolution.map(function (m) {
    return { slug: m.slug, mid: (m.mid != null ? m.mid : m.impliedYes), asOf: dateKey };
  });

  var todaySnapshots = marketsData
    .filter(function (m) { return m.haircutProb != null; })
    .map(function (m) {
      return { slug: m.slug, label: m.label, theme: m.theme, impliedYes: m.impliedYes,
        mid: m.mid, haircutProb: m.haircutProb, endDate: m.endDate, asOf: dateKey };
    });

  // The forecaster stamp must record what ACTUALLY ran, not what config says:
  // provider, model and base URL are all env-overridable, so a stamp read
  // straight from CONFIG would mislabel every run that overrode them — and a
  // prediction is scored months later, when nobody can reconstruct which it was.
  var effectiveConfig = Object.assign({}, CONFIG, {
    panel: Object.assign({}, CONFIG.panel, {
      model: PANEL_MODEL_LABEL,
      provider: PANEL_PROVIDER,
      webSearch: !IS_COMPATIBLE && CONFIG.panel.webSearch
    })
  });
  var journalBody = buildMiroJournal(priorJournal, todaySnapshots, todayPrices, resolutions, effectiveConfig);
  var journalDoc = Object.assign({ generatedAt: new Date().toISOString(), asOf: dateKey, meta: meta }, journalBody);
  if (DRY_RUN) {
    console.log('--dry-run: NOT writing miro-journal.');
  } else {
    await db.collection(COLL).doc('miro-journal').set(journalDoc);
  }

  var st = journalBody.stats;
  console.log('\n===== miro-journal =====');
  console.log('  open=' + st.nOpen + '  resolved=' + st.nResolved + '  newlyResolved=' + st.newlyResolved +
    '  brierOurs=' + (st.brierOurs == null ? '—' : st.brierOurs) +
    '  brierMarket=' + (st.brierMarket == null ? '—' : st.brierMarket) +
    '  skill=' + (st.skill == null ? '—' : st.skill) +
    '  logLossSkill=' + (st.logLossSkill == null ? '—' : st.logLossSkill) +
    '  meanCLV=' + (st.meanClvTowardPanel == null ? '—' : st.meanClvTowardPanel) + ' (n=' + st.nClv + ')');
  journalBody.caveats.forEach(function (c) { console.log('  caveat: ' + c); });
  console.log(DRY_RUN ? '\n(dry-run — nothing written).' : '\nWrote briefings-bob/miro-journal.');

  // A dry run wrote nothing, so recording it as healthy would be a lie.
  if (!DRY_RUN) {
    await recordRunHealth(db, 'miro', {
      status: 'ok', asOf: dateKey, durationMs: Date.now() - RUN_STARTED
    });
  }
}

main().then(function () {
  process.exit(0);
}).catch(async function (e) {
  console.error('\nrefresh-miro failed:', e.message || e);
  if (_db && !DRY_RUN) {
    await recordRunHealth(_db, 'miro', {
      status: 'failed', stage: STAGE.get(),
      durationMs: Date.now() - RUN_STARTED, message: e.message || String(e)
    });
  }
  process.exit(1);
});
