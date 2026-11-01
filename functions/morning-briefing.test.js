"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {IDLE_DAYS, morningBriefingPlan, morningBriefingDoc, morningBriefingKey} = require("./morning-briefing");

test("builds when Daybook was opened lately and nothing is saved for today", () => {
  const plan = morningBriefingPlan({today: "2026-11-02", existing: false, usageDays: {"2026-11-01": {page_today: 2}}});
  assert.deepEqual(plan, {build: true, reason: ""});
});

test("never builds twice: a briefing already saved for today wins", () => {
  const plan = morningBriefingPlan({today: "2026-11-02", existing: true, usageDays: {"2026-11-01": {}}});
  assert.equal(plan.build, false);
  assert.match(plan.reason, /already saved/);
});

test("pauses after three days without opening Daybook, as on 22-25 Oct", () => {
  assert.equal(IDLE_DAYS, 3);
  // Real usage: opened 21 Oct, then only 23 Oct (4 taps), then 25 Oct.
  const days = {"2026-10-21": {}, "2026-10-23": {}, "2026-10-25": {}};
  assert.equal(morningBriefingPlan({today: "2026-10-24", existing: false, usageDays: days}).build, true, "23 Oct counts");
  assert.equal(morningBriefingPlan({today: "2026-10-27", existing: false, usageDays: {"2026-10-23": {}}}).build, false, "four days quiet");
  assert.equal(morningBriefingPlan({today: "2026-10-26", existing: false, usageDays: {"2026-10-23": {}}}).build, true, "three days back still counts");
  assert.match(morningBriefingPlan({today: "2026-11-02", existing: false, usageDays: null}).reason, /not opened in the last 3 days/);
});

test("the saved document matches what the app saves, with the label as its date", () => {
  const briefing = {date: "Nov 2", sections: [{id: "insurance", stories: [{headline: "H", body: "B", junk: 1}]}], extra: "dropped"};
  const doc = morningBriefingDoc(briefing, "Monday, November 2, 2026", "uid1", 1793570400000);
  assert.deepEqual(Object.keys(doc), ["data", "saved", "uid", "builtBy"]);
  assert.equal(doc.saved, 1793570400000);
  assert.equal(doc.uid, "uid1");
  assert.equal(doc.builtBy, "schedule");
  const data = JSON.parse(doc.data);
  assert.equal(data.date, "Monday, November 2, 2026");
  assert.equal(data.extra, undefined);
  assert.equal(data.sections.insurance[0].headline, "H");
  assert.equal(data.sections.insurance[0].junk, undefined);
});

test("today's key is the Manila date label with punctuation made dashes", () => {
  const {dateLabel, key} = morningBriefingKey();
  assert.match(dateLabel, /^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4}$/);
  assert.equal(key, dateLabel.replace(/[^a-zA-Z0-9]/g, "-"));
});
