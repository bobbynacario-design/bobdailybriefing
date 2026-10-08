"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Ask = require("./ask-daybook");

function context(question) {
  const registry = Ask.newRegistry();
  Ask.lookupOutput([{id: "profile-work", source: "Profile", title: "Your work", body: "I assess claims.", saved: Date.now()}], registry);
  return {question, registry, searched: [], web: false};
}
function raw(answer, extra = {}) { return JSON.stringify({answer, not_found: "", follow_ups: ["Unrelated question?"], web_sources: [], ...extra}); }

test("explicit formatting and personal scope override the generic work template", () => {
  assert.deepEqual(Ask.requestIntent("Describe me in 1 sentence"), {sentences: 1, bullets: null, maxWords: 30, scope: "person", suppressFollowups: true});
  assert.equal(Ask.requestIntent("Describe my work in one sentence").scope, "work");
  assert.equal(Ask.requestIntent("Describe me beyond work in one sentence").scope, "beyond-work");
  assert.equal(Ask.requestIntent("Describe me in three bullets").bullets, 3);
  assert.equal(Ask.requestIntent("Explain this under 20 words").maxWords, 19);
  assert.equal(Ask.requestIntent("What changed for QBE?").suppressFollowups, false);
  const prompt = (question) => Ask.buildAskPrompt({question, today: "8 October 2026", accounts: [], web: false});
  assert.match(prompt("Describe me in one sentence"), /exactly 1 sentence/);
  assert.match(prompt("Describe me in one sentence"), /interests, values and goals together/);
  assert.match(prompt("Describe me beyond work"), /Do not substitute his job description/);
  assert.match(prompt("Describe my work"), /professional role/);
});

test("sentence checking ignores refs, decimals and common abbreviations", () => {
  assert.equal(Ask.sentenceCount("You work with U.S. insurers on $1.5m claims [S1]."), 1);
  assert.equal(Ask.sentenceCount("You assess claims [S1]. You advise insurers [S1]."), 2);
  assert.equal(Ask.sentenceCount("You assess claims [S1]"), 1);
});

test("the screenshot-style two-sentence response gets one grounded correction", async () => {
  const ctx = context("Describe me in 1 sentence");
  let corrections = 0;
  const result = await Ask.refineAnswer({...ctx, raw: raw("You assess claims [S1]. You work for insurers [S1]."), revise: async (prompt) => {
    corrections++;
    assert.match(prompt, /exactly 1 sentence/);
    assert.match(prompt, /only evidence already returned/);
    assert.match(prompt, /Do not call tools/);
    return raw("You are a claims specialist working with insurers [S1].");
  }});
  assert.equal(corrections, 1);
  const resultJson = JSON.parse(result);
  assert.equal(Ask.sentenceCount(resultJson.answer), 1);
  assert.match(resultJson.answer, /\[S1\]/);
  assert.deepEqual(resultJson.follow_ups, []);
});

test("a conforming answer needs no paid rewrite and irrelevant suggestions are suppressed", async () => {
  const result = await Ask.refineAnswer({...context("Describe my work in one sentence"), raw: raw("You assess claims [S1]."), revise: async () => {throw new Error("Unnecessary rewrite");}});
  assert.deepEqual(JSON.parse(result).follow_ups, []);
});

test("a second nonconforming answer is rejected rather than stored or truncated", async () => {
  let calls = 0;
  await assert.rejects(Ask.refineAnswer({...context("One sentence please"), raw: raw("You assess claims [S1]. You advise insurers [S1]."), revise: async () => {
    calls++; return raw("You assess claims [S1]. You advise insurers [S1].");
  }}), /did not meet/);
  assert.equal(calls, 1);
});

test("requested bullet lines survive cleaning and surrounding prose triggers repair", () => {
  const ctx = context("Describe me in three bullets");
  const good = raw("- You assess claims [S1].\n- You work with insurers [S1].\n- You check the evidence [S1].");
  const reviewed = Ask.reviewAnswer(good, ctx);
  assert.deepEqual(reviewed.problems, []);
  assert.equal(JSON.parse(reviewed.raw).answer.split("\n").length, 3);
  assert.match(Ask.reviewAnswer(raw("Here you go.\n- One [S1].\n- Two [S1].\n- Three [S1]."), ctx).problems.join(" "), /bullet lines/);
});

test("word limits and unsupported citation refs trigger correction", () => {
  const ctx = context("Explain my work in at most 4 words");
  assert.match(Ask.reviewAnswer(raw("You assess insurance claims for clients [S1]."), ctx).problems.join(" "), /4 words/);
  assert.match(Ask.reviewAnswer(raw("You assess claims [S99]."), ctx).problems.join(" "), /unsupported claims/);
  assert.deepEqual(Ask.reviewAnswer(raw("You assess claims [S1]."), ctx).problems, []);
});

test("an inventory-length sentence is rewritten, while a precise short answer is accepted", async () => {
  const ctx = context("Describe me in 1 sentence");
  const crowded = "You are a forensic claims specialist working for Australian insurers and solicitors, mainly two large insurance groups, plus Philippine consulting firms, mostly on third-party property damage claims, and you want to use AI to improve productivity and income [S1].";
  assert.match(Ask.reviewAnswer(raw(crowded), ctx).problems.join(" "), /30 words/);
  const precise = raw("You assess insurance claims and want to use AI to improve your productivity [S1].");
  const result = await Ask.refineAnswer({...ctx, raw: raw(crowded), revise: async (prompt) => {
    assert.match(prompt, /omit client names/);
    assert.match(prompt, /Do not lose a material caveat/);
    return precise;
  }});
  assert.equal(JSON.parse(result).answer, JSON.parse(precise).answer);
  const prompt = Ask.buildAskPrompt({question: "What changed in the repair estimate?", today: "today", accounts: [], web: false});
  assert.match(prompt, /comparison should lead with the meaningful difference/);
  assert.match(prompt, /names, dates, amounts/);
});
