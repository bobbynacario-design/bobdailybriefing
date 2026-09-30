'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const V = require('../validate');
const { produce } = require('../producer');
const { run } = require('../publisher/publish');
const REGISTRY = require('../series');
const sapn = require('./sapn-manual18');

const MANUAL_DIR = path.join(__dirname, '..', 'manual');
const ORD = JSON.parse(fs.readFileSync(path.join(MANUAL_DIR, sapn.ORDINARY.seriesId + '.json'), 'utf8'));
const OT = JSON.parse(fs.readFileSync(path.join(MANUAL_DIR, sapn.OVERTIME.seriesId + '.json'), 'utf8'));
const PAGE = fs.readFileSync(path.join(__dirname, 'fixtures/sapn-manual18-resource-2026-09-30.html'), 'utf8');
const PAGE_2025 = fs.readFileSync(path.join(__dirname, 'fixtures/sapn-manual18-resource-2025-12-08.html'), 'utf8');
const MANUAL = 'https://www.sapowernetworks.com.au/public/download.jsp?id=337829';
const NOW = '2026-09-30T20:15:00Z';
const ORD_ID = 'sapn_quoted_labour_field_worker_ordinary@2026-07-01#r1';
const OT_ID = 'sapn_quoted_labour_field_worker_overtime@2026-07-01#r1';
const bounds = Object.fromEntries(REGISTRY.map((s) => [s.seriesId, s.bounds]));

// Only the resource page is served; any other URL fails (the publisher then
// keeps that series' previous watch state).
function sources(page) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === sapn.RESOURCE_URL) return { ok: true, arrayBuffer: async () => Buffer.from(page !== undefined ? page : PAGE) };
    throw new Error('unexpected URL ' + url);
  };
  return { fetch, calls };
}
function tempManual(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-sapn-'));
  Object.entries(files || {}).forEach(([name, value]) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value)));
  return dir;
}

test('the captures carry Table 3\'s Field Worker row, excl GST, with the manual cited and no copy of it kept', () => {
  assert.equal(ORD.value, 198.12);
  assert.equal(OT.value, 323.05);
  for (const c of [ORD, OT]) {
    assert.equal(c.kind, 'regulated_fee'); assert.equal(c.basisCode, 'regulated_fee_max'); assert.equal(c.unitCode, 'aud_per_hour');
    assert.equal(c.scope.jurisdiction, 'SA'); assert.match(c.title, /excl GST\)$/); assert.match(c.scope.classification, /excl GST$/);
    assert.equal(c.effectiveFrom, '2026-07-01'); assert.equal(c.effectiveTo, '2027-06-30'); assert.equal(c.publishedAt, '2026-07-24');
    const ev = c.evidence[0];
    assert.equal(c.evidence.length, 1);
    assert.equal(ev.url, MANUAL); assert.equal(ev.publisher, 'SA Power Networks'); assert.equal(ev.asOf, '2026-07-24');
    assert.equal(ev.contentSha256, 'bd069d6111263091a02cd599d585265cacc14adba40d1d47974b08c9cce4c08a');
    assert.match(ev.licence, /^© SA Power Networks 2026\. All rights reserved .*quoted in part for citation only/);
    assert.match(ev.quote, /FW Field Worker \$198\.12 \$217\.93 \$323\.05 \$355\.36$/);
    assert.ok(ev.quote.length < 400, 'a short quote, not the table');
    assert.match(ev.locator.table, /^Table 3 – Hourly labour rates applicable for quoted services, column "(Ordinary Time|Overtime), 2026\/27 \(GST Exclusive\)"$/);
    ['These labour rates are our charge-out rates.',
      'Labour consists of all labour costs directly incurred in the provision of the service which may include labour on-costs, fleet on-costs, and overheads.',
      'The AER approved labour rates will apply for both ancillary network services, quoted services and any connections quoted services.',
      'Field Worker ordinary business hours are typically between 7:30am and 3:30pm Monday to Friday.']
      .forEach((q) => assert.ok(c.qualifications.some((x) => x.text === q), q));
  }
  assert.ok(ORD.qualifications.some((q) => q.text === 'Table 3, FW Field Worker, Ordinary Time, 2026/27 (GST Inclusive): $217.93.'));
  assert.ok(OT.qualifications.some((q) => q.text === 'Table 3, FW Field Worker, Overtime, 2026/27 (GST Inclusive): $355.36.'));
  assert.ok(OT.qualifications.some((q) => q.text === 'Overtime rates will be applicable to all customer initiated after hours work.'));
  assert.ok(!fs.readdirSync(path.join(MANUAL_DIR, 'sources')).some((f) => /sapn|sa power|ancillary|manual.?18/i.test(f)), 'the manual PDF is not kept');
});

