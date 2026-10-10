import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import './weekly-review-core.js';
const W=globalThis.WeeklyReviewCore;
const plain=v=>JSON.parse(JSON.stringify(v));
const c=(id,text,extra={})=>({id,text,area:'work',measure:'',ticks:[],result:'',...extra});

test('weeks run Monday to Sunday and only valid commitments survive cleaning',()=>{
  assert.equal(W.weekStart('2026-10-10'),'2026-10-05');assert.equal(W.weekStart('2026-10-11'),'2026-10-05');assert.equal(W.weekStart('2026-10-12'),'2026-10-12');
  assert.equal(W.today('2026-10-11T16:30:00Z'),'2026-10-12','Philippine date');
  const w=W.cleanWeek({commitments:[c('c-aaaaaa','  Submit two reports  ',{area:'nope',ticks:['2026-10-06','2026-10-06','2026-10-13','bad'],result:'maybe'}),c('bad id','x'),c('c-bbbbbb',''),c('c-cccccc','Two'),c('c-dddddd','Three'),c('c-eeeeee','Four')]},'2026-10-07');
  assert.equal(w.start,'2026-10-05');assert.equal(w.end,'2026-10-11');
  assert.deepEqual(plain(w.commitments.map(x=>[x.text,x.area,x.ticks,x.result])),[['Submit two reports','life',['2026-10-06'],''],['Two','work',[],''],['Three','work',[],'']],'three at most, ticks inside the week only');
  const many={};for(let i=0;i<30;i++){const s=W.offset('2026-01-05',i*7);many[s]={commitments:[c('c-aaaaaa','x')]};}
  assert.equal(Object.keys(W.cleanWeeks(many)).length,26);
});
test('the review plan: Sunday reviews this week, Monday catches up on last week, mid-week is quiet',()=>{
  const set={commitments:[c('c-aaaaaa','Write')]};
  const weeks=W.cleanWeeks({'2026-10-05':set});
  assert.deepEqual(plain(W.plan(weeks,'2026-10-11')),{review:'2026-10-05',set:'2026-10-12',due:true});
  assert.deepEqual(plain(W.plan(weeks,'2026-10-12')),{review:'2026-10-05',set:'2026-10-12',due:true},'missed Sunday: review last week and set this one');
  const reviewed=W.cleanWeeks({'2026-10-05':{...set,reviewedAt:'x'},'2026-10-12':set});
  assert.deepEqual(plain(W.plan(reviewed,'2026-10-14')),{review:'',set:'',due:false});
  assert.deepEqual(plain(W.plan({},'2026-10-14')),{review:'',set:'2026-10-12',due:true},'nothing set: set this week');
  assert.deepEqual(plain(W.plan({},'2026-10-11')),{review:'',set:'2026-10-12',due:true},'a Sunday with nothing to review still sets next week');
  assert.deepEqual(plain(W.plan({},'2026-10-10')),{review:'',set:'2026-10-12',due:true},'nothing set by Saturday: plan the coming week');
  assert.deepEqual(plain(W.plan(W.cleanWeeks({'2026-10-05':set}),'2026-10-10')),{review:'',set:'',due:false},'set and Saturday: review comes tomorrow');
  const planned=W.cleanWeeks({'2026-10-12':set});
  assert.deepEqual(plain(W.plan(planned,'2026-10-11')),{review:'',set:'',due:false},'next week planned on Saturday: Sunday does not ask again');
  assert.deepEqual(plain(W.plan(planned,'2026-10-10')),{review:'',set:'',due:false});
  assert.deepEqual(plain(W.plan(W.cleanWeeks({'2026-10-05':{...set,reviewedAt:'x'}}),'2026-10-11')),{review:'',set:'2026-10-12',due:true},'reviewed early: Sunday only sets next week');
});
test('look back states what the records show and calls a thin week thin',()=>{
  const weeks=W.cleanWeeks({'2026-10-05':{commitments:[c('c-aaaaaa','Write daily',{ticks:['2026-10-06','2026-10-07'],result:'partly'})]}});
  const lb=W.lookback({weeks,usage:{'2026-10-06':{page_today:3},'2026-10-07':{fn_x:1},'2026-10-09':{page_radar:1}},
    calendarDays:[{title:'0175 - Annual Leave',start:'2026-10-09',end:'2026-10-09'},{title:'Christmas Day',start:'2026-12-25',end:'2026-12-25'}],
    decisions:[{asset:'BHP',reviewDate:'2026-10-08',verdict:'held'},{asset:'X',reviewDate:'2026-11-01'}],
    pokerStarred:[{day:'2026-10-07',name:'Wednesday Big Bounty'},{day:'2026-10-20',name:'Later'}]},'2026-10-08');
  assert.deepEqual(plain(lb.facts.map(f=>f.source+': '+f.text)),['Decisions: 1 decision review due · 1 with a verdict','Commitment: “Write daily” — ticked on 2 of 7 days · you marked it partly',
    'PokerHQ: Starred to play: Wednesday Big Bounty','Calendar: Leave this week: 0175 - Annual Leave','Daybook: Opened Daybook on 2 of 7 days'],'money, work, health, poker first');
  assert.equal(lb.thin,false);
  assert.equal(W.lookback({usage:{}},'2026-10-08').thin,true);
});
test('suggestions come from his records, carry over unfinished work and never repeat',()=>{
  const weeks=W.cleanWeeks({'2026-10-05':{commitments:[c('c-aaaaaa','Write daily',{result:'missed'}),c('c-bbbbbb','Gym',{result:'done'}),c('c-cccccc','Read',{ticks:['2026-10-05']})]}});
  const s=W.suggestions({weeks,pokerStarred:[{day:'2026-10-14',name:'Wednesday Big Bounty',venue:'Okada Manila',label:'Wed 14 Oct'}],
    windows:[{start:'2026-12-19',days:13,label:'Sat 19 Dec – Thu 31 Dec'},{start:'2026-10-24',days:3,label:'Sat 24 Oct – Mon 26 Oct'}],
    decisions:[{asset:'SMH',reviewDate:'2026-10-15'},{asset:'Done',reviewDate:'2026-10-15',verdict:'held'}],goals:[{text:'Get fitter',nextMove:'Book a gym induction'},{text:'Old',nextMove:'x',archived:true}],tryNext:'Write daily'},'2026-10-12');
  assert.deepEqual(plain(s.map(x=>x.area+': '+x.text)),['money: Review the SMH call and record a verdict','work: Write daily','work: Read','health: Walk 30 minutes on four days',
    'poker: Play Wednesday Big Bounty at Okada Manila','time: Decide and book what to do with Sat 24 Oct – Mon 26 Oct','life: Book a gym induction'],'focus order: money, work, health, poker');
  assert.match(s[1].why,/Carry over/);assert.match(s[3].why,/Starter idea · nothing in your records for health/);
});
test('money and work ideas come from open calls, calendar tasks and question deadlines, at most two per area',()=>{
  const s=W.suggestions({decisions:[{asset:'SMH',status:'open'},{asset:'SOXX',status:'open'},{asset:'ETH',status:'open',reviewDate:''},{asset:'Old',status:'closed'}],
    events:[{origin:'manual',kind:'task',title:'Suncorp v2 report',start:'2026-10-14'},{origin:'manual',kind:'task',title:'Done one',start:'2026-10-13',done:true},{origin:'manual',kind:'task',title:'Next month',start:'2026-11-20'}],
    evidenceSets:[{name:'Utility provider impact',question:{prompt:'p',deadline:'2026-10-16',status:'active'}},{name:'Closed',question:{deadline:'2026-10-16',status:'closed'}},{name:'Undated',question:{status:'active'}}]},'2026-10-12');
  assert.deepEqual(plain(s.map(x=>x.area+': '+x.text)),['money: Give your open calls (SMH, SOXX, ETH) a review date and one line on what would prove them wrong','work: Finish: Suncorp v2 report','work: Answer your working question: Utility provider impact',
    'health: Walk 30 minutes on four days']);
  assert.match(s[0].why,/3 open calls have no review date/);
  assert.equal(W.suggestions({},'2026-10-12').map(x=>x.area).join(','),'money,work,health','an empty record still offers one labelled starter per top area');
});

