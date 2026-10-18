const {test} = require("node:test");
const assert = require("node:assert/strict");
const S = require("./scout-sources");
// Trimmed copies of the real responses read on 18 Oct 2026 (ANZIIF's listing
// page and search answers, AICLA's events API).
const data = require("./scout-sources.test-data.json");
const [webinars, events, aicla] = S.SOURCES;

test("Scout reads the dates, times and zones organisers publish", () => {
  assert.deepEqual(S.parseWhen("Thursday, 29 October 2026, 12:00 PM - 1:00 PM AEDT"), {start: "2026-10-29", end: "2026-10-29", time: "12:00", zone: "AEDT"});
  assert.deepEqual(S.parseWhen("Tue 17 Nov 2026, 8:00 am - ..."), {start: "2026-11-17", end: "2026-11-17", time: "08:00", zone: ""});
  assert.deepEqual(S.parseWhen("11-12 February 2027"), {start: "2027-02-11", end: "2027-02-12", time: "", zone: ""});
  assert.deepEqual(S.parseWhen("13 - 14 October 2026, 8:30 ..."), {start: "2026-10-13", end: "2026-10-14", time: "08:30", zone: ""});
  assert.deepEqual(S.parseWhen("30 Nov - 1 Dec 2026, 9 am AEDT"), {start: "2026-11-30", end: "2026-12-01", time: "09:00", zone: "AEDT"});
  assert.equal(S.parseWhen("12:30 PM, 3 Mo 2026"), null);assert.equal(S.parseWhen("Virtual (Zoom)"), null);assert.equal(S.parseWhen("31 February 2027"), null);
  assert.equal(S.cityZone("Doltone House Hyde Park Syd...", "2026-11-17"), "AEDT");assert.equal(S.cityZone("Pullman Sydney", "2026-06-15"), "AEST");
  assert.equal(S.cityZone("The Star Brisbane", "2026-11-13"), "AEST");assert.equal(S.cityZone("Royal Perth Golf Club", "2026-11-05"), "AWST");
  assert.equal(S.cityZone("Adelaide Oval", "2026-10-03"), "ACST", "daylight saving starts on the first Sunday in October (4 Oct 2026)");
  assert.equal(S.cityZone("Adelaide Oval", "2026-10-04"), "ACDT");assert.equal(S.cityZone("Auckland", "2026-11-10"), "NZDT");assert.equal(S.cityZone("Manila", "2026-11-10"), "");
});

test("Scout reads ANZIIF's listing: its search settings, then each webinar and event card", () => {
  assert.deepEqual(S.sxaQuery(data.page), {s: "{0161FFB3-B58F-488B-9CA4-1A108BC4A2D8}", itemid: "{A5FAD651-727F-4E92-B4A8-444E7DD186F2}", v: "{0766CA96-4C8B-4C42-971F-0600D0981058}", o: "Anziif Date,Ascending"},
    "the listing's search, not the site search box");
  assert.equal(S.sxaQuery("<p>no search here</p>"), null);
  const [w] = S.parseSxa({Results: [data.webinar]}, webinars);
  assert.equal(w.title, "Thursday Thought-Leaders: The Affordability Pincer | How Inflation and Cost-of-Living Pressures are Reshaping Australia’s General Insurance Market");
  assert.equal(w.url, "https://anziif.com/professional-development/webinars/how-inflation-and-cost-of-living-pressures-are-reshaping-australias-general-insurance-market");
  assert.deepEqual([w.start, w.time, w.zone, w.pht, w.format, w.location, w.cpd, w.organizer, w.source], ["2026-10-29", "12:00", "AEDT", "09:00 PHT (12:00 AEDT)", "online", "Online", "1 CIP point", "ANZIIF", "anziif-webinars"]);
  assert.match(w.summary, /claims inflation pressures/);
  const rows = S.parseSxa({Results: [data.hybrid, data.virtual, data.summit]}, events);
  assert.equal(rows.length, 2, "the undated virtual simulation is left out");
  assert.deepEqual([rows[0].title, rows[0].format, rows[0].start, rows[0].zone, rows[0].pht, rows[0].cpd], ["Australian Liability Conference 2026", "hybrid", "2026-11-17", "AEDT", "05:00 PHT (08:00 AEDT)", "6 CIP points"],
    "a Sydney listing without a zone takes Sydney's");
  assert.deepEqual([rows[1].title, rows[1].format, rows[1].start, rows[1].end, rows[1].cpd], ["ANZIIF International Summit", "in-person", "2027-02-11", "2027-02-12", "Up to 8 CIP points"]);
});

test("Scout reads AICLA's events API: online or in person, cost in A$, CPD points and members-only", () => {
  const [web, seminar] = S.parseTribe({events: data.aicla}, aicla);
  assert.deepEqual([web.title, web.format, web.start, web.time, web.zone, web.pht, web.location, web.cpd, web.access],
    ["AICLA NSW/ACT Webinar - Utmost Good Faith, Misrepresentation & Non-Disclosure", "online", "2026-10-21", "13:00", "AEDT", "10:00 PHT (13:00 AEDT)", "Online", "AICLA CPD 1 point", "members"]);
  assert.deepEqual([seminar.title, seminar.format, seminar.cost, seminar.location, seminar.access], ["SA/NT Seminar: Recovery 101", "in-person", "A$10.00 - A$20.00", "Alma Tavern, Norwood", ""]);
  assert.equal(S.parseTribe({events: [{...data.aicla[0], url: "http://aicla.org/x"}]}, aicla).length, 0, "https links only");
});

test("Scout collects every source, keeps a failed one's status, and stays inside its window", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url); assert.ok(opts.signal); assert.match(opts.headers["User-Agent"], /DaybookScout/);
    if (url.includes("aicla")) return {ok: false, status: 503, text: async () => ""};
    if (url.includes("/sxa/search/results/")) return {ok: true, text: async () => JSON.stringify({Results: url.includes("0161FFB3") ? [data.webinar] : [data.hybrid, data.summit]})};
    return {ok: true, text: async () => data.page.replace(/0161FFB3/g, url.includes("events") ? "EVENTS00" : "0161FFB3")};
  };
  const out = await S.collect(fetchImpl, "2026-10-18", {ms: 1000});
  assert.deepEqual(out.sources.map((s) => [s.id, s.ok, s.count]), [["anziif-webinars", true, 1], ["anziif-events", true, 2], ["aicla", false, 0]]);
  assert.match(out.sources[2].error, /HTTP 503/);
  assert.deepEqual(out.events.map((e) => e.title.slice(0, 22)), ["Thursday Thought-Leade", "Australian Liability C", "ANZIIF International S"], "the summit (11 Feb) is 116 days out");
  assert.equal(calls.filter((u) => u.includes("aicla")).length, 2, "a failed source is tried twice");
  assert.deepEqual((await S.collect(fetchImpl, "2026-10-01", {ms: 1000})).events.map((e) => e.start), ["2026-10-29", "2026-11-17"], "133 days out is beyond the window");
  assert.deepEqual((await S.collect(fetchImpl, "2026-11-18", {ms: 1000})).events.map((e) => e.start), ["2027-02-11"], "events that have ended are left out");
  assert.ok(S.SEARCHED.includes("CA ANZ"));
});
