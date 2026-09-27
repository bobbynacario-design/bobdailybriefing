'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const V = require('../validate');
const { produce } = require('../producer');
const REGISTRY = require('../series');
const nsw = require('./nsw-tow-fees');

// Verbatim fragments of the real page (fetched 2026-09-27 as Daybook).
// © State of New South Wales, CC BY 4.0.
const PAGE = fs.readFileSync(path.join(__dirname, 'fixtures/nsw-tow-fees-2026-27.html'), 'utf8');
const T1 = '2026-09-27T20:15:00Z', T2 = '2026-09-28T20:15:00Z';
const TOW_ID = 'nsw_tow_accident_towing_light@2026-07-01#r1';
const STORAGE_ID = 'nsw_tow_storage_light_daily@2026-07-01#r1';

function source(page) {
  const calls = [];
  return { calls, fetch: async (url) => { calls.push(url); return { ok: true, arrayBuffer: async () => Buffer.from(page === undefined ? PAGE : page) }; } };
}
async function observe(page, now) {
  const tow = await nsw.fetchTow({ fetch: source(page).fetch, now });
  const storage = await nsw.fetchStorage({ fetch: source(page).fetch, now });
  return { tow, storage, observations: tow.observations.concat(storage.observations) };
}
const run = (previous, observations, now, status) => produce({ previous, registry: REGISTRY, observations, seriesStatus: status || {}, now, producerCommit: 'test' });
function asPrevious(result) {
  const f = result.release.files, d = result.release.dir;
  return { sequence: result.release.sequence, fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] },
    facts: JSON.parse(f[d + '/facts.json']).records, watch: JSON.parse(f[d + '/watch.json']).records, insights: JSON.parse(f[d + '/insights.json']).records };
}
function asRelease(result, bounds) {
  const f = result.release.files, d = result.release.dir;
  return V.validateRelease({ latestText: f['latest.json'], manifestText: f[d + '/manifest.json'],
    fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] }, directorySequence: result.release.sequence }, { bounds: bounds || {} });
}

test('the 2026-27 page reads as NSW wrote it', () => {
  const p = nsw.parsePage(PAGE);
  assert.equal(p.updatedOn, '2026-07-01');
  assert.equal(p.from, '2026-07-01'); assert.equal(p.to, '2027-06-30');
  assert.equal(p.gstSentence, 'These fees are valid for the 2026 to 2027 period. The listed charges exclude any applicable GST.');
  assert.deepEqual([p.tow.value, p.storageOther.value, p.storageMetro.value], [320, 18, 34]);
  assert.deepEqual(p.extras, [
    'For each tow undertaken in excess of 10km via the most direct route (defined Sydney metropolitan area): $7 per km',
    'For each tow undertaken via the most direct route in excess of 20km (other areas): $6 per km',
    'Surcharge outside business hours: 20%',
  ]);
});

test('both series publish fact-verified and plausible, matching ClaimBench\'s approved NSW records', async () => {
  const src = await observe(undefined, T1);
  const r = run(null, src.observations, T1);
  assert.deepEqual(r.skipped, []);
  const byId = Object.fromEntries(r.snapshot.facts.map((f) => [f.recordId, f]));
  assert.equal(byId[TOW_ID].value, 320);
  assert.equal(byId[TOW_ID].unitCode, 'aud_per_item');
  assert.deepEqual(byId[STORAGE_ID].range, { min: 18, max: 34 });
  assert.equal(byId[STORAGE_ID].unitCode, 'aud_per_day');
  for (const id of [TOW_ID, STORAGE_ID]) {
    const f = byId[id];
    assert.equal(f.kind, 'regulated_fee'); assert.equal(f.basisCode, 'regulated_fee_max');
    assert.equal(f.scope.jurisdiction, 'NSW');
    assert.equal(f.effectiveFrom, '2026-07-01'); assert.equal(f.effectiveTo, '2027-06-30');
    assert.equal(f.evidence[0].publisher, 'NSW Fair Trading');
    assert.match(f.evidence[0].licence, /^CC BY 4\.0\. © State of New South Wales/);
    const checks = r.validation.results.find((x) => x.recordId === id).checks;
    assert.deepEqual(checks, { sourceLinked: true, factVerified: true, crossChecked: false, plausible: true });
  }
  assert.ok(byId[TOW_ID].qualifications.some((q) => q.text === 'Surcharge outside business hours: 20%'));
});

