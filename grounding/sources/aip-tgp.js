'use strict';
// Diesel terminal gate prices (docs/grounding-phase-h.md, H-8), for Daybook
// only: heavy-vehicle loss-of-income context. The Australian Institute of
// Petroleum publishes the average terminal gate price of BP Australia, Ampol,
// Viva Energy Australia and ExxonMobil each weekday, for seven capitals, in
// cents per litre including GST. Its page lists the five most recent weekdays.
//
// One observation per completed week (Bob's D-H8-2): the latest day the table
// lists before the current Sydney week began, normally that week's Friday. The
// table always lists the most recent weekdays in order, so if it lists any day
// of the completed week it lists the rest of that week too; the chosen day is
// that week's last trading day. From Monday to Thursday the previous Friday is
// still on the page. Seven series, one per capital (D-H8-3), all from one read.
//
// Fails closed (blocked, saying what it saw): a changed heading or unit,
// headings that are not weekdays in order, a missing description sentence, a
// missing city row (that city only) or a cell that is not a price. A page that
// cannot be fetched throws, so the publisher holds every series for the day.
//
// AIP's page is "All Rights Reserved" and has no open licence (D-H8-4): only
// the heading, the day, the city and the price are quoted, with attribution.
// There is no second form to cross-check against: the city pages' chart data
// is the same figure to four decimals, and rounding it would be a derivation.

const crypto = require('crypto');

const PUBLISHER = 'Australian Institute of Petroleum';
const PAGE_URL = 'https://aip.com.au/pricing/terminal-gate-prices/';
const PAGE_TITLE = 'Terminal Gate Prices | Australian Institute of Petroleum';
const HEADING = 'Diesel (cents per litre, inclusive of GST)';
// The description's own sentences, carried as qualifications.
const PREPARED = 'This page has been prepared by ORIMA Research Pty Ltd on behalf of the Australian Institute of Petroleum, using information provided by BP Australia, Ampol, Viva Energy Australia and ExxonMobil.';
const AVERAGE = 'Prices shown are the average Terminal Gate Price for unleaded petrol and diesel across each of these companies for the day.';
const COLLATED = 'Prices are generally collated each weekday morning.';
const CITIES = [
  { key: 'sydney', name: 'Sydney', jurisdiction: 'NSW' },
  { key: 'melbourne', name: 'Melbourne', jurisdiction: 'VIC' },
  { key: 'brisbane', name: 'Brisbane', jurisdiction: 'QLD' },
  { key: 'adelaide', name: 'Adelaide', jurisdiction: 'SA' },
  { key: 'darwin', name: 'Darwin', jurisdiction: 'NT' },
  { key: 'perth', name: 'Perth', jurisdiction: 'WA' },
  { key: 'hobart', name: 'Hobart', jurisdiction: 'TAS' },
];
const SERIES = CITIES.map((c) => Object.assign({}, c, {
  seriesId: 'aip_tgp_diesel_' + c.key,
  title: 'Diesel terminal gate price, ' + c.name + ' (AIP average of four wholesalers, incl GST)',
}));
const MONTHS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PRICE = /^\d{2,3}\.\d$/;

function licence(year) {
  return '© Australian Institute of Petroleum ' + year + '. All rights reserved; quoted in part for citation only. Prepared by ORIMA Research for AIP. ' + PAGE_URL;
}

class SourceChanged extends Error {}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const cellText = (html) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// "Friday, 25th September 2026" -> "2026-09-25", checking the weekday.
function headingDay(text) {
  const m = /^(Monday|Tuesday|Wednesday|Thursday|Friday), (\d{1,2})(?:st|nd|rd|th) ([A-Z][a-z]+) (\d{4})$/.exec(text);
  if (!m || !MONTHS[m[3]]) return null;
  const d = new Date(Date.UTC(Number(m[4]), MONTHS[m[3]] - 1, Number(m[2])));
  if (d.getUTCDate() !== Number(m[2]) || WEEKDAYS[d.getUTCDay()] !== m[1]) return null;
  return d.toISOString().slice(0, 10);
}

// The page: { title, days: [{ iso, label }], rows: { Sydney: ['274.7', …] }, notes }.
// Throws SourceChanged when it does not read as AIP's diesel table.
function parsePage(html) {
  const title = (/<title>([^<]*)<\/title>/.exec(html) || [])[1];
  if (!title || cellText(title) !== PAGE_TITLE) throw new SourceChanged('the page title is not "' + PAGE_TITLE + '"');
  const at = html.indexOf('<h2>' + HEADING + '</h2>');
  if (at < 0) throw new SourceChanged('no "' + HEADING + '" heading');
  const end = html.indexOf('</table>', at);
  const table = end > at ? html.slice(at, end) : '';
  const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  if (rows.length < 2) throw new SourceChanged('the diesel table has no rows');
  const head = [...rows[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => cellText(m[1]));
  if (head[0] !== 'Location' || head.length < 4 || head.length > 11) throw new SourceChanged('the diesel table headings read "' + head.join(' | ').slice(0, 120) + '"');
  const days = head.slice(1).map((label) => ({ label, iso: headingDay(label) }));
  const bad = days.find((d) => !d.iso);
  if (bad) throw new SourceChanged('the column "' + bad.label.slice(0, 40) + '" is not a weekday date');
  if (days.some((d, i) => i && d.iso <= days[i - 1].iso)) throw new SourceChanged('the diesel table\'s days are not in order');
  const byCity = {};
  rows.slice(1).forEach((r) => {
    const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cellText(m[1]));
    if (cells.length) byCity[cells[0]] = cells.slice(1);
  });
  const text = cellText(html.slice(end));
  const notes = [PREPARED, AVERAGE, COLLATED];
  const missing = notes.find((n) => text.indexOf(n) < 0);
  if (missing) throw new SourceChanged('the description no longer says "' + missing.slice(0, 60) + '…"');
  return { title: cellText(title), days, rows: byCity, notes };
}

