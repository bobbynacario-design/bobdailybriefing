"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Cal = require("./calendar");
const {DEFAULT_ACCOUNTS} = require("./briefing-prompt-core");

const accounts = [{name: "Suncorp", aliases: ["AAMI", "GIO"], kind: "insurer"}, {name: "QBE", aliases: [], kind: "insurer"}];
const lines = (rows) => rows.join("\r\n");

// An Outlook-style file: a Windows time-zone name defined in VTIMEZONE (AEST,
// UTC+10, no DST in this sample window), a weekly series with one occurrence
// moved and one cancelled, a one-off meeting, a cancelled meeting and an
// all-day event.
const OUTLOOK = lines([
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN",
  "BEGIN:VTIMEZONE", "TZID:AUS Eastern Standard Time",
  "BEGIN:STANDARD", "DTSTART:16010101T030000", "TZOFFSETFROM:+1000", "TZOFFSETTO:+1000", "END:STANDARD",
  "END:VTIMEZONE",
  // Weekly Thursday catch-up with Suncorp at 10:00 Sydney time.
  "BEGIN:VEVENT", "UID:series-1", "SUMMARY:Suncorp weekly catch-up",
  "DTSTART;TZID=AUS Eastern Standard Time:20260903T100000", "DTEND;TZID=AUS Eastern Standard Time:20260903T103000",
  "RRULE:FREQ=WEEKLY;BYDAY=TH", "EXDATE;TZID=AUS Eastern Standard Time:20260924T100000", "END:VEVENT",
  // The 8 Oct occurrence moved to Friday 9 Oct 14:00.
  "BEGIN:VEVENT", "UID:series-1", "RECURRENCE-ID;TZID=AUS Eastern Standard Time:20261008T100000", "SUMMARY:Suncorp weekly catch-up (moved)",
  "DTSTART;TZID=AUS Eastern Standard Time:20261009T140000", "DTEND;TZID=AUS Eastern Standard Time:20261009T143000", "END:VEVENT",
  "BEGIN:VEVENT", "UID:one-1", "SUMMARY:QBE file review - pole strike", "DTSTART:20261002T000000Z", "DTEND:20261002T010000Z", "END:VEVENT",
  "BEGIN:VEVENT", "UID:gone-1", "SUMMARY:QBE cancelled call", "STATUS:CANCELLED", "DTSTART:20261002T020000Z", "DTEND:20261002T030000Z", "END:VEVENT",
  "BEGIN:VEVENT", "UID:allday-1", "SUMMARY:QBE offsite", "DTSTART;VALUE=DATE:20261002", "DTEND;VALUE=DATE:20261003", "END:VEVENT",
  "BEGIN:VEVENT", "UID:other-1", "SUMMARY:Dentist", "DTSTART:20261002T050000Z", "DTEND:20261002T060000Z", "END:VEVENT",
  "END:VCALENDAR",
]);

test("only the two calendar services are accepted, over https", () => {
  assert.deepEqual(Cal.cleanLink("https://calendar.google.com/calendar/ical/x%40gmail.com/private-abc/basic.ics"),
    {service: "Google", url: "https://calendar.google.com/calendar/ical/x%40gmail.com/private-abc/basic.ics"});
  assert.equal(Cal.cleanLink("https://outlook.office365.com/owa/calendar/abc/def/calendar.ics").service, "Outlook");
  ["http://calendar.google.com/x.ics", "https://evil.example.com/calendar.ics", "https://calendar.google.com.evil.io/x", "not a link", ""].forEach((bad) =>
    assert.equal(Cal.cleanLink(bad), null, bad));
  const links = Cal.cleanLinks(["https://calendar.google.com/a.ics", {url: "https://calendar.google.com/a.ics"}, "https://outlook.live.com/b.ics", "https://outlook.live.com/c.ics"]);
  assert.deepEqual(links.map((l) => l.service), ["Google", "Outlook"], "duplicates dropped, at most two");
});

test("a week of a calendar: recurring meetings expanded, moved and cancelled occurrences honoured, all-day and cancelled events left out", () => {
  const from = Date.parse("2026-10-01T00:00:00Z"), to = Date.parse("2026-10-10T00:00:00Z");
  const events = Cal.eventsBetween(OUTLOOK, from, to);
  assert.deepEqual(events.map((e) => [e.title, e.start]), [
    ["Suncorp weekly catch-up", "2026-10-01T00:00:00.000Z"],      // Thu 1 Oct 10:00 Sydney = 00:00 UTC
    ["QBE file review - pole strike", "2026-10-02T00:00:00.000Z"],
    ["Dentist", "2026-10-02T05:00:00.000Z"],
    ["Suncorp weekly catch-up (moved)", "2026-10-09T04:00:00.000Z"], // the 8 Oct one, moved to Fri 14:00 Sydney
  ]);
  const earlier = Cal.eventsBetween(OUTLOOK, Date.parse("2026-09-20T00:00:00Z"), Date.parse("2026-09-26T00:00:00Z"));
  assert.equal(earlier.length, 0, "the 24 Sep occurrence was excluded (EXDATE)");
});

