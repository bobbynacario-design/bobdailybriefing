import {test} from 'node:test';
import assert from 'node:assert/strict';
import './flights-core.js';
const {select,officialUrl}=globalThis.FlightsCore;
const now='2026-10-10T02:00:00Z';
test('PHP equivalents use only validated stored rates with dated stale-rate disclosure',()=>{
  const convert=globalThis.FlightsCore.phpEstimate;
  const quote={kind:'advertised-fare',currency:'USD',amount:250};
  const snapshot={asOf:'2026-10-09',fx:{usdphp:{level:58.42},audphp:{level:38}}};
  assert.deepEqual(convert(quote,snapshot,now),{amount:14605,rate:58.42,asOf:'2026-10-09',stale:false});
  assert.equal(convert({...quote,currency:'AUD'},snapshot,now).amount,9500);
  assert.equal(convert(quote,{...snapshot,asOf:'2026-10-05'},now).stale,true);
  for(const currency of ['PHP','EUR','GBP']) assert.equal(convert({...quote,currency},snapshot,now),null);
  for(const level of [0,-1,NaN,Infinity,'58.42']) assert.equal(convert(quote,{...snapshot,fx:{usdphp:{level}}},now),null);
  for(const asOf of ['', '2026-10-11','2026-02-30']) assert.equal(convert(quote,{...snapshot,asOf},now),null);
  assert.equal(convert({...quote,kind:'promo'},snapshot,now),null);
  assert.equal(convert(quote,null,now),null);
});
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
test('campaigns lead, match overlapping travel windows, and disappear after booking expiry in Philippine time',()=>{
  const campaign={...offer('b'),campaign:true,kind:'promo',amount:null,currency:'PHP',origin:'ANY',destination:'ANY',origins:['MNL','CEB','CRK'],tripType:'one-way',departureDate:'',returnDate:'',bookingEnd:'2026-10-11',travelStart:'2027-02-01',travelEnd:'2027-06-30',destinationKeywords:'Japan Vietnam'};
  const data={offers:[offer('a'),campaign]};
  assert.equal(select(data,{},now)[0].campaign,true);
  assert.equal(select(data,{origin:'CRK',from:'2027-03-01',to:'2027-03-20',destination:'Japan'},now).length,1);
  assert.equal(select(data,{from:'2027-07-01'},now).length,0);
  assert.equal(select(data,{tripType:'campaigns'},now).length,1);
  assert.equal(select(data,{},'2026-10-11T16:00:00Z').some(d=>d.campaign),false);
  assert.equal(select(data,{savedOnly:true,savedIds:[campaign.id]},'2026-10-11T16:00:00Z')[0].expired,true);
});
test('shortlist ranks comparable fresh returns by PHP fare plus allowance and never ranks campaign base fares',()=>{
  const fx={asOf:'2026-10-09',fx:{usdphp:{level:58.42}}};
  const data={offers:[offer('a'),offer('b',{amount:240,departureDate:'2026-11-23',returnDate:'2026-11-28'}),offer('c',{destination:'SIN',amount:260}),offer('d',{amount:1,kind:'promo',tripType:'not-stated'}),offer('e',{amount:1,checkedAt:'2026-10-01'}),offer('f',{amount:1,cabin:'Business'})]};
  const rows=select(data,{},now),result=globalThis.FlightsCore.shortlist(rows,{minNights:3,maxNights:10,baggage:true},fx,now);
  assert.deepEqual(result.items.map(d=>d.id),['b'.repeat(20),'c'.repeat(20)]);
  assert.equal(result.items[0].phpFare,14020.8);assert.equal(result.items[0].nights,5);
  assert.equal(result.items[0].alternativeIds[0],'a'.repeat(20));assert.match(result.items[0].recommendation,/other date combination/);
  assert.ok(result.items[0].costChecks.includes('Your checked bag'));
  assert.equal(globalThis.FlightsCore.shortlist(rows,{budget:15000,extra:1000},fx,now).items.length,0);
  assert.equal(globalThis.FlightsCore.shortlist(rows,{directOnly:true},fx,now).items.length,0);
  assert.equal(globalThis.FlightsCore.shortlist(rows,{},null,now).unconverted,3);
  assert.match(globalThis.FlightsCore.shortlist(rows,{minNights:10,maxNights:3},fx,now).error,/Minimum/);
  assert.equal(globalThis.FlightsCore.deadlineLabel({campaign:true,bookingEnd:'2026-10-11'},now),'Sale ends tomorrow · Philippine time');
});
test('cabin filter keeps economy by default choice, never hides campaigns, and labels dates with weekdays',()=>{
  const {dayLabel,tripLabel}=globalThis.FlightsCore;
  const campaign={...offer('c'),campaign:true,kind:'promo',amount:null,currency:'PHP',origin:'ANY',destination:'ANY',origins:['MNL'],cabin:'Not stated',tripType:'one-way',departureDate:'',returnDate:'',bookingEnd:'2026-10-11',travelStart:'2027-02-01',travelEnd:'2027-06-30'};
  const data={offers:[offer('a'),offer('b',{cabin:'Business'}),offer('d',{cabin:'Premium Economy'}),campaign]};
  assert.deepEqual(select(data,{cabin:'economy'},now).map(d=>d.id[0]).sort(),['a','c']);
  assert.deepEqual(select(data,{cabin:'premium'},now).map(d=>d.id[0]).sort(),['b','c','d']);
  assert.equal(select(data,{cabin:'All'},now).length,4);
  assert.equal(dayLabel('2026-11-22',now),'Sun 22 Nov');assert.equal(dayLabel('2027-02-01',now),'Mon 1 Feb 2027');assert.equal(dayLabel('2026-02-30',now),'');
  assert.equal(tripLabel(offer('a'),now),'Sun 22 Nov → Fri 27 Nov · 5 nights');
  assert.equal(tripLabel(offer('a',{tripType:'one-way',returnDate:''}),now),'Sun 22 Nov · one way');
});
test('destination board groups airports by city and region, cheapest PHP estimate first',()=>{
  const fx={asOf:'2026-10-09',fx:{usdphp:{level:60}}};
  const rows=select({offers:[offer('a',{destination:'HND',amount:300}),offer('b',{amount:280}),offer('c',{destination:'ADL',destinationName:'Adelaide',amount:500}),offer('d',{destination:'ZZZ',destinationName:'Somewhere',amount:100}),offer('e',{amount:200,checkedAt:'2026-10-08T00:00:00Z'})]},{},now);
  const regions=globalThis.FlightsCore.board(rows,fx,now);
  assert.deepEqual(regions.map(r=>r.name),['Japan','Australia & New Zealand','Elsewhere']);
  const tokyo=regions[0].cities[0];assert.equal(tokyo.name,'Tokyo');assert.deepEqual(tokyo.codes.sort(),['HND','NRT']);
  assert.deepEqual(tokyo.samples.map(d=>d.amount),[280,300,200],'a stale quote ranks after fresh ones');
  assert.equal(tokyo.best.php,16800);assert.equal(regions[1].best.destination,'ADL');
});
