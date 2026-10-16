import {test} from 'node:test';
import assert from 'node:assert/strict';
import './checkup-core.js';
import './weekly-review-core.js';
import './daybook-calendar-core.js';
const K=globalThis.CheckupCore;
const W=globalThis.WeeklyReviewCore;
const plain=v=>JSON.parse(JSON.stringify(v));
const T='2026-10-16';
const ids=items=>items.map(i=>i.id);

test('the stored box is cleaned: a real birth year, known checks, past months only',()=>{
  const b=K.cleanBasics({birthYear:'1981',include:'nope',last:{dental:'2025-03',flu:'2026-11',eyes:'2026-13',bogus:'2025-01'},off:{flu:true,x:true,dental:'yes'}},T);
  assert.deepEqual(plain(b),{birthYear:1981,include:'all',last:{dental:'2025-03'},off:{flu:true}});
  assert.equal(K.cleanBasics({birthYear:2015},T).birthYear,null,'under 16 is not him');
});

test('which checks apply: age (the year he turns it), screening set, turned off',()=>{
  const male45={birthYear:1981,include:'male'};
  assert.deepEqual(ids(K.plan(male45,T)).sort(),['bowel','bp','dental','diabetes','eyes','flu','heart']);
  assert.ok(!ids(K.plan({birthYear:1987,include:'male'},T)).includes('bowel'),'39 has no bowel screening yet');
  assert.ok(ids(K.plan({birthYear:1981,include:'female'},T)).includes('cervical'));
  assert.ok(ids(K.plan({birthYear:1970,include:'all'},T)).includes('cervical'),'all includes both sets');
  assert.ok(!ids(K.plan({birthYear:1951},T)).includes('bowel'),'75 is past the bowel program');
  assert.ok(ids(K.plan({birthYear:1951},T)).includes('shingles'));
  assert.deepEqual(ids(K.plan({},T)).sort(),['bp','dental','eyes','flu'],'no birth year: only checks for every adult');
  assert.ok(!ids(K.plan({birthYear:1981,off:{eyes:true}},T)).includes('eyes'));
});

test('status from the last-done month: overdue, due, soon, ok, unknown, done',()=>{
  const items=K.plan({birthYear:1955,include:'male',last:{dental:'2025-08',flu:'2025-10',eyes:'2024-12',bp:'2025-01',shingles:'2024-05'}},T);
  const by=Object.fromEntries(items.map(i=>[i.id,i]));
  assert.equal(by.dental.status,'overdue');assert.equal(by.dental.due,'2026-08-01');
  assert.equal(by.flu.status,'due');assert.equal(by.flu.due,'2026-10-01');
  assert.equal(by.eyes.status,'soon');assert.equal(by.eyes.due,'2026-12-01');
  assert.equal(by.bp.status,'ok');assert.equal(by.bp.due,'2027-01-01');
  assert.equal(by.heart.status,'unknown');
  assert.equal(by.shingles.status,'done');
  assert.deepEqual(ids(items).slice(0,4),['dental','flu','eyes','bp'],'soonest first');
});

test('Done today sets this month; Calendar, Today and the review idea read the plan',()=>{
  const raw={birthYear:1981,include:'male',last:{dental:'2025-08',flu:'2025-10',eyes:'2024-12',bp:'2025-01'},off:{}};
  const items=K.plan(raw,T);
  assert.deepEqual(plain(K.calendarEntries(items,T).map(e=>[e.id,e.start,e.title])),[
    ['checkup-dental','2026-10-16','Check-up due: Dental check'],['checkup-flu','2026-10-16','Check-up due: Flu vaccine'],
    ['checkup-eyes','2026-12-01','Check-up: Eye test'],['checkup-bp','2027-01-01','Check-up: Blood pressure check']]);
  assert.match(K.calendarEntries(items,T)[0].detail,/^Last done Aug 2025 · every year · General dental advice\. A general schedule/);
  assert.deepEqual(plain(K.todayLine(items).items.map(i=>i.id)),['dental','flu']);
  assert.equal(K.todayLine(K.plan({birthYear:1981},T)),null,'nothing recorded, nothing due');
  assert.deepEqual(plain(K.idea(items)),{area:'health',text:'Book your dental check',why:'Last done Aug 2025 · every year (General dental advice)'});
  const after=K.markDone(raw,'dental',T);
  assert.equal(after.last.dental,'2026-10');
  assert.equal(K.plan(after,T).find(i=>i.id==='dental').status,'ok');
});

test('Calendar shows the entries as tasks from Health basics',()=>{
  const ev=globalThis.DaybookCalendarCore.build({checkups:K.calendarEntries(K.plan({birthYear:1981,last:{dental:'2025-08'}},T),T)});
  assert.deepEqual(plain(ev.map(e=>[e.id,e.kind,e.start,e.source,e.page])),[['checkup-dental','task','2026-10-16','Health basics','about']]);
});

test('a due check-up becomes the weekly review\'s health idea, in place of the starter',()=>{
  const ideas=W.suggestions({weeks:{},checkupIdea:K.idea(K.plan({birthYear:1981,last:{dental:'2025-08'}},T))},'2026-10-19');
  const health=ideas.filter(s=>s.area==='health');
  assert.deepEqual(plain(health.map(s=>s.text)),['Book your dental check']);
  assert.ok(W.suggestions({weeks:{}},'2026-10-19').some(s=>s.text==='Walk 8,000 steps on four days'),'no check-up due: the starter stays');
  const tried=W.suggestions({weeks:{},researchTry:{text:'Walk 3 minutes after lunch',why:'From this week\'s health research: Walking breaks'}},'2026-10-19');
  assert.deepEqual(plain(tried.filter(s=>s.area==='health').map(s=>s.text)),['Walk 3 minutes after lunch'],'a research try is the health idea too');
});
