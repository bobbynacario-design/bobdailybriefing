import {test} from 'node:test';
import assert from 'node:assert/strict';
import './lifestyle-core.js';
import './weekly-review-core.js';
const L=globalThis.LifestyleCore;
const W=globalThis.WeeklyReviewCore;
const plain=v=>JSON.parse(JSON.stringify(v));

test('stored answers are cleaned to known questions and options',()=>{
  assert.deepEqual(plain(L.cleanDays({'2026-10-15':{alcohol:'1-2',energy:'meh',x:'yes'},'bad':{alcohol:'0'},'2026-10-14':{energy:'zzz'}})),{'2026-10-15':{alcohol:'1-2'}});
});

test('one question a day, about yesterday, rotating; the next along if that one is answered',()=>{
  const a=L.pick({},'2026-10-16'),b=L.pick({},'2026-10-17');
  assert.equal(a.day,'2026-10-15');
  assert.notEqual(a.id,b.id,'a different question each day');
  const days={'2026-10-15':{[a.id]:a.options[0][0]}};
  const next=L.pick({days},'2026-10-16');
  assert.notEqual(next.id,a.id,'answered elsewhere already: the next one');
  assert.equal(L.pick({days,askedOn:'2026-10-16'},'2026-10-16'),null,'answered today: nothing more');
  assert.equal(L.pick({},'2026-10-16',true),null,'put off today');
  const all={};L.QUESTIONS.forEach(q=>{all[q.id]=q.options[0][0];});
  assert.equal(L.pick({days:{'2026-10-15':all}},'2026-10-16'),null);
  const seen=new Set();for(let i=0;i<5;i++)seen.add(L.pick({},'2026-10-'+(16+i)).id);
  assert.equal(seen.size,5,'all five come round in five days');
});

test('the week\'s tally becomes facts in the Sunday review',()=>{
  const days={'2026-10-12':{alcohol:'0',energy:'low'},'2026-10-13':{alcohol:'0'},'2026-10-14':{alcohol:'3+'},'2026-10-15':{alcohol:'0',outdoors:'yes'},'2026-10-19':{alcohol:'3+'}};
  const facts=L.weekFacts(days,'2026-10-12');
  assert.deepEqual(plain(facts.map(f=>f.text)),['Drinks: None on 3 days, 3 or more on 1','Daylight 20 min+: Yes on 1 day','Energy: Low on 1 day']);
  const back=W.lookback({lifestyleFacts:facts.map(f=>f.text)},'2026-10-12');
  assert.ok(back.facts.some(f=>f.source==='Check-in' && f.area==='health' && f.text==='Drinks: None on 3 days, 3 or more on 1'));
});
