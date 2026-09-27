'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fetchRelease } = require('./fetch-release');
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
test('a pointer cannot fetch outside its numbered release', async () => {
  const mock=reader((name,bytes)=>name==='latest.json' ? Buffer.from(JSON.stringify({sequence:1,manifest:{path:'../secret',sha256:'a'.repeat(64)}})) : bytes);
  await assert.rejects(fetchRelease({latestUrl:'https://example.org/latest.json',fetch:mock.fetch}),/invalid latest/);
  assert.equal(mock.seen.length,1);
});
