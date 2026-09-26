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
  assert.match(input.text, /Stories he noted without comment: "Flood claims backlog grows" \(Insurance News\)/);
});

// ── the four fixes from the first real read (Sat 26 Sep, 6:45 AM) ──

test("today is marked in progress with the read time, so its open quest is not a miss", () => {
  const entries = Object.assign(week(), {"2026-09-26": {spark: 21, done: false, picked: "swap", note: "I need to be consistent.", trialPlan: "Walk at lunch"}});
  const now = Date.parse("2026-09-25T22:45:00Z"); // 6:45 AM Saturday in Manila
  const input = buildMirrorInput({entries, decisions: [], mirrors: {}, todayKey: TODAY, core, now});
  const saturday = input.text.split("\n").find((line) => line.startsWith("Sat 26 Sep"));
  assert.match(saturday, /^Sat 26 Sep \(today, still in progress — read at 6:45 AM Manila\) — spark/);
  assert.match(saturday, /; quest not done yet; swapped to it$/);
  assert.match(input.text, /Experiment planned: "Walk at lunch" — not done yet/);
  const wednesday = input.text.split("\n").find((line) => line.startsWith("Wed 23 Sep"));
  assert.match(wednesday, /; quest not done$/, "an earlier day is over, so not done means not done");
  const quiet = buildMirrorInput({entries: week(), decisions: [], mirrors: {}, todayKey: TODAY, core, now});
  assert.match(quiet.text, /Sat 26 Sep \(today, still in progress — read at 6:45 AM Manila\) — nothing recorded yet/);
  assert.match(buildMirrorInput({entries: week(), todayKey: TODAY, core}).text, /Sat 26 Sep \(today, still in progress\) — nothing recorded yet/, "no time when none is given");
});