test('both captures validate and publish, plausible under Daybook\'s bounds without an override', () => {
  const r = produce({ previous: null, registry: REGISTRY, observations: [ORD, OT], now: NOW, producerCommit: 'test' });
  assert.deepEqual(r.skipped, []);
  for (const id of [ORD_ID, OT_ID]) {
    const res = r.validation.results.find((x) => x.recordId === id);
    assert.deepEqual(res.checks, { sourceLinked: true, factVerified: true, crossChecked: false, plausible: true }, id);
  }
  assert.ok(r.changes.some((c) => c.summary === sapn.ORDINARY.title + ': $198.12/hour (2026-07-01)'));
  assert.ok(r.changes.some((c) => c.summary === sapn.OVERTIME.title + ': $323.05/hour (2026-07-01)'));
});

test('the resource page reads as SA Power Networks wrote it, in both layouts, and fails closed otherwise', () => {
  assert.deepEqual(sapn.parseResource(PAGE), { edition: '2026-27', lastModified: '2026-07-24', firstPublished: '2026-05-28', downloadId: '337829', downloadUrl: MANUAL });
  // To May 2026 the page gave one "Published" date and wrote "&" and "2025-2026".
  assert.deepEqual(sapn.parseResource(PAGE_2025), { edition: '2025-26', lastModified: '2025-06-03', firstPublished: null, downloadId: '333196',
    downloadUrl: 'https://www.sapowernetworks.com.au/public/download.jsp?id=333196' });
  // A revision date wins over a publication date, should a page carry both.
  assert.equal(sapn.parseResource(PAGE.replace('<li>File type : PDF</li>', '<li>File type : PDF</li>\n<li>Published : 28th May 2026</li>')).lastModified, '2026-07-24');
  assert.equal(sapn.parseResource('<html>Page not found</html>'), null);
  assert.equal(sapn.parseResource(PAGE.replace('2026-27</span>', '2026-28</span>')), null, 'years that do not follow each other');
  assert.equal(sapn.parseResource(PAGE.replace('<li>Last Modified : 24th July 2026</li>', '<li>Last Modified : soon</li>')), null, 'no readable date');
  assert.equal(sapn.parseResource(PAGE.replace('id=337829', 'id=')), null, 'no download');
  assert.equal(sapn.parseResource(PAGE.replace('</div>\n</div>', '<a href="/public/download.jsp?id=340001">Download</a></div>\n</div>')), null, 'two downloads: which is the manual?');
  assert.equal(sapn.isoDay('3rd June 2025'), '2025-06-03');
  assert.equal(sapn.editionOf('2025-2026'), '2025-26');
});

