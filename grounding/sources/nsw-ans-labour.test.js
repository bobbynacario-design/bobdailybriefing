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
const nsw = require('./nsw-ans-labour');

const MANUAL_DIR = path.join(__dirname, '..', 'manual');
const AUSGRID_PAGE = fs.readFileSync(path.join(__dirname, 'fixtures/ausgrid-network-prices-2026-09-30.html'), 'utf8');
const ENDEAVOUR_PAGE = fs.readFileSync(path.join(__dirname, 'fixtures/endeavour-connection-costs-2026-09-30.html'), 'utf8');
const NOW = '2026-09-30T20:15:00Z';
const ENTRIES = nsw.registryEntries();
const byId = Object.fromEntries(ENTRIES.map((e) => [e.seriesId, e]));
const capture = (id) => JSON.parse(fs.readFileSync(path.join(MANUAL_DIR, id + '.json'), 'utf8'));
const ESS_BASE = nsw.NETWORKS.essential.fileBase;
const ESS_27 = ESS_BASE + '2026-27.pdf', ESS_28 = ESS_BASE + '2027-28.pdf';

// A response: a PDF with its headers, or an HTML page (Essential's answer to a
// name it does not have).
const pdf = (lastModified) => ({ ok: true, headers: new Map([['content-type', 'application/pdf'], ['last-modified', lastModified]]), arrayBuffer: async () => Buffer.from('') });
const html = (body) => ({ ok: true, headers: new Map([['content-type', 'text/html; charset=utf-8']]), arrayBuffer: async () => Buffer.from(body || '<html>Page not found</html>') });
function sources(over) {
  over = over || {};
  const calls = [];
  const fetch = async (url, init) => {
    calls.push([url, (init && init.method) || 'GET']);
    if (url in over) { const r = over[url]; if (r instanceof Error) throw r; return r; }
    if (url === nsw.NETWORKS.ausgrid.listingUrl) return html(AUSGRID_PAGE);
    if (url === nsw.NETWORKS.endeavour.listingUrl) return html(ENDEAVOUR_PAGE);
    if (url === ESS_27) return pdf('Tue, 28 Apr 2026 05:17:30 GMT');
    if (url === ESS_28) return html();
    throw new Error('unexpected URL ' + url);
  };
  return { fetch, calls };
}
const watch = (id, over, manualDir) => byId[id].fetch({ fetch: (over && over.fetch) || sources(over).fetch, now: NOW, manualDir: manualDir || MANUAL_DIR });
const tempManual = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-nsw-'));
  Object.entries(files || {}).forEach(([name, value]) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value)));
  return dir;
};

