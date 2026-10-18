import {test} from 'node:test';
import assert from 'node:assert/strict';
import './daybook-calendar-core.js';
import './flights-core.js';
import './weekly-review-core.js';
import './health-core.js';
import './checkup-core.js';
import './lifestyle-core.js';
import './scout-core.js';
import './life-records-core.js';
const Life=globalThis.LifeRecordsCore;
const TODAY='2026-10-14',NOW=Date.parse('2026-10-14T02:00:00Z');  // Wednesday, 10:00 in Manila
const byId=(rows)=>Object.fromEntries(rows.map((r)=>[r.id,r]));

const calendar={
  manual:[{id:'evt-aaaaaaaa',title:'Dentist',start:'2026-10-20',end:'2026-10-20',time:'09:30',kind:'personal'}],
  meetings:{checkedAt:'2026-10-13T22:00:00Z',
    items:[{id:'m1',title:'QBE file review',start:'2026-10-15T01:00:00Z',end:'2026-10-15T02:00:00Z',calendar:'Outlook'}],
    days:['21','22','23','24'].map((d)=>({id:'l'+d,title:'0175 - Annual Leave',start:'2026-12-'+d,end:'2026-12-'+d,calendar:'Google'}))
      .concat([{id:'h1',title:'Christmas Day',start:'2026-12-25',end:'2026-12-25',calendar:'Google'},
        {id:'p1',title:'APPT Championship Manila - Strategy',start:'2026-10-08',end:'2026-10-19',calendar:'Google'}])}};
const review={weeks:{
  '2026-10-12':{commitments:[{id:'c-aaaaaa',text:'Log every money move in Decisions',area:'money',ticks:['2026-10-12','2026-10-14']},
    {id:'c-bbbbbb',text:'Walk 30 minutes',area:'health',measure:'four days',ticks:['2026-10-13']}],setAt:'2026-10-11T10:00:00Z'},
  '2026-10-05':{commitments:[{id:'c-cccccc',text:'Submit two reports',area:'work',ticks:['2026-10-06','2026-10-07'],result:'done'}],
    reflection:'Good week',reviewedAt:'2026-10-11T10:00:00Z'}}};
const okada='PokerStars LIVE Manila at Okada Manila, Paranaque';
const poker={
  tourneys:[{date:'2026-10-20',name:'Tuesday Grind',venue:okada,buyin:300,planning:true,status:'target'},
    {date:'2026-10-20',name:'Tuesday Grind',venue:okada,buyin:300,planning:true,status:'target'},
    {date:'2026-10-01',name:'Past pick',venue:okada,buyin:1000,planning:true},
    {date:'2026-11-11',name:'RVS Cup Main Event',venue:'Metro Card Club',buyin:15000,planning:true},
    {date:'2026-10-21',name:'Not starred',venue:okada,buyin:500},
    {date:'2026-11-05',name:'WPT Seoul Main Event',venue:'Inspire Entertainment Resort, Incheon',buyin:82620,type:'main'},
    {date:'November 6, 2026',name:'WPT Seoul Side',venue:'Inspire, Incheon',buyin:18722,planning:true},
    null,'junk'],
  bankroll:{amount:54321,rule:5},
  sessions:[{date:'2026-06-20',name:'MWAM Day 1D',venue:'Metro Card Club, Pasay',pnl:-4321,prize:0}]};
const fare=(id,extra)=>Object.assign({id:id.padEnd(20,'0'),kind:'advertised-fare',airline:'Philippine Airlines',origin:'MNL',originName:'Manila',currency:'PHP',tripType:'round-trip',cabin:'Economy',
  sourceUrl:'https://www.philippineairlines.com/deals',bookingUrl:'https://www.philippineairlines.com/book',checkedAt:'2026-10-14T01:00:00Z'},extra);
const flights={
  latest:{asOf:'2026-10-14',offers:[
    fare('a1',{destination:'TPE',destinationName:'Taipei',departureDate:'2026-12-21',returnDate:'2026-12-26',amount:16000}),
    fare('a2',{destination:'TPE',destinationName:'Taipei',departureDate:'2026-12-20',returnDate:'2026-12-24',amount:60000,cabin:'Business'}),
    fare('a3',{destination:'HKG',destinationName:'Hong Kong',departureDate:'2026-11-11',returnDate:'2026-11-12',amount:12000}),
    fare('a4',{destination:'SIN',destinationName:'Singapore',departureDate:'2026-10-21',returnDate:'2026-10-23',amount:270,currency:'USD'}),
    fare('a5',{origin:'CEB',originName:'Cebu',destination:'MPH',destinationName:'Boracay (Caticlan)',departureDate:'2026-11-17',tripType:'one-way',amount:2100})]},
  saved:{['a1'.padEnd(20,'0')]:fare('a1',{destination:'TPE',destinationName:'Taipei',departureDate:'2026-12-21',returnDate:'2026-12-26',amount:16000,savedAt:'2026-10-13T09:00:00Z'})},
  history:{firstDay:'2026-10-10',routes:{r1:{key:'MNL|HKG|round-trip|Economy|PHP',days:{'2026-10-12':13000}}}},
  fx:{asOf:'2026-10-13',fx:{usdphp:{level:58}}}};
const extra={decisions:[{asset:'ETH',status:'open'},{asset:'SOXX',status:'closed'}],tryNext:'Write one line each evening'};
const all=()=>Life.records({today:TODAY,now:NOW,calendar,review,poker,flights,extra});

