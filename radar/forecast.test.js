import test from 'node:test';
import assert from 'node:assert/strict';
import {runForecastPanel,selectForecastInputs,validatedRows,cleanProse} from './forecast.js';
import {measureForecastJournal,stageForecastJournal,effectiveSample,compactForecast,pairedBars,historicalBaseRate,completedThrough,RECENT_PROSE,JOURNAL_DOC} from './forecast-journal.js';
import {CONFIG} from './config.js';
const now='2026-10-09T01:00:00Z';
const series=(n,mult=1)=>Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10),close:100+i*mult}));
const bars={AAA:series(130,2),SPY:series(130),BTC:series(130)};
const signal=()=>({symbol:'AAA',benchmark:'SPY',score:80,status:'confirmed',why:'Relative strength leads',catalyst:'New earnings release',catalystAsOf:'2026-10-08',catalystUrl:'https://issuer.example/release',catalystSource:'Release'});
test('forecast prose preserves full sentences beyond the old fixed character limits',()=>{
  const text='Supported facts remain conditional. '+ 'A longer explanation remains useful and complete. '.repeat(9);
  const inputs=selectForecastInputs([signal()],bars,null,now);
  const saved=response(true,{case:text,risk:text,outlook:text,wouldChange:text}).content[0].input;
  const row=validatedRows(saved,inputs,true).get('AAA');
  assert.equal(row.case,text.trim());assert.equal(row.risk,text.trim());
  assert.equal(row.outlook,text.trim());assert.equal(row.wouldChange,text.trim());
  assert.equal(cleanProse('First complete sentence. Another sentence exceeds the limit.',35),'First complete sentence. …');
});
function clientFor(responses) {
  const requests=[];
  return {requests,messages:{stream:args=>{requests.push(args);return {finalMessage:async()=>{const r=responses.shift();if(r instanceof Error) throw r;return r;}};}}};
}
function response(review=false,overrides={}) {
  const row={symbol:'AAA',status:'estimated',probability:.6,case:'Supported conditional case',risk:'Macro uncertainty',sourceUrls:['https://issuer.example/release'],
    ...(review?{outlook:'Leans outperform; not calibrated.',wouldChange:'A guidance cut would weaken the view.'}:{}),...overrides};
  return {stop_reason:'tool_use',usage:{input_tokens:100,output_tokens:20},content:[{type:'tool_use',name:'save_forecasts',input:{forecasts:[row]}}]};
}
test('selection caps five and rejects invalidated, self-benchmark, thin or stale history',()=>{
  const signals=Array.from({length:7},(_,i)=>({...signal(),symbol:'A'+i,score:80+i}));
  const many={...bars};for(const s of signals) many[s.symbol]=bars.AAA;
  const inputs=selectForecastInputs(signals,many,null,now);
  assert.deepEqual(inputs.map(i=>i.symbol),['A6','A5','A4','A3','A2']);
  assert.equal(selectForecastInputs([{...signal(),status:'invalidated'},{...signal(),symbol:'BTC',benchmark:'BTC'}],bars,null,now).length,0);
  assert.equal(selectForecastInputs([signal()],{AAA:series(30),SPY:series(30)},null,now).length,0);
});
test('stale news is excluded and only completed paired bars enter the baseline',()=>{
  const s={...signal(),catalystAsOf:'2026-08-01',read:{why:'Old story',sources:[{url:'https://old.example'}]}};
  const input=selectForecastInputs([s],{...bars,AAA:[...bars.AAA,{date:'2026-10-09',close:1}],SPY:[...bars.SPY,{date:'2026-10-09',close:1}]},null,now)[0];
  assert.equal(input.dataAsOf,'2026-10-08');assert.equal(input.evidence.length,0);
  assert.equal(input.baseRate.probability,1);assert.equal(input.baseRate.n,12);
});
test('three bounded calls use Haiku drafts and Sonnet review without searches or scoring mutations',async()=>{
  const s=signal(),before={...s},client=clientFor([response(false,{probability:.7}),response(false,{probability:.4}),response(true)]);
  const {run,entries}=await runForecastPanel({signals:[s],bars,now,client});
  assert.equal(run.status,'ok');assert.equal(run.estimated,1);
  assert.deepEqual(client.requests.map(r=>r.model),['claude-haiku-5-5','claude-haiku-5-5','claude-sonnet-5-5']);
  assert.ok(client.requests.every(r=>r.max_tokens===16000 && r.tools.length===1 && r.tools[0].name==='save_forecasts'));
  assert.match(client.requests[2].messages[0].content,/Bull arguments/);
  const {forecast,...without}=s;assert.deepEqual(without,before);
  assert.equal(entries[0].probability,.6);assert.equal(entries[0].bullProbability,.7);assert.equal(entries[0].bearProbability,.4);
  assert.equal(run.usage.reduce((sum,u)=>sum+u.input,0),300);
});
test('invented sources, invalid probabilities and abstentions cannot become estimates',()=>{
  const inputs=selectForecastInputs([signal()],bars,null,now);
  for(const overrides of [{sourceUrls:['https://invented.example']},{probability:1.1},{status:'insufficient'},{outlook:''}]) {
    const saved=response(true,overrides).content[0].input;
    assert.equal(validatedRows(saved,inputs,true).size,0);
  }
});
test('a repeated data date reuses the frozen forecast without paid calls',async()=>{
  const client=clientFor([response(),response(),response(true)]);
  const initial=await runForecastPanel({signals:[signal()],bars,now,client});
  const entry=initial.entries[0],prior={entries:{[entry.key]:entry}};
  const repeated=await runForecastPanel({signals:[signal()],bars,now,prior,client:clientFor([])});
  assert.equal(repeated.run.reason,'already-forecast');assert.equal(repeated.run.usage.length,0);
  assert.deepEqual(repeated.entries[0],entry);
});
test('failure and truncation preserve billed usage and do not expose an incomplete forecast',async()=>{
  for(const last of [new Error('Network error'),{...response(true),stop_reason:'max_tokens'}]) {
    const client=clientFor([response(),response(),last]);
    const s=signal(),result=await runForecastPanel({signals:[s],bars,now,client});
    assert.equal(result.run.status,'failed');assert.equal(result.entries.length,0);
    assert.ok(result.run.usage.length>=2);assert.equal(s.forecast.status,'unavailable');assert.equal(s.score,80);
  }
});
test('no evidence estimates, missing key, pause and no eligible signals are nonfatal',async()=>{
  const abstain=clientFor([response(false,{status:'insufficient'}),response(false,{status:'insufficient'})]);
  const result=await runForecastPanel({signals:[signal()],bars,now,client:abstain});
  assert.equal(result.run.reason,'insufficient-evidence');assert.equal(abstain.requests.length,2);
  assert.equal((await runForecastPanel({signals:[signal()],bars,now})).run.status,'failed');
  assert.equal((await runForecastPanel({signals:[signal()],bars,now,paused:true})).run.reason,'paused');
  assert.equal((await runForecastPanel({signals:[],bars,now})).run.reason,'no-eligible-signals');
});
test('forward journal never resolves from known or current partial closes; forecast is immutable',()=>{
  const entry={key:'AAA|2026-10-08',symbol:'AAA',benchmark:'SPY',generatedAt:now,status:'pending',probability:.6,bullProbability:.7,bearProbability:.4,baseRate:.5};
  const future={AAA:series(150,2),SPY:series(150)};
  const pending=measureForecastJournal(null,[entry],future,'2026-10-20T01:00:00Z').journal;
  assert.equal(pending.entries[entry.key].status,'pending','current date cannot complete the tenth session');
  const resolved=measureForecastJournal(pending,[{...entry,probability:.9}],future,'2026-10-21T01:00:00Z').journal;
  const r=resolved.entries[entry.key];assert.equal(r.status,'resolved');assert.equal(r.probability,.6);
  assert.deepEqual({start:r.result.start,end:r.result.end},{start:'2026-10-10',end:'2026-10-20'});
  assert.equal(r.outcome,1);assert.ok(Math.abs(resolved.stats.panelBrier-.16)<1e-10);
  assert.equal(resolved.stats.baseRateBrier,.25);assert.equal(resolved.stats.pending,0);
  assert.equal(entry.status,'pending','measurement does not mutate inputs');
  assert.equal(pending.entries[entry.key].status,'pending','stored prior entries are not edited in place');
});
test('missing data expires as unavailable and is excluded from accuracy statistics',()=>{
  const entry={key:'AAA|x',symbol:'AAA',benchmark:'SPY',generatedAt:'2026-07-01T00:00:00Z',status:'pending'};
  const result=measureForecastJournal(null,[entry],{},now).journal;
  assert.equal(result.stats.unavailable,1);assert.equal(result.stats.resolved,0);assert.equal(result.stats.panelBrier,null);
});
test('historical base rate needs ten non-overlapping windows and pairing requires both prices',()=>{
  assert.deepEqual(historicalBaseRate(pairedBars({AAA:series(30,2),SPY:series(29)},'AAA','SPY')),{probability:.5,n:2});
});
test('the morning refresh includes a completed US close while excluding partial crypto days',()=>{
  assert.equal(completedThrough('2026-10-08T22:00:00Z','QQQ'),'2026-10-08');
  assert.equal(completedThrough('2026-10-08T19:00:00Z','QQQ'),'2026-10-07');
  assert.equal(completedThrough('2026-10-08T22:00:00Z','BTC'),'2026-10-07');
});
const day=d=>new Date(Date.UTC(2026,5,1+d)).toISOString().slice(0,10);
const made=(symbol,d,p=.6)=>({key:symbol+'|'+day(d),symbol,benchmark:'SPY',dataAsOf:day(d),generatedAt:day(d)+'T22:00:00Z',status:'pending',
  probability:p,bullProbability:.7,bearProbability:.4,baseRate:.5,baseRateN:20,proseVersion:2,bullCase:'Bull',bearCase:'Bear',risk:'Risk',outlook:'Outlook',wouldChange:'Change',sources:[]});
