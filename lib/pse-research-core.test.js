import test from 'node:test';
import assert from 'node:assert/strict';
import './pse-research-core.js';
const C=globalThis.PseResearchCore;
const input={symbol:'BDO',approach:'quality',horizon:20,thesis:'Recurring earnings can support this valuation.',invalidation:'Credit costs rise and recurring earnings decline.',feePct:0.3,slippagePct:0.1};
const bars=Array.from({length:25},(_,i)=>({date:new Date(Date.UTC(2026,9,12+i)).toISOString().slice(0,10),close:100+i}));
test('paper draft requires a thesis, invalidation, explicit costs and covered universe',()=>{
  assert.equal(C.cleanPick(input).symbol,'BDO');
  for(const change of [{symbol:'OTHER'},{horizon:1},{approach:'buy'},{thesis:'yes'},{invalidation:''},{feePct:''},{slippagePct:-1},{lowMultiple:3,highMultiple:2}])assert.throws(()=>C.cleanPick({...input,...change}));
});
test('paper entry excludes known prices and completed horizon stays fixed',()=>{
  const pick={...input,recordedDay:'2026-10-13'};
  const o=C.evaluatePick(pick,bars,bars.map(b=>({...b,close:100})));
  assert.equal(o.entryDate,'2026-10-14');assert.equal(o.entryPrice,102);assert.equal(o.asOf,'2026-11-03');assert.equal(o.status,'completed');
  assert.equal(o.grossPriceReturn,19.61);assert.equal(o.netPriceReturn,18.65);assert.equal(o.benchmarkPriceReturn,0);
  assert.deepEqual(C.evaluatePick(pick,[...bars,{date:'2026-12-01',close:1}],bars.map(b=>({...b,close:100}))),o);
});
test('live marks are provisional, costs apply on both sides, and gaps never get a substituted benchmark',()=>{
  const pick={...input,recordedDay:'2026-10-13'};
  const o=C.evaluatePick(pick,bars.slice(0,7),[]);assert.equal(o.status,'tracking');assert.equal(o.netExcessReturn,null);assert.equal(o.sessions,null);
  assert.match(o.caveat,/excludes dividends/);assert.match(o.caveat,/Corporate actions are not verified/);
  assert.equal(C.evaluatePick(pick,bars.slice(0,2),[]).status,'waiting-entry');
  const falling=C.evaluatePick(pick,[{date:'2026-10-14',close:100},{date:'2026-10-15',close:90}],[]);
  assert.equal(falling.maxCloseDrawdown,-10);assert.equal(falling.netPriceReturn,-10.72);
});
test('holding horizon uses benchmark trading dates; missing stock closes delay an explicit exit',()=>{
  const pick={...input,recordedDay:'2026-10-13'};
  const missing=bars.filter(b=>!['2026-10-16','2026-11-03'].includes(b.date));
  const o=C.evaluatePick(pick,missing,bars);assert.equal(o.status,'completed');assert.equal(o.targetDate,'2026-11-03');assert.equal(o.asOf,'2026-11-04');assert.equal(o.sessions,21);
  assert.equal(C.evaluatePick(pick,missing.filter(b=>b.date<'2026-11-03'),bars).status,'awaiting-exit-quote');
});
test('missing recorded entry history does not invent a later entry',()=>{
  assert.equal(C.evaluatePick({...input,recordedDay:'2026-09-01'},bars,[]).status,'history-unavailable');
  assert.equal(C.evaluatePick({...input,recordedDay:'2026-10-13'},bars.slice(4),[],{entryDate:'2026-10-14'}).status,'history-unavailable');
});
