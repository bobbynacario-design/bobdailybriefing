// radar/research-catalysts.js
//
// RESEARCH ONLY (radar-research branch, never main). A one-off side-by-side test
// of the catalyst job: today's real radar doc, the same 30 tickers and the same
// six focus names (Taker + Wildcard), run through gpt-5.5 (today's setup) and
// Claude. Writes nothing to Firestore; results go to radar/catalyst-test.json.
//
// What it measures per model: did a usable result come back, how many tickers
// got a catalyst, whether each catalyst's source URL was actually among that
// run's own search results and is recent, the six focus reads, tokens, searches,
// estimated cost and wall time.

import { writeFileSync } from 'fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import Anthropic from '@anthropic-ai/sdk';

var EVENT_TYPES = ['earnings', 'guidance', 'product', 'macro', 'regulatory', 'analyst', 'partnership', 'legal', 'supply', 'none'];
// USD per 1M tokens. Claude: published Anthropic rates (claude-api reference,
// cached 2026-09-25); cache writes at 1.25x input. gpt-5.5: the app's own table.
var RATES = {
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.20, cacheWrite: 2.5, perSearch: 0.01 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.20, cacheWrite: 5, perSearch: 0.01 },
  'gpt-5.5': { in: 5, out: 30, cacheRead: 0.5, cacheWrite: 5, perSearch: null }
};
// Cheapest informative run first, so a script fault costs as little as possible.
// RUN_ONLY (comma-separated labels) re-runs a subset.
var RUNS = [
  { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium' },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low' },
  { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium' },
  { provider: 'openai', model: 'gpt-5.5' }
].filter(function (r) {
  var only = (process.env.RUN_ONLY || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  return !only.length || only.indexOf(r.model + (r.effort ? '@' + r.effort : '')) >= 0;
});

function phtToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// The six names the app would show today: Taker Nuggets (3) and Wildcard Upside (3),
// ported from index.html with no filter applied.
function focusNames(signals) {
  function upside(s) { return s.entry > 0 && s.target != null ? (s.target - s.entry) / s.entry * 100 : null; }
  function takerRank(s) {
    var rs = s.relStrength20d, lead = rs == null ? 0 : (rs >= 0 ? Math.min(rs, 12) * 0.5 : rs * 0.4);
    return (s.score || 0) + (s.status === 'confirmed' ? 6 : 0) + lead;
  }
  var taker = signals.filter(function (s) { return s.status !== 'invalidated' && s.score >= 58; })
    .sort(function (a, b) { return takerRank(b) - takerRank(a); }).slice(0, 3);
  var tk = {}; taker.forEach(function (s) { tk[s.symbol] = true; });
  var ups = signals.filter(function (s) { return s.status !== 'invalidated' && upside(s) != null; }).map(upside).sort(function (a, b) { return a - b; });
  var mid = Math.floor(ups.length / 2), med = !ups.length ? 0 : ups.length % 2 ? ups[mid] : (ups[mid - 1] + ups[mid]) / 2;
  var floor = Math.max(2.5, med * 0.6);
  var elig = signals.filter(function (s) {
    return s.status === 'forming' && s.early === true && !tk[s.symbol] && upside(s) != null && upside(s) >= floor && s.score >= 42;
  });
  var standout = elig.reduce(function (b, s) { return b === null || upside(s) > upside(b) ? s : b; }, null);
  var wild = standout ? [standout] : [];
  elig.slice().sort(function (a, b) { return b.score - a.score; }).forEach(function (s) { if (wild.length < 3 && s !== standout) wild.push(s); });
  return taker.concat(wild);
}

function buildPrompt(signals, focus, today) {
  var list = signals.map(function (s) {
    return s.symbol + ' (' + s.theme + ', ' + s.status + ', 20d vs ' + s.benchmark + ': ' + (s.relStrength20d == null ? 'n/a' : s.relStrength20d) + ' pts)';
  }).join('\n');
  var fl = focus.map(function (s) {
    return s.symbol + ' — radar: ' + s.why + ' Stop level ' + s.stop + '.';
  }).join('\n');
  return 'Today is ' + today + ' (Manila). You are tagging market catalysts for a personal daily market radar.\n\n' +
    'PART 1. For EACH ticker below, search recent news (the last 7 days) and identify the single most relevant catalyst ' +
    'or news item currently driving it.\n' +
    '- catalyst: one factual plain sentence, at most 140 characters. No advice, no "buy"/"sell"/"should", no price targets. ' +
    'If nothing material is found, use "".\n' +
    '- eventType: one of ' + EVENT_TYPES.join(' | ') + '.\n' +
    '- date: the news date as YYYY-MM-DD, or "" if unknown.\n' +
    '- sourceUrl: the URL of the article you took it from, exactly as it appeared in your search results; "" if none.\n\n' +
    'PART 2. For each of these six focus names, write a short read grounded in what you found:\n' +
    '- why: at most two sentences on why it is moving.\n' +
    '- wouldBreak: one sentence on the specific development, or the radar stop level, that would undercut the move.\n' +
    '- sourceUrls: one to three URLs from your search results that support it.\n\n' +
    'Be efficient with searches: one search can cover several related tickers (for example the semiconductor names together).\n\n' +
    'Tickers (crypto symbols are the coins themselves):\n' + list + '\n\nFocus names:\n' + fl;
}

var SAVE_TOOL = {
  name: 'save_catalysts',
  description: 'Save the finished results: one catalyst per ticker (Part 1) and one read per focus name (Part 2). Call it exactly once, after searching.',
  strict: true,
  input_schema: {
    type: 'object', additionalProperties: false, required: ['catalysts', 'reads'],
    properties: {
      catalysts: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['symbol', 'catalyst', 'eventType', 'date', 'sourceUrl'],
        properties: { symbol: { type: 'string' }, catalyst: { type: 'string' }, eventType: { type: 'string', enum: EVENT_TYPES },
          date: { type: 'string' }, sourceUrl: { type: 'string' } } } },
      reads: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['symbol', 'why', 'wouldBreak', 'sourceUrls'],
        properties: { symbol: { type: 'string' }, why: { type: 'string' }, wouldBreak: { type: 'string' },
          sourceUrls: { type: 'array', items: { type: 'string' } } } } }
    }
  }
};
var SYSTEM = 'You produce factual, concise market catalyst tags for a personal radar. Never give financial advice.';

