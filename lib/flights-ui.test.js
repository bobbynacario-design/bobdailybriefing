import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const core=readFileSync(new URL('./flights-core.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('./flights-ui.js',import.meta.url),'utf8');
const offer={id:'a'.repeat(20),kind:'advertised-fare',airline:'PAL',origin:'MNL',destination:'NRT',originName:'Manila',destinationName:'Tokyo <test>',departureDate:'2099-11-22',returnDate:'2099-11-27',tripType:'round-trip',cabin:'Economy',currency:'USD',amount:250,sourceUrl:'https://flights.philippineairlines.com/',bookingUrl:'https://flights.philippineairlines.com/',checkedAt:new Date().toISOString()};
test('local hotels show without airfare and exclude expired and stale stays',async()=>{
  const hotel={key:'g298573-d1',name:'Manila <hotel>',rating:4.5,reviews:500,typicalMin:100,typicalMax:200};
  const stay={checkIn:'2099-11-22',checkOut:'2099-11-24',kind:'weekend',pricedAt:new Date().toISOString(),quotes:[{key:hotel.key,checked:true,rates:[{site:'Agoda',rate:80}]}]};
  const hotels={currency:'USD',adults:2,cities:[{city:'Manila',market:'staycation',airports:['MNL'],hotels:[hotel],stays:[stay]},
    {city:'Cebu',market:'domestic',airports:['CEB'],hotels:[hotel],stays:[{...stay,pricedAt:'2020-01-01T00:00:00Z'},{...stay,checkIn:'2020-01-01',checkOut:'2020-01-03'}]}]};
  const {context,get}=env({fbLoadFlights:async()=>({offers:[]}),fbLoadHotels:async()=>hotels});
  await context.renderFlights();const html=get('flights-assistant').innerHTML;
  assert.match(html,/Domestic hotel deals/);assert.match(html,/Manila staycation deals/);
  assert.match(html,/Manila &lt;hotel&gt;/);assert.match(html,/20% below typical/);
  assert.match(html,/transport excluded/);assert.match(html,/Old quotes — recheck/);
  assert.doesNotMatch(html,/Flight \+ hotel/);
  assert.equal((html.match(/class="deal-card"/g)||[]).length,1);
});
function env(overrides={}) {
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,innerHTML:'',textContent:''});return elements.get(id);};
  const context={URL,console,Intl,Date,Map,Set,Promise,document:{getElementById:get},fbLoadFlights:async()=>({generatedAt:new Date().toISOString(),offers:[offer],sources:[{airline:'Scoot',id:'scoot-clark',url:'https://flights.flyscoot.com/en-ph/flights-from-clark',status:'unavailable',message:'Interactive page',checkedAt:new Date().toISOString()}]}),fbLoadFlightPrefs:async()=>({}),...overrides};
  context.window=context;vm.createContext(context);vm.runInContext(core,context);vm.runInContext(ui,context);return {context,get};
}
test('preference suggestions preserve custom notes, suppress duplicate additions and never call AI',()=>{
  let calls=0;const {context,get}=env({fbTripActivities:async()=>{calls++;}}),note=get('activity-interests');note.value='Travelling with my partner.';
  const choice={value:'food'};context.addTripPreference('want',choice);assert.equal(choice.value,'');assert.match(note.value,/Travelling with my partner\.\nI want local food/);
  const once=note.value;context.addTripPreference('want',{value:'food'});assert.equal(note.value,once);
  context.addTripPreference('avoid',{value:'drives'});assert.match(note.value,/Avoid long drives/);assert.equal(calls,0);
  note.value='x'.repeat(490);context.addTripPreference('want',{value:'quiet'});assert.equal(note.value.length,490);assert.match(get('activity-status').textContent,/note is full/);
  assert.doesNotThrow(()=>context.addTripPreference('want',{value:'constructor'}));
});
test('activity buttons carry exact stay dates; opening is free and stale account results are discarded',async()=>{
  const hotel={key:'g298573-d1',name:'Makati hotel',rating:4.5,reviews:500,typicalMin:100};
  const stay={checkIn:'2099-11-22',checkOut:'2099-11-24',pricedAt:new Date().toISOString(),quotes:[{key:hotel.key,checked:true,rates:[{site:'Agoda',rate:80}]}]};
  let calls=[],finish;const {context,get}=env({fbLoadFlights:async()=>({offers:[]}),fbLoadHotels:async()=>({currency:'USD',cities:[{city:'Makati',market:'staycation',airports:[],hotels:[hotel],stays:[stay]}]}),fbTripActivities:async data=>{calls.push(data);return new Promise(r=>{finish=r;});}});
  await context.renderFlights();assert.equal(calls.length,0);
  const key=get('flights-assistant').innerHTML.match(/openTripActivities\('([^']+)'\)/)[1];
  const pending=context.openTripActivities(key);assert.equal(calls.length,1);assert.equal(calls[0].loadTrip,true);assert.equal(calls[0].start,stay.checkIn);assert.equal(calls[0].base,hotel.name);assert.notEqual(calls[0].generate,true);
  context.resetFlights();finish({plan:{generatedAt:new Date().toISOString(),activities:[],context:{city:'Makati'}}});await pending;
  assert.equal(get('flights-activities').hidden,true);assert.equal(get('flights-activities').innerHTML,'');
});
test('activities require specific preferences, prevent duplicate paid clicks, and render escaped sourced results',async()=>{
  let calls=0,finish;const {context,get}=env({crypto:{randomUUID:()=> 'test-trip-request'},fbTripActivities:async()=>{calls++;return new Promise(r=>{finish=r;});}});
  const fields={city:'Manila',start:'2099-11-22',end:'2099-11-24',base:'Hotel',interests:'',pace:'balanced',budget:'1000',commitments:'',busy:'2099-11-23'};
  Object.entries(fields).forEach(([k,v])=>get('activity-'+k).value=v);
  await context.generateTripActivities(false);assert.equal(calls,0);assert.match(get('activity-status').textContent,/specific preference/);
  get('activity-interests').value='History and quiet walks, avoid malls';
  const pending=context.generateTripActivities(false);await context.generateTripActivities(false);assert.equal(calls,1);assert.equal(get('activity-fields').disabled,true);
  assert.equal(get('activity-progress').hidden,false);assert.equal(get('activity-generate').textContent,'Building your shortlist…');assert.match(get('activity-status').textContent,/no need to click again/);
  finish({quota:{limit:10,remaining:9,resetAt:'2026-10-15T16:00:00.000Z'},cached:false,plan:{context:{...fields,version:2,interests:'History and quiet walks'},generatedAt:new Date().toISOString(),activities:[{name:'Museum <test>',date:fields.start,slot:'flexible',whyFit:'History fits your interest.',tradeoff:'Check route.',check:'Check opening hours.',evidence:'Museum named by source.',url:'https://app.philippines.travel/destinations/manila'}]}});await pending;
  assert.match(get('activity-result').innerHTML,/Museum &lt;test&gt;/);assert.match(get('activity-result').innerHTML,/Route from your base ↗/);assert.equal(get('activity-fields').disabled,false);
  assert.equal(get('activity-progress').hidden,true);assert.equal(get('activity-generate').textContent,'Build my activity shortlist');assert.match(get('activity-quota').textContent,/9 of 10 activity builds remaining/);
});

