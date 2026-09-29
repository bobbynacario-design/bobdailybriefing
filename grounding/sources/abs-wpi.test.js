'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const V = require('../validate');
const { produce } = require('../producer');
const REGISTRY = require('../series');
const wpi = require('./abs-wpi');

// Verbatim fragments of the real June 2026 release page and the Data API answer
// (fetched 2026-09-29 with Daybook's user agent). Source: ABS, CC BY 4.0.
const PAGE = fs.readFileSync(path.join(__dirname, 'fixtures/abs-wpi-latest-2026-06.html'), 'utf8');
const CSV = fs.readFileSync(path.join(__dirname, 'fixtures/abs-wpi-api-2026-Q2.csv'), 'utf8');
const T1 = '2026-09-29T20:15:00Z'; // 06:15 AEST on 30 September
const T2 = '2026-09-30T20:15:00Z';
const IDS = wpi.SERIES.map((s) => s.seriesId);
const series = REGISTRY.filter((s) => IDS.indexOf(s.seriesId) >= 0);

// A mock of the publisher's fetchWithIdentity: throws on HTTP errors, with status.
function source(opts) {
  opts = opts || {};
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const isApi = url.startsWith(wpi.API_BASE);
    const fail = isApi ? opts.apiFail : opts.pageFail;
    if (fail) throw Object.assign(new Error('HTTP ' + fail + ' from ' + url), { status: fail, url });
    const body = isApi ? (opts.csv !== undefined ? opts.csv : CSV) : (opts.page !== undefined ? opts.page : PAGE);
    return { ok: true, arrayBuffer: async () => Buffer.from(body, 'utf8') };
  };
  return { fetch, calls };
}
// Run all three series' fetches as the publisher does (same fetch, same time).
async function fetchAll(src, now) {
  const out = { observations: [], status: {} };
  for (const s of series) {
    const r = await s.fetch({ fetch: src.fetch, now });
    r.observations.forEach((o) => out.observations.push(o));
    if (r.status) out.status[s.seriesId] = r.status;
  }
  return out;
}
const runWith = (previous, out, now) => produce({ previous, registry: series, observations: out.observations, seriesStatus: out.status, now, producerCommit: 'test' });
function asPrevious(result) {
  const f = result.release.files, d = result.release.dir;
  return { sequence: result.release.sequence, fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] },
    facts: JSON.parse(f[d + '/facts.json']).records, watch: JSON.parse(f[d + '/watch.json']).records, insights: JSON.parse(f[d + '/insights.json']).records };
}

