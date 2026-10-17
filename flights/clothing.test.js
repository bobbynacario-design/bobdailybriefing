import {test} from 'node:test';
import assert from 'node:assert/strict';
import {category,parseHM,parseCrocs,parseNike,parseMall,mallCandidates,readSource,priceHistory} from './clothing.js';
const at='2026-10-17T03:00:00Z';
const product={id:'12345',productName:'Cotton polo',url:'/en_ph/productpage.12345.html',colorName:'Blue',availability:{stockState:'Available'},prices:[{priceType:'redPrice',price:500},{priceType:'whitePrice',price:1000}],sizes:[{label:'M',stock:2},{label:'S',stock:0}]};
const hm=rows=>'<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{plpProps:{productListingSectionProps:{productListingData:{rawProductList:rows}}}}}})+'</script>';
test('H&M reads actual PHP markdowns and only explicitly available size labels',()=>{
 const rows=parseHM(hm([product,{...product,id:'2',prices:[{priceType:'whitePrice',price:1000}]},{...product,id:'3',availability:{stockState:'SoldOut'}},{...product,url:'https://attacker.test/product'},{...product,sizes:[{label:'M',stock:0}]}]),at);
 assert.equal(rows.length,1);assert.equal(rows[0].price,500);assert.deepEqual(rows[0].availableSizes,['M']);assert.equal(rows[0].shipping,null);assert.equal(rows[0].channel,'online');
});
test('Crocs keeps available discounted male variants, with no half-size rounding or regular-price sale claims',()=>{
 const p={title:'Classic Clog',handle:'classic-clog',variants:[{id:1,option1:'M8W10',title:'M8 / Black',available:true,price:'1500',compare_at_price:'3000'},{id:2,option1:'M9W11',available:false,price:'1500',compare_at_price:'3000'},{id:3,option1:'M8W10',available:true,price:'3000',compare_at_price:null}]};
 const rows=parseCrocs(JSON.stringify({products:[p,{...p,title:"Women's Classic Clog"},{...p,title:"Kids' Classic Clog"}]}),at);
 assert.equal(rows.length,1);assert.deepEqual(rows[0].availableSizes,['8']);assert.equal(rows[0].sizeSystem,'US men');assert.match(rows[0].url,/variant=1/);
});
test('store offers need current dates and explicit branch participation, with footer and expired promos excluded',()=>{
 const body='<main><h1>Adidas sale</h1>Valid From October 16, 2026 Valid Until October 20, 2026 Participating Malls: SM Megamall SM City North Edsa</main><footer>SM Mall of Asia</footer>';
 const rows=parseMall(body,'https://www.smsupermalls.com/smdeals/test',at);
 assert.deepEqual(rows.map(r=>r.area),['Quezon City','Ortigas']);assert.equal(rows[0].validTo,'2026-10-20');
 assert.equal(parseMall(body.replace('October 20','October 15'),'https://www.smsupermalls.com/smdeals/test',at).length,0);
 assert.equal(parseMall(body.replace('Participating Malls:','Nearby malls:'),'https://www.smsupermalls.com/smdeals/test',at).length,0);
 assert.equal(parseMall(body.replace('October 16','October 18'),'https://www.smsupermalls.com/smdeals/test',at).length,0);
 assert.deepEqual(mallCandidates('<a href="https://evil.test/smdeals/x">Nike sale</a><a href="/smdeals/x">Nike sale</a><a href="/smdeals/food">Food sale</a>'),['https://www.smsupermalls.com/smdeals/x']);
});
test('blocked and script-only pages report coverage gaps, not invented offers',async()=>{
 assert.equal((await readSource({id:'nike',brand:'Nike',url:'https://www.nike.com/ph/'},at,async()=>new Response('blocked',{status:403}))).status,'unavailable');
 assert.equal((await readSource({id:'adidas',brand:'Adidas',url:'https://www.adidas.com.ph/'},at,async()=>new Response('<html>Enable JavaScript</html>'))).status,'unpriced');
});
test('price memory: first seen, lowest and highest on earlier days, and a same-day rerun is not a comparison',()=>{
 const d1=priceHistory([{id:'a',price:900}],{},'2026-10-13T00:05:00Z'),d2=priceHistory([{id:'a',price:700}],d1.history,'2026-10-16T00:05:00Z');
 const d3=priceHistory([{id:'a',price:800}],d2.history,'2026-10-19T00:05:00Z');
 assert.deepEqual([d3.items[0].firstSeen,d3.items[0].checks,d3.items[0].priorLow,d3.items[0].priorLowAt,d3.items[0].priorHigh,d3.items[0].previousPrice],['2026-10-13T00:05:00Z',2,700,'2026-10-16T00:05:00Z',900,700]);
 const rerun=priceHistory([{id:'a',price:750}],d3.history,'2026-10-19T06:00:00Z');
 assert.equal(rerun.items[0].checks,2);assert.equal(rerun.items[0].previousPrice,700);assert.equal(rerun.history.a.length,3);assert.equal(rerun.history.a.at(-1).price,750);
 assert.deepEqual([d1.items[0].checks,d1.items[0].firstSeen,d1.items[0].priorLow],[0,'2026-10-13T00:05:00Z',undefined]);
});
test('price history compares the exact observed product and retains a bounded thirty-day record',()=>{
 const first=priceHistory([{id:'a',price:500}],{},at);assert.equal(first.items[0].previousPrice,undefined);
 const next=priceHistory([{id:'a',price:450},{id:'b',price:300}],first.history,'2026-10-18T03:00:00Z');assert.equal(next.items[0].previousPrice,500);assert.equal(next.items[1].previousPrice,undefined);assert.equal(next.history.a.length,2);
});

