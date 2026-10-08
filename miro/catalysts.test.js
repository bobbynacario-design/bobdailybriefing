import test from 'node:test';
import assert from 'node:assert/strict';
import {selectMovers,applyExplanations,collectSources,explainMarketMoves,ledgerUsage,buildPrompt} from './catalysts.js';

const now='2026-10-09T06:00:00Z', since='2026-10-08T06:00:00Z';
const mover=()=>({slug:'rates',label:'No rate hikes',question:'Will there be no rate hikes?',impliedYes:.7,previousImpliedYes:.6,priceChange:.1});
const url='https://central-bank.example/release';
const row=()=>({slug:'rates',status:'plausible',driver:'Inflation cooled in the new release.',mechanism:'Lower inflation reduces pressure to raise rates, increasing the chance of no hikes.',wouldReverse:'An inflation rebound would weaken this interpretation.',eventDate:'2026-10-08',sourceUrls:[url]});

test('selects the largest measured moves only, caps six, and includes resolution moves',()=>{
  const markets=Array.from({length:9},(_,i)=>({...mover(),slug:'m'+i,priceChange:(i+1)/100}));
  markets.push({...mover(),slug:'new',previousImpliedYes:null},{...mover(),slug:'flat',priceChange:0});
  assert.deepEqual(selectMovers(markets).map(m=>m.slug),['m8','m7','m6','m5','m4','m3']);
  assert.equal(selectMovers([{...mover(),closed:true}]).length,1);
});
test('keeps dated evidence and causal inference separate from the measured price change',()=>{
  const m=mover(),original=JSON.stringify(m);
  const stats=applyExplanations([m],[m],{moves:[row()]},{[url]:{title:'Official release',age:'2026-10-08'}},since,now);
  assert.equal(stats.explained,1);assert.equal(m.moveExplanation.status,'plausible');
  assert.equal(m.moveExplanation.from,.6);assert.equal(m.moveExplanation.to,.7);
  assert.deepEqual(m.moveExplanation.sources,[{url,title:'Official release'}]);
  const {moveExplanation,...without}=m;assert.equal(JSON.stringify(without),original,'explanations do not alter the price or forecast fields');
});
test('rejects invented URLs, stale events, stale search results and future dates',()=>{
  for(const [r,seen] of [[row(),{}],[{...row(),eventDate:'2026-09-01'},{[url]:{title:'x',age:''}}],
    [{...row(),eventDate:'2026-10-10'},{[url]:{title:'x',age:''}}],[row(),{[url]:{title:'x',age:'2026-09-01'}}]]) {
    const m=mover();const stats=applyExplanations([m],[m],{moves:[r]},seen,since,now);
    assert.equal(stats.explained,0);assert.equal(m.moveExplanation.status,'unknown');
    assert.equal(m.moveExplanation.driver,undefined);
  }
});
test('never accepts model-written URLs as search provenance and clears old explanations',()=>{
  const seen=collectSources([{type:'tool_use',name:'save_market_moves',input:{moves:[row()]}},{type:'text',text:url}]);
  assert.deepEqual(seen,{});
  collectSources([{type:'web_search_tool_result',content:[{url,title:'Release'}]}],seen);
  assert.equal(seen[url].title,'Release');
  const m={...mover(),moveExplanation:{driver:'old'}};
  applyExplanations([m],[],null,{},since,now);assert.equal(m.moveExplanation,undefined);
});
function clientFor(messages) {
  const requests=[];
  return {requests,messages:{stream:args=>{requests.push(args);return{finalMessage:async()=>{
    const next=messages.shift();if(next instanceof Error)throw next;return next;
  }};}}};
}
test('search resumes are bounded and all completed turns reach the ledger',async()=>{
  const client=clientFor([
    {stop_reason:'pause_turn',usage:{input_tokens:10,output_tokens:2,cache_read_input_tokens:3,server_tool_use:{web_search_requests:4}},content:[{type:'web_search_tool_result',content:[{url,title:'Release'}]}]},
    {stop_reason:'tool_use',usage:{input_tokens:20,output_tokens:3,server_tool_use:{web_search_requests:2}},content:[{type:'tool_use',name:'save_market_moves',input:{moves:[row()]}}]}
  ]);
  const markets=[mover()];const result=await explainMarketMoves({markets,client,since,now});
  assert.equal(result.status,'ok');assert.equal(result.stats.explained,1);
  assert.equal(client.requests[0].tools[0].max_uses,12);assert.equal(client.requests[1].tools[0].max_uses,8);
  assert.equal(result.usage.searches,6);assert.equal(result.usage.calls,2);
  assert.deepEqual(ledgerUsage(result.usage),{inputTokens:33,outputTokens:5,cachedTokens:3,cacheWriteTokens:0});
});
test('missing keys, paused controls, no moves and failed search do not prevent price refresh',async()=>{
  const markets=[mover()];const missing=await explainMarketMoves({markets,since,now});
  assert.equal(missing.status,'failed');assert.equal(markets[0].moveExplanation.reason,'search-failed');
  const paused=await explainMarketMoves({markets,paused:true,since,now});assert.equal(paused.reason,'paused');assert.equal(paused.usage,null);
  const flat=await explainMarketMoves({markets:[{...mover(),priceChange:0}],since,now});assert.equal(flat.reason,'no-material-moves');
  const client=clientFor([{stop_reason:'pause_turn',usage:{input_tokens:7,server_tool_use:{web_search_requests:1}},content:[]},new Error('Network failed')]);
  const failed=await explainMarketMoves({markets:[mover()],client,since,now});assert.equal(failed.status,'failed');assert.equal(failed.usage.input,7);assert.equal(failed.usage.searches,1);
});
test('truncated save output is rejected rather than displayed as a sourced explanation',async()=>{
  const client=clientFor([{stop_reason:'max_tokens',usage:{input_tokens:1},content:[{type:'tool_use',name:'save_market_moves',input:{moves:[row()]}}]}]);
  const result=await explainMarketMoves({markets:[mover()],client,since,now});assert.equal(result.status,'failed');assert.equal(result.stats.explained,0);
});
test('prompt distinguishes negative YES outcomes and requests a specific reversal rather than advice',()=>{
  const prompt=buildPrompt([mover()],since,now);
  assert.match(prompt,/negative events/);assert.match(prompt,/conditional inference/);assert.match(prompt,/broad background narrative/);
});