test('calendar: each entry opens on its day, and the overview works out his time off',()=>{
  const rows=byId(all()),o=rows['calendar:overview'];
  assert.equal(rows['calendar:manual-evt-aaaaaaaa'].detail,'Tue 20 Oct at 09:30 Manila time · Personal · Your event');
  assert.match(rows['calendar:manual-evt-aaaaaaaa'].meta,/October 2026$/);
  assert.equal(rows['calendar:meeting-m1'].detail,'Thu 15 Oct at 09:00 Manila time · Meeting · Connected calendar');
  const appt=rows['calendar:day-p1'];
  assert.equal(appt.saved,TODAY,'an entry under way counts as today');assert.equal(appt.ref,TODAY);assert.match(appt.detail,/Thu 8 Oct – Mon 19 Oct · Poker plan/);
  assert.equal(rows['calendar:day-l21'].title,'Annual Leave','the employee number is dropped and the four days join');
  assert.equal(rows['calendar:day-l21'].detail,'Mon 21 Dec – Thu 24 Dec · Leave · Google calendar');
  assert.equal(o.saved,'','undated, so a date-bounded lookup still finds it');assert.equal(o.rank,1000);assert.equal(o.ref,'2026-12-19');
  assert.match(o.body,/a public holiday counts only when your linked calendars list it\): Sat 19 Dec – Sun 27 Dec \(December 2026\): 9 days off for 4 leave days, includes Christmas Day, back at work Mon 28 Dec/);
  assert.match(o.body,/Leave booked from today: 4 weekdays \(Mon 21 Dec – Thu 24 Dec\)/);
  assert.match(o.body,/Next 8 weeks: Thu 8 Oct – Mon 19 Oct APPT Championship Manila - Strategy \(Poker plan\); Thu 15 Oct QBE file review \(Meeting\); Tue 20 Oct Dentist \(Personal\)/);
  assert.match(o.body,/your own Daybook events \(1\), meetings matched to your accounts from your linked calendars \(1\), and all-day entries .* \(3\)/);
  assert.match(o.body,/not necessarily free/);
  assert.match(o.detail,/next time off Sat 19 Dec – Sun 27 Dec \(9 days for 4 leave days\)/);
});

test('calendar: every linked meeting is a record; a repeating one is named once in the overview and never counts as a clash',()=>{
  const team=['2026-10-16','2026-10-19','2026-10-23','2026-12-21','2026-12-25'].map((d,i)=>({id:'t'+i,title:'Team Catch Up',start:d+'T00:00:00Z',end:d+'T00:30:00Z',calendar:'Outlook',recurring:true}));
  const meetings={...calendar.meetings,events:[...team,
    {id:'m1',title:'QBE file review',start:'2026-10-15T01:00:00Z',end:'2026-10-15T02:00:00Z',calendar:'Outlook',accounts:['QBE']},
    {id:'x1',title:'Allianz site visit',start:'2026-12-22T01:00:00Z',end:'2026-12-22T03:00:00Z',calendar:'Google',accounts:['Allianz']},
    {id:'g1',title:'Haircut',start:'2026-10-17T02:00:00Z',end:'2026-10-17T03:00:00Z',calendar:'Google'}]};
  const rows=byId(Life.records({today:TODAY,now:NOW,calendar:{...calendar,meetings},review,poker,flights,extra})),o=rows['calendar:overview'];
  assert.equal(rows['calendar:meeting-t1'].detail,'Mon 19 Oct at 08:00 Manila time · Meeting · Outlook calendar');
  assert.equal(rows['calendar:meeting-m1'].detail,'Thu 15 Oct at 09:00 Manila time · Meeting · Connected calendar','the account meeting once');
  assert.match(o.body,/Next 8 weeks: Thu 8 Oct – Mon 19 Oct APPT Championship Manila - Strategy \(Poker plan\); Thu 15 Oct QBE file review \(Meeting\); Fri 16 Oct Team Catch Up \(Meeting; next of 3 in these 8 weeks\); Sat 17 Oct Haircut \(Meeting\); Tue 20 Oct Dentist \(Personal\)\./);
  assert.match(o.body,/back at work Mon 28 Dec; overlaps Allianz site visit \(Tue 22 Dec\)\./,'the one-off meeting in his leave, not the team catch-ups');
  assert.match(o.body,/the meetings in your linked Google and Outlook calendars for the next 90 days \(8, 2 naming your accounts\)/);
  assert.match(o.body,/Linked calendars are read 90 days ahead/);
  assert.match(o.body,/Linked calendars last checked Wed 14 Oct at 06:00 Manila time\./,'the 06:00 read is the day before in UTC');
});

test('commitments: this week in focus order with ticks so far, last week with its results',()=>{
  const rows=byId(all()),o=rows['commitments:overview'];
  assert.match(o.body,/^Your focus order \(as you set it\): money, then work, then health, then poker\./);
  assert.match(o.body,/This week \(Mon 12 Oct – Sun 18 Oct\): Money: Log every money move in Decisions — ticked on 2 of 3 days so far, including today; Health: Walk 30 minutes \(measure: four days\) — ticked on 1 of 3 days so far, not yet today\./);
  assert.match(o.body,/Last week: Work: Submit two reports — ticked on 2 of 7 days, you marked it done\. Your reflection: Good week\./);
  assert.match(o.body,/Weeks with commitments: 2 since Mon 5 Oct, 1 reviewed; results you marked: 1 done, 0 partly, 0 missed\./);
  assert.doesNotMatch(o.body,/Due now/,'mid-week with this week set and last week reviewed');
  assert.match(o.body,/Ideas for the week of Mon 12 Oct from your records, in your focus order \(the weekly review offers the same\): Money: Give your ETH call a review date and one line on what would prove it wrong \(1 open call has no review date in Decisions\); Work: Block two hours of focused report writing on three days \(Starter idea · nothing in your records for work yet\); Health: Walk 8,000 steps on four days \(Starter idea · nothing in your records for health yet\); Learning: Write one line each evening \(Suggested by your last weekly read\)\./);
  assert.equal(rows['commitments:2026-10-12'].saved,TODAY);assert.equal(rows['commitments:2026-10-05'].saved,'2026-10-11');
  assert.match(rows['commitments:2026-10-05'].body,/Your reflection: Good week\. Reviewed 2026-10-11\./);
  const none=byId(Life.records({today:'2026-10-11',now:NOW,review:{uid:'x'}}))['commitments:overview'];
  assert.match(none.body,/This week: no commitments set\. Due now: setting the commitments for the week of Mon 12 Oct\. You have not set any weekly commitments yet\./);
});

