'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const V = require('./validate');
const { produce, buildMirror, formatValue } = require('./producer');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const REGISTRY = [
  { seriesId: 'test_cpi_annual_change', title: 'Test CPI, annual change', freshnessDays: 45, bounds: { min: -5, max: 15, maxChange: 2 } },
  { seriesId: 'test_award_cw1', title: 'Test award, CW1 hourly', freshnessDays: 400, bounds: { min: 20, max: 60, maxChange: 5 } },
];
function cpi(key, value, extra) {
  const month = { '2026-08': 'August', '2026-09': 'September', '2026-07': 'July' }[key] || key;
  return Object.assign({
    seriesId: 'test_cpi_annual_change', observationKey: key, kind: 'index', title: 'Test CPI, annual change', value, unitCode: 'pct', basisCode: 'annual_change',
    scope: { jurisdiction: 'AU', classification: null, period: null },
    valueBindings: [{ field: 'value', token: String(value), evidenceId: 'release' }],
    observationDate: key + '-28', publishedAt: key + '-30',
    evidence: [
      { evidenceId: 'release', role: 'release', url: 'https://example.org/cpi/' + key, publisher: 'Test Bureau (not a real source)', title: 'CPI ' + key,
        quote: 'TEST: prices rose ' + value + '% in the 12 months to ' + month + ' 2026.', locator: { paragraph: 1 }, asOf: key + '-30', tier: 'primary',
        retrievedAt: '2026-10-01T04:15:00Z', contentSha256: sha('cpi ' + key), licence: 'Test only' },
    ],
    captureMethod: 'api',
  }, extra || {});
}
function award(value) {
  return {
    seriesId: 'test_award_cw1', observationKey: '2026-07-01', kind: 'award_wage', title: 'Test award, CW1 hourly', value, unitCode: 'aud_per_hour', basisCode: 'award_min_wage',
    scope: { jurisdiction: 'AU', classification: 'CW1', period: { from: '2026-07-01', to: '2027-06-30' } },
    valueBindings: [{ field: 'value', token: value.toFixed(2), evidenceId: 'guide' }],
    observationDate: '2026-07-01', publishedAt: '2026-06-20', effectiveFrom: '2026-07-01', effectiveTo: '2027-06-30',
    evidence: [{ evidenceId: 'guide', role: 'release', url: 'https://example.org/guide.pdf', publisher: 'Test Wage Office (not a real source)', title: 'Guide',
      quote: 'TEST pay guide, CW1 ordinary hourly rate $' + value.toFixed(2), locator: { page: 7 }, asOf: '2026-06-20', tier: 'primary',
      retrievedAt: '2026-10-01T04:15:00Z', contentSha256: sha('guide ' + value), licence: 'Test only' }],
    captureMethod: 'manual',
  };
}
const T1 = '2026-10-01T04:15:00Z', T2 = '2026-10-02T04:15:00Z', T3 = '2026-10-03T04:15:00Z';
// The previous release as the publisher would load it: parsed back from the cut texts.
function asPrevious(result) {
  const f = result.release.files, d = result.release.dir;
  return { sequence: result.release.sequence, facts: JSON.parse(f[d + '/facts.json']).records, watch: JSON.parse(f[d + '/watch.json']).records, insights: JSON.parse(f[d + '/insights.json']).records };
}
const run = (previous, observations, now, extra) => produce(Object.assign({ previous, registry: REGISTRY, observations, now, producerCommit: 'test' }, extra || {}));

