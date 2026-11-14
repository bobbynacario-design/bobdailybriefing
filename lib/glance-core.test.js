import {test} from 'node:test';
import assert from 'node:assert/strict';
import './glance-core.js';
import './daybook-calendar-core.js';
import './flights-core.js';
import './rentals-core.js';
const G=globalThis.GlanceCore,C=globalThis.DaybookCalendarCore,F=globalThis.FlightsCore,R=globalThis.RentalsCore;
const T='2026-11-14',NOW=Date.parse('2026-11-14T03:00:00Z'); // Sat 14 Nov, 11:00 in Manila

test('calendar: today first, all-day before timed, a span says when it ends',()=>{
  const manual=[{id:'evt-aaaaaaaa',title:'Dentist',start:T,time:'15:30'},{id:'evt-bbbbbbbb',title:'Lunch with Mia',start:T,time:'12:00'}];
  const meetings={days:[{id:'d1',title:'0175 - Annual Leave',start:'2026-11-13',end:'2026-11-17',calendar:'Work'}]};
  const r=G.calendarLine(C,{manual,meetings},T);
  assert.equal(r.label,'Today');assert.equal(r.source,'calendar');
  assert.equal(r.text,'Annual Leave (to 17 Nov) · 12:00 Lunch with Mia · 15:30 Dentist');
});
test('calendar: with nothing today, the next entry this week; nothing further out; done items skipped',()=>{
  const manual=[{id:'evt-cccccccc',title:'Claims review',start:'2026-11-17',time:'10:00'},{id:'evt-dddddddd',title:'Done thing',start:T,done:true},{id:'evt-eeeeeeee',title:'Far away',start:'2026-11-30'}];
  assert.deepEqual(G.calendarLine(C,{manual},T),{source:'calendar',label:'Next',text:'Tue 17 Nov · 10:00 Claims review'});
  assert.equal(G.calendarLine(C,{manual:[manual[2]]},T),null);
  assert.equal(G.calendarLine(null,{},T),null);
});
test('sports: Manila times, LIVE kept, stale or far items dropped, two then a count',()=>{
  const items=[{tag:'FIGHT',at:'2026-11-14T14:00:00Z',text:'Adames vs Warburton'},{tag:'LIVE',at:'2026-11-14T02:00:00Z',text:'🇵🇭 Alexandra Eala vs Someone'},
    {tag:'FIGHT',at:'2026-11-14T22:00:00Z',text:'UFC 334: Hokit vs Gane'},{tag:'NBA',at:'2026-11-13T20:00:00Z',text:'Old game'},{tag:'NBA',at:'2026-11-16T02:00:00Z',text:'Too far'}];
  const r=G.sportsLine(items,NOW);
  assert.equal(r.text,'LIVE 🇵🇭 Alexandra Eala vs Someone · 22:00 Adames vs Warburton · +1 more');
  assert.equal(G.when('2026-11-14T22:00:00Z',NOW),'tomorrow 06:00');
  assert.equal(G.when('2026-11-16T02:00:00Z',NOW),'Mon 10:00');
  assert.equal(G.sportsLine([],NOW),null);
});
test('trip: countdown with what is open; a trip far off stays quiet; while away, the day of the trip',()=>{
  const soon={items:{b1:{city:'Cebu',destination:'CEB',depart:'2026-11-15',ret:'2026-11-18'}}};
  const r=G.tripLine(F,soon,T);
  assert.equal(r.label,'Trip');assert.match(r.text,/^Cebu tomorrow · /);
  assert.equal(G.tripLine(F,{items:{b1:{city:'Cebu',destination:'CEB',depart:'2027-02-01',ret:'2027-02-03'}}},T),null);
  assert.deepEqual(G.tripLine(F,{items:{b1:{city:'Cebu',destination:'CEB',depart:'2026-11-13',ret:'2026-11-16'}}},T),{source:'flights',label:'Trip',text:'In Cebu, day 2 of 4'});
});
test('fares: hits only, closest under target first, one shown then a count',()=>{
  const core={fareWatch:(w)=>({watch:w,best:{php:w.php,fare:{id:w.city}},hit:w.php<=w.target}),tripLabel:(f)=>'trip '+f.id};
  const watch={items:{a:{city:'Singapore',target:13500,php:13163},b:{city:'Bangkok',target:17500,php:16021},c:{city:'Tokyo',target:20000,php:25000}}};
  assert.equal(G.fareLine(core,watch,{},{},NOW).text,'Bangkok ≈ ₱16,021 (trip Bangkok), your target ₱17,500 · +1 more');
  assert.equal(G.fareLine(core,{items:{c:watch.items.c}},{},{},NOW),null);
  assert.equal(G.fareLine(core,watch,null,{},NOW),null,'no scout, no line');
});
test('PSE: alerts from a recent close for stocks still on the list; an old close says nothing',()=>{
  const w={alertsAsOf:'2026-11-13',items:{BDO:{},ALI:{}},alerts:[{symbol:'BDO',text:'BDO crossed above its 200-day average'},{symbol:'SM',text:'SM no longer watched'},{symbol:'ALI',kind:'exdiv',text:'ALI goes ex-dividend'}]};
  assert.deepEqual(G.pseLine(w,T),{source:'pse',label:'PSE',text:'BDO crossed above its 200-day average',note:'close of Fri 13 Nov'});
  assert.equal(G.pseLine({...w,alertsCalendarVerified:true},T).text,'BDO crossed above its 200-day average · ALI goes ex-dividend');
  assert.equal(G.pseLine({...w,alertsAsOf:'2026-11-09'},T),null);
});
test('rentals: new and dropped listings in his areas only',()=>{
  const item=(id,extra)=>({id:'dot:'+id,url:'https://www.dotproperty.com.ph/x/'+id,price:20000,beds:0,area:'cubao',stay:'long',furnish:'furnished',firstSeen:'2026-11-13T03:00:00Z',...extra});
  const feed={generatedAt:'2026-11-14T03:00:00Z',trackingSince:'2026-10-29T00:00:00Z',items:[item('a1'),item('a2',{firstSeen:'2026-11-01T00:00:00Z',previousPrice:23000}),item('a3',{area:'clark'}),item('a4',{price:40000})]};
  const prefs={budget:25000,areas:['cubao'],sizes:['studio'],areaVersion:3};
  assert.deepEqual(G.rentalsLine(R,feed,prefs),{source:'rentals',label:'Rentals',text:'1 new in your areas · 1 price drop (up to ₱25,000)'});
  assert.equal(G.rentalsLine(R,{...feed,items:[item('a5',{firstSeen:'2026-11-01T00:00:00Z'})]},prefs),null);
});
test('rows keep a fixed order and drop empties',()=>{
  const out=G.rows([{source:'pse',text:'p'},null,{source:'calendar',text:'c'},{source:'flights',label:'Fares',text:'f'},{source:'flights',label:'Trip',text:'t'},{source:'odd',text:'x'},{source:'sports',text:''}]);
  assert.deepEqual(out.map(r=>r.source+(r.label?':'+r.label:'')),['calendar','flights:Fares','flights:Trip','pse']);
});
