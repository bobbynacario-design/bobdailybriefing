'use strict';
// ABS monthly CPI, all groups, annual change (docs/grounding-phase-e.md; decisions
// D-E1 to D-E4). The release page gives the quote; the ABS Data API gives the
// cross-check. No dependencies.
//
// Fails closed. Anything the parser does not recognise is a "blocked" watch
// state that says what it saw, and nothing is published. The one exception is
// the Data API, which is beta: when it cannot be reached, or has no row for the
// month yet, the figure is held for the day (D-E2). That is an ordinary thrown
// error, so the publisher keeps the previous watch state and marks the run's
// health failed. Publishing without the cross-check and adding it later would
// look like a correction.

const crypto = require('crypto');

const SERIES_ID = 'abs_cpi_all_groups_annual_change';
const TITLE = 'CPI, all groups, annual change (Australia)';
const PUBLISHER = 'Australian Bureau of Statistics';
const SITE = 'https://www.abs.gov.au';
const RELEASE_PATH = '/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/';
const LATEST_URL = SITE + RELEASE_PATH + 'latest-release';
// Dataflow ABS,CPI,2.0.0. Key: measure 3 (% change from previous year), index
// 10001 (All groups CPI), 10 (original), region 50 (Australia), monthly.
const API_FLOW = 'ABS,CPI,2.0.0';
const API_KEY = { MEASURE: '3', INDEX: '10001', TSEST: '10', REGION: '50', FREQ: 'M' };
const API_KEY_TEXT = [API_KEY.MEASURE, API_KEY.INDEX, API_KEY.TSEST, API_KEY.REGION, API_KEY.FREQ].join('.');
const API_BASE = 'https://data.api.abs.gov.au/rest/data/' + API_FLOW + '/' + API_KEY_TEXT;
const LICENCE = 'CC BY 4.0. Source: Australian Bureau of Statistics, Consumer Price Index, Australia';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n) => String(n).padStart(2, '0');

// The page changed in a way the parser does not recognise: a "blocked" state.
class SourceChanged extends Error {}
const changed = (message) => new SourceChanged(message);

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)));
}
// The text a reader sees: tags removed, entities decoded, spaces collapsed.
function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
// "July 2026" -> { month: 7, year: 2026 }, or null.
function monthYear(text) {
  const m = /^([A-Z][a-z]+) (\d{4})$/.exec(text);
  const i = m ? MONTHS.indexOf(m[1]) : -1;
  return i < 0 ? null : { month: i + 1, year: Number(m[2]), name: m[1] + ' ' + m[2] };
}
// "26/08/2026" -> "2026-08-26", or null.
function isoFromDmy(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text).trim());
  if (!m) return null;
  const iso = m[3] + '-' + m[2] + '-' + m[1];
  const d = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
// The inner HTML of the first "field__item" of the field whose class names `name`.
function fieldItem(html, name) {
  const at = html.indexOf('field--name-' + name);
  if (at < 0) return null;
  const m = /<div class="field__item">([\s\S]*?)<\/div>/.exec(html.slice(at, at + 2000));
  return m ? m[1] : null;
}

