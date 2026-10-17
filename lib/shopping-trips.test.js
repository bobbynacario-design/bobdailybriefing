import {test} from 'node:test';import assert from 'node:assert/strict';import './shopping-taste.js';import './shopping-style.js';import './shopping-trips.js';import './shopping-core.js';
const TR=globalThis.ShoppingTrips,S=globalThis.ShoppingStyle,C=globalThis.ShoppingCore,today='2026-10-17';
// Bob's saved trips and wardrobe as stored on 17 Oct 2026 (chinos and resort
// shirts entered as 0, as he is doing).
const trips=[
 {kind:'poker',label:'APT Championship Main Event Freezeout',city:'Taipei',checkIn:'2026-11-12',checkOut:'2026-11-15'},
 {kind:'leave',label:'Whole break',city:'Hong Kong',checkIn:'2026-12-19',checkOut:'2026-12-31'},
 {kind:'leave',label:'Whole break',city:'Kaohsiung',checkIn:'2026-12-19',checkOut:'2026-12-31'},
 {kind:'leave-fare',label:'Fare dates',city:'Hong Kong',checkIn:'2026-12-20',checkOut:'2026-12-28'},
 {kind:'leave-fare',label:'Fare dates',city:'Hong Kong',checkIn:'2026-12-23',checkOut:'2026-12-28'}];
const bob=C.cleanPrefs({taste:{colors:['Black','White','Grey','Navy','Blue','Beige','Brown','Burgundy'],patterns:['Plain'],fits:['Regular','Relaxed']},wardrobe:{'tee-light':2,'tee-dark':6,polo:5,shirt:5,resort:0,knit:2,hoodie:2,jacket:1,blazer:1,chinos:0,jeans:1,shorts:5,joggers:2,sneakers:1,trainers:1,'smart-shoes':1,sandals:1,'active-top':2,'active-shorts':3}});
const at='2026-10-17T07:00:00Z',hm={brand:'H&M',price:1000,originalPrice:2000,checkedAt:at,url:'https://www2.hm.com/en_ph/productpage.1.html',availableSizes:['M'],sizeSystem:'Labelled clothing'};
test('saved variants of one break become one trip window, with typical climate',()=>{
 const w=TR.windows(trips,today);
 assert.deepEqual(w.map(x=>[x.name,x.dates,x.nights,x.orderBy]),[['Taipei · poker trip','12–15 Nov',3,'2026-11-05'],['Hong Kong or Kaohsiung · Christmas leave','19–31 Dec',12,'2026-12-12']]);
 assert.deepEqual(w[0].climate,{low:19,high:24,wet:true,cities:['Taipei']});assert.deepEqual(w[1].climate,{low:16,high:24,wet:false,cities:['Hong Kong','Kaohsiung']});
 assert.equal(TR.windows(trips,'2027-01-02').length,0);assert.equal(TR.windows([{city:'Taipei',checkIn:'2027-06-01',checkOut:'2027-06-05'}],today).length,0);
});
test('packing needs come from trip length, climate and purpose, checked against the wardrobe',()=>{
 TR.use(trips,today);const [taipei,xmas]=TR.plan(bob);
 const row=(t,k)=>{const n=t.needs.find(x=>x.key===k);return n?[n.need,n.own,n.short]:null;};
 assert.deepEqual(row(taipei,'tops'),[4,18,0]);assert.deepEqual(row(taipei,'trousers'),[1,1,0]);assert.deepEqual(row(taipei,'layer'),[1,5,0]);assert.equal(taipei.needs.find(x=>x.key==='layer').label,'warm layer for casino air-con');
 assert.deepEqual(row(xmas,'trousers'),[2,1,1]);assert.deepEqual(row(xmas,'shoes'),[2,3,0]);assert.equal(row(xmas,'jacket'),null);assert.equal(row(xmas,'shorts'),null);
 // An unrecorded group is unknown, never a gap.
 const blank=C.cleanPrefs({wardrobe:{polo:2}});assert.equal(TR.plan(blank)[1].needs.find(x=>x.key==='trousers').short,null);
});
test('a deal that fills a trip gap says which trip and when to order, and is no longer a duplicate',()=>{
 TR.use(trips,today);
 const pants=S.verdict({...hm,id:'p',name:'Regular-Fit Chinos',category:'Trousers',color:'Navy'},bob);
 assert.equal(pants.kind,'wear');assert.match(pants.reasons[0],/For your Hong Kong or Kaohsiung · Christmas leave \(19–31 Dec, about 16–24°C\): you have 1 of the 2 chinos or jeans for evenings it needs\. Order by 12 Dec\./);
 // Bob owns one pair of jeans; jeans past the guide's one still fill the Christmas gap.
 const jeans=S.verdict({...hm,id:'j',name:'Regular Fit Jeans',category:'Trousers',color:'Black'},bob);assert.equal(jeans.kind,'wear');assert.doesNotMatch(jeans.reasons.join(' '),/Already covered/);
 // A stated conflict still shows beside the trip reason.
 const loose=S.verdict({...hm,id:'l',name:'Loose-Fit Pants',category:'Trousers',color:'Beige'},bob);assert.equal(loose.kind,'check');assert.match(loose.reasons[0],/Loose differs/);assert.match(loose.reasons[1],/Christmas leave/);
});
test('warm fabric is judged against the cool trips, not only Manila',()=>{
 TR.use(trips,today);
 // Wool-blend trousers fill the Christmas trouser gap, so the Manila warning gives way.
 const wool=S.verdict({...hm,id:'w',name:'Slim Fit Wool-Blend Pants',category:'Trousers',color:'Dark grey'},bob);assert.doesNotMatch(wool.reasons.join(' '),/Warm fabric/);assert.match(wool.reasons.join(' '),/Christmas leave/);
 // A wool blazer: both trips are covered by his five warm layers.
 const blazer=S.verdict({...hm,id:'b',name:'Regular-Fit Wool-Blend Double-Breasted Jacket',category:'Outerwear',color:'Navy',availableSizes:['48']},bob);
 assert.match(blazer.reasons.join(' '),/Warm fabric: your coming trips \(Taipei 12–15 Nov; Hong Kong or Kaohsiung 19–31 Dec\) are covered by the 5 warm layers you own/);
 TR.use([],today);assert.match(S.verdict({...hm,id:'b2',name:'Wool-Blend Blazer',category:'Outerwear',color:'Navy'},bob).reasons.join(' '),/Warm fabric for Manila/);
});
test('too close to departure, a trip gap is promising rather than worth it',()=>{
 TR.use(trips,'2026-12-14');
 const pants=S.verdict({...hm,id:'p',name:'Regular-Fit Chinos',category:'Trousers',color:'Navy'},bob);
 assert.match(pants.reasons.join(' '),/may not arrive before you leave/);assert.notEqual(pants.kind,'wear');
 TR.use([],today);
});
