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
  assert.deepEqual(plain(b),{birthYear:1981,include:'all',last:{dental:'2025-03'},next:{},off:{flu:true}});
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
  assert.ok(ids(K.plan({birthYear:1961},T)).includes('pneumo'),'pneumococcal from 65 (Codex review: the program moved from 70)');
  assert.ok(!ids(K.plan({birthYear:1961},T)).includes('shingles2'),'dose 2 only after dose 1 is recorded');
  assert.deepEqual(ids(K.plan({},T)).sort(),['bp','dental','eyes','flu'],'no birth year: only checks for every adult');
  assert.ok(!ids(K.plan({birthYear:1981,off:{eyes:true}},T)).includes('eyes'));
});

test('status from the last-done month: overdue, due, soon, ok, unknown, done',()=>{
  const items=K.plan({birthYear:1955,include:'male',last:{dental:'2025-08',flu:'2025-10',eyes:'2024-12',bp:'2025-01',shingles:'2024-05',shingles2:'2024-08',pneumo:'2023-04'}},T);
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
  assert.match(K.calendarEntries(items,T)[0].detail,/^Last done Aug 2025 · every year · Australian Dental Association \(https:\/\/www\.teeth\.org\.au\/\)\. A general schedule/);
  assert.deepEqual(plain(K.todayLine(items).items.map(i=>i.id)),['dental','flu']);
  assert.equal(K.todayLine(K.plan({birthYear:1981},T)),null,'nothing recorded, nothing due');
  assert.deepEqual(plain(K.idea(items)),{area:'health',text:'Book your dental check',why:'Last done Aug 2025 · every year (Australian Dental Association)'});
  const after=K.markDone(raw,'dental',T);
  assert.equal(after.last.dental,'2026-10');
  assert.equal(K.plan(after,T).find(i=>i.id==='dental').status,'ok');
});

test('shingles is two doses: the second due 2 months after the first, overdue after 6',()=>{
  const by=(b,d)=>Object.fromEntries(K.plan(b,d).map(i=>[i.id,i]));
  const b={birthYear:1960,last:{shingles:'2026-07'}};
  assert.equal(by(b,T).shingles.status,'done');
  assert.equal(by(b,T).shingles2.due,'2026-09-01');
  assert.equal(by(b,T).shingles2.status,'due');
  assert.equal(by(b,'2027-01-15').shingles2.status,'overdue');
  assert.equal(by({birthYear:1960,last:{shingles:'2026-07',shingles2:'2026-10'}},T).shingles2.status,'done');
  assert.equal(K.lastText(by(b,T).shingles2),'Dose 1 Jul 2026');
  assert.match(K.calendarEntries(K.plan(b,T),T).find(e=>e.id==='checkup-shingles2').detail,/^Dose 1 Jul 2026 · 2 to 6 months after dose 1 ·/);
});

test('a doctor\'s next-due month replaces the schedule until it is marked done',()=>{
  const raw={birthYear:1981,last:{bp:'2026-01'},next:{bp:'2026-11',dental:'2027-03',bogus:'2026-11'}};
  assert.deepEqual(plain(K.cleanBasics(raw,T).next),{bp:'2026-11',dental:'2027-03'});
  const bp=K.plan(raw,T).find(i=>i.id==='bp');
  assert.equal(bp.due,'2026-11-01');assert.equal(bp.byDoctor,true);assert.equal(bp.status,'soon');
  assert.equal(K.plan(raw,T).find(i=>i.id==='dental').status,'ok','a date with no last-done month still counts');
  const done=K.markDone(raw,'bp',T);
  assert.equal(done.next.bp,undefined);
  assert.equal(K.plan(done,T).find(i=>i.id==='bp').due,'2028-10-01','back on the schedule');
  assert.ok(K.CHECKS.every(c=>/^https:\/\//.test(c.url)),'every check links its source');
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
