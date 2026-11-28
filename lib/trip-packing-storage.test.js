import {test} from 'node:test';
import assert from 'node:assert/strict';
import './shopping-taste.js';import './purchase-tracker.js';import './shopping-style.js';import './shopping-trips.js';import './shopping-core.js';import './trip-packing.js';import './trip-packing-storage.js';
const P=globalThis.TripPacking,C=globalThis.ShoppingCore,id='btrip1',trip={city:'Tokyo',destination:'NRT',depart:'2026-12-01',ret:'2026-12-08'},row=P.item({id:'tops',label:'Tops',quantity:2,category:'Tops',stage:'needed'});
function env(){
 let uid='owner',owner=true,retry=null,onRead=null,denyMissing=false,denyLoad=false;const docs=new Map(),writes=[],primes=[];
 const clone=v=>JSON.parse(JSON.stringify(v));
 const a={uid:()=>uid,owner:()=>owner,db:{},coll:'briefings-bob',doc:(db,coll,id)=>id,
 getDoc:async key=>{if(denyLoad){const e=Error('denied');e.code='permission-denied';throw e;}return {exists:()=>docs.has(key),data:()=>clone(docs.get(key))};},
 collection:()=>null,where:(key,op,v)=>({key,v}),query:(c,...clauses)=>clauses,limit:()=>null,
 getDocs:async clauses=>{const filters=clauses.filter(Boolean),found=[...docs.values()].filter(v=>filters.every(f=>v[f.key]===f.v));return {empty:!found.length,docs:found.map(v=>({data:()=>clone(v)}))};},
 setDoc:async(key,data)=>{docs.set(key,{...docs.get(key),...data});primes.push(key);},
 runTransaction:async(db,fn)=>{
  const run=async commit=>{const pending=[];const result=await fn({get:async key=>{if(onRead)onRead(key);if(denyMissing && !docs.has(key)){const e=Error('missing');e.code='permission-denied';throw e;}return {exists:()=>docs.has(key),data:()=>clone(docs.get(key))};},set:(key,data)=>pending.push([key,clone(data)])});if(commit)for(const [key,data]of pending){docs.set(key,data);writes.push(key);}return result;};
  if(retry){await run(false);const mutate=retry;retry=null;mutate();}return run(true);
 }};
 docs.set('trips-booked-owner',{uid:'owner',items:{[id]:clone(trip)}});
 docs.set('trip-packing-owner',{uid:'owner',kind:'trip-packing',plans:{[id]:{tripKey:P.tripKey(trip),items:[clone(row)]}}});
 docs.set('shopping-prefs-owner',{...C.cleanPrefs(),uid:'owner',kind:'shopping-prefs'});
 return {api:globalThis.TripPackingStorage.create(a),docs,writes,primes,account:v=>uid=v,owner:v=>owner=v,retry:f=>retry=f,read:f=>onRead=f,deny:()=>denyMissing=true,denyLoad:()=>denyLoad=true};
}
const cmd=(op='put')=>({op,id:'tops',expected:row,item:{...row,stage:'owned'},tripKey:P.tripKey(trip)});
test('packing transaction retries against latest state and merges independent rows',async()=>{
 const e=env();e.retry(()=>{const data=e.docs.get('trip-packing-owner');data.plans[id].items.push(P.item({...row,id:'shoes',label:'Shoes',stage:'packed'}));});
 const r=await e.api.save(id,cmd());assert.equal(r.plans[id].items[0].stage,'owned');assert.equal(r.plans[id].items[1].stage,'packed');assert.deepEqual(e.writes,['trip-packing-owner']);
});
test('need creation and its packing link commit atomically with latest Clothing edits',async()=>{
 const e=env();e.retry(()=>{e.docs.set('shopping-prefs-owner',{...e.docs.get('shopping-prefs-owner'),shoeSize:10,needs:[{id:'other',text:'Remote need'}]});});
 const r=await e.api.save(id,cmd('need'));assert.equal(r.profile.shoeSize,10);assert.equal(r.profile.needs.length,2);assert.deepEqual(e.writes,['trip-packing-owner','shopping-prefs-owner']);
 assert.equal(e.docs.get('trip-packing-owner').plans[id].items[0].needId,r.profile.needs[1].id);
 const conflict=env();conflict.docs.get('trip-packing-owner').plans[id].items[0].stage='packed';await assert.rejects(conflict.api.save(id,cmd('need')),/another device/);assert.equal(conflict.writes.length,0);assert.equal(conflict.docs.get('shopping-prefs-owner').needs.length,0);
});
test('latest booked dates and purchase returns prevent stale packing confirmations',async()=>{
 const e=env();e.docs.get('trips-booked-owner').items[id].depart='2026-12-02';await assert.rejects(e.api.save(id,cmd()),/trip changed/);assert.equal(e.writes.length,0);
 const x=env(),at='2026-11-28T01:00:00.000Z';x.docs.set('shopping-prefs-owner',C.cleanPrefs({purchases:[{id:'order',at,name:'Polo',tracker:{status:'returned',retailer:'Store',purchasedOn:'2026-11-27'}}]}));
 await assert.rejects(x.api.save(id,{...cmd(),item:{...row,stage:'packed',purchaseId:'order',purchaseAt:at}}),/returned/);assert.equal(x.writes.length,0);
});
test('account switches and non-owner sessions cannot write previous private data',async()=>{
 const e=env();e.read(()=>e.account('other'));await assert.rejects(e.api.save(id,cmd()),/Account changed/);assert.equal(e.writes.length,0);assert.equal(e.primes.length,0);
 const x=env();x.owner(false);await assert.rejects(x.api.load(),/owner/);await assert.rejects(x.api.save(id,cmd()),/owner/);assert.equal(x.writes.length,0);
});
test('first checklist safely primes missing metadata without overwriting saved data',async()=>{
 const e=env();e.docs.delete('trip-packing-owner');e.deny();const r=await e.api.save(id,{op:'start',tripKey:P.tripKey(trip)});assert.ok(r.plans[id].items.length);assert.deepEqual(e.primes,['trip-packing-owner']);
 const x=env();x.docs.delete('shopping-prefs-owner');x.deny();const need=await x.api.save(id,cmd('need'));assert.equal(need.profile.needs.length,1);assert.deepEqual(x.primes,['shopping-prefs-owner']);
});
test('missing read fallback queries owner and kind without writing a document',async()=>{
 const e=env();e.denyLoad();assert.equal((await e.api.load())[id].items.length,1);assert.equal(e.primes.length,0);
 e.docs.delete('trip-packing-owner');assert.deepEqual(await e.api.load(),{});
 e.docs.set('trip-packing-other',{uid:'other',kind:'trip-packing',plans:{[id]:{tripKey:P.tripKey(trip),items:[row]}}});assert.deepEqual(await e.api.load(),{});
});

test('a new Clothing profile loads as empty through owner queries without a write',async()=>{
 const e=env();e.docs.delete('shopping-prefs-owner');e.denyLoad();const profile=await e.api.loadProfile();assert.equal(profile.needs.length,0);assert.equal(profile.purchases.length,0);assert.equal(e.primes.length,0);
});
