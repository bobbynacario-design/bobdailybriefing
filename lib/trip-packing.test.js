import {test} from 'node:test';
import assert from 'node:assert/strict';
import './shopping-taste.js';
import './purchase-tracker.js';
import './shopping-style.js';
import './shopping-trips.js';
import './shopping-core.js';
import './trip-packing.js';
const P=globalThis.TripPacking,C=globalThis.ShoppingCore;
const trip={city:'Tokyo',destination:'NRT',depart:'2026-12-01',ret:'2026-12-08',travellers:2},id='btrip1',at='2026-11-28T01:00:00.000Z';
const row=(patch={})=>P.item({id:'tops',label:'Work tops',quantity:2,category:'Tops',stage:'needed',...patch});
const plan=(r=row())=>({tripKey:P.tripKey(trip),items:[r]});
const purchase=(status='ordered',fit='unchecked')=>({id:'purchase-1',at,name:'Two polos',piece:'polo',recordedCount:null,tracker:{status,fit}});
const put=(r,expected)=>({op:'put',id:r.id,item:r,expected,tripKey:P.tripKey(trip)});

test('editable suggestions are personal, seasonal and do not assert wardrobe ownership',()=>{
 const p=P.suggest(trip);assert.equal(p.items.find(r=>r.id==='tops').quantity,7);assert.equal(p.items.find(r=>r.id==='layer').quantity,2);assert.ok(p.items.every(r=>r.stage==='needed'));
 assert.ok(p.items.some(r=>r.label==='Toiletries'));assert.equal(P.suggest({...trip,city:'Singapore'}).items.some(r=>r.id==='shorts'),true);
 assert.equal(P.suggest({...trip,city:'Unknown'}).items.some(r=>r.id==='layer'),false);
 assert.equal(P.suggest({...trip,ret:''}).items.find(r=>r.id==='tops').quantity,2);
 assert.equal(P.today(Date.parse('2026-11-28T16:00:00Z')),'2026-11-29');
 assert.throws(()=>P.tripKey({...trip,depart:'2026-02-30'}),/valid/);
});
test('unknown wardrobe counts remain unknown and packing does not change Clothing counts',()=>{
 assert.deepEqual(P.wardrobe(row(),{wardrobe:{polo:1}}),{count:1,complete:false});
 const prefs=C.cleanPrefs({wardrobe:{polo:1}}),r=row({stage:'packed'}),result=P.apply({[id]:plan()},id,trip,put(r,row()),prefs);
 assert.equal(result.plans[id].items[0].stage,'packed');assert.equal(prefs.wardrobe.polo,1);assert.equal(result.profile,null);
});
test('purchase evidence protects ordered, missing, returned and wrong-fit items from appearing packed',()=>{
 const r=row({stage:'packed',purchaseId:'purchase-1',purchaseAt:at});
 assert.equal(P.effective(r,{purchases:[purchase()]}).stage,'ordered');
 for(const p of [purchase('returned'),purchase('return_requested'),purchase('received','small'),purchase('kept','large')]){assert.equal(P.effective(r,{purchases:[p]}).stage,'needed');assert.ok(P.effective(r,{purchases:[p]}).issue);}
 assert.equal(P.effective(r,{purchases:[]}).stage,'needed');assert.equal(P.effective(r,null).stage,'needed');
 assert.equal(P.effective(r,{purchases:[purchase('received')]}).stage,'packed');
 assert.equal(P.effective({...r,stage:'ordered'},{purchases:[purchase('received')]}).stage,'received');
 assert.throws(()=>P.apply({[id]:plan()},id,trip,put(r,row()),{purchases:[purchase()]}),/still ordered/);
 assert.throws(()=>P.apply({[id]:plan()},id,trip,put(r,row()),{purchases:[purchase('returned')]}),/returned/);
 assert.equal(P.effective(r,{purchases:[{...purchase('received'),at:'2026-11-27T01:00:00.000Z'}]}).stage,'needed');
});
test('a fulfilled linked need follows its exact purchase, without auto-packing or auto-fulfilling needs',()=>{
 const prefs=C.cleanPrefs({needs:[{id:'need',text:'Polos',fulfillment:{purchaseId:'purchase-1',purchaseAt:at,at}}],purchases:[{...purchase('received'),tracker:{...purchase('received').tracker,purchasedOn:'2026-11-27',retailer:'Test store'}}]});
 const r=row({needId:'need'});assert.equal(P.effective(r,prefs).stage,'received');
 const packed={...r,stage:'packed'},next=P.apply({[id]:plan(r)},id,trip,put(packed,r),prefs);
 assert.equal(next.plans[id].items[0].purchaseId,'purchase-1');
 const changed=C.cleanPrefs({...prefs,needs:[{...prefs.needs[0],fulfillment:null}],purchases:[{...prefs.purchases[0],tracker:{...prefs.purchases[0].tracker,status:'returned'}}]});
 assert.equal(P.effective(next.plans[id].items[0],changed).stage,'needed');assert.equal(changed.needs[0].fulfillment,null);
});
test('Today uses departure windows, hides completed or departed trips, and never equates receipt with packed',()=>{
 const booked={[id]:trip},all={[id]:plan()};
 assert.equal(P.due(booked,all,{},'2026-11-16').length,0);assert.equal(P.due(booked,all,{},'2026-11-17').length,1);
 assert.match(P.due(booked,{},null,'2026-11-28')[0].detail,/Build/);
 assert.equal(P.due(booked,{[id]:plan(row({stage:'owned'}))},{},'2026-11-27').length,0);
 assert.match(P.due(booked,{[id]:plan(row({stage:'owned'}))},{},'2026-11-28')[0].detail,/unpacked/);
 assert.equal(P.due(booked,{[id]:plan(row({stage:'packed'}))},{},'2026-12-01').length,0);
 assert.equal(P.due(booked,all,{},'2026-12-02').length,0);
 assert.match(P.due(booked,{[id]:{...plan(),items:[]}},null,'2026-11-28')[0].detail,/empty/);
 const ordered=row({stage:'packed',purchaseId:'purchase-1',purchaseAt:at});assert.match(P.due(booked,{[id]:plan(ordered)},{purchases:[purchase()]},'2026-11-28')[0].detail,/awaiting delivery/);
});
test('two trips remain independent; changed dates require review and reset packed confirmations',()=>{
 const all={[id]:plan(row({stage:'packed'}))},other='btrip2';
 const next=P.apply(all,other,trip,{op:'start',tripKey:P.tripKey(trip)},{}).plans;
 assert.equal(P.summary(next[id],{}).packed,1);assert.equal(P.summary(next[other],{}).packed,0);
 const changed={...trip,depart:'2026-12-02'};
 assert.match(P.due({[id]:changed},all,{},'2026-11-28')[0].detail,/dates/);
 assert.throws(()=>P.apply(all,id,changed,{...put(row(),all[id].items[0]),tripKey:P.tripKey(changed)},{}),/Review/);
 const reviewed=P.apply(all,id,changed,{op:'review',expected:all[id],tripKey:P.tripKey(changed)},{}).plans;
 assert.equal(reviewed[id].items[0].stage,'owned');assert.equal(reviewed[id].tripKey,P.tripKey(changed));assert.equal(all[id].items[0].stage,'packed');
});
test('row-level conflicts preserve independent edits and reject stale edits, deletion and creation',()=>{
 const a=row(),b=row({id:'shoes',label:'Shoes'}),original={[id]:{tripKey:P.tripKey(trip),items:[a,b]}};
 const remote=P.apply(original,id,trip,put({...a,stage:'owned'},a),{}).plans;
 const merged=P.apply(remote,id,trip,put({...b,stage:'packed'},b),{}).plans;
 assert.equal(merged[id].items[0].stage,'owned');assert.equal(merged[id].items[1].stage,'packed');
 assert.throws(()=>P.apply(remote,id,trip,put({...a,quantity:3},a),{}),/another device/);
 assert.throws(()=>P.apply(remote,id,trip,{op:'remove',id:a.id,expected:a,tripKey:P.tripKey(trip)},{}),/another device/);
 assert.throws(()=>P.apply(remote,id,trip,{op:'start',tripKey:P.tripKey(trip)},{}),/another device/);
 assert.throws(()=>P.plans({[id]:{...plan(),items:[a,a]}}),/Duplicate/);
});
test('creating a Clothing need is bounded, repeatable and keeps the packing link in the same result',()=>{
 const cmd={op:'need',id:'tops',expected:row(),tripKey:P.tripKey(trip)},r=P.apply({[id]:plan()},id,trip,cmd,C.cleanPrefs());
 assert.equal(r.plans[id].items[0].needId,r.profile.needs[0].id);assert.match(r.profile.needs[0].text,/Tokyo packing: 2/);assert.equal(r.profile.needs[0].category,'Tops');
 const next=P.apply(r.plans,id,trip,{...cmd,expected:r.plans[id].items[0]},r.profile);assert.equal(next.profile.needs.length,1);
 const full=C.cleanPrefs({needs:Array.from({length:10},(_,i)=>({id:'n'+i,text:'Need'}))});assert.throws(()=>P.apply({[id]:plan()},id,trip,cmd,full),/10 open/);
 assert.throws(()=>P.apply({[id]:plan(row({category:'Essentials'}))},id,trip,{...cmd,expected:row({category:'Essentials'})},C.cleanPrefs()),/clothing items/);
 assert.equal(P.apply(r.plans,id,trip,{op:'remove',id:'tops',expected:r.plans[id].items[0],tripKey:P.tripKey(trip)},r.profile).profile,null);
});
