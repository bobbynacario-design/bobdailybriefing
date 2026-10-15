"use strict";

const DELIVERY_SOURCES = ["Briefing", "News", "Numbers", "Radar", "Markets", "Decisions", "Sports", "Meetings"];

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

// The push says each thing once (11 Oct audit: the last 20 pushes all led with
// the same open call or a failed feed). An act item that stays true day after
// day, an open call or a review date passed, rides one push and then stays on
// Today; asked holds those already sent, keyed by id and title, so a new review
// date set on the same call is news again.
function askKey(item) {
  return String(item && item.id || "") + "|" + String(item && item.title || "");
}

function asksOnce(item) {
  return !!item && item.source === "Decisions" && item.urgency === "act";
}

// Work leads the push (Bob's choice, 11 Oct): a meeting, today's top briefing
// story, a changed number or insurance news, whichever ranks first, even under
// his threshold. Money (Radar, Markets) and the rest follow as "+N more".
const WORK_SOURCES = ["Meetings", "Briefing", "Numbers", "News", "Accounts"];

// What the push can carry, from the whole ranked list: feed failures never
// (they stay on Today and in the daily check), and open calls go on their own
// line (decisionAsks). The top work item leads; the rest come at his source
// thresholds, one per source first, five in all at most.
// led: {askKey: day} of recent leads. A changed number stays on the list for a
// week, so without it one diesel price could lead seven mornings running:
// something that has led once only leads again when nothing new can.
function selectDeliverable(items, delivery, led) {
  const config = normalizeDelivery(delivery);
  const before = led && typeof led === "object" ? led : {};
  const pool = (Array.isArray(items) ? items : []).filter((item) => item && item.source !== "Reliability" && !asksOnce(item));
  const fresh = (item) => !before[askKey(item)];
  const work = (item) => WORK_SOURCES.indexOf(item.source) >= 0;
  const lead = pool.find((item) => work(item) && fresh(item)) || pool.find(fresh) || pool.find(work);
  const eligible = pool.filter((item) => {
    if (item === lead) return false;
    const threshold = config.sourceThresholds[item.source] == null ? 80 : config.sourceThresholds[item.source];
    return Number(item.score) >= threshold;
  });
  const picked = lead ? [lead] : [], used = lead ? {[lead.source]: true} : {};
  eligible.forEach((item) => { if (picked.length < 5 && !used[item.source]) { picked.push(item); used[item.source] = true; } });
  eligible.forEach((item) => { if (picked.length < 5 && picked.indexOf(item) < 0) picked.push(item); });
  return picked;
}

// The open calls and due reviews no push has asked about yet, each for a "Due:" line.
function decisionAsks(items, asked) {
  const seen = asked && typeof asked === "object" ? asked : {};
  return (Array.isArray(items) ? items : []).filter((item) => asksOnce(item) && !seen[askKey(item)]).slice(0, 2);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  return m ? Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] : "";
}

function askLine(item) {
  const open = /^Review open call: (.+)$/.exec(item.title || ""), due = /^Review due: (.+)$/.exec(item.title || "");
  if (open) return "Due: " + open[1] + " call open" + (dayLabel(item.since) ? " since " + dayLabel(item.since) : "") + ". Close it or set a review date.";
  if (due) return "Due: review your " + due[1] + " call today.";
  return "Due: " + item.title;
}

// Today's plan from his calendar, built as the Calendar page builds it
// (core: DaybookCalendarCore), plus his ★ PokerHQ picks for the day. Timed
// entries first; a span of days (leave, a festival) is named on its first day
// only; account meetings are left to the push's own Meetings items.
function todayLine(core, input, dayKey) {
  if (!core || typeof core.build !== "function" || !/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) return "";
  input = input || {};
  const short = (value) => { const t = String(value || "").trim(); return t.length > 48 ? t.slice(0, 47).trimEnd() + "…" : t; };
  let events = [];
  try { events = core.onDay(core.build({manual: input.manual, meetings: input.meetings}), dayKey); } catch (error) { events = []; }
  const entries = [];
  events.filter((e) => !e.done && !/^meeting-/.test(e.id) && (e.time || e.start === dayKey))
    .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"))
    .forEach((e) => entries.push((e.time ? e.time + " " : "") + short(e.title) + (!e.time && e.end > e.start ? " (to " + dayLabel(e.end) + ")" : "")));
  (Array.isArray(input.tourneys) ? input.tourneys : []).forEach((t) => {
    if (t && t.planning === true && typeof core.pokerDate === "function" && core.pokerDate(t.date) === dayKey) entries.push("♠ " + short(t.name));
  });
  const unique = entries.filter((entry, index) => entries.indexOf(entry) === index);
  if (!unique.length) return "";
  return "Today: " + unique.slice(0, 3).join(" · ") + (unique.length > 3 ? " · +" + (unique.length - 3) + " more" : "");
}

