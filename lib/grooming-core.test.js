import {test} from 'node:test';
import assert from 'node:assert/strict';
import './grooming-core.js';
import './daybook-calendar-core.js';
const G=globalThis.GroomingCore;
const C=globalThis.DaybookCalendarCore;
const plain=v=>JSON.parse(JSON.stringify(v));
const T='2026-10-18';
const item=(o)=>Object.assign({id:'haircut',title:'Haircut',every:28,last:'',where:'',with:'',time:'',eventId:''},o);
const by=items=>Object.fromEntries(items.map(i=>[i.id,i]));

test('before anything is saved he gets the three starters; a list he emptied stays empty',()=>{
  const fresh=G.cleanGrooming(null,T);
  assert.equal(fresh.fresh,true);
  assert.deepEqual(fresh.items.map(i=>[i.id,i.every]),[['haircut',28],['sauna',7],['massage',14]]);
  assert.deepEqual(plain(G.cleanGrooming({uid:'u'},T)).items.length,3,'a primed doc with no items is still fresh');
  assert.deepEqual(plain(G.cleanGrooming({items:[]},T)),{items:[],fresh:false});
});

test('the stored list is cleaned: known shapes, past days only, no repeats, at most 20',()=>{
  const doc=G.cleanGrooming({items:[
    item({last:'2026-10-01',where:'  Barber   Joe ',time:'25:00',eventId:'bad id'}),
    item({title:'Copy'}),
    {id:'X',title:'Bad id',every:7},{id:'nails',title:'',every:7},{id:'spa',title:'Spa',every:0},
    {id:'sauna',title:'Sauna',every:'7',last:'2026-10-25'}
  ]},T);
  assert.deepEqual(plain(doc.items),[
    {id:'haircut',title:'Haircut',every:28,last:'2026-10-01',where:'Barber Joe',with:'',time:'',eventId:''},
    {id:'sauna',title:'Sauna',every:7,last:'',where:'',with:'',time:'',eventId:''}
  ],'a future last day is dropped, a bad time and event id are dropped');
  const many=G.cleanGrooming({items:Array.from({length:25},(_,i)=>({id:'item-'+i,title:'Item '+i,every:7}))},T);
  assert.equal(many.items.length,20);
  assert.deepEqual(Object.keys(G.stored({items:[item({}),{id:'X'}]})),['items']);
  assert.equal(G.stored({items:[item({}),{id:'X'}]}).items.length,1);
});

test('status from the last day and the rhythm: overdue, due, soon, ok, unknown',()=>{
  const items=by(G.plan({items:[
    item({id:'haircut',every:28,last:'2026-09-10'}),   // due 8 Oct: 10 days late, grace 7 → overdue
    item({id:'cut2',title:'Cut 2',every:28,last:'2026-09-15'}), // due 13 Oct: 5 days late → due
    item({id:'sauna',title:'Sauna',every:7,last:'2026-10-11'}), // due today
    item({id:'sauna2',title:'Sauna 2',every:7,last:'2026-10-08'}), // 3 days late, grace 2 → overdue
    item({id:'massage',title:'Massage',every:14,last:'2026-10-07'}), // due 21 Oct: 3 days, soon window 3
    item({id:'massage2',title:'Massage 2',every:14,last:'2026-10-08'}), // due 22 Oct: 4 days → ok
    item({id:'nails',title:'Nails',every:21})
  ]},[],T));
  assert.equal(items.haircut.status,'overdue');assert.equal(items.haircut.late,10);assert.equal(items.haircut.due,'2026-10-08');
  assert.equal(items.cut2.status,'due');assert.equal(items.cut2.late,5);
  assert.equal(items.sauna.status,'due');assert.equal(items.sauna.late,0);
  assert.equal(items.sauna2.status,'overdue');
  assert.equal(items.massage.status,'soon');assert.equal(items.massage.dueLabel,'Wed 21 Oct');
  assert.equal(items.massage2.status,'ok');
  assert.equal(items.nails.status,'unknown');assert.equal(items.nails.due,'');
  assert.deepEqual(G.plan({items:[item({id:'bb',title:'B'}),item({id:'aa',title:'A'})]},[],T).map(i=>i.id),['bb','aa'],'his own order');
});

