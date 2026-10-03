// radar/catalysts.js
//
// Catalyst tagging and the focus reads ("explain the moves"), on Claude.
// Display-only: nothing here touches the score or the status.
//
// One call per radar run. Claude searches the web (server-side web_search with
// dynamic filtering) and hands everything back through a strict save_catalysts
// tool: JSON output mode cannot be combined with the citations web search
// carries, and a strict tool still guarantees the schema.
//
// Why Claude Opus 5.5 at medium effort (side-by-side on the live radar,
// 2026-10-03, research branch radar-research): a sourced, dated catalyst for
// 27 of 30 names and six grounded reads for about $0.62 a run (tokens + 25
// searches), against 16 and 9 names for Claude Sonnet 5.5 at medium and low.
// The OpenAI call it replaces had timed out on every run since 2026-08-12 (a
// 20-second limit on a multi-minute search), so the radar showed no catalysts.
//
// Guard against invented news: a catalyst is kept only when its source URL
// appeared in this run's own search results, and a read keeps only such URLs
// (and is dropped without one).

import Anthropic from '@anthropic-ai/sdk';

var EVENT_TYPES = ['earnings', 'guidance', 'product', 'macro', 'regulatory', 'analyst', 'partnership', 'legal', 'supply', 'none'];
var DEFAULT_MODEL = 'claude-opus-5-5';
var MAX_SEARCHES = 25;
var MAX_TURNS = 10;
// The whole step's budget. A healthy run takes about 2.5 minutes; the GitHub
// job is killed at 20, and a hung call must never cost the day's radar.
var DEADLINE_MS = 8 * 60 * 1000;
var SYSTEM = 'You produce factual, concise market catalyst tags for a personal radar. Never give financial advice.';

// The names the Radar shows first: Taker Nuggets (3) and Wildcard Upside (3)
// with no filter applied. Ported from index.html (radarTakerRank,
// renderRadarTakerNuggets, radarWildcardFloor, renderRadarWildcards); keep the
// two in step. A filtered view that surfaces other names shows their one-line
// catalyst without a read.
function upsidePct(s) {
  return s && s.entry > 0 && s.target != null ? (s.target - s.entry) / s.entry * 100 : null;
}
function focusNames(signals) {
  signals = signals || [];
  function takerRank(s) {
    var rs = s.relStrength20d, lead = rs == null ? 0 : (rs >= 0 ? Math.min(rs, 12) * 0.5 : rs * 0.4);
    return (s.score || 0) + (s.status === 'confirmed' ? 6 : 0) + lead;
  }
  var taker = signals.filter(function (s) { return s.status !== 'invalidated' && s.score >= 58; })
    .sort(function (a, b) { return takerRank(b) - takerRank(a); }).slice(0, 3);
  var taken = {};
  taker.forEach(function (s) { taken[s.symbol] = true; });
  var ups = signals.filter(function (s) { return s.status !== 'invalidated' && upsidePct(s) != null; })
    .map(upsidePct).sort(function (a, b) { return a - b; });
  var mid = Math.floor(ups.length / 2);
  var med = !ups.length ? 0 : ups.length % 2 ? ups[mid] : (ups[mid - 1] + ups[mid]) / 2;
  var floor = Math.max(2.5, med * 0.6);
  var eligible = signals.filter(function (s) {
    var u = upsidePct(s);
    return s.status === 'forming' && s.early === true && !taken[s.symbol] && u != null && u >= floor && (s.score || 0) >= 42;
  });
  var standout = eligible.reduce(function (b, s) { return b === null || upsidePct(s) > upsidePct(b) ? s : b; }, null);
  var wild = standout ? [standout] : [];
  eligible.slice().sort(function (a, b) { return b.score - a.score; }).forEach(function (s) {
    if (wild.length < 3 && s !== standout) wild.push(s);
  });
  return taker.concat(wild);
}

function buildPrompt(signals, focus, today) {
  var list = (signals || []).map(function (s) {
    return s.symbol + ' (' + s.theme + ', ' + s.status + ', 20d vs ' + s.benchmark + ': ' +
      (s.relStrength20d == null ? 'n/a' : s.relStrength20d) + ' pts)';
  }).join('\n');
  var fl = (focus || []).map(function (s) {
    return s.symbol + ' (radar: ' + s.why + ' Stop level ' + s.stop + '.)';
  }).join('\n');
  return 'Today is ' + today + ' (Manila). You are tagging market catalysts for a personal daily market radar.\n\n' +
    'PART 1. For EACH ticker below, search recent news (the last 7 days) and identify the single most relevant catalyst ' +
    'currently driving it. A catalyst is a specific event or piece of news: a deal, results, guidance, a rating change, ' +
    'a product, a legal or policy decision, or a macro release. A description of the price move, a valuation, or a preview ' +
    'of something still to come is not a catalyst.\n' +
    '- catalyst: one factual plain sentence, at most 140 characters. No advice, no "buy"/"sell"/"should", no price targets ' +
    'of your own. If you find no catalyst, use "".\n' +
    '- eventType: one of ' + EVENT_TYPES.join(' | ') + '.\n' +
    '- date: the news date as YYYY-MM-DD, or "" if unknown.\n' +
    '- sourceUrl: the URL of the article you took it from, exactly as it appeared in your search results; "" if none.\n\n' +
    'PART 2. For each focus name, write a short read grounded in what you found:\n' +
    '- why: at most two sentences on why it is moving.\n' +
    '- wouldBreak: one sentence on the specific development, or the radar stop level, that would undercut the move.\n' +
    '- sourceUrls: one to three URLs from your search results that support it.\n\n' +
    'Be efficient with searches: one search can cover several related tickers (for example the semiconductor names ' +
    'together). When you are done, call save_catalysts once with everything.\n\n' +
    'Tickers (crypto symbols are the coins themselves):\n' + list + '\n\nFocus names:\n' + fl;
}

