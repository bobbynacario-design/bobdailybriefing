"use strict";
// Scout's work calendar, read straight from organisers' own event listings: no
// AI and no web search, so nothing is missed between runs or invented. On 18 Oct
// 2026 three web-search builds found 1 of ANZIIF's 7 Thursday webinars.
//
// Checked 18 Oct 2026 and not read directly: CA ANZ answers scripts with 403;
// CPA Australia and IPA draw their lists in the browser; the Insurance Council
// lists only policyholder consultation days and an in-person conference; SMD
// Lawyers' site shows a hosting "suspended" page. The weekly search covers those
// (SEARCHED), so its work searches go where this cannot.
// The IIA's webinars (added 18 Oct, after Bob said he is a CIA) carry their
// CIA CPE hours; IIA Philippines answers scripts with 403.
const Core = require("./scout-core");

const SOURCES = [
  {id: "anziif-webinars", organizer: "ANZIIF", label: "ANZIIF webinars", kind: "sxa", page: "https://anziif.com/professional-development/webinars", origin: "https://anziif.com"},
  {id: "anziif-events", organizer: "ANZIIF", label: "ANZIIF events", kind: "sxa", page: "https://anziif.com/professional-development/events", origin: "https://anziif.com"},
  {id: "aicla", organizer: "AICLA", label: "AICLA events", kind: "tribe", api: "https://aicla.org/wp-json/tribe/events/v1/events", origin: "https://aicla.org"},
  {id: "iia-webinars", organizer: "IIA", label: "IIA webinars", kind: "iia", page: "https://www.theiia.org/en/learning/online/webinars/", origin: "https://www.theiia.org"},
];
const SEARCHED_BODIES = ["CA ANZ", "CPA Australia", "IPA", "the Insurance Council of Australia"];
const SEARCHED = SEARCHED_BODIES.concat("the law firms in your accounts");
const UA = "Mozilla/5.0 (compatible; DaybookScout/1.0; event calendar)";
const MONTHS = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
const ENTITIES = {amp: "&", quot: "\"", apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", hellip: "..."};

// Display text from an HTML fragment: tags out, entities decoded, spaces collapsed.
function plain(html) {
  return String(html || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] || m)
    .replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}
const pad = (n) => ("0" + n).slice(-2);
function iso(y, m, d) { return Core.date(y + "-" + pad(m) + "-" + pad(d)); }
function month(word) { return MONTHS[String(word || "").slice(0, 3).toLowerCase()] || 0; }

