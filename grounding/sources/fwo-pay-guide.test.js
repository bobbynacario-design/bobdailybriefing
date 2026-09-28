'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const V = require('../validate');
const { produce } = require('../producer');
const { run } = require('../publisher/publish');
const REGISTRY = require('../series');
const fwo = require('./fwo-pay-guide');
const cpi = require('./abs-cpi');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const MANUAL_DIR = path.join(__dirname, '..', 'manual');
const CAPTURES = JSON.parse(fs.readFileSync(path.join(MANUAL_DIR, fwo.SERIES_ID + '.json'), 'utf8'));
const CAPTURE = CAPTURES.find((o) => o.observationKey === '2026-07-01');
const FY26 = CAPTURES.find((o) => o.observationKey === '2025-07-01');
// The pay guides the captures were read from, kept beside them (FWO, CC BY-NC 4.0).
const GUIDE = fs.readFileSync(path.join(MANUAL_DIR, 'sources', 'fwo-ma000020-pay-guide-effective-2026-07-01-G00203138.pdf'));
const GUIDE_FY26 = fs.readFileSync(path.join(MANUAL_DIR, 'sources', 'fwo-ma000020-pay-guide-effective-2025-07-01-G00202880.pdf'));
const FY26_ID = 'fwo_ma000020_cw2_ordinary@2025-07-01#r1';
const FY26_SUMMARY = fwo.TITLE + ': $29.01/hour (2025-07-01), an earlier period; the latest is still $30.39/hour (2026-07-01)';
const CPI_PAGE = fs.readFileSync(path.join(__dirname, 'fixtures/abs-cpi-latest-2026-07.html'), 'utf8');
const CPI_CSV = fs.readFileSync(path.join(__dirname, 'fixtures/abs-cpi-api-2026-07.csv'), 'utf8');
const NOW = '2026-09-28T20:15:00Z';
const RECORD_ID = 'fwo_ma000020_cw2_ordinary@2026-07-01#r1';
const series = REGISTRY.find((s) => s.seriesId === fwo.SERIES_ID);

// A mock of the publisher's fetchWithIdentity serving both real sources.
function sources(opts) {
  opts = opts || {};
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === fwo.DOWNLOAD_URL) {
      if (opts.guideFail) throw Object.assign(new Error('HTTP ' + opts.guideFail + ' from ' + url), { status: opts.guideFail, url });
      const body = opts.guide || GUIDE;
      const headers = new Map([['content-type', opts.guideType || 'application/pdf'], ['content-disposition', opts.disposition || 'attachment; filename=G00203138.pdf']]);
      return { ok: true, headers, arrayBuffer: async () => body };
    }
    if (url.startsWith(cpi.API_BASE)) return { ok: true, arrayBuffer: async () => Buffer.from(CPI_CSV) };
    if (url === cpi.LATEST_URL) return { ok: true, arrayBuffer: async () => Buffer.from(CPI_PAGE) };
    throw new Error('unexpected URL ' + url);
  };
  return { fetch, calls };
}
function tempManual(capture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-manual-'));
  if (capture !== undefined) fs.writeFileSync(path.join(dir, fwo.SERIES_ID + '.json'), JSON.stringify(capture));
  return dir;
}

test('each capture is exactly the contract BI-Assessor maps (roadmap Phase F; D-F1, D-F2)', () => {
  assert.equal(CAPTURES.length, 2);
  [[CAPTURE, 30.39, '2026-07-01', '2027-06-30'], [FY26, 29.01, '2025-07-01', '2026-06-30']].forEach(([c, value, from, to]) => {
    assert.equal(c.seriesId, 'fwo_ma000020_cw2_ordinary');
    assert.equal(c.kind, 'award_wage'); assert.equal(c.basisCode, 'award_min_wage'); assert.equal(c.unitCode, 'aud_per_hour');
    assert.equal(c.scope.jurisdiction, 'AU');
    assert.equal(c.scope.classification, 'Level 2 (CW/ECW 2); Weekly hire - full-time and part-time - Civil construction');
    assert.equal(c.value, value); assert.equal(c.range, null); assert.equal(c.derivation, null);
    assert.equal(c.observationKey, from); assert.equal(c.effectiveFrom, from); assert.equal(c.effectiveTo, to);
    assert.ok(c.evidence.every((ev) => ev.publisher === 'Fair Work Ombudsman'), 'every evidence item names the FWO');
    assert.equal(c.captureMethod, 'manual');
    assert.ok(!('recordId' in c) && !('revision' in c) && !('lifecycle' in c), 'identity fields are the publisher\'s');
  });
});

