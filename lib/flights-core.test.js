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
test('private quotes compare per traveller, retain uncertainty and validate dates, source and observation time',()=>{
 const F=globalThis.FlightsCore,raw={airline:'Cebu Pacific',origin:'MNL',destination:'CEB',departureDate:'2026-11-22',returnDate:'2026-11-27',passengers:2,total:6000,observedAt:now,baggageKg:20,taxes:'yes',stops:'0'};
 const q=F.manualQuote(raw,'a'.repeat(20),now);assert.equal(q.amount,3000);assert.equal(q.quoteTotal,6000);assert.equal(q.userSupplied,true);assert.equal(q.checkedBaggageIncluded,true);assert.equal(q.taxesIncluded,true);assert.equal(q.priceLabel,'PHP 3000');
 assert.equal(select({offers:[q]},{market:'domestic'},now).length,1);
 assert.equal(F.shortlist(select({offers:[q]},{market:'domestic'},now),{},null,now).items[0].amount,3000);
 for(const bad of [{passengers:0},{total:-1},{departureDate:'2026-02-30'},{returnDate:'2026-11-01'},{observedAt:'2027-01-01'},{observedAt:'2020-01-01'},{link:'https://trip.com.evil.test'},{baggageKg:101}])assert.equal(F.manualQuote({...raw,...bad},'b'.repeat(20),now),null);
 const old=F.manualQuote({...raw,observedAt:'2026-10-08T00:00:00Z'},'c'.repeat(20),now);assert.equal(F.shortlist(select({offers:[old]},{market:'domestic'},now),{},null,now).items.length,0);
});
test('budget coverage requires exact dates, route and journey, not a cheaper campaign or one-way leg',()=>{
 const F=globalThis.FlightsCore,d=offer('a'),budget=offer('b',{airline:'Cebu Pacific'});
 assert.deepEqual(F.missingBudgetPrices(d,[{...budget,tripType:'one-way',returnDate:''}],now),['Cebu Pacific','AirAsia','Scoot']);
 assert.deepEqual(F.missingBudgetPrices(d,[budget],now),['AirAsia','Scoot']);
 assert.ok(F.missingBudgetPrices(d,[{...budget,checkedAt:'2020-01-01'}],now).includes('Cebu Pacific'));
});
test('hotel totals change trip ranking and budget eligibility; missing hotels remain explicit',()=>{
 const rows=select({offers:[offer('a',{currency:'PHP',amount:1000}),offer('b',{currency:'PHP',amount:2000,destination:'SIN'}),offer('c',{currency:'PHP',amount:500,destination:'HKG'})]}, {},now);
 const prefs={stayCost:d=>d.destination==='NRT'?{total:9000,name:'Tokyo hotel'}:d.destination==='SIN'?{total:1000,name:'Singapore hotel'}:null};
 const ranked=globalThis.FlightsCore.shortlist(rows,prefs,null,now).items;
 assert.deepEqual(ranked.map(d=>d.destination),['SIN','NRT','HKG']);assert.equal(ranked[0].planningAmount,3000);
 assert.ok(ranked[2].costChecks.includes('Hotel cost not included'));
 assert.deepEqual(globalThis.FlightsCore.shortlist(rows,{...prefs,budget:5000},null,now).items.map(d=>d.destination),['SIN','HKG']);
});
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
test('price memory compares only earlier days of the identical route and ignores stale quotes',()=>{
  const {memoryIndex,priceMemory}=globalThis.FlightsCore;
  const index=memoryIndex({firstDay:'2026-10-05',routes:{a:{key:'MNL|NRT|round-trip|Economy|USD',days:{'2026-10-05':260,'2026-10-07':255,'2026-10-08':255,'2026-10-10':200,bad:1}},b:{key:'MNL|NRT|round-trip|Business|USD',days:{'2026-10-06':100}}}});
  const m=priceMemory(offer('a'),index,'2026-10-10');
  assert.deepEqual(m,{earlierDays:3,since:'2026-10-05',low:255,lowDay:'2026-10-08',currency:'USD',delta:-5,newLow:true});
  assert.equal(priceMemory(offer('a',{amount:255}),index,'2026-10-10').newLow,false,'matching the low is not a new low');
  assert.equal(priceMemory(offer('a',{stale:true}),index,'2026-10-10').newLow,false);
  assert.deepEqual(priceMemory(offer('a',{origin:'CEB'}),index,'2026-10-10'),{earlierDays:0,since:'2026-10-05'});
  assert.equal(priceMemory(offer('a'),memoryIndex(null),'2026-10-10'),null);
  assert.equal(priceMemory({...offer('a'),kind:'promo'},index,'2026-10-10'),null);
});

 test('destination board separates journeys and cabins before comparing prices',()=>{
  const rows=select({offers:[offer('a',{currency:'PHP',amount:10000}),offer('b',{currency:'PHP',amount:6000,tripType:'one-way',returnDate:''}),offer('c',{currency:'PHP',amount:20000,cabin:'Business'})]},{},now);
  const regions=globalThis.FlightsCore.board(rows,null,now);
  assert.equal(regions.length,3);
  for(const r of regions) {
    assert.equal(new Set(r.cities.flatMap(c=>c.samples.map(d=>d.tripType+'|'+d.cabin))).size,1);
  }
  assert.equal(regions.find(r=>r.comparison==='round-trip · Economy').best.amount,10000);
});

