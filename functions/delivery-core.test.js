"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDelivery, isQuietTime, selectDeliverable, decisionAsks, todayLine, askKey, askedAfter, urgentItems, pushKind, pushedAfter,
  notificationCopy, todaysSparkTitle, dueReminders, dueExperiment, reminderIds, hasNewReminders, newReminders,
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

test("feed failures never go in the push; thresholds filter the rest, one per source first, five at most", () => {
  const items = [
    {id: "health", source: "Reliability", score: 100, urgency: "act"},
    {id: "radar", source: "Radar", score: 91},
    {id: "brief", source: "Briefing", score: 79},
  ];
  assert.deepEqual(selectDeliverable(items, {sourceThresholds: {Briefing: 70, Radar: 95}}).map((item) => item.id), ["brief"]);
  // Ranked as command.items comes, highest first.
  const many = ["a", "b", "c"].map((id) => ({id: "radar-" + id, source: "Radar", score: 92}))
    .concat([{id: "b1", source: "Briefing", score: 90}, {id: "b2", source: "Briefing", score: 90}, {id: "n1", source: "Numbers", score: 87}]);
  assert.deepEqual(selectDeliverable(many, {}).map((item) => item.id), ["b1", "radar-a", "n1", "radar-b", "radar-c"], "work leads; each source once before any repeats");
});

// Bob's choice, 11 Oct: work first.
test("the top work item leads, even under its threshold and below a Radar setup; money follows", () => {
  const radar = {id: "radar-AMD", source: "Radar", title: "AMD / confirmed setup", score: 96};
  const news = {id: "news-1", source: "News", title: "Insurer lifts BI reserves", score: 74};
  const picked = selectDeliverable([radar, news], {});
  assert.deepEqual(picked.map((item) => item.id), ["news-1", "radar-AMD"]);
  assert.equal(notificationCopy(picked, false).body, "News: Insurer lifts BI reserves · +1 more");
  assert.deepEqual(selectDeliverable([radar], {}).map((item) => item.id), ["radar-AMD"], "with no work item at all, the best of the rest leads");
});

// A changed number stays on the list for a week: it led no more than once.
test("what has led a morning push only leads again when nothing new can", () => {
  const {ledAfter} = require("./delivery-core");
  const diesel = {id: "grounding-fold-diesel", source: "Numbers", title: "Diesel terminal gate prices", score: 87};
  const news = {id: "news-1", source: "News", title: "Insurer lifts BI reserves", score: 74};
  const radar = {id: "radar-AMD", source: "Radar", title: "AMD / forming setup", score: 88};
  const led = ledAfter({}, diesel, "2026-10-12");
  assert.deepEqual(selectDeliverable([radar, diesel, news], {}, led).map((item) => item.id), ["news-1", "radar-AMD", "grounding-fold-diesel"], "new work first; the old lead is still in +N more");
  assert.deepEqual(selectDeliverable([radar, diesel], {}, led).map((item) => item.id)[0], "radar-AMD", "no new work: something new leads");
  assert.deepEqual(selectDeliverable([diesel], {}, led).map((item) => item.id), ["grounding-fold-diesel"], "nothing new at all: it may lead again");
  const briefing = {id: "briefing-interruptions-0", source: "Briefing", title: "Today's story", score: 90};
  assert.equal(selectDeliverable([briefing], {}, ledAfter({}, Object.assign({}, briefing, {title: "Yesterday's story"}), "2026-10-12"))[0].title, "Today's story", "keyed by title too: a briefing slot holds a new story each day");
  assert.deepEqual(ledAfter(led, null, "2026-10-27"), {}, "kept 14 days");
});

