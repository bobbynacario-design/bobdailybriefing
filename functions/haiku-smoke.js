"use strict";

// Optional paid protocol smoke test. Synthetic material only; no Firestore writes.
// ANTHROPIC_API_KEY must be supplied in the environment. Never print the key.
const assert = require("node:assert/strict");
const Haiku = require("./haiku");
const Ask = require("./ask-daybook");
const Mirror = require("./weekly-mirror");

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY before running the smoke test.");
  const started = Date.now();
  let calls = 0, inputTokens = 0, outputTokens = 0;
  const options = {apiKey, timeoutMs: 120000, onUsage: async (model, usage) => {
    calls++; inputTokens += usage.inputTokens; outputTokens += usage.outputTokens;
  }};
  const raw = await Haiku.mirror({...options, system: Mirror.SYSTEM, schema: Mirror.MIRROR_SCHEMA,
    prompt: 'Read this synthetic week only: on 6 October 2026 I wrote "Finished the repair-cost comparison; a quiet morning helped me focus." No other notes, goals, decisions or previous reads are available. Return the weekly mirror JSON; make the limited evidence clear.'});
  assert.ok(Mirror.cleanMirror(JSON.parse(raw)), "weekly mirror passes existing cleaner");
  for (const missing of [false, true]) {
    const registry = Ask.newRegistry();
    const result = await Haiku.ask({...options, tool: Ask.SEARCH_TOOL, maxLookups: Ask.MAX_LOOKUPS,
      deadline: Date.now() + 180000,
      input: Ask.buildAskInput({question: missing ? "What policy limit did I agree with QBE?" : "When did I agree to send QBE the repair-cost comparison?",
        today: "8 October 2026", accounts: [], thread: [], web: false}),
      lookup: () => Ask.lookupOutput(missing ? [] : [{id: "synthetic-note", source: "Notes", title: "QBE meeting note",
        body: "On 6 October I agreed to send QBE the repair-cost comparison on 9 October 2026.", saved: Date.parse("2026-10-06T01:00:00Z")}], registry)});
    const clean = Ask.cleanAnswer(JSON.parse(result.raw), registry, [], false);
    assert.ok(clean, "saved Ask passes existing cleaner");
    assert.ok(result.lookups >= 1 && result.lookups <= Ask.MAX_LOOKUPS);
    if (missing) { assert.ok(clean.not_found); assert.equal(clean.sources.length, 0); }
    else { assert.equal(clean.sources.length, 1); assert.match(clean.answer, /9 October|October 9|9th October/); }
  }
  console.log(JSON.stringify({passed: true, model: Haiku.MODEL, cases: 3, calls, inputTokens, outputTokens,
    seconds: Math.round((Date.now() - started) / 1000)}));
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
