import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
function env(overrides={}){const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',checked:false});return elements.get(id);};const c={URL,Date,Intl,console,Promise,document:{getElementById:get},fbLoadShopping:async()=>({generatedAt:new Date().toISOString(),items:[],sources:[]}),fbLoadShoppingPrefs:async()=>({}),...overrides};c.window=c;vm.createContext(c);for(const f of ['shopping-taste','shopping-style','shopping-trips','shopping-core','shopping-ui'])vm.runInContext(readFileSync(new URL('./'+f+'.js',import.meta.url),'utf8'),c);return {c,get};}

test('expanded brands appear in the profile and Sports Central products remain under their maker',async()=>{
 const at=new Date().toISOString(),{c,get}=env({fbLoadShopping:async()=>({generatedAt:at,items:[{id:'sc1',brand:'Skechers',retailer:'Sports Central',name:'Men Summits Shoes',category:'Footwear',price:2000,originalPrice:3500,url:'https://sportscentral.ph/products/summits',checkedAt:at,availableSizes:['8.5'],sizeSystem:'US men'}],sources:[]}),fbLoadShoppingPrefs:async()=>({brands:['H&M'],brandsSeen:['UNIQLO','H&M','ZALORA','Nike','Adidas','Crocs',"Levi's",'Under Armour','Penshoppe','Sperry','Columbia','Hush Puppies',"Toby's"]})});
 await c.renderShopping();
 for(const b of ['Giordano','Memo','Regatta','Timberland','Skechers','Puma','Sports Central'])assert.ok(get('shopping-profile').innerHTML.includes('value="'+b+'" checked'));
 get('shopping-brand').value='Sports Central';c.renderShoppingDeals();assert.match(get('shopping-results').innerHTML,/Skechers · listed at Sports Central/);assert.match(get('shopping-results').innerHTML,/Your size is listed as available/);
});

test('specific needs can be added and edited without dropping preferences or the selected need',async()=>{
 let last;const {c,get}=env({crypto:{randomUUID:()=> 'new-need'},fbLoadShoppingPrefs:async()=>({saved:['kept'],wardrobe:{chinos:1},needs:[{id:'old',text:'Work',category:'Tops'}]}),fbSaveShoppingPrefs:async p=>last=p});
 await c.renderShopping();const values={text:'Work polos',category:'Tops',garment:'Polo',use:'Work',material:'Cotton',budget:'1500'};
 const form={elements:{namedItem:k=>({value:values[k] || ''})}};await c.addShoppingNeed(form);
 assert.equal(last.needs.length,2);assert.equal(last.needs[1].material,'Cotton');assert.equal(last.saved[0],'kept');assert.equal(last.wardrobe.chinos,1);assert.equal(get('shopping-need').value,'new-need');
 const fields=Object.fromEntries(['id','text','category','garment','use','material','budget'].map(k=>[k,{value:'',focus(){}}]));get('shopping-need-form').elements={namedItem:k=>fields[k]};
 c.editShoppingNeed('new-need');assert.equal(fields.garment.value,'Polo');assert.equal(fields.budget.value,1500);assert.equal(get('shopping-need-submit').textContent,'Save shopping need');
 values.id='new-need';values.budget='1000';await c.addShoppingNeed(form);assert.equal(last.needs.length,2);assert.equal(last.needs[1].budget,1000);
 await c.saveShoppingTaste({querySelectorAll:()=>[],elements:{namedItem:()=>({value:''})}});assert.equal(get('shopping-need').value,'new-need');assert.equal(last.needs[1].use,'Work');
 values.category='Footwear';await c.addShoppingNeed(form);assert.equal(last.needs[1].category,'Tops');assert.match(get('shopping-status').textContent,/Choose Tops or All/);
});

test('cards expose one verdict and keep pairing and price history in a closed explanation',async()=>{
 const at=new Date().toISOString(),{c,get}=env({fbLoadShopping:async()=>({generatedAt:at,items:[{id:'polo',brand:'H&M',name:'Cotton Polo',category:'Tops',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.1.html',checkedAt:at,availableSizes:['M'],sizeSystem:'Labelled clothing'}]}),fbLoadShoppingPrefs:async()=>({wardrobe:{polo:0,chinos:1,shorts:1,sneakers:1}})});
 await c.renderShopping();const html=get('shopping-results').innerHTML,split=html.indexOf('<details class="shopping-explanation">');assert.ok(split>0);
 assert.equal((html.match(/class="shopping-verdict /g) || []).length,1);assert.doesNotMatch(html,/shopping-match-label/);
 assert.match(html.slice(0,split),/Worth it[\s\S]*Fills a gap[\s\S]*Check:[\s\S]*Check price, size &amp; returns/);
 assert.doesNotMatch(html.slice(0,split),/Pair it with|First seen/);assert.match(html.slice(split),/Why this recommendation[\s\S]*Pair it with[\s\S]*First seen/);
 assert.match(get('shopping-glance').innerHTML,/<b>1<\/b><span>Worth it matches/);
 c.resetShopping();assert.equal(get('shopping-glance').innerHTML,'');
});
test('loading is read-only, output escapes retailer text, and reset discards a late account response',async()=>{
 let writes=0,finish;const {c,get}=env({fbSaveShoppingPrefs:async()=>writes++,fbLoadShopping:async()=>({generatedAt:new Date().toISOString(),sources:[],items:[{id:'safe-id',brand:'H&M',name:'Polo <script>',category:'Tops',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.123.html',availableSizes:['M'],checkedAt:new Date().toISOString()}]})});
 await c.renderShopping();assert.equal(writes,0);assert.match(get('shopping-results').innerHTML,/Polo &lt;script&gt;/);assert.match(get('shopping-results').innerHTML,/delivery fee/);
 c.fbLoadShopping=()=>new Promise(r=>finish=r);const pending=c.renderShopping();c.resetShopping();finish({items:[]});await pending;assert.equal(get('shopping-results').innerHTML,'');
});
test('unreadable preferences block saving and never replace existing account preferences with defaults',async()=>{
 let writes=0;const {c,get}=env({fbLoadShoppingPrefs:async()=>{throw Error('offline');},fbSaveShoppingPrefs:async()=>writes++});await c.renderShopping();await c.toggleShoppingSave('abc');assert.equal(writes,0);assert.match(get('shopping-status').textContent,/Saving is disabled/);
});
test('taste save and feedback preserve existing sizes, brands, needs and saved deals; undo removes only feedback',async()=>{
 let last;const at=new Date().toISOString(),item={id:'polo',name:'Regular Fit Cotton Polo',brand:'H&M',color:'Navy',category:'Tops',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.123.html',checkedAt:at};
 const {c,get}=env({fbLoadShopping:async()=>({generatedAt:at,items:[item]}),fbLoadShoppingPrefs:async()=>({brands:['H&M'],saved:['polo'],shoeSize:8.5,needs:[{id:'work',text:'Work tops',category:'Tops'}]}),fbSaveShoppingPrefs:async p=>last=p});await c.renderShopping();
 await c.saveShoppingTaste({querySelectorAll:selector=>selector.includes('taste-fits')?[{value:'Regular'}]:selector.includes('taste-colors')?[{value:'Navy'}]:[],elements:{namedItem:name=>({value:name==='budget-Tops'?'1000':''})}});
 assert.equal(last.taste.budgets.Tops,1000);assert.equal(last.saved[0],'polo');assert.equal(last.needs[0].id,'work');assert.equal(last.shoeSize,8.5);assert.equal(last.brands[0],'H&M');assert.match(get('shopping-results').innerHTML,/Fit named in the listing: Regular/);
 get('shopping-reason-polo').value='color';await c.rateShoppingDeal('polo','like');assert.equal(last.feedback[0].reason,'color');assert.equal(last.taste.colors[0],'Navy');assert.match(get('shopping-results').innerHTML,/You marked this item My style/);
 await c.undoShoppingFeedback('polo');assert.equal(last.feedback.length,0);assert.equal(last.saved[0],'polo');assert.equal(last.taste.colors[0],'Navy');
});
test('account reset discards a late feedback-save response',async()=>{
 let finish;const at=new Date().toISOString(),{c,get}=env({fbLoadShopping:async()=>({generatedAt:at,items:[{id:'polo',name:'Polo',brand:'H&M',category:'Tops',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.123.html',checkedAt:at}]}),fbSaveShoppingPrefs:()=>new Promise(r=>finish=r)});await c.renderShopping();const pending=c.rateShoppingDeal('polo','like');c.resetShopping();finish();await pending;assert.equal(get('shopping-results').innerHTML,'');assert.equal(get('shopping-taste').innerHTML,'');
});
test('Bought it preserves the profile, updates the confirmed wardrobe count once, and undo restores it',async()=>{
 let last,writes=0;const at=new Date().toISOString(),item={id:'polo',brand:'H&M',name:'Plain Polo Shirt',category:'Tops',color:'Navy',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.123.html',checkedAt:at,availableSizes:['M'],sizeSystem:'Labelled clothing'};
 const {c,get}=env({fbLoadShopping:async()=>({generatedAt:at,items:[item]}),fbLoadShoppingPrefs:async()=>({wardrobe:{polo:0,chinos:1,sneakers:1},taste:{colors:['Navy']},saved:['polo']}),fbSaveShoppingPrefs:async p=>{last=p;writes++;}});await c.renderShopping();assert.match(get('shopping-results').innerHTML,/Bought it/);assert.equal(writes,0);
 const form={elements:{namedItem:k=>({value:k==='piece'?'polo':'1'})}};await c.recordShoppingPurchase('polo',form);assert.equal(last.wardrobe.polo,1);assert.equal(last.purchases.length,1);assert.equal(last.saved[0],'polo');assert.equal(last.taste.colors[0],'Navy');assert.match(get('shopping-results').innerHTML,/Already bought/);
 await c.recordShoppingPurchase('polo',form);assert.equal(writes,1);await c.undoShoppingPurchase('polo');assert.equal(last.purchases.length,0);assert.equal(last.wardrobe.polo,0);assert.equal(last.wardrobe.chinos,1);
});
test('a purchase save failure or account reset does not change the visible wardrobe',async()=>{
 const at=new Date().toISOString(),{c,get}=env({fbLoadShopping:async()=>({generatedAt:at,items:[{id:'polo',brand:'H&M',name:'Polo',category:'Tops',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.123.html',checkedAt:at}]}),fbLoadShoppingPrefs:async()=>({wardrobe:{polo:0}}),fbSaveShoppingPrefs:async()=>{throw Error('offline');}});await c.renderShopping();const form={elements:{namedItem:k=>({value:k==='piece'?'polo':'1'})}};await c.recordShoppingPurchase('polo',form);assert.doesNotMatch(get('shopping-results').innerHTML,/Already bought/);assert.match(get('shopping-status').textContent,/Could not save/);
 let finish;c.fbSaveShoppingPrefs=()=>new Promise(r=>finish=r);const pending=c.recordShoppingPurchase('polo',form);c.resetShopping();finish();await pending;assert.equal(get('shopping-results').innerHTML,'');assert.equal(get('shopping-style').innerHTML,'');
});
test('brand selection filters markdowns and leads; ZALORA includes its listed brands and combines with category',async()=>{
 const at=new Date().toISOString(),base={category:'Tops',price:500,originalPrice:1000,availableSizes:null,checkedAt:at},items=[{...base,id:'uq',brand:'UNIQLO',name:'Uniqlo polo',url:'https://www.uniqlo.com/ph/en/products/E123456-000/00'},{...base,id:'ad',brand:'Adidas',retailer:'ZALORA',name:'Adidas top',url:'https://www.zalora.com.ph/p/adidas'},{...base,id:'cr',brand:'Crocs',retailer:'ZALORA',category:'Footwear',name:'Crocs clogs',url:'https://www.zalora.com.ph/p/crocs'}];
 const campaigns=items.map(i=>({...i,kind:'voucher',condition:'Voucher offer'})),{c,get}=env({fbLoadShopping:async()=>({generatedAt:at,items,campaigns})});await c.renderShopping();get('shopping-brand').value='UNIQLO';c.renderShoppingDeals();assert.match(get('shopping-results').innerHTML,/Uniqlo polo/);assert.doesNotMatch(get('shopping-results').innerHTML,/Adidas top/);assert.doesNotMatch(get('shopping-campaigns').innerHTML,/Adidas top/);
 get('shopping-brand').value='ZALORA';c.renderShoppingDeals();assert.match(get('shopping-results').innerHTML,/Adidas top/);assert.match(get('shopping-results').innerHTML,/Crocs clogs/);assert.doesNotMatch(get('shopping-results').innerHTML,/Uniqlo polo/);assert.doesNotMatch(get('shopping-campaigns').innerHTML,/Uniqlo polo/);
 get('shopping-category').value='Footwear';c.renderShoppingDeals();assert.doesNotMatch(get('shopping-results').innerHTML,/Adidas top/);assert.match(get('shopping-results').innerHTML,/Crocs clogs/);c.resetShopping();assert.equal(get('shopping-brand').value,'');
});
test('numeric clothing stock remains visible and delivery caveats appear only once above multiple cards',async()=>{
 const at=new Date().toISOString(),base={brand:'H&M',name:'Jacket',category:'Outerwear',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.123.html',sizeSystem:'Labelled clothing',availableSizes:['42','44','46'],checkedAt:at};
 const {c,get}=env({fbLoadShopping:async()=>({generatedAt:at,items:[{...base,id:'numeric'},{...base,id:'from',priceFrom:true}]})});await c.renderShopping();
 const html=get('shopping-results').innerHTML;assert.equal((html.match(/QC delivery fee/g)||[]).length,1);assert.equal((html.match(/Your size is not checked/g)||[]).length,2);assert.equal((html.match(/your size may cost more/g)||[]).length,1);
 get('shopping-confirmed').checked=true;c.renderShoppingDeals();assert.doesNotMatch(get('shopping-results').innerHTML,/<article/);
});
test('variant minimum prices are labelled and conditional offers render outside ranked item deals',async()=>{
 const at=new Date().toISOString(),{c,get}=env({fbLoadShopping:async()=>({generatedAt:at,sources:[],items:[{id:'adidas-1',brand:'Adidas',retailer:'ZALORA',name:'Shoes',category:'Footwear',price:1000,originalPrice:2000,priceFrom:true,url:'https://www.zalora.com.ph/p/shoes',availableSizes:null,checkedAt:at}],campaigns:[1,2,3,4].map(n=>({brand:'Adidas',retailer:'ZALORA',name:'Coupon <offer> '+n,kind:'voucher',condition:'Buy 3, Get 15% Off',price:900,originalPrice:1000,url:'https://www.zalora.com.ph/p/x'+n,checkedAt:at})).concat([{brand:'Adidas',retailer:'ZALORA',name:'Old format',kind:'conditional',terms:'raw',url:'https://www.zalora.com.ph/p/old',checkedAt:at}])})});
 await c.renderShopping();assert.match(get('shopping-results').innerHTML,/From /);assert.match(get('shopping-results').innerHTML,/listed at ZALORA/);assert.match(get('shopping-results').innerHTML,/your size may cost more/);assert.doesNotMatch(get('shopping-results').innerHTML,/Coupon/);
 const leads=get('shopping-campaigns').innerHTML;assert.equal((leads.match(/<li>/g) || []).length,1);assert.match(leads,/Coupon &lt;offer&gt; 1/);assert.match(leads,/and 1 more/);assert.doesNotMatch(leads,/Old format/);
});
test('the profile form saves waist and jacket sizes, and blank stays unset',async()=>{
 let last;const {c}=env({fbLoadShoppingPrefs:async()=>({brands:['H&M'],saved:['polo']}),fbSaveShoppingPrefs:async p=>{last=p;}});await c.renderShopping();
 const form=v=>({querySelectorAll:sel=>sel.includes('brand')?[{value:'H&M'}]:sel.includes('area')?[{value:'Makati'}]:[],elements:{namedItem:k=>({value:v[k]})}});
 await c.saveShoppingProfile(form({clothingSize:'M',americanSize:'S',shoeSize:'8.5',waistSize:'32',jacketSize:'48'}));assert.equal(last.waistSize,32);assert.equal(last.jacketSize,48);assert.deepEqual(last.saved,['polo']);
 await c.saveShoppingProfile(form({clothingSize:'M',americanSize:'S',shoeSize:'8.5',waistSize:'',jacketSize:''}));assert.equal(last.waistSize,null);assert.equal(last.jacketSize,null);
});
test('the style guide renders, saving the wardrobe keeps the rest of the profile, and cards carry a verdict',async()=>{
 const at=new Date().toISOString(),hm={brand:'H&M',category:'Tops',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.123.html',checkedAt:at,availableSizes:['M'],sizeSystem:'Labelled clothing'};
 let last;const {c,get}=env({fbLoadShopping:async()=>({generatedAt:at,items:[{...hm,id:'polo',name:'Regular-Fit Polo Shirt',color:'Navy'},{...hm,id:'spikes',brand:'Nike',category:'Footwear',url:'https://www.nike.com/ph/t/x/FZ9315-100',name:'Nike Victory 2 · Athletics Distance Spikes'}]}),fbLoadShoppingPrefs:async()=>({brands:['H&M','Nike'],saved:['polo'],shoeSize:9}),fbSaveShoppingPrefs:async p=>{last=p;}});
 await c.renderShopping();assert.match(get('shopping-style').innerHTML,/add your wardrobe so each deal gets a verdict/);assert.match(get('shopping-style').innerHTML,/Casino night/);
 assert.match(get('shopping-results').innerHTML,/Likely to sit unworn/);assert.doesNotMatch(get('shopping-results').innerHTML,/Worth it/);
 const form={elements:{namedItem:k=>({value:{'wardrobe-polo':'0','wardrobe-chinos':'1','wardrobe-shorts':'2','wardrobe-sneakers':'1'}[k] || ''})}};
 await c.saveShoppingWardrobe(form);assert.equal(JSON.stringify(last.wardrobe),JSON.stringify({polo:0,chinos:1,shorts:2,sneakers:1}));assert.equal(JSON.stringify(last.saved),'["polo"]');assert.equal(last.shoeSize,9);
 assert.match(get('shopping-style').innerHTML,/4 pieces in your wardrobe/);assert.match(get('shopping-results').innerHTML,/Worth it/);
 get('shopping-wear').checked=true;c.renderShoppingDeals();assert.doesNotMatch(get('shopping-results').innerHTML,/Spikes/);
});
test('the style guide shows your next trips with what to pack and what is short',async()=>{
 const at=new Date().toISOString(),soon=d=>new Date(Date.now()+d*86400000).toISOString().slice(0,10);
 const {c,get}=env({fbSaveShoppingPrefs:async()=>{},fbLoadShopping:async()=>({generatedAt:at,items:[]}),fbLoadShoppingPrefs:async()=>({wardrobe:{jeans:1,chinos:0,'tee-dark':6,knit:2,sneakers:1,'smart-shoes':1,shirt:5}}),fbLoadHotelTrips:async()=>({trips:[{kind:'leave',city:'Hong Kong',checkIn:soon(40),checkOut:soon(52)},{kind:'leave-fare',city:'Hong Kong',checkIn:soon(41),checkOut:soon(49)}]})});
 await c.renderShopping();const html=get('shopping-style').innerHTML;
 assert.match(html,/Your next trips/);assert.equal((html.match(/<b>Hong Kong/g) || []).length,1);assert.match(html,/12 nights/);assert.match(html,/Preview only/);assert.doesNotMatch(html,/Packing gaps:/);const id=c.ShoppingTrips.plan({})[0].id;await c.saveShoppingTrips({querySelectorAll:()=>[{value:id}]});assert.match(get('shopping-style').innerHTML,/Packing gaps:<\/b> 1 more chinos or jeans for evenings · order by/);
 c.resetShopping();assert.equal(c.ShoppingTrips.plan({wardrobe:{}}).length,0);
});
test('deal cards carry a Pair it with line',async()=>{
 const at=new Date().toISOString(),{c,get}=env({fbLoadShopping:async()=>({generatedAt:at,items:[{id:'cream',brand:'H&M',name:'Regular-Fit Short-Sleeved Shirt',color:'Cream',category:'Tops',price:699,originalPrice:1790,url:'https://www2.hm.com/en_ph/productpage.1.html',availableSizes:['M'],sizeSystem:'Labelled clothing',checkedAt:at}]}),fbLoadShoppingPrefs:async()=>({wardrobe:{jeans:1,shorts:5,sneakers:1}})});
 await c.renderShopping();assert.match(get('shopping-results').innerHTML,/<b>Pair it with<\/b> navy, brown, grey or blue-denim bottoms \(you have dark jeans or casual shorts; check their colours\)/);
});
test('optional wardrobe colours save privately and preserve trip choices, sizes and purchases',async()=>{
 let saved;const at=new Date().toISOString(),item={id:'polo',name:'Plain Polo Shirt',category:'Tops',color:'White',brand:'H&M',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.1.html',checkedAt:at};
 const prefs={wardrobe:{chinos:1,sneakers:1},tripPlans:['hong-kong-2026-12-19-2026-12-31'],shoeSize:8.5,purchases:[{id:'bought',name:'Other item',at,piece:'',previousCount:null,recordedCount:null}]};
 const {c,get}=env({fbLoadShopping:async()=>({items:[item]}),fbLoadShoppingPrefs:async()=>prefs,fbSaveShoppingPrefs:async p=>{saved=p;}});await c.renderShopping();
 const vals={'wardrobe-chinos':'1','wardrobe-sneakers':'1','wardrobe-colors-chinos':'Navy','wardrobe-colors-sneakers':'White'};
 await c.saveShoppingWardrobe({elements:{namedItem:k=>({value:vals[k] || ''})}});
 assert.equal(saved.wardrobeColors.chinos[0],'Navy');assert.equal(saved.shoeSize,8.5);assert.equal(saved.tripPlans[0],prefs.tripPlans[0]);assert.equal(saved.purchases.length,1);assert.match(get('shopping-results').innerHTML,/your navy chinos · your white everyday sneakers/);
});
test('failed or late trip and colour writes preserve the visible profile',async()=>{
 let finish;const {c,get}=env({fbLoadShoppingPrefs:async()=>({wardrobe:{chinos:1},wardrobeColors:{chinos:['Navy']}}),fbSaveShoppingPrefs:async()=>{throw Error('offline');}});await c.renderShopping();
 await c.saveShoppingWardrobe({elements:{namedItem:k=>({value:k==='wardrobe-chinos'?'1':k==='wardrobe-colors-chinos'?'Black':''})}});assert.match(get('shopping-style').innerHTML,/value="Navy"/);assert.match(get('shopping-status').textContent,/Could not save/);
 c.fbSaveShoppingPrefs=()=>new Promise(r=>finish=r);const pending=c.saveShoppingTrips({querySelectorAll:()=>[]});c.resetShopping();finish();await pending;assert.equal(get('shopping-style').innerHTML,'');
});
test('unrecognised wardrobe colours prompt correction without silently discarding input',async()=>{
 let writes=0;const {c,get}=env({fbSaveShoppingPrefs:async()=>writes++});await c.renderShopping();
 await c.saveShoppingWardrobe({elements:{namedItem:k=>({value:k==='wardrobe-colors-chinos'?'Navy, not-a-colour':''})}});
 assert.equal(writes,0);assert.match(get('shopping-status').textContent,/Colour not recognised: not-a-colour/);
});
