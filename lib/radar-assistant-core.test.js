import {test} from 'node:test';
import assert from 'node:assert/strict';
import './radar-assistant-core.js';
const {build} = globalThis.RadarAssistantCore;
const now = '2026-10-09T04:00:00Z';
const signal = (symbol, extras={}) => ({symbol,theme:'AI Semis',benchmark:'QQQ',status:'confirmed',score:85,
  close:100,stop:95,target:110,sma20:98,sma50:96,volRatio:1.5,relStrength20d:4,regimeScore:80,dataAsOf:'2026-10-08',...extras});
const doc = (signals,extras={}) => ({asOf:'2026-10-08',generatedAt:'2026-10-09T00:00:00Z',signals,...extras});
test('priorities do not treat three chip exposures as independent ideas and explain exclusions',()=>{
  const data=doc([signal('AMD'),signal('SOXX',{score:82}),signal('SMH',{score:81}),signal('PWR',{theme:'Energy',score:80}),signal('GLD',{theme:'Metals',score:79})]);
  const original=JSON.stringify(data);
  const a=build(data,null,{now});
  assert.deepEqual(a.priorities.map(p=>p.symbol),['AMD','PWR','GLD']);
  assert.match(a.excluded.find(p=>p.symbol==='SOXX').reason,/Same exposure group as AMD/);
  assert.equal(JSON.stringify(data),original,'building the assistant never edits frozen data');
});
test('empty shortlist, missing metrics, expired evidence and invalid levels abstain honestly',()=>{
  const data=doc([signal('LOW',{score:69}),signal('WEAK',{regimeScore:40}),signal('OLD',{dataAsOf:'2026-09-20'}),
    signal('BROKEN',{close:94}),signal('TARGET',{close:111}),signal('UNKNOWN',{relStrength20d:null}),signal('BAD',{stop:null})]);
  const a=build(data,null,{now}); assert.equal(a.priorities.length,0); assert.equal(a.excluded.length,7);
  assert.match(a.plans.BROKEN.condition,/invalidated/); assert.match(a.plans.TARGET.condition,/reached/);
  assert.equal(build(doc([signal('AMD')],{generatedAt:'2026-10-07T00:00:00Z'}),null,{now}).priorities.length,0);
  assert.equal(build(doc([signal('AMD')],{generatedAt:'2026-10-10T00:00:00Z'}),null,{now}).priorities.length,0);
});
test('changes compare the previous published stop rather than the moving current stop',()=>{
  const prior=doc([signal('AMD',{stop:101,close:105,dataAsOf:'2026-10-07',score:80,status:'confirmed',relStrength20d:6})],{asOf:'2026-10-07'});
  const a=build(doc([signal('AMD',{stop:95,close:100,score:74,status:'forming',relStrength20d:2})]),prior,{now});
  assert.equal(a.changes.status,'ok'); const item=a.changes.items[0];
  assert.equal(item.severity,4); assert.match(item.reasons.join(' '),/crossed the previous stop 101/);
  assert.match(item.reasons.join(' '),/confirmed → forming/);assert.match(item.reasons.join(' '),/80 → 74/);
  assert.equal(item.basis,'price / technical');
});
test('new sourced news is reported separately and missing or unsafe news is not invented',()=>{
  const prior=doc([signal('AMD',{dataAsOf:'2026-10-07'})],{asOf:'2026-10-07'});
  const fresh={catalyst:'New guidance',catalystUrl:'https://issuer.example/guidance',catalystAsOf:'2026-10-08'};
  const a=build(doc([signal('AMD',fresh)]),prior,{now});
  assert.equal(a.changes.items[0].basis,'news');assert.equal(a.changes.items[0].sourceDate,'2026-10-08');
  for(const extra of [{catalystUrl:'javascript:alert(1)'},{catalystAsOf:'recent'},{catalystAsOf:'2026-09-01'},{catalystAsOf:'2026-10-12'}]) {
    assert.equal(build(doc([signal('AMD',{...fresh,...extra})]),prior,{now}).changes.items.length,0);
  }
});
test('same date reruns and missing history do not claim a new comparison; stale asset bars do not produce technical changes',()=>{
  const data=doc([signal('AMD',{score:95})]);
  assert.equal(build(data,doc([signal('AMD')]),{now}).changes.status,'unavailable');
  assert.equal(build(data,null,{now}).changes.status,'unavailable');
  assert.equal(build(data,undefined,{now}).changes.status,'unavailable');
  const prior=doc([signal('AMD',{dataAsOf:'2026-10-08',score:80})],{asOf:'2026-10-07'});
  assert.equal(build(data,prior,{now}).changes.items.length,0);
  assert.equal(build(data,{...prior,asOf:'2026-09-01'},{now}).changes.status,'unavailable');
});
test('watch plans label older snapshot dates, expiry and absent future events without reusing historical news dates',()=>{
  const a=build(doc([signal('AMD',{dataAsOf:undefined,catalyst:'Old earnings',catalystAsOf:'2026-10-08',catalystUrl:'https://issuer.example',read:{why:'Demand supports the setup.',wouldBreak:'Guidance weakens.'}})]),null,{now});
  const p=a.plans.AMD;assert.equal(p.assetDateKnown,false); assert.equal(p.expiresAt,'2026-10-10T12:00:00.000Z');
  assert.match(p.condition,/If the next daily snapshot/);assert.match(p.condition,/1.2×/);
  assert.match(p.breaks,/at or below 95/);assert.match(p.event,/No verified upcoming event/);
  assert.equal(p.thesis,'Demand supports the setup.');assert.equal(p.evidence,'Guidance weakens.');
  const missing=build(doc([signal('AMD',{volRatio:1.02,sma20:94,sma50:96})]),null,{now}).plans.AMD.pendingChecks;
  assert.deepEqual(missing,['trend alignment','volume ≥1.2× normal']);
});
test('material snapshot price movement is visible without a status or score change',()=>{
  const prior=doc([signal('AMD',{close:104,dataAsOf:'2026-10-07'})],{asOf:'2026-10-07'});
  const a=build(doc([signal('AMD')]),prior,{now});
  assert.match(a.changes.items[0].reasons.join(' '),/Snapshot price 104 → 100 \(-3.8%\)/);
});
