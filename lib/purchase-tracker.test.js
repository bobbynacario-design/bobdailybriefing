import {test} from 'node:test';import assert from 'node:assert/strict';
import './shopping-taste.js';import './purchase-tracker.js';import './shopping-style.js';import './shopping-core.js';
const P=globalThis.PurchaseTracker,C=globalThis.ShoppingCore,S=globalThis.ShoppingStyle;
const at='2026-11-28T01:00:00.000Z',now=Date.parse(at),item={id:'polo',name:'Cotton Polo',brand:'H&M',category:'Tops',price:500,originalPrice:1000};
const details={status:'received',retailer:'H&M',purchasedOn:'2026-11-25',amountPaid:425.50,receivedOn:'2026-11-27',fit:'fits',returnBy:'2026-11-29',returnByConfirmed:true};
const initial=C.cleanPrefs({wardrobe:{polo:0,chinos:1},needs:[{id:'work',text:'Work polos'}],shoeSize:8.5});
function bought(){return C.recordPurchase(initial,item,'polo',1,'work',at,details);}
test('actual paid amounts and confirmed dates are separate from scout quotes; legacy purchases gain no invented tracking',()=>{
 const next=bought(),p=next.purchases[0];assert.equal(p.tracker.amountPaid,425.5);assert.equal(item.price,500);assert.equal(p.tracker.returnBy,'2026-11-29');assert.equal(p.tracker.fit,'fits');
 assert.equal(S.cleanPurchases([{id:'old',at,name:'Legacy'}])[0].tracker,undefined);assert.equal(P.clean({...details,amountPaid:''}).amountPaid,null);assert.equal(P.validate({...details,amountPaid:0},now).amountPaid,0);
 for(const invalid of [{purchasedOn:'2026-02-30'},{purchasedOn:'2026-11-29'},{amountPaid:-1},{amountPaid:1.001},{amountPaid:true},{amountPaid:Infinity},{receivedOn:'2026-11-29'},{returnBy:'2026-11-24'},{returnByConfirmed:false},{currency:'USD'}])assert.throws(()=>P.validate({...details,...invalid},now));
});
test('orders cannot add usable wardrobe counts or fulfil needs; receipt counting is explicit and applied only once',()=>{
 const ordered=C.recordPurchase(initial,item,'polo',1,'',at,{...details,status:'ordered',receivedOn:'',fit:'unchecked'});assert.equal(ordered.wardrobe.polo,0);assert.equal(ordered.purchases[0].recordedCount,null);assert.equal(ordered.needs[0].fulfillment,null);assert.equal(S.verdict(item,ordered,now).label,'Already ordered');
 assert.throws(()=>C.fulfilNeed(ordered,'work','polo',at),/ordered or returned/);
 const received=C.updateTrackedPurchase(ordered,'polo',{status:'received',receivedOn:'2026-11-28'}, {},at).prefs;assert.equal(received.wardrobe.polo,0);
 const counted=C.updateTrackedPurchase(received,'polo',{}, {piece:'polo',total:'1'},at).prefs;assert.equal(counted.wardrobe.polo,1);assert.equal(counted.purchases[0].previousCount,0);
 assert.throws(()=>C.updateTrackedPurchase(counted,'polo',{}, {piece:'polo',total:'2'},at),/already been counted/);
 assert.throws(()=>C.recordPurchase(initial,item,'polo',1,'work',at,{...details,status:'ordered',receivedOn:'',fit:'unchecked'}),/order cannot fulfil/);
});
test('Today actions use Philippine dates, user-entered follow-ups and a two-day return window',()=>{
 const purchase=bought().purchases[0];assert.equal(P.due([purchase],'2026-11-26').length,0);assert.equal(P.due([purchase],'2026-11-27')[0].type,'return');assert.equal(P.due([purchase],'2026-11-30')[0].overdue,true);
 assert.equal(P.today(Date.parse('2026-11-27T16:00:00Z')),'2026-11-28');
 assert.equal(P.due([{...purchase,tracker:{...purchase.tracker,returnByConfirmed:false}}],'2026-11-28').length,0);
 const ordered={...purchase,tracker:{...purchase.tracker,status:'ordered',followUpOn:'2026-11-28',returnBy:''}};assert.equal(P.due([ordered],'2026-11-27').length,0);assert.equal(P.due([ordered],'2026-11-28')[0].type,'delivery');
 assert.equal(P.due([{...purchase,tracker:{...purchase.tracker,status:'kept'}}],'2026-11-28').length,0);assert.equal(P.due([{...purchase,tracker:{...purchase.tracker,status:'returned'}}],'2026-11-28').length,0);
 assert.equal(P.due([{...purchase,tracker:{...purchase.tracker,status:'return_requested',followUpOn:'2026-11-28'}}],'2026-11-28').length,2);
});
test('recording a return alone preserves wardrobe and need; selected adjustments apply atomically once and retain history',()=>{
 const base=bought(),before=JSON.stringify(base),plain=C.updateTrackedPurchase(base,'polo',{status:'returned'}, {},at).prefs;assert.equal(plain.wardrobe.polo,1);assert.ok(plain.needs[0].fulfillment);assert.equal(plain.purchases.length,1);assert.equal(plain.purchases[0].tracker.status,'returned');assert.equal(JSON.stringify(base),before);
 const r=C.updateTrackedPurchase(base,'polo',{status:'returned'}, {adjustWardrobe:true,reopenNeed:true},at).prefs;assert.equal(r.wardrobe.polo,0);assert.equal(r.needs[0].fulfillment,null);assert.equal(r.purchases[0].needId,'');assert.equal(r.purchases[0].tracker.effects.wardrobeAdjusted,true);assert.equal(r.purchases[0].tracker.effects.needReopened,true);assert.equal(r.purchases[0].tracker.amountPaid,425.5);assert.equal(P.due(r.purchases,'2026-11-28').length,0);
 assert.equal(C.updateTrackedPurchase(r,'polo',{}, {adjustWardrobe:true,reopenNeed:true},at).prefs.wardrobe.polo,0);assert.equal(C.undoPurchase(r,'polo').prefs.wardrobe.polo,0,'undo cannot apply a return adjustment twice');
 assert.throws(()=>C.fulfilNeed(r,'work','polo',at),/ordered or returned/);assert.throws(()=>C.updateTrackedPurchase(r,'polo',{status:'kept'}, {},at),/returned record/);
});
test('later wardrobe edits and later need completions are protected; a full need list cannot cause a partial adjustment',()=>{
 const base=bought(),changed={...base,wardrobe:{...base.wardrobe,polo:3},needs:base.needs.map(n=>({...n,fulfillment:{...n.fulfillment,purchaseId:'other'}}))},r=C.updateTrackedPurchase(changed,'polo',{status:'returned'},{adjustWardrobe:true,reopenNeed:true},at);assert.equal(r.prefs.wardrobe.polo,3);assert.equal(r.prefs.needs[0].fulfillment.purchaseId,'other');assert.ok(r.wardrobeReview);assert.ok(r.needReview);
 const full={...base,needs:base.needs.concat(Array.from({length:10},(_,n)=>({id:'n'+n,text:'Other need '+n})))},before=JSON.stringify(full);assert.throws(()=>C.updateTrackedPurchase(full,'polo',{status:'returned'},{adjustWardrobe:true,reopenNeed:true},at),/open shopping-need slot/);assert.equal(JSON.stringify(full),before);
 const unknown=C.recordPurchase(C.cleanPrefs({needs:[]}),item,'polo',1,'',at,details),undone=C.updateTrackedPurchase(unknown,'polo',{status:'returned'},{adjustWardrobe:true},at).prefs;assert.equal(undone.wardrobe.polo,undefined,'an unrecorded earlier count returns to unknown');
});
test('a repurchase is a separate record and the old returned item cannot suppress it or claim a fulfilled need',()=>{
 const returned=C.updateTrackedPurchase(bought(),'polo',{status:'returned'},{adjustWardrobe:true,reopenNeed:true},at).prefs,next=C.recordPurchase(returned,item,'polo',1,'work','2026-11-28T02:00:00.000Z',details),p=C.purchaseForListing(next,'polo');assert.equal(next.purchases.length,2);assert.notEqual(p.id,'polo');assert.equal(p.listingId,'polo');assert.equal(next.needs[0].fulfillment.purchaseId,p.id);assert.equal(next.purchases[0].tracker.status,'returned');
});
test('concurrent purchase lifecycle and wardrobe edits conflict, while independent profile fields survive',()=>{
 const base=bought(),next=C.updateTrackedPurchase(base,'polo',{status:'returned'},{adjustWardrobe:true,reopenNeed:true},at).prefs;
 assert.throws(()=>C.mergePrefs({...base,wardrobe:{...base.wardrobe,polo:3}},base,next),{code:'shopping-conflict'});assert.throws(()=>C.mergePrefs({...base,purchases:base.purchases.map(p=>({...p,tracker:{...p.tracker,amountPaid:600}}))},base,next),{code:'shopping-conflict'});
 const merged=C.mergePrefs({...base,shoeSize:9},base,next);assert.equal(merged.shoeSize,9);assert.equal(merged.wardrobe.polo,0);assert.equal(merged.needs[0].fulfillment,null);
});

test('record limits reject additions and concurrent overflows instead of evicting unresolved purchases',()=>{
 const old=Array.from({length:99},(_,n)=>({id:'old'+n,name:'Order '+n,at})),base=C.cleanPrefs({purchases:old}),a=C.recordPurchase(base,{id:'new-a',name:'New A'},'','','',at,details),b=C.recordPurchase(base,{id:'new-b',name:'New B'},'','','',at,details);assert.throws(()=>C.mergePrefs(b,base,a),{code:'shopping-limit'});assert.throws(()=>C.recordPurchase(a,{id:'new-c',name:'New C'},'','','',at,details),/100 purchase records/);assert.equal(a.purchases.length,100);
});
