'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../validate');
const { produce } = require('../producer');
const REGISTRY = require('../series');
const sbb = require('./ato-sbb');

const series = REGISTRY.find((s) => s.seriesId === sbb.SERIES_ID);
// A fetch that fails the test if the reminder ever reads a site.
const noNetwork = async (url) => { throw new Error('the reminder must not read ' + url); };
const at = (iso) => sbb.watchSbb({ fetch: noNetwork, now: iso });
const watchOnly = (status, previous, now) => produce({ previous, registry: [series], observations: [], seriesStatus: { [sbb.SERIES_ID]: status }, now, producerCommit: 'test' });
function asPrevious(result) {
  const f = result.release.files, d = result.release.dir;
  return { sequence: result.release.sequence, fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] },
    facts: JSON.parse(f[d + '/facts.json']).records, watch: JSON.parse(f[d + '/watch.json']).records, insights: JSON.parse(f[d + '/insights.json']).records };
}

test('the reviewed year is the 2023-24 benchmarks, released 15 March 2026', () => {
  assert.deepEqual(sbb.REVIEWED, { benchmarkYear: '2023-24', releasedOn: '2026-03-15', reviewedOn: '2026-09-28' });
  assert.equal(sbb.STALE_AFTER_DAYS, 380);
});

test('it reads as published within a year of the release, and never touches a site', async () => {
  const out = await at('2026-09-28T20:15:00Z');
  assert.deepEqual(out.observations, []);
  assert.equal(out.status.state, 'published');
  assert.match(out.status.detail, /^Reviewed 2026-09-28: the 2023-24 benchmarks, released by the ATO on 2026-03-15\. A reminder, not a watch/);
  assert.equal(out.status.expectedBy, undefined, 'no expected date: the ATO states none (G8)');
  assert.equal((await at('2027-03-30T20:15:00Z')).status.state, 'published', 'day 380 is still inside');
});

test('it turns stale a year and two weeks after the release, and that reaches the Morning 5', async () => {
  const first = watchOnly((await at('2027-03-29T20:15:00Z')).status, null, '2027-03-29T20:15:00Z');
  assert.equal(first.snapshot.watch[0].state, 'published');
  assert.equal(first.changes.length, 0);
  const late = await at('2027-03-31T20:15:00Z');
  assert.equal(late.status.state, 'stale');
  assert.match(late.status.detail, /over a year old: 2023-24, released 2026-03-15\. The ATO has released each new year in March since 2024\. Check whether a newer year is out/);
  const second = watchOnly(late.status, asPrevious(first), '2027-03-31T20:15:00Z');
  assert.equal(second.snapshot.watch[0].state, 'stale');
  assert.equal(second.changes.length, 1);
  assert.match(second.changes[0].summary, /published → stale/);
});

test('the same state on the next day cuts no release, and the records are valid watch records', async () => {
  const first = watchOnly((await at('2026-09-28T20:15:00Z')).status, null, '2026-09-28T20:15:00Z');
  const again = watchOnly((await at('2026-09-29T20:15:00Z')).status, asPrevious(first), '2026-09-29T20:15:00Z');
  assert.equal(again.changed, false);
  for (const iso of ['2026-09-28T20:15:00Z', '2027-06-01T00:00:00Z']) {
    const r = watchOnly((await at(iso)).status, null, iso);
    assert.equal(V.validateWatchFile({ schema: V.SCHEMAS.watch, generatedAt: iso, records: r.snapshot.watch }).ok, true, iso);
    assert.ok(r.snapshot.watch[0].detail.length <= 500);
  }
});

test('the registry holds it as watch only', () => {
  assert.equal(series.capture, 'watch');
  assert.equal(series.bounds, undefined);
  assert.deepEqual(series.streams, ['sme_bi', 'risk_review']);
});