test('activity build indicator clears on failure and account reset without reviving stale results',async()=>{
  let fail,finish;const {context,get}=env({crypto:{randomUUID:()=> 'progress-test'},fbTripActivities:()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject;})});
  const fill=()=>Object.entries({city:'Bangkok',start:'2099-11-22',end:'2099-11-24',base:'Test hotel',interests:'Local food and quiet walks',pace:'balanced',budget:'',commitments:'',busy:'',poker:''}).forEach(([k,v])=>get('activity-'+k).value=v);
  fill();get('activity-refresh').textContent='Improve saved shortlist · new AI call';
  let pending=context.generateTripActivities(true);assert.equal(get('activity-progress').hidden,false);assert.equal(get('activity-refresh').disabled,true);assert.equal(get('activity-refresh').textContent,'Building your shortlist…');
  fail(Object.assign(Error('Source lookup unavailable'),{details:{quota:{limit:10,remaining:7,resetAt:'2026-10-15T16:00:00.000Z'}}}));await pending;assert.match(get('activity-quota').textContent,/7 of 10 activity builds remaining/);assert.match(get('activity-quota').textContent,/Oct 16.*12:00.*PHT/);assert.equal(get('activity-progress').hidden,true);assert.equal(get('activity-fields').disabled,false);assert.equal(get('activity-refresh').textContent,'Improve saved shortlist · new AI call');assert.equal(get('activity-status').textContent,'Source lookup unavailable');
  pending=context.generateTripActivities(false);context.resetFlights();assert.equal(get('activity-progress').hidden,true);finish({plan:{}});await pending;assert.equal(get('flights-activities').hidden,true);assert.equal(get('flights-activities').innerHTML,'');assert.equal(get('activity-result').innerHTML,'');
});
test('surroundings load only on demand, use the restricted Embed endpoint and discard results after closing the trip',async()=>{
 let calls=0,finish;const {context,get}=env({DaybookMapsEmbed:{apiKey:'test-browser-key'},crypto:{randomUUID:()=> 'surroundings-test'},fbTripActivities:async()=>({cached:false,plan:{context:{city:'Taipei',base:'Test base',start:'2099-11-22',end:'2099-11-24',version:3},generatedAt:new Date().toISOString(),activities:[{name:'The Red House',role:'plan',date:'2099-11-22',slot:'flexible',whyFit:'Cultural interest',tradeoff:'Check access',check:'Confirm hours',url:'https://eng.taiwan.net.tw/'}]}}),fbActivitySurroundings:async()=>{calls++;return new Promise(r=>{finish=r;});}});
 ['city','start','end','base','interests','pace','budget','commitments','busy','poker'].forEach(k=>get('activity-'+k).value=({city:'Taipei',start:'2099-11-22',end:'2099-11-24',base:'Test base',interests:'Culture and quiet walks',pace:'balanced'})[k] || '');
 await context.generateTripActivities(false);assert.equal(calls,0);assert.doesNotMatch(get('activity-result').innerHTML,/<iframe/);const id=get('activity-result').innerHTML.match(/openActivitySurroundings\('([^']+)'\)/)[1];
 const pending=context.openActivitySurroundings(id);finish({location:{lat:25.042013,lng:121.50685,source:'Tourism Administration',sourceUrl:'https://eng.taiwan.net.tw/',matchedName:'The Red House'},pano:{id:'PANO<x>',lat:25.0419,lng:121.5066,date:'2023-05',heading:57,distance:28}});await pending;
 const html=get('activity-'+id).innerHTML;assert.equal(calls,1);assert.match(html,/strict-origin-when-cross-origin/);
 assert.match(html,/embed\/v1\/streetview\?key=test-browser-key&amp;pano=PANO%3Cx%3E&amp;heading=57&amp;pitch=0&amp;fov=80/);
 assert.match(html,/embed\/v1\/place\?key=test-browser-key&amp;q=25.042013%2C121.50685&amp;zoom=17&amp;maptype=satellite/);
 assert.match(html,/photo from May 2023 · taken about 28 m away, facing the place/);assert.match(html,/map_action=pano&amp;pano=PANO%3Cx%3E&amp;heading=57/);assert.doesNotMatch(html,/PANO<x>/);
 const stale=context.openActivitySurroundings(id);context.closeTripActivities();finish({location:null});await stale;assert.equal(get('flights-activities').hidden,true);
});
test('older saved shortlists restore preferences but require an explicit improvement call',async()=>{
  let calls=[];const {context,get}=env({fbLoadHotels:async()=>({currency:'USD',cities:[{city:'Manila',market:'staycation',airports:[],hotels:[{key:'g298573-d1',name:'Test hotel',rating:4.5,reviews:500,typicalMin:100}],stays:[{checkIn:'2099-11-22',checkOut:'2099-11-24',pricedAt:new Date().toISOString(),quotes:[{key:'g298573-d1',checked:true,rates:[{site:'Agoda',rate:80}]}]}]}]}),fbTripActivities:async data=>{calls.push(data);return {cached:true,plan:{context:{city:'Taipei',start:'2099-11-22',end:'2099-11-24',base:'Ximen',interests:'Food and historic places',pace:'balanced',version:1,busy:[]},activities:[{name:'Old remote market'}]}};}});
  await context.renderFlights();const key=get('flights-assistant').innerHTML.match(/openTripActivities\('([^']+)'\)/)[1];await context.openTripActivities(key);
  assert.equal(calls.length,1);assert.equal(calls[0].loadTrip,true);assert.match(get('activity-result').innerHTML,/earlier selection rules/);assert.doesNotMatch(get('activity-result').innerHTML,/Old remote market/);assert.match(get('activity-refresh').textContent,/Improve saved shortlist/);assert.equal(get('activity-base').value,'Ximen');
});
test('user quotes save only on submission, enter comparison without saved-only, and keep the original time across reloads',async()=>{
 let writes=0,saved={};const fields={airline:'Cebu Pacific',origin:'MNL',destination:'NRT',departureDate:'2099-11-22',returnDate:'2099-11-27',passengers:'2',total:'6000',observedAt:new Date(Date.now()+8*3600000).toISOString().slice(0,16),baggageKg:'20',taxes:'yes',stops:'0',link:''};
 const {context,get}=env({crypto:{getRandomValues:b=>b.fill(1)},fbLoadFlightPrefs:async()=>saved,fbSetSavedFlight:async(q)=>{writes++;saved={...saved,[q.id]:q};return saved;}});
 await context.renderFlights();assert.equal(writes,0);
 await context.saveFlightQuote({elements:{namedItem:name=>({value:fields[name]})}});assert.equal(writes,1);
 assert.match(get('flights-out').innerHTML,/Quote entered by you/);assert.match(get('flights-out').innerHTML,/PHP 3,000/);
 const observed=saved[Object.keys(saved)[0]].checkedAt;
 await context.renderFlights();assert.equal(writes,1);assert.equal(saved[Object.keys(saved)[0]].checkedAt,observed);
 assert.match(get('flights-out').innerHTML,/Cebu Pacific/);
 fields.total='7000';await context.saveFlightQuote({elements:{namedItem:name=>({value:fields[name]})}});assert.equal(Object.keys(saved).length,1);
});
test('partner quotes with unknown cabin remain visible separately from economy recommendations',async()=>{
 const partner={...offer,airline:'Cebu Pacific',partner:'Trip.com',cabin:'Not stated',sourceUrl:'https://ph.trip.com/flights/',bookingUrl:'https://ph.trip.com/flights/'};
 const {context,get}=env({fbLoadFlights:async()=>({offers:[partner]})});await context.renderFlights();
 assert.match(get('flights-assistant').innerHTML,/Partner fare samples/);assert.match(get('flights-assistant').innerHTML,/Published via Trip.com/);
 assert.doesNotMatch(get('flights-assistant').innerHTML,/class="flight-reason"/);
});
test('shortlists explain missing budget comparisons and show one-way budget fares separately',async()=>{
 const scoot={...offer,id:'b'.repeat(20),airline:'Scoot',tripType:'one-way',returnDate:'',sourceUrl:'https://www.flyscoot.com/flights/en-ph/flights-from-manila',bookingUrl:'https://www.flyscoot.com/'};
 const {context,get}=env({fbLoadFlights:async()=>({offers:[offer,scoot]}),fbLoadPh:async()=>({asOf:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),fx:{usdphp:{level:58}}})});
 await context.renderFlights();const html=get('flights-assistant').innerHTML;
 assert.match(html,/Budget-airline prices not compared for these exact dates: Cebu Pacific, AirAsia, Scoot/);
 assert.match(html,/Compare all airlines for these dates/);assert.match(html,/Set those dates on the official airline sites/);
 assert.match(html,/Budget-airline one-way fares · return leg not priced/);
});
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
  assert.match(get('flights-assistant').innerHTML,/<details[^>]*><summary>Fare details &amp; what to check<\/summary><div class="flight-flag">Still to confirm: [\s\S]*?<p><b>PHP estimate:<\/b>/);
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

