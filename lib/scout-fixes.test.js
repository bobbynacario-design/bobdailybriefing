import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const core=readFileSync(new URL('./scout-core.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('./scout-ui.js',import.meta.url),'utf8');
const sandbox={URL,Intl,Date};vm.createContext(sandbox);vm.runInContext(core,sandbox);const C=sandbox.ScoutCore;
const event=(i,extra={})=>({title:'Exhibit '+i,lane:'interests',url:'https://events.example/'+i,start:'2026-11-01',end:'2026-12-01',...extra});
function environment(data,extra={}){const elements={},listeners={};const el=id=>elements[id]||(elements[id]={value:'',innerHTML:'',textContent:'',hidden:false});
  const ctx={URL,Intl,Date,console,setTimeout,document:{getElementById:el,addEventListener(k,fn){(listeners[k]||=([])).push(fn);}},fbLoadScout:async()=>data,...extra};ctx.window=ctx;
  vm.createContext(ctx);vm.runInContext(core,ctx);vm.runInContext(ui,ctx);ctx.ScoutCore.today=()=>'2026-10-18';el('scout-view').value='all';
  const click=async(selector,dataset)=>{for(const fn of listeners.click)await fn({target:{closest:s=>s.includes(selector)?{dataset}:null}});await new Promise(r=>setTimeout(r,0));};
  return {ctx,el,click};
}
test('retained lists keep all valid picks while generation retains its separate quota',()=>{
  const generated=C.clean(Array.from({length:18},(_,i)=>event(i)));assert.equal(generated.length,12);
  const rolled=C.rollPicks([],Array.from({length:18},(_,i)=>C.clean([event(i)])[0]),'2026-10-18');
  assert.equal(C.restore(rolled).length,18);
  assert.equal(C.restore([event(1,{url:'javascript:alert(1)'})]).length,0);
});
test('the UI names the full retained count and Show all reveals the remainder',async()=>{
  const {ctx,el,click}=environment({feed:{items:Array.from({length:18},(_,i)=>event(i))},choices:{}});
  await ctx.renderScout();assert.match(el('scout-results').innerHTML,/Interests &amp; discovery · 18/);assert.match(el('scout-results').innerHTML,/Show all 18/);
  assert.doesNotMatch(el('scout-results').innerHTML,/>Exhibit 17</);
  await click('data-scout-expand',{scoutExpand:'all-interests'});assert.match(el('scout-results').innerHTML,/>Exhibit 17</);
});
test('date checks reject preceding wrong years, missing years and unrelated script dates',()=>{
  const pad=' More event details.'.repeat(25);
  assert.equal(C.dateCheck(C.pageText('2025 Annual conference: 10 November'+pad),'2026-11-10'),'not-found');
  assert.equal(C.dateCheck(C.pageText('10 November'+pad),'2026-11-10'),'not-found');
  assert.equal(C.dateCheck(C.pageText('<script>var updated="2026-11-10"</script>10 November 2025'+pad),'2026-11-10'),'not-found');
  assert.equal(C.dateCheck(C.pageText('2026 Annual conference: 10 November'+pad),'2026-11-10'),'confirmed');
  assert.equal(C.dateCheck(C.pageText('Another event 10 November 2026'+pad),'2026-11-10','Claims seminar'),'unchecked');
  assert.equal(C.dateCheck(C.pageText('Claims seminar 10 November 2026'+pad),'2026-11-10','Claims seminar'),'confirmed');
});
test('Going never becomes earned by the passage of time, including across year boundaries',()=>{
  const v=event(1,{start:'2026-12-31',end:'2026-12-31',time:'13:00',zone:'EST',cpeHours:1});
  const t=C.timing(v);assert.equal(t.startAt,'2026-12-31T18:00:00.000Z');assert.equal(t.localDate,'2027-01-01');
  const doc=C.applyCpe(null,{op:'toggle',id:'session',item:v},Date.parse('2026-12-30T00:00:00Z'));
  assert.equal(doc.entries.session.date,'2027-01-01');assert.equal(C.cpeSummary(doc,'2027-01-02').earned,0);
  assert.equal(C.cpeSummary(doc,'2027-01-02').pending,1);
  assert.throws(()=>C.applyCpe(doc,{op:'edit',id:'session',status:'confirmed',hours:1,eligible:true},Date.parse('2026-12-31T17:00:00Z')),/not started/);
  const attended=C.applyCpe(doc,{op:'edit',id:'session',status:'attended'},Date.parse('2027-01-01T00:00:00Z'));
  assert.equal(C.cpeSummary(attended,'2027-01-02').earned,0);
});
test('overnight calendar sessions stay on the Manila day, sort by their instant and export UTC',()=>{
  const v=event(1,{start:'2026-11-04',end:'2026-11-04',time:'13:00',zone:'EST',title:'Claims, evidence; review\nNotes'});
  assert.equal(C.expired(v,'2026-11-05'),false);assert.equal(C.expired(v,'2026-11-06'),true);
  const ics=C.ics(C.calendarItem(v));assert.match(ics,/DTSTART:20261104T180000Z/);assert.match(ics,/SUMMARY:Claims\\, evidence\\; review/);
  assert.doesNotMatch(ics,/\r\nNotes/);
  const rows=C.mergeCalendar(null,{events:[v],sources:[]},'2026-11-05');assert.equal(Object.values(rows.items)[0].localDate,'2026-11-05');
  const multi=C.ics(event(2,{start:'2026-11-01',end:'2026-11-03'}));assert.match(multi,/DTEND;VALUE=DATE:20261104/);
  const folded=C.ics(event(3,{title:'学'.repeat(70)}));for(const line of folded.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
});
test('calendar rows can be saved, hidden and given follow-ups using their stable calendar identity',async()=>{
  const v=event(1,{start:'2026-10-21',end:'2026-10-21',lane:'work',source:'anziif-webinars',format:'online'}),id=C.calendarId(v),writes=[];
  const {ctx,el,click}=environment({feed:{items:[]},choices:{},calendar:{sources:[],items:{[id]:v}}},{fbScoutChoice:async(item,action,value)=>{writes.push({item,action,value});return {[id]:{item,...(action==='details'?value:{[action]:value})}};}});
  await ctx.renderScout();assert.match(el('scout-results').innerHTML,new RegExp('data-scout-id="'+id+'" data-scout-action="saved"'));
  el('scout-full-calendar').open=true;el('scout-note-panel-'+id).open=true;
  await click('data-scout-action',{scoutId:id,scoutAction:'saved'});assert.equal(writes[0].item.id,id);assert.match(el('scout-today').innerHTML,/Coming up 2026-10-21/);
  assert.match(el('scout-results').innerHTML,/id="scout-full-calendar" open/,'saving must not collapse the calendar');
  assert.match(el('scout-results').innerHTML,new RegExp('id="scout-note-panel-'+id+'" open'),'saving keeps the notes editor open');
  el('scout-note-'+id).value='Discuss recovery evidence with the group';el('scout-follow-'+id).value='2026-10-18';
  await click('data-scout-details',{scoutDetails:id});assert.equal(writes[1].value.note,'Discuss recovery evidence with the group');assert.match(el('scout-today').innerHTML,/Follow up 2026-10-18/);
  await click('data-scout-action',{scoutId:id,scoutAction:'hidden'});assert.equal(el('scout-today').hidden,true);
  el('scout-view').value='hidden';ctx.paintScout();assert.match(el('scout-results').innerHTML,/Exhibit 1/);
});
test('the weekly overview offers each available lane once and does not fill missing lanes',()=>{
  const rows=[event(1,{lane:'work',start:'2026-10-21'}),event(2,{lane:'people',kind:'community',start:'',end:'',nextActive:'2026-10-22'}),event(3,{start:'2026-10-19'}),event(4,{start:'2026-10-20'})];
  const picks=C.weeklyPicks(C.restore(rows),{},'2026-10-18');assert.deepEqual(Array.from(picks,v=>v.lane),['work','people','interests']);
  assert.equal(C.weeklyPicks(C.restore([rows[0]]),{},'2026-10-18').length,1);
});
test('CPE export preserves evidence and unconfirmed states without spreadsheet formula execution',()=>{
  const doc={years:{2026:{start:4,ethics:1}},entries:{old:{date:'2026-01-02',title:'=HYPERLINK("bad")',hours:1,evidence:'Certificate 123'},new:{date:'2026-02-03',title:'Session',status:'confirmed',hours:2,eligible:true,evidence:'Provider record'}}};
  const csv=C.cpeCsv(doc,'2026-10-18');assert.match(csv,/needs-review/);assert.match(csv,/Certificate 123/);assert.match(csv,/'=HYPERLINK/);assert.match(csv,/Provider record/);
});
test('the account API persists calendar notes on the first write and keeps them when Save is cleared',async()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('window.fbScoutChoice = async function('),code=html.slice(start,html.indexOf('\n};',start)+3);
  let stored=null,creates=0;
  const ctx={ScoutCore:C,getUid:()=> 'owner',db:{},COLL:'briefings-bob',doc:(db,coll,id)=>id,
    setDoc:async(ref,value)=>{stored={...(stored||{}),...value};creates++;},
    runTransaction:async(db,fn)=>{let pending;const result=await fn({get:async()=>{if(!stored)throw Object.assign(new Error('Missing document'),{code:'permission-denied'});return {exists:()=>true,data:()=>structuredClone(stored)};},set:(ref,value)=>{pending=value;}});stored=pending;return result;}};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);
  const v=C.calendarItem(event(1,{lane:'work',source:'anziif-webinars'}));
  await ctx.fbScoutChoice(v,'details',{note:'Meet the group',followUp:'2026-11-03'});assert.equal(creates,1);assert.equal(stored.items[v.id].note,'Meet the group');assert.equal(stored.uid,'owner');
  await ctx.fbScoutChoice(v,'saved',true);await ctx.fbScoutChoice(v,'saved',false);assert.equal(stored.items[v.id].note,'Meet the group');
  await ctx.fbScoutChoice(v,'details',{note:'',followUp:''});assert.equal(Object.keys(stored.items).length,0);
});