test('the same page tomorrow, or a new "Last updated" date alone, cuts no release', async () => {
  const first = run(null, (await observe(undefined, T1)).observations, T1);
  assert.equal(run(asPrevious(first), (await observe(undefined, T2)).observations, T2).changed, false);
  const bumped = PAGE.replace('<dd>01 July 2026</dd>', '<dd>14 October 2026</dd>');
  assert.equal(run(asPrevious(first), (await observe(bumped, T2)).observations, T2).changed, false);
});

test('next year\'s page is a new observation that replaces this year\'s', async () => {
  const first = run(null, (await observe(undefined, T1)).observations, T1);
  const next = PAGE.replace('<dd>01 July 2026</dd>', '<dd>01 July 2027</dd>').replace('valid for the 2026 to 2027 period', 'valid for the 2027 to 2028 period')
    .replace('<td>$320</td>', '<td>$332</td>').replace('<td>$34</td>', '<td>$35</td>');
  const at = '2027-07-01T20:15:00Z';
  const r = run(asPrevious(first), (await observe(next, at)).observations, at);
  const byKey = Object.fromEntries(r.snapshot.facts.filter((f) => f.seriesId === 'nsw_tow_accident_towing_light').map((f) => [f.observationKey, f]));
  assert.equal(byKey['2026-07-01'].lifecycle, 'superseded');
  assert.equal(byKey['2027-07-01'].value, 332);
  assert.equal(byKey['2027-07-01'].supersedes, TOW_ID);
  assert.ok(r.changes.some((c) => c.summary === 'NSW accident towing, light vehicles: maximum charge per tow (ex GST): $320.00 each → $332.00 each (2026-07-01 → 2027-07-01)'));
});

test('a page that changed shape is blocked, and says what it saw', async () => {
  const cases = [
    [PAGE.replace('valid for the 2026 to 2027 period', 'valid from 1 July 2026'), /does not say "These fees are valid for the <year> to <year> period/],
    [PAGE.replace('valid for the 2026 to 2027 period', 'valid for the 2026 to 2028 period'), /"2026 to 2028" is not one financial year/],
    [PAGE.replace('<td>For any accident towing work</td>', '<td>Accident towing</td>'), /no row "For any accident towing work"/],
    [PAGE.replace('<td>$320</td>', '<td>$320 plus GST</td>'), /reads "\$320 plus GST", not a whole-dollar charge/],
    [PAGE.replace('<td>$18</td>', '<td>$48</td>'), /outside-Sydney storage \(\$48\) is above Sydney metro \(\$34\)/],
    [PAGE.replace('<h2>Towing fees</h2>', '<h2>Fees</h2>'), /the "Towing fees" table is missing/],
  ];
  for (const [page, why] of cases) {
    const out = await nsw.fetchTow({ fetch: source(page).fetch, now: T1 });
    const outS = await nsw.fetchStorage({ fetch: source(page).fetch, now: T1 });
    assert.equal(out.observations.length, 0);
    assert.equal(out.status.state, 'blocked');
    assert.match(out.status.detail, why);
    assert.equal(outS.status.state, 'blocked');
  }
});

test('a ClaimBench-shaped plan imports both NSW records and nothing else', async () => {
  const r = run(null, (await observe(undefined, T1)).observations, T1);
  const release = asRelease(r, { nsw_tow_accident_towing_light: { min: 200, max: 500, maxChange: 60 }, nsw_tow_storage_light_daily: { min: 10, max: 60, maxChange: 10 } });
  assert.equal(release.ok, true, release.errors.join('; '));
  const policy = { mappingVersion: 'test', refuseDerived: true,
    allow: { series: ['nsw_tow_accident_towing_light', 'nsw_tow_storage_light_daily'], publishers: ['NSW Fair Trading'], units: ['aud_per_item', 'aud_per_day'], jurisdictions: ['NSW'] } };
  const plan = V.planImport(null, release, policy, T1);
  assert.deepEqual(plan.toImport.map((x) => x.recordId).sort(), [TOW_ID, STORAGE_ID]);
});
