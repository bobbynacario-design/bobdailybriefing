import {test} from 'node:test';import assert from 'node:assert/strict';
import './shopping-identity.js';import './shopping-taste.js';import './shopping-style.js';import './shopping-core.js';
const C=globalThis.ShoppingCore,I=globalThis.ShoppingIdentity,now=Date.parse('2026-11-28T05:00:00Z'),at=new Date(now).toISOString();
const a={id:'a',brand:'Adidas',retailer:'Sports Central',styleCode:'JJ4008',color:'Black',category:'Tops',price:1080,originalPrice:1800,currency:'PHP',url:'https://sportscentral.ph/products/tee',checkedAt:at,availableSizes:['M'],sizesCheckedAt:at,sizeSystem:'Labelled clothing'};
const b={...a,id:'b',retailer:"Toby's",price:900,url:'https://www.tobys.com/products/tee'};
test('exact colour-variant manufacturer codes join retailers; model names and different colour variants never do',()=>{
 assert.ok(I.same(a,b));assert.ok(!I.same(a,{...b,styleCode:'JJ4009'}));assert.ok(!I.same(a,{...b,color:'White'}));assert.ok(!I.same({...a,styleCode:''},{...b,styleCode:''}));
 assert.equal(I.key({...a,brand:'Nike',styleCode:'DV1234'}),'');assert.notEqual(I.key({...a,brand:'Nike',styleCode:'DV1234-001'}),I.key({...a,brand:'Nike',styleCode:'DV1234-100'}));
 const r=C.comparisons(a,{items:[a,b]}, {},now);assert.equal(r.offers.length,2);assert.equal(r.lowestConfirmed,900);
});
test('stale, expired, future, conditional, non-PHP or disabled-retailer prices cannot enter a current comparison',()=>{
 const bad=[{...b,checkedAt:'2026-11-20T05:00:00Z'},{...b,validTo:'2026-11-27'},{...b,validFrom:'2026-11-29'},{...b,checkedAt:'2026-11-29T05:00:00Z'},{...b,currency:'USD'},{...b,condition:'Voucher required'},{...b,url:'javascript:alert(1)'}];
 for(const r of bad)assert.equal(C.comparisons(a,{items:[a,r]}, {},now),null);
 assert.equal(C.comparisons(a,{items:[a,b]},{brands:['Adidas','Sports Central'],brandsSeen:C.BRANDS},now),null);assert.equal(C.comparisons(a,{items:[b]}, {},now),null);
});
test('unknown stock, variant minimums and UK sizes cannot earn the lowest price with your size label',()=>{
 for(const changed of [{...b,priceFrom:true},{...b,availableSizes:null},{...b,sizesCheckedAt:'2026-11-25T05:00:00Z'},{...b,sizeSystem:'Unverified',availableSizes:['8 UK']},{...b,availableSizes:['L']}]){
  const r=C.comparisons(a,{items:[a,changed]}, {},now);assert.equal(r.lowestConfirmed,a.price);assert.equal(r.offers.length,2);
 }
});
test('one retailer cannot make a comparison with itself and newer observations supersede older quotes',()=>{
 assert.equal(C.comparisons(a,{items:[a,{...a,id:'duplicate'}]}, {},now),null);
 const newer={...b,id:'new',price:950,checkedAt:new Date(now+1000).toISOString()};const r=C.comparisons(a,{items:[a,b,newer]}, {},now);assert.equal(r.offers.find(r=>r.retailer==="Toby's").item.price,950);
});
