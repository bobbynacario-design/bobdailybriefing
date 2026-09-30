'use strict';
// SA Power Networks quoted-service labour rates, Field Worker (docs/grounding-
// phase-h.md, H-7a). The AER sets the maximum labour rates a network may charge
// for quoted services in its distribution determination. SA Power Networks
// publishes the rates in force each year in "Manual 18: Connections & Ancillary
// Network Services", Appendix D, Table 3. The figures are captured by hand from
// that PDF into reviewed files in grounding/manual/, one per series: ordinary
// time and overtime, excl GST (Bob's D-H7-5 and D-H7-6).
//
// This module is the automated WATCH. Each day it reads the manual's resource
// page (robots.txt allows it; Daybook identifies itself), which names the
// current edition, its "Last Modified" date and its download id, and compares
// them with the capture:
//   - the same edition, date and id: nothing to say; the series reads as published;
//   - a new edition, a later date or a new id: "stale", until someone re-captures;
//   - nothing captured:  "awaiting publication", naming the edition that is out;
//   - a page it cannot read: "blocked".
// It never downloads the PDF (2 MB, and the server is sometimes slow). A new
// edition can replace an old one under the same id: on 2026-09-30 the 2025-26
// id served the 2026-27 bytes. So the page's date and edition are what count.
// The manual is "All rights reserved" (Copyright Act 1968): short quotes for
// citation only, and no copy of the PDF is kept.

const fs = require('fs');
const path = require('path');

const PUBLISHER = 'SA Power Networks';
const SITE = 'https://www.sapowernetworks.com.au';
const RESOURCE_URL = SITE + '/data/307870/sa-power-networks-connections-ancillary-network-services/';
const DOWNLOAD_BASE = SITE + '/public/download.jsp?id=';
const ORDINARY = { seriesId: 'sapn_quoted_labour_field_worker_ordinary', title: 'SA Power Networks Field Worker labour rate, ordinary time (quoted services, excl GST)', column: 'Ordinary Time' };
const OVERTIME = { seriesId: 'sapn_quoted_labour_field_worker_overtime', title: 'SA Power Networks Field Worker labour rate, overtime (quoted services, excl GST)', column: 'Overtime' };
const MONTHS = { January: '01', February: '02', March: '03', April: '04', May: '05', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12' };

function licenceFor(year, downloadUrl) {
  return '© SA Power Networks ' + year + '. All rights reserved (Copyright Act 1968); quoted in part for citation only. Full manual: ' + downloadUrl;
}

// "24th July 2026" -> "2026-07-24", or null.
function isoDay(text) {
  const m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Z][a-z]+)\s+(\d{4})$/.exec(String(text || '').trim());
  if (!m || !MONTHS[m[2]]) return null;
  return m[3] + '-' + MONTHS[m[2]] + '-' + m[1].padStart(2, '0');
}

// "2026-27" or "2025-2026" -> "2026-27" / "2025-26", or null.
function editionOf(text) {
  const m = /^(\d{4})\s*[-–]\s*(\d{2}|\d{4})$/.exec(String(text || '').trim());
  if (!m) return null;
  const next = String(Number(m[1]) + 1);
  if (m[2] !== next && m[2] !== next.slice(2)) return null;
  return m[1] + '-' + next.slice(2);
}

// The financial year an observation covers, as an edition: "2026-07-01" -> "2026-27".
const editionFrom = (effectiveFrom) => {
  const y = Number(String(effectiveFrom || '').slice(0, 4));
  return y ? y + '-' + String(y + 1).slice(2) : null;
};