// Firestore stand-in: reads must precede writes, and writes land only if the transaction body succeeds.
function memoryStore() {
  const docs=new Map(),collection={doc:id=>({id})};
  async function run(body) {
    const writes=[];let wrote=false;
    const read=ref=>{if(wrote) throw new Error('read after write');const d=docs.get(ref.id);return {exists:!!d,data:()=>structuredClone(d)};};
    const result=await body({get:async ref=>read(ref),getAll:async(...refs)=>refs.map(read),set:(ref,data)=>{wrote=true;writes.push([ref.id,structuredClone(data)]);}});
    for(const [id,data] of writes) docs.set(id,data);
    return result;
  }
  return {docs,collection,run};
}
test('completed forecasts outlive the prose window and statistics cover the full history',async()=>{
  const store=memoryStore(),themes={AAA:'AI semis',BBB:'Energy/geo'};
  const long={AAA:series(200,2),BBB:series(200,.5),SPY:series(200)};
  const batch=(from,to)=>Array.from({length:to-from},(_,i)=>[made('AAA',from+i),made('BBB',from+i)]).flat();
  await store.run(tx=>stageForecastJournal(tx,store.collection,batch(0,50),long,'2026-09-01T01:00:00Z',themes));
  const june=store.docs.get('radar-forecast-history-2026-06');
  // Second run: 60 more, a fresh pending forecast, and a late rewrite of an archived key.
  const journal=await store.run(tx=>stageForecastJournal(tx,store.collection,[...batch(50,80),made('AAA',118),made('AAA',0,.99)],long,'2026-10-01T01:00:00Z',themes));
  assert.deepEqual(journal.historyMonths,['2026-06','2026-07','2026-08']);
  assert.deepEqual(store.docs.get(JOURNAL_DOC),journal);
  const records=journal.historyMonths.flatMap(m=>Object.values(store.docs.get('radar-forecast-history-'+m).records));
  assert.equal(records.length,160,'all 160 completed forecasts are kept, beyond the old 120 limit');
  assert.equal(Object.keys(journal.entries).length,RECENT_PROSE+1,'prose kept for the newest completed and the pending forecast');
  assert.equal(journal.entries['AAA|'+day(118)].status,'pending');
  assert.equal(journal.stats.resolved,160);assert.equal(journal.stats.pending,1);assert.equal(journal.stats.since,'2026-06-01');
  assert.ok(Math.abs(journal.stats.panelBrier-.26)<1e-10,'AAA wins at .6 (.16) and BBB losses at .6 (.36) across all records');
  assert.equal(journal.stats.baseRateBrier,.25);
  // Daily forecasts overlap: a window starts every day, so each symbol has 8 non-overlapping windows in 80 days.
  assert.equal(journal.stats.effectiveSample,16);
  assert.deepEqual(journal.stats.byTheme,[{theme:'AI semis',resolved:80,effectiveSample:8},{theme:'Energy/geo',resolved:80,effectiveSample:8}]);
  const first=records.find(r=>r.key==='AAA|'+day(0));
  assert.equal(first.probability,.6,'an archived forecast is never rewritten');assert.equal(first.theme,'AI semis');
  assert.deepEqual(store.docs.get('radar-forecast-history-2026-06'),june,'untouched months are not rewritten');
  assert.ok(records.every(r=>!('bullCase' in r) && !('sources' in r) && r.result && Number.isFinite(r.result.excessReturn)));
});
test('effective sample counts non-overlapping windows per symbol, summed across symbols and by theme',()=>{
  const w=(symbol,start,end,theme='AI semis',status='resolved')=>({symbol,theme,status,result:{start,end}});
  const sample=effectiveSample([
    w('AMD','2026-01-02','2026-01-16'),
    w('AMD','2026-01-05','2026-01-20'), // overlaps the first window
    w('AMD','2026-01-16','2026-01-30'), // starts at the first window's end close: no shared daily return
    w('AMD','2026-01-20','2026-02-03'), // overlaps the third window
    w('SMH','2026-01-05','2026-01-20'), // a different symbol counts on its own
    w('ETH','2026-01-02','2026-01-16','Crypto'),
    w('ETH','2026-01-20','2026-02-03','Crypto','unavailable')]);
  assert.equal(sample.total,4);
  assert.deepEqual(sample.byTheme,[{theme:'AI semis',resolved:5,effectiveSample:3},{theme:'Crypto',resolved:1,effectiveSample:1}]);
  assert.equal(effectiveSample(Array.from({length:10},(_,i)=>w('AAA',day(i+1),day(i+11)))).total,1,'ten daily forecasts are one independent window');
  assert.deepEqual(effectiveSample([]),{total:0,byTheme:[]});
});
test('a listed history month that cannot be read fails instead of shrinking the record',async()=>{
  assert.throws(()=>measureForecastJournal({entries:{},historyMonths:['2026-06']},[],{},now),/not read/);
  const store=memoryStore();store.docs.set(JOURNAL_DOC,{entries:{},historyMonths:['2026-06']});
  await assert.rejects(store.run(tx=>stageForecastJournal(tx,store.collection,[made('AAA',100)],bars,now,{})),/missing/);
  assert.deepEqual(store.docs.get(JOURNAL_DOC),{entries:{},historyMonths:['2026-06']},'nothing is committed');
});
test('a month of compact history for every Radar symbol on every day stays far below 1 MB',()=>{
  const records={};
  for(const asset of CONFIG.watchlist) for(let d=0;d<31;d++) {
    const e={...made(asset.symbol,d,.5823),status:'resolved',outcome:1,result:{start:day(d+1),end:day(d+11),excessReturn:-1.234567890123}};
    records[e.key]=compactForecast(e,{[asset.symbol]:asset.theme});
  }
  assert.ok(JSON.stringify({version:1,month:'2026-06',records}).length<512*1024);
});
