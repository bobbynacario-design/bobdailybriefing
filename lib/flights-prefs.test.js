import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('window.fbLoadFlightPrefs = async function()');
const handler=html.slice(start,html.indexOf('\n};',start)+3);
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
