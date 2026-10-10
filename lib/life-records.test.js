import {test} from 'node:test';
import assert from 'node:assert/strict';
import './daybook-calendar-core.js';
import './flights-core.js';
import './weekly-review-core.js';
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
const all=()=>Life.records({today:TODAY,now:NOW,calendar,review,poker,flights});

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
  assert.match(o.body,/Sat 19 Dec – Sun 27 Dec \(December 2026\): 9 days off for 4 leave days, includes Christmas Day, back at work Mon 28 Dec/);
  assert.match(o.body,/Leave booked from today: 4 weekdays \(Mon 21 Dec – Thu 24 Dec\)/);
  assert.match(o.body,/Next 8 weeks: Thu 8 Oct – Mon 19 Oct APPT Championship Manila - Strategy \(Poker plan\); Thu 15 Oct QBE file review \(Meeting\); Tue 20 Oct Dentist \(Personal\)/);
  assert.match(o.body,/your own Daybook events \(1\), meetings matched to your accounts from your linked calendars \(1\), and all-day entries .* \(3\)/);
  assert.match(o.body,/not necessarily free/);
  assert.match(o.detail,/next time off Sat 19 Dec – Sun 27 Dec \(9 days for 4 leave days\)/);
});

test('commitments: this week in focus order with ticks so far, last week with its results',()=>{
  const rows=byId(all()),o=rows['commitments:overview'];
  assert.match(o.body,/^Your focus order \(as you set it\): money, then work, then health, then poker\./);
  assert.match(o.body,/This week \(Mon 12 Oct – Sun 18 Oct\): Money: Log every money move in Decisions — ticked on 2 of 3 days so far, including today; Health: Walk 30 minutes \(measure: four days\) — ticked on 1 of 3 days so far, not yet today\./);
  assert.match(o.body,/Last week: Work: Submit two reports — ticked on 2 of 7 days, you marked it done\. Your reflection: Good week\./);
  assert.match(o.body,/Weeks with commitments: 2 since Mon 5 Oct, 1 reviewed; results you marked: 1 done, 0 partly, 0 missed\./);
  assert.doesNotMatch(o.body,/Due now/,'mid-week with this week set and last week reviewed');
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
  assert.match(o.body,/by month: Oct 2026 1 \(PHP 300\), Nov 2026 2 \(PHP 33,722\)/);
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
  assert.deepEqual(Life.OVERVIEW_IDS,['calendar:overview','commitments:overview','poker:overview','flights:overview']);
});
