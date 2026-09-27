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
const vic = require('./vic-gazette-towing');
const cpi = require('./abs-cpi');
const fwo = require('./fwo-pay-guide');
const nsw = require('./nsw-tow-fees');

const MANUAL_DIR = path.join(__dirname, '..', 'manual');
const TOW = JSON.parse(fs.readFileSync(path.join(MANUAL_DIR, vic.TOW.seriesId + '.json'), 'utf8'));
const STORAGE = JSON.parse(fs.readFileSync(path.join(MANUAL_DIR, vic.STORAGE.seriesId + '.json'), 'utf8'));
const SEARCH = fs.readFileSync(path.join(__dirname, 'fixtures/vic-gazette-search-212H.html'), 'utf8');
const NOTICE = 'https://www.gazette.vic.gov.au/gazette/Gazettes2026/GG2026S257.pdf';
const NOW = '2026-09-28T20:15:00Z';
const TOW_ID = 'vic_atsa_accident_tow_base_fee@2026-07-01#r1';
const STORAGE_ID = 'vic_atsa_storage_motor_car_daily@2026-07-01#r1';
const bounds = Object.fromEntries(REGISTRY.map((s) => [s.seriesId, s.bounds]));

// Every source the registry reads, served from fixtures (no network).
function sources(opts) {
  opts = opts || {};
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const body = (b) => ({ ok: true, headers: new Map([['content-type', 'application/pdf'], ['content-disposition', 'attachment; filename=G00203138.pdf']]), arrayBuffer: async () => Buffer.from(b) });
    if (url === vic.SEARCH_URL) return body(opts.search !== undefined ? opts.search : SEARCH);
    if (url === fwo.DOWNLOAD_URL) return body(fs.readFileSync(path.join(MANUAL_DIR, 'sources/fwo-ma000020-pay-guide-effective-2026-07-01-G00203138.pdf')));
    if (url === nsw.PAGE_URL) return body(fs.readFileSync(path.join(__dirname, 'fixtures/nsw-tow-fees-2026-27.html')));
    if (url.startsWith(cpi.API_BASE)) return body(fs.readFileSync(path.join(__dirname, 'fixtures/abs-cpi-api-2026-07.csv')));
    if (url === cpi.LATEST_URL) return body(fs.readFileSync(path.join(__dirname, 'fixtures/abs-cpi-latest-2026-07.html')));
    throw new Error('unexpected URL ' + url);
  };
  return { fetch, calls };
}
function tempManual(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-vic-'));
  Object.entries(files || {}).forEach(([name, value]) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value)));
  return dir;
}

test('the captures carry S257\'s figures, dates and the notice, with no copy of it kept (D-H2)', () => {
  assert.equal(TOW.value, 289.60);
  assert.deepEqual(STORAGE.range, { min: 22.20, max: 32.80 });
  for (const c of [TOW, STORAGE]) {
    assert.equal(c.kind, 'regulated_fee'); assert.equal(c.basisCode, 'regulated_fee_max'); assert.equal(c.scope.jurisdiction, 'VIC');
    assert.equal(c.effectiveFrom, '2026-07-01'); assert.equal(c.effectiveTo, '2027-06-30'); assert.equal(c.publishedAt, '2026-05-22');
    assert.equal(c.evidence[0].url, NOTICE);
    assert.equal(c.evidence[0].publisher, 'Victoria Government Gazette (Secretary, Department of Transport and Planning)');
    assert.equal(c.evidence[0].contentSha256, 'a9468e364310e749269764d376286da48455ea99bbb665ad61ff75dce667bdc2');
    assert.match(c.evidence[0].licence, /subject to copyright .*quoted in part for citation only/);
    assert.ok(c.qualifications.some((q) => q.text === 'All varied charge amounts in this notice are inclusive of GST.'));
    assert.ok(c.evidence[0].quote.length < 400, 'a short quote, not the notice');
  }
  assert.ok(!fs.readdirSync(path.join(MANUAL_DIR, 'sources')).some((f) => /S257|gazette/i.test(f)), 'the gazette PDF is not kept');
});

test('both captures validate and publish, plausible under Daybook\'s bounds without an override', () => {
  const r = produce({ previous: null, registry: REGISTRY, observations: [TOW, STORAGE], now: NOW, producerCommit: 'test' });
  assert.deepEqual(r.skipped, []);
  for (const id of [TOW_ID, STORAGE_ID]) {
    const res = r.validation.results.find((x) => x.recordId === id);
    assert.deepEqual(res.checks, { sourceLinked: true, factVerified: true, crossChecked: false, plausible: true }, id);
  }
  assert.ok(r.changes.some((c) => c.summary === vic.TOW.title + ': $289.60 each (2026-07-01)'));
  assert.ok(r.changes.some((c) => c.summary === vic.STORAGE.title + ': $22.20–$32.80/day (2026-07-01)'));
});

