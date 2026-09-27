'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const V = require('../validate');
const { produce, buildMirror } = require('../producer');
const REGISTRY = require('../series');
const sg = require('./sg-legislation');

// The Federal Register API's real answer on 2026-09-28 (fetched as Daybook).
const LATEST = fs.readFileSync(path.join(__dirname, 'fixtures/legislation-sga-latest-2026-09-28.json'), 'utf8');
const T1 = '2026-09-28T20:15:00Z', T2 = '2026-09-29T20:15:00Z';
const series = REGISTRY.find((s) => s.seriesId === sg.SERIES_ID);

function api(body) {
  const calls = [];
  return { calls, fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, arrayBuffer: async () => Buffer.from(body === undefined ? LATEST : body) }; } };
}
function newer(extra) {
  const v = JSON.parse(LATEST);
  return JSON.stringify(Object.assign(v, { registerId: 'C2027C00111', compilationNumber: '79', start: '2027-07-01T00:00:00', registeredAt: '2027-06-20T09:00:00',
    reasons: [{ affect: 'Amend', affectedByTitle: { name: 'Superannuation Guarantee Amendment (Rate) Act 2027' } }] }, extra || {}));
}
const watchOnly = (status, previous, now) => produce({ previous, registry: [series], observations: [], seriesStatus: { [sg.SERIES_ID]: status }, now, producerCommit: 'test' });
function asPrevious(result) {
  const f = result.release.files, d = result.release.dir;
  return { sequence: result.release.sequence, fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] },
    facts: JSON.parse(f[d + '/facts.json']).records, watch: JSON.parse(f[d + '/watch.json']).records, insights: JSON.parse(f[d + '/insights.json']).records };
}

test('the Register\'s answer reads as compilation 78, amended by Payday Super', () => {
  assert.deepEqual(sg.parseVersion(LATEST), { registerId: 'C2026C00272', compilationNumber: '78', start: '2026-07-01', registeredOn: '2026-07-08',
    status: 'InForce', amendedBy: ['Treasury Laws Amendment (Payday Superannuation) Act 2025'] });
  assert.equal(sg.parseVersion('<html>Access Denied</html>'), null);
  assert.equal(sg.parseVersion(LATEST.replace(/"titleId":"C2004A04402"/, '"titleId":"C2004A00001"')), null, 'another Act is not this one');
});

test('the reviewed compilation reads as published, with what the review found', async () => {
  const src = api();
  const out = await sg.watchSg({ fetch: src.fetch, now: T1 });
  assert.equal(src.calls[0].url, sg.API_URL);
  assert.deepEqual(out.observations, []);
  assert.equal(out.status.state, 'published');
  assert.match(out.status.detail, /^Reviewed 2026-09-28: compilation 78 \(C2026C00272\), in force from 2026-07-01\. Section 17A\(2\): "charge percentage means 12\."/);
  assert.equal(sg.REVIEWED.registerId, sg.parseVersion(LATEST).registerId, 'the review is of the compilation the Register serves today');
});

test('a new compilation turns the series stale, naming it and its amending Act, and that reaches the Morning 5', async () => {
  const first = watchOnly((await sg.watchSg({ fetch: api().fetch, now: T1 })).status, null, T1);
  assert.equal(first.snapshot.facts.length, 0, 'watch only: never a fact');
  assert.equal(first.snapshot.watch[0].state, 'published');
  assert.equal(first.changes.length, 0, 'the first published state is not news');
  const out = await sg.watchSg({ fetch: api(newer()).fetch, now: T2 });
  assert.equal(out.status.state, 'stale');
  assert.match(out.status.detail, /compilation 79 \(C2027C00111\), in force from 2027-07-01, registered 2027-06-20; amended by Superannuation Guarantee Amendment \(Rate\) Act 2027\. Check whether the charge percentage in section 17A\(2\) changed/);
  const second = watchOnly(out.status, asPrevious(first), T2);
  assert.equal(second.snapshot.watch[0].state, 'stale');
  assert.equal(second.changes.length, 1);
  assert.equal(second.changes[0].kind, 'watch');
  assert.match(second.changes[0].summary, /published → stale/);
  const mirror = buildMirror(second, { now: T2, sequence: 2, titles: { [sg.SERIES_ID]: sg.TITLE } });
  assert.equal(mirror.watch[0].title, sg.TITLE);
});

test('the same answer the next day cuts no release', async () => {
  const first = watchOnly((await sg.watchSg({ fetch: api().fetch, now: T1 })).status, null, T1);
  const again = watchOnly((await sg.watchSg({ fetch: api().fetch, now: T2 })).status, asPrevious(first), T2);
  assert.equal(again.changed, false);
});

test('an unreadable answer is blocked; a long list of amending Acts still fits a valid watch record', async () => {
  const blocked = await sg.watchSg({ fetch: api('{"error":"unavailable"}').fetch, now: T1 });
  assert.equal(blocked.status.state, 'blocked');
  const many = newer({ reasons: Array.from({ length: 9 }, (_, i) => ({ affectedByTitle: { name: 'Treasury Laws Amendment (A Very Long Name About Many Things, Number ' + (i + 1) + ') Act 2027' } })) });
  const out = await sg.watchSg({ fetch: api(many).fetch, now: T1 });
  assert.ok(out.status.detail.length <= 500, out.status.detail.length);
  assert.match(out.status.detail, /; amended by 9 Acts\./, 'too long to name them: a count instead');
  const three = await sg.watchSg({ fetch: api(newer({ reasons: [1, 2, 3].map((i) => ({ affectedByTitle: { name: 'Short Act ' + i } })) })).fetch, now: T1 });
  assert.match(three.status.detail, /amended by Short Act 1; Short Act 2; and 1 more\./);
  const r = watchOnly(out.status, null, T1);
  assert.equal(V.validateWatchFile({ schema: V.SCHEMAS.watch, generatedAt: T1, records: r.snapshot.watch }).ok, true);
});

test('the registry holds it as watch only, and a consumer\'s plan has nothing to import from it', async () => {
  assert.equal(series.capture, 'watch');
  assert.equal(series.bounds, undefined);
  const r = watchOnly((await sg.watchSg({ fetch: api().fetch, now: T1 })).status, null, T1);
  const f = r.release.files, d = r.release.dir;
  const release = V.validateRelease({ latestText: f['latest.json'], manifestText: f[d + '/manifest.json'],
    fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] }, directorySequence: 1 });
  assert.equal(release.ok, true);
  assert.equal(V.planImport(null, release, { allow: { series: [sg.SERIES_ID], publishers: [], units: [], jurisdictions: [] } }, T1).toImport.length, 0);
});