var SAVE_TOOL = {
  name: 'save_catalysts',
  description: 'Save the finished results: one catalyst per ticker (Part 1) and one read per focus name (Part 2). Call it exactly once, after searching.',
  strict: true,
  input_schema: {
    type: 'object', additionalProperties: false, required: ['catalysts', 'reads'],
    properties: {
      catalysts: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['symbol', 'catalyst', 'eventType', 'date', 'sourceUrl'],
          properties: {
            symbol: { type: 'string' }, catalyst: { type: 'string' },
            eventType: { type: 'string', enum: EVENT_TYPES },
            date: { type: 'string' }, sourceUrl: { type: 'string' }
          }
        }
      },
      reads: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['symbol', 'why', 'wouldBreak', 'sourceUrls'],
          properties: {
            symbol: { type: 'string' }, why: { type: 'string' }, wouldBreak: { type: 'string' },
            sourceUrls: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  }
};

// Every URL this run's searching exposed, url -> {title, age}: search result
// blocks, citations on text blocks, and any URL in the output of the code that
// dynamic filtering runs over the results. The model's own save_catalysts
// input is never read here, since that is what gets checked against it.
function collectSources(blocks, seen) {
  (blocks || []).forEach(function (b) {
    if (!b || b.type === 'thinking') return;
    if (b.type === 'tool_use' && b.name === 'save_catalysts') return;
    if (b.type === 'text') {
      (b.citations || []).forEach(function (c) {
        if (c && /^https?:\/\//.test(c.url || '') && !seen[c.url]) seen[c.url] = { title: c.title || '', age: '' };
      });
      return;
    }
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      b.content.forEach(function (r) {
        if (r && /^https?:\/\//.test(r.url || '')) {
          var prev = seen[r.url];
          seen[r.url] = { title: r.title || (prev && prev.title) || '', age: r.page_age || (prev && prev.age) || '' };
        }
      });
      return;
    }
    if (b.type === 'server_tool_use' || b.type === 'tool_use') return;   // the model's own queries and code
    var raw = JSON.stringify(b), re = /https?:\/\/[^\s"'\\<>)\]]+/g, m;
    while ((m = re.exec(raw))) if (!seen[m[0]]) seen[m[0]] = { title: '', age: '' };
  });
  return seen;
}

// Runs the call to completion: resumes a paused server-side search loop,
// nudges once if the model ends without saving, stops on a refusal. `client`
// is injected so the loop can be tested without the network. If a turn throws,
// the error carries `usage` so turns already billed still reach the ledger.
async function runCatalystCall(client, opts) {
  var messages = [{ role: 'user', content: opts.prompt }];
  var usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, calls: 0 };
  var seen = {}, stops = [], served = [], saved = null, nudged = false;
  for (var turn = 0; turn < MAX_TURNS && !saved; turn++) {
    var msg;
    try {
      msg = await client.beta.messages.stream({
        model: opts.model,
        max_tokens: 32000,
        // A declined request is re-run on another Claude model server-side.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: opts.effort },
        cache_control: { type: 'ephemeral' },
        system: SYSTEM,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES }, SAVE_TOOL],
        messages: messages
      }, { signal: opts.signal }).finalMessage();
    } catch (e) {
      if (e && typeof e === 'object') e.usage = usage;
      throw e;
    }
    usage.calls++;
    stops.push(msg.stop_reason);
    served.push(msg.model);
    var u = msg.usage || {};
    usage.input += u.input_tokens || 0;
    usage.output += u.output_tokens || 0;
    usage.cacheRead += u.cache_read_input_tokens || 0;
    usage.cacheWrite += u.cache_creation_input_tokens || 0;
    usage.searches += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
    collectSources(msg.content, seen);
    if (msg.stop_reason === 'refusal') break;
    var save = (msg.content || []).find(function (b) { return b.type === 'tool_use' && b.name === 'save_catalysts'; });
    // A tool input cut off at max_tokens can still parse; never trust it.
    if (save && msg.stop_reason !== 'max_tokens') { saved = save.input; break; }
    if (msg.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: msg.content });
      continue;
    }
    if (msg.stop_reason === 'end_turn' && !nudged) {
      nudged = true;
      messages.push({ role: 'assistant', content: msg.content });
      messages.push({ role: 'user', content: 'Now call save_catalysts once with everything.' });
      continue;
    }
    break;
  }
  return { saved: saved, seen: seen, usage: usage, stops: stops, served: served };
}

