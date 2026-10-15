import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestsFor,parseSerp,priceAccount,searchSerp,keyOf} from './exact-prices.js';
const today='2026-10-15',now=Date.parse('2026-10-15T00:30:00Z');
const serp={search_metadata:{google_flights_url:'https://www.google.com/travel/flights?hl=en&tfs=abc'},price_insights:{price_level:'high',typical_price_range:[7900,14000]},
  best_flights:[{price:14889,flights:[{airline:'Hong Kong Express',flight_number:'UO 517',departure_airport:{time:'2026-12-19 02:20'}}]}],
  other_flights:[{price:15784,flights:[{airline:'Cebu Pacific',flight_number:'5J 112',departure_airport:{time:'2026-12-19 15:15'}}]},{price:16684,flights:[{airline:'Cebu Pacific',flight_number:'5J 110',departure_airport:{time:'2026-12-19 07:10'}}]},
    {price:30000,flights:[{airline:'Philippine Airlines',flight_number:'PR 1'},{airline:'Cathay Pacific',flight_number:'CX 2'}]}]};
test('Google Flights answers keep the cheapest option, the cheapest per airline and Google\'s price read',()=>{
  const p=parseSerp(serp);
  assert.equal(p.price,14889);assert.equal(p.airline,'Hong Kong Express');assert.equal(p.flights,'UO 517');assert.equal(p.stops,0);assert.equal(p.departTime,'02:20');
  assert.deepEqual(p.byAirline,{'Hong Kong Express':14889,'Cebu Pacific':15784,'Philippine Airlines + Cathay Pacific':30000});
  assert.equal(p.level,'high');assert.deepEqual(p.typical,{low:7900,high:14000});assert.equal(p.googleUrl,'https://www.google.com/travel/flights?hl=en&tfs=abc');
  assert.equal(parseSerp({best_flights:[]}),null);assert.equal(parseSerp({...serp,search_metadata:{google_flights_url:'https://evil.example/x'}}).googleUrl,'');
});
test('requests: leave then poker trips from hotel-trips, then fare watches at their best scouted dates; past and duplicate dates dropped; six at most',()=>{
  const trips={trips:[{id:'poker|Taipei|2026-11-12|2026-11-15',kind:'poker',city:'Taipei',airports:['TPE'],checkIn:'2026-11-12',checkOut:'2026-11-15'},
    {id:'leave|Hong Kong|2026-12-19|2026-12-31',kind:'leave',city:'Hong Kong',airports:['HKG'],checkIn:'2026-12-19',checkOut:'2026-12-31'},
    {id:'leave|x',kind:'leave',city:'Old',airports:['NRT'],checkIn:'2026-10-01',checkOut:'2026-10-05'},{id:'c',kind:'custom',airports:['SIN'],checkIn:'2026-12-01',checkOut:'2026-12-05'}]};
  const offer={id:'a'.repeat(20),kind:'advertised-fare',airline:'PAL',origin:'MNL',destination:'NRT',departureDate:'2026-11-10',returnDate:'2026-11-15',tripType:'round-trip',cabin:'Economy',currency:'PHP',amount:20000,
    sourceUrl:'https://flights.philippineairlines.com/en-ph/',bookingUrl:'https://flights.philippineairlines.com/en-ph/',checkedAt:'2026-10-15T00:00:00Z'};
  const watch={items:{wa1:{city:'Tokyo',airports:['NRT'],from:'2026-11-01',to:'2026-11-30',minNights:3,maxNights:10,target:18000}}};
  const r=requestsFor({trips,watch,flights:{offers:[offer]},fx:null,today,now});
  assert.deepEqual(r.map(x=>[x.reason,x.destination,x.depart,x.ret]),[['leave','HKG','2026-12-19','2026-12-31'],['poker','TPE','2026-11-12','2026-11-15'],['watch','NRT','2026-11-10','2026-11-15']]);
});
test('pricing reuses a price under 20 hours old, stops at the budget, keeps an old price when a search fails, and never puts the key in the stored document',async()=>{
  const reqs=[{origin:'MNL',destination:'HKG',depart:'2026-12-19',ret:'2026-12-31',reason:'leave',ref:'l'},{origin:'MNL',destination:'TPE',depart:'2026-11-12',ret:'2026-11-15',reason:'poker',ref:'p'},{origin:'MNL',destination:'SIN',depart:'2026-12-01',ret:'2026-12-05',reason:'watch',ref:'w'}];
  const prior={items:{[keyOf(reqs[0])]:{...reqs[0],checkedAt:new Date(now-3600000).toISOString(),result:{price:1}},[keyOf(reqs[2])]:{...reqs[2],checkedAt:'2026-10-01T00:00:00Z',result:{price:9}}}};
  let calls=0;const budget={take:()=>calls<1};
  const out=await priceAccount({uid:'u1',requests:reqs,prior,now,budget,search:async()=>{calls++;return parseSerp(serp);}});
  assert.equal(out.searched,1);assert.equal(out.doc.items[keyOf(reqs[0])].result.price,1,'fresh price reused');assert.equal(out.doc.items[keyOf(reqs[1])].result.price,14889);
  assert.equal(out.doc.items[keyOf(reqs[2])].result.price,9,'over budget: the old price stays');
  let seen;const res=await searchSerp(reqs[0],'secret-key',async u=>{seen=String(u);return {ok:true,json:async()=>serp};});
  assert.match(seen,/engine=google_flights&departure_id=MNL&arrival_id=HKG&outbound_date=2026-12-19&return_date=2026-12-31&type=1&currency=PHP/);assert.equal(res.price,14889);
  assert.ok(!JSON.stringify(out.doc).includes('secret-key'));
  await assert.rejects(searchSerp(reqs[0],'k',async()=>({ok:false,status:429,json:async()=>({error:'limit'})})),/SerpApi answered 429: limit/);
});
