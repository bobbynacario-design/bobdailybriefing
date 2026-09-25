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

// spark (optional): today's Daily Boost spark title, as a second line.
function notificationCopy(items, test, spark) {
  items = Array.isArray(items) ? items : [];
  const lead = items[0];
  const title = test ? "Test · Morning 5" : "Your Morning 5 is ready";
  const sparkLine = spark ? "\nToday’s spark: " + spark : "";
  if (!lead) return {title, body: "No priority items currently clear your delivery thresholds." + sparkLine};
  const remaining = Math.max(0, items.length - 1);
  return {
    title,
    body: lead.source + ": " + lead.title + (remaining ? " · +" + remaining + " more" : "") + sparkLine,
  };
}

// Today's Daily Boost spark for the notification: the one already on the day's
// entry (opened, picked or swapped to), else the default the app would show,
// worked out by the same shared code (lib/daily-boost.js) from the same
// synced history. Anything unusable gives "" and the line is simply left off.
function todaysSparkTitle(core, entries, dayKey) {
  if (!core || typeof core.clean !== "function" || !/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) return "";
  const records = core.clean(entries && typeof entries === "object" ? entries : {});
  const spark = records[dayKey] ? records[dayKey].spark : core.sparkFor(dayKey, records);
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
};