test('a plan on his Calendar: planned, past ("did you go?"), deleted, or done there',()=>{
  const events=[
    {id:'groom-haircut-1',title:'Haircut',start:'2026-10-24',end:'2026-10-24',time:'15:00',kind:'personal',location:'Barber Joe',updatedAt:'2026-10-18T01:00:00Z'},
    {id:'groom-sauna-1',title:'Sauna',start:'2026-10-16',end:'2026-10-16',time:'',kind:'personal'},
    {id:'groom-nails-1',title:'Nails',start:'2026-10-12',end:'2026-10-12',kind:'task',done:true}
  ];
  const items=by(G.plan({items:[
    item({id:'haircut',last:'2026-09-10',eventId:'groom-haircut-1'}),
    item({id:'sauna',title:'Sauna',every:7,last:'2026-10-01',eventId:'groom-sauna-1'}),
    item({id:'massage',title:'Massage',every:14,last:'2026-10-01',eventId:'groom-gone-123'}),
    item({id:'nails',title:'Nails',every:21,last:'2026-09-01',eventId:'groom-nails-1'})
  ]},events,T));
  assert.equal(items.haircut.status,'planned','a plan replaces overdue');
  assert.deepEqual(plain(items.haircut.session),{eventId:'groom-haircut-1',start:'2026-10-24',time:'15:00',location:'Barber Joe',updatedAt:'2026-10-18T01:00:00Z'});
  assert.equal(G.stateText(items.haircut,T),'Sat 24 Oct 15:00 at Barber Joe');
  assert.equal(items.sauna.status,'past');assert.equal(G.stateText(items.sauna,T),'planned Fri 16 Oct: did you go?');
  assert.equal(items.massage.session,null,'an event deleted on Calendar is no plan');assert.equal(items.massage.status,'due');
  assert.equal(items.nails.last,'2026-10-12','a plan marked done on Calendar counts as going that day');
  assert.equal(items.nails.session,null);assert.equal(items.nails.status,'ok');
  assert.equal(G.plan({items:[item({eventId:'groom-haircut-1'})]},null,T)[0].session,null,'no events loaded: no plan');
});

test('the state text in his words',()=>{
  const s=o=>G.stateText(Object.assign({session:null,late:0,due:'',dueLabel:''},o),T);
  assert.equal(s({status:'overdue',late:10}),'overdue 10 days');
  assert.equal(s({status:'due',late:0}),'due today');
  assert.equal(s({status:'due',late:1}),'due 1 day ago');
  assert.equal(s({status:'due',late:4}),'due 4 days ago');
  assert.equal(s({status:'soon',due:'2026-10-19'}),'due tomorrow');
  assert.equal(s({status:'soon',due:'2026-10-21'}),'due Wed 21 Oct');
  assert.equal(s({status:'ok',dueLabel:'Sun 15 Nov'}),'next Sun 15 Nov');
  assert.equal(s({status:'planned',session:{start:T,time:'18:30',location:''}}),'today 18:30');
  assert.equal(s({status:'planned',session:{start:'2026-10-19',time:'',location:'Spa'}}),'tomorrow at Spa');
  assert.equal(s({status:'unknown'}),'no date yet');
  assert.deepEqual(G.EVERY.map(G.everyLabel),['Every 3 days','Every 4 days','Every week','Every 10 days','Every 2 weeks','Every 3 weeks','Every 4 weeks','Every 5 weeks','Every 6 weeks','Every 8 weeks','Every 3 months']);
});

test('Done: today, or the planned day once it has passed; the plan leaves the Calendar',()=>{
  const none=G.markDone({items:[item({last:'2026-09-10'})]},[],'haircut',T);
  assert.deepEqual(plain(none),{doc:{items:[item({last:T})]},removeEvent:'',went:T,next:'2026-11-15'});
  const past=[{id:'groom-sauna-1',title:'Sauna',start:'2026-10-16',end:'2026-10-16',kind:'personal'}];
  const p=G.markDone({items:[item({id:'sauna',title:'Sauna',every:7,last:'2026-10-01',eventId:'groom-sauna-1'})]},past,'sauna',T);
  assert.equal(p.went,'2026-10-16');assert.equal(p.next,'2026-10-23');assert.equal(p.removeEvent,'groom-sauna-1');assert.equal(p.doc.items[0].eventId,'');
  const ahead=[{id:'groom-haircut-1',title:'Haircut',start:'2026-10-24',end:'2026-10-24',kind:'personal'}];
  const a=G.markDone({items:[item({eventId:'groom-haircut-1'})]},ahead,'haircut',T);
  assert.equal(a.went,T,'went before the planned day');assert.equal(a.removeEvent,'groom-haircut-1');
  const after=G.plan(a.doc,[],T)[0];
  assert.equal(after.status,'ok');assert.equal(after.due,'2026-11-15','next due from the interval');
  assert.equal(G.markDone({items:[item({})]},[],'nope',T).removeEvent,'');
  assert.equal(G.markDone(null,[],'massage',T).doc.items.length,3,'Done on a starter saves the starters');
});

