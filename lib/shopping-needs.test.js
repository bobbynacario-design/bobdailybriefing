import {test} from 'node:test';
import assert from 'node:assert/strict';
import './shopping-taste.js';import './shopping-style.js';import './shopping-core.js';
const C=globalThis.ShoppingCore,S=globalThis.ShoppingStyle,at='2026-11-19T01:00:00Z',now=Date.parse(at);
const item={id:'polo',brand:'H&M',name:'Plain Cotton Polo',color:'Navy',category:'Tops',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.1.html',checkedAt:at,availableSizes:['M'],sizeSystem:'Labelled clothing'};
const need={id:'work',text:'Work polos',category:'Tops',garment:'Polo',budget:700};
const base=C.cleanPrefs({needs:[need],wardrobe:{polo:0,chinos:1},wardrobeColors:{chinos:['Navy']},saved:['polo'],brandSizes:{Nike:{shoeSize:9}}});

test('one-category wardrobe updates distinguish zero from unknown and preserve other profile fields',()=>{
 const unknown=C.cleanPrefs({...base,wardrobe:{chinos:1}}),zero=S.setWardrobeCount(unknown,'polo','0');
 assert.deepEqual(zero.wardrobe,{chinos:1,polo:0});assert.equal(unknown.wardrobe.polo,undefined);
 const counted=S.setWardrobeCount(zero,'polo','2');assert.equal(counted.wardrobe.polo,2);
 assert.deepEqual(S.setWardrobeCount(counted,'polo','').wardrobe,{chinos:1});
 for(const value of ['-1','1.5','21',true,'invalid'])assert.throws(()=>S.setWardrobeCount(base,'polo',value),/from 0 to 20/);
 assert.throws(()=>S.setWardrobeCount(base,'invented','1'),/category/);
 assert.deepEqual(counted.wardrobeColors,base.wardrobeColors);assert.deepEqual(counted.needs,base.needs);assert.deepEqual(counted.brandSizes,base.brandSizes);assert.deepEqual(counted.saved,base.saved);
 const remote=S.setWardrobeCount(unknown,'chinos',3),merged=C.mergePrefs(remote,unknown,counted);assert.equal(merged.wardrobe.chinos,3);assert.equal(merged.wardrobe.polo,2);
 assert.throws(()=>C.mergePrefs(S.setWardrobeCount(base,'polo',3),base,S.setWardrobeCount(base,'polo',2)),{code:'shopping-conflict'});
});

test('legacy needs stay open; fulfilled history is separate, deduplicated and bounded by completion date',()=>{
 assert.equal(base.needs[0].fulfillment,null);assert.equal(C.openNeeds(base).length,1);
 const rows=Array.from({length:55},(_,n)=>({...need,id:'done-'+n,fulfillment:{purchaseId:'',at:new Date(now-n*86400000).toISOString()}}));
 const p=C.cleanPrefs({needs:[need,...rows,need,{...need,id:'broken',fulfillment:{purchaseId:'bad!',at}}]});
 assert.deepEqual(C.openNeeds(p).map(n=>n.id),['work','broken']);assert.equal(p.needs.filter(n=>n.fulfillment).length,50);
 assert.ok(!p.needs.some(n=>n.id==='done-54'));assert.ok(p.needs.some(n=>n.id==='done-0'));
 assert.deepEqual(C.cleanPrefs(p).needs,p.needs);
});

test('Browse all and All open needs have different results; needs are OR matches and fulfilled needs do not filter',()=>{
 const shoe={...item,id:'shoe',brand:'Nike',name:'Sneakers',category:'Footwear',sizeSystem:'US men',availableSizes:['8.5']},shirt={...item,id:'shirt',name:'Cotton Shirt'},p=C.cleanPrefs({needs:[need,{...need,id:'also-polo',text:'Another polo need'},{id:'shoes',text:'Shoes',category:'Footwear'}]});
 const feed={items:[item,shoe,shirt]};
 assert.equal(C.matchItems(feed,p,{},now).length,3);assert.deepEqual(new Set(C.matchItems(feed,p,{need:C.OPEN_NEEDS},now).map(i=>i.id)),new Set(['polo','shoe']));
 const counts=C.needCounts(feed,p,{query:'cotton'},now);assert.equal(counts.total,1);assert.deepEqual(counts.rows.map(r=>r.count),[1,1,0]);
 const done=C.fulfilNeed(p,'work','',at);assert.equal(C.matchItems(feed,done,{need:'work'},now).length,0);
 assert.equal(C.needCounts(feed,done,{},now).rows.length,2);
 assert.equal(C.matchItems(feed,C.fulfilNeed(base,'work','',at),{need:C.OPEN_NEEDS},now).length,0);
 assert.equal(C.matchItems(feed,p,{need:'missing'},now).length,0);
});

test('purchase fulfillment is explicit, affects one need and stores the wardrobe and purchase link together',()=>{
 const p=C.cleanPrefs({...base,needs:[need,{...need,id:'other',text:'Other polos'}]});
 const unlinked=C.recordPurchase(p,item,'polo',1,'',at);assert.equal(C.openNeeds(unlinked).length,2);assert.equal(unlinked.purchases[0].needId,'');
 const linked=C.recordPurchase(p,item,'polo',1,'work',at);assert.equal(linked.wardrobe.polo,1);assert.equal(linked.purchases[0].needId,'work');
 const fulfilled=linked.needs.find(n=>n.id==='work');assert.equal(fulfilled.fulfillment.purchaseId,'polo');assert.equal(fulfilled.fulfillment.purchaseAt,linked.purchases[0].at);assert.equal(fulfilled.fulfillment.purchaseName,item.name);assert.equal(C.openNeeds(linked).length,1);
 assert.equal(p.wardrobe.polo,0);assert.equal(p.purchases.length,0);assert.equal(C.openNeeds(p).length,2);
 assert.throws(()=>C.recordPurchase(p,item,'polo',1,'missing',at),/no longer open/);assert.equal(p.purchases.length,0);
});

test('existing purchases can fulfil needs without changing counts, and must release a linked need before switching',()=>{
 const p=C.cleanPrefs({...base,needs:[need,{...need,id:'other',text:'Other need'}]}),recorded=C.recordPurchase(p,item,'polo',1,'',at),linked=C.fulfilNeed(recorded,'work','polo');
 assert.deepEqual(linked.wardrobe,recorded.wardrobe);assert.equal(linked.purchases.length,1);assert.equal(linked.purchases[0].needId,'work');
 assert.throws(()=>C.fulfilNeed(linked,'other','polo'),/already fulfils/);
 const reopened=C.reopenNeed(linked,'work');assert.equal(reopened.purchases[0].needId,'');assert.equal(C.openNeeds(reopened).length,2);
 const switched=C.fulfilNeed(reopened,'other','polo');assert.equal(C.openNeeds(switched)[0].id,'work');assert.equal(switched.purchases[0].needId,'other');
 const manual=C.fulfilNeed(p,'work','',at);assert.equal(manual.purchases.length,0);assert.equal(manual.needs.find(n=>n.id==='work').fulfillment.purchaseId,'');
});

test('undo purchase reopens its unchanged need while preserving later wardrobe counts and later completion links',()=>{
 const linked=C.recordPurchase(base,item,'polo',1,'work',at),undo=C.undoPurchase(linked,'polo');
 assert.equal(undo.reopened,true);assert.equal(undo.prefs.wardrobe.polo,0);assert.equal(undo.prefs.purchases.length,0);assert.equal(C.openNeeds(undo.prefs).length,1);
 const changed=S.setWardrobeCount(linked,'polo',4),safe=C.undoPurchase(changed,'polo');assert.equal(safe.review,true);assert.equal(safe.prefs.wardrobe.polo,4);assert.equal(safe.reopened,true);
 const reopened=C.reopenNeed(linked,'work'),again=C.recordPurchase(reopened,{...item,id:'second'},'polo',2,'work','2026-11-19T02:00:00Z'),later=C.undoPurchase(again,'polo');
 assert.equal(later.prefs.needs.find(n=>n.id==='work').fulfillment.purchaseId,'second');assert.equal(later.prefs.purchases[0].id,'second');assert.equal(later.prefs.wardrobe.polo,2);
});

test('fulfilled needs free open slots, and reopening or undo cannot silently drop a need when the list is full',()=>{
 const ten=Array.from({length:10},(_,n)=>({...need,id:'open-'+n})),full=C.cleanPrefs({needs:ten}),done=C.fulfilNeed(full,'open-0','',at);
 assert.equal(C.openNeeds(done).length,9);const added=C.cleanPrefs({...done,needs:[...done.needs,need]});assert.equal(C.openNeeds(added).length,10);assert.equal(added.needs.length,11);
 assert.throws(()=>C.reopenNeed(added,'open-0'),/ten open/);
 const bought=C.recordPurchase(base,item,'polo',1,'work',at),busy=C.cleanPrefs({...bought,needs:[...ten,...bought.needs]});
 assert.throws(()=>C.undoPurchase(busy,'polo'),/open shopping-list slot/);assert.equal(busy.purchases.length,1);assert.equal(busy.wardrobe.polo,1);assert.equal(busy.needs.find(n=>n.id==='work').fulfillment.purchaseId,'polo');
});

test('cross-device fulfillment and need edits conflict atomically instead of silently changing purchase requirements',()=>{
 const linked=C.recordPurchase(base,item,'polo',1,'work',at),edited=C.cleanPrefs({...base,needs:[{...need,budget:300}]});
 assert.throws(()=>C.mergePrefs(edited,base,linked),{code:'shopping-conflict'});
 assert.throws(()=>C.mergePrefs(linked,base,edited),{code:'shopping-conflict'});
 const another=C.recordPurchase(base,{...item,id:'other'},'shirt',1,'work',at);assert.throws(()=>C.mergePrefs(linked,base,another),{code:'shopping-conflict'});
 const remote=C.cleanPrefs({...base,shoeSize:10,wardrobe:{...base.wardrobe,chinos:3}}),merged=C.mergePrefs(remote,base,linked);assert.equal(merged.shoeSize,10);assert.equal(merged.wardrobe.chinos,3);assert.equal(merged.purchases[0].needId,'work');assert.equal(C.openNeeds(merged).length,0);
});

test('link-only purchase changes merge with independent wardrobe edits and independent need completions',()=>{
 const p=C.recordPurchase(base,item,'polo',1,'',at),next=C.fulfilNeed(p,'work','polo'),remote=S.setWardrobeCount(p,'polo',4),merged=C.mergePrefs(remote,p,next);
 assert.equal(merged.wardrobe.polo,4);assert.equal(merged.purchases[0].needId,'work');assert.equal(merged.needs[0].fulfillment.purchaseId,'polo');
 const two=C.cleanPrefs({...base,needs:[need,{...need,id:'second',text:'Second need'}]}),a=C.fulfilNeed(two,'work','',at),b=C.fulfilNeed(two,'second','',at);
 assert.equal(C.openNeeds(C.mergePrefs(a,two,b)).length,0);
});

test('completion history uses the completion date while undo identifies the exact earlier purchase',()=>{
 const recorded=C.recordPurchase(base,item,'polo',1,'',at),completedAt='2026-12-01T01:00:00Z',linked=C.fulfilNeed(recorded,'work','polo',completedAt),f=linked.needs[0].fulfillment;
 assert.equal(f.at,'2026-12-01T01:00:00.000Z');assert.equal(f.purchaseAt,'2026-11-19T01:00:00.000Z');
 assert.equal(C.undoPurchase(linked,'polo').reopened,true);assert.equal(C.reopenNeed(linked,'work').purchases[0].needId,'');
});