// "Thursday, 15 October 2026, 12:00 PM - 1:00 PM AEDT", "Tue 17 Nov 2026, 8:00 am - ...",
// "11-12 February 2027", "13 - 14 October 2026, 8:30 ...", "30 Nov - 1 Dec 2026",
// and the IIA's "Nov 04, 2026".
function parseWhen(text) {
  const s = plain(text);
  let start = "", end = "", at = -1, len = 0, m;
  if ((m = /(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*-\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/.exec(s)) && month(m[2]) && month(m[4])) {
    start = iso(m[5], month(m[2]), m[1]); end = iso(m[5], month(m[4]), m[3]); at = m.index; len = m[0].length;
  } else if ((m = /(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s+([A-Za-z]{3,9})\.?\s+(\d{4})/.exec(s)) && month(m[3])) {
    start = iso(m[4], month(m[3]), m[1]); end = m[2] ? iso(m[4], month(m[3]), m[2]) : start; at = m.index; len = m[0].length;
  } else if ((m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s)) && month(m[1])) {
    start = end = iso(m[3], month(m[1]), m[2]); at = m.index; len = m[0].length;
  }
  if (!start || !end || end < start) return null;
  const rest = s.slice(at + len);
  // "8:00 am" or "12:00 PM"; a listing cut short ("8:30 ...") keeps a bare 24-hour time.
  const t = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b/i.exec(rest), bare = /(?:^|[\s,])([01]?\d|2[0-3]):([0-5]\d)(?!\s*[ap]\.?\s?m)/i.exec(rest);
  let time = "";
  if (t && +t[1] >= 1 && +t[1] <= 12) time = pad(+t[1] % 12 + (/p/i.test(t[3]) ? 12 : 0)) + ":" + (t[2] || "00");
  else if (bare) time = pad(+bare[1]) + ":" + bare[2];
  const z = /\b(AEDT|AEST|ACDT|ACST|AWST|NZDT|NZST)\b/.exec(rest);
  return {start, end, time, zone: z ? z[1] : ""};
}

// The zone of an Australian or New Zealand city on a date, for listings that
// give a local time without one. Daylight saving runs from the first Sunday in
// October to the first Sunday in April (NSW, Vic, ACT, Tas, SA) and from the
// last Sunday in September (NZ); Queensland, WA and the NT have none.
function sunday(y, m, nth) {
  const first = new Date(Date.UTC(y, m - 1, 1)), offset = (7 - first.getUTCDay()) % 7;
  if (nth > 0) return iso(y, m, 1 + offset + 7 * (nth - 1));
  const last = new Date(Date.UTC(y, m, 0));
  return iso(y, m, last.getUTCDate() - last.getUTCDay());
}
function cityZone(place, day) {
  const p = String(place || "").toLowerCase(), y = +String(day).slice(0, 4);
  if (!Core.date(day)) return "";
  const auDst = day >= sunday(y, 10, 1) || day < sunday(y, 4, 1), nzDst = day >= sunday(y, 9, -1) || day < sunday(y, 4, 1);
  if (/sydney|\bsyd\b|\bsyd\.|melbourne|canberra|hobart|newcastle|wollongong|geelong|terrigal|central coast/.test(p)) return auDst ? "AEDT" : "AEST";
  if (/brisbane|gold coast|sunshine coast|cairns|townsville|toowoomba/.test(p)) return "AEST";
  if (/adelaide/.test(p)) return auDst ? "ACDT" : "ACST";
  if (/darwin/.test(p)) return "ACST";
  if (/perth/.test(p)) return "AWST";
  if (/auckland|wellington|christchurch/.test(p)) return nzDst ? "NZDT" : "NZST";
  return "";
}

// US time for the IIA's "ET" (and "CT", "PT"): daylight saving from the second
// Sunday in March to the first Sunday in November.
function usZone(label, day) {
  const y = +String(day).slice(0, 4), dst = Core.date(day) && day >= sunday(y, 3, 2) && day < sunday(y, 11, 1);
  return ({ET: dst ? "EDT" : "EST", CT: dst ? "UTC-05:00" : "UTC-06:00", PT: dst ? "PDT" : "UTC-08:00"})[label] || label;
}

function event(src, fields) {
  const zone = fields.zone || (fields.format !== "online" ? cityZone(fields.location, fields.start) : "");
  return Object.assign({source: src.id, organizer: src.organizer, cost: "", cpd: "", access: "", summary: ""}, fields,
    {zone, pht: Core.phtTime(fields.start, fields.time, zone, fields.location)});
}

// "1 CIP Points" -> "1 CIP point"; "Up to 8.0 CIP Points" -> "Up to 8 CIP points".
function cipText(text) {
  const m = /^(.*?)([\d.]+)\s*CIP Points?$/i.exec(String(text || "").trim());
  if (!m) return "";
  const n = parseFloat(m[2]);
  return m[1] + n + " CIP point" + (n === 1 ? "" : "s");
}
// ANZIIF (Sitecore SXA): the listing page names its search's settings; the
// search answers with one HTML card per item.
function sxaQuery(html) {
  const props = [...String(html || "").matchAll(/data-properties='([^']+)'/g)].map((m) => {
    try { return JSON.parse(m[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&")); } catch (e) { return null; }
  }).filter((p) => p && /\/sxa\/search\/results\//.test(p.endpoint || "") && p.s && p.itemid && p.v);
  const q = props.find((p) => p.defaultSortOrder) || props[props.length - 1];
  return q ? {s: q.s, itemid: q.itemid, v: q.v, o: q.defaultSortOrder || "Anziif Date,Ascending"} : null;
}
function parseSxa(json, src) {
  return ((json && json.Results) || []).map((r) => {
    const h = String(r.Html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<svg[\s\S]*?<\/svg>/gi, "");
    const pick = (re) => { const m = re.exec(h); return m ? plain(m[1]) : ""; };
    const title = pick(/class="(?:field-title|event-title)"[^>]*>([\s\S]*?)<\/h[1-6]>/);
    const badge = pick(/class="event-badge"[^>]*>([\s\S]*?)<\/span>/) || pick(/class="field-tile-info"[^>]*>\s*<p>([\s\S]*?)<\/p>/);
    const whenHtml = (/class="event-date"[^>]*>([\s\S]*?)<\/span>/.exec(h) || /class="field-date"[^>]*>[\s\S]*?<h5>([\s\S]*?)<\/h5>/.exec(h) || [])[1] || "";
    const when = parseWhen(whenHtml.split(/<br/i)[0]);
    const location = pick(/class="event-location"[^>]*>([\s\S]*?)<\/span>/);
    const points = pick(/class="event-points"[^>]*>([\s\S]*?)<\/span>/) || pick(/<h5>\s*([^<]*CIP Points?)\s*<\/h5>/i);
    const format = /webinar|virtual/i.test(badge) ? "online" : /hybrid/i.test(badge) ? "hybrid" : "in-person";
    let link = ""; try { link = new URL(r.Url, src.origin).href; } catch (e) { link = ""; }
    if (!title || !link || !when) return null;
    return event(src, {title, url: link, start: when.start, end: when.end, time: when.time, zone: when.zone, format,
      location: location || (format === "online" ? "Online" : ""), cpd: cipText(points),
      summary: pick(/class="field-introduction"[^>]*>([\s\S]*?)<\/div>/)});
  }).filter(Boolean);
}

// AICLA (WordPress, The Events Calendar): a JSON list with local start times and zones.
function parseTribe(json, src) {
  return ((json && json.events) || []).map((e) => {
    const title = plain(e.title), venue = plain(e.venue && e.venue.venue), city = plain(e.venue && e.venue.city), desc = plain(e.description);
    const online = /webinar|online|virtual|zoom|teams|live ?stream/i.test(title + " " + venue);
    const start = Core.date(String(e.start_date || "").slice(0, 10)), end = Core.date(String(e.end_date || "").slice(0, 10)) || start;
    if (!title || !start || !/^https:\/\//.test(e.url || "")) return null;
    const cpd = /CPD:?\s*([\d.]+)\s*points?/i.exec(desc);
    return event(src, {title, url: e.url, start, end, time: e.all_day ? "" : String(e.start_date).slice(11, 16),
      zone: /^[A-Z]{3,5}$/.test(e.timezone_abbr || "") ? e.timezone_abbr : "", format: online ? "online" : "in-person",
      location: online ? "Online" : [venue, city].filter(Boolean).join(", "), cost: plain(e.cost).replace(/\$/g, "A$"),
      cpd: cpd ? src.organizer + " CPD " + cpd[1] + " point" + (+cpd[1] === 1 ? "" : "s") : "",
      access: Core.membersOnly(desc.toLowerCase()) ? "members" : "", summary: plain(e.excerpt) || desc.slice(0, 220)});
  }).filter(Boolean);
}

// The IIA's webinar listing: one card per webinar with its date and CPE
// credits (archived recordings have no date and are left out); the full title
// is the card image's alt text. A webinar's own page gives its time in US time.
function parseIia(html, src) {
  const seen = {};
  return String(html || "").split('<div class="article-wrap">').slice(1).map((card) => {
    const pick = (re) => { const m = re.exec(card); return m ? plain(m[1]) : ""; };
    let link = ""; try { link = new URL((/href="([^"]+)"/.exec(card) || [])[1], src.origin).href; } catch (e) { link = ""; }
    const when = parseWhen(pick(/class="res-article-date"[^>]*>(?:\s*<img[^>]*>)?\s*([^<]+)</));
    const title = pick(/<img[^>]*alt="([^"]*)"/) || pick(/class="res-article-sub-title"[^>]*>([\s\S]*?)<\/div>/);
    const credits = parseFloat((/CPE Credits:\s*([\d.]+)/i.exec(card) || [])[1]) || 0;
    const modality = pick(/class="res-article-detail"[^>]*>(?:\s*<img[^>]*>)?\s*([^<]+)</);
    if (!when || !title || !/^https:\/\//.test(link) || seen[link]) return null;
    seen[link] = true;
    return {title, url: link, start: when.start, end: when.end, time: "", zone: "", format: /person/i.test(modality) ? "in-person" : /hybrid/i.test(modality) ? "hybrid" : "online",
      location: /person/i.test(modality) ? "" : "Online", cpeHours: credits, cpd: credits ? "IIA CPE " + credits + " hour" + (credits === 1 ? "" : "s") : ""};
  }).filter(Boolean);
}
// "DATE: Nov 4, 2026 TIME: 1:00 PM-2:00 PM ET" on a webinar's page. The page
// also carries the text escaped twice ("PM&amp;ndash;2:00"), so it is decoded twice.
function iiaTime(html) {
  const m = /TIME:\s*(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?.{0,30}?\b(ET|EST|EDT|CT|PT)\b/i.exec(plain(plain(html)));
  if (!m) return null;
  return {time: pad(+m[1] % 12 + (/p/i.test(m[3]) ? 12 : 0)) + ":" + (m[2] || "00"), zone: m[4].toUpperCase().replace(/^E[SD]T$/, "ET")};
}

async function fetchText(url, fetchImpl, ms) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url, {redirect: "follow", signal: AbortSignal.timeout(ms), headers: {"User-Agent": UA, Accept: "text/html,application/json"}});
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "no response"));
      return await res.text();
    } catch (e) { last = e; }
  }
  throw last;
}
const READERS = {
  async sxa(src, fetchImpl, day, ms) {
    const q = sxaQuery(await fetchText(src.page, fetchImpl, ms));
    if (!q) throw new Error("search settings not found on the page");
    const url = src.origin + "/sxa/search/results/?s=" + encodeURIComponent(q.s) + "&itemid=" + encodeURIComponent(q.itemid) +
      "&sig=&autoFireSearch=true&v=" + encodeURIComponent(q.v) + "&p=50&o=" + encodeURIComponent(q.o);
    return parseSxa(JSON.parse(await fetchText(url, fetchImpl, ms)), src);
  },
  async tribe(src, fetchImpl, day, ms) {
    return parseTribe(JSON.parse(await fetchText(src.api + "?per_page=50&start_date=" + day, fetchImpl, ms)), src);
  },
  async iia(src, fetchImpl, day, ms) {
    const rows = parseIia(await fetchText(src.page, fetchImpl, ms), src).filter((r) => r.end >= day).slice(0, 15);
    return Promise.all(rows.map(async (r) => {
      let t = null; try { t = iiaTime(await fetchText(r.url, fetchImpl, ms)); } catch (e) { t = null; }
      return event(src, Object.assign(r, t ? {time: t.time, zone: usZone(t.zone, r.start)} : {}));
    }));
  },
};

// Every source's dated events from today to 120 days out, and how each source
// went: a source that fails keeps its last good events (see Core.mergeCalendar).
async function collect(fetchImpl, day, opts) {
  opts = opts || {};
  const until = new Date(Date.parse(day + "T00:00:00Z") + 120 * 86400000).toISOString().slice(0, 10);
  const runs = await Promise.all((opts.sources || SOURCES).map(async (src) => {
    try {
      const rows = (await READERS[src.kind](src, fetchImpl, day, opts.ms || 20000)).filter((e) => e.end >= day && e.start <= until);
      return {rows, status: {id: src.id, label: src.label, organizer: src.organizer, ok: true, count: rows.length}};
    } catch (e) {
      return {rows: [], status: {id: src.id, label: src.label, organizer: src.organizer, ok: false, count: 0, error: String(e && e.message || e).slice(0, 140)}};
    }
  }));
  return {events: runs.flatMap((r) => r.rows), sources: runs.map((r) => r.status), searched: SEARCHED};
}

module.exports = {SOURCES, SEARCHED, SEARCHED_BODIES, plain, parseWhen, cityZone, usZone, sxaQuery, parseSxa, parseTribe, parseIia, iiaTime, collect};