test('Plan: a valid Calendar event, reusing the plan already there',()=>{
  const r=G.planSession({items:[item({last:'2026-09-10',where:'Barber Joe',with:'Ana'})]},[],'haircut',{date:'2026-10-24',time:'15:00'},T,'groom-haircut-abc123');
  assert.equal(r.expected,null);
  assert.deepEqual(plain(r.event),{id:'groom-haircut-abc123',title:'Haircut',start:'2026-10-24',end:'2026-10-24',time:'15:00',kind:'personal',location:'Barber Joe',notes:'Grooming, with Ana. Mark it done on Today or About you.',done:false});
  assert.ok(C.manual(r.event).event,'the Calendar accepts it');
  assert.equal(r.doc.items[0].eventId,'groom-haircut-abc123');assert.equal(r.doc.items[0].time,'15:00','his usual time is remembered');
  const events=[Object.assign({},r.event,{updatedAt:'2026-10-18T02:00:00Z'})];
  const moved=G.planSession(r.doc,events,'haircut',{date:'2026-10-25',time:''},T,'groom-haircut-new999');
  assert.equal(moved.event.id,'groom-haircut-abc123','moving keeps the same event');assert.equal(moved.expected,'2026-10-18T02:00:00Z');
  assert.equal(moved.event.time,'');assert.equal(moved.doc.items[0].time,'15:00','an any-time plan keeps the usual time');
  assert.ok(G.planSession(r.doc,[],'haircut',{date:'2026-10-17'},T,'groom-x-12345678').error,'not in the past');
  assert.ok(G.planSession(r.doc,[],'haircut',{date:'2026-10-20',time:'7pm'},T,'groom-x-12345678').error);
  assert.ok(G.planSession(r.doc,[],'gone',{date:'2026-10-20'},T,'groom-x-12345678').error);
  assert.ok(G.planSession(r.doc,[],'haircut',{date:'2026-10-20'},T,'x').error);
});

test('the Plan picker starts on the due day at his usual time',()=>{
  const items=by(G.plan({items:[item({last:'2026-10-10',time:'16:00'}),item({id:'sauna',title:'Sauna',every:7,last:'2026-10-01'}),item({id:'nails',title:'Nails',every:21,eventId:'groom-nails-1'})]},
    [{id:'groom-nails-1',title:'Nails',start:'2026-10-21',end:'2026-10-21',time:'11:00',kind:'personal'}],T));
  assert.deepEqual(G.planDefault(items.haircut,T),{date:'2026-11-07',time:'16:00'});
  assert.deepEqual(G.planDefault(items.sauna,T),{date:'2026-10-19',time:G.DEFAULT_TIME},'overdue: tomorrow');
  assert.deepEqual(G.planDefault(items.nails,T),{date:'2026-10-21',time:'11:00'},'the plan already made');
});

test('add, edit and remove items',()=>{
  const added=G.addItem(null,'shave',T);
  assert.equal(added.id,'shave');assert.deepEqual(added.doc.items.map(i=>i.id),['haircut','sauna','massage','shave']);
  assert.equal(G.addItem(added.doc,'Nails',T).doc.items[4].every,21,'a typed preset name gets its rhythm');
  const own=G.addItem(added.doc,'  Eyebrow   threading ',T);
  assert.equal(own.id,'eyebrow-threading');assert.equal(own.doc.items[4].every,28);
  assert.ok(G.addItem(own.doc,'eyebrow threading',T).error,'no duplicates');
  assert.ok(G.addItem(own.doc,'   ',T).error);
  assert.equal(G.addItem({items:[{id:'item',title:'X',every:7}]},'!',T).id,'item-2');
  const full={items:Array.from({length:20},(_,i)=>({id:'item-'+i,title:'Item '+i,every:7}))};
  assert.ok(G.addItem(full,'Facial',T).error);
  const edited=G.updateItem(own.doc,'haircut',{every:35,last:'2026-10-02',where:' Joe ',with:'Ana',title:''},T).doc.items[0];
  assert.deepEqual([edited.title,edited.every,edited.last,edited.where,edited.with],['Haircut',35,'2026-10-02','Joe','Ana']);
  assert.equal(G.updateItem(own.doc,'haircut',{last:'2026-11-02'},T).doc.items[0].last,'','a future day is refused');
  assert.equal(G.updateItem({items:[item({last:'2026-10-02'})]},'haircut',{last:''},T).doc.items[0].last,'','empty clears it');
  assert.equal(G.updateItem({items:[item({})]},'haircut',{every:0},T).doc.items[0].every,28);
  const events=[{id:'groom-haircut-1',title:'Haircut',start:'2026-10-24',end:'2026-10-24',kind:'personal'}];
  const removed=G.removeItem({items:[item({eventId:'groom-haircut-1'}),item({id:'sauna',title:'Sauna',every:7})]},events,'haircut',T);
  assert.deepEqual(removed.doc.items.map(i=>i.id),['sauna']);assert.equal(removed.removeEvent,'groom-haircut-1');
  assert.deepEqual(G.presetsToAdd(null,T).map(p=>p.id),['shave','nails','facial']);
});

