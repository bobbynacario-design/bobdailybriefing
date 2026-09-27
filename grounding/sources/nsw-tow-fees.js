'use strict';
// NSW regulated tow truck fees for light vehicles (docs/grounding-phase-h.md,
// H-1; Bob's decision D-H1: publish now). One page, two series:
//   nsw_tow_accident_towing_light   "For any accident towing work"   (a point)
//   nsw_tow_storage_light_daily     light motor vehicle storage per 24 hours,
//                                   outside to inside Sydney metro   (a range)
// The page states the period ("valid for the 2026 to 2027 period") but not the
// next update, so there is no expected date (G8); the series goes stale by its
// freshness rule if the page is not renewed.
//
// Fails closed: anything the parser does not recognise is a "blocked" watch
// state that says what it saw. No dependencies.

const crypto = require('crypto');

const PAGE_URL = 'https://www.nsw.gov.au/legal-and-justice/consumer-rights-and-protection/services/your-rights-when-your-vehicle-towed/tow-truck-fees-for-light-vehicles';
const PUBLISHER = 'NSW Fair Trading';
const LICENCE = 'CC BY 4.0. © State of New South Wales. For current information go to www.nsw.gov.au';
const TOW = { seriesId: 'nsw_tow_accident_towing_light', title: 'NSW accident towing, light vehicles: maximum charge per tow (ex GST)' };
const STORAGE = { seriesId: 'nsw_tow_storage_light_daily', title: 'NSW storage of towed light vehicles: maximum charge per 24 hours (ex GST)' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

class SourceChanged extends Error {}
const changed = (message) => new SourceChanged(message);

function textOf(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}
// "01 July 2026" -> "2026-07-01", or null.
function isoFromDayMonthYear(text) {
  const m = /^(\d{1,2}) ([A-Z][a-z]+) (\d{4})$/.exec(text);
  const i = m ? MONTHS.indexOf(m[2]) : -1;
  return i < 0 ? null : m[3] + '-' + String(i + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0');
}
// The rows of the table that follows the heading `h2`: [[cell, cell], ...].
function tableAfter(html, h2) {
  const at = html.indexOf('<h2>' + h2 + '</h2>');
  if (at < 0) throw changed('the "' + h2 + '" table is missing');
  const end = html.indexOf('</table>', at);
  const table = html.slice(at, end < 0 ? at + 6000 : end);
  const caption = textOf((/<caption>([\s\S]*?)<\/caption>/.exec(table) || [])[1] || '');
  const rows = [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => textOf(c[1])));
  return { caption, header: rows[0] || [], rows: rows.slice(1) };
}
function row(table, label, h2) {
  const r = table.rows.find((cells) => cells[0] === label);
  if (!r) throw changed('the "' + h2 + '" table has no row "' + label + '"');
  const money = /^\$(\d{1,4})$/.exec(r[1] || '');
  if (!money) throw changed('"' + label + '" reads "' + (r[1] || '') + '", not a whole-dollar charge');
  return { label, text: r[1], value: Number(money[1]), token: money[1] };
}

// Read the page. Returns { publishedAt, updatedOn, from, to, intro, gstSentence,
// tow, towTable, storageMetro, storageOther, storageTable, extras } or throws SourceChanged.
function parsePage(html) {
  if (typeof html !== 'string' || !html) throw changed('the page was empty');
  if (!/<h1>Tow truck fees for light vehicles<\/h1>/.test(html)) throw changed('the page heading is not "Tow truck fees for light vehicles"');
  const upd = /<dt>Last updated:<\/dt>\s*<dd>([^<]+)<\/dd>/.exec(html);
  const updatedOn = upd ? isoFromDayMonthYear(textOf(upd[1])) : null;
  if (!updatedOn) throw changed('no "Last updated" date was found');
  const p = /<p>(These fees are valid for the (\d{4}) to (\d{4}) period\. The listed charges exclude any applicable GST\.)/.exec(html);
  if (!p) throw changed('the page does not say "These fees are valid for the <year> to <year> period. The listed charges exclude any applicable GST."');
  const y1 = Number(p[2]), y2 = Number(p[3]);
  if (y2 !== y1 + 1) throw changed('the period "' + y1 + ' to ' + y2 + '" is not one financial year');
  const towTable = tableAfter(html, 'Towing fees');
  const storageTable = tableAfter(html, 'Fees for storage within an authorised holding yard');
  if (!/^Maximum charge for each 24 hours or part of 24 hours$/.test(storageTable.header[1] || '')) throw changed('the storage table\'s charge column reads "' + (storageTable.header[1] || '') + '"');
  const tow = row(towTable, 'For any accident towing work', 'Towing fees');
  const storageMetro = row(storageTable, 'Light motor vehicle (not a motorcycle) in Sydney metropolitan area', 'Fees for storage');
  const storageOther = row(storageTable, 'Light motor vehicle (not a motorcycle) outside Sydney metropolitan area', 'Fees for storage');
  if (storageOther.value > storageMetro.value) throw changed('outside-Sydney storage ($' + storageOther.value + ') is above Sydney metro ($' + storageMetro.value + ')');
  // The rows that qualify the accident towing charge, in the page's own words.
  const extras = towTable.rows.filter((cells) => /in excess of (10|20)km|^Surcharge outside business hours$/.test(cells[0]))
    .map((cells) => cells[0] + ': ' + cells[1]);
  return {
    updatedOn, from: y1 + '-07-01', to: y2 + '-06-30', period: y1 + ' to ' + y2, gstSentence: p[1],
    tow, towTable, storageMetro, storageOther, storageTable, extras,
  };
}

function evidence(page, fetched, quote, locator) {
  return {
    evidenceId: 'page', role: 'release', url: PAGE_URL, publisher: PUBLISHER, title: 'Tow truck fees for light vehicles',
    quote, locator, asOf: page.updatedOn, tier: 'primary', retrievedAt: fetched.at, contentSha256: fetched.sha256, licence: LICENCE,
  };
}
function base(page, series) {
  // publishedAt is the start of the period the page states, not its "Last
  // updated" date: an edit that changes nothing else must not read as a
  // correction. The update date is the evidence's asOf, which is not content.
  return {
    seriesId: series.seriesId, observationKey: page.from, kind: 'regulated_fee', title: series.title,
    basisCode: 'regulated_fee_max', observationDate: page.from, publishedAt: page.from, effectiveFrom: page.from, effectiveTo: page.to,
    derivation: null, plausibilityOverride: null, captureMethod: 'page',
  };
}

function towObservation(page, fetched) {
  return Object.assign(base(page, TOW), {
    value: page.tow.value, range: null, unitCode: 'aud_per_item',
    scope: { jurisdiction: 'NSW', classification: 'Light vehicles (gross vehicle mass up to 4.5 tonnes): for any accident towing work', period: { from: page.from, to: page.to } },
    qualifications: [page.gstSentence].concat(page.extras).map((text) => ({ text, evidenceId: 'page' })),
    valueBindings: [{ field: 'value', token: page.tow.token, evidenceId: 'page' }],
    evidence: [evidence(page, fetched, page.gstSentence + ' […] ' + page.tow.label + ': ' + page.tow.text,
      { paragraph: 'Towing fees', table: page.towTable.caption, row: page.tow.label })],
  });
}
function storageObservation(page, fetched) {
  return Object.assign(base(page, STORAGE), {
    value: null, range: { min: page.storageOther.value, max: page.storageMetro.value }, unitCode: 'aud_per_day',
    scope: { jurisdiction: 'NSW', classification: 'Light motor vehicle (not a motorcycle), storage within an authorised holding yard, for each 24 hours or part of 24 hours', period: { from: page.from, to: page.to } },
    qualifications: [
      { text: page.gstSentence, evidenceId: 'page' },
      { text: page.storageOther.label + ': ' + page.storageOther.text + ' (the range minimum)', evidenceId: 'page' },
      { text: page.storageMetro.label + ': ' + page.storageMetro.text + ' (the range maximum)', evidenceId: 'page' },
    ],
    valueBindings: [
      { field: 'range.min', token: page.storageOther.token, evidenceId: 'page' },
      { field: 'range.max', token: page.storageMetro.token, evidenceId: 'page' },
    ],
    evidence: [evidence(page, fetched, page.gstSentence + ' […] Maximum charge for each 24 hours or part of 24 hours: ' +
      page.storageMetro.label + ' ' + page.storageMetro.text + '; ' + page.storageOther.label + ' ' + page.storageOther.text + '.',
    { paragraph: 'Fees for storage within an authorised holding yard', table: page.storageTable.caption, row: 'Light motor vehicle (not a motorcycle)' })],
  });
}

// One fetcher per series, so each fails closed on its own.
function fetcherFor(which) {
  return async function fetchNswTowFees(ctx) {
    const res = await ctx.fetch(PAGE_URL);
    const bytes = Buffer.from(await res.arrayBuffer());
    let page;
    try {
      page = parsePage(bytes.toString('utf8'));
    } catch (e) {
      if (!(e instanceof SourceChanged)) throw e;
      return { observations: [], status: { state: 'blocked', url: PAGE_URL, detail: 'Not published: the NSW tow truck fees page did not read as expected: ' + e.message + '.' } };
    }
    const fetched = { at: ctx.now, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    return { observations: [which === 'storage' ? storageObservation(page, fetched) : towObservation(page, fetched)] };
  };
}

module.exports = { PAGE_URL, PUBLISHER, LICENCE, TOW, STORAGE, parsePage, SourceChanged, fetchTow: fetcherFor('tow'), fetchStorage: fetcherFor('storage') };
