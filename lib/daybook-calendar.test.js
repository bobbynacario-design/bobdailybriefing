import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const core=readFileSync(new URL('./daybook-calendar-core.js',import.meta.url),'utf8');
const flights=readFileSync(new URL('./flights-core.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('./daybook-calendar-ui.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const raw={id:'event-12345678',title:'File review',start:'2026-10-10',kind:'task'};
function env(overrides={}) {
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,hidden:false,innerHTML:'',textContent:'',disabled:false,setAttribute(){},focus(){}});return elements.get(id);};
  const context={Date,Intl,URL,TextEncoder,console,_firebaseUid:'owner',crypto:{randomUUID:()=> 'event-12345678'},document:{getElementById:get,querySelector:()=>null},fbLoadDaybookEvents:async()=>[],fbLoadMeetings:async()=>null,fbLoadDecisions:async()=>[],fbLoadCommandPrefs:async()=>null,fbLoadFlightPrefs:async()=>({}),fbLoadFlights:async()=>null,...overrides};
  context.window=context;vm.createContext(context);vm.runInContext(flights,context);vm.runInContext(core,context);vm.runInContext(ui,context);
  return {context,get,C:context.DaybookCalendarCore};
}
test('dates, timed event validation, PHT boundaries and month grids are deterministic',()=>{
  const {C}=env();
  assert.equal(C.date('2026-02-30'),'');assert.equal(C.date('2028-02-29'),'2028-02-29');
  assert.equal(C.pht('2026-10-09T16:30:00Z').day,'2026-10-10');
  assert.equal(C.pht('2026-10-09T16:30:00Z').time,'00:30');
  assert.ok(C.manual({...raw,time:'24:00'}).error);
  assert.ok(C.manual({...raw,time:'09:00',end:'2026-10-11'}).error);
  assert.ok(C.manual({...raw,end:'2026-10-01'}).error);
  assert.ok(C.manual({...raw,title:''}).error);
  assert.equal(C.grid('2026-10').length,42);assert.equal(C.grid('2026-13').length,0);
  assert.equal(C.grid('2026-10')[0].day,'2026-09-27');
});
test('combines actual dated sources and never turns campaign travel windows into booked trips',()=>{
  const {C}=env(),fare={id:'a'.repeat(20),kind:'advertised-fare',origin:'MNL',destination:'MPH',departureDate:'2026-10-10',returnDate:'2026-10-13',bookingUrl:'https://flights.philippineairlines.com/',airline:'PAL'};
  const campaign={id:'b'.repeat(20),campaign:true,bookingEnd:'2026-10-11',travelStart:'2027-02-01',travelEnd:'2027-06-30',bookingUrl:'https://www.cebupacificair.com/',airline:'Cebu Pacific'};
  const events=C.build({manual:[raw],saved:{a:fare,b:campaign,bad:{...fare,bookingUrl:'javascript:alert(1)'}},flights:{offers:[campaign]},meetings:{items:[{id:'m',title:'QBE review',start:'2026-10-09T16:30:00Z',end:'2026-10-09T17:30:00Z'}]},decisions:[{id:'d',asset:'AMD',reviewDate:'2026-10-12'},{id:'closed',status:'closed',reviewDate:'2026-10-12'},{id:'done',verdict:'reviewed',reviewDate:'2026-10-12'}],evidence:{sets:[{id:'q',name:'Evidence',question:{deadline:'2026-10-14',status:'active'}},{id:'closed',question:{deadline:'2026-10-14',status:'closed'}}]}});
  assert.equal(events.length,6);assert.equal(events.filter(e=>e.kind==='sale').length,1);
  const trip=events.find(e=>e.kind==='travel');assert.equal(trip.tentative,true);assert.match(trip.detail,/not a booked ticket/);
  assert.equal(C.onDay(events,'2026-10-13').some(e=>e.kind==='travel'),true);
  assert.equal(C.onDay(events,'2027-02-01').length,0);
  assert.equal(C.conflicts(events).length,1);
});
test('exclusive meeting midnight ends do not spill into the following day',()=>{
  const {C}=env();const e=C.build({meetings:{items:[{id:'m',title:'Late meeting',start:'2026-10-10T15:00:00Z',end:'2026-10-10T16:00:00Z'}]}})[0];
  assert.equal(e.start,'2026-10-10');assert.equal(e.end,'2026-10-10');
});
test('ICS exports inclusive trip dates with exclusive ends, preserves UTC and escapes injection',()=>{
  const {C}=env();
  const out=C.ics([{id:'trip',title:'Trip, plan; tentative',start:'2026-10-10',end:'2026-10-13',tentative:true,source:'Saved flight',detail:'Not booked\nBEGIN:BAD'},{id:'meeting',title:'Review',start:'2026-10-10',end:'2026-10-10',utcStart:'2026-10-09T16:30:00Z',utcEnd:'2026-10-09T17:30:00Z',source:'Meeting'},{id:'manual',title:'Personal time',start:'2026-10-10',end:'2026-10-10',time:'00:30',source:'Your event'}],'2026-10-10T00:00:00Z');
  assert.match(out,/DTEND;VALUE=DATE:20261014/);assert.match(out,/DTSTART:20261009T163000Z/);
  assert.match(out,/STATUS:TENTATIVE/);assert.match(out,/SUMMARY:Trip\\, plan\\; tentative/);
  assert.doesNotMatch(out,/\r\nBEGIN:BAD/);assert.match(out,/Not booked\\nBEGIN:BAD/);
  const unicode=C.ics([{id:'u',title:'✈'.repeat(100),start:'2026-10-10',end:'2026-10-10',source:'Test'}]);
  for(const line of unicode.split('\r\n'))assert.ok(new TextEncoder().encode(line).length<=75);
});
test('calendar UI escapes content, exposes selected-day details and lists multi-day continuations',async()=>{
  const {context,get}=env({fbLoadDaybookEvents:async()=>[{...raw,title:'Task <img onerror=alert(1)>',notes:'Notes <script>',end:'2026-10-11'}]});
  await context.renderDaybookCalendar();context.daycalSelect('2026-10-11');
  assert.equal((get('daycal-grid').innerHTML.match(/class="daycal-day/g) || []).length,42);
  assert.match(get('daycal-agenda').innerHTML,/&lt;img/);assert.match(get('daycal-agenda').innerHTML,/Notes &lt;script&gt;/);
  assert.doesNotMatch(get('daycal-grid').innerHTML,/<img/);
  context.daycalView('list');assert.equal(get('daycal-month-view').hidden,true);
  assert.match(get('daycal-grid').innerHTML,/↳ Task/);
});
test('failed personal data read disables saving without blocking other calendar sources',async()=>{
  let writes=0;const {context,get}=env({fbLoadDaybookEvents:async()=>{throw Error('offline');},fbWriteDaybookEvent:async()=>{writes++;},fbLoadDecisions:async()=>[{id:'d',reviewDate:'2026-10-10',asset:'AMD'}]});
  await context.renderDaybookCalendar();context.daycalSelect('2026-10-10');
  assert.equal(get('daycal-add').disabled,true);assert.match(get('daycal-status').textContent,/editing is disabled/);
  assert.match(get('daycal-agenda').innerHTML,/Review: AMD/);await context.daycalDelete(0);assert.equal(writes,0);
});
test('account switches discard pending private calendar reads',async()=>{
  let resolve;const {context,get}=env({fbLoadDaybookEvents:()=>new Promise(r=>{resolve=r;})});
  const pending=context.renderDaybookCalendar();await Promise.resolve();await Promise.resolve();
  context.resetDaybookCalendar();context._firebaseUid='other';resolve([raw]);await pending;
  assert.equal(get('daycal-agenda').innerHTML,'');assert.equal(get('daycal-grid').innerHTML,'');
});
test('manual editor saves, completes and deletes only owned events',async()=>{
  let items=[],writes=0;const {context,get}=env({fbLoadDaybookEvents:async()=>items,fbWriteDaybookEvent:async(r,remove)=>{writes++;items=items.filter(x=>x.id!==r.id);if(!remove)items.push({...r,updatedAt:'2026-10-10T00:00:00Z'});return items;}});
  await context.renderDaybookCalendar();context.daycalSelect('2026-10-10');context.daycalNew();
  get('daycal-title').value='Review file';get('daycal-kind').value='task';await context.daycalSave();
  assert.equal(writes,1);assert.match(get('daycal-agenda').innerHTML,/Review file/);
  await context.daycalComplete(0);assert.equal(writes,2);assert.doesNotMatch(get('daycal-agenda').innerHTML,/Review file/);
  get('daycal-done').checked=true;context.paintDaybookCalendar();await context.daycalDelete(0);assert.equal(writes,3);assert.equal(items.length,0);
});
function handler(name) {const start=html.indexOf('window.'+name+' = async function(');return html.slice(start,html.indexOf('\n};',start)+3);}
test('first-use calendar ownership priming preserves events and does not hide offline failures',async()=>{
  let ready=false,items=[raw];const {context}=env();
  Object.assign(context,{getUid:()=> 'owner',db:{},COLL:'briefings-bob',doc:(_,__,key)=>key,getDoc:async()=>{if(!ready)throw Object.assign(Error('missing'),{code:'permission-denied'});return {exists:()=>true,data:()=>({items})};},setDoc:async(_,body,options)=>{assert.deepEqual(JSON.parse(JSON.stringify(body)),{uid:'owner'});assert.equal(options.merge,true);ready=true;}});
  vm.runInContext(handler('fbLoadDaybookEvents'),context);assert.equal(await context.fbLoadDaybookEvents(),items);
  context.getDoc=async()=>{throw Error('offline');};await assert.rejects(context.fbLoadDaybookEvents(),/offline/);
});
test('event transactions preserve other items and reject conflicting edits and account changes',async()=>{
  let items=[{...raw,updatedAt:'old'},{...raw,id:'event-other123',title:'Other'}],writes=0;const {context}=env();
  Object.assign(context,{getUid:()=>context._firebaseUid,db:{},COLL:'briefings-bob',doc:(_,__,key)=>key,runTransaction:async(_,fn)=>fn({get:async()=>({exists:()=>true,data:()=>({items})}),set:(_,body)=>{items=body.items;writes++;}})});
  vm.runInContext(handler('fbWriteDaybookEvent'),context);
  await assert.rejects(context.fbWriteDaybookEvent({...raw,title:'Edit'},false,'wrong'),/another device/);assert.equal(writes,0);
  await context.fbWriteDaybookEvent({...raw,title:'Edit'},false,'old');assert.equal(items.length,2);assert.equal(items.find(x=>x.id==='event-other123').title,'Other');
  await assert.rejects(context.fbWriteDaybookEvent({...raw,title:'Overwrite'},false,null),/another device/);
  context.runTransaction=async(_,fn)=>fn({get:async()=>{context._firebaseUid='other';return {exists:()=>true,data:()=>({items})};},set:()=>{writes++;}});
  await assert.rejects(context.fbWriteDaybookEvent({...raw,id:'event-new123'},false,null),/Account changed/);assert.equal(writes,1);
});
test('list view shows a multi-day item once, source buttons name their destination, and an empty calendar explains how to fill it',async()=>{
  const trip={...raw,id:'event-trip1234',title:'Family weekend',kind:'travel',start:'2026-10-17',end:'2026-10-19'};
  const carried={...raw,id:'event-carry123',title:'Carried over',kind:'personal',start:'2026-09-29',end:'2026-10-02'};
  const {context,get}=env({fbLoadDaybookEvents:async()=>[trip,carried],fbLoadDecisions:async()=>[{id:'d',asset:'AMD',reviewDate:'2026-10-12'}],fbLoadMeetings:async()=>({items:[{id:'m',title:'QBE review',start:'2026-10-13T01:00:00Z',end:'2026-10-13T02:00:00Z'}]})});
  await context.renderDaybookCalendar();context.daycalSelect('2026-10-17');context.daycalView('list');
  const out=get('daycal-agenda').innerHTML;
  assert.equal((out.match(/Family weekend/g) || []).length,1);assert.equal((out.match(/Carried over/g) || []).length,1);
  assert.match(out,/Thu, 1 Oct 2026[\s\S]*Carried over/);
  assert.match(out,/>Open Decisions</);assert.match(out,/>Prepare meeting brief</);
  assert.doesNotMatch(out,/Nothing dated yet/);
  const empty=env();await empty.context.renderDaybookCalendar();
  assert.match(empty.get('daycal-agenda').innerHTML,/Nothing dated yet/);
});
test('delete asks first, and opening a saved flight keeps the remembered trip settings',async()=>{
  let writes=0,resets=0,shown='';const items=[{...raw}];
  const fare={id:'a'.repeat(20),kind:'advertised-fare',origin:'MNL',destination:'NRT',departureDate:'2099-11-04',returnDate:'2099-11-09',bookingUrl:'https://flights.philippineairlines.com/',airline:'PAL'};
  const {context,get}=env({fbLoadDaybookEvents:async()=>items,fbWriteDaybookEvent:async()=>{writes++;return [];},confirm:()=>false,fbLoadFlightPrefs:async()=>({[fare.id]:fare}),
    switchPage:async()=>{},resetFlightSettings:()=>{resets++;},renderFlightOffers:()=>{},showFlightAlternative:id=>{shown=id;}});
  await context.renderDaybookCalendar();context.daycalSelect('2026-10-10');
  await context.daycalDelete(0);assert.equal(writes,0,'a declined confirmation deletes nothing');
  context.confirm=()=>true;await context.daycalDelete(0);assert.equal(writes,1);
  // With the manual event gone, the saved trip is the only item left.
  context.daycalSelect('2099-11-04');await context.daycalSource(0);
  assert.equal(resets,0);assert.equal(shown,fare.id);assert.equal(get('flights-saved-only').checked,true);assert.equal(get('flights-cabin').value,'All');
});
test('all-day entries from linked calendars show as leave and holidays across their inclusive dates',async()=>{
  const {C}=env();
  const events=C.build({meetings:{items:[],days:[{id:'d1',title:'Annual Leave',start:'2026-10-19',end:'2026-10-21',calendar:'Google'},{id:'d2',title:'Bonifacio Day',start:'2026-11-30',end:'2026-11-30',calendar:'Outlook'},{id:'bad',title:'',start:'2026-10-01'},{id:'bad2',title:'Broken',start:'2026-02-30'}]}});
  assert.deepEqual(JSON.parse(JSON.stringify(events.map(e=>[e.kind,e.title,e.start,e.end]))),[['allday','Annual Leave','2026-10-19','2026-10-21'],['allday','Bonifacio Day','2026-11-30','2026-11-30']]);
  assert.equal(C.onDay(events,'2026-10-21').length,1);assert.equal(C.onDay(events,'2026-10-22').length,0);
  assert.equal(events[0].source,'Google calendar');assert.equal(events[0].page,'');
  assert.equal(C.filtered(events,'allday').length,2);assert.equal(C.filtered(events,'meeting').length,0);
  assert.match(C.ics(events),/DTSTART;VALUE=DATE:20261019\r\nDTEND;VALUE=DATE:20261022/);
  const {context,get}=env({fbLoadMeetings:async()=>({items:[],days:[{id:'d1',title:'Annual Leave',start:'2026-10-19',end:'2026-10-21',calendar:'Google'}]})});
  await context.renderDaybookCalendar();context.daycalSelect('2026-10-20');
  assert.match(get('daycal-agenda').innerHTML,/daycal-allday[\s\S]*Annual Leave/);
  assert.doesNotMatch(get('daycal-agenda').innerHTML,/daycalSource/,'an external all-day entry has no app page to open');
});
test('Zoho leave sent one day at a time joins into spans, without the employee number', () => {
  const {C}=env();
  const day=(title,start,calendar='Google')=>({id:'d'+start+title.length,title,start,end:start,calendar});
  const events=C.build({meetings:{items:[],days:[day('0175 - Annual Leave','2026-12-21'),day('0175 - Annual Leave','2026-12-22'),day('0175 - Annual Leave','2026-12-23'),day('0175 - Annual Leave','2026-12-24'),
    day('Christmas Day','2026-12-25'),day('0175 - Annual Leave','2026-12-29'),day('0175 - Annual Leave','2026-12-30'),day('0175 - Annual Leave','2026-12-31'),
    day('Annual Leave','2026-12-21','Outlook'),day('Team 0175 - offsite','2026-12-02')]}});
  const rows=JSON.parse(JSON.stringify(events.map(e=>[e.title,e.start,e.end,e.source])));
  assert.deepEqual(rows,[['Team 0175 - offsite','2026-12-02','2026-12-02','Google calendar'],['Annual Leave','2026-12-21','2026-12-24','Google calendar'],['Annual Leave','2026-12-21','2026-12-21','Outlook calendar'],
    ['Christmas Day','2026-12-25','2026-12-25','Google calendar'],['Annual Leave','2026-12-29','2026-12-31','Google calendar']]);
  assert.equal(C.onDay(events,'2026-12-23').filter(e=>e.title==='Annual Leave').length,1);
});
test('poker-related all-day entries get their own type; other all-day entries stay put', () => {
  const {C}=env();
  for(const title of ['APPT Championship Manila - Strategy: Risk Assessment','🟡 [METRO] RVS Cup (The Metro Championship) - Strategy: Peak Focus','Manila Special (Okada) - Strategy: Peer Collaboration','♠ Sunday Storm (₱2,000)','WSOP Main Event','Deepstack turbo at Solaire','Poker night'])assert.equal(C.poker(title),true,title);
  for(const title of ['Manifesto Check-in: Earth Goat Strategy','One-Year Goal Assessment','Annual Leave','Apt inspection','Christmas Day','Metro Manila trip','Stakeholder buy-in session'])assert.equal(C.poker(title),false,title);
  const events=C.build({meetings:{items:[],days:[{id:'a',title:'APPT Championship Manila',start:'2026-10-08',end:'2026-10-19',calendar:'Google'},{id:'b',title:'One-Year Goal Assessment',start:'2026-12-17',end:'2026-12-17',calendar:'Google'}]},manual:[{...raw,kind:'poker',title:'Okada Friday deepstack'}]});
  assert.deepEqual(JSON.parse(JSON.stringify(events.map(e=>[e.title,e.kind]))),[['APPT Championship Manila','poker'],['Okada Friday deepstack','poker'],['One-Year Goal Assessment','allday']]);
  assert.equal(C.filtered(events,'poker').length,2);
});
test('grid entries carry their full text for hover, and the day label names them for screen readers',async()=>{
  const long='🟡 [METRO] Metro Christmas Special - Strategy: Zenith Harvest';
  const days=[{id:'a',title:long,start:'2026-12-15',end:'2026-12-22',calendar:'Google'},{id:'b',title:'0175 - Annual Leave',start:'2026-12-21',end:'2026-12-21',calendar:'Google'},
    {id:'c',title:'Second',start:'2026-12-21',end:'2026-12-21',calendar:'Google'},{id:'d',title:'Third',start:'2026-12-21',end:'2026-12-21',calendar:'Google'},{id:'e',title:'Fourth & last',start:'2026-12-21',end:'2026-12-21',calendar:'Google'}];
  const {context,get}=env({fbLoadMeetings:async()=>({items:[],days})});
  await context.renderDaybookCalendar();context.daycalSelect('2026-12-21');
  const grid=get('daycal-grid').innerHTML;
  assert.match(grid,/data-tip="🟡 \[METRO\] Metro Christmas Special - Strategy: Zenith Harvest\nAll day · Tue, 15 Dec 2026 — Tue, 22 Dec 2026 · Google calendar"/);
  assert.match(grid,/class="daycal-bar daycal-poker"[^>]*>♠ 🟡 \[METRO\]/);
  assert.match(grid,/daycal-more" data-tip="Second\nThird"/);
  assert.match(grid,/aria-label="Mon, 21 Dec 2026; 5 items: [^"]*Zenith Harvest; Annual Leave; Fourth &amp; last; Second; Third"/);
});
test('time off joins leave with adjacent weekends and holidays, never with poker entries', () => {
  const {C}=env();
  const day=(title,start,end)=>({id:title+start,title,start,end:end||start,calendar:'Google'});
  const days=[day('0175 - Annual Leave','2026-12-21'),day('0175 - Annual Leave','2026-12-22'),day('0175 - Annual Leave','2026-12-23'),day('0175 - Annual Leave','2026-12-24'),
    day('Christmas Day','2026-12-25'),day('Boxing Day','2026-12-26'),day('Boxing Day Holiday','2026-12-28'),day('0175 - Annual Leave','2026-12-29'),day('0175 - Annual Leave','2026-12-30'),day('0175 - Annual Leave','2026-12-31'),
    day('🟡 [METRO] Metro Christmas Special','2026-12-15','2026-12-22'),day('One-Year Goal Assessment','2026-12-17'),day('Annual Leave','2026-11-04'),day('Annual Leave','2026-11-13')];
  const windows=JSON.parse(JSON.stringify(C.offWindows({meetings:{days}},'2026-10-10')));
  assert.deepEqual(windows.map(w=>[w.start,w.end,w.days,w.leave,w.back]),[['2026-11-13','2026-11-15',3,1,'2026-11-16'],['2026-12-19','2026-12-31',13,7,'2027-01-01']],'a lone Wednesday is not a window; a Friday makes a long weekend');
  assert.deepEqual(windows[1].holidays,['Christmas Day','Boxing Day','Boxing Day Holiday']);
  assert.equal(C.offWindows({meetings:{days}},'2027-01-02').length,0);
  assert.equal(C.offWindows({manual:[{...raw,id:'event-leave123',title:'Leave - Tokyo trip',start:'2027-02-05',end:'2027-02-05'}]},'2026-10-10')[0].start,'2027-02-05');
  assert.deepEqual(JSON.parse(JSON.stringify(C.pokerCity('APT Championship Taipei'))),{city:'Taipei',airports:['TPE']});
  assert.equal(C.pokerCity('Triton Super High Roller Jeju').city,'Jeju');assert.equal(C.pokerCity('WSOP Main Event Vegas').city,'Las Vegas');
  assert.equal(C.pokerCity('Manila Special (Okada)'),null);assert.equal(C.pokerCity('[METRO] RVS Cup'),null);
  assert.equal(C.leaveNeeded('2026-11-13','2026-11-29',[]),11);assert.equal(C.leaveNeeded('2026-12-20','2026-12-27',[{start:'2026-12-19',end:'2026-12-31'}]),0);
});
test('PokerHQ tournaments abroad group into festivals with picks, buy-ins and duplicates merged', () => {
  const {C}=env();
  const t=(date,name,venue,status,buyin,type='side',url='https://www.theasianpokertour.com/series/apt-championship-taipei-2026/')=>({date,name,venue,status,buyin,type,url});
  const list=[t('2026-11-13','Satellite to National Cup Championship','Red Space, Taipei','target',6486),t('2026-11-14','Satellite to National Cup Championship','Red Space, Taipei','target',6486),
    t('2026-11-13','National Cup Championship','Red Space 多元商務空間, Taipei','skip',31476),t('2026-11-23','APT Championship Main Event Freezeout - Day 1','Red Space, Taipei','skip',613008,'main'),
    t('2026-11-28','Turbo Championship','Red Space 多元商務空間, Taipei','skip',68853),
    t('2026-10-30','Inspire Superstack - Day 1','INSPIRE Entertainment Resort, Incheon','skip',27540),t('2026-10-30','Inspire Superstack Day 1','Inspire Hotel & Casino, Incheon','stretch',28083),
    t('2026-11-05','WPT Seoul Inspire Championship - Day 1A','INSPIRE Entertainment Resort, Incheon','skip',82620,'main'),
    t('2026-10-12','Monday 50K GTD','Metro Card Club, Ortigas Center, Pasig City','target',750),t('July 8, 2026','Kick-Off Day 1','RED SPACE and Asia Poker Arena, Taipei, Taiwan','stretch',7650),
    t('2026-11-20','Bad date row','Red Space, Taipei','target',1,'side','javascript:alert(1)')];
  const f=JSON.parse(JSON.stringify(C.pokerFestivals(list,'2026-10-10')));
  assert.deepEqual(f.map(x=>[x.city,x.start,x.end,x.events,x.label]),[['Incheon','2026-10-30','2026-11-05',2,'WPT Seoul Inspire Championship'],['Taipei','2026-11-13','2026-11-28',6,'APT Championship Main Event Freezeout']]);
  assert.equal(f[0].picks.length+f[1].picks.length,0,'a grade is not a pick: nothing is starred');assert.equal(f[1].gradeSource,'import');
  assert.deepEqual(f[0].affordable.map(p=>p.grade),['stretch'],'the same event imported twice keeps the stronger grade');
  assert.deepEqual(f[1].affordable.map(p=>[p.day,p.buyin]),[['2026-11-13',6486],['2026-11-14',6486],['2026-11-20',1]]);
  const starred=list.map(x=>x.name==='Turbo Championship'?{...x,planning:true}:x);
  const live=JSON.parse(JSON.stringify(C.pokerFestivals(starred,'2026-10-10',{amount:30000,rule:3})))[1];
  assert.deepEqual(live.picks.map(p=>p.name),['Turbo Championship']);assert.equal(live.gradeSource,'bankroll');
  assert.deepEqual(live.affordable.map(p=>p.buyin),[6486,6486,1],'graded live: PHP 10,000 target and PHP 16,667 stretch limits');
  assert.equal(C.pokerGrade(10000,{amount:30000,rule:3}),'target');assert.equal(C.pokerGrade(16000,{amount:30000,rule:3}),'stretch');assert.equal(C.pokerGrade(20000,{amount:30000,rule:3}),'skip');assert.equal(C.pokerGrade(100,null),'skip');
  assert.equal(f[1].buyinMax,613008);assert.equal(f[1].main.buyin,613008);assert.equal(f[1].url,'https://www.theasianpokertour.com/series/apt-championship-taipei-2026/');
  assert.equal(f[1].venue,'Red Space');
  assert.equal(C.pokerDate('July 8 - 19, 2026'),'2026-07-08');assert.equal(C.pokerDate('2026-02-30'),'');assert.equal(C.pokerDate('soon'),'');
});
