'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const V = require('../validate');
const { produce } = require('../producer');
const aip = require('./aip-tgp');

const PAGE = fs.readFileSync(path.join(__dirname, 'fixtures/aip-tgp-2026-09-30.html'), 'utf8');
// The scheduled run on Thursday 1 October, 06:15 in Sydney.
const THU = '2026-09-30T20:15:00Z';
const ENTRIES = aip.registryEntries();
const bounds = Object.fromEntries(ENTRIES.map((s) => [s.seriesId, s.bounds]));
const SYD = aip.SERIES.find((s) => s.key === 'sydney');

function source(page) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url !== aip.PAGE_URL) throw new Error('unexpected URL ' + url);
    return { ok: true, arrayBuffer: async () => Buffer.from(page !== undefined ? page : PAGE) };
  };
  return { fetch, calls };
}
async function runAll(page, now) {
  const src = source(page);
  const outs = [];
  for (const e of ENTRIES) outs.push(Object.assign({ seriesId: e.seriesId }, await e.fetch({ fetch: src.fetch, now })));
  return { outs, calls: src.calls };
}
// Another week's page: the same table, shifted to new days and prices.
function pageFor(labels, sydneyPrices) {
  let p = PAGE.replace(/<tr><th>Location<\/th>(<th>[^<]*<\/th>)+<\/tr>/, '<tr><th>Location</th>' + labels.map((l) => '<th>' + l + '</th>').join('') + '</tr>');
  assert.ok(labels.every((l) => p.includes('<th>' + l + '</th>')));
  if (sydneyPrices) p = p.replace('<td>274.7</td><td>271.5</td><td>269.2</td><td>268.2</td><td>266.5</td>', sydneyPrices.map((v) => '<td>' + v + '</td>').join(''));
  return p;
}

test('the page reads as AIP wrote it: five weekdays in order, seven capitals, the description\'s sentences', () => {
  const p = aip.parsePage(PAGE);
  assert.equal(p.title, 'Terminal Gate Prices | Australian Institute of Petroleum');
  assert.deepEqual(p.days.map((d) => d.iso), ['2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30']);
  assert.deepEqual(Object.keys(p.rows), ['Sydney', 'Melbourne', 'Brisbane', 'Adelaide', 'Darwin', 'Perth', 'Hobart']);
  assert.deepEqual(p.rows.Sydney, ['274.7', '271.5', '269.2', '268.2', '266.5']);
  assert.equal(p.notes.length, 3);
  assert.equal(aip.headingDay('Friday, 25th September 2026'), '2026-09-25');
  assert.equal(aip.headingDay('Thursday, 25th September 2026'), null, 'the weekday must match the date');
  assert.equal(aip.headingDay('Friday, 31st September 2026'), null);
});

test('the published day is the last one of the completed Sydney week, whatever the UTC date', () => {
  const days = aip.parsePage(PAGE).days;
  assert.equal(aip.completedWeekDay(days, THU).iso, '2026-09-25');
  // 00:30 on Monday 28 September in Sydney is still Sunday in UTC.
  assert.equal(aip.weekStart('2026-09-27T14:30:00Z'), '2026-09-28');
  assert.equal(aip.completedWeekDay(days, '2026-09-27T14:30:00Z').iso, '2026-09-25');
  // On Saturday 3 October the completed week is 28 Sep to 2 Oct, which this
  // table no longer fully shows; nothing before 28 Sep counts as new.
  const later = aip.parsePage(pageFor(['Monday, 28th September 2026', 'Tuesday, 29th September 2026', 'Wednesday, 30th September 2026', 'Thursday, 1st October 2026', 'Friday, 2nd October 2026'])).days;
  assert.equal(aip.completedWeekDay(later, '2026-10-02T22:00:00Z'), null);
  assert.equal(aip.completedWeekDay(later, '2026-10-04T20:15:00Z').iso, '2026-10-02');
});

