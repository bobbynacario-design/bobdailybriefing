import {test} from 'node:test';import assert from 'node:assert/strict';import './shopping-taste.js';import './shopping-style.js';import './shopping-core.js';
const C=globalThis.ShoppingCore,now=Date.parse('2026-10-17T04:00:00Z');
const item={id:'hm123',brand:'H&M',category:'Tops',price:500,originalPrice:1000,checkedAt:'2026-10-17T03:00:00Z',url:'https://www2.hm.com/en_ph/productpage.123.html',channel:'online',sizeSystem:'Labelled clothing',availableSizes:['M']};

test('specific needs require garment and material evidence and explain inferred use',()=>{
 const need={id:'work',text:'Breathable work polos',category:'Tops',garment:'Polo',use:'Work',material:'Cotton',budget:600},p=C.cleanPrefs({needs:[need]});
 const polo={...item,name:'Regular Fit Cotton Polo'};
 const rows=[polo,{...polo,id:'tee',name:'Cotton T-shirt'},{...polo,id:'unknown-material',name:'Polo Shirt'},{...polo,id:'wrong-use',name:'Cotton Running T-shirt'},{...polo,id:'dear',price:601},{...polo,id:'variant',priceFrom:true},{...polo,id:'wrong-size',availableSizes:['L']}];
 assert.deepEqual(C.matchItems({items:rows},p,{need:'work'},now).map(i=>i.id),['hm123']);
 assert.match(C.needMatch(polo,p.needs[0]).reasons.join(' · '),/Polo named in listing.*Cotton named in listing.*Work use suggested by garment type.*within ₱600/);
 assert.equal(C.needMatch({...polo,name:'Cotton Polo'}, {...need,use:'Active'}).matches,false);
 assert.equal(C.needMatch({...polo,name:'Dri-FIT Polo'}, {...need,material:'Quick-dry'}).matches,true);
 assert.equal(C.needMatch({...polo,name:'Cotton T-shirt'}, {...need,garment:'Shirt',use:''}).matches,false);
 assert.equal(C.needMatch({...polo,name:'Cotton Oxford Shirt'}, {...need,garment:'Shirt'}).matches,true);
});