// His PSE watchlist alerts (pse-watch-<uid>, written by radar/pse-watch.js after
// the 16:30 close) for the morning push: the latest close's alerts once, never
// again, and none older than four days (a long weekend is three). Only stocks
// still on his list. {line, asOf}, or null when there is nothing new.
function pseLine(watch, lastAsOf, dayKey) {
  if (!watch || !/^\d{4}-\d{2}-\d{2}$/.test(String(watch.alertsAsOf || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) return null;
  const asOf = watch.alertsAsOf;
  if (lastAsOf && asOf <= String(lastAsOf)) return null;
  if (Date.parse(dayKey + "T00:00:00Z") - Date.parse(asOf + "T00:00:00Z") > 4 * 86400000) return null;
  const items = watch.items && typeof watch.items === "object" ? watch.items : {};
  const alerts = (Array.isArray(watch.alerts) ? watch.alerts : []).filter((a) => a && a.text && items[a.symbol] && (a.kind !== "exdiv" || watch.alertsCalendarVerified === true));
  if (!alerts.length) return null;
  return {asOf, line: "PSE: " + alerts.slice(0, 2).map((a) => String(a.text)).join(" · ") + (alerts.length > 2 ? " · +" + (alerts.length - 2) + " more" : "")};
}

// His fare watches (flights-watch-<uid>, set on Trips) against the latest
// flight scout, through the shared FlightsCore so the push and the page agree.
// A fare at or under its target is announced once: alerted holds the
// watch|fare|price keys already sent, so a new price or a new fare is news
// and the same one is not. {line, keys}, or null when nothing is new.
function fareWatchLine(core, watchDoc, latest, fx, alerted, now) {
  if (!core || typeof core.fareWatch !== "function" || !watchDoc || !latest) return null;
  const items = watchDoc.items && typeof watchDoc.items === "object" ? watchDoc.items : {};
  const sent = Array.isArray(alerted) ? alerted.map(String) : [];
  const peso = (n) => "₱" + Math.round(n).toLocaleString("en-PH");
  const hits = [];
  Object.keys(items).sort().forEach((id) => {
    const r = core.fareWatch(items[id], latest, fx, now);
    if (!r || !r.hit) return;
    const key = id + "|" + r.best.fare.id + "|" + r.best.php;
    if (sent.indexOf(key) < 0) hits.push({key, text: r.watch.city + " ≈ " + peso(r.best.php) + " (" + core.tripLabel(r.best.fare, now) + "), at or under your " + peso(r.watch.target)});
  });
  if (!hits.length) return null;
  return {keys: hits.map((h) => h.key), line: "Fare watch: " + hits.slice(0, 2).map((h) => h.text).join(" · ") + (hits.length > 2 ? " · +" + (hits.length - 2) + " more" : "")};
}

// The calls a push just asked about, added to those asked before; a key is
// forgotten after 60 days, so a call still open two months on is asked again.
function askedAfter(asked, items, dayKey) {
  const out = {};
  const cutoff = new Date(Date.parse(dayKey + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  Object.keys(asked && typeof asked === "object" ? asked : {}).forEach((key) => {
    if (String(asked[key]) >= cutoff) out[key] = asked[key];
  });
  (Array.isArray(items) ? items : []).filter(asksOnce).forEach((item) => { out[askKey(item)] = dayKey; });
  return out;
}

// One morning push a day, then only what cannot wait: a meeting starting
// within three hours (score 95 in command-center-core addMeetings) that today's
// pushes have not carried. pushed: {day, ids} of what today's pushes carried.
function urgentItems(items, pushed, dayKey) {
  const ids = pushed && pushed.day === dayKey && Array.isArray(pushed.ids) ? pushed.ids : [];
  return (Array.isArray(items) ? items : []).filter((item) =>
    item && item.source === "Meetings" && Number(item.score) >= 95 && ids.indexOf(String(item.id)) < 0);
}

// "morning", "urgent" or "" (nothing to send). The morning push goes at the
// first run out of quiet hours with anything at all to say.
function pushKind(state, dayKey, content, urgent) {
  state = state || {};
  content = content || {};
  if (state.morningDay !== dayKey) {
    const any = (content.items || []).length || (content.reminders || []).length || (content.asks || []).length ||
      content.today || content.weekly || content.experiment || content.commitment || content.pse || content.fares;
    return any ? "morning" : "";
  }
  return (urgent || []).length ? "urgent" : "";
}

// The morning push's lead, added to recent leads; kept 14 days.
function ledAfter(led, item, dayKey) {
  const out = {};
  const cutoff = new Date(Date.parse(dayKey + "T00:00:00Z") - 14 * 86400000).toISOString().slice(0, 10);
  Object.keys(led && typeof led === "object" ? led : {}).forEach((key) => { if (String(led[key]) >= cutoff) out[key] = led[key]; });
  if (item) out[askKey(item)] = dayKey;
  return out;
}

function pushedAfter(pushed, items, dayKey) {
  const ids = pushed && pushed.day === dayKey && Array.isArray(pushed.ids) ? pushed.ids.slice() : [];
  (Array.isArray(items) ? items : []).forEach((item) => { const id = String(item.id || ""); if (id && ids.indexOf(id) < 0) ids.push(id); });
  return {day: dayKey, ids: ids.slice(-40)};
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
  const weeklyLine = extra.weekly ? "\nIt’s Sunday: review your week and set next week’s three." : "";
  const commitment = extra.commitment && extra.commitment.text ? extra.commitment : null;
  const commitmentLine = commitment ? "\nThis week: " + (commitment.text.length > 90 ? commitment.text.slice(0, 89).trimEnd() + "…" : commitment.text) +
    (commitment.ticked ? " · ticked " + commitment.ticked + (commitment.ticked === 1 ? " day" : " days") + " so far" : commitment.elapsed <= 1 ? " · new this week" : " · not ticked yet") : "";
  const toCheck = reminders.length ? reminders[0].metric + (reminders.length > 1 ? " · +" + (reminders.length - 1) + " more" : "") : "";
  if (extra.remindersOnly && toCheck) {
    return {title: test ? "Test · To check today" : "⏰ To check today", body: toCheck + experimentLine + weeklyLine + commitmentLine + sparkLine};
  }
  if (extra.weeklyOnly) {
    return {title: test ? "Test · Your week" : "Your weekly review is ready", body: "A few minutes on Today: score this week’s commitments and set next week’s three. Your week read back is there too." + experimentLine + sparkLine};
  }
  const lead = items[0];
  if (extra.urgent && lead) return {title: test ? "Test · Starting soon" : "Starting soon", body: lead.source + ": " + lead.title};
  const title = test ? "Test · Morning 5" : "Your Morning 5 is ready";
  const reminderLine = toCheck ? "\n⏰ To check: " + toCheck : "";
  const todayLine = extra.today ? "\n" + extra.today : "";
  const askLines = (Array.isArray(extra.asks) ? extra.asks : []).map((item) => "\n" + askLine(item)).join("");
  const watchLine = (extra.pse ? "\n" + extra.pse : "") + (extra.fares ? "\n" + extra.fares : "");
  // The lead, then today's plan and this week, then what is due, then his PSE watchlist and fare watches.
  const lines = todayLine + commitmentLine + askLines + watchLine + reminderLine + experimentLine + weeklyLine + sparkLine;
  if (!lead) return {title, body: lines ? lines.slice(1) : "No priority items currently clear your delivery thresholds."};
  const remaining = Math.max(0, items.length - 1);
  return {
    title,
    body: lead.source + ": " + lead.title + (remaining ? " · +" + remaining + " more" : "") + lines,
  };
}

// This week's commitment for the push, read with the same shared core as
// Today's card (lib/weekly-review-core.js): the one ticked on the fewest days
// so far and not ticked today; ties go to his focus order (money, work,
// health, poker). Like the experiment, it only rides on a push already going out.
function commitmentLine(core, weeks, dayKey) {
  if (!core || typeof core.cleanWeeks !== "function" || !/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) return null;
  const week = core.cleanWeeks(weeks && typeof weeks === "object" ? weeks : {})[core.weekStart(dayKey)];
  const rank = (area) => { const i = core.FOCUS.indexOf(area); return i < 0 ? core.FOCUS.length : i; };
  const open = (week ? week.commitments : []).map((c) => ({c, p: core.progress(c, dayKey)})).filter((x) => !x.p.today)
    .sort((a, b) => a.p.ticked - b.p.ticked || rank(a.c.area) - rank(b.c.area));
  return open.length ? {text: open[0].c.text, area: open[0].c.area, ticked: open[0].p.ticked, elapsed: open[0].p.elapsed} : null;
}

// Sunday's weekly review (Today's "This week" card) is worth one nudge that
// day when there is a week to score or a next week to set.
function weeklyReviewDue(core, weeks, dayKey) {
  if (!core || typeof core.plan !== "function" || !/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) return false;
  if (new Date(dayKey + "T00:00:00Z").getUTCDay() !== 0) return false;
  return core.plan(core.cleanWeeks(weeks && typeof weeks === "object" ? weeks : {}), dayKey).due;
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
  return newReminders(list, notified).length > 0;
}

// Only the reminders no push has carried yet: one overdue for a week was on
// every push from 3 to 11 Oct.
function newReminders(list, notified) {
  const seen = new Set(Array.isArray(notified) ? notified : []);
  return (Array.isArray(list) ? list : []).filter((item) => !seen.has(item.due + "|" + item.metric));
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
  askKey,
  asksOnce,
  selectDeliverable,
  decisionAsks,
  todayLine,
  pseLine,
  fareWatchLine,
  askedAfter,
  urgentItems,
  pushKind,
  ledAfter,
  pushedAfter,
  notificationCopy,
  todaysSparkTitle,
  weeklyReadDue,
  commitmentLine,
  weeklyReviewDue,
  dueReminders,
  dueExperiment,
  reminderIds,
  hasNewReminders,
  newReminders,
};
