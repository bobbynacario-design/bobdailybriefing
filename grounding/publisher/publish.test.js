'use strict';
// The publisher end to end on a temporary data directory, with no network and
// no Firestore: the same code path the workflow runs, minus the push.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const V = require('../validate');
const { run } = require('./publish');

function fakeDb(initial) {
  const docs = Object.assign({}, initial);
  const writes = [];
  const db = { collection: () => ({ doc: (id) => ({
    get: async () => ({ exists: !!docs[id], data: () => docs[id] }),
    set: async (value, options) => {
      writes.push(id);
      docs[id] = options && options.merge ? Object.assign({}, docs[id], value) : value;
    },
  }) }) };
  return { db, docs, writes };
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const REGISTRY = [{ seriesId: 'test_award_cw1', title: 'Test award, CW1 hourly', capture: 'manual', freshnessDays: 400, bounds: { min: 20, max: 60, maxChange: 5 } }];
function award(value) {
  return {
    seriesId: 'test_award_cw1', observationKey: '2026-07-01', kind: 'award_wage', title: 'Test award, CW1 hourly', value, unitCode: 'aud_per_hour', basisCode: 'award_min_wage',
    scope: { jurisdiction: 'AU', classification: 'CW1', period: { from: '2026-07-01', to: '2027-06-30' } },
    valueBindings: [{ field: 'value', token: value.toFixed(2), evidenceId: 'guide' }],
    observationDate: '2026-07-01', publishedAt: '2026-06-20', effectiveFrom: '2026-07-01', effectiveTo: '2027-06-30',
    evidence: [{ evidenceId: 'guide', role: 'release', url: 'https://example.org/guide.pdf', publisher: 'Test Wage Office (not a real source)', title: 'Guide',
      quote: 'TEST pay guide, CW1 ordinary hourly rate $' + value.toFixed(2), locator: { page: 7 }, asOf: '2026-06-20', tier: 'primary',
      retrievedAt: '2026-09-30T00:00:00Z', contentSha256: sha('guide ' + value), licence: 'Test only' }],
    captureMethod: 'manual',
  };
}
function tempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-'));
  const data = path.join(root, 'gdata'), manual = path.join(root, 'manual');
  fs.mkdirSync(data); fs.mkdirSync(manual);
  return { root, data, manual };
}
const opts = (d, now, extra) => Object.assign({ dataDir: d.data, manualDir: d.manual, registry: REGISTRY, firestore: false, now }, extra || {});
function readRelease(dataDir) {
  const base = path.join(dataDir, 'grounding');
  const latestText = fs.readFileSync(path.join(base, 'latest.json'), 'utf8');
  const latest = JSON.parse(latestText);
  const dir = path.join(base, path.dirname(latest.manifest.path));
  return V.validateRelease({
    latestText, manifestText: fs.readFileSync(path.join(base, latest.manifest.path), 'utf8'),
    fileTexts: Object.fromEntries(['facts.json', 'watch.json', 'insights.json'].map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')])),
    directorySequence: Number(path.basename(dir)),
  });
}

test('the first run publishes release 1, with the branch guard rails, latest.json last', async () => {
  const d = tempDirs();
  const out = await run(opts(d, '2026-10-01T04:15:00Z'));
  assert.equal(out.sequence, 1);
  assert.equal(out.written[out.written.length - 3], 'grounding/latest.json', 'latest.json is written after the release files');
  assert.ok(out.written.includes('.gitattributes') && out.written.includes('README.md'));
  assert.match(fs.readFileSync(path.join(d.data, '.gitattributes'), 'utf8'), /\* -text/);
  const v = readRelease(d.data);
  assert.equal(v.ok, true, v.errors.join('; ')); assert.equal(v.sequence, 1);
});
test('an unchanged run writes nothing; a manual capture publishes; a correction follows as release 3', async () => {
  const d = tempDirs();
  await run(opts(d, '2026-10-01T04:15:00Z'));
  const same = await run(opts(d, '2026-10-02T04:15:00Z'));
  assert.equal(same.result.changed, false); assert.deepEqual(same.written, []);
  fs.writeFileSync(path.join(d.manual, 'test_award_cw1.json'), JSON.stringify(award(31.15), null, 2));
  const captured = await run(opts(d, '2026-10-03T04:15:00Z'));
  assert.equal(captured.sequence, 2);
  assert.equal(captured.result.changes[0].summary, 'Test award, CW1 hourly: $31.15/hour (2026-07-01)');
  fs.writeFileSync(path.join(d.manual, 'test_award_cw1.json'), JSON.stringify(award(31.25), null, 2));
  const corrected = await run(opts(d, '2026-10-04T04:15:00Z'));
  assert.equal(corrected.sequence, 3);
  const v = readRelease(d.data);
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.deepEqual(v.facts.results.map((r) => r.record.lifecycle).sort(), ['corrected', 'superseded']);
  // Every earlier release is still there, untouched.
  ['000001', '000002', '000003'].forEach((seq) => assert.ok(fs.existsSync(path.join(d.data, 'grounding', 'releases', seq, 'manifest.json')), seq));
});
test('a dry run builds and reports but writes nothing', async () => {
  const d = tempDirs();
  const out = await run(opts(d, '2026-10-01T04:15:00Z', { dryRun: true }));
  assert.equal(out.result.changed, true); assert.deepEqual(out.written, []);
  assert.equal(fs.existsSync(path.join(d.data, 'grounding')), false);
});
test('a tampered previous release stops the run before anything is built on it', async () => {
  const d = tempDirs();
  fs.writeFileSync(path.join(d.manual, 'test_award_cw1.json'), JSON.stringify(award(31.15)));
  await run(opts(d, '2026-10-01T04:15:00Z'));
  const facts = path.join(d.data, 'grounding', 'releases', '000001', 'facts.json');
  fs.writeFileSync(facts, fs.readFileSync(facts, 'utf8').replace('31.15', '31.95'));
  await assert.rejects(run(opts(d, '2026-10-02T04:15:00Z')), /previous release failed validation: facts.json: digest mismatch/);
});
test('latest.json cannot point the publisher outside the release layout', async () => {
  const d = tempDirs();
  await run(opts(d, '2026-10-01T04:15:00Z'));
  const latest = path.join(d.data, 'grounding', 'latest.json');
  const bad = JSON.parse(fs.readFileSync(latest, 'utf8')); bad.manifest.path = '../../secrets.json';
  fs.writeFileSync(latest, JSON.stringify(bad));
  await assert.rejects(run(opts(d, '2026-10-02T04:15:00Z')), /unexpected manifest path/);
});
test('a release directory is never overwritten', async () => {
  const d = tempDirs();
  await run(opts(d, '2026-10-01T04:15:00Z'));
  fs.mkdirSync(path.join(d.data, 'grounding', 'releases', '000002'));
  fs.writeFileSync(path.join(d.manual, 'test_award_cw1.json'), JSON.stringify(award(31.15)));
  await assert.rejects(run(opts(d, '2026-10-02T04:15:00Z')), /release directory releases\/000002 already exists/);
});
test('an automated series identifies as Daybook, and a refusal reads as blocked', async () => {
  const d = tempDirs();
  let seenAgent = null;
  const registry = REGISTRY.concat([{ seriesId: 'test_auto', title: 'Test automated series', capture: 'api', freshnessDays: 40, bounds: { min: 0, max: 10 }, cadenceHours: 24,
    fetch: async ({ fetch, userAgent }) => { seenAgent = userAgent; await fetch('https://example.org/refuses'); return { observations: [] }; } }]);
  const refusing = async (url) => { throw Object.assign(new Error('HTTP 403 from ' + url), { status: 403, url }); };
  const out = await run(opts(d, '2026-10-01T04:15:00Z', { registry, fetchImpl: refusing }));
  assert.match(seenAgent, /^bobdailybriefing\/1\.0 \(/);
  const w = out.result.snapshot.watch.find((x) => x.seriesId === 'test_auto');
  assert.equal(w.state, 'blocked'); assert.match(w.detail, /refused Daybook's reader \(HTTP 403\)/);
});

test('watch-only releases retain the exact facts bytes and digest', async () => {
  const d = tempDirs();
  fs.writeFileSync(path.join(d.manual, 'award.json'), JSON.stringify(award(31.15)));
  const first = await run(opts(d, '2026-10-01T04:15:00Z'));
  const later = await run(opts(d, '2028-10-01T04:15:00Z'));
  assert.equal(later.result.changed, true);
  assert.equal(later.result.snapshot.watch[0].state, 'stale');
  assert.equal(first.result.release.files['releases/000001/facts.json'], later.result.release.files['releases/000002/facts.json']);
});

test('deferred publication writes neither mirror nor health before the post-push step', async () => {
  const d = tempDirs(), mock = fakeDb();
  const pendingFile = path.join(d.root, 'pending.json');
  const config = opts(d, '2026-10-01T04:15:00Z', { firestore: true, db: mock.db, pendingFile });
  await run({ ...config, deferMirror: true });
  assert.deepEqual(mock.writes, []);
  assert.equal(JSON.parse(fs.readFileSync(pendingFile)).mirror.sequence, 1);
  await run({ ...config, mirrorOnly: true });
  assert.equal(mock.docs['grounding-latest'].sequence, 1);
  assert.equal(mock.docs['feed-health'].feeds.grounding.status, 'ok');
  const pending = JSON.parse(fs.readFileSync(pendingFile));
  pending.mirror.manifestSha256 = '0'.repeat(64);
  fs.writeFileSync(pendingFile, JSON.stringify(pending));
  const before = mock.writes.length;
  await assert.rejects(run({ ...config, mirrorOnly: true }), /does not match/);
  assert.equal(mock.writes.length, before);
  await assert.rejects(run({ ...config, pendingFile: path.join(d.data, 'private.json'), deferMirror: true }), /outside/);
});

test('only due sources fetch; failures report unhealthy and persist until a new check', async () => {
  const d = tempDirs(), mock = fakeDb();
  let calls = 0;
  const registry = [{ seriesId: 'test_auto', title: 'Test', cadenceHours: 48, fetch: async () => {
    calls++;
    throw Object.assign(new Error('HTTP 403'), { status: 403, url: 'https://example.org' });
  } }];
  const config = { firestore: true, db: mock.db, registry };
  await run(opts(d, '2026-10-01T04:15:00Z', config));
  assert.equal(mock.docs['feed-health'].feeds.grounding.status, 'failed');
  const second = await run(opts(d, '2026-10-02T04:15:00Z', config));
  assert.equal(calls, 1);
  assert.equal(second.result.changed, false);
  assert.equal(second.result.snapshot.watch[0].state, 'blocked');
  assert.equal(mock.docs['feed-health'].feeds.grounding.status, 'failed');
  await run(opts(d, '2026-10-03T04:15:00Z', config));
  assert.equal(calls, 2);
});

test('a later run recovers change notices after publication succeeded but mirroring failed', async () => {
  const d = tempDirs(), mock = fakeDb();
  fs.writeFileSync(path.join(d.manual, 'award.json'), JSON.stringify(award(31.15)));
  await run(opts(d, '2026-10-01T04:15:00Z'));
  const next = await run(opts(d, '2026-10-02T04:15:00Z', {firestore:true,db:mock.db}));
  assert.equal(next.result.changed,false);
  const changes = mock.docs['grounding-latest'].changes;
  assert.equal(changes.length,1);
  assert.match(changes[0].summary,/31.15/);
  assert.equal(changes[0].at,'2026-10-01T04:15:00Z');
});