test('the captures carry each network\'s field worker rate, both years, excl GST, as the rendered tables show', () => {
  const values = Object.fromEntries(nsw.SERIES.map((s) => [s.seriesId, capture(s.seriesId).map((c) => [c.observationKey, c.value])]));
  assert.deepEqual(values, {
    ausgrid_quoted_labour_field_worker_ordinary: [['2025-07-01', 204.17], ['2026-07-01', 213.5]],
    endeavour_quoted_labour_field_worker_outdoor_ordinary: [['2025-07-01', 204.17], ['2026-07-01', 213.5]],
    endeavour_quoted_labour_field_worker_outdoor_after_hours: [['2025-07-01', 357.31], ['2026-07-01', 373.64]],
    essential_quoted_labour_field_worker_ordinary: [['2025-07-01', 203.67], ['2026-07-01', 212.98]],
    essential_quoted_labour_field_worker_overtime: [['2025-07-01', 278.69], ['2026-07-01', 291.43]],
  });
  for (const s of nsw.SERIES) {
    for (const c of capture(s.seriesId)) {
      assert.equal(c.kind, 'regulated_fee'); assert.equal(c.basisCode, 'regulated_fee_max'); assert.equal(c.unitCode, 'aud_per_hour');
      assert.equal(c.scope.jurisdiction, 'NSW'); assert.match(c.title, /excl GST\)$/); assert.match(c.scope.classification, /excl GST$/);
      assert.equal(c.effectiveTo, (Number(c.effectiveFrom.slice(0, 4)) + 1) + '-06-30');
      const ev = c.evidence[0];
      assert.equal(ev.publisher, nsw.NETWORKS[s.network].publisher); assert.match(ev.contentSha256, /^[0-9a-f]{64}$/);
      assert.match(ev.licence, /Quoted in part for citation only \(Copyright Act 1968\); no licence to reproduce is given\. Full document: https:/);
      assert.ok(ev.licence.length <= 300 && ev.title.length <= 240 && ev.quote.length < 400);
    }
  }
  // The GST basis is the source's own, in every record.
  assert.ok(capture('essential_quoted_labour_field_worker_ordinary').every((c) => c.qualifications.some((q) => q.text === '*All rates in the below tables are exclusive of GST')));
  assert.match(capture('ausgrid_quoted_labour_field_worker_ordinary')[1].evidence[0].quote, /Max Labour rate \(excl\. GST\) Max Labour rate \(incl\. GST\) \[…\] Field worker R4 213\.50 234\.85$/);
  // Ausgrid's after-hours rule is a qualification, never a derived figure.
  assert.ok(capture('ausgrid_quoted_labour_field_worker_ordinary').every((c) => c.qualifications.some((q) => /Ausgrid will charge 175% of the fee for that service\.$/.test(q.text))));
  assert.ok(!REGISTRY.some((s) => /^ausgrid_.*(after_hours|overtime)/.test(s.seriesId)));
  // Endeavour's FY26 file is gone from its site: the Archive's exact bytes.
  assert.match(capture('endeavour_quoted_labour_field_worker_outdoor_ordinary')[0].evidence[0].url, /^https:\/\/web\.archive\.org\/web\/20251106112318id_\/https:\/\/www\.endeavourenergy\.com\.au\//);
  assert.ok(!fs.readdirSync(path.join(MANUAL_DIR, 'sources')).some((f) => /ausgrid|endeavour|essential|ANS|Ancillary/i.test(f)), 'no price list is kept');
});

test('both years publish as current records, fact-verified and plausible, whatever order they arrive in', () => {
  const obs = nsw.SERIES.flatMap((s) => capture(s.seriesId));
  for (const order of [obs, obs.slice().reverse()]) {
    const r = produce({ previous: null, registry: ENTRIES, observations: order, now: NOW, producerCommit: 'test' });
    assert.deepEqual(r.skipped, []);
    assert.equal(r.snapshot.facts.length, 10);
    assert.ok(r.snapshot.facts.every((f) => f.lifecycle === 'current' && f.supersedes === null), JSON.stringify(r.snapshot.facts.map((f) => [f.recordId, f.lifecycle])));
    for (const res of r.validation.results) assert.deepEqual(res.checks, { sourceLinked: true, factVerified: true, crossChecked: false, plausible: true }, res.recordId);
  }
});

test('Ausgrid\'s page lists its fee schedules; Endeavour\'s links one price list', () => {
  const a = nsw.parseAusgrid(AUSGRID_PAGE);
  assert.deepEqual(a.map((e) => [e.edition, e.date, e.text]), [
    ['2026-27', '2026-04-27', 'Ausgrid 2026-27 Alternative Control Services Price List'],
    ['2025-26', '2025-07-01', 'Ausgrid Price List - Alternative control services fee schedule 2025-26']]);
  assert.equal(a[0].href, capture('ausgrid_quoted_labour_field_worker_ordinary')[1].evidence[0].url);
  assert.equal(nsw.parseAusgrid('<html>Page not found</html>'), null);
  const e = nsw.parseEndeavour(ENDEAVOUR_PAGE);
  assert.equal(e.edition, '2026-27'); assert.match(e.href, /ANS-Price-List-202627-v12---Final\.pdf$/);
  assert.equal(nsw.parseEndeavour(ENDEAVOUR_PAGE.replace('</body>', '<a href="https://example.org/other.pdf"><u>2026-27 Ancillary Network Services Price List</u></a></body>')), null, 'two price lists: which is it?');
  assert.equal(nsw.editionOf('2025-2026'), '2025-26'); assert.equal(nsw.editionOf('2025-28'), null);
});

