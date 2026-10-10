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
  const out=get('flights-out').innerHTML;assert.match(out,/USD 250 from/);assert.match(out,/Tokyo &lt;test&gt;/);
  assert.match(out,/Check fare on airline/);assert.match(out,/availability unconfirmed/);assert.match(get('flights-sources').innerHTML,/Unavailable to the scout/);
  assert.equal(writes,0);
  await context.toggleFlightSave(offer.id);assert.equal(writes,1);assert.match(get('flights-out').innerHTML,/Remove saved/);
  await context.toggleFlightSave(offer.id);assert.equal(writes,2);assert.match(get('flights-out').innerHTML,/Save deal/);
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
  assert.match(get('flights-out').innerHTML,/USD 250 from/);
  assert.match(get('flights-out').innerHTML,/<div class="flight-price">USD 250 from · ≈ PHP 14,605<\/div>/);
  assert.match(get('flights-out').innerHTML,/<details[^>]*><summary>Fare details &amp; restrictions<\/summary><p><b>PHP estimate:<\/b>/);
  assert.match(get('flights-out').innerHTML,/1 USD = PHP 58.42/);
  assert.match(get('flights-out').innerHTML,/PH market rate as of/);
  context.fbLoadPh=async()=>{throw Error('offline');};await context.renderFlights();
  assert.match(get('flights-out').innerHTML,/USD 250 from/);
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
  assert.match(get('flights-out').innerHTML,/<div class="flight-price">USD 250 from · ≈ PHP 15,680<\/div>/);
});
test('seat sale cards show base fare and windows first with labelled evidence and safe airline booking',async()=>{
  const campaign={...offer,id:'b'.repeat(20),campaign:true,kind:'promo',amount:null,currency:'PHP',origin:'ANY',destination:'ANY',origins:['MNL','CEB','CRK'],title:'Cebu Pacific seat sale',airline:'Cebu Pacific',discount:'PHP 10 one-way base fare',departureDate:'',returnDate:'',bookingStart:'2099-01-01',bookingEnd:'2099-01-11',travelStart:'2099-02-01',travelEnd:'2099-06-30',publisher:'Hello Mnl · press-release fallback',evidenceUrl:'https://hellomnl.com/sale',bookingUrl:'https://www.cebupacificair.com/en-PH/seat-sale',sourceUrl:'https://www.cebupacificair.com/en-PH/seat-sale'};
  const {context,get}=env({fbLoadFlights:async()=>({offers:[offer,campaign]})});
  await context.renderFlights();const out=get('flights-out').innerHTML;
  assert.match(out,/PHP 10 one-way base fare/);assert.match(out,/Book 2099-01-01 → 2099-01-11/);assert.match(out,/Travel 2099-02-01 → 2099-06-30/);
  assert.match(out,/fees extra/);assert.match(out,/Reported announcement/);assert.match(out,/route seats not verified/);
  assert.ok(out.indexOf('Cebu Pacific seat sale')<out.indexOf('Tokyo'));
  assert.doesNotMatch(out,/ANY → ANY|lowest advertised first[\s\S]*booking deadlines first/);
  context.fbLoadFlights=async()=>({offers:[{...campaign,evidenceStatus:'unavailable'}]});
  await context.renderFlights();assert.match(get('flights-out').innerHTML,/publisher link unavailable/);
  assert.doesNotMatch(get('flights-out').innerHTML,/href="https:\/\/hellomnl.com\/sale"/);
  assert.match(get('flights-out').innerHTML,/href="https:\/\/www.cebupacificair.com\/en-PH\/seat-sale"/);
});