// 4-11 Oct: 11 of 20 pushes led with the same open ETH call.
test("an open call or a due review gets one Due line, then stays on Today; a new review date is news again", () => {
  const eth = {id: "decision-eth", source: "Decisions", title: "Review open call: ETH", urgency: "act", score: 97, since: "2026-07-21"};
  const radar = {id: "radar-AMD", source: "Radar", title: "AMD / confirmed setup", urgency: "act", score: 92};
  assert.deepEqual(selectDeliverable([eth, radar], {}).map((item) => item.id), ["radar-AMD"], "never an item of its own");
  const asks = decisionAsks([eth, radar], {});
  assert.deepEqual(asks.map((item) => item.id), ["decision-eth"]);
  assert.equal(notificationCopy([radar], false, {asks}).body, "Radar: AMD / confirmed setup\nDue: ETH call open since 21 Jul. Close it or set a review date.");
  const asked = askedAfter({}, asks.concat([radar]), "2026-10-12");
  assert.deepEqual(asked, {"decision-eth|Review open call: ETH": "2026-10-12"}, "only Decisions act items are remembered");
  assert.deepEqual(decisionAsks([eth], asked), [], "asked once, left out after");
  const due = Object.assign({}, eth, {title: "Review due: ETH"});
  assert.deepEqual(decisionAsks([due], asked).map((item) => item.id), ["decision-eth"], "the review date he set later is a new ask");
  assert.equal(notificationCopy([], false, {asks: [due]}).body, "Due: review your ETH call today.");
  assert.equal(askKey(due), "decision-eth|Review due: ETH");
  assert.deepEqual(askedAfter(asked, [], "2026-12-12"), {}, "forgotten after 60 days, so a call still open is asked again");
  assert.deepEqual(askedAfter(asked, [], "2026-12-10"), asked);
});

// Uses the synced twin of lib/daybook-calendar-core.js, as the deployed function does.
test("today's line comes from his calendar and his starred PokerHQ picks, a span named on its first day only", () => {
  const K = require("./daybook-calendar-core");
  const day = "2026-10-13";
  const meetings = {items: [{id: "m1", title: "QBE review", start: "2026-10-13T06:00:00Z", end: "2026-10-13T07:00:00Z", calendar: "Outlook"}],
    days: [{id: "d1", title: "0175 - Annual Leave", start: "2026-10-13", end: "2026-10-13", calendar: "Google"},
      {id: "d2", title: "APPT Championship Manila - Strategy: Risk Assessment", start: "2026-10-08", end: "2026-10-19", calendar: "Google"},
      {id: "d3", title: "Bonifacio Day", start: "2026-10-13", end: "2026-10-14", calendar: "Google"}]};
  const manual = [{id: "evt-aaaaaaaa", title: "Dentist", start: day, end: day, time: "09:30", kind: "personal"},
    {id: "evt-bbbbbbbb", title: "Done already", start: day, end: day, time: "08:00", kind: "task", done: true}];
  const tourneys = [{name: "Step 1 - Championship MEGA Qualifier", date: day, planning: true}, {name: "Not starred", date: day, planning: false}];
  assert.equal(todayLine(K, {manual, meetings, tourneys}, day),
    "Today: 09:30 Dentist · Annual Leave · Bonifacio Day (to 14 Oct) · +1 more",
    "timed first; the festival that began on 8 Oct and the account meeting (its own push item) are left out");
  assert.equal(todayLine(K, {tourneys}, day), "Today: ♠ Step 1 - Championship MEGA Qualifier");
  assert.equal(todayLine(K, {}, day), "");
  assert.equal(todayLine(null, {tourneys}, day), "");
});

test("the morning push reads: lead, today, this week, then what is due; with no lead the lines stand alone", () => {
  const lead = [{source: "News", title: "Insurer lifts BI reserves"}];
  const extra = {today: "Today: ♠ Step 1 MEGA Qualifier", commitment: {text: "Save 5k", ticked: 0, elapsed: 2},
    asks: [{title: "Review open call: ETH", since: "2026-07-21"}], reminders: [{metric: "APRA claims data"}]};
  assert.equal(notificationCopy(lead, false, extra).body, ["News: Insurer lifts BI reserves", "Today: ♠ Step 1 MEGA Qualifier", "This week: Save 5k · not ticked yet",
    "Due: ETH call open since 21 Jul. Close it or set a review date.", "⏰ To check: APRA claims data"].join("\n"));
  assert.equal(notificationCopy([], false, {today: "Today: Dentist"}).body, "Today: Dentist");
  assert.equal(pushKind({}, "2026-10-13", {items: [], today: "Today: Dentist"}, []), "morning", "today's plan alone is worth the morning push");
  assert.equal(pushKind({}, "2026-10-13", {items: [], asks: [{}]}, []), "morning");
});

