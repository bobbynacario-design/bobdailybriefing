"use strict";

const DELIVERY_SOURCES = ["Briefing", "News", "Radar", "Markets", "Decisions", "Sports"];

function clampThreshold(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 80;
  return Math.max(50, Math.min(100, Math.round(parsed)));
}

function normalizeTime(value, fallback) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? match[1] + ":" + match[2] : fallback;
}

function normalizeDelivery(raw) {
  raw = raw || {};
  const sourceThresholds = {};
  DELIVERY_SOURCES.forEach((source) => {
    sourceThresholds[source] = clampThreshold(raw.sourceThresholds && raw.sourceThresholds[source]);
  });
  return {
    enabled: raw.enabled === true,
    quietStart: normalizeTime(raw.quietStart, "22:00"),
    quietEnd: normalizeTime(raw.quietEnd, "06:00"),
    sourceThresholds,
  };
}

function minuteOfDay(value) {
  const normalized = normalizeTime(value, "00:00");
  const parts = normalized.split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function isQuietTime(localTime, quietStart, quietEnd) {
  const now = minuteOfDay(localTime);
  const start = minuteOfDay(quietStart);
  const end = minuteOfDay(quietEnd);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

function scoreBand(score) {
  const value = Number(score) || 0;
  return value >= 95 ? "critical" : value >= 85 ? "high" : value >= 70 ? "priority" : "watch";
}

function selectDeliverable(items, delivery) {
  const config = normalizeDelivery(delivery);
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!item || item.source === "Reliability") return !!item;
    const threshold = config.sourceThresholds[item.source] == null ? 80 : config.sourceThresholds[item.source];
    return Number(item.score) >= threshold;
  }).slice(0, 5);
}

function digestSignature(items) {
  return (Array.isArray(items) ? items : []).map((item) => [
    String(item.id || ""), scoreBand(item.score), String(item.urgency || ""),
  ].join(":")).join("|");
}

function isMaterialChange(previousSignature, items) {
  const next = digestSignature(items);
  return !!next && next !== String(previousSignature || "");
}

// extra (optional): {spark, reminders, experiment, remindersOnly}, or just the spark title.
//   spark         today's Daily Boost spark, as a last line
//   reminders     due watch-metric reminders (dueReminders), as a "To check" line
//   remindersOnly the Morning 5 had nothing new but reminders came due, so the
//                 notification is about them alone
function notificationCopy(items, test, extra) {
  extra = typeof extra === "string" ? {spark: extra} : (extra || {});
  items = Array.isArray(items) ? items : [];
  const reminders = Array.isArray(extra.reminders) ? extra.reminders : [];
  const experiment = extra.experiment && extra.experiment.plan ? extra.experiment : null;
  const sparkLine = extra.spark ? "\nToday’s spark: " + extra.spark : "";
  const experimentLine = experiment ? "\nExperiment to review: " + experiment.plan : "";
  const weeklyLine = extra.weekly ? "\nIt’s Sunday: read your week back." : "";
  const toCheck = reminders.length ? reminders[0].metric + (reminders.length > 1 ? " · +" + (reminders.length - 1) + " more" : "") : "";
  if (extra.remindersOnly && toCheck) {
    return {title: test ? "Test · To check today" : "⏰ To check today", body: toCheck + experimentLine + weeklyLine + sparkLine};
  }
  if (extra.weeklyOnly) {
    return {title: test ? "Test · Your week" : "Your week is ready to read back", body: "A few minutes on Today: what kept coming up, and one thing to carry forward." + experimentLine + sparkLine};
  }
  const lead = items[0];
  const title = test ? "Test · Morning 5" : "Your Morning 5 is ready";
  const reminderLine = toCheck ? "\n⏰ To check: " + toCheck : "";
  if (!lead) return {title, body: "No priority items currently clear your delivery thresholds." + reminderLine + experimentLine + weeklyLine + sparkLine};
  const remaining = Math.max(0, items.length - 1);
  return {
    title,
    body: lead.source + ": " + lead.title + (remaining ? " · +" + remaining + " more" : "") + reminderLine + experimentLine + weeklyLine + sparkLine,
  };
}

// Sunday's weekly read (functions/weekly-mirror.js) is worth one nudge that day,
// until it has been read: it opens by itself on Today, but only for someone who
// opens Today. mirrors: the stored reads keyed by PHT day.
function weeklyReadDue(dayKey, mirrors, lastNudge) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) return false;
  if (new Date(dayKey + "T00:00:00Z").getUTCDay() !== 0) return false;
  if (mirrors && typeof mirrors === "object" && mirrors[dayKey]) return false;
  return lastNudge !== dayKey;
}

// Daily Boost watch-metric reminders due for the push: not checked, due today
// or earlier, most overdue first. Read with the shared core's clean(), so the
// server sees exactly the reminders the app shows.
function dueReminders(core, entries, dayKey) {
  if (!core || typeof core.clean !== "function" || !/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) return [];
  const records = core.clean(entries && typeof entries === "object" ? entries : {});
  const out = [];
  Object.keys(records).forEach((key) => (records[key].reminders || []).forEach((item) => {
    if (!item.done && item.due <= dayKey) out.push({metric: item.metric, due: item.due, headline: item.headline});
  }));
  return out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

// The oldest open experiment whose revisit date has arrived. It only rides on a
// Morning 5 that was already going out; it never creates another notification.
function dueExperiment(core, entries, dayKey) {
  if (!core || typeof core.clean !== "function" || !/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) return null;
  const records = core.clean(entries && typeof entries === "object" ? entries : {});
  const key = Object.keys(records).filter((day) => {
    const item = records[day];
    return item.trialPlan && !item.trialDone && item.trialDue && item.trialDue <= dayKey;
  }).sort((a,b) => records[a].trialDue.localeCompare(records[b].trialDue) || a.localeCompare(b))[0];
  return key ? {plan: records[key].trialPlan, due: records[key].trialDue, day: key} : null;
}

// Which reminders a push announced. A reminder is news until it has been in a
// push once, so checking one off never re-sends the rest; a snoozed one has a
// new due day, so it is news again when it comes back.
function reminderIds(list) {
  return (Array.isArray(list) ? list : []).map((item) => item.due + "|" + item.metric).slice(0, 20);
}

function hasNewReminders(list, notified) {
  const seen = new Set(Array.isArray(notified) ? notified : []);
  return reminderIds(list).some((id) => !seen.has(id));
}

// Today's Daily Boost spark for the notification: the one already on the day's
// entry (opened, picked or swapped to), else the default the app would show,
// worked out by the same shared code (lib/daily-boost.js) from the same
// synced history. Anything unusable gives "" and the line is simply left off.
// lean: the themes of his goals, which the app's rotation leans towards.
function todaysSparkTitle(core, entries, dayKey, lean) {
  if (!core || typeof core.clean !== "function" || !/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) return "";
  const records = core.clean(entries && typeof entries === "object" ? entries : {});
  const spark = records[dayKey] ? records[dayKey].spark : core.sparkFor(dayKey, records, Array.isArray(lean) ? lean : undefined);
  return core.sparkTitle(spark) || "";
}

module.exports = {
  DELIVERY_SOURCES,
  normalizeDelivery,
  isQuietTime,
  scoreBand,
  selectDeliverable,
  digestSignature,
  isMaterialChange,
  notificationCopy,
  todaysSparkTitle,
  weeklyReadDue,
  dueReminders,
  dueExperiment,
  reminderIds,
  hasNewReminders,
};
