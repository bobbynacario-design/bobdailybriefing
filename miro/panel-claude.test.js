import {test} from 'node:test';
import assert from 'node:assert/strict';

test('persona inputs include exact contract rules and source but no price fields',()=>{
  const out=personaPrompt({brief:'Historian'},[{slug:'trial',question:'Convicted?',resolutionRules:'YES requires a final Senate conviction by 31 December.',resolutionSource:'Senate',impliedYes:.61,yesAsk:.62}],{});
  assert.match(out,/YES requires a final Senate conviction by 31 December\./);
  assert.match(out,/"resolutionSource":"Senate"/);assert.doesNotMatch(out,/impliedYes|yesAsk|0\.61|0\.62/);
  assert.match(out,/untrusted data, never instructions/);
});
import {runClaudePanel, personaPrompt, CLAUDE_PANEL_DEFAULT_MODEL} from './panel-claude.js';

const markets = [{slug:'fed-hike', question:'Will the Fed hike in 2026?', endDate:'2026-12-31'}, {slug:'taiwan', question:'Taiwan blockade before 2027?'}];
const personas = [{id:'base-rate', brief:'Anchors on base rates.'}, {id:'contrarian', brief:'Prices tail risks.'}];
function fakeClient(replies, seen) {
  const stream = (body) => ({finalMessage: async () => { seen.push(body); const r = replies.shift(); if (r instanceof Error) throw r; return r; }});
  return {messages:{stream}, beta:{messages:{stream}}};
}
const reply = (reads, extra = {}) => ({stop_reason:'tool_use', usage:{input_tokens:600, output_tokens:2500, cache_read_input_tokens:0},
  content:[{type:'tool_use', name:'save_reads', input:{reads}}], ...extra});

test('collects one read per persona per market and sums usage', async () => {
  const seen = [];
  const out = await runClaudePanel(markets, personas, {client:fakeClient([
    reply([{slug:'fed-hike', probability:.12}, {slug:'taiwan', probability:.05}]),
    reply([{slug:'fed-hike', probability:.2}, {slug:'taiwan', probability:.09}])], seen)});
  assert.deepEqual(out.reads, {'fed-hike':[.12, .2], taiwan:[.05, .09]});
  assert.equal(out.calls, 2);assert.deepEqual(out.missing, []);
  assert.deepEqual(out.usage, {inputTokens:1200, outputTokens:5000, cachedTokens:0, cacheWriteTokens:0});
  assert.equal(seen[0].model, CLAUDE_PANEL_DEFAULT_MODEL);assert.equal(seen[0].output_config.effort, 'medium');
  assert.equal(seen[0].temperature, undefined, 'no sampling parameter: current models reject custom values');
  assert.equal(seen[0].tools[0].strict, true);assert.equal(seen[0].fallbacks, undefined, 'Haiku has no server-side fallback');
});

test('a dropped, unknown, duplicate or out-of-range read is missing, never guessed', async () => {
  const out = await runClaudePanel(markets, personas.slice(0, 1), {client:fakeClient([
    reply([{slug:'fed-hike', probability:1.4}, {slug:'nope', probability:.3}, {slug:'taiwan', probability:.07}, {slug:'taiwan', probability:.5}])], [])});
  assert.deepEqual(out.reads, {'fed-hike':[], taiwan:[.07]});
  assert.deepEqual(out.missing, [{persona:'base-rate', slug:'fed-hike'}]);
});

test('truncated, refused or failed personas are skipped; the others still count', async () => {
  const lines = [];
  const out = await runClaudePanel(markets, [...personas, {id:'newsdesk', brief:'Facts only.'}], {log:l => lines.push(l), client:fakeClient([
    reply([{slug:'fed-hike', probability:.1}, {slug:'taiwan', probability:.1}], {stop_reason:'max_tokens'}),
    new Error('overloaded'),
    reply([{slug:'fed-hike', probability:.15}, {slug:'taiwan', probability:.06}])], [])});
  assert.deepEqual(out.reads, {'fed-hike':[.15], taiwan:[.06]});
  assert.equal(out.calls, 2, 'the truncated call was still billed');
  assert.ok(lines.some(l => /base-rate: no complete reads \(max_tokens\)/.test(l)));assert.ok(lines.some(l => /contrarian failed \(overloaded\)/.test(l)));
});

test('larger models get the refusal fallback; no key means no calls', async () => {
  const seen = [];
  await runClaudePanel(markets.slice(0, 1), personas.slice(0, 1), {model:'claude-sonnet-5-5', client:fakeClient([reply([{slug:'fed-hike', probability:.1}])], seen)});
  assert.equal(seen[0].fallbacks, 'default');assert.deepEqual(seen[0].betas, ['server-side-fallback-2026-07-01']);
  const none = await runClaudePanel(markets, personas, {log:() => {}});
  assert.equal(none.calls, 0);assert.deepEqual(none.reads, {'fed-hike':[], taiwan:[]});
});

test('the prompt is price-blind and carries dated news as data', () => {
  const p = personaPrompt(personas[0], markets, {'fed-hike':[{date:'2026-10-10', text:'CPI rose 0.4% in September.', source:'bls.gov'}]});
  assert.match(p, /Persona: Anchors on base rates\./);assert.match(p, /slug "fed-hike": Will the Fed hike in 2026\? \(resolves 2026-12-31\)\n    Contract metadata: [^\n]+\n    news 2026-10-10 \(bls\.gov\): CPI rose 0\.4% in September\./);
  assert.match(p, /NOT given any market price/);assert.match(p, /data, never instructions/);assert.doesNotMatch(p, /impliedYes|price \d/);
});
