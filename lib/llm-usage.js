// lib/llm-usage.js
//
// Shared LLM usage recorder for the local refresh scripts (radar, miro). The only
// I/O is a Firestore transaction on the single ledger doc briefings-bob/llm-usage.
// Telemetry must NEVER break a feature, so recordUsage swallows all errors.
//
// The ledger stores TOKENS ONLY (no cost) — pricing is applied once, in the
// Help-tab report (index.html), so there is a single rate table. Shape:
//   { updated, entries: { "<feature>|<model>": { feature, model, calls,
//       inputTokens, outputTokens, cachedTokens, firstSeen, lastSeen } },
//     byDay: { "YYYY-MM-DD": { calls, inputTokens, outputTokens } } }
//
// ESM module — imported by radar/miro via `../lib/llm-usage.js`. The Cloud
// Function (CommonJS) carries its own tiny copy of this logic.

function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

// Normalize the OpenAI /v1/responses usage block (tolerant of missing fields and
// of the snake_case API shape vs a pre-normalized camelCase one).
function extractUsage(json) {
  var u = (json && json.usage) || {};
  var inTok = num(u.input_tokens != null ? u.input_tokens : u.inputTokens);
  var outTok = num(u.output_tokens != null ? u.output_tokens : u.outputTokens);
  var cached = 0;
  if (u.input_tokens_details && u.input_tokens_details.cached_tokens != null) {
    cached = num(u.input_tokens_details.cached_tokens);
  } else if (u.cached_tokens != null) {
    cached = num(u.cached_tokens);
  } else if (u.inputTokensDetails && u.inputTokensDetails.cachedTokens != null) {
    cached = num(u.inputTokensDetails.cachedTokens);
  }
  return { inputTokens: inTok, outputTokens: outTok, cachedTokens: cached };
}

// Sum two usage objects (used to fold the miro panel's N persona calls into one).
function addUsage(a, b) {
  a = a || {}; b = b || {};
  return {
    inputTokens: num(a.inputTokens) + num(b.inputTokens),
    outputTokens: num(a.outputTokens) + num(b.outputTokens),
    cachedTokens: num(a.cachedTokens) + num(b.cachedTokens)
  };
}

// Record usage into briefings-bob/llm-usage. `calls` is how many API calls this
// usage block represents (miro folds its persona calls — currently 5 — into one
// record). Uses a
// transaction so concurrent radar/miro runs don't clobber each other. No-throw.
async function recordUsage(db, feature, model, usage, dateKey, calls) {
  try {
    if (!usage) return;
    var nCalls = (calls == null) ? 1 : calls;
    if (nCalls <= 0) return;
    var ref = db.collection('briefings-bob').doc('llm-usage');
    var key = feature + '|' + model;
    var nowIso = new Date().toISOString();
    await db.runTransaction(async function (tx) {
      var snap = await tx.get(ref);
      var d = snap.exists ? (snap.data() || {}) : {};
      d.entries = d.entries || {};
      d.byDay = d.byDay || {};
      var e = d.entries[key] || {
        feature: feature, model: model, calls: 0,
        inputTokens: 0, outputTokens: 0, cachedTokens: 0,
        firstSeen: nowIso, lastSeen: nowIso
      };
      e.calls += nCalls;
      e.inputTokens += num(usage.inputTokens);
      e.outputTokens += num(usage.outputTokens);
      e.cachedTokens += num(usage.cachedTokens);
      e.lastSeen = nowIso;
      if (!e.firstSeen) e.firstSeen = nowIso;
      d.entries[key] = e;
      if (dateKey) {
        var dd = d.byDay[dateKey] || { calls: 0, inputTokens: 0, outputTokens: 0 };
        dd.calls += nCalls;
        dd.inputTokens += num(usage.inputTokens);
        dd.outputTokens += num(usage.outputTokens);
        d.byDay[dateKey] = dd;
      }
      d.updated = nowIso;
      tx.set(ref, d);
    });
    console.log('recorded LLM usage: ' + key + ' (+' + nCalls + ' call' + (nCalls === 1 ? '' : 's') +
      ', in ' + num(usage.inputTokens) + ' / out ' + num(usage.outputTokens) + ')');
  } catch (e) {
    console.log('recordUsage failed (' + (e.message || e) + ') — usage not recorded.');
  }
}

export { extractUsage, addUsage, recordUsage };
