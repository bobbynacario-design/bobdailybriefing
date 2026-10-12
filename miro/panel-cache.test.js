import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planReads, newsEvidence} from './panel-cache.js';

const now = Date.parse('2026-10-20T00:00:00Z');
const opts = {model:'claude-haiku-5-5', provider:'anthropic', now, rereadDays:7};
const read = (daysAgo, extra = {}) => ({reads:[.1, .12, .09], readAt:new Date(now - daysAgo * 86400000).toISOString(), model:'claude-haiku-5-5', provider:'anthropic', evidence:[], ...extra});
const news = (date, driver = 'The Senate set the trial for 3 November.', extra = {}) => ({moveExplanation:{status:'reported', driver, mechanism:'This raises the chance of YES as the price rose.', eventDate:date,
  sources:[{url:'https://www.rappler.com/a', title:'Rappler'}], ...extra}});

test('new, week-old and model-changed reads are redone; a fresh read is kept', () => {
  const markets = [{slug:'a'}, {slug:'b'}, {slug:'c'}, {slug:'d'}, {slug:'e'}];
  const prev = {markets:[{slug:'b', panelRead:read(2)}, {slug:'c', panelRead:read(8)}, {slug:'d', panelRead:read(1, {model:'gpt-5.5', provider:'openai'})}, {slug:'e', panelRead:read(1, {reads:[]})}]};
  const plan = planReads(markets, prev, opts);
  assert.deepEqual(plan.read, ['a', 'c', 'd', 'e']);assert.deepEqual(plan.reasons, {a:'new', c:'weekly', d:'model', e:'new'});
  assert.deepEqual(Object.keys(plan.keep), ['b']);assert.deepEqual(plan.keep.b.reads, [.1, .12, .09]);
  assert.deepEqual(planReads(markets, null, opts).read, ['a', 'b', 'c', 'd', 'e'], 'no previous doc means every market is new');
});

test('sourced news after the last read triggers a re-read and reaches the panel without the price-derived mechanism', () => {
  const prev = {markets:[{slug:'duterte', panelRead:read(2)}]};
  const plan = planReads([{slug:'duterte', ...news('2026-10-19')}], prev, opts);
  assert.deepEqual(plan.reasons, {duterte:'news'});
  assert.deepEqual(plan.evidence.duterte, [{date:'2026-10-19', text:'The Senate set the trial for 3 November.', source:'rappler.com'}]);
  assert.doesNotMatch(JSON.stringify(plan.evidence), /price|raises the chance/);
  // News from before the read, or already in it, does not trigger again.
  assert.deepEqual(planReads([{slug:'duterte', ...news('2026-10-10')}], prev, opts).read, []);
  const seen = {markets:[{slug:'duterte', panelRead:read(1, {evidence:[{date:'2026-10-19', text:'The Senate set the trial for 3 November.', source:'rappler.com'}]})}]};
  assert.deepEqual(planReads([{slug:'duterte', ...news('2026-10-19')}], seen, opts).read, []);
});

test('unsourced, undated or unknown explanations are not news; older news is carried for a fortnight', () => {
  assert.deepEqual(newsEvidence(news('2026-10-19', 'x', {status:'unknown'})), []);
  assert.deepEqual(newsEvidence(news('2026-10-19', 'x', {sources:[]})), []);
  assert.deepEqual(newsEvidence(news('19 Oct', 'x')), []);
  const prev = {markets:[{slug:'m', panelRead:read(9, {evidence:[{date:'2026-10-12', text:'Old but recent.', source:'a.com'}, {date:'2026-09-01', text:'Too old.', source:'b.com'}]})}]};
  const plan = planReads([{slug:'m'}], prev, opts);
  assert.deepEqual(plan.reasons, {m:'weekly'});assert.deepEqual(plan.evidence.m.map(e => e.text), ['Old but recent.']);
});
