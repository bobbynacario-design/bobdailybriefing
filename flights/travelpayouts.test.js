import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalize,foundDate,fetchTravelpayouts} from './travelpayouts.js';
const checkedAt='2026-10-15T12:00:00Z';
const row=(extra={})=>({airline:'5J',origin_airport:'MNL',destination_airport:'HKG',departure_at:'2026-12-18T09:10:00+08:00',return_at:'2027-01-05T13:00:00+08:00',price:9834,gate:'Trip.com',transfers:0,return_transfers:0,
  link:'/search/MNL1812HKG05011?t=5J179&search_date=14102026&expected_price=9834',...extra});
test('a recent Cebu Pacific search result becomes a labelled economy round trip with an Aviasales link',()=>{
  const [d]=normalize([row()],checkedAt);
  assert.equal(d.airline,'Cebu Pacific');assert.equal(d.tripType,'round-trip');assert.equal(d.currency,'PHP');assert.equal(d.amount,9834);assert.equal(d.departureDate,'2026-12-18');assert.equal(d.returnDate,'2027-01-05');
  assert.equal(d.destinationName,'Hong Kong');assert.equal(d.stops,0);assert.deepEqual(d.searched,{foundOn:'2026-10-14',seller:'Trip.com'});
  assert.equal(d.bookingUrl,'https://www.aviasales.com/search/MNL1812HKG05011?t=5J179&search_date=14102026&expected_price=9834');
  assert.match(d.priceBasis,/found on 2026-10-14 \(sold by Trip\.com\).*not a live quote/);assert.match(d.id,/^[a-f0-9]{20}$/);
  assert.equal(foundDate('/search/x?search_date=01022027'),'2027-02-01');
});
test('full-service, stale, same-day, past, foreign-origin and odd-link results are dropped; the cheapest six dates per route stay',()=>{
  const bad=[row({airline:'PR'}),row({link:'/search/x?search_date=01102026'}),row({return_at:'2026-12-18T20:00:00+08:00'}),row({departure_at:'2026-10-10T09:00:00+08:00'}),
    row({origin_airport:'HKG',destination_airport:'MNL'}),row({link:'https://evil.example/x?search_date=14102026'}),row({price:0})];
  assert.equal(normalize(bad,checkedAt).length,0);
  const many=Array.from({length:9},(_,i)=>row({departure_at:'2026-12-0'+(i+1)+'T09:00:00+08:00',price:9000+i}));
  const kept=normalize(many,checkedAt);assert.equal(kept.length,6);assert.equal(kept[0].amount,9000);
  assert.equal(normalize([row(),row()],checkedAt).length,1,'repeats collapse');
});
test('the reader asks for this month and the next two per route, sends the token only as a header, and reports failures',async()=>{
  const seen=[];const fetchImpl=async(u,init)=>{seen.push([String(u),init.headers['X-Access-Token']]);return {ok:true,json:async()=>({success:true,data:[row()]})};};
  const r=await fetchTravelpayouts('tok123',checkedAt,{fetchImpl,pause:0,routes:[['MNL','HKG']]});
  assert.equal(seen.length,3);assert.ok(seen.every(([u,t])=>!u.includes('tok123') && t==='tok123'));
  assert.deepEqual(seen.map(([u])=>new URL(u).searchParams.get('departure_at')),['2026-10','2026-11','2026-12']);
  assert.equal(r.status,'ok');assert.equal(r.items.length,1);
  assert.equal((await fetchTravelpayouts('',checkedAt)).status,'unavailable');
  const down=await fetchTravelpayouts('t',checkedAt,{fetchImpl:async()=>({ok:false}),pause:0,routes:[['MNL','HKG']]});assert.match(down.message,/did not answer/);
});
test('a seller named in Russian reads as Aviasales',()=>{
  assert.equal(normalize([row({gate:'Авиасейлс'})],checkedAt)[0].searched.seller,'Aviasales');
});
