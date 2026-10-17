const {test}=require('node:test');
const assert=require('node:assert/strict');
const {prompt}=require('./scout');
const fs=require('node:fs');
const vm=require('node:vm');
const Core=require('./scout-core');
test('Scout search uses the work profile, bounded preferences and explicit interest feedback',()=>{
  const out=prompt(null,{interests:'Photography',geography:'Metro Manila'},{a:{more:true,item:{topic:'Museums'}},b:{saved:true,item:{topic:'Not requested'}}},'2026-10-18');
  assert.match(out,/Photography/);assert.match(out,/Museums/);assert.doesNotMatch(out,/Not requested/);
  assert.match(out,/2026-10-18/);assert.match(out,/Communities may have blank dates/);assert.match(out,/Do not invent dates/);
});
test('Scout saves only search-returned sources and keeps the existing feed when all results fail validation',async()=>{
  const index=fs.readFileSync(__dirname+'/index.js','utf8');
  const code=index.slice(index.indexOf('async function makeScout('),index.indexOf('async function guardedScout('));
  let writes=[],raw={items:[{title:'Seminar',lane:'work',start:'2026-10-25',url:'https://official.example/event'}]};
  const db={collection:()=>({doc:id=>({get:async()=>({exists:false}),set:async value=>writes.push({id,value})})})};
  const ctx={ScoutCore:Core,Scout:{prompt},BRIEFINGS_COLL:'briefings-bob',loadProfile:async()=>null,phtDateKey:()=> '2026-10-18',DEFAULT_MODEL:'fixture',
    OPENAI_API_KEY:{value:()=> 'test'},AbortSignal,Date,WeeklyReviewCore:{weekStart:()=> '2026-10-12'},HttpsError:class extends Error{constructor(code,msg){super(msg);this.code=code;}},
    recordUsage:async()=>{},recordSearches:async()=>{},extractUsage:()=>({}),webSearchCount:()=>1,
    searchUrls:()=>['https://official.example/event'],extractText:()=>JSON.stringify(raw),parseBriefing:JSON.parse,
    fetch:async()=>({ok:true,json:async()=>({})})};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  const result=await ctx.makeScout(db,'owner');assert.equal(result.items.length,1);assert.equal(writes[0].id,'scout-latest-owner');
  raw.items[0].url='https://invented.example';writes=[];
  await assert.rejects(()=>ctx.makeScout(db,'owner'),/No opportunities passed/);assert.equal(writes.length,0);
});