// Read the release page. Returns { period, publishedAt, heading, item, direction,
// valueText, permanentUrl, pageTitle, next } or throws SourceChanged.
function parseReleasePage(html) {
  if (typeof html !== 'string' || !html) throw changed('the page was empty');
  const periodText = textOf(fieldItem(html, 'field-abs-reference-period') || '');
  const period = monthYear(periodText);
  if (!period) throw changed('no "Reference period" month was found (saw "' + periodText.slice(0, 40) + '")');
  const publishedAt = isoFromDmy(textOf(fieldItem(html, 'dynamic-twig-fieldnode-release-or-orig-publish') || ''));
  if (!publishedAt) throw changed('no "Released" date was found');

  // Key statistics: the first paragraph, then straight after it the first list item.
  const ks = html.indexOf('id="key-statistics"');
  if (ks < 0) throw changed('the "Key statistics" section is missing');
  const block = html.slice(ks, ks + 6000);
  const p = /<p>([\s\S]*?)<\/p>\s*<ul[^>]*>\s*<li>([\s\S]*?)<\/li>/.exec(block);
  if (!p) throw changed('"Key statistics" does not open with a paragraph and a list');
  const heading = textOf(p[1]);
  const item = textOf(p[2]);
  const h = /^In the 12 months to ([A-Z][a-z]+ \d{4}):$/.exec(heading);
  if (!h) throw changed('"Key statistics" opens with "' + heading.slice(0, 60) + '", not "In the 12 months to <month>:"');
  if (h[1] !== period.name) throw changed('"Key statistics" is for ' + h[1] + ' but the reference period is ' + period.name);
  const v = /^The Consumer Price Index \(CPI\) (rose|fell) (\d{1,2}(?:\.\d{1,2})?)%(?=[,.\s]|$)/.exec(item);
  if (!v) throw changed('the first key statistic reads "' + item.slice(0, 80) + '"');

  // The page's own permanent address, from its print link: .../jul-2026/print.
  const slug = period.name.slice(0, 3).toLowerCase() + '-' + period.year;
  const printRe = new RegExp('href="' + RELEASE_PATH.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&') + '([a-z]{3}-\\d{4})/print"');
  const pm = printRe.exec(html);
  if (!pm) throw changed('the page does not name its permanent address');
  if (pm[1] !== slug) throw changed('the page\'s permanent address is ' + pm[1] + ', not ' + slug);

  const t = /<title>([\s\S]*?)<\/title>/.exec(html);
  const pageTitle = t ? textOf(t[1]).replace(/\s*\|\s*Australian Bureau of Statistics$/, '') : '';
  if (pageTitle !== 'Consumer Price Index, Australia, ' + period.name) throw changed('the page title is "' + pageTitle.slice(0, 80) + '"');

  // The next release, as the ABS states it (G8). Optional: a page without one
  // still publishes, with no expected date.
  let next = null;
  const n = /Next Release (\d{2}\/\d{2}\/\d{4})\s*<br\s*\/?>\s*<span class="future-release">([^<]+)<\/span>/.exec(html);
  if (n && isoFromDmy(n[1])) next = { date: isoFromDmy(n[1]), title: textOf(n[2]) };

  return {
    period, publishedAt, heading, item, direction: v[1], valueText: v[2],
    permanentUrl: SITE + RELEASE_PATH + slug, pageTitle, next,
  };
}

// Split one CSV line, honouring double quotes.
function csvLine(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

// The OBS_VALUE cell for one month, exactly as the API wrote it. Returns
// { cell } or { missing: true }; throws SourceChanged if the response is not
// the series that was asked for.
function parseApiCsv(csv, observationKey) {
  const lines = String(csv).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw changed('the Data API answered with no rows');
  const head = csvLine(lines[0]);
  const col = {};
  head.forEach((name, i) => { col[name.trim()] = i; });
  ['MEASURE', 'INDEX', 'TSEST', 'REGION', 'FREQ', 'TIME_PERIOD', 'OBS_VALUE'].forEach((name) => {
    if (!(name in col)) throw changed('the Data API response has no ' + name + ' column');
  });
  let found = null;
  lines.slice(1).map(csvLine).forEach((row) => {
    Object.keys(API_KEY).forEach((dim) => {
      if (row[col[dim]] !== API_KEY[dim]) throw changed('the Data API returned ' + dim + ' ' + row[col[dim]] + ', not ' + API_KEY[dim]);
    });
    if (row[col.TIME_PERIOD] === observationKey) {
      if (found) throw changed('the Data API returned ' + observationKey + ' twice');
      found = row[col.OBS_VALUE].trim();
    }
  });
  if (found === null || found === '') return { missing: true };
  if (!/^-?\d+(\.\d+)?$/.test(found)) throw changed('the Data API value for ' + observationKey + ' is "' + found + '"');
  return { cell: found };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// Today's date where the ABS publishes, for "is the next release overdue?".
function sydneyDate(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
function lastDay(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

// Build the observation: a fact record without its identity fields.
function observation(page, apiCell, fetched) {
  const { period } = page;
  const key = period.year + '-' + pad2(period.month);
  const from = new Date(Date.UTC(period.year - 1, period.month, 1)).toISOString().slice(0, 10);
  const to = key + '-' + pad2(lastDay(period.year, period.month));
  const value = Number(page.valueText);
  const licence = LICENCE + ', ' + period.name;
  const apiUrl = API_BASE + '?startPeriod=' + key + '&endPeriod=' + key;
  return {
    seriesId: SERIES_ID, observationKey: key, kind: 'index', title: TITLE,
    value, range: null, unitCode: 'pct', basisCode: 'annual_change',
    scope: { jurisdiction: 'AU', classification: 'All groups CPI', period: { from, to } },
    qualifications: [],
    valueBindings: [{ field: 'value', token: page.valueText, evidenceId: 'release' }],
    observationDate: to, publishedAt: page.publishedAt, effectiveFrom: null, effectiveTo: null,
    evidence: [
      {
        evidenceId: 'release', role: 'release', url: page.permanentUrl, publisher: PUBLISHER, title: page.pageTitle,
        // "paragraph" is the location in words, for a consumer to print ("Trace:
        // Key statistics"); "selector" is for machines and is never meant for a
        // report. A locator is not content, so adding the words cut no release.
        quote: page.heading + ' ' + page.item, locator: { paragraph: 'Key statistics', selector: '#key-statistics' },
        asOf: page.publishedAt, tier: 'primary', retrievedAt: fetched.at, contentSha256: fetched.pageSha256, licence,
      },
      {
        // The value cell alone: a whole row also carries 7 (from the month), 10,
        // 50 and 25, which a 7% or 10% CPI could match by accident.
        evidenceId: 'api', role: 'cross_check', url: apiUrl, publisher: PUBLISHER,
        title: 'ABS Data API, ' + API_FLOW + ', ' + API_KEY_TEXT + ' (All groups CPI, Australia, % change from previous year)',
        quote: apiCell, locator: { table: API_FLOW + '/' + API_KEY_TEXT, row: key },
        asOf: page.publishedAt, tier: 'primary', retrievedAt: fetched.at, contentSha256: fetched.apiSha256, licence,
      },
    ],
    derivation: null, plausibilityOverride: null, captureMethod: 'page',
  };
}

// The registry's fetch: ({ fetch, now }) -> { observations, status }.
// `fetch` is the publisher's fetchWithIdentity: it sends Daybook's user agent
// and throws on an HTTP error, with a 401/403 reported as "blocked".
async function fetchCpi(ctx) {
  const now = ctx.now;
  const pageRes = await ctx.fetch(LATEST_URL);
  const pageBytes = Buffer.from(await pageRes.arrayBuffer());
  let page;
  try {
    page = parseReleasePage(pageBytes.toString('utf8'));
  } catch (e) {
    if (!(e instanceof SourceChanged)) throw e;
    return { observations: [], status: { state: 'blocked', detail: 'Not published: the ABS release page did not read as expected: ' + e.message + '.', url: LATEST_URL } };
  }
  if (page.direction === 'fell') {
    return { observations: [], status: { state: 'blocked', url: LATEST_URL,
      detail: 'Not published: the ABS reports prices fell ' + page.valueText + '% in the 12 months to ' + page.period.name + '. A fall cannot be bound to an unsigned quote, so capture this month by hand.' } };
  }
  // A release date that has passed while the page still shows the old month.
  if (page.next && sydneyDate(now) > page.next.date) {
    return { observations: [], status: { state: 'overdue', expectedBy: page.next.date, url: LATEST_URL,
      detail: 'The ABS listed ' + page.next.title + ' for ' + page.next.date + '; its page still shows ' + page.period.name + '.' } };
  }

  // The cross-check (D-E2): any failure to read it holds the figure for today.
  const key = page.period.year + '-' + pad2(page.period.month);
  let apiBytes;
  try {
    const apiRes = await ctx.fetch(API_BASE + '?startPeriod=' + key + '&endPeriod=' + key, { headers: { accept: 'application/vnd.sdmx.data+csv' } });
    apiBytes = Buffer.from(await apiRes.arrayBuffer());
  } catch (e) {
    throw new Error('ABS Data API unavailable, so ' + page.period.name + ' is held for today: ' + String(e.message || e).slice(0, 120));
  }
  let api;
  try {
    api = parseApiCsv(apiBytes.toString('utf8'), key);
  } catch (e) {
    if (!(e instanceof SourceChanged)) throw e;
    return { observations: [], status: { state: 'blocked', detail: 'Not published: the ABS Data API did not read as expected: ' + e.message + '.', url: LATEST_URL } };
  }
  if (api.missing) throw new Error('the ABS Data API has no ' + key + ' row yet, so ' + page.period.name + ' is held for today');

  const obs = observation(page, api.cell, { at: now, pageSha256: sha256(pageBytes), apiSha256: sha256(apiBytes) });
  const status = page.next
    ? { expectedBy: page.next.date, url: LATEST_URL, detail: 'Next: ' + page.next.title + ', listed by the ABS for ' + page.next.date + '.' }
    : undefined;
  return { observations: [obs], status };
}

module.exports = {
  SERIES_ID, TITLE, PUBLISHER, LATEST_URL, API_BASE, LICENCE,
  parseReleasePage, parseApiCsv, observation, fetchCpi, sydneyDate, SourceChanged,
};
