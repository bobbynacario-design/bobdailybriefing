import test from 'node:test';
import assert from 'node:assert/strict';
import {runForecastPanel,selectForecastInputs,validatedRows} from './forecast.js';
import {measureForecastJournal,pairedBars,historicalBaseRate,completedThrough} from './forecast-journal.js';
const now='2026-10-09T01:00:00Z';
const series=(n,mult=1)=>Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10),close:100+i*mult}));
const bars={AAA:series(130,2),SPY:series(130),BTC:series(130)};
const signal=()=>({symbol:'AAA',benchmark:'SPY',score:80,status:'confirmed',why:'Relative strength leads',catalyst:'New earnings release',catalystAsOf:'2026-10-08',catalystUrl:'https://issuer.example/release',catalystSource:'Release'});
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
  assert.ok(client.requests.every(r=>r.max_tokens===4000 && r.tools.length===1 && r.tools[0].name==='save_forecasts'));
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
  const pending=measureForecastJournal(null,[entry],future,'2026-10-20T01:00:00Z');
  assert.equal(pending.entries[entry.key].status,'pending','current date cannot complete the tenth session');
  const resolved=measureForecastJournal(pending,[{...entry,probability:.9}],future,'2026-10-21T01:00:00Z');
  const r=resolved.entries[entry.key];assert.equal(r.status,'resolved');assert.equal(r.probability,.6);
  assert.deepEqual({start:r.result.start,end:r.result.end},{start:'2026-10-10',end:'2026-10-20'});
  assert.equal(r.outcome,1);assert.ok(Math.abs(resolved.stats.panelBrier-.16)<1e-10);
  assert.equal(resolved.stats.baseRateBrier,.25);assert.equal(resolved.stats.pending,0);
  assert.equal(entry.status,'pending','measurement does not mutate inputs');
});
test('missing data expires as unavailable and is excluded from accuracy statistics',()=>{
  const entry={key:'AAA|x',symbol:'AAA',benchmark:'SPY',generatedAt:'2026-07-01T00:00:00Z',status:'pending'};
  const result=measureForecastJournal(null,[entry],{},now);
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