test('domestic choices filter the board and El Nido shows an honest airline fallback',async()=>{
 const dom={...offer,id:'b'.repeat(20),destination:'MPH',destinationName:'Boracay (Caticlan)',currency:'PHP',amount:5000};
 const {context,get}=env({fbLoadFlights:async()=>({offers:[offer,dom],sources:[]})});
 await context.renderFlights();
 assert.doesNotMatch(get('flights-out').innerHTML,/Boracay/);
 get('flights-market').value='domestic';context.renderFlightOffers();
 assert.match(get('flights-out').innerHTML,/Boracay/);
 assert.doesNotMatch(get('flights-out').innerHTML,/Tokyo/);
 assert.match(get('flights-out').innerHTML,/El Nido \(ENI\): no readable advertised fare/);
 assert.match(get('flights-assistant').innerHTML,/PHP 5,000/);
 get('flights-market').value='ENI';context.renderFlightOffers();
 assert.doesNotMatch(get('flights-out').innerHTML,/Boracay/);
 assert.match(get('flights-out').innerHTML,/Check El Nido on Cebu Pacific/);
});
test('time off shows leave windows, fitting fares, exact-date searches, clashes and overseas poker trips',async()=>{
  const cal=readFileSync(new URL('./daybook-calendar-core.js',import.meta.url),'utf8');
  const fit={...offer,id:'f'.repeat(20),destination:'NRT',destinationName:'Tokyo',departureDate:'2099-12-20',returnDate:'2099-12-27',amount:300};
  const taipei={...offer,id:'e'.repeat(20),destination:'TPE',destinationName:'Taipei',departureDate:'2099-11-12',returnDate:'2099-11-16',amount:200};
  const days=[{id:'a',title:'0175 - Annual Leave',start:'2099-12-21',end:'2099-12-24',calendar:'Google'},{id:'b',title:'Christmas Day',start:'2099-12-25',end:'2099-12-25',calendar:'Google'},
    {id:'c',title:'🟡 [METRO] Metro Christmas Special',start:'2099-12-15',end:'2099-12-22',calendar:'Google'},{id:'d',title:'APT Championship Taipei',start:'2099-11-13',end:'2099-11-29',calendar:'Google'}];
  const {context,get}=env({_firebaseUid:'owner',fbLoadMeetings:async()=>({items:[],days}),fbLoadDaybookEvents:async()=>[],fbLoadFlights:async()=>({asOf:'2099-01-01',offers:[offer,fit,taipei]})});
  vm.runInContext(cal,context);
  get('flights-cabin').value='economy';await context.renderFlights();const out=get('flights-timeoff').innerHTML;
  assert.match(out,/Your time off · trips abroad/);assert.match(out,/Sat 19 Dec 2099 – Sun 27 Dec 2099/);assert.match(out,/9 days off for 4 leave days · includes Christmas Day · back at work Mon 28 Dec 2099/);
  assert.match(out,/Overlaps ♠ 🟡 \[METRO\] Metro Christmas Special/);assert.match(out,/<b>Tokyo<\/b> · Sun 20 Dec 2099 → Sun 27 Dec 2099/);
  assert.match(out,/href="https:\/\/www.google.com\/travel\/flights\?hl=en&amp;curr=PHP&amp;q=Flights%20from%20Manila%20to%20Taipei%20on%202099-12-19%20through%202099-12-27"/);
  assert.match(out,/♠ APT Championship Taipei[\s\S]*Taipei · 11 weekdays outside your time off[\s\S]*<b>Taipei<\/b> · Thu 12 Nov 2099/);
  assert.match(out,/q=Flights%20from%20Manila%20to%20Taipei%20on%202099-11-12%20through%202099-11-29/);
  context.fbLoadMeetings=async()=>{throw Error('offline');};await context.renderFlights();assert.match(get('flights-timeoff').innerHTML,/calendar could not load/);
  context.daybookMember=true;await context.renderFlights();assert.equal(get('flights-timeoff').innerHTML,'');
});
test('time off adds other-date context to peak fares and searches any typed city for the window',async()=>{
  const cal=readFileSync(new URL('./daybook-calendar-core.js',import.meta.url),'utf8');
  const peak={...offer,id:'c'.repeat(20),destination:'AXT',destinationName:'Akita',departureDate:'2099-12-25',returnDate:'2099-12-27',amount:1668};
  const cheap={...offer,id:'d'.repeat(20),destination:'AXT',destinationName:'Akita',departureDate:'2099-11-02',returnDate:'2099-11-06',amount:900};
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let opened='';
  const {context,get}=env({_firebaseUid:'owner',open:(u)=>{opened=u;},fbLoadPh:async()=>({asOf:today,fx:{usdphp:{level:60}}}),fbLoadDaybookEvents:async()=>[],
    fbLoadMeetings:async()=>({items:[],days:[{id:'a',title:'Annual Leave',start:'2099-12-21',end:'2099-12-24',calendar:'Google'},{id:'b',title:'Christmas Day',start:'2099-12-25',end:'2099-12-25',calendar:'Google'}]}),
    fbLoadFlights:async()=>({asOf:'2099-01-01',offers:[peak,cheap]})});
  vm.runInContext(cal,context);get('flights-cabin').value='economy';
  await context.renderFlights();
  assert.match(get('flights-timeoff').innerHTML,/<b>Akita<\/b> · Fri 25 Dec 2099 → Sun 27 Dec 2099 · 2 nights · ≈ PHP 100,080 · PAL · other dates from ≈ PHP 54,000/);
  assert.match(get('flights-timeoff').innerHTML,/flightsOpenSearch\(this,'2099-12-19','2099-12-27'\)/);
  get('flights-origin').value='CEB';
  const url=context.flightsOpenSearch({city:{value:'  Osaka '}},'2099-12-19','2099-12-27');
  assert.equal(url,'https://www.google.com/travel/flights?hl=en&curr=PHP&q=Flights%20from%20Cebu%20to%20Osaka%20on%202099-12-19%20through%202099-12-27');assert.equal(opened,url);
  assert.equal(context.flightsOpenSearch({city:{value:''}},'2099-12-19','2099-12-27'),'');
});
test('PokerHQ picks abroad plan a trip with leave, buy-ins and a scouted fare; skip-only festivals get a line',async()=>{
  const cal=readFileSync(new URL('./daybook-calendar-core.js',import.meta.url),'utf8');
  const taipei={...offer,id:'e'.repeat(20),destination:'TPE',destinationName:'Taipei',departureDate:'2099-11-12',returnDate:'2099-11-15',amount:270};
  const ev=(date,name,venue,status,buyin,type='side')=>({date,name,venue,status,buyin,type,url:'https://www.theasianpokertour.com/series/x/'});
  const tourneys=[ev('2099-11-13','Satellite to National Cup','Red Space, Taipei','target',6486),ev('2099-11-14','Satellite to National Cup','Red Space, Taipei','target',6486),
    ev('2099-11-18','PLO Championship','Red Space, Taipei','skip',137706),ev('2099-11-23','APT Championship Main Event - Day 1','Red Space, Taipei','skip',613008,'main'),ev('2099-11-05','WPT Seoul Inspire Championship - Day 1A','INSPIRE Entertainment Resort, Incheon','skip',82620,'main')];
  const {context,get}=env({_firebaseUid:'owner',fbLoadMeetings:async()=>({items:[],days:[]}),fbLoadDaybookEvents:async()=>[],fbLoadPokerHQTourneys:async()=>tourneys,
    fbLoadFlights:async()=>({asOf:'2099-01-01',offers:[offer,taipei]})});
  vm.runInContext(cal,context);get('flights-cabin').value='economy';
  await context.renderFlights();const out=get('flights-timeoff').innerHTML;
  assert.match(out,/♠ APT Championship Main Event<\/div>/);
  assert.match(out,/Taipei · Red Space · Fri 13 Nov 2099 – Mon 23 Nov 2099 · 4 events · buy-ins ₱6,486 – ₱613,008 · main event ₱613,008 \(Mon 23 Nov 2099\)/);
  assert.match(out,/Nothing starred in PokerHQ yet. Within your bankroll \(PokerHQ grade, as saved at import\): Satellite to National Cup \(target, Fri 13 Nov 2099, ₱6,486\); Satellite to National Cup \(target, Sat 14 Nov 2099, ₱6,486\)/);
  assert.doesNotMatch(out,/Your ★ picks/);
  assert.match(out,/Trip if you play those: Thu 12 Nov 2099 – Sun 15 Nov 2099<\/b> · 1 leave day · ₱12,972 in buy-ins · flight from USD 270 \(scouted Thu 12 Nov 2099 → Sun 15 Nov 2099 · 3 nights\)/);
  assert.match(out,/q=Flights%20from%20Manila%20to%20Taipei%20on%202099-11-12%20through%202099-11-15/);
  assert.match(out,/href="https:\/\/bobbynacario-design.github.io\/pokerhq\/"/);
  assert.match(out,/nothing starred or within your bankroll: WPT Seoul Inspire Championship · Incheon · Thu 5 Nov 2099 · main ₱82,620/);
  context.fbLoadPokerHQBankroll=async()=>({amount:30000,rule:3});
  await context.renderFlights();assert.match(get('flights-timeoff').innerHTML,/Within your bankroll \(PokerHQ grade for your bankroll\)/);
  assert.doesNotMatch(get('flights-timeoff').innerHTML,/30,000|30000/,'the bankroll amount is never shown');
  context.fbLoadPokerHQTourneys=async()=>tourneys.map(t=>t.name==='PLO Championship'?{...t,planning:true}:t);
  await context.renderFlights();const starred=get('flights-timeoff').innerHTML;
  assert.match(starred,/Your ★ picks in PokerHQ: PLO Championship \(Wed 18 Nov 2099, ₱137,706\)/);
  assert.match(starred,/Trip for your picks: Tue 17 Nov 2099 – Thu 19 Nov 2099<\/b> · 1 leave day · ₱137,706 in buy-ins · no scouted fare near these dates; Taipei from USD 270 on Thu 12 Nov 2099/);
  context.fbLoadPokerHQTourneys=async()=>{throw Object.assign(Error('denied'),{code:'permission-denied'});};
  await context.renderFlights();assert.match(get('flights-timeoff').innerHTML,/PokerHQ’s tournaments could not be read/);
});
test('a PokerHQ trip with no fare near its dates shows the nearest known fare to that city',async()=>{
  const cal=readFileSync(new URL('./daybook-calendar-core.js',import.meta.url),'utf8');
  const later={...offer,id:'e'.repeat(20),destination:'TPE',destinationName:'Taipei',departureDate:'2099-10-23',returnDate:'2099-10-30',amount:261};
  const {context,get}=env({_firebaseUid:'owner',fbLoadMeetings:async()=>({items:[],days:[]}),fbLoadDaybookEvents:async()=>[],
    fbLoadPokerHQTourneys:async()=>[{date:'2099-11-13',name:'Satellite',venue:'Red Space, Taipei',status:'target',buyin:6486,type:'side'}],fbLoadFlights:async()=>({asOf:'2099-01-01',offers:[offer,later]})});
  vm.runInContext(cal,context);get('flights-cabin').value='economy';
  await context.renderFlights();
  assert.match(get('flights-timeoff').innerHTML,/no scouted fare near these dates; Taipei from USD 261 on Fri 23 Oct 2099 → Fri 30 Oct 2099 · 7 nights/);
});
test('hotels pair with fares: city stay, flight + nights, hotel deals, and search links when no rates exist',async()=>{
  const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const hotels={currency:'USD',adults:2,generatedAt:new Date().toISOString(),cities:[{city:'Tokyo',airports:['NRT','HND','TYO'],
    hotels:[{key:'g298184-d1',name:'Gracery <b>',rating:4.1,reviews:2558,typicalMin:146,typicalMax:306,url:'https://www.tripadvisor.com/Hotel_Review-g298184-d1.html'},
      {key:'g298184-d2',name:'Budget Inn',rating:4.3,reviews:900,typicalMin:98,typicalMax:240,url:'https://www.tripadvisor.com/b',budget:true}],
    stays:[{checkIn:'2099-11-22',checkOut:'2099-11-27',nights:5,pricedAt:new Date().toISOString(),fare:{origin:'MNL'},quotes:[
      {key:'g298184-d1',checked:true,rates:[{site:'Agoda.com',rate:125},{site:'Booking.com',rate:156}]},{key:'g298184-d2',checked:true,rates:[]}]}]}]};
  const {context,get}=env({fbLoadPh:async()=>({asOf,fx:{usdphp:{level:58}}}),fbLoadHotels:async()=>hotels});
  await context.renderFlights();
  const out=get('flights-out').innerHTML, assistant=get('flights-assistant').innerHTML;
  assert.match(out,/room from ≈ PHP 7,250/);assert.match(out,/<b class="flight-down">hotel deal<\/b>/);
  assert.match(out,/<div class="flights-group">Stay · Sun 22 Nov 2099 → Fri 27 Nov 2099 · 5 nights<\/div>/);
  assert.match(out,/Flight \+ 5 nights at Gracery &lt;b&gt; ≈ PHP 50,750 for one · ≈ PHP 65,250 for two sharing/);
  assert.match(out,/≈ PHP 7,250\/night on Agoda.com · Tripadvisor typical minimum ≈ PHP 8,468 · <b class="flight-down">14% below Tripadvisor’s typical minimum<\/b>/);
  assert.match(out,/Also Booking.com ≈ PHP 9,048/);assert.match(out,/Budget Inn<\/b> · ★ 4.3 \(900 reviews\) · budget pick<br>No nightly rate listed for these dates/);
  assert.match(out,/href="https:\/\/www.google.com\/travel\/search\?hl=en&amp;gl=ph&amp;curr=PHP&amp;q=Gracery%20%3Cb%3E%2C%20Tokyo%20from%202099-11-22%20to%202099-11-27"/);
  assert.match(out,/href="https:\/\/www.tripadvisor.com\/Hotel_Review-g298184-d1.html"[^>]*>Reviews ↗/);
  assert.doesNotMatch(out,/Gracery <b>/);
  assert.match(assistant,/Stay from ≈ PHP 7,250\/night at Gracery &lt;b&gt; \(Agoda.com\)/);
  assert.match(assistant,/<div class="flights-group">Hotel deals on these fare dates · trip dates first, then estimated flight \+ stay cost<\/div><div class="deal-grid">/);
  assert.match(assistant,/<article class="deal-card"><div class="deal-head"><span class="deal-city">Tokyo<\/span><span class="deal-badge">14% below typical<\/span><\/div><div class="deal-hotel">Gracery &lt;b&gt;<\/div>/);
  assert.match(assistant,/<div class="deal-price">≈ PHP 7,250\/night<\/div><div class="flights-note">on Agoda.com · Tripadvisor typical minimum ≈ PHP 8,468<\/div><div class="deal-when">Sun 22 Nov 2099 → Fri 27 Nov 2099 · 5 nights<\/div>/);
  assert.match(assistant,/<div class="deal-total">Flight \+ hotel ≈ PHP 50,750<\/div><div class="flights-note">for one, with the PAL fare<\/div>/);
  assert.match(assistant,/View fare &amp; hotels<\/button><a href="https:\/\/www.google.com\/travel\/search[^"]*q=Gracery%20%3Cb%3E%2C%20Tokyo%20from%202099-11-22%20to%202099-11-27"/);
  assert.match(get('flights-sources').innerHTML,/Hotel rates: 1 cities/);
  // Hotels fail to load: fares keep a Google Hotels search for their dates and nothing else.
  context.fbLoadHotels=async()=>{throw Error('offline');};await context.renderFlights();
  assert.doesNotMatch(get('flights-out').innerHTML,/Stay ·|room from/);
  assert.match(get('flights-out').innerHTML,/q=Hotels%20in%20Tokyo%20%3Ctest%3E%20from%202099-11-22%20to%202099-11-27"[^>]*>Hotels for these dates ↗/);
  assert.doesNotMatch(get('flights-assistant').innerHTML,/Hotel deals/);
});
test('time off and poker trips get Google Hotels searches for their dates and the city’s usual room rate',async()=>{
  const cal=readFileSync(new URL('./daybook-calendar-core.js',import.meta.url),'utf8');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const fit={...offer,id:'f'.repeat(20),destination:'NRT',destinationName:'Tokyo',departureDate:'2099-12-20',returnDate:'2099-12-27',amount:300};
  const hotels={currency:'USD',adults:2,cities:[{city:'Tokyo',airports:['NRT'],hotels:[{key:'g1-d1',name:'Tokyo Inn',rating:4.2,reviews:500,typicalMin:100,typicalMax:200}],
    stays:[{checkIn:'2099-12-20',checkOut:'2099-12-27',nights:7,pricedAt:new Date().toISOString(),quotes:[{key:'g1-d1',checked:true,rates:[{site:'Agoda.com',rate:90}]}]}]},
    {city:'Taipei',airports:['TPE'],hotels:[{key:'g2-d1',name:'Taipei Inn',rating:4.5,reviews:900,typicalMin:50,typicalMax:120}],stays:[]}]};
  const {context,get}=env({_firebaseUid:'owner',fbLoadPh:async()=>({asOf:today,fx:{usdphp:{level:60}}}),fbLoadHotels:async()=>hotels,fbLoadDaybookEvents:async()=>[],
    fbLoadMeetings:async()=>({items:[],days:[{id:'a',title:'Annual Leave',start:'2099-12-21',end:'2099-12-24',calendar:'Google'},{id:'b',title:'Christmas Day',start:'2099-12-25',end:'2099-12-25',calendar:'Google'}]}),
    fbLoadPokerHQTourneys:async()=>[{date:'2099-11-13',name:'Satellite',venue:'Red Space, Taipei',status:'target',buyin:6486,type:'side'}],
    fbLoadFlights:async()=>({asOf:'2099-01-01',offers:[fit]})});
  vm.runInContext(cal,context);get('flights-cabin').value='economy';
  await context.renderFlights();const out=get('flights-timeoff').innerHTML;
  assert.match(out,/<b>Tokyo<\/b> · Sun 20 Dec 2099 → Sun 27 Dec 2099[^<]*<a[^>]*>airline ↗<\/a><br><span class="flights-note">Room from ≈ ₱5,400\/night at Tokyo Inn \(Agoda.com\), 10% below Tripadvisor’s typical minimum<\/span>/);
  assert.match(out,/Hotels for the same dates, every booking site:<\/div><div class="timeoff-links"><a class="tool-chip" href="https:\/\/www.google.com\/travel\/search\?hl=en&amp;gl=ph&amp;curr=PHP&amp;q=Hotels%20in%20Tokyo%20from%202099-12-19%20to%202099-12-27"[^>]*>Tokyo hotels ↗/);
  assert.match(out,/Hotels in Taipei usually from ≈ ₱3,000 a night, about ₱6,000 for 2 nights \(Tripadvisor typical lowest rates\) · hotels for these 2 nights are priced by the next scout/);
  assert.match(out,/q=Hotels%20near%20Red%20Space%2C%20Taipei%20from%202099-11-12%20to%202099-11-14"[^>]*>Hotels near the venue ↗/);
  context.fbLoadHotels=async()=>null;await context.renderFlights();
  assert.doesNotMatch(get('flights-timeoff').innerHTML,/usually from|Room from/);
  assert.match(get('flights-timeoff').innerHTML,/Tokyo hotels ↗/,'search links need no scouted rates');
});
test('your leave and poker trips are saved once for pricing, then show their hotels, the venue first',async()=>{
  const cal=readFileSync(new URL('./daybook-calendar-core.js',import.meta.url),'utf8');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const fit={...offer,id:'f'.repeat(20),destination:'NRT',destinationName:'Tokyo',departureDate:'2099-12-20',returnDate:'2099-12-27',amount:300};
  const hotels={currency:'USD',adults:2,cities:[{city:'Tokyo',airports:['NRT'],hotels:[{key:'g1-d1',name:'Tokyo Inn',rating:4.2,reviews:500,typicalMin:100,typicalMax:200}],stays:[]},
    {city:'Incheon',airports:['ICN'],hotels:[{key:'g2-d1',name:'Grand Hyatt Incheon',rating:4.3,reviews:5162,typicalMin:170,typicalMax:327}],stays:[]}]};
  const pokerId='poker|Incheon|2099-11-04|2099-11-06', breakId='leave|Tokyo|2099-12-19|2099-12-27';
  const stays={uid:'owner',currency:'USD',adults:2,trips:[
    {id:pokerId,kind:'poker',city:'Incheon',checkIn:'2099-11-04',checkOut:'2099-11-06',nights:2,pricedAt:new Date().toISOString(),venue:'INSPIRE Entertainment Resort',venueFound:true,
      hotels:[{key:'g2-d9',name:'INSPIRE Entertainment Resort',rating:4.5,reviews:118,typicalMin:210,typicalMax:521,venue:true},{key:'g2-d1',name:'Grand Hyatt Incheon',rating:4.3,reviews:5162,typicalMin:170,typicalMax:327}],
      quotes:[{key:'g2-d9',checked:true,rates:[{site:'Trip.com',rate:231}]},{key:'g2-d1',checked:true,rates:[{site:'Hyatt.com',rate:180}]}]}]};
  const saves=[];let timer=null;
  const {context,get}=env({_firebaseUid:'owner',fbLoadPh:async()=>({asOf:today,fx:{usdphp:{level:60}}}),fbLoadHotels:async()=>hotels,fbLoadDaybookEvents:async()=>[],
    fbLoadHotelTrips:async()=>null,fbLoadHotelStays:async()=>stays,fbSaveHotelTrips:async t=>{saves.push(t);},
    setTimeout:(fn)=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;},
    fbLoadMeetings:async()=>({items:[],days:[{id:'a',title:'Annual Leave',start:'2099-12-21',end:'2099-12-24',calendar:'Google'},{id:'b',title:'Christmas Day',start:'2099-12-25',end:'2099-12-25',calendar:'Google'}]}),
    fbLoadPokerHQTourneys:async()=>[{date:'2099-11-05',name:'WPT Main Event',venue:'INSPIRE Entertainment Resort, Incheon',status:'target',buyin:82620,type:'main',planning:true}],
    fbLoadFlights:async()=>({asOf:'2099-01-01',offers:[fit]})});
  vm.runInContext(cal,context);get('flights-cabin').value='economy';
  await context.renderFlights();const out=get('flights-timeoff').innerHTML;
  assert.match(out,/At the venue: INSPIRE Entertainment Resort ≈ PHP 13,860\/night \(Trip.com\), ≈ PHP 27,720 for 2 nights<br>or Grand Hyatt Incheon ≈ PHP 10,800\/night \(Hyatt.com\), ≈ PHP 21,600 for 2 nights/);
  assert.match(out,/All 2 hotels for Wed 4 Nov 2099 → Fri 6 Nov 2099 · 2 nights<\/summary>[\s\S]*INSPIRE Entertainment Resort<\/b> · ★ 4.5 \(118 reviews\) · the venue/);
  assert.match(out,/Hotels for the whole break, 8 nights:<\/div><div class="timeoff-stay"><b>Tokyo<\/b>[\s\S]*?<div class="flights-note">Hotels in Tokyo usually from ≈ ₱6,000 a night[^<]*priced by the next scout/);
  assert.equal(saves.length,0,'nothing is saved until the filters settle');
  timer();await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0].map(t=>[t.id,t.kind,t.venue || '']))),[[pokerId,'poker','INSPIRE Entertainment Resort'],[breakId,'leave',''],['leave-fare|Tokyo|2099-12-20|2099-12-27','leave-fare','']]);
  await Promise.resolve();timer=null;
  context.renderFlightOffers();assert.equal(timer,null,'unchanged trips are not saved again');
  // A failed read of the saved trips never writes.
  context.fbLoadHotelTrips=async()=>{throw Error('offline');};await context.renderFlights();timer=null;context.renderFlightOffers();assert.equal(timer,null);
});