function sourceLabel(url, seen) {
  var s = seen[url];
  if (s && s.title) return s.title.slice(0, 120);
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

// Writes the kept results onto the signals and reports what was dropped.
// Every signal ends with the same catalyst fields, so the app never has to
// tell "not tagged" apart from "tagging failed" by the shape of the doc.
function applyCatalysts(signals, saved, seen, focus) {
  var bySym = {}, reads = {};
  ((saved && saved.catalysts) || []).forEach(function (c) {
    if (c && c.symbol) bySym[String(c.symbol).toUpperCase()] = c;
  });
  ((saved && saved.reads) || []).forEach(function (r) {
    if (r && r.symbol) reads[String(r.symbol).toUpperCase()] = r;
  });
  var focusSet = {};
  (focus || []).forEach(function (s) { focusSet[s.symbol] = true; });
  var stats = { tagged: 0, unsourced: 0, reads: 0, readsUnsourced: 0 };
  (signals || []).forEach(function (s) {
    var c = bySym[s.symbol];
    s.catalyst = ''; s.eventType = 'none'; s.catalystAsOf = ''; s.catalystUrl = ''; s.catalystSource = '';
    delete s.read;
    if (c && c.catalyst) {
      if (c.sourceUrl && seen[c.sourceUrl]) {
        s.catalyst = String(c.catalyst).slice(0, 200);
        s.eventType = EVENT_TYPES.indexOf(c.eventType) >= 0 ? c.eventType : 'none';
        s.catalystAsOf = /^\d{4}-\d{2}-\d{2}$/.test(c.date || '') ? c.date : '';
        s.catalystUrl = c.sourceUrl;
        s.catalystSource = sourceLabel(c.sourceUrl, seen);
        stats.tagged++;
      } else {
        stats.unsourced++;
      }
    }
    var r = focusSet[s.symbol] && reads[s.symbol];
    if (r && r.why) {
      var urls = (r.sourceUrls || []).filter(function (u) { return seen[u]; }).slice(0, 3);
      if (urls.length) {
        s.read = {
          why: String(r.why).slice(0, 400),
          wouldBreak: String(r.wouldBreak || '').slice(0, 300),
          sources: urls.map(function (u) { return { url: u, title: sourceLabel(u, seen) }; })
        };
        stats.reads++;
      } else {
        stats.readsUnsourced++;
      }
    }
  });
  return stats;
}

// The ledger's shape is OpenAI's: cached tokens are a subset of input. Claude
// reports uncached input, cache reads and cache writes separately, so fold
// them back together; cache writes ride along as their own subset so the Help
// tab can charge their premium over the input rate.
function usageForLedger(u) {
  return {
    inputTokens: (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0),
    outputTokens: u.output || 0,
    cachedTokens: u.cacheRead || 0,
    cacheWriteTokens: u.cacheWrite || 0
  };
}

// The whole step. Never throws: the radar still writes its signals (with empty
// catalyst fields) when tagging fails, and says why in `result.error`.
async function tagCatalysts(opts) {
  var started = Date.now();
  var model = opts.model || DEFAULT_MODEL;
  var effort = opts.effort || 'medium';
  var focus = focusNames(opts.signals);
  var result = { model: model, effort: effort, focus: focus.map(function (s) { return s.symbol; }), stats: null, usage: null, error: '' };
  var deadline = new AbortController();
  var timer = setTimeout(function () { deadline.abort(); }, opts.deadlineMs || DEADLINE_MS);
  try {
    if (!opts.client && !opts.apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    // The SDK retries 408/409/429/5xx and connection errors itself; the
    // timeout covers a long search turn on the streamed request.
    var client = opts.client || new Anthropic({ apiKey: opts.apiKey, timeout: 10 * 60 * 1000, maxRetries: 2 });
    var out = await runCatalystCall(client, {
      model: model, effort: effort, prompt: buildPrompt(opts.signals, focus, opts.today),
      signal: deadline.signal
    });
    result.usage = out.usage;
    result.stops = out.stops;
    result.served = out.served;
    if (!out.saved) throw new Error('no results saved (stops: ' + out.stops.join(',') + ')');
    result.stats = applyCatalysts(opts.signals, out.saved, out.seen, focus);
  } catch (e) {
    if (e && e.usage && e.usage.calls) result.usage = e.usage;
    result.error = deadline.signal.aborted
      ? 'no answer within ' + Math.round((opts.deadlineMs || DEADLINE_MS) / 60000) + ' minutes'
      : String((e && e.message) || e).slice(0, 300);
    applyCatalysts(opts.signals, null, {}, []);
  } finally {
    clearTimeout(timer);
  }
  result.seconds = Math.round((Date.now() - started) / 1000);
  return result;
}

export {
  tagCatalysts, focusNames, buildPrompt, collectSources, runCatalystCall, applyCatalysts,
  usageForLedger, SAVE_TOOL, EVENT_TYPES, DEFAULT_MODEL
};