test("one morning push a day, then only a meeting about to start that today's pushes haven't carried", () => {
  const news = {id: "news-1", source: "News", score: 74};
  const soon = {id: "meeting-q", source: "Meetings", score: 95};
  const later = {id: "meeting-r", source: "Meetings", score: 90};
  assert.equal(pushKind({}, "2026-10-12", {items: [news]}, []), "morning");
  assert.equal(pushKind({morningDay: "2026-10-11"}, "2026-10-12", {items: []}, []), "", "nothing at all to say: no push");
  assert.equal(pushKind({}, "2026-10-12", {items: [], commitment: {text: "x"}}, []), "morning", "a commitment alone is worth the morning push");
  assert.equal(pushKind({morningDay: "2026-10-12"}, "2026-10-12", {items: [news]}, []), "", "the morning one has gone");
  const pushed = pushedAfter(undefined, [news], "2026-10-12");
  assert.deepEqual(pushed, {day: "2026-10-12", ids: ["news-1"]});
  assert.deepEqual(urgentItems([news, soon, later], pushed, "2026-10-12").map((item) => item.id), ["meeting-q"], "only a meeting within three hours");
  assert.equal(pushKind({morningDay: "2026-10-12"}, "2026-10-12", {}, urgentItems([soon], pushed, "2026-10-12")), "urgent");
  const after = pushedAfter(pushed, [soon], "2026-10-12");
  assert.deepEqual(urgentItems([soon], after, "2026-10-12"), [], "never twice");
  assert.deepEqual(urgentItems([soon], after, "2026-10-13").map((item) => item.id), ["meeting-q"], "yesterday's pushes don't count today");
  assert.deepEqual(notificationCopy([soon].map((item) => Object.assign({title: "Today 14:00 · QBE review"}, item)), false, {urgent: true}),
    {title: "Starting soon", body: "Meetings: Today 14:00 · QBE review"});
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
  assert.equal(notificationCopy([], true, "Look back on your week").body, "Today’s spark: Look back on your week", "with no lead the lines stand alone");
  assert.equal(notificationCopy([], true).body, "No priority items currently clear your delivery thresholds.");
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
    "Radar: NVDA confirmed\nIt’s Sunday: review your week and set next week’s three.\nToday’s spark: Look back on your week");
  assert.deepEqual(notificationCopy([], false, {spark: "Look back on your week", weekly: true, weeklyOnly: true}), {
    title: "Your weekly review is ready",
    body: "A few minutes on Today: score this week’s commitments and set next week’s three. Your week read back is there too.\nToday’s spark: Look back on your week",
  });
  assert.equal(notificationCopy([], true, {weekly: true, weeklyOnly: true}).title, "Test · Your week");
  const due = [{metric: "Check whether: margins recover", due: "2026-09-27"}];
  assert.equal(notificationCopy([], false, {reminders: due, remindersOnly: true, weekly: true}).body,
    "Check whether: margins recover\nIt’s Sunday: review your week and set next week’s three.", "a reminders-only push mentions it too");
  assert.equal(notificationCopy(items, false, {spark: ""}).body, "Radar: NVDA confirmed", "no line on other days");
});

