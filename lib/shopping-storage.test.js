import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import './shopping-taste.js';
import './purchase-tracker.js';
import './shopping-style.js';
import './shopping-core.js';

const C=globalThis.ShoppingCore,at='2026-11-19T01:00:00.000Z',now=Date.parse(at);
const item={id:'polo',name:'Cotton Polo',brand:'H&M',category:'Tops',color:'Navy',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.123.html',checkedAt:at,availableSizes:['M'],sizeSystem:'Labelled clothing'};
const saved=C.cleanPrefs({saved:['polo'],savedDeals:[C.snapshot(item,at)]});

test('snapshots preserve bounded listing evidence and discard private or unsafe fields',()=>{
 const s=C.snapshot({...item,uid:'private',html:'<script>',image:'https://evil.example/image',availableSizes:['M',...Array(100).fill('L')],shipping:123},at);
 assert.equal(s.price,500);assert.equal(s.savedAt,at);assert.equal(s.availableSizes.length,30);
 assert.equal(s.uid,undefined);assert.equal(s.html,undefined);assert.equal(s.shipping,undefined);assert.equal(s.image,undefined);
 assert.equal(C.snapshot({...item,url:'javascript:alert(1)'},at),null);
 assert.equal(C.snapshot({...item,id:"bad'"},at),null);
 assert.equal(C.snapshot({...item,price:NaN},at),null);
 const p=C.cleanPrefs({...saved,savedDeals:[s,s,C.snapshot({...item,id:'unsaved'},at),null]});
 assert.equal(p.savedDeals.length,1);assert.equal(p.savedDeals[0].price,500);
 assert.equal(C.cleanPrefs({...p,saved:[]}).savedDeals.length,0);
});

test('saved history survives missing feeds, expired listings, stock changes and recommendation filters',()=>{
 const hidden={...saved,brands:[],brandsSeen:C.BRANDS,wardrobe:{polo:20},taste:{budgets:{Tops:1}}};
 let rows=C.savedItems({items:[]},hidden,{confirmed:true,wear:true,need:'unknown'},now);
 assert.equal(rows.length,1);assert.match(rows[0].status,/Not in latest scout/);assert.equal(rows[0].snapshot.price,500);
 assert.match(C.savedItems(null,saved,{},now)[0].status,/Scout unavailable/);
 const expired=C.cleanPrefs({saved:['polo'],savedDeals:[C.snapshot({...item,validTo:'2026-11-18'},at)]});
 assert.equal(C.savedItems({items:[]},expired,{},now)[0].kind,'expired');
 assert.equal(C.savedItems({items:[{...item,checkedAt:'2026-11-01T00:00:00Z'}]},saved,{},now)[0].kind,'old');
 assert.equal(C.savedItems({items:[{...item,availableSizes:['L']}]},saved,{},now)[0].kind,'size');
 assert.equal(C.savedItems({items:[{...item,originalPrice:500}]},saved,{},now)[0].kind,'regular');
 assert.equal(C.savedItems({items:[]},saved,{brand:'Nike'},now).length,0);
 assert.equal(C.savedItems({items:[]},saved,{category:'Footwear'},now).length,0);
});

test('saved prices remain immutable and unavailable legacy details are removable placeholders',()=>{
 const r=C.savedItems({items:[{...item,price:400}]},saved,{},now)[0];
 assert.equal(r.kind,'changed');assert.equal(r.snapshot.price,500);assert.equal(r.current.price,400);
 assert.equal(saved.savedDeals[0].price,500);
 const legacy=C.savedItems({items:[]},{saved:['old-id']},{},now)[0];
 assert.equal(legacy.id,'old-id');assert.match(legacy.status,/Older save/);assert.equal(legacy.current,null);
});

test('three-way profile merge preserves independent device edits down to individual fields',()=>{
 const base=C.cleanPrefs({wardrobe:{polo:1,chinos:1},needs:[{id:'work',text:'Polos',budget:1000}]}),remote=C.cleanPrefs({...base,shoeSize:9,wardrobe:{...base.wardrobe,chinos:2},taste:{colors:['Navy'],budgets:{Tops:1200}},needs:[{...base.needs[0],text:'Work polos'}]});
 const next=C.cleanPrefs({...base,clothingSize:'L',wardrobe:{...base.wardrobe,polo:2},taste:{fits:['Regular'],budgets:{Footwear:3000}},needs:[{...base.needs[0],budget:1500}]});
 const merged=C.mergePrefs(remote,base,next);
 assert.equal(merged.shoeSize,9);assert.equal(merged.clothingSize,'L');assert.deepEqual(merged.wardrobe,{polo:2,chinos:2});
 assert.deepEqual(merged.taste.colors,['Navy']);assert.deepEqual(merged.taste.fits,['Regular']);assert.equal(merged.taste.budgets.Tops,1200);assert.equal(merged.taste.budgets.Footwear,3000);
 assert.equal(merged.needs[0].text,'Work polos');assert.equal(merged.needs[0].budget,1500);
});

test('concurrent list additions, removals and checkbox changes merge without reviving deleted records',()=>{
 const base=C.cleanPrefs({saved:['old'],brands:C.BRANDS,needs:[{id:'old-need',text:'Old'}]});
 const remote=C.cleanPrefs({...base,saved:['remote'],brands:base.brands.filter(b=>b!=='Nike'),needs:[]});
 const next=C.cleanPrefs({...base,saved:['old','local'],brands:base.brands.filter(b=>b!=='H&M'),needs:[...base.needs,{id:'new',text:'New'}]});
 const merged=C.mergePrefs(remote,base,next);
 assert.deepEqual(merged.saved,['remote','local']);assert.deepEqual(merged.needs.map(n=>n.id),['new']);
 assert.ok(!merged.brands.includes('Nike'));assert.ok(!merged.brands.includes('H&M'));
 assert.deepEqual(C.mergePrefs({...saved,saved:[],savedDeals:[]},saved,{...saved,shoeSize:9}).savedDeals,[]);
});

test('conflicting scalar or deleted-record edits reject the whole save',()=>{
 const base=C.cleanPrefs({shoeSize:8.5,needs:[{id:'work',text:'Polos'}]});
 assert.throws(()=>C.mergePrefs({...base,shoeSize:9},base,{...base,shoeSize:10}),{code:'shopping-conflict'});
 assert.throws(()=>C.mergePrefs({...base,needs:[]},base,{...base,needs:[{...base.needs[0],text:'Edited'}]}),{code:'shopping-conflict'});
 assert.equal(C.mergePrefs({...base,shoeSize:9},base,{...base,shoeSize:9}).shoeSize,9);
 const full=C.cleanPrefs({needs:Array.from({length:9},(_,n)=>({id:'n'+n,text:'Need '+n}))});
 assert.throws(()=>C.mergePrefs({...full,needs:[...full.needs,{id:'remote',text:'Remote'}]},full,{...full,needs:[...full.needs,{id:'local',text:'Local'}]}),{code:'shopping-limit'});
});

test('purchase records and wardrobe totals commit together or conflict together, including matching stale totals',()=>{
 const base=C.cleanPrefs({wardrobe:{polo:0}}),a=globalThis.ShoppingStyle.bought(base,item,'polo',1,at),b=globalThis.ShoppingStyle.bought(base,{...item,id:'other'},'polo',1,at);
 assert.throws(()=>C.mergePrefs(a,base,b),{code:'shopping-conflict'});
 assert.throws(()=>C.mergePrefs({...base,wardrobe:{polo:3}},base,a),{code:'shopping-conflict'});
 const result=C.mergePrefs({...base,shoeSize:10},base,a);
 assert.equal(result.shoeSize,10);assert.equal(result.wardrobe.polo,1);assert.equal(result.purchases.length,1);
 const undo=globalThis.ShoppingStyle.undoBought(a,'polo').prefs;
 assert.throws(()=>C.mergePrefs({...a,wardrobe:{polo:2}},a,undo),{code:'shopping-conflict'});
});

function bridge(){
 const docs=new Map(),writes=[];let uid='owner',retry=null;
 const c={URL,Date,Intl,TextEncoder,db:{},COLL:'briefings-bob',getUid:()=>uid,doc:(db,coll,key)=>key,
   runTransaction:async(db,fn)=>{
     const run=async(commit)=>fn({get:async key=>({exists:()=>docs.has(key),data:()=>docs.get(key)}),set:(key,data)=>{if(commit){docs.set(key,data);writes.push(key);}}});
     if(retry){await run(false);const change=retry;retry=null;change();}return run(true);
   }};
 c.window=c;vm.createContext(c);
 for(const f of ['shopping-taste','purchase-tracker','shopping-style','shopping-core'])vm.runInContext(readFileSync(new URL('./'+f+'.js',import.meta.url),'utf8'),c);
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('window.fbSaveShoppingPrefs =');
 vm.runInContext(html.slice(start,html.indexOf('\n};',start)+3),c);
 return {c,docs,writes,account:value=>uid=value,retry:fn=>retry=fn};
}

test('production Firestore transaction reads the latest profile on retry and returns merged state',async()=>{
 const {c,docs,writes,retry}=bridge(),base=C.cleanPrefs({saved:['polo']});
 docs.set('shopping-prefs-owner',{...base,shoeSize:9});
 retry(()=>docs.set('shopping-prefs-owner',{...base,shoeSize:10,saved:['polo','remote']}));
 const result=await c.fbSaveShoppingPrefs({...base,clothingSize:'L'},base);
 assert.equal(result.shoeSize,10);assert.equal(result.clothingSize,'L');assert.deepEqual(Array.from(result.saved),['polo','remote']);
 assert.deepEqual(writes,['shopping-prefs-owner']);assert.equal(docs.get(writes[0]).uid,'owner');
 const stale=C.cleanPrefs(result);
 docs.set(writes[0],{...result,shoeSize:11});
 await assert.rejects(c.fbSaveShoppingPrefs({...stale,shoeSize:12},stale),{code:'shopping-conflict'});
 assert.equal(writes.length,1);assert.equal(docs.get(writes[0]).shoeSize,11);
});

test('production bridge requires a baseline and account, and can initialise a new profile',async()=>{
 const {c,docs,writes,account}=bridge();
 await assert.rejects(c.fbSaveShoppingPrefs({}),/Reload/);assert.equal(writes.length,0);
 await c.fbSaveShoppingPrefs({...C.cleanPrefs(),saved:['polo'],savedDeals:[C.snapshot(item,at)]},C.cleanPrefs());
 assert.equal(docs.get('shopping-prefs-owner').savedDeals[0].price,500);
 account(null);await assert.rejects(c.fbSaveShoppingPrefs({},{}),/Sign in/);
});

test('account changes during transaction reads prevent a write to the previous account',async()=>{
 const {c,account}=bridge();
 c.runTransaction=async(db,fn)=>fn({get:async()=>{account('other');return {exists:()=>false};},set:()=>assert.fail('must not write after an account change')});
 await assert.rejects(c.fbSaveShoppingPrefs(C.cleanPrefs(),C.cleanPrefs()),/Account changed/);
});

test('production transaction commits a linked need, purchase and wardrobe total in one write',async()=>{
 const {c,docs,writes}=bridge(),base=C.cleanPrefs({needs:[{id:'work',text:'Work polos'}],wardrobe:{polo:0,chinos:1}}),next=C.recordPurchase(base,item,'polo',1,'work',at);
 docs.set('shopping-prefs-owner',{...base,shoeSize:10});
 const result=await c.fbSaveShoppingPrefs(next,base),stored=docs.get('shopping-prefs-owner');
 assert.deepEqual(writes,['shopping-prefs-owner']);assert.equal(stored.wardrobe.polo,1);assert.equal(stored.wardrobe.chinos,1);assert.equal(stored.shoeSize,10);
 assert.equal(stored.purchases[0].needId,'work');assert.equal(stored.needs[0].fulfillment.purchaseId,'polo');assert.equal(result.needs[0].fulfillment.purchaseAt,result.purchases[0].at);
});

test('a need edited during transaction retry leaves the purchase, count and completion unwritten',async()=>{
 const {c,docs,writes,retry}=bridge(),base=C.cleanPrefs({needs:[{id:'work',text:'Work polos',budget:1000}],wardrobe:{polo:0}}),next=C.recordPurchase(base,item,'polo',1,'work',at);
 docs.set('shopping-prefs-owner',base);retry(()=>docs.set('shopping-prefs-owner',{...base,needs:[{...base.needs[0],budget:300}]}));
 await assert.rejects(c.fbSaveShoppingPrefs(next,base),{code:'shopping-conflict'});
 const stored=docs.get('shopping-prefs-owner');assert.equal(writes.length,0);assert.equal(stored.purchases.length,0);assert.equal(stored.wardrobe.polo,0);assert.equal(stored.needs[0].fulfillment,null);assert.equal(stored.needs[0].budget,300);
});

test('production tracker transaction commits return history, chosen wardrobe and need changes together',async()=>{
 const {c,docs,writes}=bridge(),base=C.recordPurchase({wardrobe:{polo:0},needs:[{id:'work',text:'Work polos'}]},item,'polo',1,'work',at,{status:'received',retailer:'H&M',purchasedOn:'2026-11-18',amountPaid:450});docs.set('shopping-prefs-owner',{...base,shoeSize:10});
 const next=C.updateTrackedPurchase(base,'polo',{status:'returned'},{adjustWardrobe:true,reopenNeed:true},at).prefs,result=await c.fbSaveShoppingPrefs(next,base);assert.equal(writes.length,1);assert.equal(result.wardrobe.polo,0);assert.equal(result.needs[0].fulfillment,null);assert.equal(result.purchases[0].tracker.status,'returned');assert.equal(result.purchases[0].tracker.amountPaid,450);assert.equal(result.shoeSize,10);
});
test('a later wardrobe change during return transaction retry prevents every part of the stale return write',async()=>{
 const {c,docs,writes,retry}=bridge(),base=C.recordPurchase({wardrobe:{polo:0},needs:[{id:'work',text:'Work polos'}]},item,'polo',1,'work',at,{status:'received',retailer:'H&M',purchasedOn:'2026-11-18'}),next=C.updateTrackedPurchase(base,'polo',{status:'returned'},{adjustWardrobe:true,reopenNeed:true},at).prefs;docs.set('shopping-prefs-owner',base);retry(()=>docs.set('shopping-prefs-owner',{...base,wardrobe:{polo:3}}));
 await assert.rejects(c.fbSaveShoppingPrefs(next,base),{code:'shopping-conflict'});assert.equal(writes.length,0);assert.equal(docs.get('shopping-prefs-owner').purchases[0].tracker.status,'received');assert.ok(docs.get('shopping-prefs-owner').needs[0].fulfillment);
});
test('independent tracker notes and paid amount edits merge without conflicting on bookkeeping timestamps',()=>{
 const base=C.recordPurchase({},item,'','','',at,{status:'received',retailer:'H&M',purchasedOn:'2026-11-18',amountPaid:450}),a=C.updateTrackedPurchase(base,'polo',{notes:'Fits well'}, {},'2026-11-19T02:00:00Z').prefs,b=C.updateTrackedPurchase(base,'polo',{amountPaid:425.5}, {},'2026-11-19T03:00:00Z').prefs,result=C.mergePrefs(b,base,a);assert.equal(result.purchases[0].tracker.notes,'Fits well');assert.equal(result.purchases[0].tracker.amountPaid,425.5);assert.equal(result.purchases[0].tracker.updatedAt,'2026-11-19T03:00:00.000Z');
});