test('seven observations from one read: Friday\'s price, in cents per litre, with the source\'s own words', async () => {
  const { outs, calls } = await runAll(PAGE, THU);
  assert.deepEqual(calls, [aip.PAGE_URL], 'one read of the page serves all seven');
  assert.deepEqual(outs.map((o) => [o.seriesId, o.observations[0].value, o.observations[0].scope.jurisdiction]), [
    ['aip_tgp_diesel_sydney', 271.5, 'NSW'], ['aip_tgp_diesel_melbourne', 269.5, 'VIC'], ['aip_tgp_diesel_brisbane', 271.9, 'QLD'],
    ['aip_tgp_diesel_adelaide', 267.4, 'SA'], ['aip_tgp_diesel_darwin', 277.6, 'NT'], ['aip_tgp_diesel_perth', 261.9, 'WA'], ['aip_tgp_diesel_hobart', 270.4, 'TAS']]);
  const o = outs[0].observations[0];
  assert.equal(o.observationKey, '2026-09-25'); assert.equal(o.publishedAt, '2026-09-25');
  assert.equal(o.unitCode, 'aud_cents_per_litre'); assert.equal(o.kind, 'rate'); assert.equal(o.basisCode, 'market_rate');
  assert.equal(o.evidence[0].quote, 'Diesel (cents per litre, inclusive of GST) […] Friday, 25th September 2026 […] Sydney […] 271.5');
  assert.deepEqual(o.evidence[0].locator, { table: 'Diesel (cents per litre, inclusive of GST), column "Friday, 25th September 2026"', row: 'Sydney' });
  assert.match(o.evidence[0].licence, /^© Australian Institute of Petroleum 2026\. All rights reserved; quoted in part for citation only\./);
  assert.deepEqual(o.qualifications.map((q) => q.text), [
    'Diesel (cents per litre, inclusive of GST)',
    'This page has been prepared by ORIMA Research Pty Ltd on behalf of the Australian Institute of Petroleum, using information provided by BP Australia, Ampol, Viva Energy Australia and ExxonMobil.',
    'Prices shown are the average Terminal Gate Price for unleaded petrol and diesel across each of these companies for the day.',
    'Prices are generally collated each weekday morning.']);
});

test('they validate and publish: fact-verified and plausible, not cross-checked, shown in c/L', async () => {
  const { outs } = await runAll(PAGE, THU);
  const r = produce({ previous: null, registry: ENTRIES, observations: outs.map((o) => o.observations[0]), now: THU, producerCommit: 'test' });
  assert.deepEqual(r.skipped, []);
  assert.equal(r.snapshot.facts.length, 7);
  for (const res of r.validation.results) {
    assert.deepEqual(res.checks, { sourceLinked: true, factVerified: true, crossChecked: false, plausible: true }, res.recordId);
    assert.deepEqual(res.unsupported, []);
  }
  assert.ok(r.changes.some((c) => c.summary === SYD.title + ': 271.5 c/L (2026-09-25)'), JSON.stringify(r.changes.map((c) => c.summary)));
});

