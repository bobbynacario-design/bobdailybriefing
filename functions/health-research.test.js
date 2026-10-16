"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./health-research");

const T = "2026-10-18";
const good = (over) => Object.assign({topic: "sleep", headline: "Later bedtimes linked to higher heart risk", finding: "In 88,000 adults, falling asleep after midnight was linked to a 25% higher risk of heart disease.",
  evidence: "large cohort", who_studied: "88,000 UK adults followed for 6 years", source_title: "Sleep onset and CVD", url: "https://www.example-journal.org/sleep-cvd?utm=x",
  published: "2026-10-09", for_you: "Tournaments past midnight shift your sleep.", try: "On two non-poker nights, be in bed by 11."}, over || {});

test("the prompt carries only an age band and a fixed line about how he lives", () => {
  const p = R.buildResearchPrompt({todayKey: T, ageBand: "40s"});
  assert.match(p, /A man in his 40s in Manila/);
  assert.match(p, /poker tournaments/);
  assert.doesNotMatch(p, /steps|in bed|drinks|check-up/i, "no body numbers or answers");
  assert.match(R.buildResearchPrompt({todayKey: T}), /WHO IT IS FOR: An adult in Manila/);
  assert.equal(R.ageBand(1981, T), "40s");
  assert.equal(R.ageBand(null, T), "");
  assert.match(R.SYSTEM, /Do not give medical advice/);
});

test("kept only with a searched source, a known topic and evidence, and a recent date", () => {
  const searched = ["https://example-journal.org/sleep-cvd", "https://news.example.com/walk"];
  const raw = {items: [good(),
    good({url: "https://made-up.example.org/x"}),
    good({topic: "supplements", url: "https://news.example.com/walk"}),
    good({evidence: "mouse study", url: "https://news.example.com/walk"}),
    good({published: "2026-07-01", url: "https://news.example.com/walk"}),
    good({url: "https://example-journal.org/sleep-cvd#dup"})], note: "Thin week."};
  const out = R.cleanResearch(raw, searched, T);
  assert.equal(out.items.length, 1);
  assert.equal(out.dropped, 5);
  assert.deepEqual(Object.keys(out.items[0]).sort(), ["evidence", "finding", "forYou", "headline", "published", "shows", "sourceTitle", "topic", "try", "url", "whoStudied"]);
  assert.equal(out.items[0].shows, "association", "a cohort shows a link, not cause");
  assert.equal(out.items[0].whoStudied, "88,000 UK adults followed for 6 years");
  assert.equal(out.note, "Thin week.");
  assert.deepEqual(R.cleanResearch(null, searched, T), {items: [], note: "", dropped: 0});
});

test("what a finding can show is capped by its design (Codex review)", () => {
  const searched = ["https://a.org/1", "https://a.org/2", "https://a.org/3", "https://a.org/4"];
  const raw = {items: [good({url: "https://a.org/1", evidence: "large cohort", shows: "cause"}), good({url: "https://a.org/2", evidence: "randomised trial", shows: "cause"}),
    good({url: "https://a.org/3", evidence: "guideline", shows: "cause"}), good({url: "https://a.org/4", evidence: "meta-analysis"})]};
  assert.deepEqual(R.cleanResearch(raw, searched, T).items.map((i) => i.shows), ["association", "cause", "guidance"]);
  const pooled = R.cleanResearch({items: [good({url: "https://a.org/4", evidence: "meta-analysis", shows: "nonsense"})]}, searched, T).items[0];
  assert.equal(pooled.shows, "association", "unknown or missing: the cautious reading");
  assert.match(R.buildResearchPrompt({todayKey: T}), /"shows": association/);
});

test("at most three findings, and twelve weeks kept", () => {
  const searched = ["https://a.org/1", "https://a.org/2", "https://a.org/3", "https://a.org/4"];
  const raw = {items: [1, 2, 3, 4].map((n) => good({url: "https://a.org/" + n}))};
  assert.equal(R.cleanResearch(raw, searched, T).items.length, 3);
  let stored = {};
  for (let i = 0; i < 15; i++) stored = R.keepWeeks(stored, new Date(Date.parse("2026-01-05T00:00:00Z") + i * 7 * 86400000).toISOString().slice(0, 10), {items: []});
  assert.equal(Object.keys(stored).length, 12);
  assert.equal(Object.keys(stored).sort()[0], "2026-01-26");
});