test('the gazette search reads as the gazette wrote it, newest notice first', () => {
  const rows = vic.parseResults(SEARCH);
  assert.deepEqual(rows.map((r) => [r.number, r.date]), [['S257', '2026-05-22'], ['G26', '2025-06-26'], ['S318', '2025-06-20']]);
  assert.equal(rows[0].url, NOTICE);
  assert.equal(vic.parseResults('<html>No results</html>'), null);
});

test('the watch: this year\'s notice says nothing, a newer one turns the figures stale, none captured awaits', async () => {
  const src = sources();
  assert.deepEqual(await vic.watchTow({ fetch: src.fetch, now: NOW, manualDir: MANUAL_DIR }), { observations: [] });
  assert.equal(src.calls[0].init.method, 'POST');
  assert.equal(src.calls[0].init.body, 'q=212H');

  const newer = SEARCH.replace('<table>', '<table>\n<tr><td>S301</td><td>Special</td><td>28-May-2027</td><td><a target="_blank" href="/gazette/Gazettes2027/GG2027S301.pdf#page=1">Special Gazette Number S301 Dated 28 May 2027</a></td><td>1</td><td>3100</td></tr>');
  const stale = await vic.watchStorage({ fetch: sources({ search: newer }).fetch, now: NOW, manualDir: MANUAL_DIR });
  assert.equal(stale.status.state, 'stale');
  assert.match(stale.status.detail, /A newer section 212H notice is in the gazette: Special Gazette S301, 2027-05-28\. Check it and capture its figures in grounding\/manual\/vic_atsa_storage_motor_car_daily\.json\./);

  // The search may rank by relevance: a newer notice listed last still counts.
  const lower = SEARCH.replace('</table>', '<tr><td>S301</td><td>Special</td><td>28-May-2027</td><td><a target="_blank" href="/gazette/Gazettes2027/GG2027S301.pdf#page=1">Special Gazette Number S301 Dated 28 May 2027</a></td><td>1</td><td>12</td></tr></table>');
  assert.equal((await vic.watchTow({ fetch: sources({ search: lower }).fetch, now: NOW, manualDir: MANUAL_DIR })).status.state, 'stale');

  const none = await vic.watchTow({ fetch: sources().fetch, now: NOW, manualDir: tempManual() });
  assert.equal(none.status.state, 'awaiting_publication');
  assert.match(none.status.detail, /newest section 212H notice in the gazette is Special Gazette S257, 2026-05-22/);

  const broken = await vic.watchTow({ fetch: sources({ search: '<html>Search is unavailable</html>' }).fetch, now: NOW, manualDir: MANUAL_DIR });
  assert.equal(broken.status.state, 'blocked');
});

test('through the real publisher with every series, a ClaimBench-shaped plan imports exactly the four fee records', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-h-'));
  const data = path.join(root, 'gdata'); fs.mkdirSync(data);
  const out = await run({ dataDir: data, manualDir: MANUAL_DIR, registry: REGISTRY, firestore: false, now: NOW, fetchImpl: sources().fetch });
  const facts = out.result.snapshot.facts.map((f) => f.recordId).sort();
  assert.deepEqual(facts, ['abs_cpi_all_groups_annual_change@2026-07#r1', 'fwo_ma000020_cw2_ordinary@2026-07-01#r1',
    'nsw_tow_accident_towing_light@2026-07-01#r1', 'nsw_tow_storage_light_daily@2026-07-01#r1', TOW_ID, STORAGE_ID]);
  assert.ok(out.result.snapshot.watch.every((w) => w.state === 'published'), JSON.stringify(out.result.snapshot.watch.map((w) => [w.seriesId, w.state])));
  const rel = out.result.release, d = rel.dir, f = rel.files;
  const release = V.validateRelease({ latestText: f['latest.json'], manifestText: f[d + '/manifest.json'],
    fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] }, directorySequence: rel.sequence }, { bounds });
  assert.equal(release.ok, true, release.errors.join('; '));
  const policy = { mappingVersion: 'test', refuseDerived: true, allow: {
    series: ['nsw_tow_accident_towing_light', 'nsw_tow_storage_light_daily', vic.TOW.seriesId, vic.STORAGE.seriesId],
    publishers: ['NSW Fair Trading', vic.PUBLISHER], units: ['aud_per_item', 'aud_per_day'], jurisdictions: ['NSW', 'VIC'] } };
  const plan = V.planImport(null, release, policy, NOW);
  assert.deepEqual(plan.toImport.map((x) => x.recordId).sort(), ['nsw_tow_accident_towing_light@2026-07-01#r1', 'nsw_tow_storage_light_daily@2026-07-01#r1', TOW_ID, STORAGE_ID]);
  assert.deepEqual(plan.skips.map((s) => s.reason).sort(), ['series not allowlisted', 'series not allowlisted']);
});