// Every URL the run's searching exposed: search result blocks (with title and
// age), citations on text blocks, and any URL in the filtering code's output
// (dynamic filtering reads results through code, so URLs can sit in stdout).
// The model's own save_catalysts input is excluded: that is what gets checked.
function collectSeen(blocks, seen) {
  (blocks || []).forEach(function (b) {
    if (!b || b.type === 'thinking' || (b.type === 'tool_use' && b.name === 'save_catalysts')) return;
    var raw = JSON.stringify(b.type === 'text' ? (b.citations || []) : b);
    var re = /"url":"(https?:[^"]+)"(?:,"title":"([^"]*)")?(?:[^{}]*?"page_age":"([^"]*)")?/g, m;
    while ((m = re.exec(raw))) if (!seen[m[1]]) seen[m[1]] = { title: m[2] || '', age: m[3] || '' };
    if (b.type === 'text') return;
    var loose = /https?:\/\/[^\s"'\\<>)\]]+/g;
    while ((m = loose.exec(raw))) if (!seen[m[0]]) seen[m[0]] = { title: '', age: '' };
  });
}

async function runClaude(run, prompt) {
  var client = new Anthropic();
  var messages = [{ role: 'user', content: prompt }];
  var u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 }, seen = {}, stops = [], served = [];
  var result = null, nudged = false;
  for (var turn = 0; turn < 10 && !result; turn++) {
    var stream = client.beta.messages.stream({
      model: run.model, max_tokens: 32000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: run.effort }, cache_control: { type: 'ephemeral' },
      system: SYSTEM, tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 25 }, SAVE_TOOL], messages: messages
    });
    var msg = await stream.finalMessage();
    stops.push(msg.stop_reason); served.push(msg.model);
    var us = msg.usage || {};
    u.input += us.input_tokens || 0; u.output += us.output_tokens || 0;
    u.cacheRead += us.cache_read_input_tokens || 0; u.cacheWrite += us.cache_creation_input_tokens || 0;
    u.searches += (us.server_tool_use && us.server_tool_use.web_search_requests) || 0;
    collectSeen(msg.content, seen);
    if (msg.stop_reason === 'refusal') break;
    var save = msg.content.find(function (b) { return b.type === 'tool_use' && b.name === 'save_catalysts'; });
    if (save) { result = save.input; break; }
    if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: msg.content }); continue; }
    if (msg.stop_reason === 'end_turn' && !nudged) {
      nudged = true;
      messages.push({ role: 'assistant', content: msg.content });
      messages.push({ role: 'user', content: 'Now call save_catalysts once with everything.' });
      continue;
    }
    break;
  }
  return { result: result, usage: u, seen: seen, stops: stops, served: served };
}

