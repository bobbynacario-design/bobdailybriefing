"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {buildStandingContext, priorWatch, isTracked} = require("./briefing-context");

function decision(over) {
  return Object.assign({
    id: "dec-1", uid: "u1", saved: 1000, createdDate: "2026-09-08",
    asset: "PLTR", direction: "long", action: "took", status: "open",
    reason: "Ahead of the government contract cycle.",
    invalidator: "Wrong below the September low.",
  }, over || {});
}

function signal(over) {
  return Object.assign({
    symbol: "NVDA", status: "confirmed", score: 71,
    catalyst: "Post-earnings continuation.",
  }, over || {});
}

function market(over) {
  return Object.assign({
    slug: "rba-cut", label: "RBA cuts in November", gate: "GO", impliedYes: 0.62,
  }, over || {});
}

// ── isTracked ──

test("an open, acted-on call is tracked", () => {
  assert.equal(isTracked(decision()), true);
});

test("closed calls and skipped calls are both out of scope", () => {
  assert.equal(isTracked(decision({status: "closed"})), false);
  assert.equal(isTracked(decision({action: "skipped"})), false);
});

test("missing status and action default to an open watched call", () => {
  assert.equal(isTracked({asset: "BHP"}), true);
});

// ── buildStandingContext ──

test("returns null when nothing at all is open", () => {
  assert.equal(buildStandingContext({}), null);
  assert.equal(buildStandingContext(null), null);
  assert.equal(buildStandingContext({
    decisions: [decision({status: "closed"})], radar: {signals: []}, markets: {markets: []},
  }), null);
});

test("names the block as private state rather than news", () => {
  const out = buildStandingContext({decisions: [decision()]});
  assert.match(out.block, /private working state/);
  assert.match(out.block, /not news/);
});

test("prints a call with its thesis and invalidation line", () => {
  const out = buildStandingContext({decisions: [decision()]});
  assert.match(out.block, /- PLTR \/ long \/ took \/ logged 2026-09-08/);
  assert.match(out.block, /thesis: Ahead of the government contract cycle\./);
  assert.match(out.block, /wrong if: Wrong below the September low\./);
  assert.deepEqual(out.stats, {decisions: 1, questions: 0, radar: 0, markets: 0});
});

test("omits the direction when the call has no side", () => {
  const out = buildStandingContext({decisions: [decision({direction: "none"})]});
  assert.match(out.block, /- PLTR \/ took \/ logged 2026-09-08/);
});

test("newest calls win when there are more than the cap", () => {
  const many = [];
  for (let i = 0; i < 14; i += 1) {
    many.push(decision({id: "dec-" + i, asset: "SYM" + i, saved: i}));
  }
  const out = buildStandingContext({decisions: many});
  assert.equal(out.stats.decisions, 10);
  assert.match(out.block, /SYM13/);
  assert.doesNotMatch(out.block, /SYM3\b/);
});

// A multi-line thesis must not be able to reshape the block around it.
test("collapses newlines inside a typed thesis", () => {
  const out = buildStandingContext({
    decisions: [decision({reason: "First line.\n- Fake entry\nSecond line."})],
  });
  assert.match(out.block, /thesis: First line\. - Fake entry Second line\./);
  assert.equal(out.block.split("\n").filter((row) => row.startsWith("- ")).length, 1);
});

test("truncates an overlong thesis instead of carrying it whole", () => {
  const out = buildStandingContext({decisions: [decision({reason: "x".repeat(400)})]});
  const row = out.block.split("\n").find((value) => value.includes("thesis:"));
  assert.ok(row.length < 200, "expected the thesis line to be bounded");
  assert.match(row, /…$/);
});

test("carries confirmed and forming setups, highest score first", () => {
  const out = buildStandingContext({
    radar: {signals: [
      signal({symbol: "AAPL", score: 40}),
      signal({symbol: "NVDA", score: 90}),
      signal({symbol: "TSLA", status: "invalidated", score: 99}),
    ]},
  });
  assert.match(out.block, /RADAR SETUPS/);
  assert.ok(out.block.indexOf("NVDA") < out.block.indexOf("AAPL"));
  assert.doesNotMatch(out.block, /TSLA/);
  assert.equal(out.stats.radar, 2);
});