test('the watch: this edition says nothing, a new edition, revision or download turns it stale, none captured awaits', async () => {
  const src = sources();
  assert.deepEqual(await sapn.watchOrdinary({ fetch: src.fetch, now: NOW, manualDir: MANUAL_DIR }), { observations: [] });
  assert.deepEqual(await sapn.watchOvertime({ fetch: src.fetch, now: NOW, manualDir: MANUAL_DIR }), { observations: [] });
  assert.deepEqual(src.calls, [sapn.RESOURCE_URL], 'one read of the page serves both series');

  const next = PAGE.replace('2026-27</span>', '2027-28</span>').replace('24th July 2026', '27th May 2027').replace('28th May 2026', '27th May 2027');
  const edition = await sapn.watchOrdinary({ fetch: sources(next).fetch, now: NOW, manualDir: MANUAL_DIR });
  assert.equal(edition.status.state, 'stale');
  assert.equal(edition.status.detail, 'SA Power Networks now lists Manual 18 the 2027-28 edition (last modified 2027-05-27, download id 337829), which has not been captured.' +
    ' Check Appendix D, Table 3, the Field Worker Ordinary Time rate, and capture it in grounding/manual/sapn_quoted_labour_field_worker_ordinary.json.');
  assert.ok(edition.status.detail.length <= 500);

  // The same id and edition, revised: SA Power Networks overwrites files in place.
  const revised = await sapn.watchOvertime({ fetch: sources(PAGE.replace('24th July 2026', '2nd October 2026')).fetch, now: NOW, manualDir: MANUAL_DIR });
  assert.equal(revised.status.state, 'stale');
  assert.match(revised.status.detail, /^SA Power Networks has revised Manual 18: the 2026-27 edition \(last modified 2026-10-02, download id 337829\), after the capture of 2026-07-24\. Check Appendix D, Table 3, the Field Worker Overtime rate/);

  const moved = await sapn.watchOrdinary({ fetch: sources(PAGE.replace('id=337829', 'id=340001')).fetch, now: NOW, manualDir: MANUAL_DIR });
  assert.equal(moved.status.state, 'stale');
  assert.match(moved.status.detail, /^SA Power Networks has moved Manual 18 to a new download: the 2026-27 edition \(last modified 2026-07-24, download id 340001\)\./);
  assert.equal(moved.status.url, 'https://www.sapowernetworks.com.au/public/download.jsp?id=340001');

  const none = await sapn.watchOrdinary({ fetch: sources().fetch, now: NOW, manualDir: tempManual() });
  assert.equal(none.status.state, 'awaiting_publication');
  assert.match(none.status.detail, /lists Manual 18 the 2026-27 edition \(last modified 2026-07-24, download id 337829\); no figure has been captured from it yet\./);

  const broken = await sapn.watchOvertime({ fetch: sources('<html>Down for maintenance</html>').fetch, now: NOW, manualDir: MANUAL_DIR });
  assert.equal(broken.status.state, 'blocked');
});

test('an earlier year cited to another source does not confuse the watch', async () => {
  const fy26 = Object.assign(JSON.parse(JSON.stringify(ORD)), { observationKey: '2025-07-01', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30' });
  fy26.evidence[0].url = 'https://www.aer.gov.au/example-2025-26-pricing-proposal.pdf'; fy26.evidence[0].asOf = '2025-05-14';
  const dir = tempManual({ [sapn.ORDINARY.seriesId + '.json']: [fy26, ORD] });
  assert.deepEqual(sapn.capturedEditions(path.join(dir, sapn.ORDINARY.seriesId + '.json')),
    [{ edition: '2025-26', asOf: '2025-05-14', downloadId: null }, { edition: '2026-27', asOf: '2026-07-24', downloadId: '337829' }]);
  assert.deepEqual(await sapn.watchOrdinary({ fetch: sources().fetch, now: NOW, manualDir: dir }), { observations: [] });
});

test('through the real publisher with every series, a ClaimBench-shaped plan imports exactly the two labour rates', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-h7-'));
  const data = path.join(root, 'gdata'); fs.mkdirSync(data);
  const out = await run({ dataDir: data, manualDir: MANUAL_DIR, registry: REGISTRY, firestore: false, now: NOW, fetchImpl: sources().fetch });
  const facts = out.result.snapshot.facts.map((f) => f.recordId);
  [ORD_ID, OT_ID].forEach((id) => assert.ok(facts.includes(id), id + ' is published'));
  const mine = out.result.snapshot.watch.filter((w) => /^sapn_/.test(w.seriesId));
  assert.equal(mine.length, 2);
  assert.ok(mine.every((w) => w.state === 'published'), JSON.stringify(mine.map((w) => [w.seriesId, w.state])));
  const rel = out.result.release, d = rel.dir, f = rel.files;
  const release = V.validateRelease({ latestText: f['latest.json'], manifestText: f[d + '/manifest.json'],
    fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] }, directorySequence: rel.sequence }, { bounds });
  assert.equal(release.ok, true, release.errors.join('; '));
  const policy = { mappingVersion: 'test', refuseDerived: true, allow: {
    series: [sapn.ORDINARY.seriesId, sapn.OVERTIME.seriesId], publishers: ['SA Power Networks'], units: ['aud_per_hour'], jurisdictions: ['SA'] } };
  const plan = V.planImport(null, release, policy, NOW);
  assert.deepEqual(plan.toImport.map((x) => x.recordId).sort(), [ORD_ID, OT_ID]);
});
