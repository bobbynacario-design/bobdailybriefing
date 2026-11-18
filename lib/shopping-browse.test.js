import {test} from 'node:test';
import assert from 'node:assert/strict';
import './shopping-taste.js';import './shopping-style.js';import './shopping-core.js';
const C=globalThis.ShoppingCore,S=globalThis.ShoppingStyle,now=Date.parse('2026-11-19T00:00:00Z'),at=new Date(now).toISOString();
const item={id:'polo',brand:'H&M',name:'Regular-Fit Plain Cotton Polo',color:'Navy',category:'Tops',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.123.html',checkedAt:at,availableSizes:['M'],sizeSystem:'Labelled clothing'};
const prefs=C.cleanPrefs({wardrobe:{polo:0,chinos:1,shorts:1,sneakers:1}});

test('size stock has its own age, with exact 48-hour boundary and conservative missing/future timestamps',()=>{
 const ago=h=>new Date(now-h*3600000).toISOString();
 assert.equal(C.stockConfidence(item,prefs,now).kind,'recent');
 assert.equal(C.stockConfidence({...item,sizesCheckedAt:ago(48)},prefs,now).match,'match');
 const old={...item,sizesCheckedAt:new Date(now-48*3600000-1).toISOString()};
 assert.equal(C.stockConfidence(old,prefs,now).kind,'old');assert.equal(C.stockConfidence(old,prefs,now).match,'unknown');
 for(const t of ['',null,'invalid',new Date(now+6*60000).toISOString()])assert.equal(C.stockConfidence({...item,sizesCheckedAt:t},prefs,now).kind,'unchecked');
 assert.equal(C.stockConfidence({...item,availableSizes:null},prefs,now).kind,'unchecked');
 assert.equal(C.stockConfidence({...item,checkedAt:ago(72),sizesCheckedAt:at},prefs,now).kind,'recent');
 assert.equal(C.stockConfidence({...item,sizesCheckedAt:ago(72)},prefs,now).hours,72);
});

test('old size matches cannot earn Worth it or the recent-stock filter, and old mismatches are not current sold-out claims',()=>{
 assert.equal(S.verdict(item,prefs,now).kind,'wear');
 const old={...item,sizesCheckedAt:new Date(now-49*3600000).toISOString()},wrong={...old,id:'old-wrong',availableSizes:['L']};
 assert.notEqual(S.verdict(old,prefs,now).kind,'wear');assert.match(S.verdict(old,prefs,now).reasons.join(' '),/new stock check/);
 assert.equal(C.matchItems({items:[old,wrong]},prefs,{},now).length,2);
 assert.equal(C.matchItems({items:[old,wrong]},prefs,{confirmed:true},now).length,0);
 assert.equal(C.matchItems({items:[{...wrong,sizesCheckedAt:at}]},prefs,{},now).length,0);
 assert.equal(C.matchItems({items:[{...item,checkedAt:new Date(now-97*3600000).toISOString(),sizesCheckedAt:at}]},prefs,{},now).length,0,'fresh stock must not refresh an old price');
});

test('brand sizes apply by maker and size system, with general fallback and no shoe conversion',()=>{
 const p=C.cleanPrefs({brandSizes:{'H&M':{clothingSize:'L',waistSize:'32',jacketSize:'48'},Nike:{shoeSize:9,americanSize:'XS'},ZALORA:{shoeSize:12}}});
 assert.equal(C.sizeMatch(item,p),'unavailable');assert.equal(C.sizeMatch({...item,availableSizes:['L']},p),'match');assert.equal(C.sizeLabel(item,p),'L');
 assert.equal(C.sizeMatch({...item,brand:'UNIQLO'},p),'match');
 const shoe={...item,brand:'Nike',retailer:'ZALORA',category:'Footwear',sizeSystem:'US men',availableSizes:['9']};
 assert.equal(C.sizeLabel(shoe,p),'US men 9');assert.equal(C.sizeMatch(shoe,p),'match');assert.equal(C.stockConfidence(shoe,p,now).brandOverride,true);
 assert.equal(C.sizeMatch({...shoe,sizeSystem:'UK',availableSizes:['9']},p),'unknown');
 assert.equal(C.sizeMatch({...shoe,availableSizes:['8'],sizeRun:['8','9','10']},p),'unavailable');
 assert.equal(C.sizeMatch({...item,brand:'Nike',sizeSystem:'US clothing',availableSizes:['XS']},p),'match');
 assert.equal(C.stockConfidence({...item,brand:'Nike'},p,now).brandOverride,false,'a shoe-only override does not override a labelled clothing size');
 assert.equal(C.sizeMatch({...item,category:'Trousers',availableSizes:['30','32']},p),'match');
 assert.equal(C.sizeMatch({...item,category:'Outerwear',availableSizes:['46','48']},p),'match');
 assert.equal(p.brandSizes.ZALORA,undefined);
 assert.deepEqual(C.cleanBrandSizes({Nike:{shoeSize:9.1,waistSize:31.5,jacketSize:999,clothingSize:'bad'}}),{});
});

test('brand-size edits merge by brand and field across devices, with conflicts and deletion protected',()=>{
 const base=C.cleanPrefs(),remote=C.cleanPrefs({...base,brandSizes:{Nike:{shoeSize:9}}}),next=C.cleanPrefs({...base,brandSizes:{Nike:{clothingSize:'L'},'H&M':{waistSize:32}}});
 const merged=C.mergePrefs(remote,base,next);
 assert.deepEqual(merged.brandSizes,{Nike:{clothingSize:'L',shoeSize:9},'H&M':{waistSize:32}});
 assert.throws(()=>C.mergePrefs(remote,base,{...base,brandSizes:{Nike:{shoeSize:10}}}),{code:'shopping-conflict'});
 assert.throws(()=>C.mergePrefs({...remote,brandSizes:{Nike:{shoeSize:10}}},remote,{...remote,brandSizes:{}}),{code:'shopping-conflict'});
 assert.equal(C.mergePrefs({...remote,wardrobe:{chinos:2}},remote,{...remote,brandSizes:{Nike:{shoeSize:10}}}).wardrobe.chinos,2);
});

test('search requires every word in product, maker, retailer or colour, without interpreting regex or HTML',()=>{
 const feed={items:[item,{...item,id:'white',name:'Cotton Shirt',color:'White'},{...item,id:'retailer',brand:'Nike',retailer:'ZALORA',color:'Black'}]};
 assert.deepEqual(C.matchItems(feed,prefs,{query:'  navy  COTTON  '},now).map(i=>i.id),['polo']);
 assert.deepEqual(C.matchItems(feed,prefs,{query:'zalora nike'},now).map(i=>i.id),['retailer']);
 assert.equal(C.matchItems(feed,prefs,{query:'[.*]'},now).length,0);
 assert.equal(C.browseResult(feed,prefs,{query:'<script>'},now).excluded.query,3);
});

test('quick price limits intersect saved budgets and reject variant minima and invalid inputs',()=>{
 const feed={items:[item,{...item,id:'dear',price:600},{...item,id:'from',price:100,priceFrom:true}]};
 assert.deepEqual(C.matchItems(feed,prefs,{maxPrice:'500'},now).map(i=>i.id),['polo']);
 assert.equal(C.matchItems(feed,C.cleanPrefs({taste:{budgets:{Tops:499}}}),{maxPrice:1000},now).length,0);
 for(const n of ['0','-5','hello',Infinity,'100001']){
   const filters=C.cleanFilters({maxPrice:n});assert.equal(filters.priceError,true);assert.equal(C.matchItems(feed,prefs,filters,now).length,0);
 }
 assert.equal(C.matchItems(feed,prefs,{maxPrice:''},now).length,3);
});

test('explicit sorting follows actual prices, first sightings and observed drops, while recommendation rules still filter',()=>{
 const a={...item,id:'a',price:600,previousPrice:650,firstSeen:'2026-11-18T00:00:00Z'},b={...item,id:'b',price:300,previousPrice:700,firstSeen:'2026-11-17T00:00:00Z'},c={...item,id:'c',price:400,previousPrice:400,firstSeen:'2026-11-16T00:00:00Z',checkedAt:'2026-11-19T00:00:00Z'};
 const feed={items:[a,b,c,{...item,id:'expired',price:1,validTo:'2020-01-01'}]};
 assert.deepEqual(C.matchItems(feed,prefs,{sort:'price'},now).map(i=>i.id),['b','c','a']);
 assert.deepEqual(C.matchItems(feed,prefs,{sort:'newest'},now).map(i=>i.id),['a','b','c']);
 assert.deepEqual(C.matchItems(feed,prefs,{sort:'drop'},now).map(i=>i.id),['b','a','c']);
 assert.equal(C.browseResult(feed,prefs,{query:'unmatched'},now).excluded.old,1);
 assert.equal(C.browseResult(feed,prefs,{query:'unmatched'},now).excluded.query,3);
});

test('saved-history search, price and sorting use current or historical observations without losing retained records',()=>{
 const old={...item,id:'old',price:300,color:'White',validTo:'2020-01-01'},saved=C.cleanPrefs({saved:['legacy','polo','old'],savedDeals:[C.snapshot(item,at),C.snapshot(old,at)],taste:{budgets:{Tops:1}},brands:[],brandsSeen:C.BRANDS});
 const feed={items:[{...item,name:'Renamed shirt',color:'Black',price:700}]};
 assert.deepEqual(C.savedItems(feed,saved,{sort:'price'},now).map(r=>r.id).slice(0,2),['old','polo']);
 assert.deepEqual(C.savedItems(feed,saved,{maxPrice:500},now).map(r=>r.id),['old']);
 assert.deepEqual(C.savedItems(feed,saved,{query:'white'},now).map(r=>r.id),['old']);
 assert.deepEqual(C.savedItems(feed,saved,{query:'navy polo'},now).map(r=>r.id),['polo'],'saved names and colours remain searchable after a listing changes');
 assert.equal(C.savedItems(feed,saved,{maxPrice:-1},now).length,0);
 assert.equal(C.savedItems(feed,saved,{},now).length,3);assert.equal(saved.saved.length,3);
});
