import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const core=readFileSync(new URL('./flights-core.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('./flights-ui.js',import.meta.url),'utf8');
const offer={id:'a'.repeat(20),kind:'advertised-fare',airline:'PAL',origin:'MNL',destination:'NRT',originName:'Manila',destinationName:'Tokyo <test>',departureDate:'2099-11-22',returnDate:'2099-11-27',tripType:'round-trip',cabin:'Economy',currency:'USD',amount:250,sourceUrl:'https://flights.philippineairlines.com/',bookingUrl:'https://flights.philippineairlines.com/',checkedAt:new Date().toISOString()};
function env(overrides={}) {
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,innerHTML:'',textContent:''});return elements.get(id);};
  const context={URL,console,Intl,Date,Map,Set,Promise,document:{getElementById:get},fbLoadFlights:async()=>({generatedAt:new Date().toISOString(),offers:[offer],sources:[{airline:'Scoot',id:'scoot-clark',url:'https://flights.flyscoot.com/en-ph/flights-from-clark',status:'unavailable',message:'Interactive page',checkedAt:new Date().toISOString()}]}),fbLoadFlightPrefs:async()=>({}),...overrides};
  context.window=context;vm.createContext(context);vm.runInContext(core,context);vm.runInContext(ui,context);return {context,get};
}
test('Flights UI renders escaped fares, safe booking links, source failures and saves only after a user action',async()=>{
  let writes=0;const {context,get}=env({fbSetSavedFlight:async(d,keep)=>{writes++;return keep?{[d.id]:d}:{};}});
  await context.renderFlights();
  const out=get('flights-out').innerHTML;assert.match(out,/<span class="flight-city-price">USD 250<\/span>/);assert.match(out,/Tokyo &lt;test&gt;/);
  assert.match(out,/All destinations · 1 city · 1 fare/);assert.match(out,/Check on airline ↗/);assert.match(out,/PHP estimate unavailable/);assert.match(get('flights-sources').innerHTML,/Unavailable to the scout/);
  assert.match(get('flights-sources').innerHTML,/0 of 1 pages readable · unavailable: Scoot/);
  assert.match(get('flights-sources').innerHTML,/No priced fares from Cebu or Clark were readable/);
  assert.equal(writes,0);
  await context.toggleFlightSave(offer.id);assert.equal(writes,1);assert.match(get('flights-out').innerHTML,/Remove saved/);
  await context.toggleFlightSave(offer.id);assert.equal(writes,2);assert.match(get('flights-out').innerHTML,/>Save<\/button>/);
});
test('shortlist read failure disables saving rather than overwriting unread account data',async()=>{
  let writes=0;const {context,get}=env({fbLoadFlightPrefs:async()=>{throw Error('offline');},fbSetSavedFlight:async()=>{writes++;}});
  await context.renderFlights();assert.match(get('flights-status').textContent,/saving is disabled/);
  assert.match(get('flights-out').innerHTML,/disabled onclick/);await context.toggleFlightSave(offer.id);assert.equal(writes,0);
});
test('account reset discards a flight load still in progress',async()=>{
  let finish;const {context,get}=env({fbLoadFlights:()=>new Promise(resolve=>finish=resolve)});
  const pending=context.renderFlights();context.resetFlights();finish({offers:[offer]});await pending;
  assert.doesNotMatch(get('flights-out').innerHTML,/Tokyo/);
});
test('saved snapshots survive disappearance from the live feed and are marked old',async()=>{
  const old={...offer,checkedAt:'2020-01-01T00:00:00Z'};
  const {context,get}=env({fbLoadFlights:async()=>({offers:[]}),fbLoadFlightPrefs:async()=>({[old.id]:old})});
  get('flights-saved-only').checked=true;await context.renderFlights();
  assert.match(get('flights-out').innerHTML,/Old quote/);assert.match(get('flights-out').innerHTML,/Remove saved/);
});
test('Flights shows PHP estimates beside original fares and tolerates FX read failures',async()=>{
  const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const {context,get}=env({fbLoadPh:async()=>({asOf,fx:{usdphp:{level:58.42}}})});
  await context.renderFlights();
  assert.match(get('flights-out').innerHTML,/<b>≈ PHP 14,605<\/b><div class="flights-note">USD 250 from<\/div>/);
  assert.match(get('flights-assistant').innerHTML,/<div class="flight-price">USD 250 from · ≈ PHP 14,605<\/div>/);
  assert.match(get('flights-assistant').innerHTML,/<details[^>]*><summary>Fare details &amp; restrictions<\/summary><p><b>PHP estimate:<\/b>/);
  assert.match(get('flights-assistant').innerHTML,/1 USD = PHP 58.42/);
  assert.match(get('flights-assistant').innerHTML,/PH market rate as of/);
  context.fbLoadPh=async()=>{throw Error('offline');};await context.renderFlights();
  assert.match(get('flights-out').innerHTML,/<b>USD 250<\/b>/);
  assert.match(get('flights-out').innerHTML,/PHP estimate unavailable/);
  assert.doesNotMatch(get('flights-out').innerHTML,/≈ PHP/);
});
test('PHP conversion works when a browser formats en-CA dates as month/day/year',async()=>{
  const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const dateParts=Object.fromEntries(asOf.map(p=>[p.type,p.value]));
  const date=dateParts.year+'-'+dateParts.month+'-'+dateParts.day;
  const browserIntl={DateTimeFormat:function(locale,options){
    const formatter=new Intl.DateTimeFormat(locale,options);
    return {format:value=>locale==='en-CA' ? dateParts.month+'/'+dateParts.day+'/'+dateParts.year : formatter.format(value),formatToParts:value=>formatter.formatToParts(value)};
  }};
  const {context,get}=env({Intl:browserIntl,fbLoadPh:async()=>({asOf:date,fx:{usdphp:{level:62.72}}})});
  await context.renderFlights();
  assert.match(get('flights-assistant').innerHTML,/<div class="flight-price">USD 250 from · ≈ PHP 15,680<\/div>/);
});
test('seat sale cards show base fare and windows first with labelled evidence and safe airline booking',async()=>{
  const campaign={...offer,id:'b'.repeat(20),campaign:true,kind:'promo',amount:null,currency:'PHP',origin:'ANY',destination:'ANY',origins:['MNL','CEB','CRK'],title:'Cebu Pacific seat sale',airline:'Cebu Pacific',discount:'PHP 10 one-way base fare',departureDate:'',returnDate:'',bookingStart:'2099-01-01',bookingEnd:'2099-01-11',travelStart:'2099-02-01',travelEnd:'2099-06-30',publisher:'Hello Mnl · press-release fallback',evidenceUrl:'https://hellomnl.com/sale',bookingUrl:'https://www.cebupacificair.com/en-PH/seat-sale',sourceUrl:'https://www.cebupacificair.com/en-PH/seat-sale'};
  const {context,get}=env({fbLoadFlights:async()=>({offers:[offer,campaign]})});
  await context.renderFlights();const out=get('flights-out').innerHTML;
  assert.match(out,/PHP 10 one-way base fare/);assert.match(out,/Book Thu 1 Jan 2099 → Sun 11 Jan 2099/);assert.match(out,/Travel Sun 1 Feb 2099 → Tue 30 Jun 2099/);
  assert.match(out,/fees extra/);assert.match(out,/Reported announcement/);assert.match(out,/route seats not verified/);
  assert.ok(out.indexOf('Cebu Pacific seat sale')<out.indexOf('Tokyo'));
  assert.doesNotMatch(out,/ANY → ANY|lowest advertised first[\s\S]*booking deadlines first/);
  context.fbLoadFlights=async()=>({offers:[{...campaign,evidenceStatus:'unavailable'}]});
  await context.renderFlights();assert.match(get('flights-out').innerHTML,/publisher link unavailable/);
  assert.doesNotMatch(get('flights-out').innerHTML,/href="https:\/\/hellomnl.com\/sale"/);
  assert.match(get('flights-out').innerHTML,/href="https:\/\/www.cebupacificair.com\/en-PH\/seat-sale"/);
});
test('trip shortlist explains the choice, cost gaps and observed changes while the full feed collapses',async()=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const p=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  const {context,get}=env({fbLoadPh:async()=>({asOf:p.year+'-'+p.month+'-'+p.day,fx:{usdphp:{level:60}}}),fbLoadFlights:async()=>({offers:[{...offer,change:{status:'dropped',delta:-50,percent:-16.7,since:'2026-10-09'}},{...offer,id:'b'.repeat(20),amount:260,departureDate:'2099-11-23',returnDate:'2099-11-28'}]})});
  await context.renderFlights();const out=get('flights-assistant').innerHTML;
  assert.match(out,/Trips worth checking first/);assert.match(out,/Lowest observed return fare/);assert.match(out,/5 nights/);
  assert.match(out,/Still to confirm: [^<]*Baggage allowance/);assert.match(out,/Price down USD 50/);assert.match(out,/All 2 fares to Tokyo/);
  assert.match(out,/1 price drop across 1 rechecked/);assert.match(get('flights-status').textContent,/2 fares to 1 city/);
  assert.match(get('flights-out').innerHTML,/<details id="flights-all"/);
  context.showFlightAlternative('b'.repeat(20));assert.equal(get('flights-all').open,true);
  get('flights-direct').checked=true;context.renderFlightOffers();assert.match(get('flights-assistant').innerHTML,/No matching fare confirms nonstop/);
});
test('destination rows carry each airline seen-age in the scout frame, in both airline formats',async()=>{
  const {context,get}=env({fbLoadFlights:async()=>({offers:[{...offer,airlineSeen:'Seen: 3 hrs ago'},{...offer,id:'c'.repeat(20),airline:'Cathay Pacific',departureDate:'2099-11-23',returnDate:'2099-11-28',airlineSeen:'Seen 17 hours ago'}]})});
  await context.renderFlights();const out=get('flights-out').innerHTML;
  assert.match(out,/airline saw it 3 hrs before the scout/);assert.match(out,/airline saw it 17 hours before the scout/);
  assert.match(out,/PAL, Cathay Pacific · 2 fares/);
});
test('trip settings and filters are remembered per device and survive broken storage',async()=>{
  const store=new Map();const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  let {context,get}=env({localStorage});
  get('flights-cabin').options=[{value:'economy'},{value:'premium'},{value:'All'}];
  await context.renderFlights();
  get('flights-max-nights').value='6';get('flights-cabin').value='premium';get('flights-baggage').checked=true;get('flights-destination').value='Tokyo';context.renderFlightOffers();
  const saved=JSON.parse(store.get('daybook-flights-settings-v1'));
  assert.equal(saved['flights-max-nights'],'6');assert.equal(saved['flights-cabin'],'premium');assert.equal(saved['flights-baggage'],true);assert.equal(saved['flights-destination'],undefined);
  ({context,get}=env({localStorage}));
  get('flights-cabin').options=[{value:'economy'},{value:'All'}];
  await context.renderFlights();
  assert.equal(get('flights-max-nights').value,'6');assert.equal(get('flights-baggage').checked,true);assert.equal(get('flights-cabin').value,'','a removed option is not restored');
  context.resetFlightSettings();assert.equal(get('flights-max-nights').value,'10');assert.equal(get('flights-cabin').value,'economy');
  assert.match(get('flights-status').textContent,/reset to the defaults/);
  const broken={getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');},removeItem:()=>{throw Error('denied');}};
  ({context,get}=env({localStorage:broken}));await context.renderFlights();assert.match(get('flights-out').innerHTML,/Tokyo/);
  context.resetFlightSettings();
});
test('price memory marks a new low against earlier days of the same route and explains the comparison',async()=>{
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const history={firstDay:'2026-10-01',routes:{x:{key:'MNL|NRT|round-trip|Economy|USD',days:{'2026-10-01':300,'2026-10-03':280,[today]:250}}}};
  const {context,get}=env({fbLoadFlights:async()=>({asOf:today,offers:[offer]}),fbLoadFlightHistory:async()=>history,fbLoadPh:async()=>({asOf:today,fx:{usdphp:{level:60}}})});
  await context.renderFlights();let out=get('flights-out').innerHTML;
  assert.match(out,/<b class="flight-down">new low<\/b>/);
  assert.match(out,/New low for MNL → NRT: below USD 280 on Sat 3 Oct \(2 earlier scout days since Thu 1 Oct\)/);
  assert.match(get('flights-assistant').innerHTML,/New lows against earlier scouts: <button[^>]*>Tokyo &lt;test&gt; −11%<\/button>/);
  assert.match(get('flights-assistant').innerHTML,/class="flight-reason">[^<]*New low for MNL → NRT/);
  context.fbLoadFlightHistory=async()=>({firstDay:'2026-10-01',routes:{x:{key:'MNL|NRT|round-trip|Economy|USD',days:{'2026-10-02':240}}}});
  await context.renderFlights();out=get('flights-out').innerHTML;
  assert.doesNotMatch(out,/new low/);assert.match(out,/lowest seen USD 240 on Fri 2 Oct \(1 earlier scout day since Fri 2 Oct\); this fare is USD 10 above it/);
  context.fbLoadFlightHistory=async()=>{throw Error('offline');};
  await context.renderFlights();out=get('flights-out').innerHTML;
  assert.match(out,/Tokyo/);assert.doesNotMatch(out,/price memory|lowest seen|New low/i);
  context.fbLoadFlightHistory=async()=>({firstDay:today,routes:{}});
  await context.renderFlights();assert.match(get('flights-out').innerHTML,/No earlier fare recorded for MNL → NRT \(price memory since/);
});

test('every board fare keeps its source timestamp, dated FX rate and escaped restrictions',async()=>{
  const asOf=new Date().toISOString().slice(0,10);
  const {context,get}=env({fbLoadFlights:async()=>({asOf,offers:[{...offer,fees:'Tax <check>',baggage:'Bag <check>',connections:'Stops <check>',terms:'Refund <check>'}],sources:[]}),fbLoadPh:async()=>({asOf,fx:{usdphp:{level:58.42}}})});
  await context.renderFlights();
  const out=get('flights-out').innerHTML;
  assert.match(out,/Fare details &amp; restrictions/);
  assert.match(out,/Source checked:/);
  assert.match(out,/1 USD = PHP 58.42/);
  assert.ok(out.includes('PH market rate as of '+asOf));
  for(const text of ['Tax &lt;check&gt;','Bag &lt;check&gt;','Stops &lt;check&gt;','Refund &lt;check&gt;'])assert.ok(out.includes(text));
});
test('old and expired quotes below history never claim to match the low',async()=>{
  for(const expired of [false,true]) {
    const asOf='2026-10-10', old={...offer,checkedAt:'2020-01-01T00:00:00Z',...(expired?{departureDate:'2020-11-01',returnDate:'2020-11-06'}:{})};
    const {context,get}=env({fbLoadFlights:async()=>({asOf,offers:[old],sources:[]}),fbLoadFlightHistory:async()=>({firstDay:'2026-10-09',routes:{r:{key:'MNL|NRT|round-trip|Economy|USD',days:{'2026-10-09':300}}}})});
    if(expired) {context.fbLoadFlightPrefs=async()=>({[old.id]:old});get('flights-saved-only').checked=true;}
    await context.renderFlights();
    const out=get('flights-out').innerHTML;
    assert.match(out,/USD 50 below it/);
    assert.match(out,expired?/this expired quote/:/this old quote/);
    assert.doesNotMatch(out,/this fare matches it/);
    assert.doesNotMatch(out,/class="flight-down">new low/);
  }
});

test('board headings label the journey and cabin comparison group',async()=>{
 const {context,get}=env();await context.renderFlights();
 assert.match(get('flights-out').innerHTML,/Japan .*round-trip .*Economy .*from USD 250/);
 assert.doesNotMatch(get('flights-out').innerHTML,/\ufffd/);
});
