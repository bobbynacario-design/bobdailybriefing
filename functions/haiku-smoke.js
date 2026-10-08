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
    assert.doesNotMatch(clean.answer, /QBE|Allianz|Philippine|third-party|first-party/i, "no background biography beyond the synthetic lookup evidence");
    console.log(JSON.stringify({question, syntheticAnswer: clean.answer}));
  }
  const selectionCases = [
    {question: "Describe me in 1 sentence", records: [
      {id: "role", source: "Profile", title: "Your work", body: "I am a forensic business-interruption and claims-quantum specialist working for Australian insurers and solicitors, and Philippine consulting firms."},
      {id: "files", source: "Profile", title: "Your clients and files", body: "I mainly work for QBE and Allianz. My files include third-party property damage, heavy-vehicle loss of income and small-business interruption claims."},
      {id: "aim", source: "Profile", title: "Anything else", body: "I want to use AI to improve my productivity and income."},
    ], check: answer => { assert.doesNotMatch(answer, /QBE|Allianz|third-party|heavy-vehicle|small-business/i); assert.match(answer, /AI/); }},
    {question: "Describe my work in one sentence, including my client names", records: [
      {id: "role", source: "Profile", title: "Your work", body: "I assess insurance claims for QBE and Allianz."},
    ], check: answer => { assert.match(answer, /QBE/); assert.match(answer, /Allianz/); }},
    {question: "What changed in the repair estimate?", records: [
      {id: "old", source: "Reflections", title: "6 October estimate", body: "The repair estimate is $12,000."},
      {id: "new", source: "Reflections", title: "8 October estimate", body: "The repair estimate is now $15,000. No reason for the increase is recorded."},
    ], check: answer => { assert.match(answer, /15,?000|15k/i); assert.match(answer, /3,?000|3k|25%/i); assert.doesNotMatch(answer, /inflation|labour shortages/i); }},
    {question: "What would invalidate my ETH call? Keep it short", records: [
      {id: "call", source: "Decisions", title: "ETH", body: "Reason: staking yield and ETF flows. Invalidation: ETF outflows lasting a month. Status: open; action: watched."},
    ], check: answer => { assert.match(answer, /ETF outflows/i); assert.match(answer, /month/i); assert.doesNotMatch(answer, /staking|status|watched/i); }},
  ];
  for (const {question, records, check} of selectionCases) {
    const registry = Ask.newRegistry();
    const result = await Haiku.ask({...options, tool: Ask.SEARCH_TOOL, maxLookups: Ask.MAX_LOOKUPS, deadline: Date.now() + 180000,
      input: Ask.buildAskInput({question, today: "8 October 2026", accounts: [], thread: [], web: false}),
      lookup: () => Ask.lookupOutput(records, registry)});
    const checked = await Ask.refineAnswer({raw: result.raw, revise: result.revise, question, registry, searched: [], web: false});
    const clean = Ask.cleanAnswer(JSON.parse(checked), registry, [], false, question);
    assert.ok(clean.sources.length);
    check(clean.answer);
    console.log(JSON.stringify({question, syntheticAnswer: clean.answer}));
  }
  console.log(JSON.stringify({passed: true, model: Haiku.MODEL, cases: 12, calls, inputTokens, outputTokens,
    seconds: Math.round((Date.now() - started) / 1000)}));
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