test('old needs keep category and budget behaviour; structured choices survive cleaning',()=>{
 const old={id:'old',text:'Breathable work polos',category:'Tops',budget:600},p=C.cleanPrefs({needs:[old]});
 assert.equal(C.matchItems({items:[item]},p,{need:'old'},now).length,1);
 assert.equal(p.needs[0].garment,'');
 const structured=C.cleanPrefs({needs:[{...old,garment:'Polo',use:'Work',material:'Cotton'}]});
 assert.deepEqual(C.cleanPrefs(structured).needs,structured.needs);
 const invalid=C.cleanPrefs({needs:[{...old,garment:'__proto__',use:'Anything',material:'Magic'}]}).needs[0];
 assert.equal(invalid.garment,'');assert.equal(invalid.use,'');assert.equal(invalid.material,'');
});
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
test('brands added after a profile was saved start ticked; once a save has shown them, an untick holds',()=>{
 // Bob's profile as saved on 18 Oct: the six first brands, no brandsSeen.
 const old=C.cleanPrefs({brands:['UNIQLO','H&M','Nike']});
 assert.deepEqual(old.brands,['UNIQLO','H&M','Nike',"Levi's",'Under Armour','Penshoppe','Sperry','Columbia','Hush Puppies',"Toby's",...C.BRANDS.slice(13)]);assert.deepEqual(old.brandsSeen,C.BRANDS);
 // A profile saved on 29 Oct had seen nine brands; the four added after start ticked, an untick holds.
 const nine=C.cleanPrefs({brands:['UNIQLO','H&M',"Levi's"],brandsSeen:C.BRANDS.slice(0,9)});
 assert.deepEqual(nine.brands,['UNIQLO','H&M',"Levi's",'Sperry','Columbia','Hush Puppies',"Toby's",...C.BRANDS.slice(13)]);
 const unticked=C.cleanPrefs({...old,brands:old.brands.filter(b=>b!=='Penshoppe')});
 assert.ok(!unticked.brands.includes('Penshoppe'));assert.deepEqual(C.cleanPrefs(unticked).brands,unticked.brands);
 const levis={...item,id:'lv1',brand:"Levi's",url:'https://www.levi.com.ph/products/505-regular?variant=11'};
 assert.equal(C.matchItems({items:[levis]},old,{brand:"Levi's"},now).length,1);
 assert.equal(C.safeUrl('https://www.underarmour.com.ph/products/tech?variant=1'),'https://www.underarmour.com.ph/products/tech?variant=1');
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
test('checked shoe sizes: 8.5 in stock matches, sold out hides, and a whole-size-only range stays unchecked',()=>{
 const p=C.cleanPrefs(),shoe={...item,brand:'Nike',category:'Footwear',sizeSystem:'US men',sizeRun:['8','8.5','9'],url:'https://www.nike.com/ph/t/x/AB1234-001'};
 assert.equal(C.sizeMatch({...shoe,availableSizes:['8','8.5']},p),'match');
 assert.equal(C.sizeMatch({...shoe,availableSizes:['8','9']},p),'unavailable');
 const slide={...shoe,sizeRun:['7','8','9','10'],availableSizes:['8','9']};
 assert.equal(C.sizeMatch(slide,p),'unknown');assert.equal(C.matchItems({items:[slide]},p,{},now).length,1);assert.equal(C.matchItems({items:[slide]},p,{confirmed:true},now).length,0);
 assert.equal(C.sizeMatch(slide,C.cleanPrefs({shoeSize:9})),'match');assert.equal(C.sizeMatch({...slide,availableSizes:['8']},C.cleanPrefs({shoeSize:9})),'unavailable');
 // A Crocs variant row from the Shopify feed has no size run: unchanged behaviour.
 assert.equal(C.sizeMatch({...shoe,sizeRun:undefined,availableSizes:['8']},p),'unavailable');
});
test('a scraped price goes stale after four days; a dated offer lasts until its end date, at most 35 days',()=>{
 const scraped={...item,checkedAt:'2026-10-12T03:00:00Z'};assert.equal(C.fresh(scraped,now),false);assert.equal(C.fresh({...item},now),true);
 const offer={...item,checkedAt:'2026-10-12T03:00:00Z',validFrom:'2026-10-10',validTo:'2026-10-22'};assert.equal(C.fresh(offer,now),true);
 assert.equal(C.fresh(offer,Date.parse('2026-10-22T15:00:00Z')),true);assert.equal(C.fresh(offer,Date.parse('2026-10-22T16:00:00Z')),false);
 assert.equal(C.fresh({...offer,checkedAt:'2026-09-01T00:00:00Z',validTo:'2026-12-31'},now),false);
});
test('waist and jacket sizes check numeric H&M labels; unset or unfamiliar numbers stay unchecked',()=>{
 // Labels as H&M PH listed them on 17 Oct.
 const pants={...item,category:'Trousers',availableSizes:['30L','34L','28','30','32']},blazer={...item,category:'Outerwear',availableSizes:['42','44','48','52']};
 assert.equal(C.sizeMatch(pants,C.cleanPrefs()),'unknown');assert.equal(C.sizeLabel(pants,C.cleanPrefs()),'add your waist size');
 assert.equal(C.sizeMatch(pants,C.cleanPrefs({waistSize:'32'})),'match');assert.equal(C.sizeMatch(pants,C.cleanPrefs({waistSize:34})),'match');assert.equal(C.sizeMatch(pants,C.cleanPrefs({waistSize:36})),'unavailable');
 assert.equal(C.sizeMatch(blazer,C.cleanPrefs({jacketSize:'48'})),'match');assert.equal(C.sizeMatch(blazer,C.cleanPrefs({jacketSize:50})),'unavailable');assert.equal(C.sizeLabel(blazer,C.cleanPrefs({jacketSize:50})),'EU 50');
 // EU trouser sizes and odd values are not read as a waist.
 assert.equal(C.sizeMatch({...pants,availableSizes:['46','48','50']},C.cleanPrefs({waistSize:32})),'unknown');
 assert.equal(C.cleanPrefs({waistSize:'32.5',jacketSize:'49'}).waistSize,null);assert.equal(C.cleanPrefs({jacketSize:'49'}).jacketSize,null);
 // Letter sizes still decide when present.
 assert.equal(C.sizeMatch({...pants,availableSizes:['S','M']},C.cleanPrefs({waistSize:30})),'match');
});
test('price memory tells a fresh low from a price that was cheaper before or has not moved',()=>{
 const seen={...item,price:700,firstSeen:'2026-10-13T00:05:00Z',checks:2,previousPrice:800,previousChecked:'2026-10-16T00:05:00Z',priorLow:750,priorLowAt:'2026-10-16T00:05:00Z',priorHigh:800};
 assert.deepEqual(C.priceMemory(seen),{kind:'low',text:'Lowest price seen since Oct 13, down from ₱800.'});
 assert.deepEqual(C.priceMemory({...seen,price:800,previousPrice:800}),{kind:'higher',text:'Was ₱750 on Oct 16; cheaper before.'});
 assert.equal(C.priceMemory({...seen,price:750}).kind,'matched');
 assert.deepEqual(C.priceMemory({...seen,price:800,previousPrice:800,priorLow:800,priorHigh:800}),{kind:'same',text:'Same price at every check since Oct 13.'});
 assert.deepEqual(C.priceMemory({...item,firstSeen:'2026-10-17T03:00:00Z',checks:0}),{kind:'new',text:'First seen Oct 17.'});
 // Cheaper before costs 5 rank points; a fall since the last check adds 5.
 const p=C.cleanPrefs(),flat={...item,availableSizes:null};
 assert.equal(C.rankValue({...flat,priorLow:400,priorHigh:500,previousPrice:500},p,null)-C.rankValue(flat,p,null),-5);
 assert.equal(C.rankValue({...flat,priorLow:600,priorHigh:600,previousPrice:600},p,null)-C.rankValue(flat,p,null),5);
});
test('an odd waist in a line cut in even waists only is a size-chart check, not hidden',()=>{
 // Size runs as H&M PH listed them on 17 Oct: wool-blend pants in even waists
 // (with long-leg "L" variants), corduroy pants with odd waists in the run.
 const p=C.cleanPrefs({waistSize:31}),pants={...item,category:'Trousers',availableSizes:['28','30','32'],sizeRun:['30L','32L','34L','36L','28','30','32','34']};
 assert.equal(C.evenWaistsOnly(pants),true);assert.equal(C.sizeMatch(pants,p),'unknown');assert.equal(C.matchItems({items:[pants]},p,{},now).length,1);assert.equal(C.matchItems({items:[pants]},p,{confirmed:true},now).length,0);
 const cord={...pants,availableSizes:['29'],sizeRun:['28','29','30','31','32','33','34','36']};assert.equal(C.sizeMatch(cord,p),'unavailable');
 assert.equal(C.sizeMatch(pants,C.cleanPrefs({waistSize:34})),'unavailable');assert.equal(C.sizeMatch(pants,C.cleanPrefs({waistSize:32})),'match');
 // Older scout rows without a run keep the strict rule.
 assert.equal(C.sizeMatch({...pants,sizeRun:undefined},p),'unavailable');
});
test("Toby's lists Nike and Adidas: an item needs both the store and its brand ticked, and the Toby's filter shows the store's items",()=>{
 const adidas={...item,id:'tb1',brand:'Adidas',retailer:"Toby's",url:'https://www.tobys.com/products/duramo?variant=1'};
 assert.equal(C.matchItems({items:[adidas]},C.cleanPrefs(),{},now).length,1);
 assert.equal(C.matchItems({items:[adidas]},C.cleanPrefs({brands:C.BRANDS.filter(b=>b!=="Toby's"),brandsSeen:C.BRANDS}),{},now).length,0,"Toby's unticked");
 assert.equal(C.matchItems({items:[adidas]},C.cleanPrefs({brands:C.BRANDS.filter(b=>b!=='Adidas'),brandsSeen:C.BRANDS}),{},now).length,0,'Adidas unticked');
 assert.equal(C.matchItems({items:[adidas,item]},C.cleanPrefs(),{brand:"Toby's"},now).length,1);
 assert.equal(C.matchItems({items:[adidas]},C.cleanPrefs(),{brand:'Adidas'},now).length,1);
});

test('new brands respect saved opt-outs, Sports Central requires brand and retailer, and unknown units stay unchecked',()=>{
 const p=C.cleanPrefs({brands:['H&M'],brandsSeen:C.BRANDS.slice(0,13),shoeSize:8.5});
 for(const b of ['Giordano','Memo','Regatta','Timberland','Skechers','Puma','Sports Central'])assert.ok(p.brands.includes(b));
 assert.ok(!p.brands.includes('Nike'));assert.equal(p.clothingSize,'M');
 const opted=C.cleanPrefs({...p,brands:p.brands.filter(b=>b!=='Memo')});assert.ok(!C.cleanPrefs(opted).brands.includes('Memo'));
 const sc={...item,id:'sc1',brand:'Skechers',retailer:'Sports Central',category:'Footwear',sizeSystem:'US men',availableSizes:['8.5'],url:'https://sportscentral.ph/products/shoe?variant=1'};
 assert.equal(C.matchItems({items:[sc]},p,{brand:'Sports Central'},now).length,1);
 for(const off of ['Skechers','Sports Central'])assert.equal(C.matchItems({items:[sc]},{...p,brands:p.brands.filter(b=>b!==off)},{},now).length,0);
 assert.equal(C.sizeMatch({...sc,sizeSystem:'Unverified',availableSizes:['8 UK']},p),'unknown');
 assert.equal(C.wholeSizesOnly({sizeRun:['8 UK','9 UK']}),false);
 for(const u of ['https://giordano.ph/products/p','https://memofashion.com/products/p','https://www.regattalifestyle.com/products/p','https://timberland.com.ph/products/p','https://sportscentral.ph/products/p'])assert.ok(C.safeUrl(u));
 assert.equal(C.safeUrl('https://sportscentral.ph.attacker.test/products/p'),'');
});