test('Nike uses public PH prices for the exact color SKU but never guesses size inventory',()=>{
 const p={productCode:'SKU-001',productType:'FOOTWEAR',copy:{title:'Nike example',subTitle:"Men's Shoes"},prices:{currency:'PHP',currentPrice:3000,initialPrice:5000},pdpUrl:{url:'https://www.nike.com/ph/t/example/SKU-001'}};
 const html='<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{initialState:{Wall:{productGroupings:[{products:[p,p,{...p,productCode:'2',prices:{...p.prices,currency:'USD'}},{...p,productCode:'3',copy:{title:'Example',subTitle:"Women's Shoes"}}]}]}}}}})+'</script>';
 const rows=parseNike(html,at);assert.equal(rows.length,1);assert.equal(rows[0].price,3000);assert.equal(rows[0].availableSizes,null);assert.equal(rows[0].shipping,null);
});

// Names and codes as the H&M PH sale page listed them on 17 Oct 2026.
test('categories read the product name before the retailer code, and accessories are not clothing',()=>{
 assert.equal(category('Regular-Fit Fine-Knit Polo Shirt','men_tshirtstanks_poloshirts_shortsleeve'),'Tops');
 assert.equal(category('Oversized Cotton T-Shirt','men_tshirtstanks_shortsleeve'),'Tops');
 assert.equal(category('Nylon Swim Shorts','men_swimwear_swimshorts'),'Shorts');
 assert.equal(category('Relaxed-Fit Cotton Joggers','men_trousers_casual'),'Trousers');
 assert.equal(category('Relaxed-Fit Double-Breasted Jacket','men_blazerssuits_blazers'),'Outerwear');
 assert.equal(category('Regular Fit Item','men_trousers_casual'),'Trousers');
 assert.equal(category('Crocband Flip in White'),'Footwear');assert.equal(category('Lace-Up Boots'),'Footwear');
 for(const name of ['Shoe Laces','Jibbitz™ Charm Sweet Treats 5 Pack','Polarized Sunglasses','Crossbody Bag','9-pack Repair Patches'])assert.equal(category(name),'',name);
 assert.equal(category('Crocband In White'),'Other');assert.equal(category('Crocband In White','','Footwear'),'Footwear');
});
test('H&M keeps menswear and drops the kids care items and accessories on the same sale page',()=>{
 const rows=parseHM(hm([{...product,mainCatCode:'men_tshirtstanks_poloshirts_shortsleeve',productName:'Regular-Fit Polo Shirt'},{...product,id:'k',mainCatCode:'kids_boys_clothing_takecare',productName:'2-Pack Mesh Laundry Bags'},{...product,id:'s',mainCatCode:'men_accessories_sunglasses',productName:'Polarized Sunglasses'}]),at);
 assert.deepEqual(rows.map(r=>[r.name,r.category]),[['Regular-Fit Polo Shirt','Tops']]);
});
test('H&M rows keep the whole size run as well as the sizes in stock',()=>{
 const rows=parseHM(hm([{...product,mainCatCode:'men_trousers_casual',productName:'Slim Fit Wool-Blend Pants',sizes:[{label:'28',stock:2},{label:'30',stock:2},{label:'34',stock:0}]}]),at);
 assert.deepEqual(rows[0].availableSizes,['28','30']);assert.deepEqual(rows[0].sizeRun,['28','30','34']);
});