test('an edited fare stay saves exact settings, survives reload and waits for matching occupancy',async()=>{
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const hotel={key:'g1-d1',name:'Tokyo Inn',rating:4.2,reviews:500,typicalMin:100,typicalMax:200};
  const hotels={currency:'USD',adults:2,cities:[{city:'Tokyo',airports:['NRT'],hotels:[hotel],stays:[]}]};
  let saved=null,timer=null,priced=null;
  const {context,get}=env({_firebaseUid:'owner',fbLoadMeetings:async()=>({items:[],days:[]}),fbLoadPh:async()=>({asOf:today,fx:{usdphp:{level:60}}}),fbLoadHotels:async()=>hotels,
    fbLoadHotelTrips:async()=>saved,fbLoadHotelStays:async()=>priced,fbSaveHotelTrips:async trips=>{saved={trips:JSON.parse(JSON.stringify(trips))};},
    setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;}});
  await context.renderFlights();assert.match(get('flights-out').innerHTML,/Edit hotel dates &amp; guests/);
  const id='stay|'+offer.id;
  const fields={checkIn:'2099-11-23',checkOut:'2099-11-27',rooms:'2',adults:'4'};
  await context.saveHotelStay({elements:{namedItem:n=>({value:fields[n]})}},id);
  assert.equal(timer,null,'explicit requests save immediately');
  assert.equal(saved.trips.length,1);assert.deepEqual(saved.trips[0],{rooms:2,adults:4,id,kind:'custom',label:'Hotel stay',city:'Tokyo',airports:['NRT'],checkIn:'2099-11-23',checkOut:'2099-11-27',nights:4,edited:true});
  // A cached quote for two adults must never satisfy the edited request.
  const base={...saved.trips[0],pricedAt:new Date().toISOString(),hotels:[hotel],quotes:[{key:hotel.key,checked:true,rates:[{site:'Site',rate:100}]}]};
  priced={currency:'USD',trips:[{...base,rooms:1,adults:2}]};
  await context.renderFlights();assert.doesNotMatch(get('flights-out').innerHTML,/PHP 6,000\/night/);assert.match(get('flights-out').innerHTML,/4 adults/);
  priced={currency:'USD',trips:[base]};
  await context.renderFlights();assert.match(get('flights-out').innerHTML,/PHP 48,000 for 4 nights/,'four nights times two rooms');
  assert.match(get('flights-out').innerHTML,/2 rooms, 4 adults, checked/);
  // Google ignores guests in the link, so the page names what to set there.
  assert.doesNotMatch(get('flights-out').innerHTML,/adults%20in/);assert.match(get('flights-out').innerHTML,/<\/a><span class="flights-note"> \(set 2 rooms, 4 adults there\)<\/span>/);
  // The edited stay shows once, with one form, not again under its fare.
  assert.equal(get('flights-out').innerHTML.split('Edit hotel dates &amp; guests').length-1,1);
  assert.equal(get('flights-out').innerHTML.split('2099-11-23').length>1,true);
  context.resetHotelStay(id);timer();await Promise.resolve();assert.equal(saved.trips.length,0);
  // An edited stay on a fare that leaves the scout is dropped, not priced unseen;
  // a failed scout read keeps it.
  await context.saveHotelStay({elements:{namedItem:n=>({value:fields[n]})}},id);assert.equal(saved.trips.length,1);
  context.fbLoadFlights=async()=>{throw Error('offline');};await context.renderFlights();timer=null;context.renderFlightOffers();assert.equal(timer,null,'nothing to save while the scout is unreadable');
  context.fbLoadFlights=async()=>({offers:[{...offer,id:'c'.repeat(20)}]});await context.renderFlights();
  assert.ok(timer,'the pruned list is saved');timer();await Promise.resolve();assert.equal(saved.trips.length,0);
});

