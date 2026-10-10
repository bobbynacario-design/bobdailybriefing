"use strict";

// functions/calendar.js
//
// Bob's calendars, read from their secret iCal links: Google Calendar's
// "Secret address in iCal format" and Outlook's published ICS link. He pastes
// them on the About you page; they are read-only by design and never expire.
// Twice a day the server reads them and keeps the meetings in the next 36
// hours whose title names one of his accounts (Suncorp, QBE, AAMI…), plus
// the title and dates of all-day entries for the next 90 days, so leave and
// public holidays (Zoho People pushes both into Google or Microsoft 365) show
// on the Calendar page. Other timed events are counted, never stored, and
// descriptions, dial-in links and guests are never read out.
//
// PURE apart from the fetch the caller does. ical.js (Mozilla's, behind
// Thunderbird) handles what is easy to get wrong by hand: recurring meetings,
// moved or cancelled occurrences, and time zones, including Outlook's Windows
// names ("AUS Eastern Standard Time") defined in the file's VTIMEZONE blocks.

const {createHash} = require("node:crypto");
const ICALmodule = require("ical.js");
const ICAL = ICALmodule.default || ICALmodule;
const {accountsInText} = require("./briefing-prompt-core");

const WINDOW_HOURS = 36;
const MAX_LINKS = 2;
const MAX_ICS_BYTES = 5 * 1024 * 1024;
const MAX_MEETINGS = 20;
const MAX_OCCURRENCES = 20000;
const DAYS_AHEAD = 90;
const MAX_DAYS = 120;
// Only the two calendar services he uses, over https: the server never
// fetches anything else from a saved link.
const LINK_HOSTS = {
  "calendar.google.com": "Google",
  "outlook.office365.com": "Outlook",
  "outlook.office.com": "Outlook",
  "outlook.live.com": "Outlook",
};

function text(value) {
  return String(value == null ? "" : value).trim();
}
function clip(value, max) {
  const flat = text(value).replace(/\s+/g, " ");
  return flat.length <= max ? flat : flat.slice(0, max - 1).trimEnd() + "…";
}
function arr(value) {
  return Array.isArray(value) ? value : [];
}

// A link he can save, labelled by its service, or null.
function cleanLink(raw) {
  const value = text(raw);
  let url;
  try { url = new URL(value); } catch (error) { return null; }
  const service = LINK_HOSTS[url.hostname.toLowerCase()];
  if (url.protocol !== "https:" || !service || value.length > 1500) return null;
  return {service, url: value};
}
function cleanLinks(raw) {
  const seen = {};
  return arr(raw).map((item) => cleanLink(item && typeof item === "object" ? item.url : item))
    .filter((link) => link && !seen[link.url] && (seen[link.url] = true)).slice(0, MAX_LINKS);
}

