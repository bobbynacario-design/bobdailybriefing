import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clothingRefreshDecision as decide,assertPricedClothingFeed as assertFeed} from './clothing-refresh-policy.js';

const now=Date.parse('2026-11-28T04:47:00Z'),generatedAt='2026-11-28T00:20:00Z';
const item={price:500,originalPrice:1000,currency:'PHP',checkedAt:generatedAt};
const feed={generatedAt,items:[item]},health={status:'ok',lastRunAt:'2026-11-28T00:23:00Z'};

test('a successful morning scan makes the midday retry read-only without changing observation timestamps',()=>{
 const before=JSON.stringify({feed,health});assert.equal(decide(feed,health,{now}).needed,false);
 assert.equal(JSON.stringify({feed,health}),before);assert.equal(feed.generatedAt,generatedAt);assert.equal(health.lastRunAt,'2026-11-28T00:23:00Z');
});

test('Philippine calendar days, rather than UTC dates or a 24-hour wait, govern the next daily collection',()=>{
 const morning=Date.parse('2026-11-28T00:17:00Z'),lateYesterday={generatedAt:'2026-11-27T15:30:00Z',items:[{...item,checkedAt:'2026-11-27T15:30:00Z'}]};
 assert.equal(decide(lateYesterday,null,{now:morning}).needed,true,'a late scan yesterday must not suppress today’s morning scan');
 const samePhtDay={generatedAt:'2026-11-27T16:30:00Z',items:[{...item,checkedAt:'2026-11-27T16:30:00Z'}]};
 assert.equal(decide(samePhtDay,null,{now:morning}).needed,false,'UTC yesterday can still be the same Philippine day');
});

test('missing, malformed, future or metadata-only feeds request a real collection',()=>{
 for(const value of [null,{}, {...feed,generatedAt:'bad'},{...feed,generatedAt:new Date(now+6*60000).toISOString()},{...feed,items:[]},{...feed,items:{}},{...feed,items:[{...item,checkedAt:'2026-11-27T00:00:00Z'}]}])assert.equal(decide(value,health,{now}).needed,true);
});

test('a failed run is retried, while an older failure cannot override a later successful scan',()=>{
 assert.equal(decide(feed,{status:'failed',lastRunAt:'2026-11-28T04:00:00Z'},{now}).needed,true);
 assert.equal(decide(feed,{status:'failed'},{now}).needed,true);
 assert.equal(decide(feed,{status:'failed',lastRunAt:'2026-11-27T04:00:00Z'},{now}).needed,false);
});

test('manual refresh can force a second scan on the same day',()=>{
 assert.equal(decide(feed,health,{now,force:true}).needed,true);assert.equal(decide(null,null,{now,force:true}).needed,true);
});

test('empty, unpriced, old, future, invalid-currency and expired observations cannot replace a good feed',()=>{
 for(const items of [[],null,{},[{...item,price:0}],[{...item,originalPrice:500}],[{...item,price:NaN}],[{...item,currency:'USD'}],[{...item,checkedAt:'bad'}],[{...item,checkedAt:'2026-11-20T00:00:00Z'}],[{...item,checkedAt:'2026-11-29T00:00:00Z'}],[{...item,validTo:'2026-11-27'}],[{...item,validFrom:'2026-11-29'}]]){
   assert.throws(()=>assertFeed({items,campaigns:[{name:'Voucher lead'}]},now),/previous clothing feed preserved/);
 }
 assert.doesNotThrow(()=>assertFeed(feed,now));
 assert.equal(decide({...feed,items:[{...item,validTo:'2026-11-27'}]},health,{now}).needed,true);
});
