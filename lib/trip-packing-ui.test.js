import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
function env(overrides={}){
 const nodes=new Map();function get(id){if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',hidden:false,scrollIntoView(){}});return nodes.get(id);}
 const trip={city:'Tokyo',destination:'NRT',depart:new Date(Date.now()+2*86400000).toISOString().slice(0,10),ret:''};
 const c={Date,URL,Intl,Promise,Set,TextEncoder,crypto:{randomUUID:()=> '00112233-4455-6677-8899-aabbccddeeff'},_firebaseUid:'owner',daybookMember:false,document:{getElementById:get,querySelectorAll:()=>[]},markTodayQuiet:()=>{},fbLoadBookedTrips:async()=>({items:{btrip1:trip}}),fbLoadTripPacking:async()=>({}),fbLoadShoppingPrefs:async()=>({}),...overrides};c.window=c;vm.createContext(c);
 for(const f of ['flights-core','shopping-taste','purchase-tracker','shopping-style','shopping-trips','shopping-core','trip-packing','trip-packing-ui'])vm.runInContext(readFileSync(new URL('./'+f+'.js',import.meta.url),'utf8'),c);
 return {c,get,trip};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('Today loads independently of fare/scout feeds and creates a per-trip action',async()=>{
 const {c,get}=env();await c.renderTodayPacking();assert.equal(get('today-packing').hidden,false);assert.match(get('today-packing').innerHTML,/Tokyo/);assert.match(get('trip-packing').innerHTML,/Build packing checklist/);
});
test('coalesced reads discard previous-account data and reset clears private UI',async()=>{
 const d=deferred();let calls=0;const {c,get}=env({fbLoadBookedTrips:()=>{calls++;return d.promise;}});const first=c.renderTodayPacking(),second=c.renderTripPacking();await Promise.resolve();assert.equal(calls,1);c._firebaseUid='other';c.resetTripPacking();d.resolve({items:{btrip1:{city:'Secret city',destination:'NRT',depart:'2026-12-01'}}});await Promise.all([first,second]);assert.equal(get('today-packing').innerHTML,'');assert.equal(get('trip-packing').innerHTML,'');
});
test('failed reads show retry and never claim no preparation is needed; member reads stay private',async()=>{
 const {c,get}=env({fbLoadTripPacking:async()=>{throw Error('offline');}});await c.renderTodayPacking();assert.equal(get('today-packing').hidden,false);assert.match(get('today-packing').innerHTML,/could not be loaded/);assert.match(get('trip-packing').innerHTML,/Reload Packing/);
 let calls=0;const m=env({daybookMember:true,fbLoadBookedTrips:async()=>{calls++;}});await m.c.renderTodayPacking();assert.equal(calls,0);assert.equal(m.get('today-packing').hidden,true);
});
test('Clothing failures preserve manual packing but block missing linked purchase readiness',async()=>{
 const {c,get,trip}=env({fbLoadShoppingPrefs:async()=>{throw Error('offline');}}),P=c.TripPacking;
 const row=P.item({id:'tops',label:'Polos',quantity:1,category:'Tops',stage:'packed',purchaseId:'order',purchaseAt:'2026-11-28T01:00:00.000Z'});
 c.fbLoadTripPacking=async()=>({btrip1:{tripKey:P.tripKey(trip),items:[row]}});await c.renderTripPacking();assert.match(get('trip-packing').innerHTML,/Manual packing is available/);assert.match(get('today-packing').innerHTML,/to prepare/);assert.doesNotMatch(get('trip-packing').innerHTML,/1\/1 packed/);
});
test('saving updates Today, preserves drafts on conflict, and rejects account changes in flight',async()=>{
 const {c,get,trip}=env();const P=c.TripPacking,row=P.item({id:'tops',label:'Polos',quantity:1,category:'Tops',stage:'needed'});let plans={btrip1:{tripKey:P.tripKey(trip),items:[row]}};
 c.fbLoadTripPacking=async()=>plans;c.fbUpdateTripPacking=async(id,cmd)=>{const r=P.apply(plans,id,trip,cmd,{});plans=r.plans;return r;};await c.renderTripPacking();
 const form=stage=>({elements:{namedItem:n=>({value:({label:'Polos',quantity:'1',category:'Tops',stage,needId:'',purchaseId:''})[n]})}});
 await c.savePackingItem('btrip1','tops',form('packed'));assert.equal(get('today-packing').hidden,true);assert.match(get('trip-packing').innerHTML,/1\/1 packed/);
 c.fbUpdateTripPacking=async()=>{throw Error('Changed on another device');};const before=get('trip-packing').innerHTML;await c.savePackingItem('btrip1','tops',form('owned'));assert.equal(get('trip-packing').innerHTML,before);assert.match(get('packing-status').textContent,/another device/);
 const d=deferred();c.fbUpdateTripPacking=()=>d.promise;const saving=c.savePackingItem('btrip1','tops',form('owned'));c._firebaseUid='other';c.resetTripPacking();d.resolve({plans,profile:null});await saving;assert.equal(get('trip-packing').innerHTML,'');
});
test('a local Clothing save supersedes a slower profile read and return signals update Today immediately',async()=>{
 const {c,get,trip}=env(),d=deferred(),P=c.TripPacking,row=P.item({id:'tops',label:'Polos',quantity:1,category:'Tops',stage:'packed',purchaseId:'order',purchaseAt:'2026-11-28T01:00:00.000Z'});
 c.fbLoadTripPacking=async()=>({btrip1:{tripKey:P.tripKey(trip),items:[row]}});c.fbLoadShoppingPrefs=()=>d.promise;
 const loading=c.renderTripPacking();await Promise.resolve();c.tripPackingClothingChanged({purchases:[{id:'order',at:row.purchaseAt,name:'Polo',tracker:{status:'returned',retailer:'Store',purchasedOn:'2026-11-27'}}]});d.resolve({purchases:[{id:'order',at:row.purchaseAt,name:'Polo',tracker:{status:'kept',retailer:'Store',purchasedOn:'2026-11-27'}}]});await loading;
 assert.match(get('trip-packing').innerHTML,/returned/);assert.equal(get('today-packing').hidden,false);
});
