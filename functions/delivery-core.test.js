"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDelivery, isQuietTime, selectDeliverable, digestSignature,
  isMaterialChange, notificationCopy, todaysSparkTitle,
} = require("./delivery-core");

test("normalizes delivery defaults and clamps source thresholds", () => {
  const value = normalizeDelivery({enabled: true, quietStart: "25:90", sourceThresholds: {Radar: 120, Sports: 65}});
  assert.equal(value.enabled, true);
  assert.equal(value.quietStart, "22:00");
  assert.equal(value.quietEnd, "06:00");
  assert.equal(value.sourceThresholds.Radar, 100);
  assert.equal(value.sourceThresholds.Sports, 65);
  assert.equal(value.sourceThresholds.Briefing, 80);
});

test("quiet hours work across midnight and can be disabled with matching times", () => {
  assert.equal(isQuietTime("23:15", "22:00", "06:00"), true);
  assert.equal(isQuietTime("05:59", "22:00", "06:00"), true);
  assert.equal(isQuietTime("06:00", "22:00", "06:00"), false);
  assert.equal(isQuietTime("12:00", "08:00", "08:00"), false);
});

test("source thresholds filter ordinary items but never suppress reliability", () => {
  const items = [
    {id: "brief", source: "Briefing", score: 79},
    {id: "radar", source: "Radar", score: 91},
    {id: "health", source: "Reliability", score: 86},
  ];
  const selected = selectDeliverable(items, {sourceThresholds: {Briefing: 70, Radar: 95}});
  assert.deepEqual(selected.map((item) => item.id), ["brief", "health"]);
});

test("material change tracks membership, order, urgency, and score bands", () => {
  const initial = [{id: "a", score: 90, urgency: "act"}, {id: "b", score: 80, urgency: "monitor"}];
  const signature = digestSignature(initial);
  assert.equal(isMaterialChange(signature, initial), false);
  assert.equal(isMaterialChange(signature, [{id: "a", score: 96, urgency: "act"}, initial[1]]), true);
  assert.equal(isMaterialChange(signature, [initial[1], initial[0]]), true);
});

test("notification copy leads with the highest ranked source", () => {
  assert.deepEqual(notificationCopy([{source: "Radar", title: "NVDA confirmed"}, {source: "Markets", title: "Rates"}], false), {
    title: "Your Morning 5 is ready",
    body: "Radar: NVDA confirmed · +1 more",
  });
  assert.equal(notificationCopy([], true).title, "Test · Morning 5");
});

// Uses the synced twin of lib/daily-boost.js, exactly as the deployed function does.
const DailyBoostCore = require("./daily-boost");

test("the notification carries today's spark as a second line when there is one", () => {
  const items = [{source: "Radar", title: "NVDA confirmed"}];
  assert.equal(notificationCopy(items, false, "Test the “but for” story").body,
    "Radar: NVDA confirmed\nToday’s spark: Test the “but for” story");
  assert.equal(notificationCopy([], true, "Look back on your week").body,
    "No priority items currently clear your delivery thresholds.\nToday’s spark: Look back on your week");
  assert.equal(notificationCopy(items, false, "").body, "Radar: NVDA confirmed");
});

test("today's spark is the one on the day's entry, else the app's own default", () => {
  const core = DailyBoostCore;
  assert.equal(todaysSparkTitle(core, {"2026-09-25": {spark: 11, note: "", updatedAt: 1}}, "2026-09-25"), "Turn a headline into a question");
  assert.equal(todaysSparkTitle(core, {}, "2026-09-27"), "Look back on your week", "Sunday");
  const fresh = core.sparkFor("2026-09-28", {});
  assert.equal(todaysSparkTitle(core, {}, "2026-09-28"), core.sparkTitle(fresh));
  const recent = {"2026-09-26": {spark: fresh, note: "seen it", updatedAt: 1}};
  assert.notEqual(todaysSparkTitle(core, recent, "2026-09-28"), core.sparkTitle(fresh), "skips a spark used in the last two weeks, like the app");
  assert.equal(todaysSparkTitle(core, "junk", "2026-09-28"), core.sparkTitle(fresh));
  assert.equal(todaysSparkTitle(core, {}, "not-a-day"), "");
  assert.equal(todaysSparkTitle(null, {}, "2026-09-28"), "");
});
