import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildFactSheet, factEvidence, factPrompt, FACTSHEET_DEFAULT_MODEL} from './factsheet.js';

const markets = [{slug:'duterte', question:'Will the Philippine Senate convict Sara Duterte?', endDate:'2026-12-31'}, {slug:'recession', question:'US recession by end of 2026?'}];
const searched = {type:'web_search_tool_result', content:[{url:'https://www.rappler.com/trial', title:'Senate trial schedule', page_age:'2026-10-11'}, {url:'https://www.bls.gov/cpi', title:'CPI'}]};
function client(replies, seen) {
  const stream = body => ({finalMessage: async () => { seen.push(JSON.parse(JSON.stringify(body))); const r = replies.shift(); if (r instanceof Error) throw r; return r; }});
  return {beta:{messages:{stream}}};
}
const usage = {input_tokens:30000, output_tokens:1800, server_tool_use:{web_search_requests:6}};
const save = facts => ({stop_reason:'tool_use', usage, content:[searched, {type:'tool_use', name:'save_facts', input:{facts}}]});

test('keeps current, sourced, price-free facts for the requested markets only', async () => {
  const seen = [];
  const out = await buildFactSheet(markets, {now:'2026-10-12T22:15:00Z', client:client([save([
    {slug:'duterte', status:'current', summary:'The impeachment trial opened on 6 October; senators vote after closing arguments.', nextDates:'Verdict vote expected 3 November', sourceUrls:['https://www.rappler.com/trial', 'https://invented.example/x']},
    {slug:'recession', status:'current', summary:'Polymarket traders see a 7% chance.', nextDates:'', sourceUrls:['https://www.bls.gov/cpi']},
    {slug:'other', status:'current', summary:'Not asked for.', nextDates:'', sourceUrls:['https://www.bls.gov/cpi']}])], seen)});
  assert.equal(out.status, 'ok');assert.deepEqual(Object.keys(out.facts), ['duterte'], 'price talk and unrequested markets are dropped');
  assert.deepEqual(out.facts.duterte, {asOf:'2026-10-12', summary:'The impeachment trial opened on 6 October; senators vote after closing arguments.', nextDates:'Verdict vote expected 3 November',
    sources:[{url:'https://www.rappler.com/trial', title:'Senate trial schedule'}]}, 'an invented URL is never kept');
  assert.deepEqual(out.usage, {input:30000, output:1800, cacheRead:0, cacheWrite:0, searches:6, calls:1});
  assert.equal(seen[0].model, FACTSHEET_DEFAULT_MODEL);assert.equal(seen[0].fallbacks, 'default');
  assert.deepEqual(seen[0].tools[0], {type:'web_search_20260209', name:'web_search', max_uses:10, allowed_callers:['direct']});
  assert.match(seen[0].messages[0].content, /Never use or mention prediction markets/);
});

test('a paused turn continues; a failed call leaves no facts; nothing to do or no key makes no call', async () => {
  const paused = {stop_reason:'pause_turn', usage:{input_tokens:100, output_tokens:10, server_tool_use:{web_search_requests:4}}, content:[searched]};
  const out = await buildFactSheet(markets, {client:client([paused, save([{slug:'recession', status:'current', summary:'CPI rose 0.3% in September.', nextDates:'', sourceUrls:['https://www.bls.gov/cpi']}])], [])});
  assert.deepEqual(Object.keys(out.facts), ['recession']);assert.equal(out.usage.searches, 10);assert.equal(out.usage.calls, 2);
  const failed = await buildFactSheet(markets, {client:client([new Error('overloaded')], [])});
  assert.equal(failed.status, 'failed');assert.deepEqual(failed.facts, {});assert.match(failed.error, /overloaded/);
  assert.equal((await buildFactSheet([], {apiKey:'k'})).reason, 'nothing-to-refresh');
  assert.equal((await buildFactSheet(markets, {})).reason, 'no-key');
});

test('fact evidence is a dated, labelled line; the prompt asks for facts, not forecasts', () => {
  assert.deepEqual(factEvidence({asOf:'2026-10-12', summary:'Trial opened.', nextDates:'Vote 3 Nov', sources:[{url:'https://www.rappler.com/t'}]}),
    {kind:'facts', date:'2026-10-12', text:'Trial opened. Next: Vote 3 Nov', source:'rappler.com'});
  assert.equal(factEvidence(null), null);
  assert.match(factPrompt(markets, '2026-10-12'), /no forecast, no probability/);
});