test("only GO markets reach the block, with their implied probability", () => {
  const out = buildStandingContext({
    markets: {markets: [market(), market({slug: "x", label: "No-go event", gate: "NO-GO"})]},
  });
  assert.match(out.block, /- RBA cuts in November \/ 62% implied/);
  assert.doesNotMatch(out.block, /No-go event/);
  assert.equal(out.stats.markets, 1);
});

test("a market with no implied price still lists", () => {
  const out = buildStandingContext({markets: {markets: [market({impliedYes: null})]}});
  assert.match(out.block, /- RBA cuts in November$/m);
});

test("headings appear only for the parts that have content", () => {
  const out = buildStandingContext({decisions: [decision()]});
  assert.match(out.block, /OPEN CALLS/);
  assert.doesNotMatch(out.block, /RADAR SETUPS/);
  assert.doesNotMatch(out.block, /EVENT MARKETS/);
});

test("an insight decision is an open question, never one of the open calls", () => {
  const calls = Array.from({length: 10}, (_, i) => decision({id: "c" + i, asset: "CALL" + i, saved: 100 + i}));
  const insight = decision({id: "q1", asset: "Whether AI-agent access counts as unauthorised under cyber wordings", source: "briefing", action: "watched",
    direction: "none", saved: 5000, reason: "A long dossier summary.", invalidator: "Insurers confirm cover for agent access.", reviewDate: "2026-10-03",
    linkedSignal: {kind: "insight", label: "Go deeper · Saturday"}});
  const out = buildStandingContext({decisions: calls.concat([insight, decision({id: "q2", asset: "From Evidence", source: "evidence", saved: 4000})])});
  const [callsPart, questionsPart] = out.block.split("OPEN QUESTIONS (insights he is testing, from his journal):");
  assert.equal((callsPart.match(/^- CALL\d/gm) || []).length, 10, "all ten calls keep their places");
  assert.doesNotMatch(callsPart, /Whether AI-agent access/);
  assert.match(questionsPart, /- Whether AI-agent access counts as unauthorised under cyber wordings\n  wrong if: Insurers confirm cover for agent access\.\n  review on 2026-10-03/);
  assert.match(questionsPart, /- From Evidence/);
  assert.doesNotMatch(questionsPart, /A long dossier summary/, "a question carries its wrong-if, not the pasted evidence");
  assert.equal(out.stats.decisions, 10); assert.equal(out.stats.questions, 2);
  assert.match(buildStandingContext({decisions: [insight]}).block, /OPEN QUESTIONS/, "questions alone still make a block");
  assert.equal(buildStandingContext({decisions: [Object.assign({}, insight, {verdict: "held"})]}), null, "a settled question is not an open one");
});

test("survives malformed inputs without throwing", () => {
  assert.equal(buildStandingContext({decisions: "nope", radar: 7, markets: null}), null);
  const out = buildStandingContext({decisions: [null, decision(), undefined]});
  assert.equal(out.stats.decisions, 1);
});

// ── priorWatch ──

function saved(dateKey, watch, over) {
  return {
    dateKey,
    briefing: Object.assign({
      date: "Wednesday, September 10, 2026", watch, watch_source: "AFR",
    }, over || {}),
  };
}

test("returns null when there is no archive to look at", () => {
  assert.equal(priorWatch([], "2026-09-11"), null);
  assert.equal(priorWatch(null, "2026-09-11"), null);
});

test("returns the newest previous watch item with its source", () => {
  const out = priorWatch([
    saved("2026-09-10", "Whether the port reopens before the weekend."),
    saved("2026-09-09", "Older item."),
  ], "2026-09-11");
  assert.equal(out.text, "Whether the port reopens before the weekend.");
  assert.equal(out.source, "AFR");
  assert.equal(out.dateKey, "2026-09-10");
});

