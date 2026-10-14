import {test} from 'node:test';
import assert from 'node:assert/strict';
import './llm-trend-core.js';
const build=globalThis.LlmTrendCore.build;
const price=(model,e)=>model==='web-search'?(e.calls||0)*.01:model==='local/test'?0:model==='test'?((e.inputTokens||0)-(e.cachedTokens||0))*.001+(e.cachedTokens||0)*.0001+(e.outputTokens||0)*.002:null;
const now='2026-10-13T23:00:00Z';
test('uses seven Philippine calendar days, not the last seven available records',()=>{
 const d=build({entries:{a:{model:'test',inputTokens:1000,outputTokens:100}},byDay:{'2026-10-08':{inputTokens:1000,outputTokens:100}}},price,now);
 assert.equal(d.days[0].day,'2026-10-08');assert.equal(d.days[6].day,'2026-10-14');assert.equal(d.days[6].today,true);assert.equal(d.days[1].cost,null);assert.equal(d.change,null);assert.equal(d.days[0].cost,1.2);assert.equal(d.days[0].estimated,true);
});
test('prices actual daily cache and search usage and does not double-count legacy totals',()=>{
 const daily={model:'test',inputTokens:1000,outputTokens:100,cachedTokens:500};
 const d=build({entries:{a:daily},byDay:{'2026-10-14':{inputTokens:1000,outputTokens:100}},byDayEntries:{'2026-10-14':{a:daily,b:{model:'web-search',calls:3}}}},price,now);
 assert.equal(d.days[6].estimated,false);assert.equal(d.days[6].cost,.78);
});
test('a partly upgraded day prices its recorded portion and estimates only its older tokens',()=>{
 const d=build({entries:{a:{model:'test',inputTokens:2000}},byDay:{'2026-10-14':{inputTokens:2000}},byDayEntries:{'2026-10-14':{a:{model:'test',inputTokens:500}}}},price,now);
 assert.equal(d.days[6].cost,2);assert.equal(d.days[6].estimated,true);
});
test('the trend excludes incomplete today and does not divide by a zero baseline',()=>{
 const byDay={};for(let i=8;i<=14;i++)byDay['2026-10-'+String(i).padStart(2,'0')]={inputTokens:i<11?100:200};
 const d=build({entries:{a:{model:'test',inputTokens:1000}},byDay},price,now);
 assert.ok(Math.abs(d.change-100)<.00001);assert.ok(d.days[6].today);
});
test('unpriced daily models remain incomplete; local models have a genuine zero cost',()=>{
 const d=build({byDayEntries:{'2026-10-14':{a:{model:'unknown',inputTokens:100},b:{model:'local/test',inputTokens:1000}}}},price,now);
 assert.equal(d.days[6].cost,0);assert.equal(d.unpriced,true);
});