test('Ausgrid\'s watch: this schedule says nothing; a new year, file or date turns it stale', async () => {
  const id = 'ausgrid_quoted_labour_field_worker_ordinary';
  assert.deepEqual(await watch(id), { observations: [] });
  const entry = (text, date, href) => '{"href":"' + href + '","text":"' + text + '","history-modify-date":"' + date + ' 2:00:00 PM"}';
  const withEntry = (e) => ({ [nsw.NETWORKS.ausgrid.listingUrl]: html(AUSGRID_PAGE.replace('[{', '[' + e + ',{')) });
  const year = await watch(id, withEntry(entry('Ausgrid 2027-28 Alternative Control Services Price List', '4/26/2027', 'https://example.org/2027-28')));
  assert.equal(year.status.state, 'stale');
  assert.match(year.status.detail, /^Ausgrid now lists "Ausgrid 2027-28 Alternative Control Services Price List" \(modified 2027-04-26\), which has not been captured\. Check the Field worker R4 rate and capture it in grounding\/manual\/ausgrid_quoted_labour_field_worker_ordinary\.json\.$/);
  const cur = nsw.parseAusgrid(AUSGRID_PAGE)[0];
  const file = await watch(id, { [nsw.NETWORKS.ausgrid.listingUrl]: html(AUSGRID_PAGE.replace(cur.href, cur.href.replace('v=5e213d9f', 'v=00000001'))) });
  assert.match(file.status.detail, /^Ausgrid has replaced its 2026-27 fee schedule: .* is a new file\./);
  const obj = [...AUSGRID_PAGE.matchAll(/\{[^{}]*"href":"[^"]+"[^{}]*\}/g)].map((m) => m[0]).find((o) => o.includes(cur.href));
  const date = await watch(id, { [nsw.NETWORKS.ausgrid.listingUrl]: html(AUSGRID_PAGE.replace(obj, obj.replace(/"history-modify-date":"[^"]+"/, '"history-modify-date":"8/3/2026 2:00:00 PM"'))) });
  assert.equal(date.status.state, 'stale');
  assert.match(date.status.detail, /^Ausgrid has revised its 2026-27 fee schedule: .*\(modified 2026-08-03\), after the capture of 2026-04-27\./);
  assert.equal((await watch(id, {}, tempManual())).status.state, 'awaiting_publication');
  assert.equal((await watch(id, { [nsw.NETWORKS.ausgrid.listingUrl]: html('<html>Maintenance</html>') })).status.state, 'blocked');
});

test('Endeavour\'s watch: one read for both series; a new version or year turns them stale', async () => {
  const src = sources();
  for (const id of ['endeavour_quoted_labour_field_worker_outdoor_ordinary', 'endeavour_quoted_labour_field_worker_outdoor_after_hours']) {
    assert.deepEqual(await byId[id].fetch({ fetch: src.fetch, now: NOW, manualDir: MANUAL_DIR }), { observations: [] });
  }
  assert.deepEqual(src.calls, [[nsw.NETWORKS.endeavour.listingUrl, 'GET']]);
  const v13 = await watch('endeavour_quoted_labour_field_worker_outdoor_after_hours', { [nsw.NETWORKS.endeavour.listingUrl]: html(ENDEAVOUR_PAGE.replace('ANS-Price-List-202627-v12---Final.pdf', 'ANS-Price-List-202627-v13---Final.pdf')) });
  assert.equal(v13.status.state, 'stale');
  assert.match(v13.status.detail, /^Endeavour Energy has issued a new version of its 2026-27 price list: ANS-Price-List-202627-v13---Final\.pdf\. Check the Field Worker R4 \(Outdoor\) after hours rate/);
  const next = await watch('endeavour_quoted_labour_field_worker_outdoor_ordinary', { [nsw.NETWORKS.endeavour.listingUrl]: html(ENDEAVOUR_PAGE.replace('<u>2026-27 Ancillary Network Services Price List</u>', '<u>2027-28 Ancillary Network Services Price List</u>')) });
  assert.match(next.status.detail, /^Endeavour Energy now lists its 2027-28 price list/);
  assert.equal((await watch('endeavour_quoted_labour_field_worker_outdoor_ordinary', { [nsw.NETWORKS.endeavour.listingUrl]: html('<html></html>') })).status.state, 'blocked');
});

test('Essential\'s watch: headers only, once for both series; a PDF under next year\'s name, or a later date, turns them stale', async () => {
  const src = sources();
  for (const id of ['essential_quoted_labour_field_worker_ordinary', 'essential_quoted_labour_field_worker_overtime']) {
    assert.deepEqual(await byId[id].fetch({ fetch: src.fetch, now: NOW, manualDir: MANUAL_DIR }), { observations: [] });
  }
  assert.deepEqual(src.calls, [[ESS_27, 'HEAD'], [ESS_28, 'HEAD']], 'the page behind Cloudflare is never requested');
  const next = await watch('essential_quoted_labour_field_worker_overtime', { [ESS_28]: pdf('Tue, 27 Apr 2027 05:00:00 GMT') });
  assert.equal(next.status.state, 'stale');
  assert.match(next.status.detail, /^Essential Energy has published its 2027-28 schedule \(AncillaryNetworkServicesPriceList2027-28\.pdf\)\. Check the Field Worker \(R4\) overtime rate/);
  const revised = await watch('essential_quoted_labour_field_worker_ordinary', { [ESS_27]: pdf('Mon, 03 Aug 2026 01:00:00 GMT') });
  assert.match(revised.status.detail, /^Essential Energy has revised its 2026-27 schedule: last modified 2026-08-03, after the capture of 2026-04-28\./);
  assert.equal((await watch('essential_quoted_labour_field_worker_ordinary', { [ESS_27]: html() })).status.state, 'blocked');
  const gone = Object.assign(new Error('HTTP 404'), { status: 404 });
  assert.deepEqual(await watch('essential_quoted_labour_field_worker_ordinary', { [ESS_28]: gone }), { observations: [] }, 'a 404 for next year is not news');
  await assert.rejects(watch('essential_quoted_labour_field_worker_ordinary', { [ESS_27]: Object.assign(new Error('HTTP 503'), { status: 503 }) }), /503/);
});

test('through the real publisher with every series, a ClaimBench-shaped plan imports exactly the ten NSW rates', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-h7b-'));
  const data = path.join(root, 'gdata'); fs.mkdirSync(data);
  const out = await run({ dataDir: data, manualDir: MANUAL_DIR, registry: REGISTRY, firestore: false, now: NOW, fetchImpl: sources().fetch });
  const ids = nsw.SERIES.flatMap((s) => ['2025-07-01', '2026-07-01'].map((k) => s.seriesId + '@' + k + '#r1'));
  const facts = out.result.snapshot.facts;
  ids.forEach((id) => assert.ok(facts.some((f) => f.recordId === id && f.lifecycle === 'current'), id + ' is published and current'));
  const mine = out.result.snapshot.watch.filter((w) => nsw.SERIES.some((s) => s.seriesId === w.seriesId));
  assert.equal(mine.length, 5);
  assert.ok(mine.every((w) => w.state === 'published'), JSON.stringify(mine.map((w) => [w.seriesId, w.state])));
  const rel = out.result.release, d = rel.dir, f = rel.files;
  const bounds = Object.fromEntries(REGISTRY.map((s) => [s.seriesId, s.bounds]));
  const release = V.validateRelease({ latestText: f['latest.json'], manifestText: f[d + '/manifest.json'],
    fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] }, directorySequence: rel.sequence }, { bounds });
  assert.equal(release.ok, true, release.errors.join('; '));
  const policy = { mappingVersion: 'test', refuseDerived: true, allow: {
    series: nsw.SERIES.map((s) => s.seriesId), publishers: ['Ausgrid', 'Endeavour Energy', 'Essential Energy'], units: ['aud_per_hour'], jurisdictions: ['NSW'] } };
  assert.deepEqual(V.planImport(null, release, policy, NOW).toImport.map((x) => x.recordId).sort(), ids.slice().sort());
});
