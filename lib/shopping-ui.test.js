import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
function env(overrides={}){const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',checked:false});return elements.get(id);};const c={URL,Date,Intl,console,Promise,document:{getElementById:get},fbLoadShopping:async()=>({generatedAt:new Date().toISOString(),items:[],sources:[]}),fbLoadShoppingPrefs:async()=>({}),...overrides};c.window=c;vm.createContext(c);for(const f of ['shopping-core','shopping-ui'])vm.runInContext(readFileSync(new URL('./'+f+'.js',import.meta.url),'utf8'),c);return {c,get};}
test('loading is read-only, output escapes retailer text, and reset discards a late account response',async()=>{
 let writes=0,finish;const {c,get}=env({fbSaveShoppingPrefs:async()=>writes++,fbLoadShopping:async()=>({generatedAt:new Date().toISOString(),sources:[],items:[{id:'safe-id',brand:'H&M',name:'Polo <script>',category:'Tops',price:500,originalPrice:1000,url:'https://www2.hm.com/en_ph/productpage.123.html',availableSizes:['M'],checkedAt:new Date().toISOString()}]})});
 await c.renderShopping();assert.equal(writes,0);assert.match(get('shopping-results').innerHTML,/Polo &lt;script&gt;/);assert.match(get('shopping-results').innerHTML,/delivery fee/);
 c.fbLoadShopping=()=>new Promise(r=>finish=r);const pending=c.renderShopping();c.resetShopping();finish({items:[]});await pending;assert.equal(get('shopping-results').innerHTML,'');
});
test('unreadable preferences block saving and never replace existing account preferences with defaults',async()=>{
 let writes=0;const {c,get}=env({fbLoadShoppingPrefs:async()=>{throw Error('offline');},fbSaveShoppingPrefs:async()=>writes++});await c.renderShopping();await c.toggleShoppingSave('abc');assert.equal(writes,0);assert.match(get('shopping-status').textContent,/Saving is disabled/);
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