function parseLooseJson(raw) {
  var s = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
}

async function runOpenAI(run, prompt) {
  var body = {
    model: run.model,
    input: [
      { role: 'system', content: SYSTEM + ' Return strict JSON only.' },
      { role: 'user', content: prompt + '\n\nReturn STRICT JSON only: {"catalysts":[{"symbol","catalyst","eventType","date","sourceUrl"}],' +
        '"reads":[{"symbol","why","wouldBreak","sourceUrls"}]}. No prose, no code fences.' }
    ],
    tools: [{ type: 'web_search', search_context_size: 'low' }], tool_choice: 'auto'
  };
  var res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal: AbortSignal.timeout(600000),
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  var text = await res.text();
  if (!res.ok) throw new Error('OpenAI ' + res.status + ': ' + text.slice(0, 300));
  var json = JSON.parse(text), seen = {};
  var out = json.output || [];
  var outText = json.output_text || out.map(function (i) { return (i.content || []).map(function (c) { return c.text || ''; }).join(''); }).join('\n');
  // Sources the run exposed: any URL outside the final JSON text (search calls, citations).
  out.forEach(function (i) {
    var raw = JSON.stringify(i.type === 'message' ? (i.content || []).map(function (c) { return c.annotations || []; }) : i), re = /"url":"(https?:[^"]+)"(?:,"title":"([^"]*)")?/g, m;
    while ((m = re.exec(raw))) if (!seen[m[1]]) seen[m[1]] = { title: m[2] || '', age: '' };
  });
  var us = json.usage || {};
  return {
    result: parseLooseJson(outText),
    usage: { input: us.input_tokens || 0, output: us.output_tokens || 0, cacheRead: (us.input_tokens_details && us.input_tokens_details.cached_tokens) || 0,
      cacheWrite: 0, searches: out.filter(function (i) { return i.type === 'web_search_call'; }).length },
    seen: seen, stops: [json.status || ''], served: [json.model || run.model]
  };
}

function cost(model, u) {
  var r = RATES[model];
  if (!r) return null;
  // Anthropic reports uncached, cache-read and cache-write input separately;
  // OpenAI's cached tokens are a subset of input_tokens.
  var tokens = model.indexOf('claude') === 0
    ? (u.input * r.in + u.cacheRead * r.cacheRead + u.cacheWrite * r.cacheWrite + u.output * r.out) / 1e6
    : ((u.input - u.cacheRead) * r.in + u.cacheRead * r.cacheRead + u.output * r.out) / 1e6;
  return { tokens: Math.round(tokens * 1000) / 1000, searches: r.perSearch == null ? null : Math.round(u.searches * r.perSearch * 1000) / 1000 };
}

