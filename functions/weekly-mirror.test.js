"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./daily-boost");
const {
  buildMirrorInput, buildMirrorPrompt, cleanMirror, keepRecent, mirrorWindow, previousMirror, MIRROR_SCHEMA, KEEP_MIRRORS,
} = require("./weekly-mirror");

const TODAY = "2026-09-26"; // a Saturday

function week() {
  return {
    "2026-09-21": {spark: 3, done: true, energy: "stretch", note: "I need to be consistent with what I want.", picked: "library"},
    "2026-09-23": {spark: 11, done: false, note: "", opened: [{headline: "Port strike halts Botany", source: "AFR", url: "https://afr.com/a", how: "open"}],
      feedback: [{headline: "Insurer lifts BI reserves", section: "insurance", vote: 1}, {headline: "Rates hold again", section: "markets", vote: -1}]},
    "2026-09-25": {spark: 20, done: true, note: "Help me understand myself better\nand lead me somewhere new.", intention: "clarity",
      trialPlan: "Call one former client", trialDone: false,
      reminders: [{metric: "Botany berth reopening", headline: "Port strike", due: "2026-10-01", done: false}],
      stories: [{headline: "Flood claims backlog grows", source: "Insurance News"}]},
    "2026-09-10": {spark: 1, done: true, note: "Outside the window"},
  };
}

// ── the window ──

test("the window is the seven Manila days ending today", () => {
  const win = mirrorWindow(TODAY);
  assert.equal(win.from, "2026-09-20");
  assert.equal(win.to, TODAY);
  assert.equal(win.days.length, 7);
});

// ── the input ──

test("every day of the week appears, and an empty day says so", () => {
  const input = buildMirrorInput({entries: week(), decisions: [], mirrors: {}, todayKey: TODAY, core});
  assert.match(input.text, /^THE WEEK — Sun 20 Sep to Sat 26 Sep/);
  assert.match(input.text, /Sun 20 Sep — nothing recorded/);
  assert.match(input.text, /Tue 22 Sep — nothing recorded/);
  assert.doesNotMatch(input.text, /Outside the window/, "days before the window stay out");
  assert.deepEqual(input.stats, {days: 3, notes: 2, done: 2, opened: 1, votes: 2, noted: 1, decisions: 0});
});

test("a day carries its spark, quest, note and how it was chosen", () => {
  const input = buildMirrorInput({entries: week(), decisions: [], mirrors: {}, todayKey: TODAY, core});
  const monday = input.text.split("\n").find((line) => line.startsWith("Mon 21 Sep"));
  assert.ok(monday.includes("spark \"" + core.sparkTitle(3) + "\""));
  assert.match(monday, /quest done \(10-minute\); picked from the library/);
  assert.match(input.text, /  Note: "I need to be consistent with what I want\."/);
  assert.match(input.text, /  Note: "Help me understand myself better and lead me somewhere new\."/, "newlines collapse");
  assert.match(input.text, /intention: Clarity/);
});

test("reading, votes, reminders and experiments are carried", () => {
  const input = buildMirrorInput({entries: week(), decisions: [], mirrors: {}, todayKey: TODAY, core});
  assert.match(input.text, /Opened 1 briefing story: "Port strike halts Botany" \(AFR\)/);
  assert.match(input.text, /Wanted more like: "Insurer lifts BI reserves" \[insurance\]/);
  assert.match(input.text, /Wanted less like: "Rates hold again" \[markets\]/);
  assert.match(input.text, /Set reminders to check: "Botany berth reopening" \(due 2026-10-01\)/);
  assert.match(input.text, /Experiment planned: "Call one former client"/);
  assert.match(input.text, /Stories he noted: "Flood claims backlog grows" \(Insurance News\)/);
});

test("an empty week makes no input, so no model call is made", () => {
  assert.equal(buildMirrorInput({entries: {}, decisions: [], mirrors: {}, todayKey: TODAY, core}), null);
  assert.equal(buildMirrorInput({entries: {"2026-09-24": {spark: 2, done: false, note: ""}}, decisions: [], todayKey: TODAY, core}), null,
    "a day that was only opened is not activity");
  assert.equal(buildMirrorInput({entries: week(), todayKey: "not a day", core}), null);
});

// ── decisions ──

