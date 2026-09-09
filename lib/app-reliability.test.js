import {test} from 'node:test';
import assert from 'node:assert/strict';
import './app-reliability.js';
const api = globalThis.AppReliability;
test('private cache requires an account and separates account keys', () => {
  assert.equal(api.cacheKey(''), null);
  assert.notEqual(api.cacheKey('alice'), api.cacheKey('bob'));
});
test('ticker separates the numeric value from provenance without losing text', () => {
  assert.deepEqual(api.metric('62.625 (Tuesday close, source)'), {value:'62.625',detail:'(Tuesday close, source)'});
  assert.equal(api.metric('6,105.99').value, '6,105.99');
});
test('late high relevance stories rank above early medium ones', () => {
  assert.deepEqual(api.rankedStories([{score:'med',headline:'A'},{score:'high',headline:'Z'}]).map(x => x.headline), ['Z','A']);
});
test('source failures and timeouts are distinguishable from empty results', async () => {
  assert.deepEqual(await api.readSource(() => [], []), {ok:true,value:[]});
  assert.equal((await api.readSource(() => { throw Error('Denied'); }, [])).ok, false);
  assert.equal((await api.readSource(() => new Promise(() => {}), [], 5)).error, 'Timed out');
});
test('evidence merges independent device edits and rejects competing note edits', () => {
  const base = {version:1,sets:[{id:'set',name:'Evidence',items:[{key:'a',note:''},{key:'b',note:''}]}]};
  const local = structuredClone(base), remote = structuredClone(base);
  local.sets[0].items[0].note = 'local'; remote.sets[0].items[1].note = 'remote';
  assert.deepEqual(api.mergeEvidence(base,local,remote).sets[0].items.map(i => i.note), ['local','remote']);
  remote.sets[0].items[0].note = 'conflict';
  assert.throws(() => api.mergeEvidence(base,local,remote), /another device/);
});