test("this week's least-ticked commitment rides along with a push; Sunday's review counts as the weekly nudge", () => {
  const {commitmentLine, weeklyReviewDue} = require("./delivery-core");
  const W = require("./weekly-review-core");
  const c = (id, text, area, ticks) => ({id, text, area, measure: "", ticks, result: ""});
  const weeks = {"2026-10-12": {start: "2026-10-12", commitments: [
    c("c-aaaaaa", "Give my open calls a review date", "money", ["2026-10-12", "2026-10-13"]),
    c("c-bbbbbb", "Two hours of report writing on three days", "work", ["2026-10-13"]),
    c("c-cccccc", "Walk 30 minutes on four days", "health", ["2026-10-13"]),
  ]}};
  assert.deepEqual(commitmentLine(W, weeks, "2026-10-14"), {text: "Two hours of report writing on three days", area: "work", ticked: 1, elapsed: 3},
    "fewest ticks first, ties to the focus order (work before health)");
  weeks["2026-10-12"].commitments[1].ticks.push("2026-10-14");
  assert.equal(commitmentLine(W, weeks, "2026-10-14").text, "Walk 30 minutes on four days", "a commitment ticked today is left out");
  assert.equal(commitmentLine(W, {}, "2026-10-14"), null);
  assert.equal(commitmentLine(null, weeks, "2026-10-14"), null);
  const items = [{source: "Radar", title: "NVDA confirmed"}];
  assert.equal(notificationCopy(items, false, {commitment: {text: "Walk 30 minutes on four days", ticked: 1, elapsed: 3}, spark: "S"}).body,
    "Radar: NVDA confirmed\nThis week: Walk 30 minutes on four days · ticked 1 day so far\nToday’s spark: S");
  assert.match(notificationCopy(items, false, {commitment: {text: "x", ticked: 0, elapsed: 1}}).body, /This week: x · new this week$/);
  assert.match(notificationCopy(items, false, {commitment: {text: "x", ticked: 0, elapsed: 4}}).body, /This week: x · not ticked yet$/);
  assert.match(notificationCopy(items, false, {commitment: {text: "y".repeat(120), ticked: 2, elapsed: 4}}).body, /This week: y{89}… · ticked 2 days so far$/);
  // Sunday: a week to score, or next week to set.
  assert.equal(weeklyReviewDue(W, weeks, "2026-10-18"), true);
  assert.equal(weeklyReviewDue(W, {}, "2026-10-18"), true, "nothing set: next week still to plan");
  assert.equal(weeklyReviewDue(W, weeks, "2026-10-17"), false, "not a Sunday");
  const done = {"2026-10-12": Object.assign({}, weeks["2026-10-12"], {reviewedAt: "x"}), "2026-10-19": {start: "2026-10-19", commitments: [c("c-dddddd", "Next", "money", [])]}};
  assert.equal(weeklyReviewDue(W, done, "2026-10-18"), false, "already reviewed and next week set");
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
  // 3-11 Oct: one overdue reminder rode on every push. Now only new ones do.
  const three = two.concat([{metric: "C", due: "2026-09-26"}]);
  assert.deepEqual(newReminders(three, sent).map((item) => item.metric), ["C"]);
  assert.deepEqual(newReminders(two, sent), []);
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
  assert.equal(notificationCopy([], true, {reminders}).body, "⏰ To check: Fair Work hearing list · +1 more");
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

test("meetings from his calendar can go out in the morning push, at the usual threshold", () => {
  const {normalizeDelivery} = require("./delivery-core");
  assert.equal(normalizeDelivery({}).sourceThresholds.Meetings, 80);
});

test("PSE watchlist alerts ride the morning push once, after the Due lines, and never when stale", () => {
  const {pseLine} = require("./delivery-core");
  const watch = {items: {BDO: {target: 115}, JGS: {}, AEV: {}}, alertsAsOf: "2026-10-12",
    alerts: [{symbol: "BDO", text: "BDO ₱112.00, at or below your ₱115.00"}, {symbol: "JGS", text: "JGS −4.1% today"},
      {symbol: "AEV", text: "AEV made a new 52-week high (₱40.00)"}, {symbol: "GONE", text: "GONE −9.0% today"}]};
  const got = pseLine(watch, null, "2026-10-13");
  assert.deepEqual(got, {asOf: "2026-10-12", line: "PSE: BDO ₱112.00, at or below your ₱115.00 · JGS −4.1% today · +1 more"});
  assert.equal(pseLine(watch, "2026-10-12", "2026-10-13"), null, "already pushed");
  assert.equal(pseLine(watch, "2026-10-09", "2026-10-13").asOf, "2026-10-12", "a newer close goes out");
  assert.equal(pseLine(watch, null, "2026-10-17"), null, "five days on it is stale");
  assert.equal(pseLine({...watch, alerts: []}, null, "2026-10-13"), null);
  assert.equal(pseLine({...watch, alerts: [{symbol: "GONE", text: "x"}]}, null, "2026-10-13"), null, "only stocks still on the list");
  assert.equal(pseLine(null, null, "2026-10-13"), null);

  const lead = [{source: "News", title: "Insurer lifts BI reserves"}];
  assert.equal(notificationCopy(lead, false, {asks: [{title: "Review due: ETH"}], pse: got.line, reminders: [{metric: "APRA claims data"}]}).body,
    ["News: Insurer lifts BI reserves", "Due: review your ETH call today.", got.line, "⏰ To check: APRA claims data"].join("\n"));
  assert.equal(notificationCopy([], false, {pse: got.line}).body, got.line);
  assert.equal(pushKind({}, "2026-10-13", {items: [], pse: got.line}, []), "morning", "an alert alone is worth the morning push");
});

test('unverified dividend deadlines never reach the morning push; other alerts survive',()=>{
  const {pseLine}=require('./delivery-core');
  const watch={items:{BDO:{}},alertsAsOf:'2026-10-12',alerts:[{symbol:'BDO',kind:'exdiv',text:'deadline'}]};
  assert.equal(pseLine(watch,null,'2026-10-13'),null);
  assert.equal(pseLine({...watch,alertsCalendarVerified:true},null,'2026-10-13').line,'PSE: deadline');
  assert.equal(pseLine({...watch,alerts:[...watch.alerts,{symbol:'BDO',kind:'news',text:'report'}]},null,'2026-10-13').line,'PSE: report');
});

test("a met fare watch rides the morning push once; a new price is news again", () => {
  const {fareWatchLine} = require("./delivery-core");
  const core = require("./flights-core");
  const now = Date.parse("2026-10-15T22:00:00Z");
  const fare = (id, amount) => ({id: id.repeat(20), kind: "advertised-fare", airline: "Philippine Airlines", origin: "MNL", destination: "NRT", destinationName: "Tokyo",
    departureDate: "2026-11-10", returnDate: "2026-11-15", tripType: "round-trip", cabin: "Economy", currency: "USD", amount,
    sourceUrl: "https://flights.philippineairlines.com/en-ph/", bookingUrl: "https://flights.philippineairlines.com/en-ph/", checkedAt: new Date(now - 3600000).toISOString()});
  const fx = {asOf: "2026-10-15", fx: {usdphp: {level: 60}}};
  const watch = {items: {wabc1: {city: "Tokyo", airports: ["NRT"], from: "2026-11-01", to: "2026-11-30", minNights: 3, maxNights: 10, target: 20000}}};
  const first = fareWatchLine(core, watch, {offers: [fare("a", 300)]}, fx, [], now);
  assert.match(first.line, /^Fare watch: Tokyo ≈ ₱18,000 \(Tue 10 Nov → Sun 15 Nov · 5 nights\), at or under your ₱20,000$/);
  assert.equal(fareWatchLine(core, watch, {offers: [fare("a", 300)]}, fx, first.keys, now), null, "the same fare and price is not sent twice");
  assert.ok(fareWatchLine(core, watch, {offers: [fare("a", 290)]}, fx, first.keys, now), "a lower price is news");
  assert.equal(fareWatchLine(core, watch, {offers: [fare("a", 400)]}, fx, [], now), null, "above target says nothing");
  assert.equal(pushKind({}, "2026-10-16", {fares: first.line}), "morning");
  assert.match(notificationCopy([], false, {fares: first.line}).body, /^Fare watch: Tokyo/);
});

test("the next booked trip rides the morning push: countdown and open to-dos within a week, only late or soon-due items further out", () => {
  const {bookedTripLine} = require("./delivery-core");
  const core = require("./flights-core");
  const doc = {items: {b1: {city: "Tokyo", destination: "NRT", origin: "MNL", depart: "2026-12-20", ret: "2026-12-27", hotel: "Inn", done: {passport: true}}}};
  assert.equal(bookedTripLine(core, doc, "2026-10-15"), null, "two months out with nothing due within a week");
  assert.equal(bookedTripLine(core, doc, "2026-11-24"), "Trip to Tokyo in 26 days · to do: visa");
  assert.equal(bookedTripLine(core, doc, "2026-12-01"), "Trip to Tokyo in 19 days · late: visa");
  assert.equal(bookedTripLine(core, doc, "2026-12-17"), "Trip to Tokyo in 3 days · late: visa · to do: travel tax, eTravel");
  assert.equal(bookedTripLine(core, doc, "2026-12-22"), null, "nothing while away");
  const allDone = {items: {b1: {...doc.items.b1, destination: "MPH", done: {checkin: true}}}};
  assert.equal(bookedTripLine(core, allDone, "2026-12-18"), "Trip to Tokyo in 2 days · checklist done");
  assert.equal(pushKind({}, "2026-12-17", {trip: "Trip to Tokyo in 3 days"}), "morning");
  assert.match(notificationCopy([], false, {trip: "Trip to Tokyo in 3 days"}).body, /^Trip to Tokyo in 3 days/);
});
