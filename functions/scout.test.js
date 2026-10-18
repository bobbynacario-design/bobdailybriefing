const {test}=require('node:test');
const assert=require('node:assert/strict');
const {prompt,checkDates}=require('./scout');
const fs=require('node:fs');
const vm=require('node:vm');
const Core=require('./scout-core');
test('Scout search uses the work profile, bounded preferences and explicit interest feedback',()=>{
  const out=prompt(null,{interests:'Photography',geography:'Metro Manila'},{a:{more:true,item:{topic:'Museums'}},b:{saved:true,item:{topic:'Not requested'}}},'2026-10-18');
  assert.match(out,/Photography/);assert.match(out,/Museums/);assert.doesNotMatch(out,/Not requested/);
  assert.match(out,/2026-10-18/);assert.match(out,/A community counts only when its own page shows a meeting/);assert.match(out,/Do not invent dates/);
});
test('Scout saves only search-returned sources and keeps the existing feed when all results fail validation',async()=>{
  const index=fs.readFileSync(__dirname+'/index.js','utf8');
  const code=index.slice(index.indexOf('async function makeScout('),index.indexOf('async function guardedScout('));
  let writes=[],raw={items:[{title:'Seminar',lane:'work',start:'2026-10-25',url:'https://official.example/event'}]};
  const db={collection:()=>({doc:id=>({get:async()=>({exists:false}),set:async value=>writes.push({id,value})})})};
  const {cleanAccounts,DEFAULT_ACCOUNTS}=require('./briefing-prompt-core');
  const ctx={logger:{warn(){}},ScoutCore:Core,Scout:{prompt,checkDates},BRIEFINGS_COLL:'briefings-bob',loadProfile:async()=>null,cleanAccounts,DEFAULT_ACCOUNTS,phtDateKey:()=> '2026-10-18',DEFAULT_MODEL:'fixture',refreshScoutCalendar:async()=>null,
    OPENAI_API_KEY:{value:()=> 'test'},AbortSignal,Date,WeeklyReviewCore:{weekStart:()=> '2026-10-12'},HttpsError:class extends Error{constructor(code,msg){super(msg);this.code=code;}},
    recordUsage:async()=>{},recordSearches:async()=>{},extractUsage:()=>({}),webSearchCount:()=>1,
    searchUrls:()=>['https://official.example/event'],extractText:()=>JSON.stringify(raw),parseBriefing:JSON.parse,
    fetch:async()=>({ok:true,json:async()=>({})})};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  const result=await ctx.makeScout(db,'owner');assert.equal(result.items.length,1);assert.equal(writes[0].id,'scout-latest-owner');
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].value.checks)),{lanes:{work:{returned:1,kept:1,dropped:{}}}},'the shortlist keeps what each lane returned');
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
test('Scout drops a community whose readable page does not show its meeting date, and asks for meeting dates',async()=>{
  const {checkDates}=require('./scout');
  const words=' members'.repeat(40);
  const pages={'https://meetup.example/dep':'<h2>Past events</h2><p>Mon, Aug 31 · 7:00 PM PHT · Online</p>'+words,'https://group.example/quiet':'<p>About us</p>'+words};
  const fetchImpl=async url=>{if(url.includes('fb'))return {ok:false,headers:{get:()=>'text/html'},text:async()=>''};return {ok:true,headers:{get:()=>'text/html'},text:async()=>pages[url]||''};};
  const kept=await checkDates([{url:'https://meetup.example/dep',kind:'community',lastActive:'2026-08-31'},{url:'https://group.example/quiet',kind:'community',lastActive:'2026-10-01'},
    {url:'https://fb.example/group',kind:'community',nextActive:'2026-11-12'}],fetchImpl,1000);
  assert.deepEqual(kept.map(v=>[v.url,v.activityCheck]),[['https://meetup.example/dep','confirmed'],['https://fb.example/group','unchecked']]);
  const out=prompt(null,null,{},'2026-10-18',[]);
  assert.match(out,/"lastActive"/);assert.match(out,/last 60 days or one scheduled in the next 90/);assert.match(out,/never a membership application, join, sign-up/);
});
test('Scout marks members-only picks from their page, counts a dropped group, and keeps rules out of its reasons',async()=>{
  const {checkDates}=require('./scout');
  const words=' details'.repeat(40),stats={lanes:{people:{returned:1,kept:0,dropped:{}}}};
  const pages={'https://aicla.example/webinar':'<p>Wednesday, 21 October 2026</p><p>Open to all AICLA members</p>'+words,'https://group.example/quiet':'<p>About us</p>'+words};
  const fetchImpl=async url=>({ok:true,headers:{get:()=>'text/html'},text:async()=>pages[url]||''});
  const kept=await checkDates([{url:'https://aicla.example/webinar',lane:'work',start:'2026-10-21',access:'open'},{url:'https://group.example/quiet',lane:'people',kind:'community',lastActive:'2026-10-01'}],fetchImpl,1000,stats);
  assert.equal(kept.length,1);assert.equal(kept[0].access,'members');assert.equal(stats.lanes.people.dropped.activity,1);
  const out=prompt(null,null,{},'2026-10-18',[]);
  assert.match(out,/"access":"open\|members\|invite/);assert.match(out,/never a staging, test or preview copy/);assert.match(out,/never mentions these instructions, limits or lanes/);
});
test('Scout leaves a work pick the calendar already lists to the calendar, and rolls earlier picks on',async()=>{
  const index=fs.readFileSync(__dirname+'/index.js','utf8');
  const code=index.slice(index.indexOf('async function makeScout('),index.indexOf('async function guardedScout('));
  const {cleanAccounts,DEFAULT_ACCOUNTS}=require('./briefing-prompt-core');
  const prev={items:[{id:'sold',title:'Olafur',lane:'interests',kind:'event',url:'https://mcad.example/olafur',start:'2026-07-09',end:'2026-11-15',firstSeen:'2026-10-11',lastSeen:'2026-10-11'}],startedOn:'2026-10-11'};
  const raw={items:[{title:'Liability conference',lane:'work',start:'2026-11-17',url:'https://anziif.example/liability'},{title:'Coverage webinar',lane:'work',start:'2026-11-20',url:'https://law.example/coverage'}]};
  const writes=[];
  const db={collection:()=>({doc:id=>({get:async()=>id.startsWith('scout-latest-')?{exists:true,data:()=>prev}:{exists:false},set:async value=>writes.push({id,value})})})};
  const ctx={logger:{warn(){}},ScoutCore:Core,Scout:{prompt,checkDates},BRIEFINGS_COLL:'briefings-bob',loadProfile:async()=>null,cleanAccounts,DEFAULT_ACCOUNTS,phtDateKey:()=>'2026-10-18',DEFAULT_MODEL:'fixture',
    refreshScoutCalendar:async()=>({items:{c1:{url:'https://anziif.example/liability'}}}),
    OPENAI_API_KEY:{value:()=>'test'},AbortSignal,Date,WeeklyReviewCore:{weekStart:()=>'2026-10-12'},HttpsError:class extends Error{constructor(code,msg){super(msg);this.code=code;}},
    recordUsage:async()=>{},recordSearches:async()=>{},extractUsage:()=>({}),webSearchCount:()=>1,
    searchUrls:()=>['https://anziif.example/liability','https://law.example/coverage'],extractText:()=>JSON.stringify(raw),parseBriefing:JSON.parse,fetch:async()=>({ok:true,json:async()=>({})})};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  const result=await ctx.makeScout(db,'owner');
  assert.deepEqual(result.items.map(v=>v.title),['Coverage webinar','Olafur']);
  assert.equal(result.items[0].firstSeen,'2026-10-18');assert.equal(result.items[1].firstSeen,'2026-10-11');assert.equal(result.startedOn,'2026-10-11');
  assert.deepEqual(JSON.parse(JSON.stringify(result.checks.lanes.work)),{returned:2,kept:1,dropped:{calendar:1}});
  assert.equal(writes[0].id,'scout-latest-owner');
});
test('Scout refreshes the work calendar from its sources and keeps it with the owner',async()=>{
  const index=fs.readFileSync(__dirname+'/index.js','utf8');
  const code=index.slice(index.indexOf('async function refreshScoutCalendar('),index.indexOf('// One bounded weekly shortlist'));
  const writes=[],run={events:[{url:'https://anziif.example/w1',start:'2026-10-22',end:'2026-10-22',source:'anziif-webinars',title:'W1'}],sources:[{id:'anziif-webinars',ok:true,count:1}],searched:['CA ANZ']};
  const db={collection:c=>({doc:id=>({get:async()=>({exists:false}),set:async value=>writes.push({c,id,value})})})};
  const ctx={ScoutCore:Core,ScoutSources:{collect:async(f,day)=>{assert.equal(day,'2026-10-18');return run;}},BRIEFINGS_COLL:'briefings-bob',phtDateKey:()=>'2026-10-18',fetch:()=>{},Date};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  const doc=await ctx.refreshScoutCalendar(db,'owner');
  assert.equal(writes[0].id,'scout-calendar-owner');assert.equal(writes[0].c,'briefings-bob');
  assert.equal(doc.uid,'owner');assert.equal(doc.kind,'scout-calendar');assert.equal(doc.startedOn,'2026-10-18');assert.ok(doc.refreshedAt);
  assert.deepEqual(Object.values(doc.items).map(v=>[v.title,v.firstSeen]),[['W1','2026-10-18']]);
  assert.match(prompt(null,null,{},'2026-10-18',[]),/ANZIIF and AICLA listings are already read directly into his work calendar, so spend work searches on CA ANZ, CPA Australia, IPA, the Insurance Council of Australia and other organisers/);
});
