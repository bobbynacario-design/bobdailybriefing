import {test} from 'node:test';
import assert from 'node:assert/strict';
import {category,parseHM,parseCrocs,parseNike,parseShopify,parseMall,mallCandidates,readSource,priceHistory} from './clothing.js';
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

// Shapes as the stores' public products.json listed them on 29 Oct 2026.
const levis={id:'levis',brand:"Levi's",shopify:true,url:'https://www.levi.com.ph/collections/men-sale'};
const ua={id:'underarmour',brand:'Under Armour',shopify:true,url:'https://www.underarmour.com.ph/collections/men'};
const v=(id,o1,o2,price,cmp,available=true)=>({id,option1:o1,option2:o2,option3:null,price:String(price),compare_at_price:cmp==null?null:String(cmp),available});
test('Shopify stores: one listing per men\'s colour, waists from the Waist option, sizes only where a marked-down size is in stock',()=>{
 const jeans={id:1,title:"Levi's® Men's 505™ Regular Jeans",handle:'505-regular',product_type:'Men Jeans',tags:['Blue','SALE','Men'],options:[{name:'Waist'},{name:'Length'}],variants:[v(11,'31','32',2499.5,4999),v(12,'32','32',2499.5,4999,false),v(13,'30','30',4999,null)],images:[{src:'https://cdn.shopify.com/a.jpg'}]};
 const [row]=parseShopify(levis,[jeans],at);
 assert.deepEqual([row.name,row.category,row.color,row.price,row.originalPrice,row.sizeSystem],['505™ Regular Jeans','Trousers','Blue',2499.5,4999,'Labelled clothing']);
 assert.deepEqual(row.availableSizes,['31']);assert.deepEqual(row.sizeRun,['31','32','30']);
 assert.equal(row.url,'https://www.levi.com.ph/products/505-regular?variant=11');assert.equal(row.priceFrom,undefined);
});
test('Under Armour sizes read as US clothing (SM/MD/LG), colour codes drop off, and unisex shoes keep the men\'s size',()=>{
 const tee={id:2,title:'UA Men Tech 2.0 Short Sleeve | 1326413',product_type:'Short Sleeve Shirts',tags:[],handle:'tech',options:[{name:'Color'},{name:'US Size'}],variants:[v(21,'Black / White - 001','SM',897,1495),v(22,'Black / White - 001','MD',897,1495),v(23,'Black / White - 001','LG',897,1495,false),v(24,'Navy - 410','MD',1495,null)]};
 const shoe={id:3,title:'UA Unisex Velociti Pro 2 | 6005378',product_type:'Running',tags:['Running Shoes','Shoes'],handle:'velociti',options:[{name:'Color'},{name:'US Size'}],variants:[v(31,'Black - 001','7/8.5',7628.4,10595),v(32,'Black - 001','8.5/10',7628.4,10595)]};
 const rows=parseShopify(ua,[tee,shoe],at),t=rows.find(r=>r.category==='Tops'),s=rows.find(r=>r.category==='Footwear');
 assert.equal(rows.length,2);
 assert.deepEqual([t.name,t.color,t.sizeSystem,t.availableSizes,t.sizeRun],['Tech 2.0 Short Sleeve','Black / White','US clothing',['S','M'],['S','M','L']]);
 assert.deepEqual([s.name,s.sizeSystem,s.availableSizes],['Unisex Velociti Pro 2','US men',['7','8.5']]);
});
test('Shopify stores drop women\'s, kids\' and accessory products, full-price items, and Penshoppe "SIZE 30" reads as a waist',()=>{
 const base={handle:'x',tags:[],options:[{name:'Color'},{name:'Size (INT)'}]};
 const rows=parseShopify({...levis,id:'penshoppe',brand:'Penshoppe',url:'https://www.penshoppe.com/collections/sale'},[
  {...base,id:4,title:'Relaxed Chino Pants',product_type:"Men's Trousers",variants:[v(41,'Beige','SIZE 30',899,1299),v(42,'Beige','SIZE 32',999,1399)]},
  {...base,id:5,title:'Relaxed Chino Pants',product_type:"Women's Trousers",variants:[v(51,'Beige','S',899,1299)]},
  {...base,id:6,title:'Ankle Socks',product_type:"Men's Socks",variants:[v(61,'Black','Free Size',99,149)]},
  {...base,id:7,title:'Sling Bag',product_type:"Men's Bags",variants:[v(71,'Black','Free Size',299,499)]},
  {...base,id:8,title:'Basic Tee',product_type:"Men's Basic Tees",variants:[v(81,'White','M',399,null)]},
  {...base,id:9,title:'Boys Graphic Tee',product_type:"Kids' Tees",variants:[v(91,'White','M',199,399)]}
 ],at);
 assert.deepEqual(rows.map(r=>[r.name,r.availableSizes,r.priceFrom]),[['Relaxed Chino Pants',['30','32'],true]]);
});
test('Shopify reading pages through the collection and stops at a short page',async()=>{
 const urls=[],page=n=>({products:Array.from({length:n},(_,i)=>({id:i,title:"Men's Tee",product_type:'Tees',handle:'t'+i,tags:[],options:[{name:'Size'}],variants:[v(i,'M',null,500,1000)]}))});
 const fake=async url=>{urls.push(url);return new Response(JSON.stringify(page(urls.length===1?100:3)));};
 const r=await readSource(levis,at,fake);
 assert.deepEqual(urls,['https://www.levi.com.ph/collections/men-sale/products.json?limit=100&page=1','https://www.levi.com.ph/collections/men-sale/products.json?limit=100&page=2']);
 assert.equal(r.status,'ok');assert.equal(r.count,45);assert.match(r.message,/103 products/);
 assert.equal((await readSource(levis,at,async()=>new Response('blocked',{status:403}))).status,'unavailable');
});
test('Sperry and Hush Puppies titles carry the colour and a style code; Sperry shoes are US men\'s half sizes',()=>{
 const sperry={id:'sperry',brand:'Sperry',shopify:true,shoes:'US men',url:'https://www.sperry.com.ph/collections/all'};
 const p={id:10,title:"Men's Bahama II Sneakers - Navy (24F000410)",product_type:'',vendor:'Sperry Philippines',tags:['MensSneakers'],handle:'bahama',options:[{name:'SIze'}],variants:[v(101,'8.5',null,2575,4295),v(102,'9',null,2575,4295,false)]};
 const [row]=parseShopify(sperry,[p],at);
 assert.deepEqual([row.name,row.color,row.category,row.sizeSystem,row.availableSizes,row.sizeRun],['Bahama II Sneakers','Navy','Footwear','US men',['8.5'],['8.5','9']]);
 const hp=parseShopify({id:'hushpuppies',brand:'Hush Puppies',shopify:true,url:'https://www.hushpuppies.com.ph/collections/mens-sale'},[{...p,id:11,title:"Excel LT Laceup Men's Shoes - Dark Brown Leather",vendor:'Hush Puppies Philippines',options:[{name:'Size'}],variants:[v(111,'8',null,3640,5200)]}],at)[0];
 assert.deepEqual([hp.name,hp.color,hp.sizeSystem],['Excel LT Laceup Shoes','Dark Brown Leather','Unverified'],'whole sizes with no US label stay unchecked');
});
test('Toby\'s keeps only Adidas and Nike under their own names, listed at Toby\'s, with men\'s sizes out of "M 8 / W 9"',()=>{
 const tobys={id:'tobys',brand:"Toby's",retailer:"Toby's",shopify:true,vendors:{adidas:'Adidas',nike:'Nike'},url:'https://www.tobys.com/collections/mens-collection-sale'};
 const shoe={id:20,title:"adidas Men's Duramo SL 2 Running Shoes",product_type:"Men's Road Running Footwear",vendor:'adidas',tags:[],handle:'duramo',options:[{name:'Color'},{name:'US Size'}],variants:[v(201,'Black','M 8 / W 9',2240,3200),v(202,'Black','M 8.5 / W 9.5',2240,3200)]};
 const tee={id:21,title:"Nike Men's Dri-FIT Training Tee",product_type:"Men's Training Apparel",vendor:'Nike',tags:[],handle:'tee',options:[{name:'Color'},{name:'US Size'}],variants:[v(211,'White','S',995,1495)]};
 const rows=parseShopify(tobys,[shoe,tee,{...shoe,id:22,vendor:'Saucony',title:"Saucony Men's Ride 18"}],at);
 assert.deepEqual(rows.map(r=>[r.brand,r.retailer,r.name,r.sizeSystem,r.availableSizes]).sort(),[['Adidas',"Toby's",'Duramo SL 2 Running Shoes','US men',['8','8.5']],['Nike',"Toby's",'Dri-FIT Training Tee','US clothing',['S']]]);
});
test('Columbia sizes: "S R" is a regular-length Small, and "US9" on every shoe size makes them US men\'s',()=>{
 const col={id:'columbia',brand:'Columbia',shopify:true,url:'https://www.columbiasportswear.com.ph/collections/men-sale'};
 const jacket={id:30,title:"Men's Spire Valley Hooded Windbreaker",product_type:'',vendor:'Columbia Sportswear',tags:['Men_Jackets'],handle:'spire',options:[{name:'Color'},{name:'Size'}],variants:[v(301,'Black','S R',3200,4490),v(302,'Black','M R',3200,4490)]};
 const shoe={id:31,title:"Men's Konos TRS OutDry Shoe",product_type:'',vendor:'Columbia Sportswear',tags:[],handle:'konos',options:[{name:'Color'},{name:'Size'}],variants:[v(311,'Grey','US8',9490,9990),v(312,'Grey','US9',9490,9990)]};
 const rows=parseShopify(col,[jacket,shoe],at),j=rows.find(r=>r.category==='Outerwear'),s=rows.find(r=>r.category==='Footwear');
 assert.deepEqual([j.availableSizes,j.sizeSystem],[['S','M'],'Labelled clothing']);
 // Columbia's own marks, as listed on 29 Oct: "US:S" is US sizing, "ASIAN:XL" is not, a mix is left unchecked.
 const marked=sizes=>parseShopify(col,[{...jacket,variants:sizes.map((x,n)=>v(400+n,'Black',x,3200,4490))}],at)[0];
 assert.deepEqual([marked(['US:S','US:M']).availableSizes,marked(['US:S','US:M']).sizeSystem],[['S','M'],'US clothing']);
 assert.equal(marked(['ASIAN:XL']).sizeSystem,'Labelled clothing');assert.equal(marked(['US:S','ASIAN:XL']).sizeSystem,'Unverified');assert.deepEqual([s.availableSizes,s.sizeSystem],[['8','9'],'US men']);
});
