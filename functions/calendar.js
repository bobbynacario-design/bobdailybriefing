"use strict";

// functions/calendar.js
//
// Bob's calendars, read from their secret iCal links: Google Calendar's
// "Secret address in iCal format" and Outlook's published ICS link. He pastes
// them on the About you page; they are read-only by design and never expire.
// Twice a day the server reads them and keeps only the meetings in the next
// 36 hours whose title names one of his accounts (Suncorp, QBE, AAMI…).
// Nothing else from a calendar is kept: unmatched events are counted, never
// stored, and descriptions, dial-in links and guests are never read out.
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

// Every timed event that overlaps [fromMs, toMs]: recurring ones expanded,
// moved occurrences at their new time, cancelled ones and all-day ones left out.
// [{uid, start, end, title}] with ISO times.
function eventsBetween(icsText, fromMs, toMs) {
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
  const cancelled = (component) => text(component.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED";
  const out = [];
  const keep = (uid, start, end, title, component) => {
    if (cancelled(component)) return;
    const s = start.toJSDate().getTime(), e = end ? end.toJSDate().getTime() : s;
    if (e < fromMs || s > toMs) return;
    out.push({uid, start: new Date(s).toISOString(), end: new Date(e).toISOString(), title: clip(title, 160)});
  };
  vevents.forEach((vevent) => {
    if (vevent.hasProperty("recurrence-id")) return;
    const event = new ICAL.Event(vevent);
    if (!event.startDate || event.startDate.isDate) return; // all-day: holidays, leave, not meetings
    const uid = text(event.uid);
    if (!event.isRecurring()) {
      keep(uid, event.startDate, event.endDate, event.summary, vevent);
      return;
    }
    arr(exceptions[uid]).forEach((exception) => {
      try { event.relateException(exception); } catch (error) { /* an orphaned exception is skipped */ }
    });
    const iterator = event.iterator();
    for (let n = 0, next = iterator.next(); next && n < MAX_OCCURRENCES; n++, next = iterator.next()) {
      const details = event.getOccurrenceDetails(next);
      if (details.startDate.toJSDate().getTime() > toMs) break;
      keep(uid, details.startDate, details.endDate, details.item.summary, details.item.component);
    }
  });
  return out.sort((a, b) => a.start.localeCompare(b.start));
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
function readResult(service, events, meetings, error) {
  return error
    ? {service, ok: false, error: clip(error, 160)}
    : {service, ok: true, events: events.length, matched: meetings.length};
}

// What is kept: upcoming matched meetings from every link, soonest first.
function mergeMeetings(lists) {
  const seen = {};
  return arr(lists).reduce((all, list) => all.concat(arr(list)), [])
    .filter((m) => m && !seen[m.id] && (seen[m.id] = true))
    .sort((a, b) => a.start.localeCompare(b.start)).slice(0, MAX_MEETINGS);
}

module.exports = {cleanLink, cleanLinks, eventsBetween, matchMeetings, readResult, mergeMeetings,
  LINK_HOSTS, WINDOW_HOURS, MAX_LINKS, MAX_ICS_BYTES, MAX_MEETINGS};