test('poker: only upcoming ★ picks, each once, graded by PokerHQ without ever writing the bankroll',()=>{
  const list=all(),rows=byId(list),picks=list.filter((r)=>r.source==='Poker' && r.id!=='poker:overview');
  assert.deepEqual(picks.map((r)=>r.title),['Tuesday Grind','WPT Seoul Side','RVS Cup Main Event']);
  assert.equal(rows['poker:2026-10-20:tuesday-grind'].detail,'Tue 20 Oct · PokerStars LIVE Manila at Okada Manila · buy-in PHP 300 · ★ starred in PokerHQ (Playing These) · PokerHQ grade for your bankroll now: target');
  assert.equal(rows['poker:2026-11-06:wpt-seoul-side'].saved,'2026-11-06','an older import\'s written date is read');
  const o=rows['poker:overview'];
  assert.match(o.detail,/^3 upcoming ★ picks, PHP 34,022 in buy-ins; next Tuesday Grind on Tue 20 Oct\.$/);
  assert.match(o.body,/by month: Oct 2026: 1 event on Tue 20 Oct, PHP 300; Nov 2026: 2 events, Fri 6 Nov – Wed 11 Nov, PHP 33,722\./,'each month says its own first and last date');
  assert.match(o.body,/1 target, 1 stretch, 1 skip; stretch: RVS Cup Main Event \(Wed 11 Nov\); skip: WPT Seoul Side \(Fri 6 Nov\)/);
  assert.match(o.body,/A grade \(target, stretch, skip\) is PokerHQ's check of a buy-in against your bankroll rule/);
  assert.match(o.body,/WPT Seoul Main Event in Incheon, Thu 5 Nov – Fri 6 Nov, 2 events, buy-ins PHP 18,722 to PHP 82,620, main event PHP 82,620 on Thu 5 Nov; your ★ picks: WPT Seoul Side/);
  assert.match(o.body,/Sessions logged in PokerHQ: 1; the latest on Sat 20 Jun \(MWAM Day 1D, Metro Card Club\)\./);
  const json=JSON.stringify(list);
  ['54321','54,321','4321','4,321'].forEach((n)=>assert.ok(!json.includes(n),'never writes '+n));
  assert.ok(!picks.some((r)=>r.title==='Not starred'));
  const noBank=byId(Life.records({today:TODAY,now:NOW,poker:{tourneys:poker.tourneys}}))['poker:overview'];
  assert.match(noBank.body,/bankroll could not be read, so there is no live grade/);
});

test('flights: economy fares that fit his time off, cheapest cities, island lows, new lows and poker trips',()=>{
  const rows=byId(all()),o=rows['flights:overview'];
  assert.match(o.body,/Your time off Sat 19 Dec – Sun 27 Dec \(December 2026; 9 days, 4 leave days\): scouted fares inside these dates: Taipei from Manila ≈ PHP 16,000 \(Mon 21 Dec → Sat 26 Dec · 5 nights, Philippine Airlines\)\./);
  assert.ok(!o.body.includes('60,000'),'a business fare is left out, as on the Flights page');
  assert.match(o.body,/Cheapest cities abroad on any dates: Hong Kong from Manila ≈ PHP 12,000 .*; Singapore from Manila ≈ PHP 15,660 .*; Taipei from Manila ≈ PHP 16,000/);
  assert.match(o.body,/Island trips at home: Boracay \(Caticlan\) from Cebu ≈ PHP 2,100 \(Tue 17 Nov · one way, Philippine Airlines\)\./);
  assert.match(o.body,/Below every earlier day the scout recorded for the same route: Hong Kong from Manila ≈ PHP 12,000/);
  assert.match(o.body,/Poker trip, WPT Seoul Main Event in Incheon \(for your ★ picks\): Thu 5 Nov – Sat 7 Nov, 1 leave day needed; no scouted fare to Incheon\./);
  assert.match(o.body,/advertised economy sample fares .* checked by the scout on 2026-10-14; seats and the final total need confirming/);
  assert.match(o.body,/Your saved shortlist: 1 on Flights\./);
  const saved=rows['flights:'+'a1'.padEnd(20,'0')];
  assert.equal(saved.title,'Saved flight: Manila → Taipei');assert.equal(saved.saved,'2026-12-21');assert.match(saved.meta,/December 2026$/);
  assert.match(saved.detail,/an advertised sample you saved, not a booking$/);
  // A scout more than a day old says so.
  const old=byId(Life.records({today:TODAY,now:NOW+2*86400000,calendar,flights}))['flights:overview'];
  assert.match(old.body,/\(more than a day ago\)/);
});

test('one unreadable part never costs the others, and nothing comes without a date',()=>{
  const broken={cleanWeeks(){throw new Error('bad');}};
  const rows=Life.records({today:TODAY,now:NOW,calendar,review,poker},{review:broken});
  assert.ok(rows.some((r)=>r.id==='calendar:overview') && rows.some((r)=>r.id==='poker:overview'));
  assert.ok(!rows.some((r)=>r.source==='Commitments'));
  assert.deepEqual(Life.records({today:TODAY,now:NOW}),[],'no documents, no records');
  assert.deepEqual(Life.OVERVIEW_IDS,['calendar:overview','commitments:overview','poker:overview','flights:overview','trips:overview','pse:overview','health:overview','scout:overview']);
});

// His own Trips (17 Oct 2026): booked trips with their checklist, the trips Trips
// prices for him (exact-date Google Flights price, cheapest room, tripTotal), and
// his fare watches against the scout and Google.
const trips={
  booked:{b1:{destination:'TPE',city:'Taipei',origin:'MNL',depart:'2026-11-12',ret:'2026-11-15',airline:'Philippines AirAsia',flight:'Z2 124',travellers:1,done:{tax:true}},
    b2:{destination:'KIX',city:'Osaka',origin:'MNL',depart:'2026-10-20',ret:'2026-10-25',hotel:'Hotel Kansai',travellers:2},bad:{destination:'??'}},
  watches:{w1:{city:'Singapore',airports:['SIN'],origin:'All',from:'2026-10-15',to:'2026-11-30',minNights:1,maxNights:5,target:16000},
    w2:{city:'Hong Kong',airports:['HKG'],origin:'All',from:'2026-10-15',to:'2026-12-31',minNights:3,maxNights:10,target:9000}},
  exact:{items:{'MNL|TPE|2026-11-12|2026-11-15':{origin:'MNL',destination:'TPE',city:'Taipei',depart:'2026-11-12',ret:'2026-11-15',reason:'poker',checkedAt:'2026-10-13T16:00:00Z',
      result:{price:16504,airline:'Philippines AirAsia',stops:0,level:'high',typical:{low:8700,high:16000}}},
    'MNL|HKG|2026-11-02|2026-11-08':{origin:'MNL',destination:'HKG',city:'Hong Kong',depart:'2026-11-02',ret:'2026-11-08',reason:'watch',ref:'w2',checkedAt:'2026-10-13T16:00:00Z',
      result:{price:9500,airline:'Cebu Pacific',stops:0,level:'typical',typical:{low:7900,high:14000}}}}},
  hotelTrips:{trips:[{id:'poker|Taipei|2026-11-12|2026-11-15',kind:'poker',label:'APT Main Event',city:'Taipei',airports:['TPE'],checkIn:'2026-11-12',checkOut:'2026-11-15',venue:'Red Space'},
    {id:'leave|Cebu|2026-09-01|2026-09-05',kind:'leave',city:'Cebu',airports:['CEB'],checkIn:'2026-09-01',checkOut:'2026-09-05'}]},
  hotelStays:{currency:'USD',adults:2,trips:[{id:'poker|Taipei|2026-11-12|2026-11-15',city:'Taipei',checkIn:'2026-11-12',checkOut:'2026-11-15',pricedAt:'2026-10-14T00:00:00Z',
    hotels:[{key:'h1',name:'The Grand Hotel',typicalMin:120,typicalMax:280}],quotes:[{key:'h1',rates:[{site:'Agoda.com',rate:150},{site:'Brand',rate:2000}],checked:true}]}]},
  latest:flights.latest,fx:flights.fx};
test('trips: booked trips and what is left, priced trips with totals, fare watches against the scout and Google',()=>{
  const rows=byId(Life.records({today:TODAY,now:NOW,trips})),o=rows['trips:overview'];
  const has=(text,part,message)=>assert.ok(text.includes(part),(message ? message+': ' : '')+text);
  const tpe=rows['trips:booked:b1'];
  assert.equal(tpe.title,'Booked trip: Taipei, Thu 12 Nov – Sun 15 Nov');assert.equal(tpe.page,'flights');assert.equal(tpe.saved,'2026-11-12');
  assert.equal(tpe.detail,'in 29 days · from Manila · Philippines AirAsia Z2 124 · no hotel entered · 1 traveller · 1 of 6 things done before going');
  has(tpe.body,'paid, unless your ticket includes it (done)');
  has(rows['trips:booked:b2'].body,'(overdue since Tue 29 Sep','a Japan visa needs three weeks (Node writes Sep or Sept)');
  assert.ok(!rows['trips:booked:bad'],'an invalid booking is left out');
  has(o.body,'Booked: Osaka Tue 20 Oct – Sun 25 Oct, in 6 days; 0 of 5 things done before going, with Visa overdue.','a hotel entered takes "Book where you will stay" off the list');
  // 150 USD x 58 = PHP 8,700 a night; the brand site's whole-stay figure is left out, as on Trips.
  const plan=rows['trips:plan:poker-taipei-2026-11-12-2026-11-15'];
  assert.equal(plan.title,'Poker trip: Taipei, Thu 12 Nov – Sun 15 Nov (APT Main Event)');
  has(plan.detail,'3 nights · flight PHP 16,504 per traveller on Google Flights · cheapest room PHP 8,700 a night at The Grand Hotel (one room, 2 adults, Agoda.com)');
  has(plan.detail,'together about PHP 42,604 for one traveller, PHP 59,108 for two sharing the room','16,504 + 3 x 8,700; 2 x 16,504 + 3 x 8,700');
  assert.equal(plan.body,'Google Flights: Philippines AirAsia, nonstop from Manila; Google rates this price high, the usual range being PHP 8,700–16,000; checked Wed 14 Oct. Venue: Red Space.');
  has(o.body,'flight PHP 16,504 per traveller on Google Flights (Philippines AirAsia, nonstop from Manila; Google rates this price high, the usual range being PHP 8,700–16,000; checked Wed 14 Oct); cheapest room','the overview keeps the whole line');
  assert.ok(!Object.keys(rows).some((id)=>/cebu/.test(id)),'a trip already over is left out');
  has(rows['trips:watch:w1'].detail,'best scouted fare ≈ PHP 15,660 (Wed 21 Oct → Fri 23 Oct · 2 nights, Philippine Airlines), at or under your target');
  assert.equal(rows['trips:watch:w1'].body,'','no Google price checked for this watch');
  has(rows['trips:watch:w2'].detail,'no scouted fare fits yet · for Mon 2 Nov – Sun 8 Nov: PHP 9,500 per traveller on Google Flights, PHP 500 over your target');
  assert.equal(rows['trips:watch:w2'].body,'Google Flights for Mon 2 Nov – Sun 8 Nov: Cebu Pacific, nonstop from Manila; Google rates this price typical, the usual range being PHP 7,900–14,000; checked Wed 14 Oct.');
  has(o.body,'for Mon 2 Nov – Sun 8 Nov: PHP 9,500 per traveller on Google Flights (Cebu Pacific, nonstop from Manila; Google rates this price typical, the usual range being PHP 7,900–14,000; checked Wed 14 Oct), PHP 500 over your target.');
  assert.equal(o.detail,'2 booked; 1 planned trip priced for time off and poker; 2 fare watches (1 at or under target).');
  assert.equal(o.rank,1000);
  const none=byId(Life.records({today:TODAY,now:NOW,trips:{}}))['trips:overview'];
  assert.equal(none.body,'No booked trips are saved on Trips. No fare watches are set.');
});

// The search index cuts a record's detail at 420 characters (18 Oct 2026: Bob's
// Singapore watch, with a scouted fare and a Google price on 2027-length dates,
// reached Ask as "..., PHP 2,0"). A watch with both prices and a priced trip with
// a long hotel name still fit, and the price gap stays whole.
test('trips: a fare watch or priced trip with every price on it fits the search index detail cap',()=>{
  const long=Object.assign({},trips,{
    watches:{w1:Object.assign({},trips.watches.w1,{to:'2027-04-13',minNights:3,maxNights:10,target:13500})},
    exact:{items:Object.assign({},trips.exact.items,{'MNL|SIN|2027-01-13|2027-01-16':{origin:'MNL',destination:'SIN',city:'Singapore',depart:'2027-01-13',ret:'2027-01-16',reason:'watch',ref:'w1',
      checkedAt:'2026-10-13T16:00:00Z',result:{price:15520,airline:'Philippine Airlines',stops:1,level:'typical',typical:{low:12000,high:24500}}}})},
    hotelStays:Object.assign({},trips.hotelStays,{trips:[Object.assign({},trips.hotelStays.trips[0],{hotels:[{key:'h1',name:'Grand Hyatt Taipei Executive Club Residences, Xinyi District by Taipei 101',typicalMin:120,typicalMax:280}]})]})});
  const rows=Life.records({today:TODAY,now:NOW,trips:long}).filter((r)=>r.source==='Trips' && r.id!=='trips:overview');
  rows.forEach((r)=>assert.ok(r.detail.length<=420,r.id+' detail is '+r.detail.length+' characters: '+r.detail));
  const w1=rows.find((r)=>r.id==='trips:watch:w1');
  assert.ok(w1.detail.endsWith(': PHP 15,520 per traveller on Google Flights, PHP 2,020 over your target'),w1.detail);
  assert.ok(w1.body.startsWith('Google Flights for ') && w1.body.endsWith('Philippine Airlines, 1 stop from Manila; Google rates this price typical, the usual range being PHP 12,000–24,500; checked Wed 14 Oct.'),w1.body);
});

// His PSE watchlist and paper picks (17 Oct 2026): closes as the PSE job wrote
// them (the board for PSEi stocks, the watchlist's rows for the rest), notices
// for watched stocks only, and the paper record with its own caveat.
test('pse: watched stocks with their last close and his buy-below, notices for them, and paper picks',()=>{
  const pse={
    board:{asOf:'2026-10-14',board:[{symbol:'BDO',name:'BDO Unibank',asOf:'2026-10-13',close:113.5,dayChangePct:1.34,ret1w:2.25,ret1m:-1.99,ret3m:-10.49,retYtd:-15.68,low52:109.2,high52:144.6,pctFromHigh:-21.51,yield12m:3.88}]},
    watch:{items:{BDO:{addedAt:'2026-10-13T02:04:23Z',target:110},MREIT:{addedAt:'2026-10-13T02:21:10Z'},NEW:{addedAt:'2026-10-13T02:21:10Z'}},
      rows:{MREIT:{symbol:'MREIT',name:'MREIT, Inc.',asOf:'2026-10-13',close:13.56,dayChangePct:0.15,low52:13.2,high52:14.48}},
      news:[{symbol:'BDO',company:'BDO Unibank',label:'Quarterly or annual report',template:'Quarterly Report',at:'2026-10-06T12:56',edgeNo:'e1'},
        {symbol:'URC',company:'Universal Robina',label:'Share buyback',at:'2026-10-07T09:00',edgeNo:'e2'}],alerts:[]},
    paper:{picks:[{id:'p1',pick:{symbol:'ICT',approach:'quality',horizon:60,thesis:'Profit up 22% this year',invalidation:'Closes below 751.40',recordedDay:'2026-10-13',observedClose:884,observedDate:'2026-10-12'},
      outcome:{status:'tracking',entryDate:'2026-10-14',entryPrice:814.5,asOf:'2026-10-15',markPrice:820.5,sessions:1,netPriceReturn:-0.07,benchmarkPriceReturn:0.54,netExcessReturn:-0.6,maxCloseDrawdown:0,caveat:'Price-only paper return.'}}]}};
  const rows=byId(Life.records({today:TODAY,now:NOW,pse})),o=rows['pse:overview'];
  const has=(text,part,message)=>assert.ok(text.includes(part),(message ? message+': ' : '')+text);
  assert.equal(rows['pse:watch:bdo'].title,'PSE watchlist: BDO Unibank (BDO)');assert.equal(rows['pse:watch:bdo'].page,'pse');
  assert.equal(rows['pse:watch:bdo'].detail,'close PHP 113.50 on Tue 13 Oct (+1.34% on the day) · 1 week +2.25%, 1 month −1.99%, 3 months −10.49%, this year −15.68% · 52-week range PHP 109.20–144.60, 21.51% below the high · dividend yield over 12 months 3.88% · your buy-below PHP 110.00: PHP 3.50 above it');
  assert.equal(rows['pse:watch:mreit'].detail,'close PHP 13.56 on Tue 13 Oct (+0.15% on the day) · 52-week range PHP 13.20–14.48','a stock outside the PSEi reads from the watchlist rows');
  assert.equal(rows['pse:watch:new'].detail,'no completed close on record yet');
  assert.equal(rows['pse:news:e1'].title,'BDO: Quarterly or annual report');assert.ok(!rows['pse:news:e2'],'a notice for a stock he does not watch is left out');
  const pick=rows['pse:paper:p1'];
  assert.equal(pick.title,'Paper pick: ICT (quality, 60 trading days)');
  assert.equal(pick.detail,'recorded Tue 13 Oct when the last close was PHP 884.00 (Mon 12 Oct) · open, tracking · entered Wed 14 Oct at PHP 814.50 · marked PHP 820.50 on Thu 15 Oct after 1 session · net −0.07% after assumed costs, PSE30 +0.54%, 0.60 points behind it');
  has(pick.body,'Your thesis: Profit up 22% this year.');has(pick.body,'Caveat: Price-only paper return.');
  assert.equal(o.detail,'3 on your watchlist; 1 paper pick; closes as of Tue 13 Oct.');
  has(o.body,'not live prices');has(o.body,'Notice for BDO: Quarterly or annual report, filed Tue 6 Oct.');
  assert.deepEqual(Life.records({today:TODAY,now:NOW}).filter((r)=>r.source==='PSE'),[],'no PSE documents, no PSE records');
});

// His health (17 Oct 2026): Apple Health days, the check-up schedule from his
// Health basics, this week's check-in answers and this week's research.
test('health: Apple Health days and 7-day averages, check-ups due, check-in answers and research; plain when nothing has arrived',()=>{
  const health={
    apple:{days:{'2026-10-14':{steps:8000,sleepMin:400,sleepKind:'inBed',bed:'23:00',wake:'05:40',restingHr:60},
      '2026-10-13':{steps:6000,distanceKm:4.2,sleepMin:430,sleepKind:'asleep',weightKg:78.24,restingHr:63},
      '2026-10-12':{steps:10001},'2026-09-01':{steps:20000}}},
    basics:{birthYear:1980,include:'male',last:{bp:'2024-01'}},
    lifestyle:{days:{'2026-10-13':{alcohol:'0'},'2026-10-14':{alcohol:'0'}}},
    research:{weeks:{'2026-10-12':{items:[{headline:'Walking after meals and blood sugar',evidence:'randomised trial',shows:'cause',published:'2026-10-01',url:'https://example.org/a',
      finding:'Ten minutes of walking lowered the rise',forYou:'You walk most days',try:'Walk after dinner'}]}}}};
  const rows=byId(Life.records({today:TODAY,now:NOW,health})),o=rows['health:overview'];
  const has=(text,part,message)=>assert.ok(text.includes(part),(message ? message+': ' : '')+text);
  assert.equal(rows['health:day:2026-10-14'].detail,'8,000 steps · in bed 6h40 (23:00 to 05:40) · resting heart rate 60');
  assert.equal(rows['health:day:2026-10-13'].detail,'6,000 steps · 4.2 km · slept 7h10 · weight 78.2 kg · resting heart rate 63');
  assert.equal(rows['health:day:2026-10-14'].page,'about');
  assert.ok(!rows['health:day:2026-09-01'],'only the last two weeks');
  // (8,000 + 6,000 + 10,001) / 3 = 8,000.3; (400 + 430) / 2 = 415 min; (60 + 63) / 2 = 61.5.
  has(o.body,'Apple Health, last 7 days to Wed 14 Oct: 3 of the last 7 days have readings; steps average 8,000 a day over 3 days; sleep average 6h55 a night over 2 nights');
  has(o.body,'resting heart rate average 62; latest weight 78.2 kg on Tue 13 Oct.');
  has(o.body,'Check-ups due: Blood pressure check (overdue; Last done Jan 2024; every 2 years; RACGP Red Book).');
  has(o.body,"This week's check-in answers: Drinks: None on 2 days.");
  const r=rows['health:research:https-example-org-a'];
  assert.equal(r.title,'Health research: Walking after meals and blood sugar');assert.equal(r.detail,'randomised trial · shows cause · published Thu 1 Oct');
  assert.equal(r.body,'Ten minutes of walking lowered the rise. For you: You walk most days. Try: Walk after dinner.');
  assert.equal(o.detail,'3 days of Apple Health readings in the last two weeks; 1 check-up due.');
  const none=byId(Life.records({today:TODAY,now:NOW,health:{apple:null,basics:null,lifestyle:null,research:null}}))['health:overview'];
  assert.equal(none.body,'No Apple Health readings have arrived yet; the Shortcut is set up on About you. Health basics are not filled in on About you, so no check-up schedule is worked out.');
  assert.equal(none.detail,'No Apple Health readings yet; 0 check-ups due.');
});

// His Scout tab (18 Oct 2026): the work calendar read from the organisers'
// listings, what he chose on Scout, and his CIA CPE log, with a CPE entry's
// state from ScoutCore.cpeEntry and the year from cpeSummary.
test('scout: work calendar in PHT, his choices, CPE log states and the CIA year; a month record each; nothing without documents',()=>{
  const S=globalThis.ScoutCore;
  const iia={source:'iia-webinars',organizer:'IIA',title:'Ethical Culture Starts With Us',url:'https://www.theiia.org/en/ethics',start:'2026-12-10',end:'2026-12-10',time:'12:00',endTime:'13:00',zone:'EST',format:'online',location:'Online',cpeHours:1,cpd:'IIA CPE 1 hour',cost:''};
  const anziif={source:'anziif-webinars',organizer:'ANZIIF',title:'Thursday Thought-Leaders: Claims inflation',url:'https://anziif.com/w1',start:'2026-11-12',end:'2026-11-12',time:'12:00',endTime:'13:00',zone:'AEDT',format:'online',location:'Online',cpd:'1 CIP point',cost:''};
  const lunch={source:'aicla',organizer:'AICLA',title:'QLD Luncheon',url:'https://aicla.org/e1',start:'2026-11-13',end:'2026-11-13',time:'12:00',zone:'AEST',format:'in-person',location:'Brisbane',cost:'A$170.00'};
  const hiddenOne={source:'aicla',organizer:'AICLA',title:'Hidden drinks',url:'https://aicla.org/e2',start:'2026-11-20',end:'2026-11-20',format:'in-person',location:'Perth'};
  const past={source:'anziif-webinars',organizer:'ANZIIF',title:'Ended webinar',url:'https://anziif.com/w0',start:'2026-10-08',end:'2026-10-08',time:'12:00',zone:'AEDT',format:'online',location:'Online'};
  const id=(v)=>S.calendarId(v),items={};[iia,anziif,lunch,hiddenOne,past].forEach((v)=>{items[id(v)]=Object.assign({},v,{id:id(v),firstSeen:'2026-10-01'});});
  const calendar={startedOn:'2026-10-01',items,refreshedAt:'2026-10-13T21:40:00Z',
    sources:[{id:'iia-webinars',label:'IIA webinars',ok:true},{id:'anziif-webinars',label:'ANZIIF webinars',ok:true},{id:'aicla',label:'AICLA events',ok:false}]};
  const meetup=S.restore([{title:'Manila Claims Meetup',lane:'people',kind:'community',url:'https://example.org/meetup',nextActive:'2026-11-03',organizer:'Claims PH',why:'Meets monthly on claims'}])[0];
  const choices={[meetup.id]:{item:meetup,saved:true,note:'Meet the organiser'},[id(anziif)]:{item:S.calendarItem(anziif),interested:true},[id(hiddenOne)]:{item:S.calendarItem(hiddenOne),hidden:true}};
  // Two taps from the first tracker (no status: future, so planned; the ANZIIF one
  // reads 0 hours), one attended awaiting credit, one confirmed.
  const cpe={years:{'2026':{start:10,ethics:1}},entries:{
    [id(anziif)]:{title:anziif.title,url:anziif.url,date:'2026-11-12',hours:1,ethics:false,organizer:'ANZIIF',iia:false},
    [id(iia)]:{title:iia.title,url:iia.url,date:'2026-12-10',hours:1,ethics:true,organizer:'IIA',iia:true},
    'c-old':{title:'Fraud webinar',url:'https://www.theiia.org/en/fraud',date:'2026-10-07',status:'attended',hours:1.5,ethics:false,eligible:false,organizer:'IIA',iia:true},
    'c-done':{title:'Risk basics',url:'https://www.theiia.org/en/risk',date:'2026-10-05',status:'confirmed',hours:2,ethics:true,eligible:true,organizer:'IIA',iia:true,confirmedAt:'2026-10-06T03:00:00Z'}}};
  const rows=byId(Life.records({today:TODAY,now:NOW,scout:{choices,calendar,cpe,latest:null}})),o=rows['scout:overview'];
  const has=(text,part)=>assert.ok(text.includes(part),text);
  // An overnight IIA webinar is on the next day in Manila, with the organiser's time and date beside it.
  assert.equal(rows['scout:cal:'+id(iia)].detail,'Fri 11 Dec, 01:00–02:00 PHT (12:00 EST on Thu 10 Dec) · IIA · Online · CIA CPE: 1 hour · Cost not listed · in your CPE log: planned (you tapped Going): after the session, confirm attendance, then credit');
  assert.equal(rows['scout:cal:'+id(iia)].meta,'Scout · work calendar · IIA webinars · December 2026');
  assert.equal(rows['scout:cal:'+id(iia)].page,'scout');assert.equal(rows['scout:cal:'+id(iia)].ref,id(iia));
  has(rows['scout:cal:'+id(anziif)].detail,'Thu 12 Nov, 09:00–10:00 PHT (12:00 AEDT) · ANZIIF · Online · ANZIIF CIP: 1 point (not your CPD) · Cost not listed · on your work: claims inflation · you marked it Interested');
  has(rows['scout:cal:'+id(lunch)].detail,'Fri 13 Nov, 10:00 PHT (12:00 AEST) · AICLA · In person · A$170.00');
  assert.ok(!rows['scout:cal:'+id(hiddenOne)] && !rows['scout:cal:'+id(past)],'hidden and ended events are not listed');
  assert.equal(rows['scout:pick:'+meetup.id].detail,'you saved it · your note: Meet the organiser. · a community, next meets Tue 3 Nov · Claims PH · Location not listed · Cost not listed');
  assert.equal(rows['scout:pick:'+meetup.id].body,'Scout\'s reason (AI-written): Meets monthly on claims.');
  // The CPE log: an older entry on the organiser's date points at the live session in Manila.
  assert.equal(rows['scout:cpe:'+id(iia)].detail,'Thu 10 Dec · planned (you tapped Going): after the session, confirm attendance, then credit · 1 hour of published IIA CPE, not counted until credit is confirmed · ethics session · IIA · live session: Fri 11 Dec, 01:00–02:00 PHT (12:00 EST on Thu 10 Dec)');
  has(rows['scout:cpe:'+id(anziif)].detail,'no CIA hours: ANZIIF points are not CIA CPE');
  has(rows['scout:cpe:c-old'].detail,'Wed 7 Oct · attended, credit not yet confirmed: enter actual hours, confirm CIA eligibility, then confirm credit · 1.5 hours of published IIA CPE, not counted until credit is confirmed');
  has(rows['scout:cpe:c-done'].detail,'Mon 5 Oct · credit confirmed on Tue 6 Oct · 2 hours of CIA CPE credited · ethics session');
  assert.equal(rows['scout:cpe:c-old'].ref,'cpe:c-old');
  // The year as the CPE card works it out: 10 starting + 2 confirmed = 12; ethics 1 + 2 = 3; planned 0 + 1 = 1 hour; 78 days to 31 Dec.
  has(o.body,'CIA CPE 2026 (your CPE log on Scout; the CIA needs 40 hours a calendar year, 2 on ethics, by 31 December): 12 of 40 hours earned, 3 of 2 on ethics; 78 days to 31 December. Earned includes the 10 hours (1 on ethics) you had before logging here.');
  has(o.body,'Planned, you tapped Going (2 sessions, 1 hour of published CPE, 1 on ethics): "Thursday Thought-Leaders: Claims inflation" (Thu 12 Nov, 09:00–10:00 PHT; no CIA hours: ANZIIF points are not CIA CPE); "Ethical Culture Starts With Us" (Fri 11 Dec, 01:00–02:00 PHT; 1 hour of published CPE; ethics).');
  has(o.body,'Waiting on attendance or credit confirmation (1): "Fraud webinar" (Wed 7 Oct; attended, credit not yet confirmed: enter actual hours, confirm CIA eligibility, then confirm credit).');
  has(o.body,'Credit confirmed (1): "Risk basics" (Mon 5 Oct; 2 hours of published CPE; ethics).');
  has(o.body,'On Scout you saved 1: "Manila Claims Meetup" (a community, Claims PH); marked Interested: "Thursday Thought-Leaders: Claims inflation" (Thu 12 Nov, ANZIIF); asked for more like this (it steers future shortlists; not a save): none; notes or follow-ups: "Manila Claims Meetup" (a community, Claims PH).');
  has(o.body,'Work calendar, read straight from IIA webinars, ANZIIF webinars and AICLA events (last checked Wed 14 Oct, 05:40 PHT); AICLA events could not be read then, so their events are from the last good read: 2 upcoming events you can join online from Manila and 1 in person in Australia and New Zealand, to Fri 11 Dec.');
  has(o.body,'By month (each month has its own "Work calendar" record listing its events): November 2026: 1 to join online, 1 in person; December 2026: 1 to join online, 0 in person.');
  assert.equal(o.detail,'2 upcoming events to join online; 2 CPE sessions planned; 1 waiting on attendance or credit confirmation; 1 saved.');
  assert.equal(o.saved,'');assert.equal(o.rank,1000);
  const nov=rows['scout:month:2026-11'];
  assert.equal(nov.title,'Work calendar, November 2026: webinars and events to join online from Manila, and in person');
  assert.equal(nov.body,'To join online (times PHT): Thu 12 Nov, 09:00–10:00 PHT (12:00 AEDT), ANZIIF, "Thursday Thought-Leaders: Claims inflation", ANZIIF CIP: 1 point (not your CPD), you tapped Going, Interested. In person: Fri 13 Nov, AICLA, "QLD Luncheon".');
  assert.equal(nov.saved,'','a month record is undated, so a lookup bounded to the month keeps it');
  assert.ok(!rows['scout:month:2026-10'],'no month without events still to come');
  // With an empty log and nothing chosen, it says so rather than staying silent.
  const bare=byId(Life.records({today:TODAY,now:NOW,scout:{choices:{},calendar:null,cpe:null}}))['scout:overview'];
  has(bare.body,'0 of 40 hours earned, 0 of 2 on ethics; 78 days to 31 December. No starting hours are entered yet, so earned counts only sessions logged here with credit confirmed. Planned: none. Waiting on attendance or credit confirmation: none. On Scout you saved nothing;');
  assert.deepEqual(Life.records({today:TODAY,now:NOW}).filter((r)=>r.source==='Scout'),[],'no Scout documents, no Scout records');
});
