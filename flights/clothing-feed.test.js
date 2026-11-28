import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildClothingFeed,sourceId} from './clothing-feed.js';
import {clothingRefreshDecision as decide} from './clothing-refresh-policy.js';
import {collectClothingSources} from './clothing-collector.js';
const morning='2026-11-28T00:20:00.000Z',noon='2026-11-28T04:47:00.000Z',now=Date.parse(noon);
const item=(id,sourceId,checkedAt=morning)=>({id,sourceId,brand:sourceId==='nike'?'Nike':'Adidas',retailer:sourceId==='sc-adidas'?'Sports Central':'Nike',price:500,originalPrice:1000,currency:'PHP',checkedAt,sizesCheckedAt:checkedAt,availableSizes:['8.5'],sizeSystem:'US men',url:sourceId==='nike'?'https://www.nike.com/ph/t/test':'https://sportscentral.ph/products/test'});
const a=item('a','nike'),b=item('b','sc-adidas','2026-11-27T02:00:00.000Z');
const feed={generatedAt:morning,items:[a,b],sources:[{id:'nike',status:'ok',checkedAt:morning,lastSuccessAt:morning},{id:'sc-adidas',status:'unavailable',checkedAt:morning,lastSuccessAt:b.checkedAt,attemptDay:'2026-11-28',attempts:1}],campaigns:[],promos:[]};
const history={a:[{day:'2026-11-28',price:500,at:morning}],b:[{day:'2026-11-27',price:500,at:b.checkedAt}]};
test('same-day partial failures select only failed sources, stop after the second attempt, and reset next day',()=>{
 const d=decide(feed,null,{now,expectedIds:['nike','sc-adidas']});assert.equal(d.mode,'sources');assert.deepEqual(d.sourceIds,['sc-adidas']);
 const capped={...feed,sources:feed.sources.map(s=>s.id==='sc-adidas'?{...s,attempts:2}:s)};assert.equal(decide(capped,null,{now}).needed,false);
 assert.equal(decide(capped,null,{now:now+86400000}).mode,'full');assert.equal(decide(capped,null,{now,force:true}).mode,'full');
 assert.deepEqual(decide({...feed,sources:feed.sources.slice(0,1)},null,{now,expectedIds:['nike','sc-adidas','sm-search']}).sourceIds,['sc-adidas','sm-search']);
});
test('failed retries preserve healthy items, price history, full scan time and the failed source’s last good observations',()=>{
 const before=JSON.stringify(feed),r=buildClothingFeed(feed,[{id:'sc-adidas',status:'unavailable',checkedAt:noon,items:[],message:'HTTP 403'}],history,noon,{full:false});
 assert.equal(r.feed.generatedAt,morning);assert.equal(r.feed.lastRetryAt,noon);assert.deepEqual(r.feed.items.find(i=>i.id==='a'),a);assert.deepEqual(r.feed.items.find(i=>i.id==='b'),b);assert.deepEqual(r.history,history);assert.equal(JSON.stringify(feed),before);
 const s=r.feed.sources.find(s=>s.id==='sc-adidas');assert.equal(s.lastSuccessAt,b.checkedAt);assert.equal(s.lastAttemptAt,noon);assert.equal(s.attempts,2);assert.equal(s.retainedCount,1);
});
test('a recovered source replaces only its own bounded sample and records a real observation in price history',()=>{
 const next=item('new','sc-adidas',noon),r=buildClothingFeed(feed,[{id:'sc-adidas',status:'ok',checkedAt:noon,items:[next]}],history,noon,{full:false});
 assert.ok(!r.feed.items.some(i=>i.id==='b'));assert.deepEqual(r.feed.items.find(i=>i.id==='a'),a);assert.equal(r.history.a[0].at,morning);assert.equal(r.history.new[0].at,noon);assert.equal(r.feed.sources.find(s=>s.id==='sc-adidas').lastSuccessAt,noon);
});
test('partial results retain missing old observations, but new quotes replace matching IDs without faking old history',()=>{
 const r=buildClothingFeed(feed,[{id:'sc-adidas',status:'partial',checkedAt:noon,items:[{...b,price:450,checkedAt:noon}]}],history,noon,{full:false});assert.equal(r.feed.items.filter(i=>i.id==='b').length,1);assert.equal(r.feed.items.find(i=>i.id==='b').price,450);assert.equal(r.history.b.at(-1).at,noon);
 assert.throws(()=>buildClothingFeed(feed,[{id:'nike',status:'unavailable',items:[]}],history,noon),/previous clothing feed preserved/);
});
test('legacy rows acquire source attribution without changing their price or stock timestamps',()=>{
 assert.equal(sourceId({...a,sourceId:undefined}),'nike');assert.equal(sourceId({...b,sourceId:undefined}),'sc-adidas');
 const legacy={...feed,items:feed.items.map(({sourceId,...i})=>i)},r=buildClothingFeed(legacy,[{id:'sc-adidas',status:'unavailable',items:[]}],history,noon,{full:false});assert.equal(r.feed.items.find(i=>i.id==='b').checkedAt,b.checkedAt);assert.equal(r.feed.items.find(i=>i.id==='b').sourceId,'sc-adidas');
});
test('a mall-only retry never fetches a healthy retailer, renders a browser or checks Nike sizes',async()=>{
 let mallCalls=0;const bad=()=>{throw Error('healthy source fetched');};
 const rows=await collectClothingSources(['sm-search'],noon,{browser:true,read:bad,render:bad,sizes:bad,malls:async(at,options)=>{mallCalls++;assert.deepEqual(options.sourceIds,['sm-search']);return {sources:[{id:'sm-search',status:'checked'}],promos:[]};}});assert.equal(mallCalls,1);assert.deepEqual(rows.map(s=>s.id),['sm-search']);
});
test('a retailer-only retry does not collect independent mall event sources',async()=>{
 const calls=[],rows=await collectClothingSources(['sc-adidas'],noon,{browser:true,read:async s=>{calls.push(s.id);return {...s,status:'ok',items:[item('new','sc-adidas',noon)]};},render:()=>{throw Error('unneeded browser');},malls:()=>{throw Error('unneeded mall fetch');}});assert.deepEqual(calls,['sc-adidas']);assert.equal(rows.length,1);
});

test('the first retry after upgrading a legacy feed counts its earlier same-day attempt',()=>{
 const old={...feed,sources:feed.sources.map(({attempts,attemptDay,...s})=>s)};const r=buildClothingFeed(old,[{id:'sc-adidas',status:'unavailable',checkedAt:noon,items:[]}],history,noon,{full:false});assert.equal(r.feed.sources.find(s=>s.id==='sc-adidas').attempts,2);assert.equal(decide(r.feed,null,{now}).needed,false);
});
