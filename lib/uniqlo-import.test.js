import {test} from 'node:test';import assert from 'node:assert/strict';import './shopping-taste.js';import './shopping-core.js';import './uniqlo-import.js';
const U=globalThis.UniqloImport,now=Date.parse('2026-10-17T08:00:00Z'),at=new Date(now).toISOString(),row={name:'DRY-EX Polo Shirt',url:'https://www.uniqlo.com/ph/en/products/E483972-000/00?colorDisplayCode=66',price:790,originalPrice:990,label:'Limited Offer from 16 Oct - 22 Oct 2026'};
test('imports current product quotes without inferring stock; restrictions stay separate',()=>{
 const result=U.normalize([row,row,{...row,url:row.url.replace('483972','486119'),name:'Sweat Hoodie',label:row.label+', Color Size Limited Price'}],at,now);
 assert.equal(result.items.length,1);assert.equal(result.campaigns.length,1);assert.equal(result.items[0].availableSizes,null);assert.equal(result.items[0].provenance,'browser-import');assert.match(result.campaigns[0].condition,/Color Size/);assert.equal(globalThis.ShoppingCore.matchItems(result,{}, {confirmed:true},now).length,0);
 for(const condition of ['App Member Exclusive','Limited Store'])assert.equal(U.normalize([{...row,label:row.label+', '+condition}],at,now).campaigns.length,1);
});
test('rejects unsafe links, missing or expired dates, ordinary prices and stale imports',()=>{
 const rows=[{...row,url:'https://attacker.test/ph/en/products/E483972-000/00'},{...row,url:'javascript:alert(1)'},{...row,label:''},{...row,label:'Limited Offer from 1 Oct - 15 Oct 2026'},{...row,label:'Limited Offer from 31 Feb - 5 Mar 2026'},{...row,originalPrice:790},{...row,price:-1}];
 assert.equal(U.normalize(rows,at,now).items.length,0);assert.equal(U.normalize([row],'2026-09-01T08:00:00Z',now).items.length,0);assert.equal(U.normalize([row],'2026-10-18T08:00:00Z',now).items.length,0);
 assert.equal(U.normalize([{...row,label:'',validFrom:'2026-02-30',validTo:'2026-10-22'}],at,now).items.length,0);
});
test('automatic replacements cannot erase the separate import; expiry hides it without changing source data',()=>{
 const manual=U.normalize([row],at,now),auto={generatedAt:at,items:[{id:'hm',brand:'H&M'}],sources:[{id:'uniqlo',status:'unavailable'}]};
 const merged=U.merge(auto,manual,now);assert.equal(merged.items.length,2);assert.equal(auto.items.length,1);assert.equal(merged.sources[0].status,'imported');
 assert.equal(U.merge({...auto,items:[{id:'nike',brand:'Nike'}]},manual,now).items.some(i=>i.brand==='UNIQLO'),true);
 // Four days after the import the offer (16–22 Oct) is still running, so it still shows.
 const later=Date.parse('2026-10-22T08:00:00Z'),still=U.merge(auto,manual,later);assert.equal(still.sources[0].status,'imported');assert.match(still.sources[0].message,/latest 2026-10-22/);
 assert.equal(globalThis.ShoppingCore.matchItems(still,{},{},later).filter(i=>i.brand==='UNIQLO').length,1);
 const expired=U.merge(auto,manual,Date.parse('2026-10-23T08:00:00Z'));assert.equal(expired.items.length,1);assert.equal(expired.sources.find(s=>s.id==='uniqlo-manual').status,'expired');assert.equal(expired.sources.find(s=>s.id==='uniqlo').status,'unavailable');assert.equal(manual.items.length,1);
});
