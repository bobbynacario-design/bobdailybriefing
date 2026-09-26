"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDelivery, isQuietTime, selectDeliverable, digestSignature,
  isMaterialChange, notificationCopy, todaysSparkTitle, dueReminders, dueExperiment, reminderIds, hasNewReminders,
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

test("Sunday's weekly read is worth one nudge that day, until it has been read", () => {
  const {weeklyReadDue} = require("./delivery-core");
  assert.equal(weeklyReadDue("2026-09-27", {}, ""), true, "a Sunday with no read yet");
  assert.equal(weeklyReadDue("2026-09-26", {}, ""), false, "not a Sunday");
  assert.equal(weeklyReadDue("2026-09-27", {"2026-09-27": {question: "q"}}, ""), false, "already read today");
  assert.equal(weeklyReadDue("2026-09-27", {"2026-09-20": {question: "q"}}, ""), true, "last week's read does not count");
  assert.equal(weeklyReadDue("2026-09-27", {}, "2026-09-27"), false, "only one nudge that day");
  assert.equal(weeklyReadDue("junk", {}, ""), false);
});

test("the weekly read rides along with a push, or is the push on a quiet Sunday", () => {
  const items = [{source: "Radar", title: "NVDA confirmed"}];
  assert.equal(notificationCopy(items, false, {spark: "Look back on your week", weekly: true}).body,
    "Radar: NVDA confirmed\nIt’s Sunday: read your week back.\nToday’s spark: Look back on your week");
  assert.deepEqual(notificationCopy([], false, {spark: "Look back on your week", weekly: true, weeklyOnly: true}), {
    title: "Your week is ready to read back",
    body: "A few minutes on Today: what kept coming up, and one thing to carry forward.\nToday’s spark: Look back on your week",
  });
  assert.equal(notificationCopy([], true, {weekly: true, weeklyOnly: true}).title, "Test · Your week");
  const due = [{metric: "Check whether: margins recover", due: "2026-09-27"}];
  assert.equal(notificationCopy([], false, {reminders: due, remindersOnly: true, weekly: true}).body,
    "Check whether: margins recover\nIt’s Sunday: read your week back.", "a reminders-only push mentions it too");
  assert.equal(notificationCopy(items, false, {spark: ""}).body, "Radar: NVDA confirmed", "no line on other days");
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

test("due reminders come from the synced days: unchecked, due by today, most overdue first", () => {
  const entries = {
    "2026-09-20": {spark: 1, reminders: [
      {metric: "Fair Work hearing list", headline: "Port strike", due: "2026-09-23", done: false},
      {metric: "Checked already", due: "2026-09-22", done: true},
    ]},
    "2026-09-24": {spark: 2, reminders: [
      {metric: "APRA quarterly claims data", headline: "Insurer lifts BI reserves", due: "2026-09-25"},
      {metric: "Not yet", due: "2026-10-12"},
      {metric: "", due: "2026-09-21"},
    ]},
  };
  const due = dueReminders(DailyBoostCore, entries, "2026-09-25");
  assert.deepEqual(due.map((item) => item.metric), ["Fair Work hearing list", "APRA quarterly claims data"]);
  assert.deepEqual(dueReminders(DailyBoostCore, null, "2026-09-25"), []);
  assert.deepEqual(dueReminders(null, entries, "2026-09-25"), []);
});

test("a reminder is announced once: checking one off re-sends nothing, a snoozed one comes back", () => {
  const two = [{metric: "A", due: "2026-09-23"}, {metric: "B", due: "2026-09-25"}];
  const sent = reminderIds(two);
  assert.equal(hasNewReminders(two, []), true);
  assert.equal(hasNewReminders(two, sent), false);
  assert.equal(hasNewReminders([two[1]], sent), false, "A checked off: B was already announced");
  assert.equal(hasNewReminders([{metric: "A", due: "2026-09-30"}], sent), true, "A snoozed to a new day is news again");
  assert.equal(hasNewReminders([], sent), false);
});

test("reminders ride in the Morning 5, or get a push of their own when nothing else changed", () => {
  const items = [{source: "Radar", title: "NVDA confirmed"}];
  const reminders = [{metric: "Fair Work hearing list"}, {metric: "APRA quarterly claims data"}];
  assert.deepEqual(notificationCopy(items, false, {spark: "Look back on your week", reminders}), {
    title: "Your Morning 5 is ready",
    body: "Radar: NVDA confirmed\n⏰ To check: Fair Work hearing list · +1 more\nToday’s spark: Look back on your week",
  });
  assert.deepEqual(notificationCopy(items, false, {reminders: [reminders[1]], remindersOnly: true}), {
    title: "⏰ To check today",
    body: "APRA quarterly claims data",
  });
  assert.equal(notificationCopy(items, false, {reminders: [], remindersOnly: true}).title, "Your Morning 5 is ready", "no reminders, no reminders-only copy");
  assert.equal(notificationCopy([], true, {reminders}).body,
    "No priority items currently clear your delivery thresholds.\n⏰ To check: Fair Work hearing list · +1 more");
});

test("one due experiment rides on an existing Morning 5 and points at its review", () => {
  const entries = {
    "2026-09-20": {spark:1,trialPlan:"Ask one clearer question",trialDue:"2026-09-24",trialDone:false},
    "2026-09-22": {spark:2,trialPlan:"Send the shorter request",trialDue:"2026-09-25",trialDone:false},
    "2026-09-23": {spark:3,trialPlan:"Already reviewed",trialDue:"2026-09-24",trialDone:true},
  };
  const experiment = dueExperiment(DailyBoostCore, entries, "2026-09-25");
  assert.deepEqual(experiment,{plan:"Ask one clearer question",due:"2026-09-24",day:"2026-09-20"});
  assert.equal(notificationCopy([{source:"Radar",title:"NVDA confirmed"}],false,{experiment}).body,
    "Radar: NVDA confirmed\nExperiment to review: Ask one clearer question");
  assert.equal(dueExperiment(DailyBoostCore, entries,"2026-09-23"),null);
  assert.equal(dueExperiment(null,entries,"2026-09-25"),null);
});

test("the push's spark leans towards his goals exactly as the app does", () => {
  const core = DailyBoostCore, day = "2026-09-28";
  const base = core.sparkFor(day, {}), target = core.order.find((id) => core.themes[id] !== core.themes[base]);
  const lean = [core.themes[target]];
  assert.equal(todaysSparkTitle(core, {}, day, lean), core.sparkTitle(core.sparkFor(day, {}, lean)));
  assert.notEqual(todaysSparkTitle(core, {}, day, lean), todaysSparkTitle(core, {}, day), "a goal can change the day's spark");
  assert.equal(todaysSparkTitle(core, {"2026-09-28": {spark: 11, updatedAt: 1}}, day, lean), core.sparkTitle(11), "a stored day keeps its spark");
});
