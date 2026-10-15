import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pairReturns,rateFor} from './pairs.js';
const out=(id,date,amount,extra={})=>({id:id.repeat(20),kind:'advertised-fare',airline:'Jetstar',origin:'MNL',destination:'NRT',departureDate:date,returnDate:'',tripType:'one-way',currency:'PHP',amount,stops:0,sourceUrl:'https://www.airasia.com/flights/en/gb/from-manila-mnl-to-tokyo-narita-nrt/',bookingUrl:'https://www.airasia.com/v2/flights/search/?x=1',...extra});
const leg=(id,date,amount,extra={})=>({id:id.repeat(20),kind:'return-leg',airline:'Jetstar',origin:'NRT',destination:'MNL',departureDate:date,currency:'JPY',amount,stops:0,bookingUrl:'https://www.airasia.com/v2/flights/search/?y=1',...extra});
const fx={asOf:'2026-10-15',fx:{jpyphp:{level:0.4}}};
test('an outbound pairs with the cheapest return leg 2-14 nights later, converted at the stored rate, and says it is two tickets',()=>{
  const pairs=pairReturns([out('a','2026-12-05',10000)],[leg('b','2026-12-06',10000),leg('c','2026-12-10',25000),leg('d','2026-12-12',20000),leg('e','2026-12-25',5000),leg('f','2026-12-11',30000,{origin:'KIX'})],fx,'2026-10-15');
  assert.equal(pairs.length,1);const p=pairs[0];
  assert.equal(p.returnDate,'2026-12-12');assert.equal(p.amount,18000);assert.equal(p.tripType,'round-trip');assert.equal(p.currency,'PHP');
  assert.match(p.priceBasis,/out PHP 10,000, back ≈ PHP 8,000 \(JPY 20,000 at 0\.4 PHP, market rate as of 2026-10-15\)\. Two separate tickets/);
  assert.match(p.id,/^[a-f0-9]{20}$/);assert.notEqual(p.id,'a'.repeat(20));
});
test('no pair without a fresh rate, from a non-MOVE page or a non-PHP outbound; mixed airlines are named; at most perRoute per route',()=>{
  assert.equal(pairReturns([out('a','2026-12-05',10000)],[leg('d','2026-12-12',20000)],{...fx,asOf:'2026-10-01'},'2026-10-15').length,0);
  assert.equal(rateFor(fx,'KRW','2026-10-15'),null);assert.equal(rateFor(fx,'PHP','2026-10-15'),1);
  assert.equal(pairReturns([out('a','2026-12-05',10000,{sourceUrl:'https://flights.philippineairlines.com/x'})],[leg('d','2026-12-12',20000)],fx,'2026-10-15').length,0);
  assert.equal(pairReturns([out('a','2026-12-05',10000,{currency:'USD'})],[leg('d','2026-12-12',20000)],fx,'2026-10-15').length,0);
  assert.equal(pairReturns([out('a','2026-12-05',10000)],[leg('d','2026-12-12',20000,{airline:'HK Express'})],fx,'2026-10-15')[0].airline,'Jetstar + HK Express');
  const many=['01','02','03','04','05'].map((d,i)=>out(String.fromCharCode(97+i),'2026-12-'+d,10000+i));
  assert.equal(pairReturns(many,[leg('z','2026-12-10',1000)],fx,'2026-10-15',{perRoute:3}).length,3);
});