test("only meetings naming one of his accounts are kept, with a stable id", () => {
  const from = Date.parse("2026-10-01T00:00:00Z"), to = from + Cal.WINDOW_HOURS * 3600000;
  const events = Cal.eventsBetween(OUTLOOK, from, to);
  const meetings = Cal.matchMeetings(events, accounts, "Outlook");
  assert.deepEqual(meetings.map((m) => [m.title, m.accounts.join(",")]), [["Suncorp weekly catch-up", "Suncorp"], ["QBE file review - pole strike", "QBE"]]);
  assert.ok(!meetings.some((m) => /Dentist/.test(m.title)), "an unmatched event is never kept");
  assert.equal(meetings[0].id, Cal.matchMeetings(events, accounts, "Outlook")[0].id, "stable across reads");
  assert.match(meetings[0].id, /^m[0-9a-f]{16}$/);
  assert.equal(Cal.matchMeetings([{uid: "u", start: "2026-10-01T00:00:00Z", title: "AAMI claims huddle"}], accounts, "Google")[0].accounts[0], "Suncorp", "other names count");
  assert.equal(Cal.matchMeetings([{uid: "u", start: "x", title: "Team lunch"}], DEFAULT_ACCOUNTS).length, 0);
});

test("results from both calendars merge without repeats, soonest first; a failed read says why", () => {
  const a = {id: "m1", start: "2026-10-02T00:00:00Z"}, b = {id: "m2", start: "2026-10-01T00:00:00Z"};
  assert.deepEqual(Cal.mergeMeetings([[a], [b, a]]).map((m) => m.id), ["m2", "m1"]);
  assert.deepEqual(Cal.readResult("Google", [1, 2, 3], [a], ""), {service: "Google", ok: true, events: 3, matched: 1});
  assert.deepEqual(Cal.readResult("Outlook", [], [], "HTTP 404"), {service: "Outlook", ok: false, error: "HTTP 404"});
  assert.throws(() => Cal.eventsBetween("not a calendar", 0, 1), "a broken file throws, so the caller can report it");
});

// A Google-style file in Australia/Sydney, across the start of daylight saving
// (Sunday 4 Oct 2026, 02:00 → 03:00): a weekly Friday 09:00 meeting is 23:00
// UTC the day before while on AEST (+10), and 22:00 UTC once on AEDT (+11).
const GOOGLE = lines([
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "BEGIN:VTIMEZONE", "TZID:Australia/Sydney",
  "BEGIN:STANDARD", "TZOFFSETFROM:+1100", "TZOFFSETTO:+1000", "TZNAME:AEST", "DTSTART:19700405T030000", "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU", "END:STANDARD",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+1000", "TZOFFSETTO:+1100", "TZNAME:AEDT", "DTSTART:19701004T020000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU", "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT", "UID:g-1@google.com", "SUMMARY:Allianz BI file catch-up",
  "DTSTART;TZID=Australia/Sydney:20260918T090000", "DTEND;TZID=Australia/Sydney:20260918T093000", "RRULE:FREQ=WEEKLY", "END:VEVENT",
  "END:VCALENDAR",
]);

test("daylight saving: a Sydney meeting keeps its local time when the clocks go forward", () => {
  const events = Cal.eventsBetween(GOOGLE, Date.parse("2026-10-01T00:00:00Z"), Date.parse("2026-10-10T00:00:00Z"));
  assert.deepEqual(events.map((e) => e.start), ["2026-10-01T23:00:00.000Z", "2026-10-08T22:00:00.000Z"], "Fri 2 Oct 09:00 AEST, then Fri 9 Oct 09:00 AEDT");
  const meetings = Cal.matchMeetings(events, [{name: "Allianz", aliases: ["TIO"]}], "Google");
  assert.equal(meetings.length, 2); assert.notEqual(meetings[0].id, meetings[1].id, "each occurrence has its own id");
});

test("a brief is due for a meeting with none yet, from 30 minutes to 30 hours ahead", () => {
  const now = Date.parse("2026-10-01T10:00:00Z"); // 18:00 Manila
  const at = (hours) => new Date(now + hours * 3600000).toISOString();
  const items = [{id: "soon", start: at(0.25)}, {id: "tonight", start: at(2)}, {id: "tomorrow", start: at(14)}, {id: "built", start: at(14), briefId: "mx"},
    {id: "later", start: at(31)}, {id: "past", start: at(-2)}];
  assert.deepEqual(Cal.dueForBriefs(items, now).map((m) => m.id), ["tonight", "tomorrow"]);
  assert.deepEqual(Cal.dueForBriefs(null, now), []);
});