// The regeneration guard: a second run on the same day must not be handed its
// own watch line to grade.
test("skips a briefing saved today and falls through to the real prior day", () => {
  const out = priorWatch([
    saved("2026-09-11", "This morning's own watch line."),
    saved("2026-09-10", "Yesterday's watch line."),
  ], "2026-09-11");
  assert.equal(out.text, "Yesterday's watch line.");
  assert.equal(out.dateKey, "2026-09-10");
});

test("skips archived briefings that carry no watch item", () => {
  const out = priorWatch([
    saved("2026-09-10", "   "),
    saved("2026-09-09", "The one that counts."),
  ], "2026-09-11");
  assert.equal(out.text, "The one that counts.");
});

test("returns null when every candidate is today or empty", () => {
  assert.equal(priorWatch([saved("2026-09-11", "Today only.")], "2026-09-11"), null);
  assert.equal(priorWatch([{dateKey: "2026-09-10", briefing: null}], "2026-09-11"), null);
});

test("bounds an overlong watch line", () => {
  const out = priorWatch([saved("2026-09-10", "y".repeat(900))], "2026-09-11");
  assert.ok(out.text.length <= 600);
  assert.match(out.text, /…$/);
});

// ── reader feedback ──
const {buildReaderFeedback} = require("./briefing-context");

test("reader feedback lists the latest vote per story, most recent first, within 30 days", () => {
  const entries = {
    "2026-09-24": {feedback: [
      {headline: "Insurer lifts BI reserves", source: "insuranceNEWS", section: "insurance", url: "https://x.example/a", vote: 1},
      {headline: "AI chip export curbs widen", source: "Reuters", section: "ai", vote: -1},
      {headline: "Rates hold again", section: "markets", vote: -1},
    ]},
    "2026-09-25": {feedback: [
      {headline: "AI chip export curbs widen", source: "Reuters", section: "ai", vote: 0},
      {headline: "Port strike halts Botany", section: "interruptions", vote: 1},
      {headline: "Insurer lifts BI reserves again", url: "http://www.x.example/a/?utm=1", section: "insurance", vote: 1},
    ]},
    "2026-08-20": {feedback: [{headline: "Too old", vote: 1}]},
    "2026-09-26": {feedback: [{headline: "Tomorrow", vote: 1}]},
    "junk": {feedback: [{headline: "Bad key", vote: 1}]},
  };
  const out = buildReaderFeedback(entries, "2026-09-25");
  assert.deepEqual(out.stats, {up: 2, down: 1, days: 2});
  assert.equal(out.block, [
    "READER FEEDBACK — Bob's reactions to recent briefing stories (last 30 days):",
    "More like this:",
    "- [insurance] Insurer lifts BI reserves again",
    "- [interruptions] Port strike halts Botany",
    "Less like this:",
    "- [markets] Rates hold again",
    "By section: more useful — insurance 1, interruptions 1; less useful — markets 1.",
  ].join("\n"));
});

test("reader feedback is null when there is nothing to say", () => {
  assert.equal(buildReaderFeedback({}, "2026-09-25"), null);
  assert.equal(buildReaderFeedback({"2026-09-25": {feedback: [{headline: "Taken back", vote: 0}]}}, "2026-09-25"), null);
  assert.equal(buildReaderFeedback(null, "2026-09-25"), null);
  assert.equal(buildReaderFeedback({"2026-09-25": {feedback: [{headline: "x", vote: 1}]}}, "not-a-day"), null);
});

test("reader feedback caps its examples at ten each way", () => {
  const feedback = Array.from({length: 14}, (_, i) => ({headline: "Story " + i, section: "global", vote: 1}));
  const out = buildReaderFeedback({"2026-09-25": {feedback}}, "2026-09-25");
  assert.equal(out.block.split("\n").filter((line) => line.startsWith("- ")).length, 10);
  assert.equal(out.stats.up, 14);
});