test('hotel cards rank estimated trip cost before percentage saving and omit old rates',async()=>{
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const hotel=(key,name,min,rate)=>({key,name,rating:4.3,reviews:900,typicalMin:min,typicalMax:min*2,rate});
  const city=(h)=>({city:'Tokyo',airports:['NRT'],hotels:[h],stays:[{checkIn:offer.departureDate,checkOut:offer.returnDate,pricedAt:new Date().toISOString(),quotes:[{key:h.key,checked:true,rates:[{site:'Site',rate:h.rate}]}]}]});
  const c=city(hotel('g1-d1','Bigger discount',400,200));
  c.hotels.push(hotel('g1-d2','Lower trip cost',100,85));c.stays[0].quotes.push({key:'g1-d2',checked:true,rates:[{site:'Site',rate:85}]});
  const {context,get}=env({fbLoadHotels:async()=>({currency:'USD',cities:[c]}),fbLoadPh:async()=>({asOf:today,fx:{usdphp:{level:60}}})});
  await context.renderFlights();const cards=get('flights-assistant').innerHTML.split('<div class="deal-grid">')[1];
  assert.ok(cards.indexOf('Lower trip cost')<cards.indexOf('Bigger discount'));
  // The booking terms the source lacks are said once under the cards, not on each.
  assert.doesNotMatch(cards,/unconfirmed|Checked /);
  assert.equal(get('flights-assistant').innerHTML.split('Room type, cancellation, breakfast and taxes are not in the source').length-1,1);
  assert.match(get('flights-assistant').innerHTML,/One room for two adults, rates checked [^.]+PHT\./);
  c.stays[0].pricedAt='2026-09-01T00:00:00Z';await context.renderFlights();
  assert.doesNotMatch(get('flights-assistant').innerHTML,/deal-card|Flight \+ hotel ≈/);
  assert.match(get('flights-out').innerHTML,/Old quote — recheck/);
});

