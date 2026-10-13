import test from 'node:test';
import assert from 'node:assert/strict';
import './sports-trust-core.js';
const T=globalThis.SportsTrust;
test('only a known observation strictly before a known start qualifies',()=>{
  assert.equal(T.before('2026-10-13T10:00:00Z','2026-10-13T10:00:01Z'),true);
  for(const a of ['2026-10-13T10:00:00Z','2026-10-13T10:00:01Z','bad',null])assert.equal(T.before(a,'2026-10-13T10:00:00Z'),false);
  assert.equal(T.before('2026-10-13T10:00:00Z',null),false);
});
test('freshness distinguishes live, checked, retained, stale and unknown times',()=>{
  const now=Date.parse('2026-10-13T12:00:00Z');
  const m={generatedAt:'2026-10-13T11:50:00Z',staleAfterHours:12};
  assert.equal(T.freshness(m,now).live,true);
  assert.equal(T.freshness({...m,generatedAt:'2026-10-13T11:00:00Z'},now).current,true);
  assert.equal(T.freshness({...m,generatedAt:'2026-10-13T11:00:00Z'},now).live,false);
  for(const change of [{fallback:true},{refreshStatus:'error'},{generatedAt:'2026-10-12T00:00:00Z'},{generatedAt:'bad'},{generatedAt:'2026-10-14T00:00:00Z'}])assert.equal(T.freshness({...m,...change},now).current,false);
  assert.equal(T.freshness({},now).current,false);
});
test('legacy and current strong/moderate buckets render as leans',()=>{
  assert.equal(T.tag('Strong edge'),'Strong lean');assert.equal(T.decisive('Moderate lean'),true);assert.equal(T.decisive('Moderate edge'),true);assert.equal(T.decisive('Watch only'),false);
});