// One parse of a calendar file: its events, with moved or cancelled
// occurrences grouped by the series they belong to.
function parseCalendar(icsText) {
  const root = new ICAL.Component(ICAL.parse(String(icsText || "")));
  root.getAllSubcomponents("vtimezone").forEach((zone) => {
    try { ICAL.TimezoneService.register(zone); } catch (error) { /* a broken zone falls back to floating time */ }
  });
  const vevents = root.getAllSubcomponents("vevent");
  const exceptions = {};
  vevents.forEach((vevent) => {
    if (vevent.hasProperty("recurrence-id")) {
      const uid = text(vevent.getFirstPropertyValue("uid"));
      (exceptions[uid] = exceptions[uid] || []).push(vevent);
    }
  });
  return {vevents, exceptions};
}
const cancelled = (component) => text(component.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED";

// Walks every occurrence of the events whose start is all-day (allDay true)
// or timed (false), until past(start) says the window is over. keep() sees
// each occurrence with its own (possibly moved) start, end, title and component.
function occurrences(parsed, allDay, past, keep) {
  parsed.vevents.forEach((vevent) => {
    if (vevent.hasProperty("recurrence-id")) return;
    const event = new ICAL.Event(vevent);
    if (!event.startDate || event.startDate.isDate !== allDay) return;
    const uid = text(event.uid);
    if (!event.isRecurring()) {
      keep(uid, event.startDate, event.endDate, event.summary, vevent);
      return;
    }
    arr(parsed.exceptions[uid]).forEach((exception) => {
      try { event.relateException(exception); } catch (error) { /* an orphaned exception is skipped */ }
    });
    const iterator = event.iterator();
    for (let n = 0, next = iterator.next(); next && n < MAX_OCCURRENCES; n++, next = iterator.next()) {
      const details = event.getOccurrenceDetails(next);
      if (past(details.startDate)) break;
      keep(uid, details.startDate, details.endDate, details.item.summary, details.item.component);
    }
  });
}

function timedBetween(parsed, fromMs, toMs) {
  const out = [];
  occurrences(parsed, false, (start) => start.toJSDate().getTime() > toMs, (uid, start, end, title, component) => {
    if (cancelled(component) || start.isDate) return;
    const s = start.toJSDate().getTime(), e = end ? end.toJSDate().getTime() : s;
    if (e < fromMs || s > toMs) return;
    out.push({uid, start: new Date(s).toISOString(), end: new Date(e).toISOString(), title: clip(title, 160)});
  });
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// "YYYY-MM-DD" of an all-day iCal date.
function isoDay(time) {
  return time.year + "-" + String(time.month).padStart(2, "0") + "-" + String(time.day).padStart(2, "0");
}
function allDayBetween(parsed, fromDay, toDay) {
  const out = [];
  occurrences(parsed, true, (start) => isoDay(start) > toDay, (uid, start, end, title, component) => {
    if (cancelled(component) || !start.isDate) return;
    // An all-day DTEND is the day after the last day; without one it is a single day.
    const first = isoDay(start);
    let last = first;
    if (end && end.isDate) {
      const before = end.clone();
      before.adjust(-1, 0, 0, 0);
      last = isoDay(before) > first ? isoDay(before) : first;
    }
    if (last < fromDay || first > toDay) return;
    out.push({uid, start: first, end: last, title: clip(title, 160)});
  });
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

// Every timed event that overlaps [fromMs, toMs]: recurring ones expanded,
// moved occurrences at their new time, cancelled ones and all-day ones left out.
// [{uid, start, end, title}] with ISO times.
function eventsBetween(icsText, fromMs, toMs) {
  return timedBetween(parseCalendar(icsText), fromMs, toMs);
}

// All-day entries overlapping [fromDay, toDay] (inclusive "YYYY-MM-DD"):
// leave, public holidays, birthdays. Cancelled ones are left out.
// [{uid, start, end, title}] with an inclusive end day.
function daysBetween(icsText, fromDay, toDay) {
  return allDayBetween(parseCalendar(icsText), fromDay, toDay);
}

// Both from one parse, for the twice-daily read.
function readCalendar(icsText, fromMs, toMs, fromDay, toDay) {
  const parsed = parseCalendar(icsText);
  return {events: timedBetween(parsed, fromMs, toMs), days: allDayBetween(parsed, fromDay, toDay)};
}

// Today in Manila and DAYS_AHEAD later, the window for all-day entries.
function dayWindow(now) {
  const parts = {};
  new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"})
    .formatToParts(new Date(now)).forEach((p) => { parts[p.type] = p.value; });
  const fromDay = parts.year + "-" + parts.month + "-" + parts.day;
  const toDay = new Date(Date.parse(fromDay + "T00:00:00Z") + DAYS_AHEAD * 86400000).toISOString().slice(0, 10);
  return {fromDay, toDay};
}

// The all-day entries kept: title and dates only, with a stable id per
// occurrence and the calendar it came from.
function matchDays(days, service) {
  return arr(days).map((d) => ({
    id: "d" + createHash("sha256").update(d.uid + "|" + d.start).digest("hex").slice(0, 16),
    title: d.title, start: d.start, end: d.end, calendar: service || "",
  }));
}

// Both calendars together, soonest first. The same entry pushed to Google
// and Outlook (same title and dates) is kept once.
function mergeDays(lists) {
  const seen = {};
  return arr(lists).reduce((all, list) => all.concat(arr(list)), [])
    .filter((d) => {
      if (!d || !d.id) return false;
      const key = d.title.toLowerCase() + "|" + d.start + "|" + d.end;
      if (seen[d.id] || seen[key]) return false;
      seen[d.id] = seen[key] = true;
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title)).slice(0, MAX_DAYS);
}

// The meetings worth preparing: a title that names one of his accounts.
// The id is stable for an occurrence (uid and its start), so a re-read never
// counts it twice and a brief built for it can find it again.
function matchMeetings(events, accounts, service) {
  return arr(events).map((event) => {
    const names = accountsInText(event.title, accounts);
    if (!names.length) return null;
    return {
      id: "m" + createHash("sha256").update(event.uid + "|" + event.start).digest("hex").slice(0, 16),
      title: event.title, start: event.start, end: event.end, accounts: names.slice(0, 3), calendar: service || "",
    };
  }).filter(Boolean);
}

// One saved link's result, for the doc and the page: what it read and why not.
function readResult(service, events, meetings, error, days) {
  return error
    ? {service, ok: false, error: clip(error, 160)}
    : {service, ok: true, events: events.length, matched: meetings.length, allDay: arr(days).length};
}

// What is kept: upcoming matched meetings from every link, soonest first.
function mergeMeetings(lists) {
  const seen = {};
  return arr(lists).reduce((all, list) => all.concat(arr(list)), [])
    .filter((m) => m && !seen[m.id] && (seen[m.id] = true))
    .sort((a, b) => a.start.localeCompare(b.start)).slice(0, MAX_MEETINGS);
}

// The meetings a brief is built for now: no brief yet, starting between 30
// minutes and 30 hours from now (tomorrow's at the 18:00 run, today's at 06:00).
function dueForBriefs(items, now) {
  return arr(items).filter((m) => m && !m.briefId && Date.parse(m.start) > now + 30 * 60000 && Date.parse(m.start) < now + 30 * 3600000);
}

module.exports = {cleanLink, cleanLinks, eventsBetween, daysBetween, readCalendar, dayWindow, matchMeetings, matchDays, readResult,
  mergeMeetings, mergeDays, dueForBriefs, LINK_HOSTS, WINDOW_HOURS, DAYS_AHEAD, MAX_LINKS, MAX_ICS_BYTES, MAX_MEETINGS, MAX_DAYS};
