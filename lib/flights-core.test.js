import {test} from 'node:test';
import assert from 'node:assert/strict';
import './flights-core.js';
const {select,officialUrl}=globalThis.FlightsCore;
const now='2026-10-10T02:00:00Z';
const offer=(id,extra={})=>({id:id.repeat(20),kind:'advertised-fare',airline:'Philippine Airlines',origin:'MNL',destination:'NRT',destinationName:'Tokyo',departureDate:'2026-11-22',returnDate:'2026-11-27',tripType:'round-trip',cabin:'Economy',currency:'USD',amount:250,sourceUrl:'https://flights.philippineairlines.com/en-ph/',bookingUrl:'https://flights.philippineairlines.com/en-ph/',checkedAt:now,...extra});
test('filters airports, destinations, dates, currencies and saved offers',()=>{
  const data={offers:[offer('a'),offer('b',{origin:'CEB',currency:'PHP',amount:9000}),offer('c',{kind:'promo',amount:null,currency:'',departureDate:'',returnDate:'',tripType:'not-stated'})]};
  assert.equal(select(data,{origin:'CEB'},now).length,1);
  assert.equal(select(data,{destination:'tokyo',currency:'USD'},now).length,1);
  assert.equal(select(data,{from:'2026-11-01',to:'2026-12-01'},now).length,2,'undated promos cannot qualify for a dated search');
  assert.equal(select(data,{savedOnly:true,savedIds:['a'.repeat(20)]},now).length,1);
});
test('does not compare different currencies or journey types as equivalent cheap fares',()=>{
  const rows=select({offers:[offer('a',{amount:250}),offer('b',{currency:'PHP',amount:10000}),offer('c',{amount:200}),offer('d',{tripType:'one-way',returnDate:'',amount:150})]}, {},now);
  const round=rows.filter(d=>d.group==='USD · round-trip · Economy');assert.deepEqual(round.map(d=>d.amount),[200,250]);
  assert.equal(new Set(rows.map(d=>d.group)).size,3);
});
test('old quotes and historical saved offers are flagged, and unsafe or incomplete records are rejected',()=>{
  const data={offers:[offer('a',{checkedAt:'2026-10-08T00:00:00Z'}),offer('b',{departureDate:'2026-10-01',returnDate:'2026-10-04'}),offer('c',{bookingUrl:'javascript:alert(1)'}),offer('d',{returnDate:''})]};
  assert.equal(select(data,{},now).length,1);assert.equal(select(data,{},now)[0].stale,true);
  const saved=select(data,{savedOnly:true,savedIds:['b'.repeat(20)]},now);assert.equal(saved[0].expired,true);
  assert.equal(officialUrl('https://airasia.com.evil.test'), '');assert.equal(officialUrl('https://www.airasia.com/promotions/ph/'),'https://www.airasia.com/promotions/ph/');
});
