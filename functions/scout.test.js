const {test}=require('node:test');
const assert=require('node:assert/strict');
const {prompt,checkDates}=require('./scout');
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
  const {cleanAccounts,DEFAULT_ACCOUNTS}=require('./briefing-prompt-core');
  const ctx={ScoutCore:Core,Scout:{prompt,checkDates},BRIEFINGS_COLL:'briefings-bob',loadProfile:async()=>null,cleanAccounts,DEFAULT_ACCOUNTS,phtDateKey:()=> '2026-10-18',DEFAULT_MODEL:'fixture',
    OPENAI_API_KEY:{value:()=> 'test'},AbortSignal,Date,WeeklyReviewCore:{weekStart:()=> '2026-10-12'},HttpsError:class extends Error{constructor(code,msg){super(msg);this.code=code;}},
    recordUsage:async()=>{},recordSearches:async()=>{},extractUsage:()=>({}),webSearchCount:()=>1,
    searchUrls:()=>['https://official.example/event'],extractText:()=>JSON.stringify(raw),parseBriefing:JSON.parse,
    fetch:async()=>({ok:true,json:async()=>({})})};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  const result=await ctx.makeScout(db,'owner');assert.equal(result.items.length,1);assert.equal(writes[0].id,'scout-latest-owner');
  raw.items[0].url='https://invented.example';writes=[];
  await assert.rejects(()=>ctx.makeScout(db,'owner'),/No opportunities passed/);assert.equal(writes.length,0);
});
test('Scout work lane searches Australian bodies online, names his insurers and solicitors, and caps AI and poker',()=>{
  const {DEFAULT_ACCOUNTS}=require('./briefing-prompt-core');
  const out=prompt(null,null,{},'2026-10-18',DEFAULT_ACCOUNTS);
  assert.match(out,/ANZIIF/);assert.match(out,/AICLA/);assert.match(out,/online or hybrid events he can join from Manila/);
  assert.match(out,/QBE/);assert.match(out,/Hall & Wilcox/);assert.match(out,/Sedgwick/);assert.doesNotMatch(out,/Ausgrid/,'utilities do not run his CPD');
  assert.match(out,/At most ONE pick in the whole list may be about AI/);assert.match(out,/Nothing about poker/);
  assert.match(out,/"timezone"/);assert.match(out,/never to growing a business, sales or consulting income/);
  assert.doesNotMatch(prompt(null,null,{},'2026-10-18',[]),/organisations he works with/);
});
test('Scout reads each pick page from public https hosts only and records what it found',async()=>{
  const {checkDates,publicHost}=require('./scout');
  const words=' details'.repeat(40),calls=[];
  const pages={'https://ok.example/a':'<p>Tuesday, 17 November 2026</p><p>Register by 10 November 2026</p>'+words,'https://ok.example/b':'<p>10 November 2026</p>'+words};
  const fetchImpl=async(url,opts)=>{calls.push(url);assert.ok(opts.signal);if(url.includes('down'))throw new Error('timeout');
    if(url.includes('pdf'))return {ok:true,headers:{get:()=>'application/pdf'},text:async()=>''};
    return {ok:true,headers:{get:()=>'text/html; charset=utf-8'},text:async()=>pages[url]||''};};
  const items=[{url:'https://ok.example/a',start:'2026-11-17',deadline:'2026-11-10'},{url:'https://ok.example/b',start:'2026-10-22'},
    {url:'https://down.example/c',start:'2026-11-01'},{url:'https://ok.example/pdf',start:'2026-11-01'},{url:'https://localhost/x',start:'2026-11-01'},
    {url:'https://169.254.169.254/latest',start:'2026-11-01'},{url:'https://ok.example/group',start:''}];
  await checkDates(items,fetchImpl,1000);
  assert.deepEqual(items.map(v=>v.dateCheck),['confirmed','not-found','unchecked','unchecked','unchecked','unchecked',undefined]);
  assert.equal(items[0].deadlineCheck,'confirmed');
  assert.ok(!calls.some(u=>/localhost|169\.254|group/.test(u)),'private hosts and undated picks are never fetched');
  assert.ok(publicHost('anziif.com'));assert.ok(!publicHost('metadata.google.internal'));assert.ok(!publicHost('10.0.0.1'));assert.ok(!publicHost('[::1]'));
});
