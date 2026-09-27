'use strict';
// Superannuation Guarantee charge percentage: a WATCH-ONLY series
// (docs/grounding-phase-h.md, H-2; roadmap Phase H: "Legislated at 12%; watch
// for change"). It never publishes a fact. BI-Assessor's wages method holds the
// statutory rate in its own code with no override, so what it needs is to hear
// when the law changes.
//
// The ATO's pages refuse automated readers (HTTP 403), so this reads the
// Federal Register of Legislation's public API, identifying as Daybook, once a
// day (the Register asks for a 10-second crawl delay; one request is far
// inside it). It compares the Act's latest registered compilation with the one
// last reviewed by a person:
//   - the reviewed compilation:  "published", saying what the review found;
//   - a newer compilation:       "stale", naming it and the Acts that amended
//                                it, until someone reads section 17A again and
//                                records the new review below;
//   - an answer it cannot read:  "blocked".
// A compilation registered ahead of its start date is reported at once, so a
// future change is flagged before it takes effect.

const TITLE_ID = 'C2004A04402';
const SERIES_ID = 'cth_sg_charge_percentage';
const TITLE = 'Superannuation guarantee charge percentage (Superannuation Guarantee (Administration) Act 1992)';
const PUBLISHER = 'Federal Register of Legislation (Office of Parliamentary Counsel)';
const API_URL = "https://api.prod.legislation.gov.au/v1/versions/find(titleId='" + TITLE_ID + "',asAtSpecification='Latest')";
const TEXT_URL = 'https://www.legislation.gov.au/' + TITLE_ID + '/latest/text';
const LICENCE = 'Commonwealth legislation, from the Federal Register of Legislation. Only compilation details and a five-word quote of section 17A(2) are published, for citation.';

// The last compilation a person read, and what it says. When the watch turns
// stale, read section 17A of the new compilation at TEXT_URL, update BI-Assessor
// if the rate changed, then record the new review here (one commit).
const REVIEWED = Object.freeze({
  registerId: 'C2026C00272',
  compilationNumber: '78',
  start: '2026-07-01',
  reviewedOn: '2026-09-28',
  finding: 'Section 17A(2): "charge percentage means 12." SG now arises on each payment of qualifying earnings (the QE day), as amended by the Treasury Laws Amendment (Payday Superannuation) Act 2025 from 1 July 2026.',
});

// The API's answer, or null when it is not the version record expected.
function parseVersion(text) {
  let v;
  try { v = JSON.parse(text); } catch (e) { return null; }
  if (!v || v.titleId !== TITLE_ID || typeof v.registerId !== 'string' || !/^C\d{4}C\d{5}$/.test(v.registerId)) return null;
  const start = typeof v.start === 'string' ? v.start.slice(0, 10) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) return null;
  const amendedBy = (Array.isArray(v.reasons) ? v.reasons : [])
    .map((r) => (r && r.affectedByTitle && r.affectedByTitle.name) || null).filter(Boolean);
  return {
    registerId: v.registerId, compilationNumber: String(v.compilationNumber || ''), start,
    registeredOn: typeof v.registeredAt === 'string' ? v.registeredAt.slice(0, 10) : null,
    status: v.status || null, amendedBy: Array.from(new Set(amendedBy)),
  };
}

// A watch detail must fit in 500 characters, so a long list of amending Acts
// is cut to the first two and a count.
function amendedByText(names) {
  if (!names.length) return '';
  const shown = names.length > 2 ? names.slice(0, 2).map((n) => n.slice(0, 90)).join('; ') + '; and ' + (names.length - 2) + ' more' : names.map((n) => n.slice(0, 90)).join('; ');
  return '; amended by ' + shown;
}

// The registry's fetch: ({ fetch, now }) -> { observations: [], status }.
async function watchSg(ctx) {
  const res = await ctx.fetch(API_URL, { headers: { accept: 'application/json' } });
  const version = parseVersion(Buffer.from(await res.arrayBuffer()).toString('utf8'));
  if (!version) {
    return { observations: [], status: { state: 'blocked', url: TEXT_URL,
      detail: 'The Federal Register did not return a readable version record for the Superannuation Guarantee (Administration) Act 1992, so changes to the charge percentage cannot be checked.' } };
  }
  if (version.registerId === REVIEWED.registerId) {
    return { observations: [], status: { state: 'published', url: TEXT_URL,
      detail: 'Reviewed ' + REVIEWED.reviewedOn + ': compilation ' + REVIEWED.compilationNumber + ' (' + REVIEWED.registerId + '), in force from ' + REVIEWED.start + '. ' + REVIEWED.finding } };
  }
  const detail = (amended) => 'A new compilation of the Superannuation Guarantee (Administration) Act 1992 is registered: compilation ' + version.compilationNumber +
    ' (' + version.registerId + '), in force from ' + version.start + (version.registeredOn ? ', registered ' + version.registeredOn : '') + amended +
    '. Check whether the charge percentage in section 17A(2) changed, update BI-Assessor if it did, and record the review in grounding/sources/sg-legislation.js.';
  // Names if they fit, else a count; a watch detail is never over 500 characters.
  let text = detail(amendedByText(version.amendedBy));
  if (text.length > 500) text = detail(version.amendedBy.length ? '; amended by ' + version.amendedBy.length + ' Acts' : '');
  if (text.length > 500) text = text.slice(0, 499) + '…';
  return { observations: [], status: { state: 'stale', url: TEXT_URL, detail: text } };
}

module.exports = { TITLE_ID, SERIES_ID, TITLE, PUBLISHER, API_URL, TEXT_URL, LICENCE, REVIEWED, parseVersion, watchSg };
