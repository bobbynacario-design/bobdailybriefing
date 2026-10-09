import {test} from 'node:test';
import assert from 'node:assert/strict';
import './radar-assistant-core.js';
const {build} = globalThis.RadarAssistantCore;
const now = '2026-10-09T04:00:00Z';
const signal = (symbol, extras={}) => ({symbol,theme:'AI Semis',benchmark:'QQQ',status:'confirmed',score:85,
  close:100,stop:95,target:110,sma20:98,sma50:96,volRatio:1.5,relStrength20d:4,regimeScore:80,dataAsOf:'2026-10-08',...extras});
const doc = (signals,extras={}) => ({asOf:'2026-10-08',generatedAt:'2026-10-09T00:00:00Z',signals,...extras});
test('the assistant returns plans and changes only; picking names stays with Taker and Wildcard',()=>{
  const data=doc([signal('AMD'),signal('SOXX',{score:82})]);
  const original=JSON.stringify(data);
  const a=build(data,null,{now});
  assert.deepEqual(Object.keys(a).sort(),['changes','plans']);
  assert.deepEqual(Object.keys(a.plans).sort(),['AMD','SOXX']);
  assert.equal(JSON.stringify(data),original,'building the assistant never edits frozen data');
});
test('expired, future-dated and old-data snapshots mark plans stale; broken and reached plans say so',()=>{
  const a=build(doc([signal('OLD',{dataAsOf:'2026-09-20'}),signal('BROKEN',{close:94}),signal('TARGET',{close:111}),signal('BAD',{stop:null}),signal('OK')]),null,{now});
  assert.equal(a.plans.OLD.stale,true);assert.equal(a.plans.OK.stale,false);
  assert.match(a.plans.BROKEN.condition,/invalidated/); assert.match(a.plans.TARGET.condition,/reached/);
  assert.match(a.plans.BAD.condition,/Usable stop\/target levels are missing/);
  assert.equal(build(doc([signal('AMD')],{generatedAt:'2026-10-07T00:00:00Z'}),null,{now}).plans.AMD.stale,true,'36 hours after the run');
  assert.equal(build(doc([signal('AMD')],{generatedAt:'2026-10-10T00:00:00Z'}),null,{now}).plans.AMD.stale,true,'generated in the future');
  // Friday's run is stale by Saturday evening and through the weekend.
  const friday=doc([signal('AMD')],{generatedAt:'2026-10-09T01:32:00Z'});
  assert.equal(build(friday,null,{now:'2026-10-10T13:00:00Z'}).plans.AMD.stale,false);
  assert.equal(build(friday,null,{now:'2026-10-10T14:00:00Z'}).plans.AMD.stale,true);
});
test('changes compare the previous published stop rather than the moving current stop',()=>{
  const prior=doc([signal('AMD',{stop:101,close:105,dataAsOf:'2026-10-07',score:80,status:'confirmed',relStrength20d:6})],{asOf:'2026-10-07'});
  const a=build(doc([signal('AMD',{stop:95,close:100,score:70,status:'forming',relStrength20d:2})]),prior,{now});
  assert.equal(a.changes.status,'ok'); const item=a.changes.items[0];
  assert.equal(item.severity,4); assert.equal(item.material,true);
  assert.match(item.reasons.join(' '),/crossed the previous stop 101/);
  assert.match(item.reasons.join(' '),/confirmed → forming/);assert.match(item.reasons.join(' '),/80 → 70/);
  assert.match(item.reasons.join(' '),/6 → 2 percentage points/);
  assert.equal(item.basis,'price / technical');
});
test('small moves stay below the thresholds and are not material',()=>{
  const prior=doc([signal('AMD',{close:102,score:80,relStrength20d:6,dataAsOf:'2026-10-07'})],{asOf:'2026-10-07'});
  // -2% price, -7 score points, -2.5 lead points: all under the bars.
  assert.equal(build(doc([signal('AMD',{close:99.96,score:73,relStrength20d:3.5})]),prior,{now}).changes.items.length,0);
  const moved=build(doc([signal('AMD',{close:98,score:72,relStrength20d:3})]),prior,{now}).changes.items[0];
  assert.equal(moved.severity,1);assert.equal(moved.material,false);
  assert.match(moved.reasons.join(' '),/-3.9%/);assert.match(moved.reasons.join(' '),/80 → 72/);
});
test('news counts only when it is dated after the previous price date; unsafe or undated news is not invented',()=>{
  const prior=doc([signal('AMD',{dataAsOf:'2026-10-07',catalystUrl:'https://old.example/a',catalystAsOf:'2026-10-06'})],{asOf:'2026-10-07'});
  const fresh={catalyst:'New guidance',catalystUrl:'https://issuer.example/guidance',catalystAsOf:'2026-10-08'};
  const a=build(doc([signal('AMD',fresh)]),prior,{now});
  assert.equal(a.changes.items[0].basis,'news');assert.equal(a.changes.items[0].sourceDate,'2026-10-08');
  assert.equal(a.changes.items[0].material,false);
  for(const extra of [{catalystUrl:'javascript:alert(1)'},{catalystAsOf:'recent'},{catalystAsOf:'2026-09-01'},{catalystAsOf:'2026-10-12'},
    {catalystAsOf:'2026-10-07'},{catalystAsOf:'2026-10-06'},{catalystUrl:'https://old.example/a'}]) {
    assert.equal(build(doc([signal('AMD',{...fresh,...extra})]),prior,{now}).changes.items.length,0,JSON.stringify(extra));
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
test('watch plans label older snapshot dates and expiry without inventing upcoming events',()=>{
  const a=build(doc([signal('AMD',{dataAsOf:undefined,catalyst:'Old earnings',catalystAsOf:'2026-10-08',catalystUrl:'https://issuer.example',read:{why:'Demand supports the setup.',wouldBreak:'Guidance weakens.'}})]),null,{now});
  const p=a.plans.AMD;assert.equal(p.assetDateKnown,false); assert.equal(p.expiresAt,'2026-10-10T12:00:00.000Z');
  assert.match(p.condition,/If the next daily snapshot/);assert.match(p.condition,/1.2×/);
  assert.match(p.breaks,/at or below 95/);assert.equal(p.event,undefined);
  assert.equal(p.thesis,'Demand supports the setup.');assert.equal(p.evidence,'Guidance weakens.');
  const missing=build(doc([signal('AMD',{volRatio:1.02,sma20:94,sma50:96})]),null,{now}).plans.AMD.pendingChecks;
  assert.deepEqual(missing,['trend alignment','volume ≥1.2× normal']);
});
test('material snapshot price movement is visible without a status or score change',()=>{
  const prior=doc([signal('AMD',{close:104,dataAsOf:'2026-10-07'})],{asOf:'2026-10-07'});
  const a=build(doc([signal('AMD')]),prior,{now});
  assert.match(a.changes.items[0].reasons.join(' '),/Snapshot price 104 → 100 \(-3.8%\)/);
});
