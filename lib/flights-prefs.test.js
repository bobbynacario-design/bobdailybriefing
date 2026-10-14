import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('window.fbLoadFlightPrefs = async function()');
const handler=html.slice(start,html.indexOf('\n};',start)+3);
test('quote provenance and passenger totals persist only in the owner shortlist',async()=>{
 const begin=html.indexOf('window.fbSetSavedFlight = async function('),source=html.slice(begin,html.indexOf('\n};',begin)+3);
 const quote={id:'a'.repeat(20),kind:'advertised-fare',sourceUrl:'https://www.cebupacificair.com/en-PH',bookingUrl:'https://www.cebupacificair.com/en-PH',userSupplied:true,quoteTotal:6000,passengers:2,baggageKg:20,checkedAt:'2026-10-14T00:00:00Z'};
 let stored={uid:'owner',savedOffers:{existing:{id:'existing'}}};
 const context={Date,Error,Object,db:{},COLL:'briefings-bob',FlightsCore:{officialUrl:u=>u},getUid:()=> 'owner',doc:(_,__,key)=>key,runTransaction:async(_,fn)=>fn({get:async key=>{assert.equal(key,'flights-saved-owner');return {exists:()=>true,data:()=>stored};},set:(key,value)=>{assert.equal(key,'flights-saved-owner');stored=value;}})};
 context.window=context;vm.createContext(context);vm.runInContext(source,context);await context.fbSetSavedFlight(quote,true);
 assert.equal(stored.savedOffers[quote.id].userSupplied,true);assert.equal(stored.savedOffers[quote.id].passengers,2);assert.equal(stored.savedOffers[quote.id].quoteTotal,6000);assert.equal(stored.savedOffers[quote.id].checkedAt,quote.checkedAt);assert.ok(stored.savedOffers.existing);
});
function load(extra) {
  const context={db:{},COLL:'briefings-bob',doc:(_,__,key)=>key,getUid:()=> 'owner',...extra};
  context.window=context;vm.createContext(context);vm.runInContext(handler,context);
  return context.fbLoadFlightPrefs;
}
test('first-use permission denial primes only owner and preserves existing saved offers',async()=>{
  const saved={existing:{id:'existing'}};let readable=false,writes=0;
  const read=load({getDoc:async()=>{
    if(!readable)throw Object.assign(Error('missing personal document'),{code:'permission-denied'});
    return {exists:()=>true,data:()=>({uid:'owner',savedOffers:saved})};
  },setDoc:async(key,value,options)=>{
    assert.equal(key,'flights-saved-owner');
    assert.equal(JSON.stringify(value),'{"uid":"owner"}');
    assert.equal(options.merge,true);readable=true;writes++;
  }});
  assert.equal(await read(),saved);assert.equal(writes,1);
  assert.equal(await read(),saved);assert.equal(writes,1);
});
test('shortlist failures and account changes cannot become empty or overwrite data',async()=>{
  let writes=0;
  const denied=Object.assign(Error('denied'),{code:'permission-denied'});
  await assert.rejects(load({getDoc:async()=>{throw denied;},setDoc:async()=>{writes++;throw denied;}})(),/denied/);
  await assert.rejects(load({getDoc:async()=>{throw Error('offline');},setDoc:async()=>{writes++;}})(),/offline/);
  let uid='owner';
  await assert.rejects(load({getUid:()=>uid,getDoc:async()=>{uid='other';throw denied;},setDoc:async()=>{writes++;}})(),/Account changed/);
  assert.equal(writes,1);
});