test('a deal fitting planned leave precedes a cheaper trip elsewhere',async()=>{
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const seoul={...offer,id:'b'.repeat(20),destination:'ICN',destinationName:'Seoul',amount:450};
  const cities=[['Tokyo','NRT',50],['Seoul','ICN',100]].map(([city,airport,rate],i)=>({city,airports:[airport],hotels:[{key:'g1-d'+i,name:city+' Hotel',rating:4.3,reviews:500,typicalMin:rate*2,typicalMax:rate*3}],stays:[{checkIn:offer.departureDate,checkOut:offer.returnDate,pricedAt:new Date().toISOString(),quotes:[{key:'g1-d'+i,checked:true,rates:[{site:'Site',rate}]}]}]}));
  const {context,get}=env({_firebaseUid:'owner',fbLoadFlights:async()=>({offers:[offer,seoul]}),fbLoadMeetings:async()=>({items:[],days:[]}),fbLoadHotels:async()=>({currency:'USD',cities}),fbLoadPh:async()=>({asOf:today,fx:{usdphp:{level:60}}}),
    fbLoadHotelTrips:async()=>({trips:[{id:'leave|Seoul',kind:'leave',city:'Seoul',checkIn:offer.departureDate,checkOut:offer.returnDate,rooms:1,adults:2,edited:true}]})});
  await context.renderFlights();const cards=get('flights-assistant').innerHTML.split('<div class="deal-grid">')[1];
  assert.ok(cards.indexOf('Seoul Hotel')<cards.indexOf('Tokyo Hotel'));assert.match(cards,/Fits your planned trip/);
});
test('board regions fold to one-line headers, remember folding per device, and expand or collapse together',async()=>{
  const store=new Map();const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  const seoul={...offer,id:'b'.repeat(20),destination:'ICN',destinationName:'Seoul',amount:200};
  const {context,get}=env({localStorage,fbLoadFlights:async()=>({offers:[offer,seoul]})});
  await context.renderFlights();let out=get('flights-out').innerHTML;
  assert.match(out,/<div class="flight-board-tools"><span class="flights-note">2 regions · tap a region to fold it<\/span><span><button class="tool-chip" type="button" onclick="flightsFoldAll\(false\)">Expand all<\/button> <button class="tool-chip" type="button" onclick="flightsFoldAll\(true\)">Collapse all<\/button><\/span><\/div>/);
  assert.match(out,/<details class="flight-region" data-region="Japan\|round-trip · Economy · USD" open ontoggle="flightsRegionToggled\(this\)"><summary class="flights-group">Japan · round-trip · Economy · USD · from USD 250 · 1 city<\/summary><div class="flight-board">/);
  // Folding one region is remembered on this device and survives a re-render.
  context.flightsRegionToggled({open:false,getAttribute:()=>'Japan|round-trip · Economy · USD'});
  assert.deepEqual(JSON.parse(store.get('daybook-flights-folded-v1')),['Japan|round-trip · Economy · USD']);
  context.renderFlightOffers();out=get('flights-out').innerHTML;
  assert.match(out,/data-region="Japan\|round-trip · Economy · USD" ontoggle/);assert.match(out,/data-region="South Korea\|round-trip · Economy · USD" open ontoggle/);
  context.flightsRegionToggled({open:true,getAttribute:()=>'Japan|round-trip · Economy · USD'});assert.deepEqual(JSON.parse(store.get('daybook-flights-folded-v1')),[]);
  // Expand / Collapse all act on the page's regions and cities.
  const nodes=[{open:true,getAttribute:()=>'Japan|x'},{open:false,getAttribute:()=>'South Korea|x'}], cities=[{open:true}];
  context.document.querySelectorAll=s=>/flight-region/.test(s) ? nodes : /flight-city/.test(s) ? cities : [];
  context.flightsFoldAll(true);assert.deepEqual(nodes.map(n=>n.open),[false,false]);assert.equal(cities[0].open,false);
  assert.deepEqual(JSON.parse(store.get('daybook-flights-folded-v1')).sort(),['Japan|x','South Korea|x']);
  context.flightsFoldAll(false);assert.deepEqual(nodes.map(n=>n.open),[true,true]);assert.deepEqual(JSON.parse(store.get('daybook-flights-folded-v1')),[]);
  // Broken storage never breaks the board.
  context.localStorage={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}};
  delete context.document.querySelectorAll;context.renderFlightOffers();assert.match(get('flights-out').innerHTML,/class="flight-region"[^>]* open/);
});
test('activity buttons appear only for guided cities, with the scout spelling Macao mapped to Macau',async()=>{
  const hotel={key:'g1-d1',name:'Test hotel',rating:4.5,reviews:500,typicalMin:100};
  const stay={checkIn:'2099-11-22',checkOut:'2099-11-24',kind:'weekend',pricedAt:new Date().toISOString(),quotes:[{key:hotel.key,checked:true,rates:[{site:'Agoda',rate:80}]}]};
  const city=name=>({city:name,market:'domestic',airports:[],hotels:[hotel],stays:[stay]});
  const calls=[];const {context,get}=env({fbLoadFlights:async()=>({offers:[]}),fbLoadHotels:async()=>({currency:'USD',cities:[city('Seoul'),city('Macao')]}),fbTripActivities:async data=>{calls.push(data);return {plan:null};}});
  await context.renderFlights();const keys=[...get('flights-assistant').innerHTML.matchAll(/openTripActivities\('([^']+)'\)/g)].map(m=>m[1]);
  assert.equal(keys.length,2);await context.openTripActivities(keys[0]);assert.equal(calls[0].city,'Seoul');await context.openTripActivities(keys[1]);assert.equal(calls[1].city,'Macau');
  assert.equal(context.FlightsCore.activityCity('Seoul'),'Seoul');assert.equal(context.FlightsCore.activityCity(' hong kong '),'Hong Kong');
});
test('Add a flight quote opens the private quote form without touching the activity panel',()=>{
  const {context,get}=env();let scrolled=false;get('flight-quote-panel').scrollIntoView=()=>{scrolled=true;};
  context.openFlightQuote();assert.equal(get('flight-quote-panel').open,true);assert.equal(scrolled,true);
});
test('poker days are sent apart from reserved days; results group by role and the button then offers a refresh',async()=>{
  let sent;const {context,get}=env({crypto:{randomUUID:()=> 'test-trip-poker'},fbTripActivities:async data=>{sent=data;return {cached:false,plan:{context:{city:'Taipei',start:'2099-11-12',end:'2099-11-15',base:'Ximen',interests:'Local food and must-see places',version:3},generatedAt:new Date().toISOString(),notes:[],activities:[
    {name:'The Red House',role:'plan',date:'2099-11-12',slot:'flexible',whyFit:'x',tradeoff:'y',check:'z',evidence:'e',url:'https://eng.taiwan.net.tw/'},
    {name:'Lungshan Temple',role:'before-play',date:'2099-11-13',slot:'morning',whyFit:'x',tradeoff:'y',check:'z',evidence:'e',url:'https://eng.taiwan.net.tw/'},
    {name:'National Palace Museum',role:'if-you-bust',date:'2099-11-14',slot:'afternoon',whyFit:'x',tradeoff:'y',check:'z',evidence:'e',url:'https://eng.taiwan.net.tw/'}]}};}});
  const fields={city:'Taipei',start:'2099-11-12',end:'2099-11-15',base:'Ximen',interests:'Local food and must-see places',pace:'balanced',budget:'',commitments:'Poker trip: APT',busy:'',poker:'2099-11-13, 2099-11-14'};
  Object.entries(fields).forEach(([k,v])=>get('activity-'+k).value=v);get('activity-refresh').textContent='Improve saved shortlist · new AI call';
  await context.generateTripActivities(true);
  assert.deepEqual([...sent.pokerDays],['2099-11-13','2099-11-14']);assert.deepEqual([...sent.busy],[]);
  const html=get('activity-result').innerHTML;
  assert.ok(html.indexOf('Your free time')<html.indexOf('The Red House'));
  assert.ok(html.indexOf('Mornings before play')<html.indexOf('Lungshan Temple'));
  assert.ok(html.indexOf('If you bust early')<html.indexOf('National Palace Museum'));
  assert.match(get('activity-refresh').textContent,/Refresh saved plan/);
});
test('surroundings without a panorama show the pinned satellite view, and without a place a labelled map search',async()=>{
 const results=[{location:{lat:9.8,lng:126.15,source:'Google Maps',sourceUrl:'https://maps.google.com/?cid=1',matchedName:'Coconut Plantation View Point',address:'Del Carmen'},pano:null},{location:null,note:'Exact location lookup is unavailable. Use the map search.'}];
 const {context,get}=env({DaybookMapsEmbed:{apiKey:'k'},crypto:{randomUUID:()=> 'surroundings-test-2'},fbTripActivities:async()=>({cached:false,plan:{context:{city:'Siargao',base:'Resort',start:'2099-12-02',end:'2099-12-10',version:3},generatedAt:new Date().toISOString(),activities:[{name:'Sea of Palms',role:'plan',date:'2099-12-04',slot:'afternoon',whyFit:'w',tradeoff:'t',check:'c',url:'https://philippines.travel/'},{name:'Magpupungko Rock Pools',role:'plan',date:'2099-12-05',slot:'morning',whyFit:'w',tradeoff:'t',check:'c',url:'https://philippines.travel/'}]}}),fbActivitySurroundings:async()=>results.shift()});
 ['city','start','end','base','interests','pace'].forEach(k=>get('activity-'+k).value=({city:'Siargao',start:'2099-12-02',end:'2099-12-10',base:'Resort',interests:'Quiet walks and scenery',pace:'relaxed'})[k]);
 await context.generateTripActivities(false);const ids=[...get('activity-result').innerHTML.matchAll(/openActivitySurroundings\('([^']+)'\)/g)].map(m=>m[1]);
 await context.openActivitySurroundings(ids[0]);let html=get('activity-'+ids[0]).innerHTML;
 assert.doesNotMatch(html,/streetview/);assert.match(html,/maptype=satellite/);assert.match(html,/No Street View photo within about 600 m/);assert.match(html,/pinned at Coconut Plantation View Point, Del Carmen/);assert.match(html,/Location: Google Maps/);
 await context.openActivitySurroundings(ids[1]);html=get('activity-'+ids[1]).innerHTML;
 assert.match(html,/embed\/v1\/place\?key=k&amp;q=Magpupungko/);assert.match(html,/no exact place was found/);assert.match(html,/Use the map search/);
});
test('a Street View photo taken on the spot keeps Google\'s camera direction and says so',async()=>{
 const {context,get}=env({DaybookMapsEmbed:{apiKey:'k'},crypto:{randomUUID:()=> 'near-test'},fbTripActivities:async()=>({cached:false,plan:{context:{city:'Taipei',base:'Ximen',start:'2099-11-12',end:'2099-11-15',version:3},generatedAt:new Date().toISOString(),activities:[{name:'Huaxi Street Night Market',role:'plan',date:'2099-11-12',slot:'flexible',whyFit:'w',tradeoff:'t',check:'c',url:'https://eng.taiwan.net.tw/'}]}}),fbActivitySurroundings:async()=>({location:{lat:25.0386,lng:121.49844,source:'Google Maps',matchedName:'Huaxi Street Night Market'},pano:{id:'P',lat:25.0386,lng:121.49844,date:'2019-03',heading:331,distance:0}})});
 ['city','start','end','base','interests','pace'].forEach(k=>get('activity-'+k).value=({city:'Taipei',start:'2099-11-12',end:'2099-11-15',base:'Ximen',interests:'Local food and night markets',pace:'balanced'})[k]);
 await context.generateTripActivities(false);const id=get('activity-result').innerHTML.match(/openActivitySurroundings\('([^']+)'\)/)[1];
 await context.openActivitySurroundings(id);const html=get('activity-'+id).innerHTML;
 assert.match(html,/photo from March 2019 · taken at the place\. Drag/);assert.doesNotMatch(html,/heading=/);assert.doesNotMatch(html,/0 m away/);
});
test('surroundings credit a visitor photo sphere and flag a place far from the hotel when travel should be minimal',async()=>{
 const sent=[],answers=[
  {location:{lat:9.81232,lng:126.05961,source:'Google Maps',matchedName:'Coconut Plantation View Point'},pano:{id:'P',lat:9.81232,lng:126.05961,date:'2022-05',heading:2,distance:3,by:'Chris'},base:{lat:9.7872,lng:126.1557,matchedName:'Siargao Bleu Resort & Spa'}},
  {location:{lat:9.7880,lng:126.1590,source:'Google Maps',matchedName:'Guyam Island viewpoint'},pano:{id:'Q',lat:9.788,lng:126.159,date:'2019-03',heading:10,distance:40,by:''},base:{lat:9.7872,lng:126.1557,matchedName:'Siargao Bleu Resort & Spa'}}];
 const {context,get}=env({DaybookMapsEmbed:{apiKey:'k'},crypto:{randomUUID:()=> 'credit-test'},fbTripActivities:async()=>({cached:false,plan:{context:{city:'Siargao',base:'Siargao Bleu Resort & Spa',interests:'Quiet walks; worthwhile sights near my hotel, with minimal travel.',start:'2099-12-02',end:'2099-12-10',version:3},generatedAt:new Date().toISOString(),activities:[
   {name:'Sea of Palms',role:'plan',date:'2099-12-04',slot:'afternoon',whyFit:'w',tradeoff:'t',check:'c',url:'https://philippines.travel/'},
   {name:'Guyam Island',role:'plan',date:'2099-12-05',slot:'morning',whyFit:'w',tradeoff:'t',check:'c',url:'https://philippines.travel/'}]}}),
  fbActivitySurroundings:async data=>{sent.push(data);return answers.shift();}});
 ['city','start','end','base','interests','pace'].forEach(k=>get('activity-'+k).value=({city:'Siargao',start:'2099-12-02',end:'2099-12-10',base:'Siargao Bleu Resort & Spa',interests:'Quiet walks; worthwhile sights near my hotel, with minimal travel.',pace:'relaxed'})[k]);
 await context.generateTripActivities(false);const ids=[...get('activity-result').innerHTML.matchAll(/openActivitySurroundings\('([^']+)'\)/g)].map(m=>m[1]);
 await context.openActivitySurroundings(ids[0]);let html=get('activity-'+ids[0]).innerHTML;
 assert.equal(sent[0].base,'Siargao Bleu Resort & Spa');
 assert.match(html,/Photo sphere by Chris, May 2022 · taken at the place/);
 assert.match(html,/class="flight-flag">about 11 km from Siargao Bleu Resort &amp; Spa in a straight line; the road trip is longer\. Further than your wish to keep travel minimal\./);
 await context.openActivitySurroundings(ids[1]);html=get('activity-'+ids[1]).innerHTML;
 assert.match(html,/class="flights-note">about 350 m from Siargao Bleu/);assert.doesNotMatch(html,/Further than/);assert.match(html,/Street View · photo from March 2019/);
});
test('activity cards show what the source says: Wikivoyage hours and edit date, Google rating, and the right link',async()=>{
 const base={role:'plan',slot:'flexible',effort:'light',whyFit:'w',tradeoff:'t',check:'c',evidence:'e'};
 const {context,get}=env({crypto:{randomUUID:()=> 'facts-test'},fbTripActivities:async()=>({cached:false,plan:{context:{city:'Taipei',base:'Ximen',start:'2099-11-12',end:'2099-11-15',version:4},generatedAt:new Date().toISOString(),activities:[
   {...base,name:'Longshan Temple',date:'2099-11-12',url:'https://en.wikivoyage.org/wiki/Taipei/Old_Taipei',areaFit:'About 600 m from your hotel in a straight line',distanceKm:0.6,facts:{source:'Wikivoyage',hours:'Daily 06:00-22:00',price:'Free',lastedit:'2026-01-19',rating:4.6}},
   {...base,name:'Ah Chung',date:'2099-11-13',url:'https://maps.google.com/?cid=3',facts:{source:'Google Maps',rating:4.2,reviews:20000}}]}})});
 ['city','start','end','base','interests','pace'].forEach(k=>get('activity-'+k).value=({city:'Taipei',start:'2099-11-12',end:'2099-11-15',base:'Ximen',interests:'Local food and temples',pace:'balanced'})[k]);
 await context.generateTripActivities(false);const html=get('activity-result').innerHTML;
 assert.match(html,/<span class="act-src">Wikivoyage<\/span> Daily 06:00-22:00 · Free · Google ★ 4.6 · updated January 2026<\/p>/);
 assert.match(html,/<span class="act-src">Google Maps<\/span> ★ 4.2 · 20,000 reviews<\/p>/);
 assert.doesNotMatch(html,/act-old/,'a recent listing is not marked');
 assert.match(html,/href="https:\/\/en.wikivoyage.org\/wiki\/Taipei\/Old_Taipei"[^>]*>Read on Wikivoyage ↗/);
 assert.match(html,/href="https:\/\/maps.google.com\/\?cid=3"[^>]*>Open in Google Maps ↗/);
 assert.match(html,/About 600 m from your hotel in a straight line/);
});

test('saved activity cards sort dated mornings, flag old listing facts and share backups across eligible poker days',async()=>{
 const contextPlan={city:'Taipei',base:'Ximen',start:'2099-11-12',end:'2099-11-16',version:4,pokerDays:['2099-11-15','2099-11-14','2099-11-13','2099-11-16'],busy:['2099-11-15']};
 const row={slot:'morning',effort:'light',whyFit:'Fits history interests',tradeoff:'Allow time before play',check:'Confirm access',evidence:'Source description'};
 const plan={context:contextPlan,generatedAt:new Date().toISOString(),activities:[
  {...row,name:'Later morning gate',role:'before-play',date:'2099-11-14'},
  {...row,name:'Earlier morning temple',role:'before-play',date:'2099-11-13'},
  {...row,name:'Older noodle listing',role:'plan',date:'2099-11-12',facts:{source:'Wikivoyage',hours:'10:00-22:30',price:'NT$45-60',lastedit:'2016-02-17'}},
  {...row,name:'Undated listing',role:'plan',date:'2099-11-12',facts:{source:'Wikivoyage',hours:'Daily'}},
  {...row,name:'Backup park',role:'if-you-bust',date:'2099-11-14',slot:'flexible'}]};
 const original=JSON.stringify(plan);
 const {context,get}=env({crypto:{randomUUID:()=> 'saved-display-test'},fbTripActivities:async()=>({cached:true,plan})});
 Object.entries({city:'Taipei',base:'Ximen',start:'2099-11-12',end:'2099-11-16',interests:'Local food and history',pace:'balanced'}).forEach(([k,v])=>get('activity-'+k).value=v);
 await context.generateTripActivities(false);const html=get('activity-result').innerHTML;
 assert.ok(html.indexOf('Earlier morning temple')<html.indexOf('Later morning gate'));
 assert.match(html,/10:00-22:30 · NT\$45-60 · <span class="act-old">listing from February 2016<\/span>/);assert.match(html,/Daily · <span class="act-old">undated listing<\/span>/);
 assert.equal((html.match(/not confirmed for your dates/g)||[]).length,1,'the listing caveat is said once, not on every card');assert.match(html,/amber<\/span> marks listings over two years old or undated/);
 assert.match(html,/If you bust early<\/h4><p class="flights-note act-rule">Backups, not a plan: choose one if time allows/);assert.match(html,/<div class="act-when">Fri 13 Nov 2099 or Sat 14 Nov 2099 · light<\/div><h4>Backup park/);
 assert.doesNotMatch(html,/Sun 15 Nov 2099 or|or Sun 15 Nov 2099|Mon 16 Nov 2099 ·/);
 assert.equal(JSON.stringify(plan),original);
});
test('a whole break names each hotel city once, even when two of its airports are among the cheapest',async()=>{
  const cal=readFileSync(new URL('./daybook-calendar-core.js',import.meta.url),'utf8');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const fare=(code,name,amount)=>({...offer,id:({DMK:'d',BKK:'b',TPE:'e'})[code].repeat(20),destination:code,destinationName:name,departureDate:'2099-12-20',returnDate:'2099-12-27',amount});
  const hotels={currency:'USD',adults:2,cities:[{city:'Bangkok',airports:['BKK','DMK'],hotels:[{key:'g1-d1',name:'Bangkok Inn',rating:4.2,reviews:500,typicalMin:100,typicalMax:200}],stays:[]},
    {city:'Taipei',airports:['TPE'],hotels:[{key:'g2-d1',name:'Taipei Inn',rating:4.5,reviews:900,typicalMin:50,typicalMax:120}],stays:[]}]};
  const {context,get}=env({_firebaseUid:'owner',fbLoadPh:async()=>({asOf:today,fx:{usdphp:{level:60}}}),fbLoadHotels:async()=>hotels,fbLoadDaybookEvents:async()=>[],
    fbLoadMeetings:async()=>({items:[],days:[{id:'a',title:'Annual Leave',start:'2099-12-21',end:'2099-12-24',calendar:'Google'}]}),
    fbLoadFlights:async()=>({asOf:'2099-01-01',offers:[fare('DMK','DMK',100),fare('BKK','Bangkok',110),fare('TPE','Taipei',200)]})});
  vm.runInContext(cal,context);get('flights-cabin').value='economy';
  await context.renderFlights();const out=get('flights-timeoff').innerHTML;
  assert.equal((out.match(/<div class="timeoff-stay"><b>Bangkok<\/b>/g)||[]).length,1);
  assert.match(out,/<div class="timeoff-stay"><b>Taipei<\/b>/);
});
test('a local hotel on several weekends is one card with its other dates, in a folded lane that stays open across redraws',async()=>{
  const hotel={key:'g298460-d1',name:'Loboc <resort>',rating:4.5,reviews:634,typicalMin:100,typicalMax:200};
  const stay=(checkIn,checkOut,rate)=>({checkIn,checkOut,kind:'weekend',pricedAt:new Date().toISOString(),quotes:[{key:hotel.key,checked:true,rates:[{site:'Agoda',rate}]}]});
  const hotels={currency:'USD',adults:2,cities:[{city:'Bohol',market:'domestic',airports:['TAG'],hotels:[hotel],stays:[stay('2099-11-20','2099-11-22',80),stay('2099-11-27','2099-11-29',85)]}]};
  const {context,get}=env({fbLoadFlights:async()=>({offers:[]}),fbLoadHotels:async()=>hotels,fbLoadPh:async()=>({asOf:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date()),fx:{usdphp:{level:60}}})});
  await context.renderFlights();let html=get('flights-assistant').innerHTML;
  assert.equal((html.match(/class="deal-card"/g)||[]).length,1);
  assert.match(html,/<details class="flight-fold" data-fold="hotels\|domestic" ontoggle="flightsFoldToggled\(this\)"><summary class="flights-group">Domestic hotel deals · 1 hotel · 1 below typical · from ≈ PHP 4,800\/night<\/summary>/);
  assert.match(html,/Fri 20 Nov 2099 → Sun 22 Nov 2099 · 2 nights · weekend/);
  assert.match(html,/Also Fri 27 Nov 2099 → Sun 29 Nov 2099 ≈ PHP 5,100\/night/);
  assert.match(html,/One room for two adults, transport excluded, rates checked/);
  context.flightsFoldToggled({getAttribute:()=>'hotels|domestic',open:true});context.renderFlightOffers();
  assert.match(get('flights-assistant').innerHTML,/data-fold="hotels\|domestic" open ontoggle/);
});
test('activities from a fare suggest the scout\'s cheapest hotel for those dates and list the city\'s hotels',async()=>{
  const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
  const hotels={currency:'USD',adults:2,cities:[{city:'Tokyo',airports:['NRT'],hotels:[{key:'g1-d1',name:'Tokyo <Inn>',rating:4.2,reviews:500,typicalMin:100,typicalMax:200},{key:'g1-d2',name:'Ginza Hotel',rating:4.6,reviews:900,typicalMin:150,typicalMax:300}],
    stays:[{checkIn:'2099-11-22',checkOut:'2099-11-27',pricedAt:new Date().toISOString(),quotes:[{key:'g1-d1',checked:true,rates:[{site:'Agoda',rate:90}]},{key:'g1-d2',checked:true,rates:[{site:'Agoda',rate:160}]}]}]}]};
  let sent;const {context,get}=env({_firebaseUid:'owner',fbLoadHotels:async()=>hotels,fbLoadPh:async()=>({asOf,fx:{usdphp:{level:60}}}),fbTripActivities:async d=>{sent=d;return {plan:null};}});
  await context.renderFlights();
  const key=get('flights-assistant').innerHTML.match(/openTripActivities\('([^']+)'\)/)[1];
  await context.openTripActivities(key);const panel=get('flights-activities').innerHTML;
  assert.equal(sent.base,'Tokyo <Inn>');
  assert.match(panel,/id="activity-base" type="text" value="Tokyo &lt;Inn&gt;"[^>]*list="activity-hotels"/);
  assert.match(panel,/<datalist id="activity-hotels"><option value="Tokyo &lt;Inn&gt;"><option value="Ginza Hotel"><\/datalist>/);
  assert.match(panel,/Suggested: the cheapest well-reviewed room the hotel scout priced for these dates \(≈ PHP 5,400\/night\)\. Change it if you stay elsewhere\./);
  get('activity-base-note').textContent='Suggested: x';context.activityBaseEdited();assert.equal(get('activity-base-note').textContent,'');
});
test('your next trip leads with the next leave window: a peak fit is called peak, and only return fares price the city chips',async()=>{
  const cal=readFileSync(new URL('./daybook-calendar-core.js',import.meta.url),'utf8');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
  const fare=(id,code,name,dep,ret,amount,extra={})=>({...offer,id:id.repeat(20),destination:code,destinationName:name,departureDate:dep,returnDate:ret,amount,...extra});
  const offers=[fare('a','NRT','Tokyo','2099-12-20','2099-12-24',900),fare('b','NRT','Tokyo','2099-11-02','2099-11-09',300),
    fare('c','TPE','Taipei','2099-10-05','2099-10-10',250),fare('d','DMK','Bangkok','2099-10-01','',50,{tripType:'one-way',returnDate:''})];
  const {context,get}=env({_firebaseUid:'owner',fbLoadPh:async()=>({asOf:today,fx:{usdphp:{level:60}}}),fbLoadDaybookEvents:async()=>[],
    fbLoadMeetings:async()=>({items:[],days:[{id:'a',title:'Annual Leave',start:'2099-12-21',end:'2099-12-24',calendar:'Google'}]}),
    fbLoadFlights:async()=>({asOf:'2099-01-01',offers})});
  vm.runInContext(cal,context);get('flights-cabin').value='economy';
  await context.renderFlights();const html=get('flights-next').innerHTML;
  assert.match(html,/Your next trip window · in \d+ days/);assert.match(html,/<h3>Sat 19 Dec 2099 – Thu 24 Dec 2099<\/h3>/);
  assert.match(html,/look peak-priced: Tokyo ≈ ₱54k against ≈ ₱18k on other dates/);
  assert.match(html,/>Taipei · from ₱15k ↗<\/a>/);assert.match(html,/>Tokyo · from ₱18k ↗<\/a>/);
  assert.doesNotMatch(html,/Bangkok · from/,'a one-way fare never prices a city chip');
});
test('fare watch: a city row starts a watch 10% under today\'s low, the panel says whether the latest scout meets it, and edits and removal save',async()=>{
  const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
  let saved=null,watch={items:{}};
  const {context,get}=env({_firebaseUid:'owner',fbLoadPh:async()=>({asOf,fx:{usdphp:{level:60}}}),fbLoadFlightWatch:async()=>watch,fbSaveFlightWatch:async items=>{saved=JSON.parse(JSON.stringify(items));}});
  get('flights-cabin').value='economy';get('flights-min-nights').value='3';get('flights-max-nights').value='10';
  await context.renderFlights();
  assert.match(get('flights-watch').innerHTML,/Fare watch: open a city under All destinations/);
  const key=get('flights-out').innerHTML.match(/addFlightWatch\('([^']+)'\)/)[1];
  await context.addFlightWatch(key);
  const [id,w]=Object.entries(saved)[0];
  assert.equal(w.city,'Tokyo <test>');assert.deepEqual(w.airports,['NRT']);assert.equal(w.target,13500,'10% under ≈ PHP 15,000, rounded down to 500');assert.equal(w.minNights,3);
  let html=get('flights-watch').innerHTML;
  assert.match(html,/data-fold="watch" open/);assert.match(html,/No fitting fare in the latest scout/,'the 2099 sample is outside the default 180 days');assert.match(get('flights-out').innerHTML,/Watched · see Fare watch/);
  const form=v=>({elements:{namedItem:n=>({value:{from:w.from,to:'2099-12-31',minNights:'3',maxNights:'10',target:v}[n]})}});
  await context.saveFlightWatch(form('13500'),id);assert.match(get('flights-watch').innerHTML,/Now ≈ PHP 15,000, PHP 1,500 above/);
  await context.saveFlightWatch(form('15000'),id);
  assert.equal(saved[id].target,15000);assert.match(get('flights-watch').innerHTML,/≈ PHP 15,000 · at or under your target/);assert.match(get('flights-watch').innerHTML,/1 at or under target/);
  await context.removeFlightWatch(id);assert.deepEqual(saved,{});
});
test('budget airlines: the coverage line counts each named airline (a paired trip for both), names Cebu Pacific when absent, and a paired trip links each leg',async()=>{
  const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
  const pair={...offer,id:'c'.repeat(20),airline:'HK Express',destination:'HKG',destinationName:'Hong Kong',currency:'PHP',amount:10438,sourceUrl:'https://www.airasia.com/flights/en/gb/from-manila-mnl-to-hong-kong-hkg/',bookingUrl:'https://www.airasia.com/v2/flights/search/?origin=MNL',
    paired:{outbound:3653,inbound:845,inboundCurrency:'HKD',inboundPhp:6785,rate:8.0296,fxAsOf:asOf,inboundUrl:'https://www.airasia.com/v2/flights/search/?origin=HKG'},priceBasis:'Two AirAsia MOVE one-way fares'};
  const mixed={...pair,id:'d'.repeat(20),airline:'Jeju Air + Jin Air',destination:'ICN',destinationName:'Seoul'};
  const {context,get}=env({fbLoadPh:async()=>({asOf,fx:{usdphp:{level:60}}}),fbLoadFlights:async()=>({generatedAt:new Date().toISOString(),offers:[offer,pair,mixed]})});
  get('flights-cabin').value='economy';await context.renderFlights();
  const a=get('flights-assistant').innerHTML,o=get('flights-out').innerHTML;
  assert.match(a,/Budget airlines in the fares shown: HK Express 1 · Jeju Air 1 · Jin Air 1 · Cebu Pacific no dated prices[^<]*\. 2 round trips are two one-way tickets added together\./);
  assert.match(o,/Two one-way tickets added together · book and confirm each leg/);
  assert.match(o,/>Outbound leg ↗<\/a><a href="https:\/\/www.airasia.com\/v2\/flights\/search\/\?origin=HKG"[^>]*>Return leg ↗<\/a>/);
});
test('a recent Aviasales search price says when and where it was found, and links to the search',async()=>{
  const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
  const tp={...offer,id:'e'.repeat(20),airline:'Cebu Pacific',destination:'HKG',destinationName:'Hong Kong',currency:'PHP',amount:11677,sourceUrl:'https://www.aviasales.com/',
    bookingUrl:'https://www.aviasales.com/search/MNL1812HKG05011?t=5J&search_date=12102026',searched:{foundOn:'2026-10-12',seller:'Farera'},priceBasis:'Round-trip price an Aviasales user found'};
  const {context,get}=env({fbLoadPh:async()=>({asOf,fx:{usdphp:{level:60}}}),fbLoadFlights:async()=>({generatedAt:new Date().toISOString(),offers:[offer,tp]})});
  get('flights-cabin').value='economy';await context.renderFlights();
  const o=get('flights-out').innerHTML,a=get('flights-assistant').innerHTML;
  assert.match(o,/Recent search price · found Mon 12 Oct( 2026)? via Farera · open the search for today’s price/);
  assert.match(o,/href="https:\/\/www.aviasales.com\/search\/MNL1812HKG05011\?t=5J&amp;search_date=12102026"[^>]*>Open the search on Aviasales ↗/);
  assert.match(a,/Cebu Pacific 1/);assert.match(a,/not live quotes/);assert.doesNotMatch(a,/Cebu Pacific no dated prices/);
});
test('booked trips: "I booked this" fills the form, saving shows a countdown card with a dated checklist, ticks and removal save',async()=>{
  let saved=null;
  const {context,get}=env({_firebaseUid:'owner',fbLoadBookedTrips:async()=>({items:{}}),fbSaveBookedTrips:async items=>{saved=JSON.parse(JSON.stringify(items));}});
  get('flights-cabin').value='economy';await context.renderFlights();
  assert.match(get('flights-booked').innerHTML,/\+ Add a trip you booked/);
  context.markFareBooked(offer.id);
  let html=get('flights-booked').innerHTML;
  assert.match(html,/id="booked-form" open/);assert.match(html,/name="destination" type="text" value="NRT"/);assert.match(html,/name="depart" type="date" value="2099-11-22"/);
  const values={city:'Tokyo',destination:'nrt',origin:'MNL',depart:'2099-11-22',ret:'2099-11-27',airline:'PAL',flight:'PR 428',hotel:'Shinjuku <Inn>',travellers:'2'};
  await context.saveBookedTrip({elements:{namedItem:n=>({value:values[n]})}});
  const [id,t]=Object.entries(saved)[0];
  assert.match(id,/^b[a-z0-9]+$/);assert.equal(t.destination,'NRT');assert.equal(t.fareId,offer.id);assert.equal(t.travellers,2);
  html=get('flights-booked').innerHTML;
  assert.match(html,/Booked trip · in \d+ days/);assert.match(html,/Tokyo · Sun 22 Nov 2099 → Fri 27 Nov 2099/);assert.match(html,/staying at Shinjuku &lt;Inn&gt;/);
  assert.match(html,/Visa: tourist visa/);assert.match(html,/eTravel registration[^<]*<\/label><span class="booked-when">from Thu 19 Nov 2099/);
  assert.doesNotMatch(html,/id="booked-form" open/);
  await context.tickBookedTrip(id,'passport',true);assert.deepEqual(saved[id].done,{passport:true});
  assert.match(get('flights-booked').innerHTML,/class="is-done"><label><input type="checkbox" checked/);
  await context.removeBookedTrip(id);assert.deepEqual(saved,{});
});