test("decisions in the week are described as process, without prices or sizes", () => {
  const decisions = [
    {asset: "PLTR", direction: "long", action: "took", conviction: "high", createdDate: "2026-09-22", status: "open",
      reason: "Contract cycle.", invalidator: "Below the September low.", entryPrice: 31.2, size: "2%"},
    {asset: "BTC", direction: "long", action: "took", createdDate: "2026-08-01", status: "closed", closedDate: "2026-09-24",
      outcome: "loss", outcomeNote: "Held past my own line."},
    {asset: "ETH", action: "watched", createdDate: "2026-09-25", status: "open"},
    {asset: "OLD", action: "took", createdDate: "2026-07-01", status: "open"},
  ];
  const input = buildMirrorInput({entries: {}, decisions, mirrors: {}, todayKey: TODAY, core});
  assert.match(input.text, /- Logged Tue 22 Sep: PLTR \/ long \/ took \/ conviction high — thesis: "Contract cycle\." — wrong if: "Below the September low\."/);
  assert.match(input.text, /- Closed Thu 24 Sep: BTC \/ long \/ took — no thesis written — outcome: loss — his review: "Held past my own line\."/);
  assert.match(input.text, /- Logged Fri 25 Sep: ETH \/ watched — no thesis written — no invalidation line/);
  assert.doesNotMatch(input.text, /OLD/, "calls logged before the week are not listed");
  assert.doesNotMatch(input.text, /31\.2|2%/, "no prices or sizes");
  assert.match(input.text, /Open calls in his journal overall: 3\./);
  assert.equal(input.stats.decisions, 3);
});

// ── follow-up ──

test("the last mirror before today is followed up, never today's own", () => {
  const mirrors = {
    "2026-09-12": {question: "Old question", try_next: {action: "Old try"}},
    "2026-09-19": {question: "What would consistent look like on a busy day?", try_next: {action: "Write tomorrow's first step tonight"}},
    "2026-09-26": {question: "Today's own question", try_next: {action: "Today's try"}},
  };
  assert.deepEqual(previousMirror(mirrors, TODAY), {weekKey: "2026-09-19", question: "What would consistent look like on a busy day?", tryNext: "Write tomorrow's first step tonight"});
  const input = buildMirrorInput({entries: week(), decisions: [], mirrors, todayKey: TODAY, core});
  assert.match(input.text, /LAST MIRROR \(Sat 19 Sep\):\n- The question it left him: "What would consistent look like on a busy day\?"\n- The thing it suggested trying: "Write tomorrow's first step tonight"/);
  assert.doesNotMatch(input.text, /Today's own question/);
  assert.equal(input.previous, "2026-09-19");
  assert.equal(previousMirror({}, TODAY), null);
});

// ── the prompt ──

test("the prompt holds the lines that keep it honest", () => {
  const input = buildMirrorInput({entries: week(), decisions: [], mirrors: {}, todayKey: TODAY, core});
  const prompt = buildMirrorPrompt(input);
  assert.match(prompt, /Evidence only\. Every observation must point at something in the record below, by day/);
  assert.match(prompt, /Never invent a feeling, event, person or fact he did not record/);
  assert.match(prompt, /"nothing recorded" means nothing was recorded, not that nothing happened/);
  assert.match(prompt, /set confidence to "thin"/);
  assert.match(prompt, /Never recommend buying, selling, holding, exiting, sizing or hedging/);
  assert.match(prompt, /No diagnosis or clinical words, no flattery/);
  assert.match(prompt, /ONE small, concrete thing for the coming week that the record suggests he has not done yet/);
  assert.ok(prompt.trimEnd().endsWith(input.text.trimEnd()), "the record comes last");
});

test("the schema is strict: every property required, nothing extra", () => {
  const check = (schema) => {
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
      Object.values(schema.properties).forEach(check);
    }
    if (schema.type === "array") check(schema.items);
  };
  check(MIRROR_SCHEMA);
});

// ── what is stored ──

test("cleanMirror keeps known fields, bounds them, and rejects a mirror without its point", () => {
  const raw = {
    week_in_a_line: "  A week  of starting again. ", themes: [{title: "Consistency", detail: "Mon and Fri.", days: ["Mon", "Fri"], extra: 1}, {title: ""}, {title: "B"}, {title: "C"}, {title: "D"}],
    energy: {gave: ["Finishing the 10-minute quest"], drained: []}, said_vs_did: "x".repeat(900), reading: "", decisions: "",
    last_week: "", try_next: {action: "Call one former client", why: "Friday's plan"}, question: "What would you do first?", confidence: "rich", injected: "<script>",
  };
  const clean = cleanMirror(raw);
  assert.equal(clean.week_in_a_line, "A week of starting again.");
  assert.equal(clean.themes.length, 3);
  assert.deepEqual(Object.keys(clean.themes[0]).sort(), ["days", "detail", "title"]);
  assert.equal(clean.said_vs_did.length, 600);
  assert.equal(clean.injected, undefined);
  assert.equal(cleanMirror(Object.assign({}, raw, {confidence: "certain"})).confidence, "fair");
  assert.equal(cleanMirror(Object.assign({}, raw, {question: " "})), null);
  assert.equal(cleanMirror(null), null);
});

test("the stored map keeps the latest twelve reads", () => {
  let mirrors = {};
  for (let i = 1; i <= 15; i++) mirrors = keepRecent(mirrors, "2026-09-" + String(i).padStart(2, "0"), {question: "q" + i});
  const keys = Object.keys(mirrors);
  assert.equal(keys.length, KEEP_MIRRORS);
  assert.equal(keys[0], "2026-09-04");
  assert.equal(mirrors["2026-09-15"].question, "q15");
});