function grade(out, signals, focus, today) {
  var syms = signals.map(function (s) { return s.symbol; });
  var cats = (out.result && out.result.catalysts) || [];
  var by = {}; cats.forEach(function (c) { if (c && c.symbol) by[String(c.symbol).toUpperCase()] = c; });
  var weekAgo = new Date(Date.parse(today + 'T00:00:00Z') - 8 * 86400000).toISOString().slice(0, 10);
  var g = { tickersReturned: 0, withCatalyst: 0, withUrl: 0, urlSeenInSearch: 0, datedWithin7d: 0, longerThan140: 0, invalidEventType: 0, missing: [] };
  syms.forEach(function (s) {
    var c = by[s];
    if (!c) { g.missing.push(s); return; }
    g.tickersReturned++;
    if (!c.catalyst) return;
    g.withCatalyst++;
    if (c.catalyst.length > 140) g.longerThan140++;
    if (EVENT_TYPES.indexOf(c.eventType) < 0) g.invalidEventType++;
    if (c.sourceUrl) { g.withUrl++; if (out.seen[c.sourceUrl]) g.urlSeenInSearch++; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(c.date || '') && c.date >= weekAgo && c.date <= today) g.datedWithin7d++;
  });
  var reads = (out.result && out.result.reads) || [];
  g.reads = reads.length;
  g.readsWithSeenSource = reads.filter(function (r) { return (r.sourceUrls || []).some(function (u) { return out.seen[u]; }); }).length;
  g.focusCovered = focus.filter(function (f) { return reads.some(function (r) { return String(r.symbol).toUpperCase() === f.symbol; }); }).length;
  return g;
}

async function main() {
  initializeApp({ credential: applicationDefault(), projectId: 'pokerhq-a67e4' });
  var db = getFirestore();
  var latest = (await db.doc('briefings-bob/radar-latest').get()).data().value;
  var doc = (await db.doc('briefings-bob/radar-' + latest).get()).data();
  var signals = doc.signals, focus = focusNames(signals), today = phtToday();
  var prompt = buildPrompt(signals, focus, today);
  console.log('radar-' + latest + ' asOf ' + doc.asOf + ' | ' + signals.length + ' tickers | focus: ' + focus.map(function (s) { return s.symbol; }).join(' '));
  var report = { today: today, radarDoc: 'radar-' + latest, focus: focus.map(function (s) { return s.symbol; }), runs: [] };
  for (var i = 0; i < RUNS.length; i++) {
    var run = RUNS[i], label = run.model + (run.effort ? ' @' + run.effort : ''), t0 = Date.now(), entry = { label: label };
    try {
      var out = run.provider === 'anthropic' ? await runClaude(run, prompt) : await runOpenAI(run, prompt);
      entry.seconds = Math.round((Date.now() - t0) / 1000);
      entry.usage = out.usage; entry.cost = cost(run.model, out.usage); entry.stops = out.stops; entry.served = out.served;
      entry.grade = grade(out, signals, focus, today);
      entry.result = out.result;
      entry.seen = out.seen;
    } catch (e) {
      entry.seconds = Math.round((Date.now() - t0) / 1000);
      entry.error = String(e && e.message || e).slice(0, 400);
    }
    report.runs.push(entry);
    console.log('\n=== ' + label + ' (' + entry.seconds + 's) ===');
    if (entry.error) { console.log('ERROR ' + entry.error); continue; }
    console.log('stops ' + entry.stops.join(',') + ' | served ' + Array.from(new Set(entry.served)).join(','));
    console.log('usage ' + JSON.stringify(entry.usage) + ' | cost ' + JSON.stringify(entry.cost));
    console.log('grade ' + JSON.stringify(entry.grade));
  }
  writeFileSync(new URL('./catalyst-test.json', import.meta.url), JSON.stringify(report, null, 1));
}

main().catch(function (e) { console.error('catalyst test failed: ' + (e.message || e)); process.exit(1); });