test('Today: past plans, overdue and due first, then a plan for today or tomorrow, then soon',()=>{
  const events=[
    {id:'groom-massage-1',title:'Massage',start:'2026-10-19',end:'2026-10-19',time:'18:00',kind:'personal'},
    {id:'groom-shave-1',title:'Barber shave',start:'2026-10-25',end:'2026-10-25',kind:'personal'},
    {id:'groom-facial-1',title:'Facial',start:'2026-10-15',end:'2026-10-15',kind:'personal'}
  ];
  const items=G.plan({items:[
    item({id:'nails',title:'Nails',every:14,last:'2026-10-07'}),        // soon
    item({id:'massage',title:'Massage',every:14,last:'2026-10-01',eventId:'groom-massage-1'}), // planned tomorrow
    item({id:'shave',title:'Barber shave',every:14,last:'2026-10-01',eventId:'groom-shave-1'}), // planned next week: not on Today
    item({id:'sauna',title:'Sauna',every:7,last:'2026-10-11'}),         // due today
    item({id:'haircut',every:28,last:'2026-09-10'}),                    // overdue
    item({id:'facial',title:'Facial',every:28,last:'2026-09-01',eventId:'groom-facial-1'}), // past plan
    item({id:'eyebrows',title:'Eyebrows',every:28,last:'2026-10-10'})   // ok
  ]},events,T);
  const line=G.todayLine(items,T);
  assert.deepEqual(line.items.map(i=>i.id),['facial','haircut','sauna']);
  assert.equal(line.more,2,'massage tomorrow and nails soon are counted');
  assert.equal(line.notable,true);
  const calm=G.todayLine(items.filter(i=>['massage','nails','shave'].includes(i.id)),T);
  assert.deepEqual(calm.items.map(i=>i.id),['massage','nails']);assert.equal(calm.notable,false);
  assert.equal(G.todayLine(items.filter(i=>['shave','eyebrows'].includes(i.id)),T),null,'nothing near: no line');
  assert.deepEqual(plain(G.todayLine(G.plan(null,[],T),T)),{setup:true,items:[],more:0,notable:false},'nothing dated yet: set it up');
  assert.equal(G.todayLine([],T),null);
});

test('Calendar: what is due sits on today, the rest on its due day within 90 days, plans excluded',()=>{
  const events=[{id:'groom-massage-1',title:'Massage',start:'2026-10-24',end:'2026-10-24',kind:'personal'}];
  const items=G.plan({items:[
    item({id:'haircut',every:28,last:'2026-09-10',where:'Barber Joe'}),
    item({id:'sauna',title:'Sauna',every:7,last:'2026-10-15'}),
    item({id:'massage',title:'Massage',every:14,last:'2026-10-01',eventId:'groom-massage-1'}),
    item({id:'facial',title:'Facial',every:90,last:'2026-08-01'}),
    item({id:'spa',title:'Spa day',every:180,last:'2026-08-01'}),
    item({id:'nails',title:'Nails',every:21})
  ]},events,T);
  assert.deepEqual(plain(G.calendarEntries(items,T)),[
    {id:'grooming-haircut',title:'Due now: Haircut (10 days late)',start:T,detail:'Every 4 weeks · last Thu 10 Sep · Barber Joe. Plan it or mark it done on Today or About you.'},
    {id:'grooming-sauna',title:'Sauna due',start:'2026-10-22',detail:'Every week · last Thu 15 Oct. Plan it or mark it done on Today or About you.'},
    {id:'grooming-facial',title:'Facial due',start:'2026-10-30',detail:'Every 3 months · last Sat 1 Aug. Plan it or mark it done on Today or About you.'}
  ]);
});
