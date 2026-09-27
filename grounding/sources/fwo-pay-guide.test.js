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
const CAPTURE = JSON.parse(fs.readFileSync(path.join(MANUAL_DIR, fwo.SERIES_ID + '.json'), 'utf8'));
// The pay guide the capture was read from, kept beside it (FWO, CC BY-NC 4.0).
const GUIDE = fs.readFileSync(path.join(MANUAL_DIR, 'sources', 'fwo-ma000020-pay-guide-effective-2026-07-01-G00203138.pdf'));
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

test('the capture is exactly the contract BI-Assessor maps (roadmap Phase F; D-F1, D-F2)', () => {
  assert.equal(CAPTURE.seriesId, 'fwo_ma000020_cw2_ordinary');
  assert.equal(CAPTURE.kind, 'award_wage'); assert.equal(CAPTURE.basisCode, 'award_min_wage'); assert.equal(CAPTURE.unitCode, 'aud_per_hour');
  assert.equal(CAPTURE.scope.jurisdiction, 'AU');
  assert.equal(CAPTURE.scope.classification, 'Level 2 (CW/ECW 2); Weekly hire - full-time and part-time - Civil construction');
  assert.equal(CAPTURE.value, 30.39); assert.equal(CAPTURE.range, null); assert.equal(CAPTURE.derivation, null);
  assert.equal(CAPTURE.effectiveFrom, '2026-07-01'); assert.equal(CAPTURE.effectiveTo, '2027-06-30');
  assert.ok(CAPTURE.evidence.every((ev) => ev.publisher === 'Fair Work Ombudsman'), 'every evidence item names the FWO');
  assert.equal(CAPTURE.captureMethod, 'manual');
  assert.ok(!('recordId' in CAPTURE) && !('revision' in CAPTURE) && !('lifecycle' in CAPTURE), 'identity fields are the publisher\'s');
});

test('the capture records the digest of the pay guide kept beside it, and that guide is the 1 July 2026 edition', () => {
  assert.equal(CAPTURE.evidence[0].contentSha256, sha(GUIDE));
  assert.deepEqual(fwo.pdfFacts(GUIDE), { createdOn: '2026-07-01' });
  // The sanity check against the award (clauses 19.1(a) and 22.1(a) from 1 July
  // 2026): (CW/ECW 2 weekly minimum + civil industry allowance) / 38 hours.
  assert.equal(Math.round(((1087.50 + 67.15) / 38) * 100) / 100, CAPTURE.value);
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
  // Then the reviewed capture lands.
  const src = sources();
  const out = await run({ dataDir: data, manualDir: MANUAL_DIR, registry: REGISTRY, firestore: false, now: NOW, fetchImpl: src.fetch });
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
