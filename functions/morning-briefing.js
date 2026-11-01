"use strict";

// 05:40 Manila: today's briefing is built before the 06:00 push, so it is
// waiting when Bob opens Daybook and the push can lead with it. The 1 Nov 2026
// audit found he had built it on only 6 of 10 quiet days, and a day he skipped
// had no briefing at all. Generate on Today still rebuilds it.
//
// It pauses itself when Daybook has not been opened for IDLE_DAYS (22-25 Oct
// he did not open it once), so days away do not pay for briefings nobody
// reads. The first open after that restarts it the next morning.

const {normaliseBriefing, briefingDocKey, defaultDateLabel} = require("./briefing-prompt-core");

const IDLE_DAYS = 3;

function shiftDay(day, days) {
  return new Date(Date.parse(day + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

// Whether to build this morning. Never twice: a briefing already saved for
// today (his own, or an earlier run's) wins. usageDays is usage-<uid>.days,
// keyed by Manila date.
function morningBriefingPlan({today, existing, usageDays}) {
  if (existing) return {build: false, reason: "today's briefing is already saved"};
  const since = shiftDay(today, -IDLE_DAYS);
  const opened = Object.keys(usageDays || {}).some((day) => day >= since);
  if (!opened) return {build: false, reason: "Daybook not opened in the last " + IDLE_DAYS + " days"};
  return {build: true, reason: ""};
}

// The archive document, exactly as the app's autoSave writes it (data, saved,
// uid), plus builtBy so the app can say it was built for him. The date is the
// label the prompt was given, so the document id is the one the app looks for.
function morningBriefingDoc(briefing, dateLabel, uid, now) {
  const data = normaliseBriefing(Object.assign({}, briefing, {date: dateLabel}));
  return {data: JSON.stringify(data), saved: now, uid, builtBy: "schedule"};
}

// Today's label and document id in Manila ("Sunday, November 1, 2026",
// "Sunday--November-1--2026").
function morningBriefingKey() {
  const dateLabel = defaultDateLabel();
  return {dateLabel, key: briefingDocKey(dateLabel)};
}

module.exports = {IDLE_DAYS, morningBriefingPlan, morningBriefingDoc, morningBriefingKey};
