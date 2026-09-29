'use strict';
// ABS Wage Price Index: the annual change in total hourly rates of pay
// excluding bonuses, all sectors, Australia (docs/grounding-phase-h.md, H-6;
// decisions D-H6-1 to D-H6-4). Three series from one quarterly release:
//   - all industries, seasonally adjusted (the headline);
//   - Construction, original;
//   - Electricity, gas, water and waste services, original.
// Each value is quoted from a table on the release page and cross-checked
// against the ABS Data API's value cell (ABS,WPI,1.2.0), as for the CPI.
// No dependencies.
//
// Fails closed. Anything the parser does not recognise is a "blocked" watch
// state that says what it saw, and nothing is published. The Data API is beta:
// when it cannot be reached, or has no row for the quarter yet, the figures are
// held for the day (an ordinary thrown error; the publisher keeps the previous
// watch state).

const crypto = require('crypto');

const PUBLISHER = 'Australian Bureau of Statistics';
const SITE = 'https://www.abs.gov.au';
const RELEASE_PATH = '/statistics/economy/price-indexes-and-inflation/wage-price-index-australia/';
const LATEST_URL = SITE + RELEASE_PATH + 'latest-release';
// Dataflow ABS,WPI,1.2.0. Key: measure 3 (% change from the same quarter a year
// earlier), index THRPEB (total hourly rates of pay excluding bonuses), sector 7
// (private and public), industry, TSEST (10 original, 20 seasonally adjusted),
// region AUS, quarterly. One request carries all three series.
const API_FLOW = 'ABS,WPI,1.2.0';
const API_BASE = 'https://data.api.abs.gov.au/rest/data/' + API_FLOW + '/3.THRPEB.7.TOT+E+D.10+20.AUS.Q';
const HEADLINE_TABLE = 'All sector WPI, quarterly and annual movement (%), seasonally adjusted (a)';
const INDUSTRY_TABLE = 'Annual and quarterly movement - industries (a)';
const INDUSTRY_NOTE = 'Index series is original, total hourly rates of pay excluding bonuses.';

const SERIES = [
  { seriesId: 'abs_wpi_all_industries_annual_change', title: 'Wage Price Index, all industries, annual change (Australia)',
    industry: 'TOT', tsest: '20', row: null, classification: 'Total hourly rates of pay excluding bonuses; private and public sectors; all industries; seasonally adjusted' },
  { seriesId: 'abs_wpi_construction_annual_change', title: 'Wage Price Index, Construction, annual change (Australia)',
    industry: 'E', tsest: '10', row: 'Construction', classification: 'Total hourly rates of pay excluding bonuses; private and public sectors; Construction; original' },
  { seriesId: 'abs_wpi_electricity_gas_water_waste_annual_change', title: 'Wage Price Index, Electricity, gas, water and waste services, annual change (Australia)',
    industry: 'D', tsest: '10', row: 'Electricity, gas, water and waste services', classification: 'Total hourly rates of pay excluding bonuses; private and public sectors; Electricity, gas, water and waste services; original' },
];
const licence = (periodName) => 'CC BY 4.0. Source: Australian Bureau of Statistics, Wage Price Index, Australia, ' + periodName;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n) => String(n).padStart(2, '0');

// The page changed in a way the parser does not recognise: a "blocked" state.
class SourceChanged extends Error {}
const changed = (message) => new SourceChanged(message);

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
// "26/08/2026" -> "2026-08-26", or null.
function isoFromDmy(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text).trim());
  if (!m) return null;
  const iso = m[3] + '-' + m[2] + '-' + m[1];
  const d = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