test('the June 2026 release page and the Data API read as the ABS wrote them', () => {
  const p = wpi.parseReleasePage(PAGE);
  assert.deepEqual(p.quarter, { year: 2026, month: 6, key: '2026-Q2', name: 'June 2026', label: 'Jun-26' });
  assert.deepEqual([p.publishedAt, p.pageTitle, p.permanentUrl], ['2026-08-19', 'Wage Price Index, Australia, June 2026', 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/wage-price-index-australia/jun-2026']);
  assert.deepEqual(p.next, { date: '2026-11-18', title: 'Wage Price Index, Australia, September 2026' });
  assert.deepEqual(p.headline, { label: 'Jun-26', quarterly: '0.8', annual: '3.2' });
  assert.deepEqual(p.industries.Construction, { annual: '3.3', quarterly: '0.8' });
  assert.deepEqual(p.industries['Electricity, gas, water and waste services'], { annual: '3.6', quarterly: '0.6' });
  assert.deepEqual(p.industries['All industries'], { annual: '3.2', quarterly: '0.6' }, 'original terms: its quarter differs from the seasonally adjusted 0.8');
  assert.deepEqual(wpi.parseApiCsv(CSV, '2026-Q2'), { 'D/10': '3.6', 'TOT/10': '3.2', 'TOT/20': '3.2', 'E/10': '3.3' });
});

test('three fact-verified, cross-checked, plausible records from one page read and one API read', async () => {
  const src = source();
  const out = await fetchAll(src, T1);
  assert.equal(src.calls.length, 2, 'the page and the Data API are each read once for the three series');
  assert.deepEqual(out.observations.map((o) => [o.seriesId, o.observationKey, o.value]), [
    ['abs_wpi_all_industries_annual_change', '2026-Q2', 3.2], ['abs_wpi_construction_annual_change', '2026-Q2', 3.3], ['abs_wpi_electricity_gas_water_waste_annual_change', '2026-Q2', 3.6]]);
  const c = out.observations[1];
  assert.equal(c.evidence[0].quote, 'Annual and quarterly movement - industries (a). Construction: Annual change (%) 3.3; Quarterly change (%) 0.8.');
  assert.deepEqual(c.qualifications, [{ text: 'Index series is original, total hourly rates of pay excluding bonuses.', evidenceId: 'release' }]);
  assert.equal(c.evidence[1].url, 'https://data.api.abs.gov.au/rest/data/ABS,WPI,1.2.0/3.THRPEB.7.E.10.AUS.Q?startPeriod=2026-Q2&endPeriod=2026-Q2');
  assert.equal(out.observations[0].evidence[0].quote, 'All sector WPI, quarterly and annual movement (%), seasonally adjusted (a). Jun-26: Quarterly (%) 0.8; Annual (%) 3.2.');
  assert.deepEqual(out.observations[0].scope.period, { from: '2025-07-01', to: '2026-06-30' });

  const r = runWith(null, out, T1);
  assert.deepEqual(r.skipped, []);
  r.validation.results.forEach((x) => assert.deepEqual(x.checks, { sourceLinked: true, factVerified: true, crossChecked: true, plausible: true }, x.recordId));
  assert.deepEqual(r.changes.map((x) => x.summary), ['Wage Price Index, all industries, annual change (Australia): 3.2% (2026-Q2)',
    'Wage Price Index, Construction, annual change (Australia): 3.3% (2026-Q2)', 'Wage Price Index, Electricity, gas, water and waste services, annual change (Australia): 3.6% (2026-Q2)']);
  r.snapshot.watch.forEach((w) => { assert.equal(w.state, 'published'); assert.equal(w.expectedBy, '2026-11-18'); });
  // The same quarter read the next day cuts no release.
  assert.equal(runWith(asPrevious(r), await fetchAll(source(), T2), T2).changed, false);
});

test('September replaces June as a new observation of each series', async () => {
  const first = runWith(null, await fetchAll(source(), T1), T1);
  const sep = PAGE.replace(/June 2026/g, 'September 2026').replace('jun-2026/print', 'sep-2026/print').replace('>Jun-26<', '>Sep-26<')
    .replace('Next Release 18/11/2026', 'Next Release 25/02/2027').replace('Wage Price Index, Australia, September 2026</span>', 'Wage Price Index, Australia, December 2026</span>')
    .replace('<th scope="row" class="row-header">Construction</th><td class="data-value">3.3</td>', '<th scope="row" class="row-header">Construction</th><td class="data-value">3.5</td>');
  const csv = CSV.replace(/2026-Q2/g, '2026-Q3').replace('E,10,AUS,Q,2026-Q3,3.3', 'E,10,AUS,Q,2026-Q3,3.5');
  const later = runWith(asPrevious(first), await fetchAll(source({ page: sep, csv }), '2026-11-19T20:15:00Z'), '2026-11-19T20:15:00Z');
  const byId = Object.fromEntries(later.snapshot.facts.map((f) => [f.recordId, f]));
  assert.equal(byId['abs_wpi_construction_annual_change@2026-Q2#r1'].lifecycle, 'superseded');
  assert.equal(byId['abs_wpi_construction_annual_change@2026-Q3#r1'].value, 3.5);
  assert.ok(later.changes.some((x) => x.summary === 'Wage Price Index, Construction, annual change (Australia): 3.3% → 3.5% (2026-Q2 → 2026-Q3)'));
});

test('when the Data API disagrees, that series is a conflict and is not published', async () => {
  const r = runWith(null, await fetchAll(source({ csv: CSV.replace('E,10,AUS,Q,2026-Q2,3.3', 'E,10,AUS,Q,2026-Q2,3.9') }), T1), T1);
  assert.deepEqual(r.snapshot.facts.map((f) => f.seriesId), ['abs_wpi_all_industries_annual_change', 'abs_wpi_electricity_gas_water_waste_annual_change']);
  const w = r.snapshot.watch.find((x) => x.seriesId === 'abs_wpi_construction_annual_change');
  assert.equal(w.state, 'conflict');
});

test('an unreachable or lagging Data API holds the figures for the day', async () => {
  await assert.rejects(series[0].fetch({ fetch: source({ apiFail: 503 }).fetch, now: T1 }), /ABS Data API unavailable, so June 2026 is held for today/);
  await assert.rejects(series[1].fetch({ fetch: source({ csv: CSV.split('\n').filter((l) => !/,E,10,/.test(l)).join('\n') }).fetch, now: T1 }), /no E\/10 row for 2026-Q2 yet/);
});

test('a page that changed shape is blocked for all three, and says what it saw', async () => {
  const blockedBy = async (page, pattern) => {
    const out = await fetchAll(source({ page }), T1);
    assert.deepEqual(out.observations, []);
    Object.values(out.status).forEach((st) => { assert.equal(st.state, 'blocked'); assert.match(st.detail, pattern); });
    assert.equal(Object.keys(out.status).length, 3);
  };
  await blockedBy(PAGE.replace('Wage Price Index, Australia, June 2026 |', 'Wage Price Index, Australia, May 2026 |'), /page title is "Wage Price Index, Australia, May 2026"/);
  await blockedBy(PAGE.replace('>Jun-26<', '>Mar-26<'), /headline table ends at "Mar-26", not Jun-26/);
  await blockedBy(PAGE.replace('Annual change (%)</th>', 'Annual (%)</th>'), /industries table's columns are/);
  await blockedBy(PAGE.replace(/Index series is original, total hourly rates of pay excluding bonuses\./g, 'Index series is seasonally adjusted.'), /no longer says "Index series is original/);
  await blockedBy(PAGE.replace('<caption>Annual and quarterly movement - industries (a)</caption>', '<caption>Industries</caption>'), /table "Annual and quarterly movement - industries \(a\)" is missing/);
  const noRow = await series[2].fetch({ fetch: source({ page: PAGE.replace('>Electricity, gas, water and waste services<', '>Utilities<') }).fetch, now: T1 });
  assert.match(noRow.status.detail, /no "Electricity, gas, water and waste services" row/);
});

test('once the ABS\'s own release date has passed and the page has not moved, the series are overdue', async () => {
  // The morning run on the release day itself comes before the ABS publishes (11:30 am).
  const sameDay = await fetchAll(source(), '2026-11-17T20:15:00Z'); // 07:15 AEDT on 18 November
  assert.equal(sameDay.observations.length, 3);
  const out = await fetchAll(source(), '2026-11-18T20:15:00Z'); // 07:15 AEDT on 19 November
  assert.deepEqual(out.observations, []);
  Object.values(out.status).forEach((st) => assert.deepEqual(st, { state: 'overdue', expectedBy: '2026-11-18', url: wpi.LATEST_URL,
    detail: 'The ABS listed Wage Price Index, Australia, September 2026 for 2026-11-18; its page still shows June 2026.' }));
});

test('the registry entries carry the agreed bounds, freshness and cadence (D-H6-3); no consumer imports them yet', async () => {
  assert.deepEqual(series.map((s) => s.seriesId), IDS);
  series.forEach((s) => {
    assert.deepEqual([s.capture, s.freshnessDays, s.cadenceHours, s.publisher], ['page', 110, 12, 'Australian Bureau of Statistics']);
    assert.deepEqual(s.bounds, { min: -2, max: 10, maxChange: 2.5 });
  });
  const r = runWith(null, await fetchAll(source(), T1), T1);
  const d = r.release.dir, f = r.release.files;
  const release = V.validateRelease({ latestText: f['latest.json'], manifestText: f[d + '/manifest.json'],
    fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] }, directorySequence: 1 }, { bounds: {} });
  assert.equal(release.ok, true, release.errors.join('; '));
  // RiskM8's policy maps only the CPI: it skips all three.
  const plan = V.planImport(null, release, { mappingVersion: 'test', allow: { series: ['abs_cpi_all_groups_annual_change'], publishers: ['Australian Bureau of Statistics'], units: ['pct'], jurisdictions: ['AU'] } }, T1);
  assert.deepEqual(plan.skips.map((s) => s.reason), ['series not allowlisted', 'series not allowlisted', 'series not allowlisted']);
  assert.deepEqual(plan.toImport, []);
});