// The resource page: { edition, lastModified, firstPublished, downloadId, downloadUrl },
// or null when it does not read as a single Manual 18 edition.
function parseResource(html) {
  if (typeof html !== 'string') return null;
  const title = /SA Power Networks Connections (?:and|&amp;|&) Ancillary Network Services\s+(\d{4}\s*[-–]\s*\d{2,4})\s*</.exec(html);
  const edition = title && editionOf(title[1]);
  if (!edition) return null;
  const li = (label) => { const m = new RegExp('<li>\\s*' + label + '\\s*:\\s*([^<]+?)\\s*</li>').exec(html); return m ? isoDay(m[1]) : null; };
  // Older pages (to May 2026) had one "Published" date instead of the two.
  const lastModified = li('Last Modified') || li('Published');
  if (!lastModified) return null;
  const ids = [...new Set([...html.matchAll(/\/public\/download\.jsp\?id=(\d+)/g)].map((m) => m[1]))];
  if (ids.length !== 1) return null;
  return { edition, lastModified, firstPublished: li('First Published'), downloadId: ids[0], downloadUrl: DOWNLOAD_BASE + ids[0] };
}

// What a reviewed capture was read from: [{ edition, asOf, downloadId }], one
// per observation that cites the manual (another source cites no download id).
function capturedEditions(file) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; }
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((o) => o && Array.isArray(o.evidence)).map((o) => {
    const ev = o.evidence.find((e) => e.role === 'release') || o.evidence[0] || {};
    const id = /^https:\/\/www\.sapowernetworks\.com\.au\/public\/download\.jsp\?id=(\d+)$/.exec(ev.url || '');
    return { edition: editionFrom(o.effectiveFrom), asOf: ev.asOf, downloadId: id ? id[1] : null };
  });
}

// The page is read once per publisher run and shared by both series (the
// publisher passes the same fetch and time to each).
const runs = new WeakMap();
function readResource(ctx) {
  const prior = runs.get(ctx.fetch);
  if (prior && prior.now === ctx.now) return prior.result;
  const result = (async () => parseResource(Buffer.from(await (await ctx.fetch(RESOURCE_URL)).arrayBuffer()).toString('utf8')))();
  runs.set(ctx.fetch, { now: ctx.now, result });
  return result;
}

function watcherFor(series) {
  return async function watchManual18(ctx) {
    const page = await readResource(ctx);
    if (!page) {
      return { observations: [], status: { state: 'blocked', url: RESOURCE_URL,
        detail: 'The Manual 18 resource page did not read as one edition with a date and a download, so a new edition cannot be checked.' } };
    }
    const name = 'the ' + page.edition + ' edition (last modified ' + page.lastModified + ', download id ' + page.downloadId + ')';
    const manualDir = ctx.manualDir || path.join(__dirname, '..', 'manual');
    const captured = capturedEditions(path.join(manualDir, series.seriesId + '.json'));
    const fix = ' Check Appendix D, Table 3, the Field Worker ' + series.column + ' rate, and capture it in grounding/manual/' + series.seriesId + '.json.';
    if (!captured.length) {
      return { observations: [], status: { state: 'awaiting_publication', url: page.downloadUrl,
        detail: 'SA Power Networks lists Manual 18 ' + name + '; no figure has been captured from it yet.' } };
    }
    const cap = captured.find((c) => c.edition === page.edition);
    const why = !cap ? 'SA Power Networks now lists Manual 18 ' + name + ', which has not been captured.'
      : page.lastModified > cap.asOf ? 'SA Power Networks has revised Manual 18: ' + name + ', after the capture of ' + cap.asOf + '.'
        : cap.downloadId && page.downloadId !== cap.downloadId ? 'SA Power Networks has moved Manual 18 to a new download: ' + name + '.'
          : null;
    if (!why) return { observations: [] };
    return { observations: [], status: { state: 'stale', url: page.downloadUrl, detail: why + fix } };
  };
}

module.exports = {
  PUBLISHER, RESOURCE_URL, DOWNLOAD_BASE, ORDINARY, OVERTIME, licenceFor, isoDay, editionOf, parseResource, capturedEditions,
  watchOrdinary: watcherFor(ORDINARY), watchOvertime: watcherFor(OVERTIME),
};
