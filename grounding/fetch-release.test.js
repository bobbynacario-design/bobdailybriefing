'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fetchRelease } = require('./fetch-release');
const { cutRelease } = require('./release');
const root = path.join(__dirname, 'fixtures/published-000001/grounding');
function reader(transform = (name, bytes) => bytes) {
  const seen = [];
  return { seen, fetch: async (url) => {
    const name = new URL(url).pathname.slice(1);
    seen.push(name);
    const bytes = transform(name, fs.readFileSync(path.join(root, name)));
    return { ok: true, arrayBuffer: async () => bytes };
  } };
}
test('network adapter validates a complete release and pins its pointer across cache retries', async () => {
  let fail = true, sleeps = 0;
  const mock = reader((name, bytes) => {
    if (name.endsWith('facts.json') && fail) { fail = false; return Buffer.from('not ready'); }
    return bytes;
  });
  const out = await fetchRelease({latestUrl:'https://example.org/latest.json',fetch:mock.fetch,sleep:async()=>{ sleeps++; }});
  assert.equal(out.release.ok,true);
  assert.equal(out.release.sequence,1);
  assert.equal(sleeps,1);
  assert.equal(mock.seen.filter(x=>x==='latest.json').length,1);
});
test('corrupt manifests never cause fact reads, and retries are bounded', async () => {
  let sleeps = 0;
  const mock = reader((name, bytes)=>name.endsWith('manifest.json') ? Buffer.from('{}') : bytes);
  await assert.rejects(fetchRelease({latestUrl:'https://example.org/latest.json',fetch:mock.fetch,sleep:async()=>{sleeps++;}}),/manifest digest/);
  assert.equal(sleeps,2);
  assert.equal(mock.seen.some(x=>x.endsWith('facts.json')),false);
});
// Serve a release cut in memory, as raw.githubusercontent.com would.
function server(files) {
  const seen = [];
  return { seen, fetch: async (url) => {
    const name = new URL(url).pathname.slice(1);
    seen.push(name);
    if (!(name in files)) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => Buffer.from(files[name], 'utf8') };
  } };
}
function cpiWithOverride() {
  const facts = JSON.parse(fs.readFileSync(path.join(root, 'releases/000001/facts.json'), 'utf8')).records
    .filter((r) => r.recordId !== 'fixture_cpi_annual_change_derived@2026-08#r1');
  const cpi = facts.find((r) => r.recordId === 'fixture_cpi_annual_change@2026-08#r1');
  cpi.value = 25; cpi.valueBindings[0].token = '25';
  cpi.evidence[0].quote = 'FIXTURE: The monthly CPI indicator rose 25% in the 12 months to August 2026.';
  cpi.evidence.splice(1, 1);
  cpi.plausibilityOverride = { reviewer: 'BN', at: '2026-10-01T05:00:00Z', reason: 'Checked against the release.', failedBound: { kind: 'absolute', limit: 15, observed: 25 } };
  return facts;
}
test('a release that cannot pass validation fails at once: the same bytes would fail again', async () => {
  let sleeps = 0;
  const facts = cpiWithOverride();
  facts[0].captureMethod = 'ai';
  const cut = cutRelease(1, { facts, watch: [], insights: [] }, { generatedAt: '2026-10-01T04:15:00Z', producerCommit: 'test' });
  const mock = server(cut.files);
  await assert.rejects(fetchRelease({ latestUrl: 'https://example.org/latest.json', fetch: mock.fetch, sleep: async () => { sleeps++; } }), /invalid release: .*captureMethod/);
  assert.equal(sleeps, 0);
  assert.equal(mock.seen.filter((x) => x.endsWith('manifest.json')).length, 1);
});
test('an override on a series this consumer has no bounds for does not refuse the release', async () => {
  const cut = cutRelease(1, { facts: cpiWithOverride(), watch: [], insights: [] }, { generatedAt: '2026-10-01T04:15:00Z', producerCommit: 'test' });
  let sleeps = 0;
  const out = await fetchRelease({ latestUrl: 'https://example.org/latest.json', fetch: server(cut.files).fetch, bounds: {}, sleep: async () => { sleeps++; } });
  assert.equal(out.release.ok, true, out.release.errors.join('; '));
  assert.equal(sleeps, 0);
  const cpi = out.release.facts.results.find((r) => r.recordId === 'fixture_cpi_annual_change@2026-08#r1');
  assert.equal(cpi.overrideVerdict, 'not_evaluated');
});
test('a file not yet in the raw-file cache is retried, then read', async () => {
  const cut = cutRelease(1, { facts: [], watch: [], insights: [] }, { generatedAt: '2026-10-01T04:15:00Z', producerCommit: 'test' });
  const files = Object.assign({}, cut.files);
  const late = 'releases/000001/watch.json', text = files[late];
  delete files[late];
  let sleeps = 0;
  const mock = server(files);
  const out = await fetchRelease({ latestUrl: 'https://example.org/latest.json', fetch: mock.fetch, sleep: async () => { sleeps++; files[late] = text; } });
  assert.equal(out.release.ok, true);
  assert.equal(sleeps, 1);
});
test('a pointer cannot fetch outside its numbered release', async () => {
  const mock=reader((name,bytes)=>name==='latest.json' ? Buffer.from(JSON.stringify({sequence:1,manifest:{path:'../secret',sha256:'a'.repeat(64)}})) : bytes);
  await assert.rejects(fetchRelease({latestUrl:'https://example.org/latest.json',fetch:mock.fetch}),/invalid latest/);
  assert.equal(mock.seen.length,1);
});