test("Note this stubs are stories he noted, not his words, and a comment on one is kept as his", () => {
  const note = "On “US and China extend trade truce” (Yahoo Finance):\n\nOn “OpenAI agent breached Medicare portal” (CNBC): \n\nOn “Flood claims backlog grows” (Insurance News): This is the BI angle nobody prices.\nMy own line here.";
  const entries = {"2026-09-25": {spark: 1, done: true, note, stories: [{headline: "OpenAI agent breached Medicare portal", source: "CNBC"}]}};
  const input = buildMirrorInput({entries, decisions: [], mirrors: {}, todayKey: TODAY, core});
  assert.match(input.text, /  Note: "My own line here\."/);
  assert.doesNotMatch(input.text, /Note: "On “/, "stubs are not presented as his words");
  assert.match(input.text, /  On the story "Flood claims backlog grows" he wrote: "This is the BI angle nobody prices\."/);
  assert.match(input.text, /Stories he noted without comment: "OpenAI agent breached Medicare portal" \(CNBC\); "US and China extend trade truce" \(Yahoo Finance\)$/m,
    "bare stubs join the noted stories, once each");
  assert.doesNotMatch(input.text, /without comment: .*Flood claims/, "a story he commented on is not listed again as without comment");
  assert.equal(input.stats.notes, 1);
  assert.equal(input.stats.noted, 3);

  const stubsOnly = buildMirrorInput({entries: {"2026-09-25": {spark: 1, done: true, note: "On “A story” (Src): "}}, decisions: [], todayKey: TODAY, core});
  assert.equal(stubsOnly.stats.notes, 0, "only stubs: no note counted");
  assert.doesNotMatch(stubsOnly.text, /  Note:/);
  assert.match(stubsOnly.text, /Stories he noted without comment: "A story" \(Src\)/);
});

test("a blank My take line is dropped, and a written one is kept as his take", () => {
  const blank = buildMirrorInput({entries: {"2026-09-25": {spark: 1, done: false, note: "My take on “Renewals must test agent permissions”: "}}, decisions: [], todayKey: TODAY, core});
  assert.equal(blank, null, "only a blank take: nothing recorded that day, so nothing to read");
  const mixed = buildMirrorInput({entries: {"2026-09-25": {spark: 1, done: true, note: "My take on “Renewals must test agent permissions”: \n\nMy take on “Cold chains carry the grid risk”: Seen this at a Cebu client.\nA line of my own."}}, decisions: [], todayKey: TODAY, core});
  assert.doesNotMatch(mixed.text, /Renewals must test agent permissions/, "the blank take leaves no trace");
  assert.match(mixed.text, /  On the day’s briefing insight "Cold chains carry the grid risk" his take: "Seen this at a Cebu client\."/);
  assert.match(mixed.text, /  Note: "A line of my own\."/);
  assert.doesNotMatch(mixed.text, /Note: "My take on/);
  assert.equal(mixed.stats.notes, 1);
  const takeOnly = buildMirrorInput({entries: {"2026-09-25": {spark: 1, done: false, note: "My take on “Cold chains carry the grid risk”: Worth testing."}}, decisions: [], todayKey: TODAY, core});
  assert.equal(takeOnly.stats.notes, 1, "a written take counts as writing");
  assert.match(buildMirrorPrompt(takeOnly), /"his take"\n  lines are his view of the day's briefing insight — also his words/);
});

test("the prompt keeps today out of evidence, energy to his words, and themes to what recurs", () => {
  const prompt = buildMirrorPrompt(buildMirrorInput({entries: week(), decisions: [], mirrors: {}, todayKey: TODAY, core}));
  assert.match(prompt, /The last day is today and is still in progress when this is read\. An unfinished quest or experiment on it is not a miss/);
  assert.match(prompt, /Never use today's unfinished items as evidence in any field/);
  assert.match(prompt, /Never infer either list from something not done or a day not recorded/);
  assert.match(prompt, /Empty lists are the expected answer in most weeks/);
  assert.match(prompt, /themes: things that came up on two or more different days/);
  assert.match(prompt, /return at most one theme: what stood out/);
  assert.match(prompt, /Stories he noted\s+without comment show interest only/);
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
  assert.deepEqual(previousMirror(mirrors, TODAY), {weekKey: "2026-09-19", question: "What would consistent look like on a busy day?", tryNext: "Write tomorrow's first step tonight", answer: null});
  const input = buildMirrorInput({entries: week(), decisions: [], mirrors, todayKey: TODAY, core});
  assert.match(input.text, /LAST MIRROR \(Sat 19 Sep\):\n- The question it left him: "What would consistent look like on a busy day\?"\n- The thing it suggested trying: "Write tomorrow's first step tonight"/);
  assert.doesNotMatch(input.text, /Today's own question/);
  assert.equal(input.previous, "2026-09-19");
  assert.equal(previousMirror({}, TODAY), null);
});

test("only a read at least five days old is followed up", () => {
  const read = (question) => ({question, try_next: {action: "Try " + question}});
  // Saturday's read, then a Sunday read the next day: nothing old enough yet.
  assert.equal(previousMirror({"2026-09-26": read("Sat")}, "2026-09-27"), null);
  assert.equal(previousMirror({"2026-09-22": read("Tue"), "2026-09-26": read("Sat")}, "2026-09-26"), null, "four days is too soon");
  assert.equal(previousMirror({"2026-09-21": read("Mon"), "2026-09-25": read("Fri")}, "2026-09-26").weekKey, "2026-09-21",
    "exactly five days counts, and a newer read too recent to grade is passed over");
  assert.equal(previousMirror({"2026-09-26": read("Sat")}, "2026-10-03").weekKey, "2026-09-26", "a week later it is followed up");
  const input = buildMirrorInput({entries: week(), decisions: [], mirrors: {"2026-09-25": read("Fri")}, todayKey: TODAY, core});
  assert.doesNotMatch(input.text, /LAST MIRROR/);
  assert.equal(input.previous, null);
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


test('explicit spark feedback, experiment outcomes, and check findings inform the read',()=>{
  const entries=week();
  Object.assign(entries['2026-09-25'],{trialResult:'untried',trialNext:'adapt',sparkResponse:{spark:3,value:'not-today',note:'Needed a quieter task'}});
  entries['2026-09-25'].reminders[0].finding='The port is still closed';
  const input=buildMirrorInput({entries,decisions:[],mirrors:{},todayKey:TODAY,core});
  assert.match(input.text,/Haven't tried/); assert.match(input.text,/His chosen next step: Adapt/);
  assert.match(input.text,/not a permanent dislike/); assert.match(input.text,/Needed a quieter task/);
  assert.match(input.text,/draft, still open/); assert.match(input.text,/The port is still closed/);
});

test("his written answer to the last read's question is carried into the follow-up", () => {
  const question = "What would consistent look like on your busiest day?";
  const mirrors = {"2026-09-19": {question, try_next: {action: "List three firsts"}, answer: {text: "A ten-minute note\nbefore I open email.", question, at: "2026-09-20T01:00:00Z"}}};
  const input = buildMirrorInput({entries: week(), decisions: [], mirrors, todayKey: TODAY, core});
  assert.match(input.text, /- His written answer: "A ten-minute note before I open email\."/);
  const reworded = {"2026-09-19": {question, answer: {text: "Mornings.", question: "An earlier wording?"}}};
  assert.match(buildMirrorInput({entries: week(), mirrors: reworded, todayKey: TODAY, core}).text, /- His written answer \(to an earlier wording, "An earlier wording\?"\): "Mornings\."/);
  const blank = {"2026-09-19": {question, answer: {text: "  ", question}}};
  assert.doesNotMatch(buildMirrorInput({entries: week(), mirrors: blank, todayKey: TODAY, core}).text, /His written answer/);
  assert.match(buildMirrorPrompt(input), /If he wrote an answer, respond to what he wrote — quote a few of his words — and say whether\n  this week bears it out/);
});
