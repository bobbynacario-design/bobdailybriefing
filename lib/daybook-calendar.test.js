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
  assert.match(events[0].detail,/Google calendar/);assert.equal(events[0].page,'');
  assert.equal(C.filtered(events,'allday').length,2);assert.equal(C.filtered(events,'meeting').length,0);
  assert.match(C.ics(events),/DTSTART;VALUE=DATE:20261019\r\nDTEND;VALUE=DATE:20261022/);
  const {context,get}=env({fbLoadMeetings:async()=>({items:[],days:[{id:'d1',title:'Annual Leave',start:'2026-10-19',end:'2026-10-21',calendar:'Google'}]})});
  await context.renderDaybookCalendar();context.daycalSelect('2026-10-20');
  assert.match(get('daycal-agenda').innerHTML,/daycal-allday[\s\S]*Annual Leave/);
  assert.doesNotMatch(get('daycal-agenda').innerHTML,/daycalSource/,'an external all-day entry has no app page to open');
});
