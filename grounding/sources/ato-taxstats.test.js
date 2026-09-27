'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../validate');
const { produce } = require('../producer');
const REGISTRY = require('../series');
const ts = require('./ato-taxstats');

const series = REGISTRY.find((s) => s.seriesId === ts.SERIES_ID);
const noNetwork = async (url) => { throw new Error('the reminder must not read ' + url); };
const at = (iso) => ts.watchTaxStats({ fetch: noNetwork, now: iso });
const watchOnly = (status, previous, now) => produce({ previous, registry: [series], observations: [], seriesStatus: { [ts.SERIES_ID]: status }, now, producerCommit: 'test' });
function asPrevious(result) {
  const f = result.release.files, d = result.release.dir;
  return { sequence: result.release.sequence, fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] },
    facts: JSON.parse(f[d + '/facts.json']).records, watch: JSON.parse(f[d + '/watch.json']).records, insights: JSON.parse(f[d + '/insights.json']).records };
}

test('the reviewed edition is 2023-24, released 17 June 2026, with company industry benchmarks by fine industry', () => {
  assert.equal(ts.REVIEWED.edition, '2023-24');
  assert.equal(ts.REVIEWED.releasedOn, '2026-06-17');
  assert.match(ts.REVIEWED.finding, /fine industry and business industry code, by business status and business income range/);
  assert.match(ts.REVIEWED.finding, /gross profit ratio = \(total business income - cost of sales\) \/ total business income/);
});

test('published within 380 days of the release, stale after, and it never reads a site', async () => {
  const now = await at('2026-09-28T20:15:00Z');
  assert.equal(now.status.state, 'published');
  assert.match(now.status.detail, /^Reviewed 2026-09-28: Taxation Statistics 2023-24, released 2026-06-17\./);
  assert.equal(now.status.expectedBy, undefined);
  assert.equal((await at('2027-07-02T20:15:00Z')).status.state, 'published', 'day 380');
  const late = await at('2027-07-04T00:00:00Z');
  assert.equal(late.status.state, 'stale');
  assert.match(late.status.detail, /The ATO has published each edition in June\. Check whether a newer one is out with the same company industry benchmarks, tell RiskM8/);
});

test('the change to stale reaches the Morning 5; the same state the next day cuts no release', async () => {
  const first = watchOnly((await at('2027-07-01T20:15:00Z')).status, null, '2027-07-01T20:15:00Z');
  assert.equal(first.changes.length, 0);
  const again = watchOnly((await at('2027-07-02T20:15:00Z')).status, asPrevious(first), '2027-07-02T20:15:00Z');
  assert.equal(again.changed, false);
  const stale = watchOnly((await at('2027-07-04T20:15:00Z')).status, asPrevious(first), '2027-07-04T20:15:00Z');
  assert.equal(stale.changes.length, 1);
  assert.match(stale.changes[0].summary, /published → stale/);
  for (const r of [first, stale]) {
    assert.equal(V.validateWatchFile({ schema: V.SCHEMAS.watch, generatedAt: '2027-07-04T20:15:00Z', records: r.snapshot.watch }).ok, true);
    assert.ok(r.snapshot.watch[0].detail.length <= 500);
  }
});

test('the registry holds it as watch only, for RiskM8 first', () => {
  assert.equal(series.capture, 'watch');
  assert.equal(series.bounds, undefined);
  assert.equal(series.streams[0], 'risk_review');
});
