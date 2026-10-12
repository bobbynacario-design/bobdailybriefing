import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cityFor,pickStays,chooseHotels,quoteRates,scoutHotels,MAX_CALLS} from './hotels.js';
import {HOTEL_CITIES} from './hotel-cities.js';
const now=Date.parse('2026-10-12T12:00:00Z'), today='2026-10-12', checkedAt='2026-10-12T11:00:00Z';
const fare=(amount,extra={})=>({id:'f'+amount,kind:'advertised-fare',airline:'PAL',origin:'MNL',destination:'NRT',tripType:'round-trip',cabin:'Economy',currency:'USD',amount,
  departureDate:'2026-11-08',returnDate:'2026-11-12',checkedAt,...extra});
const hotel=(n,min,extra={})=>({name:'Hotel '+n,key:'g298184-d'+n,accommodation_type:'Hotel',url:'https://www.tripadvisor.com/Hotel_Review-g298184-d'+n+'-Reviews-x.html',
  review_summary:{rating:4.3,count:900},price_ranges:{minimum:min,maximum:min*2},...extra});

test('maps airports to cities, Seoul before Incheon for ICN',()=>{
  assert.equal(cityFor('HND').city,'Tokyo');assert.equal(cityFor('ICN').city,'Seoul');assert.equal(cityFor('XXX'),null);
  assert.equal(new Set(HOTEL_CITIES.map(c=>c.city)).size,HOTEL_CITIES.length,'city names are unique');
  assert.ok(HOTEL_CITIES.every(c=>/^g\d+$/.test(c.location) && c.airports.every(a=>/^[A-Z]{3}$/.test(a))));
});
test('picks the cheapest fresh economy return per city, then another departure airport with different dates',()=>{
  const stays=pickStays([fare(400),fare(350,{origin:'CEB',departureDate:'2026-11-20',returnDate:'2026-11-25'}),fare(380,{departureDate:'2026-12-01',returnDate:'2026-12-04'}),
    fare(100,{cabin:'Premium Economy'}),fare(90,{tripType:'one-way'}),fare(80,{checkedAt:'2026-10-10T00:00:00Z'}),fare(70,{departureDate:'2026-10-12'}),
    fare(60,{destination:'XXX'}),fare(50,{returnDate:'2027-01-30'}),fare(500,{destination:'HKG'})],{now,today});
  assert.deepEqual(stays.map(s=>[s.city,s.checkIn,s.checkOut,s.fare.origin,s.nights]),[
    ['Tokyo','2026-11-20','2026-11-25','CEB',5],['Tokyo','2026-12-01','2026-12-04','MNL',3],['Hong Kong','2026-11-08','2026-11-12','MNL',4]]);
});
test('a second departure airport on the same dates adds no stay; at most two per city',()=>{
  const stays=pickStays([fare(300),fare(320,{origin:'CEB'}),fare(330,{origin:'CRK',departureDate:'2026-11-09'})],{now,today});
  assert.deepEqual(stays.map(s=>s.fare.origin),['MNL','CRK']);
});
test('chooses well-reviewed hotels in best-value order plus a cheaper budget pick',()=>{
  const picks=chooseHotels([hotel(1,150),hotel(2,0),hotel(3,140,{review_summary:{rating:3.9,count:900}}),hotel(4,120,{accommodation_type:'Hostel'}),
    hotel(5,130),hotel(6,160,{url:'https://evil.example/x'}),hotel(7,170),hotel(8,90),hotel(9,95,{review_summary:{rating:4.5,count:20}})]);
  assert.deepEqual(picks.map(h=>[h.name,h.budget]),[['Hotel 1',false],['Hotel 5',false],['Hotel 7',false],['Hotel 8',true]]);
  assert.deepEqual(Object.keys(picks[0]).sort(),['budget','key','name','rating','reviews','type','typicalMax','typicalMin','url']);
  assert.equal(chooseHotels([hotel(1,100),hotel(2,110),hotel(3,120),hotel(4,130)]).length,3,'no budget pick when nothing undercuts');
});
test('quotes keep valid site rates, cheapest first',()=>{
  assert.deepEqual(quoteRates([{name:'Booking.com',rate:156},{name:'Agoda.com',rate:139.456},{name:'Bad',rate:0},{name:'',rate:5},{name:'NaN',rate:'x'}]),
    [{site:'Agoda.com',rate:139.46},{site:'Booking.com',rate:156}]);
  assert.deepEqual(quoteRates(null),[]);
});
function fakeApi(calls) {
  return async url=>{
    calls.push(url);
    if(url.includes('/list?')) return url.includes('g298184') ? {error:null,result:{list:[hotel(1,150),hotel(2,160)]}} : {error:null,result:{list:[]}};
    const u=new URL(url);
    if(u.searchParams.get('hotel_key')==='g298184-d2') throw Error('timeout');
    return {error:null,result:{chk_in:u.searchParams.get('chk_in'),chk_out:u.searchParams.get('chk_out'),rates:[{name:'Agoda.com',rate:139},{name:'Booking.com',rate:156}]}};
  };
}
test('scout prices each stay per hotel, marks failed calls, then reuses the stay on the next run',async()=>{
  const calls=[];
  const doc=await scoutHotels({offers:[fare(400)],prior:null,now,today,fetchJson:fakeApi(calls),gapMs:0});
  assert.equal(doc.cities.length,1);assert.equal(doc.cities[0].city,'Tokyo');
  const stay=doc.cities[0].stays[0];
  assert.equal(stay.checkIn,'2026-11-08');assert.equal(stay.nights,4);assert.equal(stay.fare.id,'f400');
  assert.deepEqual(stay.quotes.map(q=>[q.key,q.rates.length,q.checked]),[['g298184-d1',2,true],['g298184-d2',0,false]]);
  assert.equal(stay.quotes[0].rates[0].site,'Agoda.com');
  assert.equal(doc.summary.calls,HOTEL_CITIES.length+2);assert.equal(doc.summary.failedCalls,1);assert.equal(doc.summary.pricedStays,1);
  assert.equal(calls.filter(u=>u.includes('/rates?')).every(u=>/rooms=1&adults=2&currency=USD/.test(u)),true);
  const again=[];
  const next=await scoutHotels({offers:[fare(400)],prior:doc,now:now+3600000,today,fetchJson:fakeApi(again),gapMs:0});
  assert.equal(next.summary.reusedStays,1);assert.equal(again.filter(u=>u.includes('/list?location_key=g298184')).length,0,'the hotel list is reused within a week');
  assert.equal(again.filter(u=>u.includes('/rates?')).length,0,'same dates within the TTL are not re-priced');
  const moved=[];
  const later=await scoutHotels({offers:[fare(400,{departureDate:'2026-11-09'})],prior:doc,now:now+3600000,today,fetchJson:fakeApi(moved),gapMs:0});
  assert.equal(moved.filter(u=>u.includes('/rates?')).length,2,'new dates are priced');assert.equal(later.cities[0].stays.length,1);
});
test('a failed hotel list keeps last week\'s hotels, and the call budget is never exceeded',async()=>{
  const prior={cities:[{city:'Tokyo',listedAt:'2026-10-01T00:00:00Z',hotels:[{key:'g298184-d1',name:'Old',typicalMin:1,typicalMax:2}],stays:[]}]};
  const doc=await scoutHotels({offers:[],prior,now,today,fetchJson:async()=>{throw Error('down');},gapMs:0});
  assert.equal(doc.cities.length,1);assert.equal(doc.cities[0].hotels[0].name,'Old');assert.equal(doc.summary.failedCalls,doc.summary.calls);
  let n=0;
  const offers=HOTEL_CITIES.map((c,i)=>fare(100+i,{id:'x'+i,destination:c.airports[0]}));
  const big=await scoutHotels({offers,prior:null,now,today,fetchJson:async url=>{n++;return url.includes('/list?') ? {result:{list:[hotel(1,1),hotel(2,2),hotel(3,3),hotel(4,0.5)]}} : {result:{chk_in:'2026-11-08',chk_out:'2026-11-12',rates:[]}};},gapMs:0});
  assert.ok(n<=MAX_CALLS);assert.equal(big.summary.budgetHit,n===MAX_CALLS);
});
