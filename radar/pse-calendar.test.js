import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCalendar,calendarRequest,addSessions,fetchPseCalendar} from './pse-calendar.js';
const rows=Array.from({length:10},(_,i)=>({content:'January '+(i+1)+', 2026',categories:'2026'}));
const table={data:rows,recordsTotal:10,recordsFiltered:10};
test('verified holiday table includes separately announced Eid days and skips closures',()=>{
  const c=parseCalendar(table,'NON-TRADING DAY (November 02, 2026)','2026-10-13');
  assert.deepEqual(c.years,['2026']);
  assert.equal(addSessions('2026-03-19',1,c),'2026-03-23');
  assert.equal(addSessions('2026-05-26',1,c),'2026-05-28');
  assert.equal(addSessions('2026-10-30',1,c),'2026-11-03');
  assert.equal(addSessions('2026-12-31',1,c),null);
  assert.equal(addSessions('2026-10-12',1,null),null);
  assert.equal(addSessions('2026-02-30',1,c),null);
});
test('partial, malformed and unreviewed annual calendars fail closed',()=>{
  assert.throws(()=>parseCalendar({...table,recordsTotal:11},''));
  assert.throws(()=>parseCalendar({...table,data:[{content:'bad',categories:'2026'}],recordsTotal:1,recordsFiltered:1},''));
  const next=rows.map(r=>({...r,content:r.content.replace('2026','2027'),categories:'2027'}));
  assert.throws(()=>parseCalendar({...table,data:next},''),/coverage/);
});
test('public feed reader uses the advertised nonce and fails on unavailable notices',async()=>{
  const html='<table id="ptp_abcdef_1" data-config="col-holiday_title"></table>\nvar posts_table_params = {"ajax_action":"ptp_load_posts","ajax_nonce":"publicnonce"};';
  assert.match(calendarRequest(html),/_ajax_nonce=publicnonce/);
  assert.throws(()=>calendarRequest(html.replace('ptp_load_posts','unexpected')));
  const calls=[];
  const c=await fetchPseCalendar(async(url,opts)=>{calls.push({url,opts});return {ok:true,text:async()=>calls.length===1?html:'',json:async()=>table};});
  assert.equal(c.verified,true);assert.equal(calls.length,3);assert.equal(calls[1].opts.method,'POST');
  await assert.rejects(()=>fetchPseCalendar(async()=>({ok:false,status:503})),/503/);
});
