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
