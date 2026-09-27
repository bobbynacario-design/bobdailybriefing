'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { produce } = require('../producer');
const REGISTRY = require('../series');
const cpi = require('./abs-cpi');

// Verbatim fragments of the real July 2026 release page and API answer (fetched
// 2026-09-27 with Daybook's user agent). Source: ABS, CC BY 4.0.
const PAGE = fs.readFileSync(path.join(__dirname, 'fixtures/abs-cpi-latest-2026-07.html'), 'utf8');
const CSV = fs.readFileSync(path.join(__dirname, 'fixtures/abs-cpi-api-2026-07.csv'), 'utf8');
const T1 = '2026-09-27T20:15:00Z'; // 04:15 PHT on 28 September
const T2 = '2026-09-28T20:15:00Z';

// A mock of the publisher's fetchWithIdentity: throws on HTTP errors, with status.
function source(opts) {
  opts = opts || {};
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const isApi = url.startsWith(cpi.API_BASE);
    const fail = isApi ? opts.apiFail : opts.pageFail;
    if (fail) throw Object.assign(new Error('HTTP ' + fail + ' from ' + url), { status: fail, url });
    const body = isApi ? (opts.csv !== undefined ? opts.csv : CSV) : (opts.page !== undefined ? opts.page : PAGE);
    return { ok: true, arrayBuffer: async () => Buffer.from(body, 'utf8') };
  };
  return { fetch, calls };
}
const cpiSeries = REGISTRY.find((s) => s.seriesId === cpi.SERIES_ID);
function runWith(previous, out, now) {
  return produce({ previous, registry: REGISTRY, observations: out.observations, seriesStatus: out.status ? { [cpi.SERIES_ID]: out.status } : {}, now, producerCommit: 'test' });
}
function asPrevious(result) {
  const f = result.release.files, d = result.release.dir;
  return { sequence: result.release.sequence, fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] },
    facts: JSON.parse(f[d + '/facts.json']).records, watch: JSON.parse(f[d + '/watch.json']).records, insights: JSON.parse(f[d + '/insights.json']).records };
}

