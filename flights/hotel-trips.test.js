import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchVenue,validTrips,priceTrips,caller,MAX_TRIPS} from './hotel-trips.js';
const now=Date.parse('2026-10-12T12:00:00Z'), today='2026-10-12';
const listed=(name,key,extra={})=>({name,key,accommodation_type:'Resort',url:'https://www.tripadvisor.com/Hotel_Review-'+key+'.html',review_summary:{rating:4.5,count:118},price_ranges:{minimum:210,maximum:521},...extra});
const trip=(extra={})=>({id:'poker|Incheon|2026-11-04|2026-11-08',kind:'poker',label:'WPT Seoul',city:'Incheon',airports:['ICN'],checkIn:'2026-11-04',checkOut:'2026-11-08',venue:'INSPIRE Entertainment Resort',...extra});

test('a venue matches a listed hotel by its distinctive words only',()=>{
  const list=[listed('Grand Hyatt Incheon','g297889-d306063'),listed('INSPIRE Entertainment Resort','g297889-d27139073'),listed('Paradise City','g297889-d12300162'),listed('Hyatt Regency Incheon Paradise City','g297889-d34593471')];
  assert.equal(matchVenue(list,'INSPIRE Entertainment Resort').key,'g297889-d27139073');
  assert.equal(matchVenue(list,'Paradise City').key,'g297889-d12300162','the first in best-value order wins');
  assert.equal(matchVenue(list,'Red Space'),null,'a venue that is not a listed hotel matches nothing');
  assert.equal(matchVenue(list,'Resort & Casino'),null,'generic words alone never match');
});
test('trip requests are re-checked: kind, dates, length, city, duplicates and a cap',()=>{
  const ok=validTrips([trip(),trip(),trip({id:'x',kind:'other'}),trip({id:'past',checkIn:'2026-10-12'}),trip({id:'long',checkOut:'2026-12-30'}),
    trip({id:'nowhere',city:'Atlantis',airports:['ZZZ']}),trip({id:'hcm',kind:'leave',city:'Ho Chi Minh',airports:['SGN'],venue:'Ignored'})],today);
  assert.deepEqual(ok.map(t=>[t.id,t.city,t.nights,t.venue]),[['poker|Incheon|2026-11-04|2026-11-08','Incheon',4,'INSPIRE Entertainment Resort'],['hcm','Ho Chi Minh City',4,'']]);
  assert.equal(validTrips(Array.from({length:20},(_,i)=>trip({id:'t'+i})),today).length,MAX_TRIPS);
});
test('prices a poker trip with the venue first, then reuses it and the venue lookup on the next run',async()=>{
  const urls=[];
  const api=async url=>{
    urls.push(url);
    if(url.includes('/list?')) return {result:{list:[listed('Grand Hyatt Incheon','g297889-d306063'),listed('INSPIRE Entertainment Resort','g297889-d27139073')]}};
    const u=new URL(url);return {result:{chk_in:u.searchParams.get('chk_in'),chk_out:u.searchParams.get('chk_out'),rates:[{name:'Agoda.com',rate:u.searchParams.get('hotel_key').endsWith('73') ? 230 : 180}]}};
  };
  const cities=[{city:'Incheon',hotels:[{key:'g297889-d306063',name:'Grand Hyatt Incheon',typicalMin:170,typicalMax:327}]}];
  const {call,stats}=caller(api);
  const doc=await priceTrips({uid:'u1',trips:[trip()],prior:null,cities,now,today,call,gapMs:0});
  const t=doc.trips[0];
  assert.equal(doc.kind,'hotel-stays');assert.equal(doc.uid,'u1');assert.equal(t.venueFound,true);
  assert.deepEqual(t.hotels.map(h=>[h.name,!!h.venue]),[['INSPIRE Entertainment Resort',true],['Grand Hyatt Incheon',false]]);
  assert.deepEqual(t.quotes.map(q=>q.rates[0].rate),[230,180]);assert.equal(stats.calls,3);
  assert.ok(urls.every(u=>!u.includes('/rates?') || /rooms=1&adults=2&currency=USD/.test(u)));
  assert.equal(doc.summary.priced,1);
  const again=caller(api);
  const next=await priceTrips({uid:'u1',trips:[trip({label:'renamed'})],prior:doc,cities,now:now+3600000,today,call:again.call,gapMs:0});
  assert.equal(again.stats.calls,0,'same dates and hotels within 20 hours: no calls, venue cached for a week');
  assert.equal(next.summary.reused,1);assert.equal(next.trips[0].label,'renamed');
});
test('a trip to a city without hotels is kept unpriced; the shared call budget stops further calls',async()=>{
  const {call,stats}=caller(async()=>({result:{chk_in:'2026-11-04',chk_out:'2026-11-08',rates:[]}}),2);
  const doc=await priceTrips({uid:'u1',trips:[trip({venue:''}),trip({id:'leave|Tokyo',kind:'leave',city:'Tokyo',airports:['NRT']})],prior:null,
    cities:[{city:'Tokyo',hotels:[{key:'g1-d1',name:'A'},{key:'g1-d2',name:'B'},{key:'g1-d3',name:'C'}]}],now,today,call,gapMs:0});
  assert.deepEqual(doc.trips.map(t=>[t.city,t.hotels.length]),[['Incheon',0],['Tokyo',3]]);
  assert.equal(stats.calls,2);assert.equal(stats.budgetHit,true);
  assert.deepEqual(doc.trips[1].quotes.map(q=>q.checked).sort(),[false,true,true]);
});