test('the first run cuts release 1, even with nothing observed yet', () => {
  const r = run(null, [], T1);
  assert.equal(r.changed, true); assert.equal(r.release.sequence, 1);
  assert.deepEqual(r.snapshot.facts, []);
  assert.deepEqual(r.snapshot.watch.map((w) => w.state), ['awaiting_publication', 'awaiting_publication']);
  assert.equal(r.changes.length, 0, 'awaiting is the starting state, not news');
});
test('a first figure becomes revision 1, current, and is reported as new', () => {
  const r = run(null, [cpi('2026-08', 3.1)], T1);
  const f = r.snapshot.facts[0];
  assert.equal(f.recordId, 'test_cpi_annual_change@2026-08#r1'); assert.equal(f.lifecycle, 'current'); assert.equal(f.supersedes, null);
  assert.equal(r.snapshot.watch[0].state, 'published');
  assert.deepEqual(r.changes.map((c) => [c.kind, c.summary]), [['new', 'Test CPI, annual change: 3.1% (2026-08)']]);
});
test('the same figure fetched again changes nothing and cuts no release', () => {
  const first = run(null, [cpi('2026-08', 3.1)], T1);
  const again = cpi('2026-08', 3.1);
  again.evidence[0].retrievedAt = T2; again.evidence[0].contentSha256 = sha('a different page render'); again.evidence[0].asOf = '2026-10-02';
  const second = run(asPrevious(first), [again], T2);
  assert.equal(second.changed, false); assert.equal(second.release, null);
  assert.equal(second.snapshot.watch[0].stateChangedAt, T1, 'the watch record is kept whole');
});
test('a changed figure for the same period is a correction that supersedes the old revision', () => {
  const first = run(null, [award(31.15)], T1);
  const second = run(asPrevious(first), [award(31.25)], T2);
  assert.equal(second.release.sequence, 2);
  const byId = Object.fromEntries(second.snapshot.facts.map((f) => [f.recordId, f]));
  assert.equal(byId['test_award_cw1@2026-07-01#r1'].lifecycle, 'superseded');
  assert.equal(byId['test_award_cw1@2026-07-01#r2'].lifecycle, 'corrected');
  assert.equal(byId['test_award_cw1@2026-07-01#r2'].supersedes, 'test_award_cw1@2026-07-01#r1');
  assert.equal(second.changes[0].summary, 'Test award, CW1 hourly corrected: $31.15/hour → $31.25/hour (2026-07-01)');
});
test('a new period supersedes the previous one; an older period is refused', () => {
  const first = run(null, [cpi('2026-08', 3.1)], T1);
  const second = run(asPrevious(first), [cpi('2026-09', 2.9)], T2);
  const byId = Object.fromEntries(second.snapshot.facts.map((f) => [f.recordId, f]));
  assert.equal(byId['test_cpi_annual_change@2026-08#r1'].lifecycle, 'superseded');
  assert.equal(byId['test_cpi_annual_change@2026-09#r1'].supersedes, 'test_cpi_annual_change@2026-08#r1');
  assert.equal(second.changes[0].summary, 'Test CPI, annual change: 3.1% → 2.9% (2026-08 → 2026-09)');
  const third = run(asPrevious(second), [cpi('2026-07', 3.0)], T3);
  assert.equal(third.changed, false);
  assert.match(third.skipped[0].reason, /older than the latest observation \(2026-09\)/);
});
test('a plausibility breach is not published: the last good figure stays and the watch says why', () => {
  const first = run(null, [cpi('2026-08', 3.1)], T1);
  const jump = run(asPrevious(first), [cpi('2026-09', 8.5)], T2);
  assert.equal(jump.snapshot.facts.length, 1, 'the breaching figure is not in the snapshot');
  assert.equal(jump.snapshot.facts[0].lifecycle, 'current');
  const w = jump.snapshot.watch[0];
  assert.equal(w.state, 'blocked');
  assert.match(w.detail, /8\.5% \(2026-09\) is outside this series' plausibility bounds \(min -5, max 15, max change 2\)/);
  assert.equal(jump.changes.length, 1); assert.equal(jump.changes[0].kind, 'watch');
  // The same bad figure the next day: same state, same words, nothing to release.
  const again = run(asPrevious(jump), [cpi('2026-09', 8.5)], T3);
  assert.equal(again.changed, false);
  // With a reviewer's override it publishes.
  const cleared = run(asPrevious(jump), [cpi('2026-09', 8.5, { plausibilityOverride: { reviewer: 'BN', at: T3, reason: 'Checked against the release.', failedBound: { kind: 'change', limit: 2, observed: 5.4 } } })], T3);
  assert.equal(cleared.snapshot.facts.find((f) => f.observationKey === '2026-09').lifecycle, 'current');
  assert.equal(cleared.snapshot.watch[0].state, 'published');
});
test('a cross-check that disagrees is a conflict, not a figure', () => {
  const obs = cpi('2026-08', 3.1);
  obs.evidence.push(Object.assign({}, obs.evidence[0], { evidenceId: 'table', role: 'cross_check', quote: 'Aug-2026,139.2,3.4', locator: { table: 't', row: 'Aug-2026' } }));
  const r = run(null, [obs], T1);
  assert.equal(r.snapshot.facts.length, 0);
  assert.equal(r.snapshot.watch[0].state, 'conflict');
  assert.match(r.snapshot.watch[0].detail, /^The data table disagrees with the release: cross-check conflict/);
});
test('a figure older than its freshness window turns stale, once', () => {
  const first = run(null, [cpi('2026-08', 3.1)], T1);
  const late = run(asPrevious(first), [], '2026-11-20T04:15:00Z');
  assert.equal(late.snapshot.watch[0].state, 'stale');
  assert.equal(late.changes[0].kind, 'watch');
  const later = run(asPrevious(late), [], '2026-11-21T04:15:00Z');
  assert.equal(later.changed, false, 'still stale: nothing new to release');
  assert.equal(later.snapshot.watch[0].stateChangedAt, '2026-11-20T04:15:00Z');
});
test('a transient fetch failure keeps the previous watch record', () => {
  const first = run(null, [cpi('2026-08', 3.1)], T1);
  const r = run(asPrevious(first), [], T2, { seriesStatus: { test_cpi_annual_change: { keep: true } } });
  assert.equal(r.changed, false);
});
test('a source that refuses automated readers is reported as blocked', () => {
  const r = run(null, [], T1, { seriesStatus: { test_award_cw1: { state: 'blocked', detail: 'The source returned 403 to Daybook\'s reader; capture by hand.', url: 'https://example.org/guides' } } });
  const w = r.snapshot.watch.find((x) => x.seriesId === 'test_award_cw1');
  assert.equal(w.state, 'blocked'); assert.equal(w.evidence.url, 'https://example.org/guides');
});
test('an unregistered series is skipped, not published', () => {
  const r = run(null, [Object.assign(cpi('2026-08', 3.1), { seriesId: 'test_unknown' })], T1);
  assert.equal(r.snapshot.facts.length, 0);
  assert.match(r.skipped[0].reason, /not registered/);
});
test('each release passes the consumers\' validator and numbers follow on', () => {
  const r1 = run(null, [cpi('2026-08', 3.1), award(31.15)], T1);
  const r2 = run(asPrevious(r1), [cpi('2026-09', 2.9), award(31.15)], T2);
  [r1, r2].forEach((r) => {
    const d = r.release.dir, f = r.release.files;
    const v = V.validateRelease({ latestText: f['latest.json'], manifestText: f[d + '/manifest.json'], fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] }, directorySequence: r.release.sequence });
    assert.equal(v.ok, true, v.errors.join('; '));
  });
  assert.equal(JSON.parse(r2.release.files[r2.release.dir + '/manifest.json']).previousSequence, 1);
});
test('the mirror carries live figures with computed trust attributes, and 30 days of changes', () => {
  const r = run(null, [cpi('2026-08', 3.1), award(31.15)], T1);
  const m = buildMirror(r, { now: T1, sequence: 1, manifestSha256: r.release.manifestSha256, releaseUrl: 'https://example.org/latest.json',
    previousChanges: [{ id: 'old', kind: 'new', at: '2026-08-01T00:00:00Z', summary: 'too old' }, { id: 'recent', kind: 'new', at: '2026-09-20T00:00:00Z', summary: 'kept' }] });
  assert.deepEqual(m.facts.map((f) => f.display).sort(), ['$31.15/hour', '3.1%']);
  assert.deepEqual(m.facts.find((f) => f.seriesId === 'test_cpi_annual_change').checks, { sourceLinked: true, factVerified: true, crossChecked: false, plausible: true });
  assert.deepEqual(m.changes.map((c) => c.id), ['test_award_cw1@2026-07-01#r1', 'test_cpi_annual_change@2026-08#r1', 'recent']);
  assert.ok(!JSON.stringify(m).includes('too old'));
  assert.equal(buildMirror(r, { now: T1, sequence: 1, titles: { test_award_cw1: 'Test award, CW1 hourly' } }).watch.find((w) => w.seriesId === 'test_award_cw1').title, 'Test award, CW1 hourly');
  assert.equal(m.watch[0].title, m.watch[0].seriesId, 'without a registry title the key is shown');
});
test('values display in their units', () => {
  assert.equal(formatValue({ unitCode: 'pct_pa', value: 3.6 }), '3.6% p.a.');
  assert.equal(formatValue({ unitCode: 'aud_per_day', range: { min: 18.5, max: 34 } }), '$18.50–$34.00/day');
  assert.equal(formatValue({ unitCode: 'index_points', value: 139.2 }), '139.2 index points');
  assert.equal(formatValue({ unitCode: 'aud_per_item', value: 272.8 }), '$272.80 each');
});
