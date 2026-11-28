import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mallSearchCandidates,parseRetailerEvent,readMallAlternatives} from './clothing-malls.js';
import {parseMall,SOURCES,parseShopify,readSource} from './clothing.js';
const at='2026-11-28T05:00:00Z';
const result=rows=>({status:true,deals:{deals:rows}});
const deal={deal_promo_title:'Adidas sale up to 40% OFF',deal_slug:'adidas-sale',deal_start:'2026-11-27 00:00:00',deal_end:'2026-11-30 23:59:00'};
test('SM public search discovers relevant current sales, never arbitrary keyword matches or regular prices',()=>{
  assert.deepEqual(mallSearchCandidates(result([deal,deal]),at),['https://www.smsupermalls.com/smdeals/adidas-sale']);
  const bad=[{...deal,deal_slug:'https://evil.test/x'},{...deal,deal_slug:'../x'},{...deal,deal_promo_title:'FRIENDSGIVING CROCHET MAKING'},{...deal,deal_promo_title:'Adidas shoes start at P7,300'},{...deal,deal_promo_title:"Adidas Women's sale"},{...deal,deal_end:'2026-11-27 23:59:00'},{...deal,deal_start:'2026-11-29 00:00:00'}];
  assert.deepEqual(mallSearchCandidates(result(bad),at),[]);
  assert.throws(()=>mallSearchCandidates({status:true},at),/Unrecognised/);
});
test('SM details isolate offer dates and participation from surrounding directories and other deals',()=>{
  const html='<h1>Adidas sale</h1><p>Valid until November 30, 2026</p><section id="deals-info">Up to 40% OFF</section><div id="gtmPartMalls"><h4>Participating Malls</h4>SM Megamall</div><section id="latest-deals">Valid Until December 31, 2026 Participating Malls: SM Mall of Asia</section><footer>SM City North Edsa</footer>';
  assert.deepEqual(parseMall(html,'https://www.smsupermalls.com/smdeals/adidas-sale',at).map(i=>i.branch),['SM Megamall']);
  assert.equal(parseMall(html.replace('November 30','November 27'),'https://www.smsupermalls.com/smdeals/adidas-sale',at).length,0);
  assert.equal(parseMall(html,'https://evil.test/smdeals/adidas-sale',at).length,0);
  assert.equal(parseMall(html.replace('Adidas sale',"Adidas Women's sale"),'https://www.smsupermalls.com/smdeals/adidas-sale',at).length,0);
});
test('retailer-hosted events require their own explicit year, current range and named venue',()=>{
  const html='<main><h1>FINAL SPORTS CENTRAL CLEARANCE SALE OF 2026!</h1><p>NIKE, ADIDAS and CROCS. UP TO 80% OFF</p><p>📍 SM Megamall, 5th Level 📅 November 27–30</p><p>PLUS ENJOY EVENT EXCLUSIVES: Extra 5% OFF with BDO (min. ₱5,000 spend).</p></main><footer>SM Mall of Asia</footer>';
  const rows=parseRetailerEvent(html,at);assert.equal(rows.length,3);assert.deepEqual([...new Set(rows.map(i=>i.branch))],['SM Megamall']);assert.equal(rows[0].validTo,'2026-11-30');assert.match(rows[0].terms,/min. ₱5,000/);assert.equal(rows[0].retailer,'Sports Central');
  for(const changed of [html.replace('2026','2025'),html.replace(' OF 2026',''),html.replace('November 27–30','September 16–20'),html.replace('SM Megamall','online'),html.replace('November 27–30','November 30–31')])assert.equal(parseRetailerEvent(changed,at).length,0);
});
test('a failed mall search cannot erase an independently verified retailer event; discovery URLs stay bounded',async()=>{
  const urls=[];const fake=async url=>{urls.push(url);if(url.includes('/list-deals'))return new Response('blocked',{status:403});return new Response('<main><h1>Sports Central Clearance Sale 2026</h1>Adidas sale 📍 SM Megamall 📅 November 27–30</main>');};
  const r=await readMallAlternatives(at,{fetchImpl:fake,candidates:['https://evil.test/smdeals/adidas-sale']});
  assert.equal(r.promos.length,1);assert.equal(r.sources[0].status,'partial');assert.equal(r.sources[1].status,'announcements');assert.equal(urls.length,6);assert.ok(urls.every(u=>!u.includes('evil.test')));
});
test('search detail failures remain visible; keyword hits without verified participation create no offers',async()=>{
  const r=await readMallAlternatives(at,{fetchImpl:async url=>url.includes('/list-deals')?new Response(JSON.stringify(result([deal]))):new Response('blocked',{status:403})});
  assert.equal(r.promos.length,0);assert.equal(r.sources[0].status,'partial');assert.equal(r.sources[0].detailsChecked,0);assert.equal(r.sources[1].status,'unavailable');
});
test('Sports Central Adidas keeps maker and retailer distinct, excludes women, and never converts UK shoes to US',async()=>{
  const source=SOURCES.find(s=>s.id==='sc-adidas');
  const p={id:1,title:'adidas Men Runfalcon Shoes',vendor:'adidas',handle:'runfalcon',product_type:'Men Shoes',tags:[],options:[{name:'Size'}],variants:[{id:10,option1:'8 UK',available:true,price:'2000',compare_at_price:'4000'},{id:11,option1:'8.5 UK',available:false,price:'2000',compare_at_price:'4000'}]};
  const rows=parseShopify(source,[p,{...p,id:2,title:'adidas Women Runfalcon Shoes'},{...p,id:3,vendor:'Unknown'}],at);
  assert.equal(rows.length,1);assert.equal(rows[0].brand,'Adidas');assert.equal(rows[0].retailer,'Sports Central');assert.equal(rows[0].sizeSystem,'Unverified');assert.deepEqual(rows[0].availableSizes,['8 UK']);
  const read=await readSource(source,at,async()=>new Response(JSON.stringify({products:[p]})));assert.equal(read.status,'ok');
});
