import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('production bridges save only the UID-specific UNIQLO record and combine it with later automatic scans',async()=>{
 const now=Date.parse('2026-10-17T08:00:00Z'),docs=new Map([['shopping-latest',{items:[{brand:'H&M',id:'hm'}],sources:[]}]]),writes=[];let uid='owner-one';
 class Clock extends Date{static now(){return now;}}
 const c={URL,Date:Clock,Set,db:{},COLL:'briefings-bob',getUid:()=>uid,doc:(db,coll,key)=>({key}),getDoc:async({key})=>({exists:()=>docs.has(key),data:()=>docs.get(key)}),setDoc:async({key},data)=>{writes.push(key);docs.set(key,data);}};c.window=c;vm.createContext(c);vm.runInContext(readFileSync(new URL('./uniqlo-import.js',import.meta.url),'utf8'),c);
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('window.fbLoadShopping ='),end=html.indexOf('window.fbLoadShoppingPrefs =',start);vm.runInContext(html.slice(start,end),c);
 const data=c.UniqloImport.normalize([{name:'DRY-EX Polo Shirt',url:'https://www.uniqlo.com/ph/en/products/E483972-000/00',price:790,originalPrice:990,label:'Limited Offer from 16 Oct - 22 Oct 2026'}],new Date(now).toISOString(),now);
 await c.fbSaveShoppingUniqlo(data);assert.deepEqual(writes,['shopping-uniqlo-owner-one']);assert.equal(docs.get(writes[0]).uid,'owner-one');assert.equal((await c.fbLoadShopping()).items.length,2);
 docs.set('shopping-latest',{items:[{brand:'Nike',id:'nike'}],sources:[]});const refreshed=await c.fbLoadShopping();assert.equal(refreshed.items.length,2);assert.equal(refreshed.items[1].brand,'UNIQLO');
 uid='owner-two';assert.equal((await c.fbLoadShopping()).items.length,1);uid=null;await assert.rejects(c.fbSaveShoppingUniqlo(data),/Sign in/);
});