test('each capture records the digest of the pay guide kept beside it, and each guide is its year\'s edition', () => {
  assert.equal(CAPTURE.evidence[0].contentSha256, sha(GUIDE));
  assert.deepEqual(fwo.pdfFacts(GUIDE), { createdOn: '2026-07-01' });
  // The sanity check against the award (clauses 19.1(a) and 22.1(a) from 1 July
  // 2026): (CW/ECW 2 weekly minimum + civil industry allowance) / 38 hours.
  assert.equal(Math.round(((1087.50 + 67.15) / 38) * 100) / 100, CAPTURE.value);

  // FY26: G00202880.pdf, "Effective: 01/07/2025 Published: 17/07/2025". The FWO
  // serves only the current guide, so it came from the Internet Archive's
  // capture of the FWO download. The URL (which carries the FWO's own) and the
  // title say so; the licence is the FWO's attribution, as for FY27.
  assert.equal(FY26.evidence[0].contentSha256, sha(GUIDE_FY26));
  assert.equal(GUIDE_FY26.length, 2037625);
  assert.deepEqual(fwo.pdfFacts(GUIDE_FY26), { createdOn: '2025-07-16' });
  assert.equal(FY26.evidence[0].url, 'https://web.archive.org/web/20251123050747id_/' + fwo.DOWNLOAD_URL);
  assert.match(FY26.evidence[0].title, /Effective: 01\/07\/2025, Published: 17\/07\/2025 \(Internet Archive copy of the FWO download, captured 23\/11\/2025\)$/);
  assert.equal(FY26.evidence[0].licence, fwo.LICENCE);
  // The same row's weekly rate over 38 hours agrees with its hourly rate: a
  // check on the transcription, not where the value came from.
  assert.equal(Math.round((1102.30 / 38) * 100) / 100, FY26.value);
});

test('the capture validates, passes Daybook\'s bounds and BI-Assessor\'s (25 to 45, change 3) without an override, and publishes', () => {
  assert.deepEqual(series.bounds, { min: 25, max: 45, maxChange: 3 });
  const r = produce({ previous: null, registry: REGISTRY, observations: [CAPTURE], now: NOW, producerCommit: 'test' });
  assert.deepEqual(r.skipped, []);
  const fact = r.snapshot.facts.find((f) => f.seriesId === fwo.SERIES_ID);
  assert.equal(fact.recordId, RECORD_ID);
  assert.equal(fact.lifecycle, 'current');
  const result = r.validation.results.find((x) => x.recordId === RECORD_ID);
  assert.deepEqual(result.checks, { sourceLinked: true, factVerified: true, crossChecked: false, plausible: true });
  assert.equal(result.overrideVerdict, null);
  assert.equal(r.changes.find((c) => c.id === RECORD_ID).summary, fwo.TITLE + ': $30.39/hour (2026-07-01)');
});