const core=readFileSync(new URL('./weekly-review-core.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('./weekly-review-ui.js',import.meta.url),'utf8');
function env(store,overrides={}) {
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,{id,hidden:false,innerHTML:'',textContent:'',value:''});return elements.get(id);};
  const rows=[],results=[];
  const document={getElementById:get,querySelectorAll:sel=>sel.includes('weekly-row')?rows:sel.includes('weekly-result')?results:[]};
  const fixedNow=Date.parse('2026-10-11T02:00:00Z');   // Sunday 11 Oct, Manila
  class FixedDate extends Date{constructor(...a){super(...(a.length?a:[fixedNow]));}static now(){return fixedNow;}}
  const context={Date:FixedDate,Intl,Math,JSON,console,Promise,Object,Array,String,Number,_firebaseUid:'owner',document,
    fbLoadReview:async()=>plain(store.weeks),fbUpdateReview:async fn=>{store.writes++;store.weeks=W.cleanWeeks(fn(plain(store.weeks)));return plain(store.weeks);},...overrides};
  context.window=context;vm.createContext(context);vm.runInContext(core,context);vm.runInContext(ui,context);
  return {context,get,rows,results};
}
const row=(id,area,text,measure)=>({getAttribute:()=>id,querySelector:s=>s.includes('area')?{value:area}:s.includes('measure')?{value:measure}:{value:text}});
test('the card ticks today on the latest copy and the Sunday review scores the week and sets the next',async()=>{
  const store={writes:0,weeks:{'2026-10-05':{start:'2026-10-05',commitments:[c('c-aaaaaa','Submit two reports <b>',{ticks:['2026-10-06']})]}}};
  const {context,get,rows,results}=env(store);
  await context.renderWeeklyCard(true);let card=get('weekly-card').innerHTML;
  assert.match(card,/This week/);assert.match(card,/Mon 5 Oct – Sun 11 Oct/);assert.match(card,/Submit two reports &lt;b&gt;/);
  assert.match(card,/Sunday: review this week and set next week’s three/);assert.match(card,/Start weekly review/);
  assert.equal((card.match(/weekly-dot is-on/g) || []).length,1);
  await context.weeklyTick('c-aaaaaa');assert.equal(store.writes,1);assert.deepEqual(store.weeks['2026-10-05'].commitments[0].ticks,['2026-10-06','2026-10-11']);
  assert.match(get('weekly-card').innerHTML,/✓ Done today/);
  await context.weeklyTick('c-aaaaaa');assert.deepEqual(store.weeks['2026-10-05'].commitments[0].ticks,['2026-10-06'],'a second tap undoes today');

  await context.openWeeklyReview();const review=get('weekly-review').innerHTML;
  assert.match(review,/1 · Looking back · Mon 5 Oct – Sun 11 Oct/);assert.match(review,/ticked on 1 of 7 days/);assert.match(review,/3 · Commitments for Mon 12 Oct – Sun 18 Oct/);
  assert.match(review,/＋ Submit two reports &lt;b&gt;/,'an unfinished commitment is offered to carry over');
  await context.saveWeeklyReview();assert.match(get('weekly-status').textContent,/Mark each commitment/);assert.equal(store.writes,2,'nothing saved until each is marked');
  results.push({getAttribute:()=>'c-aaaaaa',querySelector:()=>({value:'partly'})});
  get('weekly-reflection').value='Too many site visits';
  rows.push(row('','work','Submit two reports',''),row('','health','Walk 30 minutes','4 days'),row('','money',' ',''));
  await context.saveWeeklyReview();
  assert.equal(store.writes,3);
  const last=store.weeks['2026-10-05'];assert.equal(last.commitments[0].result,'partly');assert.equal(last.reflection,'Too many site visits');assert.ok(last.reviewedAt);
  assert.deepEqual(plain(store.weeks['2026-10-12'].commitments.map(x=>[x.area,x.text,x.measure])),[['work','Submit two reports',''],['health','Walk 30 minutes','4 days']]);
  assert.equal(get('weekly-review').hidden,true);assert.match(get('weekly-status').textContent,/Week reviewed and next week set/);
});
test('a failed load pauses changes rather than overwriting the saved week',async()=>{
  const store={writes:0,weeks:{}};
  const {context,get}=env(store,{fbLoadReview:async()=>{throw Error('offline');}});
  await context.renderWeeklyCard(true);
  assert.match(get('weekly-card').innerHTML,/disabled/);assert.match(get('weekly-status').textContent,/changes are paused/);
  await context.weeklyTick('c-aaaaaa');await context.saveWeeklyReview();assert.equal(store.writes,0);
  context._firebaseUid='';await context.renderWeeklyCard(true);assert.equal(get('weekly-card').hidden,true);
});
