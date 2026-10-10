import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateHistory,historyKey,HISTORY_DAYS} from './history.js';
const now='2026-10-10T12:00:00Z';
const fare=(amount,extra={})=>({kind:'advertised-fare',origin:'MNL',destination:'NRT',tripType:'round-trip',cabin:'Economy',currency:'USD',amount,checkedAt:now,...extra});
test('keeps one daily low per route across airlines and sample dates',()=>{
  const h=updateHistory(null,[fare(400),fare(341,{airline:'Cathay Pacific'}),fare(900,{cabin:'Business'}),fare(10,{kind:'promo'})],'2026-10-10',now);
  const routes=Object.values(h.routes);assert.equal(routes.length,2);
  assert.deepEqual(routes.find(r=>r.key===historyKey(fare(1))).days,{'2026-10-10':341});
  assert.equal(h.firstDay,'2026-10-10');assert.equal(h.keepDays,HISTORY_DAYS);
});
test('merges a second scout on the same day, carries earlier days and prunes the window',()=>{
  const first=updateHistory(null,[fare(341)],'2026-10-10',now);
  const old=Object.fromEntries(Object.entries(first.routes).map(([id,r])=>[id,{...r,days:{...r.days,'2026-07-01':200,'2026-10-09':355}}]));
  const later='2026-10-10T23:00:00Z';
  const h=updateHistory({routes:old},[fare(360,{checkedAt:later}),fare(1,{checkedAt:'2026-10-09T00:00:00Z'})],'2026-10-10',later);
  assert.deepEqual(Object.values(h.routes)[0].days,{'2026-10-09':355,'2026-10-10':341},'the earlier low stands, a retained quote is ignored, July is pruned');
  assert.equal(h.firstDay,'2026-10-09');
  const next=updateHistory(h,[fare(330,{checkedAt:'2026-10-11T00:00:00Z'})],'2026-10-11','2026-10-11T00:00:00Z');
  assert.equal(Object.values(next.routes)[0].days['2026-10-11'],330);
});