test('the next week supersedes; the same week again changes nothing; an 80 c/L jump is held', async () => {
  const first = produce({ previous: null, registry: ENTRIES, observations: (await runAll(PAGE, THU)).outs.map((o) => o.observations[0]), now: THU, producerCommit: 'test' });
  const prev = (res) => { const f = res.release.files, d = res.release.dir; return { sequence: res.release.sequence, facts: JSON.parse(f[d + '/facts.json']).records, watch: JSON.parse(f[d + '/watch.json']).records, insights: [] }; };
  // The same completed week read on Friday morning, before AIP moves on: no change.
  const again = produce({ previous: prev(first), registry: ENTRIES, observations: (await runAll(PAGE, '2026-10-01T20:15:00Z')).outs.map((o) => o.observations[0]), now: '2026-10-01T20:15:00Z', producerCommit: 'test' });
  assert.equal(again.changed, false);
  const next = ['Tuesday, 29th September 2026', 'Wednesday, 30th September 2026', 'Thursday, 1st October 2026', 'Friday, 2nd October 2026', 'Monday, 5th October 2026'];
  const mon = '2026-10-05T20:15:00Z';
  const moved = produce({ previous: prev(first), registry: ENTRIES, observations: (await runAll(pageFor(next, ['268.2', '266.5', '265.0', '263.9', '262.0']), mon)).outs.map((o) => o.observations[0]), now: mon, producerCommit: 'test' });
  const syd = moved.snapshot.facts.filter((f) => f.seriesId === SYD.seriesId).map((f) => [f.recordId, f.lifecycle, f.value]);
  assert.deepEqual(syd, [['aip_tgp_diesel_sydney@2026-09-25#r1', 'superseded', 271.5], ['aip_tgp_diesel_sydney@2026-10-02#r1', 'current', 263.9]]);
  const jump = produce({ previous: prev(first), registry: ENTRIES, observations: (await runAll(pageFor(next, ['268.2', '266.5', '265.0', '352.0', '262.0']), mon)).outs.map((o) => o.observations[0]), now: mon, producerCommit: 'test' });
  assert.ok(jump.skipped.some((s) => s.seriesId === SYD.seriesId && s.reason === 'plausibility breach'));
});

test('it fails closed on anything it does not recognise', async () => {
  const cases = [
    [PAGE.replace('inclusive of GST)</h2>', 'exclusive of GST)</h2>'), /no "Diesel \(cents per litre, inclusive of GST\)" heading/],
    [PAGE.replace('<th>Location</th>', '<th>City</th>'), /headings read "City/],
    [PAGE.replace('Friday, 25th September 2026', 'Friday, 24th September 2026'), /is not a weekday date/],
    [PAGE.replace('<th>Thursday, 24th September 2026</th><th>Friday, 25th September 2026</th>', '<th>Friday, 25th September 2026</th><th>Thursday, 24th September 2026</th>'), /not in order/],
    [PAGE.replace('Prices are generally collated each weekday morning.', ''), /description no longer says "Prices are generally collated/],
    [PAGE.replace('<title>Terminal Gate Prices', '<title>Page not found'), /page title/],
  ];
  for (const [page, pattern] of cases) {
    const { outs } = await runAll(page, THU);
    assert.ok(outs.every((o) => o.status && o.status.state === 'blocked' && pattern.test(o.status.detail)), String(pattern) + ' ' + JSON.stringify(outs[0].status));
  }
  // One city: only that series is blocked.
  const noHobart = PAGE.replace(/<tr><td><a href="[^"]*hobartdiesel">Hobart<\/a><\/td>(<td>[^<]*<\/td>){5}<\/tr>/, '');
  let { outs } = await runAll(noHobart, THU);
  assert.equal(outs.filter((o) => o.status && o.status.state === 'blocked').map((o) => o.seriesId).join(), 'aip_tgp_diesel_hobart');
  ({ outs } = await runAll(PAGE.replace('<td>271.5</td>', '<td>n/a</td>'), THU));
  assert.equal(outs[0].status.state, 'blocked');
  assert.equal(outs[0].status.detail, 'Not published: Sydney\'s price for Friday, 25th September 2026 reads "n/a".');
  assert.equal(outs[1].observations.length, 1);
  // A page that cannot be fetched throws, so the publisher holds the day.
  await assert.rejects(ENTRIES[0].fetch({ fetch: async () => { throw new Error('ECONNRESET'); }, now: THU }), /ECONNRESET/);
});

test('the series are not registered yet: the consumers re-copy the contract first (H-8 lane 4)', () => {
  const REGISTRY = require('../series');
  assert.ok(!REGISTRY.some((s) => /^aip_tgp_/.test(s.seriesId)));
  assert.ok(V.ENUMS.unitCode.includes('aud_cents_per_litre'));
  assert.ok(ENTRIES.every((e) => e.streams.every((s) => V.ENUMS.stream.includes(s))));
});