test('the watch: the same guide says nothing, a new guide turns the figure stale, and no capture awaits one', async () => {
  const same = await fwo.watchPayGuide({ fetch: sources().fetch, now: NOW, manualDir: MANUAL_DIR });
  assert.deepEqual(same, { observations: [] });

  const newer = Buffer.concat([GUIDE.subarray(0, GUIDE.length - 40), Buffer.from('%changed\n')]);
  const later = Buffer.from(newer.toString('latin1').replace('/CreationDate(D:20260701', '/CreationDate(D:20270701'), 'latin1');
  const stale = await fwo.watchPayGuide({ fetch: sources({ guide: later, disposition: 'attachment; filename=G00299999.pdf' }).fetch, now: NOW, manualDir: MANUAL_DIR });
  assert.equal(stale.status.state, 'stale');
  assert.match(stale.status.detail, /now G00299999\.pdf, created 2027-07-01 \(SHA-256 [0-9a-f]{12}…\)\. Check the Level 2 \(CW\/ECW 2\) civil weekly-hire rate/);

  const none = await fwo.watchPayGuide({ fetch: sources().fetch, now: NOW, manualDir: tempManual() });
  assert.equal(none.status.state, 'awaiting_publication');
  assert.match(none.status.detail, /The FWO pay guide is out \(G00203138\.pdf, created 2026-07-01/);

  const page = await fwo.watchPayGuide({ fetch: sources({ guide: Buffer.from('<!DOCTYPE html><p>Your download will start shortly...'), guideType: 'text/html; charset=utf-8' }).fetch, now: NOW, manualDir: MANUAL_DIR });
  assert.equal(page.status.state, 'blocked');
  assert.match(page.status.detail, /did not return a PDF \(text\/html; charset=utf-8\)/);
});

test('through the real publisher, the award publishes next to CPI and CPI is unchanged', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-f-'));
  const data = path.join(root, 'gdata'); fs.mkdirSync(data);
  // Release 1 as today: CPI only (no manual capture yet).
  const before = await run({ dataDir: data, manualDir: tempManual(), registry: REGISTRY, firestore: false, now: '2026-09-27T20:15:00Z', fetchImpl: sources().fetch });
  assert.equal(before.result.release.sequence, 1);
  const cpiBefore = before.result.snapshot.facts.find((f) => f.seriesId === cpi.SERIES_ID);
  // The watch compared the guide with the capture in the manual folder the
  // publisher was given (empty here), not with the repository's.
  const awaiting = before.result.snapshot.watch.find((w) => w.seriesId === fwo.SERIES_ID);
  assert.equal(awaiting.state, 'awaiting_publication');
  assert.match(awaiting.detail, /^The FWO pay guide is out \(G00203138\.pdf, created 2026-07-01/);
  // Then the reviewed FY27 capture lands, alone, as it did in release 000003.
  const src = sources();
  const out = await run({ dataDir: data, manualDir: tempManual(CAPTURE), registry: REGISTRY, firestore: false, now: NOW, fetchImpl: src.fetch });
  assert.equal(out.result.changed, true);
  assert.equal(out.result.release.sequence, 2);
  assert.ok(src.calls.includes(fwo.DOWNLOAD_URL), 'the watch read the guide');
  const facts = out.result.snapshot.facts;
  // Other registered series may publish too; this test is about the award and CPI.
  const ids = facts.map((f) => f.recordId);
  assert.ok(ids.includes('abs_cpi_all_groups_annual_change@2026-07#r1') && ids.includes(RECORD_ID), ids.join(', '));
  assert.deepEqual(facts.find((f) => f.seriesId === cpi.SERIES_ID), cpiBefore, 'the CPI record is byte-for-byte the same');
  const watch = Object.fromEntries(out.result.snapshot.watch.map((w) => [w.seriesId, w]));
  assert.equal(watch[fwo.SERIES_ID].state, 'published');
  assert.equal(watch[fwo.SERIES_ID].detail, 'Latest: $30.39/hour (2026-07-01), published 2026-07-02.');
  assert.equal(watch[cpi.SERIES_ID].state, 'published');
  const changed = out.result.changes.map((c) => c.id);
  assert.ok(changed.includes(RECORD_ID));
  assert.ok(!changed.some((id) => id.startsWith('abs_cpi_')), 'CPI did not change');

  // Then the repository's file, which adds FY26 beside FY27. The live guide is
  // still FY27's, so the watch still reads published.
  const later = '2026-09-29T20:15:00Z';
  const next = await run({ dataDir: data, manualDir: MANUAL_DIR, registry: REGISTRY, firestore: false, now: later, fetchImpl: sources().fetch });
  assert.equal(next.result.release.sequence, 3);
  const award = next.result.snapshot.facts.filter((f) => f.seriesId === fwo.SERIES_ID);
  assert.deepEqual(award.find((f) => f.recordId === RECORD_ID), facts.find((f) => f.recordId === RECORD_ID), 'the FY27 record is untouched');
  const fy26 = award.find((f) => f.recordId === FY26_ID);
  assert.equal(fy26.lifecycle, 'current'); assert.equal(fy26.supersedes, null); assert.equal(fy26.value, 29.01);
  // (The folder's other captures, the VIC fees, publish here too.)
  assert.deepEqual(next.result.changes.filter((c) => c.seriesId === fwo.SERIES_ID).map((c) => [c.id, c.kind, c.summary]), [[FY26_ID, 'earlier', FY26_SUMMARY]]);
  assert.deepEqual(next.result.snapshot.watch.find((w) => w.seriesId === fwo.SERIES_ID), watch[fwo.SERIES_ID], 'the watch record is kept whole');
  assert.deepEqual(next.result.snapshot.facts.find((f) => f.seriesId === cpi.SERIES_ID), cpiBefore);
});

test('from the live history, a BI-Assessor-shaped plan that imported FY27 imports exactly FY26', () => {
  // Release 1 holds FY27 alone, as the live releases have since 000003.
  const first = produce({ previous: null, registry: REGISTRY, observations: [CAPTURE], now: NOW, producerCommit: 'test' });
  const f1 = first.release.files, d1 = first.release.dir;
  const previous = { sequence: 1, facts: JSON.parse(f1[d1 + '/facts.json']).records, watch: JSON.parse(f1[d1 + '/watch.json']).records, insights: [], fileTexts: { 'facts.json': f1[d1 + '/facts.json'], 'watch.json': f1[d1 + '/watch.json'], 'insights.json': f1[d1 + '/insights.json'] } };
  const r = produce({ previous, registry: REGISTRY, observations: CAPTURES, now: NOW, producerCommit: 'test' });
  assert.deepEqual(r.skipped, []);
  const result = r.validation.results.find((x) => x.recordId === FY26_ID);
  assert.deepEqual(result.checks, { sourceLinked: true, factVerified: true, crossChecked: false, plausible: true });
  assert.equal(result.overrideVerdict, null);
  const d = r.release.dir, f = r.release.files;
  const release = V.validateRelease({ latestText: f['latest.json'], manifestText: f[d + '/manifest.json'],
    fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] }, directorySequence: 2 },
  { bounds: { fwo_ma000020_cw2_ordinary: { min: 25, max: 45, maxChange: 3 } } });
  assert.equal(release.ok, true, release.errors.join('; '));
  assert.equal(release.facts.results.find((x) => x.recordId === FY26_ID).eligible, true);
  const policy = { mappingVersion: 'test', refuseDerived: true,
    allow: { series: ['fwo_ma000020_cw2_ordinary'], publishers: ['Fair Work Ombudsman'], units: ['aud_per_hour'], jurisdictions: ['AU'] } };
  const state = V.nextImportState(null, V.validateRelease({ latestText: f1['latest.json'], manifestText: f1[d1 + '/manifest.json'],
    fileTexts: previous.fileTexts, directorySequence: 1 }, { bounds: {} }), [RECORD_ID], [], policy);
  const plan = V.planImport(state, release, policy, NOW);
  assert.deepEqual(plan.toImport.map((x) => x.recordId), [FY26_ID]);
  assert.deepEqual(plan.skips, [{ recordId: RECORD_ID, reason: 'duplicate' }]);
  assert.deepEqual(plan.flags, []);
});