test('domestic selector includes expanded hotel destinations and keeps international separate',()=>{
 const data={offers:[offer('a'),offer('b',{destination:'MPH',currency:'PHP',amount:5000}),offer('c',{destination:'ENI'}),offer('d',{destination:'IAO'}),offer('e',{destination:'PPS'}),offer('f',{destination:'KLO'})]};
 assert.deepEqual(select(data,{},now).map(d=>d.destination),['NRT']);
 assert.deepEqual(select(data,{market:'domestic'},now).map(d=>d.destination).sort(),['ENI','IAO','MPH','PPS']);
 assert.deepEqual(select(data,{market:'ENI'},now).map(d=>d.destination),['ENI']);
 assert.equal(select(data,{market:'PPS'},now).length,1);
 const rows=select(data,{market:'MPH'},now);
 assert.equal(globalThis.FlightsCore.shortlist(rows,{},null,now).items[0].costChecks.includes('Philippine travel tax'),false);
});
const hotelDoc={currency:'USD',adults:2,generatedAt:'2026-10-12T09:00:00Z',cities:[
  {city:'Seoul',airports:['ICN','GMP'],hotels:[{key:'g1-d1',name:'A',typicalMin:100,typicalMax:200,url:'https://www.tripadvisor.com/a'},{key:'g1-d2',name:'B',typicalMin:80,typicalMax:160,url:'javascript:alert(1)'},{key:'g1-d3',name:'C',typicalMin:60,typicalMax:120}],
    stays:[{checkIn:'2026-11-06',checkOut:'2026-11-10',nights:4,pricedAt:now,fare:{origin:'MNL'},quotes:[
      {key:'g1-d1',checked:true,rates:[{site:'Agoda.com',rate:90},{site:'Booking.com',rate:95},{site:'Hilton',rate:900}]},
      {key:'g1-d2',checked:true,rates:[{site:'Trip.com',rate:40},{site:'Agoda.com',rate:100}]},
      {key:'g1-d3',checked:false,rates:[]}]}]},
  {city:'Incheon',airports:['ICN'],hotels:[{key:'g2-d1',name:'Inspire',typicalMin:150,typicalMax:300}],stays:[]},
  {city:'Empty',airports:['XXX'],hotels:[],stays:[]}]};
