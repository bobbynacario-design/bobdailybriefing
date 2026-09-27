'use strict';
// VIC regulated accident towing and storage fees (docs/grounding-phase-h.md,
// H-1). The figures are captured by hand from the Victoria Government Gazette
// notice made each year under section 212H of the Accident Towing Services Act
// 2007 (for 2026-27: Special Gazette S257, 22 May 2026). They live in reviewed
// files in grounding/manual/, one per series.
//
// This module is the automated WATCH. Each day it asks the gazette's own search
// for "212H" (robots.txt allows every agent; Daybook identifies itself) and
// compares the newest notice listed with the one the capture was read from:
//   - no newer notice:   nothing to say; the series reads as published;
//   - a newer notice:    "stale", naming it, until someone re-captures;
//   - nothing captured:  "awaiting publication", naming the newest notice;
//   - an unreadable result page: "blocked".
// The gazette is subject to copyright (no open licence), so Bob chose (D-H2)
// to publish the figures with short quotes for citation and keep only the
// notice's SHA-256 and its permanent address, never a copy of the PDF.

const fs = require('fs');
const path = require('path');

const PUBLISHER = 'Victoria Government Gazette (Secretary, Department of Transport and Planning)';
const SEARCH_URL = 'https://www.gazette.vic.gov.au/gazette_bin/search_gateway.cfm?mode=search&bct=home|searchgazettes&doSearch=1';
const SEARCH_TERM = '212H';
const SITE = 'https://www.gazette.vic.gov.au';
const TOW = { seriesId: 'vic_atsa_accident_tow_base_fee', title: 'VIC accident towing base fee (first 8 km, under 4 t GVM, controlled areas), incl GST' };
const STORAGE = { seriesId: 'vic_atsa_storage_motor_car_daily', title: 'VIC storage of accident-damaged motor cars per day (locked yard to under cover), incl GST' };
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

function licenceFor(noticeUrl) {
  return '© State of Victoria. The Victoria Government Gazette is subject to copyright (Copyright Act 1968); quoted in part for citation only. Full notice: ' + noticeUrl;
}

// The gazette search result rows: [{ number, type, date, url }], newest first.
// Returns null when the page has no result table it can read.
function parseResults(html) {
  if (typeof html !== 'string') return null;
  const rows = [...html.matchAll(/<tr>\s*<td>([SGP]\d{1,4})<\/td>\s*<td>([A-Za-z]+)<\/td>\s*<td>(\d{2})-([A-Z][a-z]{2})-(\d{4})<\/td>\s*<td>[\s\S]*?href="(\/gazette\/Gazettes\d{4}\/GG\d{4}[SGP]\d{1,4}\.pdf)(?:#page=\d+)?"/g)];
  if (!rows.length) return null;
  const seen = {};
  return rows.map((m) => ({ number: m[1], type: m[2], date: MONTHS[m[4]] ? m[5] + '-' + MONTHS[m[4]] + '-' + m[3] : null, url: SITE + m[6] }))
    .filter((r) => r.date && !seen[r.url] && (seen[r.url] = true))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// The notices a reviewed capture was read from: [{ url, asOf }].
function capturedNotices(file) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; }
  return (Array.isArray(parsed) ? parsed : [parsed])
    .flatMap((o) => (o && Array.isArray(o.evidence) ? o.evidence : []).map((ev) => ({ url: ev.url, asOf: ev.asOf })));
}

function watcherFor(series) {
  return async function watchGazette(ctx) {
    const res = await ctx.fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'q=' + encodeURIComponent(SEARCH_TERM),
    });
    const results = parseResults(Buffer.from(await res.arrayBuffer()).toString('utf8'));
    if (!results) {
      return { observations: [], status: { state: 'blocked', url: SITE,
        detail: 'The gazette search for "' + SEARCH_TERM + '" returned no results Daybook could read, so new section 212H notices cannot be checked.' } };
    }
    const newest = results[0];
    const name = (n) => (n.type === 'Special' ? 'Special Gazette ' : n.type + ' Gazette ') + n.number + ', ' + n.date;
    const manualDir = ctx.manualDir || path.join(__dirname, '..', 'manual');
    const captured = capturedNotices(path.join(manualDir, series.seriesId + '.json'));
    if (!captured.length) {
      return { observations: [], status: { state: 'awaiting_publication', url: newest.url,
        detail: 'The newest section 212H notice in the gazette is ' + name(newest) + '; no figure has been captured from it yet.' } };
    }
    const latestCapture = captured.reduce((a, b) => (a.asOf > b.asOf ? a : b));
    if (captured.some((c) => c.url === newest.url) || newest.date <= latestCapture.asOf) return { observations: [] };
    return { observations: [], status: { state: 'stale', url: newest.url,
      detail: 'A newer section 212H notice is in the gazette: ' + name(newest) + '. Check it and capture its figures in grounding/manual/' + series.seriesId + '.json.' } };
  };
}

module.exports = {
  PUBLISHER, SEARCH_URL, SEARCH_TERM, TOW, STORAGE, licenceFor, parseResults, capturedNotices,
  watchTow: watcherFor(TOW), watchStorage: watcherFor(STORAGE),
};