function sydneyDate(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
// The Monday that starts the Sydney week containing `now`.
function weekStart(now) {
  const d = new Date(sydneyDate(now) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
// The day to publish: the latest the table lists before this Sydney week, or null.
function completedWeekDay(days, now) {
  const monday = weekStart(now);
  const earlier = days.filter((d) => d.iso < monday);
  return earlier.length ? earlier[earlier.length - 1] : null;
}

function observation(series, page, day, fetched) {
  const cell = page.rows[series.name][page.days.indexOf(day)];
  return {
    seriesId: series.seriesId, observationKey: day.iso, kind: 'rate', title: series.title,
    value: Number(cell), range: null, unitCode: 'aud_cents_per_litre', basisCode: 'market_rate',
    scope: { jurisdiction: series.jurisdiction, classification: 'Diesel, terminal gate, ' + series.name + '; the day\'s average of four wholesalers; incl GST', period: { from: day.iso, to: day.iso } },
    qualifications: [HEADING].concat(page.notes).map((text) => ({ text, evidenceId: 'table' })),
    valueBindings: [{ field: 'value', token: cell, evidenceId: 'table' }],
    observationDate: day.iso, publishedAt: day.iso, effectiveFrom: null, effectiveTo: null,
    evidence: [{
      evidenceId: 'table', role: 'release', url: PAGE_URL, publisher: PUBLISHER, title: page.title,
      quote: HEADING + ' […] ' + day.label + ' […] ' + series.name + ' […] ' + cell,
      locator: { table: HEADING + ', column "' + day.label + '"', row: series.name },
      asOf: day.iso, tier: 'primary', retrievedAt: fetched.at, contentSha256: fetched.pageSha256, licence: licence(day.iso.slice(0, 4)),
    }],
    derivation: null, plausibilityOverride: null, captureMethod: 'page',
  };
}

// The page is read once per publisher run and shared by the seven series.
const runs = new WeakMap();
function readPage(ctx) {
  const prior = runs.get(ctx.fetch);
  if (prior && prior.now === ctx.now) return prior.result;
  const result = (async () => {
    const bytes = Buffer.from(await (await ctx.fetch(PAGE_URL)).arrayBuffer());
    try { return { page: parsePage(bytes.toString('utf8')), pageSha256: sha256(bytes) }; } catch (e) {
      if (!(e instanceof SourceChanged)) throw e;
      return { blocked: 'Not published: the AIP terminal gate prices page did not read as expected: ' + e.message + '.' };
    }
  })();
  runs.set(ctx.fetch, { now: ctx.now, result });
  return result;
}

// The registry's fetch for one city: ({ fetch, now }) -> { observations, status }.
function fetchFor(series) {
  return async function fetchTgp(ctx) {
    const r = await readPage(ctx);
    if (r.blocked) return { observations: [], status: { state: 'blocked', url: PAGE_URL, detail: r.blocked } };
    const cells = r.page.rows[series.name];
    if (!cells || cells.length !== r.page.days.length) {
      return { observations: [], status: { state: 'blocked', url: PAGE_URL, detail: 'Not published: the diesel table has no complete "' + series.name + '" row.' } };
    }
    const day = completedWeekDay(r.page.days, ctx.now);
    if (!day) return { observations: [] };
    const cell = cells[r.page.days.indexOf(day)];
    if (!PRICE.test(cell)) {
      return { observations: [], status: { state: 'blocked', url: PAGE_URL, detail: 'Not published: ' + series.name + '\'s price for ' + day.label + ' reads "' + cell.slice(0, 20) + '".' } };
    }
    return { observations: [observation(series, r.page, day, { at: ctx.now, pageSha256: r.pageSha256 })] };
  };
}

// The registry entries, added to grounding/series.js only after both consumers
// have re-copied the contract that knows aud_cents_per_litre (H-8 lane 4).
function registryEntries() {
  return SERIES.map((s) => ({
    seriesId: s.seriesId,
    title: s.title,
    capture: 'page',
    publisher: PUBLISHER,
    urls: { page: PAGE_URL },
    licence: licence('[year]'),
    streams: ['hv_loi'],
    // Weekly; 10 days allows one missed Monday-to-Thursday window.
    freshnessDays: 10,
    // The year to 30 September 2026 ran 156 to 327 c/L in Sydney, with a
    // largest week-to-week move of 62.7 (to 13 March 2026).
    bounds: { min: 100, max: 450, maxChange: 80 },
    cadenceHours: 12,
    fetch: fetchFor(s),
  }));
}

module.exports = {
  PUBLISHER, PAGE_URL, HEADING, CITIES, SERIES, licence, headingDay, parsePage, sydneyDate, weekStart, completedWeekDay,
  observation, fetchFor, registryEntries, SourceChanged,
};