test('hotel index keeps the scout order for shared airports and finds poker cities by name',()=>{
  const F=globalThis.FlightsCore, index=F.hotelIndex(hotelDoc);
  assert.equal(F.hotelCity(index,'',['ICN']).city,'Seoul');assert.equal(F.hotelCity(index,'Incheon',['ICN']).city,'Incheon');
  assert.equal(F.hotelCity(index,'Ho Chi Minh',['ICN']).city,'Seoul','unknown names fall back to airports');
  assert.equal(F.hotelCity(index,'',['XXX']),null,'a city without hotels is left out');assert.equal(F.hotelCity(null,'Seoul'),null);
  assert.equal(F.hotelUrl('https://www.tripadvisor.com/a'),'https://www.tripadvisor.com/a');assert.equal(F.hotelUrl('javascript:alert(1)'),'');
});
test('stay quotes rank priced hotels in PHP, mark deals below the usual lowest and flag a lone outlier site',()=>{
  const F=globalThis.FlightsCore, index=F.hotelIndex(hotelDoc), fx={asOf:'2026-10-09',fx:{usdphp:{level:58}}};
  const q=F.stayQuotes(F.hotelCity(index,'',['ICN']),'2026-11-06','2026-11-10',index,fx,now);
  assert.equal(q.nights,4);assert.deepEqual(q.rows.map(r=>r.hotel.name),['B','A','C']);
  const [b,a,c]=q.rows;
  assert.equal(b.lone,true,'Trip.com 40 is under 60% of the next site');assert.equal(b.deal,false);assert.equal(b.below,50);
  assert.equal(a.deal,true);assert.equal(a.below,10);assert.equal(a.php,5220);assert.deepEqual(a.typical,{min:5800,max:11600});
  assert.deepEqual(a.rates.map(r=>r.php),[5220,5510]);assert.equal(a.leftOut,1,'900 is over 2.5 x the typical top rate of 200: a whole-stay total, left out');assert.equal(b.leftOut,0);
  assert.equal(c.best,null);assert.equal(c.checked,false);
  assert.equal(q.cheapest.hotel.name,'B');assert.deepEqual(q.deals.map(r=>r.hotel.name),['A']);
  assert.equal(F.stayQuotes(F.hotelCity(index,'',['ICN']),'2026-11-07','2026-11-10',index,fx,now),null,'only exact dates match');
  const noFx=F.stayQuotes(F.hotelCity(index,'',['ICN']),'2026-11-06','2026-11-10',index,null,now);
  assert.equal(noFx.rows[1].php,null,'no PHP figure without a current rate');
  assert.deepEqual(F.typicalNightly(F.hotelCity(index,'',['ICN']),index,fx,now),{low:3480,high:5800,hotels:3});
});
test('trip totals add the room once for two sharing, and hotel searches carry exact dates in PHP',()=>{
  const F=globalThis.FlightsCore;
  assert.deepEqual(F.tripTotal(20000,5000,4),{one:40000,two:60000});assert.equal(F.tripTotal(null,5000,4),null);
  const link=F.hotelSearchLink('Hotel A, Seoul','2026-11-06','2026-11-10');
  assert.equal(new URL(link).hostname,'www.google.com');assert.equal(new URL(link).searchParams.get('curr'),'PHP');
  assert.equal(new URL(link).searchParams.get('q'),'Hotel A, Seoul from 2026-11-06 to 2026-11-10');
  assert.equal(F.hotelSearchLink('Seoul','2026-11-10','2026-11-10'),'');assert.equal(F.hotelSearchLink('','2026-11-06','2026-11-10'),'');
});

test('old, missing and future hotel timestamps cannot recommend deals or current totals',()=>{
  const F=globalThis.FlightsCore, index=F.hotelIndex(hotelDoc), base=index.byName.seoul;
  for(const pricedAt of ['2026-10-08T00:00:00Z',undefined,'not a date','2026-10-11T00:00:00Z']) {
    const city={...base,stays:[{...base.stays[0],pricedAt}]};
    const q=F.stayQuotes(city,'2026-11-06','2026-11-10',index,null,now);
    assert.equal(q.stale,true);assert.equal(q.cheapest,null);assert.equal(q.deals.length,0);
    assert.ok(q.rows.some(r=>r.best),'old rates remain available for historical inspection');
  }
  // A quote the scout reused (up to 20 h) before a late run stays current to 40 h.
  const at=h=>new Date(Date.parse(now)-h*3600000).toISOString(), quote=h=>F.stayQuotes({...base,stays:[{...base.stays[0],pricedAt:at(h)}]},'2026-11-06','2026-11-10',index,null,now);
  assert.equal(quote(36).stale,false);assert.ok(quote(36).cheapest);assert.equal(quote(41).stale,true);
});

test('hotel deal threshold uses the raw rate rather than a rounded percentage',()=>{
  const F=globalThis.FlightsCore,index=F.hotelIndex(hotelDoc),base=index.byName.seoul;
  const q=F.stayQuotes({...base,stays:[{...base.stays[0],quotes:[{key:'g1-d1',checked:true,rates:[{site:'Site',rate:90.4}]}]}]},'2026-11-06','2026-11-10',index,null,now);
  assert.equal(q.rows[0].below,10);assert.equal(q.rows[0].deal,false,'9.6% is below the 10% qualification threshold');
});

test('hotel settings validate dates and guests; search links carry dates only, guests are named for the user',()=>{
  const F=globalThis.FlightsCore;
  const settings={checkIn:'2026-11-07',checkOut:'2026-11-10',rooms:2,adults:4};
  assert.equal(F.hotelStaySettings(settings).nights,3);
  for(const change of [{checkIn:'2026-02-30'},{checkOut:'2026-11-07'},{rooms:0},{rooms:5},{adults:9},{adults:1},{rooms:1.5}])assert.equal(F.hotelStaySettings({...settings,...change}),null);
  // Google ignores guest text in the query (12 Oct 2026), so none is sent.
  assert.equal(new URL(F.hotelSearchLink('Seoul',settings.checkIn,settings.checkOut,settings)).searchParams.get('q'),'Seoul from 2026-11-07 to 2026-11-10');
  assert.equal(F.guestsLabel(settings),'2 rooms, 4 adults');assert.equal(F.guestsLabel({rooms:1,adults:1}),'1 room, 1 adult');assert.equal(F.guestsLabel(null),'1 room, 2 adults');
});