test('a BI-Assessor-shaped plan imports exactly the award, and skips CPI as not allowlisted', async () => {
  const cpiOut = await cpi.fetchCpi({ fetch: sources().fetch, now: NOW });
  const r = produce({ previous: null, registry: REGISTRY, observations: [CAPTURE].concat(cpiOut.observations), now: NOW, producerCommit: 'test' });
  assert.equal(r.snapshot.facts.length, 2);
  const d = r.release.dir, f = r.release.files;
  const release = V.validateRelease({ latestText: f['latest.json'], manifestText: f[d + '/manifest.json'],
    fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] }, directorySequence: 1 },
  { bounds: { fwo_ma000020_cw2_ordinary: { min: 25, max: 45, maxChange: 3 } } });
  assert.equal(release.ok, true, release.errors.join('; '));
  const policy = { mappingVersion: 'test', refuseDerived: true,
    allow: { series: ['fwo_ma000020_cw2_ordinary'], publishers: ['Fair Work Ombudsman'], units: ['aud_per_hour'], jurisdictions: ['AU'] } };
  const plan = V.planImport(null, release, policy, NOW);
  assert.deepEqual(plan.toImport.map((x) => x.recordId), [RECORD_ID]);
  assert.deepEqual(plan.skips, [{ recordId: 'abs_cpi_all_groups_annual_change@2026-07#r1', reason: 'series not allowlisted' }]);
});

test('a consumer with no bounds for the award still reads the release (roadmap 5.2)', () => {
  const r = produce({ previous: null, registry: REGISTRY, observations: [CAPTURE], now: NOW, producerCommit: 'test' });
  const d = r.release.dir, f = r.release.files;
  const release = V.validateRelease({ latestText: f['latest.json'], manifestText: f[d + '/manifest.json'],
    fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] }, directorySequence: 1 }, { bounds: {} });
  assert.equal(release.ok, true);
  const award = release.facts.results.find((x) => x.recordId === RECORD_ID);
  assert.equal(award.checks.plausible, null);
  assert.equal(award.eligible, true);
});