function fieldItem(html, name) {
  const at = html.indexOf('field--name-' + name);
  if (at < 0) return null;
  const m = /<div class="field__item">([\s\S]*?)<\/div>/.exec(html.slice(at, at + 2000));
  return m ? m[1] : null;
}
const cells = (rowHtml) => [...rowHtml.matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => textOf(m[2]));
// The table whose caption is exactly `caption`: { head: [...], rows: [[...]] }, or null.
function tableByCaption(html, caption) {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)];
  const t = tables.find((m) => { const c = /<caption[^>]*>([\s\S]*?)<\/caption>/.exec(m[1]); return c && textOf(c[1]) === caption; });
  if (!t) return null;
  const head = /<thead>([\s\S]*?)<\/thead>/.exec(t[1]);
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(t[1]);
  return { head: head ? cells(head[1]) : [], rows: [...(body ? body[1] : '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => cells(r[1])), end: t.index + t[0].length };
}
const PCT = /^-?\d{1,2}\.\d$/;

// Read the release page. Returns { quarter, publishedAt, next, permanentUrl,
// pageTitle, headline: { label, quarterly, annual }, industries: { [name]: { annual, quarterly } } }
// or throws SourceChanged.
function parseReleasePage(html) {
  if (typeof html !== 'string' || !html) throw changed('the page was empty');
  const periodText = textOf(fieldItem(html, 'field-abs-reference-period') || '');
  const pm = /^([A-Z][a-z]+) (\d{4})$/.exec(periodText);
  const month = pm ? MONTHS.indexOf(pm[1]) + 1 : 0;
  if (!pm || [3, 6, 9, 12].indexOf(month) < 0) throw changed('the reference period reads "' + periodText.slice(0, 40) + '", not a quarter\'s last month');
  const year = Number(pm[2]);
  const quarter = { year, month, key: year + '-Q' + (month / 3), name: pm[1] + ' ' + year, label: pm[1].slice(0, 3) + '-' + String(year).slice(2) };
  const publishedAt = isoFromDmy(textOf(fieldItem(html, 'dynamic-twig-fieldnode-release-or-orig-publish') || ''));
  if (!publishedAt) throw changed('no "Released" date was found');
  const t = /<title>([\s\S]*?)<\/title>/.exec(html);
  const pageTitle = t ? textOf(t[1]).replace(/\s*\|\s*Australian Bureau of Statistics$/, '') : '';
  if (pageTitle !== 'Wage Price Index, Australia, ' + quarter.name) throw changed('the page title is "' + pageTitle.slice(0, 80) + '"');
  const slug = pm[1].slice(0, 3).toLowerCase() + '-' + year;
  const print = new RegExp('href="' + RELEASE_PATH.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&') + '([a-z]{3}-\\d{4})/print"').exec(html);
  if (!print) throw changed('the page does not name its permanent address');
  if (print[1] !== slug) throw changed('the page\'s permanent address is ' + print[1] + ', not ' + slug);

  const a = tableByCaption(html, HEADLINE_TABLE);
  if (!a) throw changed('the table "' + HEADLINE_TABLE + '" is missing');
  if (a.head.join('|') !== '|Quarterly (%)|Annual (%)') throw changed('the headline table\'s columns are "' + a.head.join(' | ').slice(0, 80) + '"');
  const last = a.rows[a.rows.length - 1] || [];
  if (last[0] !== quarter.label) throw changed('the headline table ends at "' + String(last[0]).slice(0, 20) + '", not ' + quarter.label);
  if (!PCT.test(last[1] || '') || !PCT.test(last[2] || '')) throw changed('the headline table\'s ' + quarter.label + ' row reads "' + last.join(' ').slice(0, 60) + '"');

  const b = tableByCaption(html, INDUSTRY_TABLE);
  if (!b) throw changed('the table "' + INDUSTRY_TABLE + '" is missing');
  if (b.head.join('|') !== '|Annual change (%)|Quarterly change (%)') throw changed('the industries table\'s columns are "' + b.head.join(' | ').slice(0, 80) + '"');
  // The note under the industries table says what its figures are.
  if (textOf(html.slice(b.end, b.end + 40000)).indexOf(INDUSTRY_NOTE) < 0) throw changed('the industries table no longer says "' + INDUSTRY_NOTE + '"');
  const industries = {};
  b.rows.forEach((r) => { if (r.length === 3) industries[r[0]] = { annual: r[1], quarterly: r[2] }; });

  let next = null;
  const n = /Next Release (\d{2}\/\d{2}\/\d{4})\s*<br\s*\/?>\s*<span class="future-release">([^<]+)<\/span>/.exec(html);
  if (n && isoFromDmy(n[1])) next = { date: isoFromDmy(n[1]), title: textOf(n[2]) };

  return { quarter, publishedAt, next, permanentUrl: SITE + RELEASE_PATH + slug, pageTitle,
    headline: { label: last[0], quarterly: last[1], annual: last[2] }, industries };
}

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
// The OBS_VALUE cells for one quarter, exactly as the API wrote them, keyed
// "INDUSTRY/TSEST". Throws SourceChanged if the answer is not the series asked for.
function parseApiCsv(csv, quarterKey) {
  const lines = String(csv).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw changed('the Data API answered with no rows');
  const col = {};
  csvLine(lines[0]).forEach((name, i) => { col[name.trim()] = i; });
  ['MEASURE', 'INDEX', 'SECTOR', 'INDUSTRY', 'TSEST', 'REGION', 'FREQ', 'TIME_PERIOD', 'OBS_VALUE'].forEach((name) => {
    if (!(name in col)) throw changed('the Data API response has no ' + name + ' column');
  });
  const fixed = { MEASURE: '3', INDEX: 'THRPEB', SECTOR: '7', REGION: 'AUS', FREQ: 'Q' };
  const found = {};
  lines.slice(1).map(csvLine).forEach((row) => {
    Object.keys(fixed).forEach((dim) => {
      if (row[col[dim]] !== fixed[dim]) throw changed('the Data API returned ' + dim + ' ' + row[col[dim]] + ', not ' + fixed[dim]);
    });
    if (row[col.TIME_PERIOD] !== quarterKey) return;
    const key = row[col.INDUSTRY] + '/' + row[col.TSEST];
    if (found[key] !== undefined) throw changed('the Data API returned ' + key + ' for ' + quarterKey + ' twice');
    const cell = row[col.OBS_VALUE].trim();
    if (cell !== '' && !/^-?\d+(\.\d+)?$/.test(cell)) throw changed('the Data API value for ' + key + ' is "' + cell + '"');
    found[key] = cell;
  });
  return found;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function sydneyDate(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
function lastDay(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

// Build one series' observation: a fact record without its identity fields.
function observation(series, page, apiCell, fetched) {
  const q = page.quarter;
  const from = new Date(Date.UTC(q.year - 1, q.month, 1)).toISOString().slice(0, 10);
  const to = q.year + '-' + pad2(q.month) + '-' + pad2(lastDay(q.year, q.month));
  const lic = licence(q.name);
  const text = series.row ? page.industries[series.row].annual : page.headline.annual;
  const quote = series.row
    ? INDUSTRY_TABLE + '. ' + series.row + ': Annual change (%) ' + text + '; Quarterly change (%) ' + page.industries[series.row].quarterly + '.'
    : HEADLINE_TABLE + '. ' + page.headline.label + ': Quarterly (%) ' + page.headline.quarterly + '; Annual (%) ' + text + '.';
  const apiKey = '3.THRPEB.7.' + series.industry + '.' + series.tsest + '.AUS.Q';
  return {
    seriesId: series.seriesId, observationKey: q.key, kind: 'index', title: series.title,
    value: Number(text), range: null, unitCode: 'pct', basisCode: 'annual_change',
    scope: { jurisdiction: 'AU', classification: series.classification, period: { from, to } },
    qualifications: series.row ? [{ text: INDUSTRY_NOTE, evidenceId: 'release' }] : [],
    valueBindings: [{ field: 'value', token: text, evidenceId: 'release' }],
    observationDate: to, publishedAt: page.publishedAt, effectiveFrom: null, effectiveTo: null,
    evidence: [
      {
        evidenceId: 'release', role: 'release', url: page.permanentUrl, publisher: PUBLISHER, title: page.pageTitle,
        quote, locator: { table: series.row ? INDUSTRY_TABLE : HEADLINE_TABLE, row: series.row || page.headline.label },
        asOf: page.publishedAt, tier: 'primary', retrievedAt: fetched.at, contentSha256: fetched.pageSha256, licence: lic,
      },
      {
        // The value cell alone, as for the CPI: a whole row carries other codes.
        evidenceId: 'api', role: 'cross_check', url: 'https://data.api.abs.gov.au/rest/data/' + API_FLOW + '/' + apiKey + '?startPeriod=' + q.key + '&endPeriod=' + q.key,
        publisher: PUBLISHER, title: 'ABS Data API, ' + API_FLOW + ', ' + apiKey + ' (% change from the same quarter a year earlier)',
        quote: apiCell, locator: { table: API_FLOW + '/' + apiKey, row: q.key },
        asOf: page.publishedAt, tier: 'primary', retrievedAt: fetched.at, contentSha256: fetched.apiSha256, licence: lic,
      },
    ],
    derivation: null, plausibilityOverride: null, captureMethod: 'page',
  };
}

// The page and the Data API are read once per publisher run and shared by the
// three series (the publisher passes the same fetch and time to each).
const runs = new WeakMap();
function readRelease(ctx) {
  const prior = runs.get(ctx.fetch);
  if (prior && prior.now === ctx.now) return prior.result;
  const result = (async () => {
    const pageBytes = Buffer.from(await (await ctx.fetch(LATEST_URL)).arrayBuffer());
    let page;
    try { page = parseReleasePage(pageBytes.toString('utf8')); } catch (e) {
      if (!(e instanceof SourceChanged)) throw e;
      return { blocked: 'Not published: the ABS release page did not read as expected: ' + e.message + '.' };
    }
    if (page.next && sydneyDate(ctx.now) > page.next.date) return { page, overdue: true };
    let apiBytes;
    try {
      const url = API_BASE + '?startPeriod=' + page.quarter.key + '&endPeriod=' + page.quarter.key;
      apiBytes = Buffer.from(await (await ctx.fetch(url, { headers: { accept: 'application/vnd.sdmx.data+csv' } })).arrayBuffer());
    } catch (e) {
      throw new Error('ABS Data API unavailable, so ' + page.quarter.name + ' is held for today: ' + String(e.message || e).slice(0, 120));
    }
    try { return { page, api: parseApiCsv(apiBytes.toString('utf8'), page.quarter.key), pageSha256: sha256(pageBytes), apiSha256: sha256(apiBytes) }; } catch (e) {
      if (!(e instanceof SourceChanged)) throw e;
      return { blocked: 'Not published: the ABS Data API did not read as expected: ' + e.message + '.' };
    }
  })();
  runs.set(ctx.fetch, { now: ctx.now, result });
  return result;
}

// The registry's fetch for one series: ({ fetch, now }) -> { observations, status }.
function fetchFor(series) {
  return async function fetchWpi(ctx) {
    const r = await readRelease(ctx);
    if (r.blocked) return { observations: [], status: { state: 'blocked', url: LATEST_URL, detail: r.blocked } };
    const page = r.page;
    if (r.overdue) {
      return { observations: [], status: { state: 'overdue', expectedBy: page.next.date, url: LATEST_URL,
        detail: 'The ABS listed ' + page.next.title + ' for ' + page.next.date + '; its page still shows ' + page.quarter.name + '.' } };
    }
    if (series.row && !page.industries[series.row]) {
      return { observations: [], status: { state: 'blocked', url: LATEST_URL, detail: 'Not published: the industries table has no "' + series.row + '" row.' } };
    }
    const text = series.row ? page.industries[series.row].annual : page.headline.annual;
    if (!PCT.test(text)) return { observations: [], status: { state: 'blocked', url: LATEST_URL, detail: 'Not published: the ' + (series.row || 'headline') + ' figure reads "' + String(text).slice(0, 20) + '".' } };
    const cell = r.api[series.industry + '/' + series.tsest];
    if (!cell) throw new Error('the ABS Data API has no ' + series.industry + '/' + series.tsest + ' row for ' + page.quarter.key + ' yet, so ' + page.quarter.name + ' is held for today');
    const obs = observation(series, page, cell, { at: ctx.now, pageSha256: r.pageSha256, apiSha256: r.apiSha256 });
    const status = page.next ? { expectedBy: page.next.date, url: LATEST_URL, detail: 'Next: ' + page.next.title + ', listed by the ABS for ' + page.next.date + '.' } : undefined;
    return { observations: [obs], status };
  };
}

module.exports = {
  PUBLISHER, LATEST_URL, API_BASE, SERIES, INDUSTRY_NOTE, licence,
  parseReleasePage, parseApiCsv, observation, fetchFor, sydneyDate, SourceChanged,
};
