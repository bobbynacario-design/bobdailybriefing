"use strict";

// LLM usage telemetry for the Functions (CommonJS twin of lib/llm-usage.js).
// Writes token usage to the shared ledger briefings-bob/llm-usage (no uid).
// Never throws — telemetry must not break generation.
//
// The ledger stores TOKENS ONLY; pricing is applied once, in the Help-tab report
// (index.html LLM_PRICING_USD_PER_1K). A per-use fee with no tokens (a web
// search, $10 per 1,000) is its own "<feature>-search|web-search" entry whose
// `calls` counts the uses, recorded with no usage and kept out of byDay, whose
// "calls" are API calls.

const logger = require("firebase-functions/logger");

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function extractUsage(json) {
  const u = (json && json.usage) || {};
  let cached = 0;
  if (u.input_tokens_details && u.input_tokens_details.cached_tokens != null) {
    cached = _num(u.input_tokens_details.cached_tokens);
  } else if (u.cached_tokens != null) {
    cached = _num(u.cached_tokens);
  }
  return {
    inputTokens: _num(u.input_tokens != null ? u.input_tokens : u.inputTokens),
    outputTokens: _num(u.output_tokens != null ? u.output_tokens : u.outputTokens),
    cachedTokens: cached,
  };
}

// The billed web searches in one /v1/responses result. Each search is a
// web_search_call output item, and OpenAI bills the "search" actions; reasoning
// models also emit open_page and find_in_page items while reading the results,
// which the pricing page does not list as calls, so they are not counted. An
// item with no action is counted: it is the older shape of a search.
function webSearchCount(json) {
  const output = json && Array.isArray(json.output) ? json.output : [];
  return output.filter((item) => item && item.type === "web_search_call" &&
    (!item.action || !item.action.type || item.action.type === "search")).length;
}

// `calls` is how many API calls this usage block represents (default 1).
// `opts.perDay === false` keeps a per-use fee out of byDay; such an entry
// passes `usage` as null.
async function recordUsage(db, feature, model, usage, dateKey, calls, opts) {
  try {
    const perDay = !(opts && opts.perDay === false);
    if (!usage && perDay) return;
    usage = usage || {};
    const nCalls = calls == null ? 1 : _num(calls);
    if (nCalls <= 0) return;
    const ref = db.collection("briefings-bob").doc("llm-usage");
    const key = feature + "|" + model;
    const nowIso = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? (snap.data() || {}) : {};
      d.entries = d.entries || {};
      d.byDay = d.byDay || {};
      const e = d.entries[key] || {
        feature, model, calls: 0,
        inputTokens: 0, outputTokens: 0, cachedTokens: 0,
        firstSeen: nowIso, lastSeen: nowIso,
      };
      e.calls += nCalls;
      e.inputTokens += _num(usage.inputTokens);
      e.outputTokens += _num(usage.outputTokens);
      e.cachedTokens += _num(usage.cachedTokens);
      if (usage.cacheWriteTokens) e.cacheWriteTokens = _num(e.cacheWriteTokens) + _num(usage.cacheWriteTokens);
      e.lastSeen = nowIso;
      if (!e.firstSeen) e.firstSeen = nowIso;
      d.entries[key] = e;
      if (dateKey && perDay) {
        const dd = d.byDay[dateKey] || {calls: 0, inputTokens: 0, outputTokens: 0};
        dd.calls += nCalls;
        dd.inputTokens += _num(usage.inputTokens);
        dd.outputTokens += _num(usage.outputTokens);
        d.byDay[dateKey] = dd;
      }
      d.updated = nowIso;
      tx.set(ref, d);
    });
  } catch (err) {
    logger.warn("recordUsage failed", err);
  }
}

// A feature's web searches as their own per-use line: "briefing-search|web-search".
// Zero searches writes nothing.
function recordSearches(db, feature, searches, dateKey) {
  return recordUsage(db, feature + "-search", "web-search", null, dateKey, searches, {perDay: false});
}

module.exports = {extractUsage, webSearchCount, recordUsage, recordSearches};
