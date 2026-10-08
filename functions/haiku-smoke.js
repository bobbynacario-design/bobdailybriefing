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
    const question = missing ? "What policy limit did I agree with QBE?" : "When did I agree to send QBE the repair-cost comparison?";
    const registry = Ask.newRegistry();
    const result = await Haiku.ask({...options, tool: Ask.SEARCH_TOOL, maxLookups: Ask.MAX_LOOKUPS,
      deadline: Date.now() + 180000,
      input: Ask.buildAskInput({question,
        today: "8 October 2026", accounts: [], thread: [], web: false}),
      lookup: () => Ask.lookupOutput(missing ? [] : [{id: "synthetic-note", source: "Notes", title: "QBE meeting note",
        body: "On 6 October I agreed to send QBE the repair-cost comparison on 9 October 2026.", saved: Date.parse("2026-10-06T01:00:00Z")}], registry)});
    const checked = await Ask.refineAnswer({raw: result.raw, revise: result.revise, question, registry, searched: [], web: false});
    const clean = Ask.cleanAnswer(JSON.parse(checked), registry, [], false, question);
    assert.ok(clean, "saved Ask passes existing cleaner");
    assert.ok(result.lookups >= 1 && result.lookups <= Ask.MAX_LOOKUPS);
    if (missing) { assert.ok(clean.not_found); assert.equal(clean.sources.length, 0); }
    else { assert.equal(clean.sources.length, 1); assert.match(clean.answer, /9 October|October 9|9th October/); }
  }
  const syntheticProfile = [
    {id: "work", title: "Your work", body: "I assess business-interruption and property damage claims for insurers."},
    {id: "values", title: "What matters to you", body: "I value clear evidence, straightforward explanations and time with my family."},
    {id: "other", title: "Outside work", body: "I enjoy cooking and gardening."},
  ].map(item => ({...item, source: "Profile"}));
  const questions = ["Describe me in 1 sentence", "Describe my work in one sentence", "Describe me beyond work in one sentence",
    "Describe me in three bullets", "Describe my work in under 20 words"];
  for (const question of questions) {
    const registry = Ask.newRegistry();
    const result = await Haiku.ask({...options, tool: Ask.SEARCH_TOOL, maxLookups: Ask.MAX_LOOKUPS, deadline: Date.now() + 180000,
      input: Ask.buildAskInput({question, today: "8 October 2026", accounts: [], thread: [], web: false}),
      lookup: () => Ask.lookupOutput(syntheticProfile, registry)});
    const checked = await Ask.refineAnswer({raw: result.raw, revise: result.revise, question, registry, searched: [], web: false});
    const clean = Ask.cleanAnswer(JSON.parse(checked), registry, [], false, question);
    assert.deepEqual(Ask.reviewAnswer(checked, {question, registry, searched: [], web: false}).problems, [], question);
    assert.ok(clean.sources.length, "profile answer retains its sources");
    assert.deepEqual(clean.follow_ups, [], "focused requests have no unsolicited follow-ups");
    if (question.includes("beyond work")) assert.match(clean.answer, /cooking|gardening|family/i);
    if (question.includes("my work")) assert.doesNotMatch(clean.answer, /cooking|gardening/i);
    console.log(JSON.stringify({question, syntheticAnswer: clean.answer}));
  }
  console.log(JSON.stringify({passed: true, model: Haiku.MODEL, cases: 8, calls, inputTokens, outputTokens,
    seconds: Math.round((Date.now() - started) / 1000)}));
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
