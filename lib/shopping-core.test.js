import {test} from 'node:test';import assert from 'node:assert/strict';import './shopping-taste.js';import './shopping-core.js';
const C=globalThis.ShoppingCore,now=Date.parse('2026-10-17T04:00:00Z');
const item={id:'hm123',brand:'H&M',category:'Tops',price:500,originalPrice:1000,checkedAt:'2026-10-17T03:00:00Z',url:'https://www2.hm.com/en_ph/productpage.123.html',channel:'online',sizeSystem:'Labelled clothing',availableSizes:['M']};
test('variant minimums cannot satisfy a budget and online offers respect dates and retailer preferences',()=>{
 const p=C.cleanPrefs({needs:[{id:'budget',text:'Tops',category:'Tops',budget:600}]});
 assert.equal(C.matchItems({items:[{...item,priceFrom:true}]},p,{need:'budget'},now).length,0);
 assert.equal(C.matchItems({items:[{...item,priceFrom:true}]},p,{},now).length,1);
 for(const dates of [{validTo:'2026-10-16'},{validFrom:'2026-10-18'}])assert.equal(C.matchItems({items:[{...item,...dates}]},p,{},now).length,0);
 assert.equal(C.matchItems({items:[{...item,retailer:'ZALORA'}]},C.cleanPrefs({brands:['H&M']}),{},now).length,0);
});
test('profile uses the confirmed brands, areas and sizes; links stay on official HTTPS domains',()=>{
 const p=C.cleanPrefs();assert.equal(p.clothingSize,'M');assert.equal(p.americanSize,'S');assert.equal(p.shoeSize,8.5);assert.ok(p.areas.includes('Ortigas'));
 for(const u of ['javascript:alert(1)','https://www2.hm.com.evil.test/x','https://user@www.nike.com/ph','http://www.nike.com/ph'])assert.equal(C.safeUrl(u),'');
});
test('size matching never converts mens US 8.5 to a nearby size or a womens/unlabelled size',()=>{
 const p=C.cleanPrefs();assert.equal(C.sizeMatch(item,p),'match');assert.equal(C.sizeMatch({...item,sizeSystem:'US clothing',availableSizes:['S']},p),'match');
 for(const sizes of [['8'],['9']])assert.equal(C.sizeMatch({...item,category:'Footwear',sizeSystem:'US men',availableSizes:sizes},p),'unavailable');
 assert.equal(C.sizeMatch({...item,category:'Footwear',sizeSystem:'EU',availableSizes:['42']},p),'unknown');
});
test('numeric and mixed clothing labels stay visible as unchecked, while known letter mismatches stay excluded',()=>{
 const p=C.cleanPrefs();
 for(const sizes of [['42','44','46','48','50','52','54'],['28','30','32'],['28/30','30/32'],['XL','42'],['One size']]){
  const row={...item,availableSizes:sizes};assert.equal(C.sizeMatch(row,p),'unknown');assert.equal(C.matchItems({items:[row]},p,{},now).length,1);assert.equal(C.matchItems({items:[row]},p,{confirmed:true},now).length,0);
 }
 assert.equal(C.sizeMatch({...item,availableSizes:['S','L','XL']},p),'unavailable');
 assert.equal(C.sizeMatch({...item,availableSizes:['42',' m ']},p),'match');
 assert.equal(C.sizeMatch({...item,sizeSystem:'Unverified',availableSizes:['M']},p),'unknown');
});
test('filters remove stale, non-discounted, wrong-size, over-budget and expired observations',()=>{
 const p=C.cleanPrefs({needs:[{id:'need1',text:'Work tops',category:'Tops',budget:600}]});
 const rows=[item,{...item,id:'old',checkedAt:'2026-10-01'},{...item,id:'regular',originalPrice:500},{...item,id:'wrong',availableSizes:['XL']},{...item,id:'dear',price:800},{...item,id:'shoes',category:'Footwear'},{...item,id:'store',channel:'store',area:'Makati',branch:'A branch',validTo:'2026-10-16'}];
 assert.deepEqual(C.matchItems({items:rows},p,{need:'need1'},now).map(i=>i.id),['hm123']);
 assert.equal(C.matchItems({items:[{...item,availableSizes:null}]},p,{confirmed:true},now).length,0);
});
