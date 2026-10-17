import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
function env(extra={}){const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',disabled:true,focus(){}});return elements.get(id);};const c={document:{getElementById:get},UniqloImport:{fromHtml:()=>({items:[{name:'Polo <test>',price:790,originalPrice:990,validTo:'2026-10-22'}],campaigns:[]})},renderShopping:async()=>{},...extra};c.window=c;vm.createContext(c);vm.runInContext(readFileSync(new URL('./uniqlo-import-ui.js',import.meta.url),'utf8'),c);return {c,get};}
test('preview is escaped and requires an explicit save; invalid paste cannot erase an earlier import',async()=>{
 let writes=0;const {c,get}=env({fbSaveShoppingUniqlo:async()=>writes++});c.previewUniqloHtml('copied page');assert.equal(writes,0);assert.match(get('uniqlo-import-preview').innerHTML,/Polo &lt;test&gt;/);await c.saveUniqloImport();assert.equal(writes,1);
 c.UniqloImport.fromHtml=()=>{throw Error('No current offers');};c.previewUniqloHtml('bad page');await c.saveUniqloImport();assert.equal(writes,1);assert.equal(get('uniqlo-import-save').disabled,true);
});
test('failed saves preserve the preview for retry and account reset discards late save callbacks',async()=>{
 let writes=0,finish,loads=0;const {c,get}=env({renderShopping:async()=>loads++,fbSaveShoppingUniqlo:async()=>{writes++;throw Error('offline');}});c.previewUniqloHtml('html');await c.saveUniqloImport();assert.equal(get('uniqlo-import-save').disabled,false);assert.match(get('uniqlo-import-status').textContent,/unchanged/);
 c.fbSaveShoppingUniqlo=()=>new Promise(r=>finish=r);const pending=c.saveUniqloImport();c.resetUniqloImport();finish();await pending;assert.equal(loads,0);assert.equal(get('uniqlo-import-preview').innerHTML,'');
});
