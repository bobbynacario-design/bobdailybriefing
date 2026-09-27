'use strict';
// Fair Work Ombudsman pay guide, MA000020 (Building and Construction General
// On-site Award): the automated WATCH for a figure captured by hand
// (docs/grounding-phase-f.md; roadmap sections 6 and Phase F).
//
// The value itself is never read here. It comes from a reviewed file in
// grounding/manual/, which records the SHA-256 of the pay guide it was read
// from. Each day this downloads the current guide, as Daybook, and compares:
//   - the same bytes:   nothing to say; the series reads as published;
//   - different bytes:  the FWO has issued a new guide, so the captured
//                       figure may be out of date: "stale", with the new
//                       file's name and creation date, until someone
//                       re-captures it;
//   - nothing captured: "awaiting publication", naming the guide that is out.
// The guide is byte-identical from one download to the next (checked on
// 2026-09-27), so a changed digest means a changed guide. The FWO's
// calculator host allows robots ("Allow: /"); www.fairwork.gov.au does not
// answer automated readers, which is why this reads the calculator directly.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SERIES_ID = 'fwo_ma000020_cw2_ordinary';
const TITLE = 'Building and Construction award, CW/ECW 2 (civil, weekly hire), ordinary hourly rate';
const PUBLISHER = 'Fair Work Ombudsman';
// The link the FWO's pay guides page gives, and the download its script fetches.
const PAY_GUIDE_URL = 'https://calculate.fairwork.gov.au/payguides/fairwork/ma000020/pdf';
const DOWNLOAD_URL = 'https://calculate.fairwork.gov.au/Download/AwardSummary?awardCode=ma000020&effectiveDate=&fileType=pdf&krn=';
const LICENCE = '© Fair Work Ombudsman www.fairwork.gov.au. Licensed under CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/legalcode). Pay Guide - Building and Construction General On-site Award [MA000020], ' + PAY_GUIDE_URL;
const MANUAL_FILE = path.join(__dirname, '..', 'manual', SERIES_ID + '.json');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// What the raw PDF says about itself, without a PDF library: its creation date
// from the Info dictionary (D:YYYYMMDD...), or null.
function pdfFacts(bytes) {
  const head = bytes.subarray(0, 5).toString('latin1');
  if (head !== '%PDF-') return null;
  const raw = bytes.toString('latin1');
  const m = /\/CreationDate\s*\(D:(\d{4})(\d{2})(\d{2})/.exec(raw);
  return { createdOn: m ? m[1] + '-' + m[2] + '-' + m[3] : null };
}

// The digests the reviewed capture was read from.
function capturedDigests(file) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file || MANUAL_FILE, 'utf8')); } catch (e) { return []; }
  return (Array.isArray(parsed) ? parsed : [parsed])
    .flatMap((o) => (o && Array.isArray(o.evidence) ? o.evidence : []).map((ev) => ev.contentSha256))
    .filter(Boolean);
}

// The registry's fetch: ({ fetch, now, manualDir }) -> { observations: [], status }.
// `fetch` is the publisher's fetchWithIdentity (Daybook's user agent; throws on
// an HTTP error, and a 401/403 is reported as blocked).
async function watchPayGuide(ctx) {
  const res = await ctx.fetch(DOWNLOAD_URL);
  const bytes = Buffer.from(await res.arrayBuffer());
  const facts = pdfFacts(bytes);
  if (!facts) {
    const type = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : null;
    return { observations: [], status: { state: 'blocked', url: PAY_GUIDE_URL,
      detail: 'The FWO pay guide download did not return a PDF (' + (type || 'unknown type') + '), so the guide could not be checked.' } };
  }
  const disposition = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-disposition') : null;
  const fileName = (/filename="?([^";]+)"?/i.exec(disposition || '') || [])[1] || 'the pay guide';
  const digest = sha256(bytes);
  const which = fileName + (facts.createdOn ? ', created ' + facts.createdOn : '') + ' (SHA-256 ' + digest.slice(0, 12) + '…)';
  const captured = capturedDigests(ctx.manualDir ? path.join(ctx.manualDir, SERIES_ID + '.json') : MANUAL_FILE);
  if (!captured.length) {
    return { observations: [], status: { state: 'awaiting_publication', url: PAY_GUIDE_URL,
      detail: 'The FWO pay guide is out (' + which + '); no figure has been captured from it yet.' } };
  }
  if (captured.indexOf(digest) >= 0) return { observations: [] };
  return { observations: [], status: { state: 'stale', url: PAY_GUIDE_URL,
    detail: 'The FWO has issued a different pay guide since this figure was captured: now ' + which +
      '. Check the Level 2 (CW/ECW 2) civil weekly-hire rate and update grounding/manual/' + SERIES_ID + '.json.' } };
}

module.exports = { SERIES_ID, TITLE, PUBLISHER, PAY_GUIDE_URL, DOWNLOAD_URL, LICENCE, MANUAL_FILE, pdfFacts, capturedDigests, watchPayGuide };