test('the July 2026 release page reads as the ABS wrote it', () => {
  const p = cpi.parseReleasePage(PAGE);
  assert.equal(p.period.name, 'July 2026');
  assert.equal(p.publishedAt, '2026-08-26');
  assert.equal(p.heading, 'In the 12 months to July 2026:');
  assert.equal(p.item, 'The Consumer Price Index (CPI) rose 3.5%, down from 3.8% in the 12 months to June 2026.');
  assert.equal(p.direction, 'rose');
  assert.equal(p.valueText, '3.5');
  assert.equal(p.permanentUrl, 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/jul-2026');
  assert.equal(p.pageTitle, 'Consumer Price Index, Australia, July 2026');
  assert.deepEqual(p.next, { date: '2026-09-30', title: 'Consumer Price Index, Australia, August 2026' });
});

test('the Data API cell is read exactly, and only for the series asked for', () => {
  assert.deepEqual(cpi.parseApiCsv(CSV, '2026-07'), { cell: '3.5' });
  assert.deepEqual(cpi.parseApiCsv(CSV, '2026-08'), { missing: true });
  assert.throws(() => cpi.parseApiCsv(CSV.replace(',10001,', ',115901,'), '2026-07'), /INDEX 115901, not 10001/);
  assert.throws(() => cpi.parseApiCsv('DATAFLOW,TIME_PERIOD\r\n', '2026-07'), /no MEASURE column/);
  assert.throws(() => cpi.parseApiCsv(CSV.replace(',3.5,', ',n/a,'), '2026-07'), /value for 2026-07 is "n\/a"/);
});

test('a real release becomes a fact-verified, cross-checked, plausible record with the ABS\'s next date', async () => {
  const src = source();
  const out = await cpi.fetchCpi({ fetch: src.fetch, now: T1 });
  assert.equal(src.calls.length, 2);
  assert.equal(src.calls[1].url, cpi.API_BASE + '?startPeriod=2026-07&endPeriod=2026-07');
  assert.equal(src.calls[1].init.headers.accept, 'application/vnd.sdmx.data+csv');
  const r = runWith(null, out, T1);
  assert.equal(r.changed, true);
  assert.equal(r.skipped.length, 0, JSON.stringify(r.skipped));
  const fact = r.snapshot.facts[0];
  assert.equal(fact.recordId, 'abs_cpi_all_groups_annual_change@2026-07#r1');
  assert.equal(fact.value, 3.5);
  assert.deepEqual(fact.scope, { jurisdiction: 'AU', classification: 'All groups CPI', period: { from: '2025-08-01', to: '2026-07-31' } });
  assert.equal(fact.observationDate, '2026-07-31');
  assert.equal(fact.evidence[0].publisher, 'Australian Bureau of Statistics');
  assert.equal(fact.evidence[1].quote, '3.5');
  const checks = r.validation.results.find((x) => x.recordId === fact.recordId).checks;
  assert.deepEqual(checks, { sourceLinked: true, factVerified: true, crossChecked: true, plausible: true });
  const w = r.snapshot.watch[0];
  assert.equal(w.state, 'published');
  assert.equal(w.expectedBy, '2026-09-30');
  assert.equal(w.evidence.url, cpi.LATEST_URL);
  assert.equal(w.detail, 'Latest: 3.5% (2026-07), published 2026-08-26. Next: Consumer Price Index, Australia, August 2026, listed by the ABS for 2026-09-30.');
  assert.equal(r.changes[0].summary, 'CPI, all groups, annual change (Australia): 3.5% (2026-07)');
  // What RiskM8's bi_price_index target needs: pct, annual_change, a single value and period.to.
  assert.equal(fact.unitCode, 'pct'); assert.equal(fact.basisCode, 'annual_change'); assert.equal(fact.range, null);
});

test('the same month read again the next day cuts no release', async () => {
  const first = runWith(null, await cpi.fetchCpi({ fetch: source().fetch, now: T1 }), T1);
  const again = runWith(asPrevious(first), await cpi.fetchCpi({ fetch: source().fetch, now: T2 }), T2);
  assert.equal(again.changed, false);
  assert.equal(again.changes.length, 0);
});

test('when the Data API disagrees, the figure is a conflict and is not published', async () => {
  const out = await cpi.fetchCpi({ fetch: source({ csv: CSV.replace(',3.5,', ',3.6,') }).fetch, now: T1 });
  const r = runWith(null, out, T1);
  assert.equal(r.snapshot.facts.length, 0);
  assert.equal(r.snapshot.watch[0].state, 'conflict');
});

test('an unreachable or lagging Data API holds the figure for the day (D-E2)', async () => {
  for (const opts of [{ apiFail: 503 }, { apiFail: 403 }]) {
    const err = await cpi.fetchCpi({ fetch: source(opts).fetch, now: T1 }).then(() => null, (e) => e);
    assert.match(err.message, /ABS Data API unavailable, so July 2026 is held for today: HTTP /);
    assert.equal(err.status, undefined, 'no HTTP status, so the publisher holds rather than blocks');
  }
  const lag = await cpi.fetchCpi({ fetch: source({ csv: CSV.split('\n')[0] + '\n' }).fetch, now: T1 }).then(() => null, (e) => e);
  assert.match(lag.message, /has no 2026-07 row yet, so July 2026 is held for today/);
});

test('a page that changed shape is blocked, and says what it saw', async () => {
  const cases = [
    [PAGE.replace('id="key-statistics"', 'id="headline"'), /"Key statistics" section is missing/],
    [PAGE.replace('<span>In the 12 months to July 2026:</span>', '<span>Over the year to July 2026:</span>'), /opens with "Over the year to July 2026:"/],
    [PAGE.replace('In the 12 months to July 2026:', 'In the 12 months to June 2026:'), /is for June 2026 but the reference period is July 2026/],
    [PAGE.replace('The Consumer Price Index (CPI) rose 3.5%', 'Trimmed mean inflation was 3.6%'), /first key statistic reads "Trimmed mean/],
    [PAGE.replace('jul-2026/print', 'jun-2026/print'), /permanent address is jun-2026, not jul-2026/],
    [PAGE.replace('<div class="field__item">July 2026</div>', '<div class="field__item">Jul 2026</div>'), /no "Reference period" month/],
  ];
  for (const [page, why] of cases) {
    const out = await cpi.fetchCpi({ fetch: source({ page }).fetch, now: T1 });
    assert.equal(out.observations.length, 0);
    assert.equal(out.status.state, 'blocked');
    assert.match(out.status.detail, why);
    const r = runWith(null, out, T1);
    assert.equal(r.snapshot.watch[0].state, 'blocked');
  }
});

test('a fall in prices is blocked for capture by hand: an unsigned quote cannot bind a negative value', async () => {
  const out = await cpi.fetchCpi({ fetch: source({ page: PAGE.replace('rose 3.5%', 'fell 0.3%') }).fetch, now: T1 });
  assert.equal(out.status.state, 'blocked');
  assert.match(out.status.detail, /prices fell 0\.3% in the 12 months to July 2026.*capture this month by hand/);
});

test('once the ABS\'s own release date has passed and the page has not moved, the series is overdue', async () => {
  const first = runWith(null, await cpi.fetchCpi({ fetch: source().fetch, now: T1 }), T1);
  // 04:15 PHT on 1 October is 06:15 on 1 October in Sydney: the 30 September release is due.
  const late = '2026-09-30T20:15:00Z';
  assert.equal(cpi.sydneyDate(late), '2026-10-01');
  const src = source();
  const out = await cpi.fetchCpi({ fetch: src.fetch, now: late });
  assert.equal(src.calls.length, 1, 'no Data API call for an overdue page');
  const r = runWith(asPrevious(first), out, late);
  assert.equal(r.snapshot.facts.length, 1);
  const w = r.snapshot.watch[0];
  assert.equal(w.state, 'overdue');
  assert.equal(w.expectedBy, '2026-09-30');
  assert.match(w.detail, /listed Consumer Price Index, Australia, August 2026 for 2026-09-30; its page still shows July 2026/);
  assert.equal(r.changes[0].kind, 'watch');
  // On the release day itself it is not overdue yet.
  const sameDay = await cpi.fetchCpi({ fetch: source().fetch, now: '2026-09-30T00:15:00Z' });
  assert.equal(sameDay.observations.length, 1);
});

test('August replaces July as a new observation, and July stays as history (Phase G)', async () => {
  const first = runWith(null, await cpi.fetchCpi({ fetch: source().fetch, now: T1 }), T1);
  // What the page will look like on 30 September, if the figure were 3.3%.
  const aug = PAGE.replace(/July 2026/g, 'August 2026').replace('jul-2026/print', 'aug-2026/print').replace('rose 3.5%, down from 3.8% in the 12 months to June 2026', 'rose 3.3%, down from 3.5% in the 12 months to July 2026')
    .replace('Released</div><div class="field__item"> 26/08/2026', 'Released</div><div class="field__item"> 30/09/2026')
    .replace('Next Release 30/09/2026<br><span class="future-release">Consumer Price Index, Australia, August 2026', 'Next Release 28/10/2026<br><span class="future-release">Consumer Price Index, Australia, September 2026');
  const csv = CSV.replace('2026-07,3.5', '2026-08,3.3');
  const at = '2026-09-30T20:15:00Z';
  const r = runWith(asPrevious(first), await cpi.fetchCpi({ fetch: source({ page: aug, csv }).fetch, now: at }), at);
  assert.equal(r.release.sequence, 2);
  const byKey = {};
  r.snapshot.facts.forEach((f) => { byKey[f.observationKey] = f; });
  assert.equal(byKey['2026-07'].lifecycle, 'superseded');
  assert.equal(byKey['2026-08'].lifecycle, 'current');
  assert.equal(byKey['2026-08'].supersedes, 'abs_cpi_all_groups_annual_change@2026-07#r1');
  assert.equal(r.changes[0].summary, 'CPI, all groups, annual change (Australia): 3.5% → 3.3% (2026-07 → 2026-08)');
  assert.equal(r.snapshot.watch[0].expectedBy, '2026-10-28');
});

test('the registry entry carries the agreed bounds, freshness and cadence (D-E4)', async () => {
  assert.deepEqual(cpiSeries.bounds, { min: -3, max: 12, maxChange: 1.5 });
  assert.equal(cpiSeries.freshnessDays, 50);
  assert.ok(cpiSeries.cadenceHours < 24, 'a daily run must never be skipped as not due');
  assert.equal(cpiSeries.publisher, 'Australian Bureau of Statistics');
  // A tenfold misread (35 instead of 3.5), even one both sources agreed on, is held back.
  const out = await cpi.fetchCpi({ fetch: source({ page: PAGE.replace('rose 3.5%', 'rose 35%'), csv: CSV.replace(',3.5,', ',35,') }).fetch, now: T1 });
  const r = runWith(null, out, T1);
  assert.equal(r.snapshot.facts.length, 0);
  assert.equal(r.snapshot.watch[0].state, 'blocked');
  assert.match(r.snapshot.watch[0].detail, /35% \(2026-07\) is outside this series' plausibility bounds \(min -3, max 12, max change 1\.5\)/);
});
