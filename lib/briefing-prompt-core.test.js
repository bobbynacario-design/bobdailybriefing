import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Load the shared core the way the BROWSER does — as a plain script into a bare
// global — so the UMD tail and the absence of any Node dependency are both
// covered. The server's require() path is exercised by the functions suite.
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('./briefing-prompt-core.js', import.meta.url), 'utf8'), context);
const {buildBriefingPrompt, defaultDateLabel} = context.BriefingPromptCore;

const DATE = 'Thursday, September 11, 2026';

const evidence = {block: 'FETCHED AUSTRALIAN INSURANCE STORIES:\n1. A | B | https://example.com/a'};
const context_ = {
  standing: {block: 'STANDING CONTEXT — open state.\n\nOPEN CALLS (his decision journal):\n- PLTR / long'},
  watch: {text: 'Whether the port reopens.', source: 'AFR', dateLabel: 'Wednesday, September 10, 2026'}
};
const facts = {
  values: {psei: '6,450.23 (as of 2026-09-10, Yahoo PSEI.PS)'},
  lines: ['- PSEi: 6,450.23, +0.81% Up (as of 2026-09-10, Yahoo PSEI.PS)'],
  missing: [],
  available: 1
};

// ── the bare prompt ──

test('exposes itself on the global for the browser', () => {
  assert.equal(typeof context.BriefingPromptCore.buildBriefingPrompt, 'function');
});

test('uses the supplied date label throughout', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE});
  assert.ok(prompt.includes("Generate today's briefing (" + DATE + ')'));
  assert.ok(prompt.includes('"date": "' + DATE + '"'));
});

test('falls back to a Manila date label when none is given', () => {
  const prompt = buildBriefingPrompt({});
  assert.ok(prompt.includes(defaultDateLabel()));
  assert.equal(buildBriefingPrompt(), buildBriefingPrompt({}));
});

test('carries the whole schema and the budget rules with no options at all', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE});
  ['global', 'ph', 'insurance', 'interruptions', 'ai', 'markets', 'ev'].forEach((section) => {
    assert.ok(prompt.includes('"' + section + '":'), 'missing section ' + section);
  });
  assert.match(prompt, /at most 14 stories/);
  assert.match(prompt, /watch_followup must be null/);
  assert.match(prompt, /"watch_followup"/);
});

// Each optional block must leave no trace when absent, so the degraded path
// stays the prompt that was already known to work.
test('omits every optional block when nothing is supplied', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE});
  assert.doesNotMatch(prompt, /GROUNDING/);
  assert.doesNotMatch(prompt, /STANDING CONTEXT/);
  assert.doesNotMatch(prompt, /WATCH FOLLOW-UP/);
  // The watch_followup rule names "a PREVIOUS WATCH block" even when there is
  // none — that is the rule doing its job — so match the block header itself.
  assert.doesNotMatch(prompt, /PREVIOUS WATCH —/);
  assert.doesNotMatch(prompt, /VERIFIED FIGURES/);
  assert.doesNotMatch(prompt, /MARKET AND WEATHER FACTS/);
});

// ── relevance discipline ──

test('only high and med are askable, and high is capped', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE});
  assert.match(prompt, /relevance_level must be either high or med/);
  assert.match(prompt, /At most 3 stories in the whole briefing may be high/);
  // Sub-med items are discarded downstream, so asking for them buys nothing.
  assert.doesNotMatch(prompt, /- low means/);
  assert.doesNotMatch(prompt, /- none means/);
});

test('no schema example still shows a level that is no longer allowed', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE});
  const schema = prompt.slice(prompt.indexOf('"sections": {'), prompt.indexOf('"watch":'));
  assert.doesNotMatch(schema, /"relevance_level": "(low|none)"/);
  assert.match(schema, /"relevance_level": "high"/);
  assert.match(schema, /"relevance_level": "med"/);
});

// ── structured insight ──

test('insurance and interruptions carry watch_metric and horizon', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE});
  const schema = prompt.slice(prompt.indexOf('"sections": {'), prompt.indexOf('"watch":'));
  ['insurance', 'interruptions'].forEach((section) => {
    const line = schema.split('\n').find((row) => row.includes('"' + section + '":'));
    assert.match(line, /"watch_metric": ""/, section + ' needs watch_metric');
    assert.match(line, /"horizon":/, section + ' needs horizon');
  });
  // The other sections do not carry them.
  ['global', 'ai', 'ev'].forEach((section) => {
    const line = schema.split('\n').find((row) => row.includes('"' + section + '":'));
    assert.doesNotMatch(line, /watch_metric/, section + ' must not carry watch_metric');
  });
});

test('the four OR-ed alternatives are gone, replaced by named requirements', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE});
  assert.doesNotMatch(prompt, /likely claim\/BI angle, data to monitor, affected industries, or consulting opportunity/);
  assert.match(prompt, /WHO is exposed and THROUGH WHAT/);
  assert.match(prompt, /watch_metric must name ONE checkable thing/);
  assert.match(prompt, /horizon must be exactly one of: days, weeks, months/);
});

// The escape hatch a model reaches for when it has nothing: close it, and point
// it at the budget rather than at padding.
test('hedging vocabulary is banned by name', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE});
  assert.match(prompt, /Do not hedge/);
  ['could impact', 'may be relevant', 'bears watching', 'remains to be seen'].forEach((phrase) => {
    assert.ok(prompt.includes(phrase), 'hedge ban should name: ' + phrase);
  });
  assert.match(prompt, /"Monitor developments" and "watch for updates" are not watch_metrics/);
});

// ── optional blocks ──

test('grounding rules appear only with usable evidence', () => {
  assert.match(buildBriefingPrompt({dateLabel: DATE, evidence}), /GROUNDING/);
  assert.doesNotMatch(buildBriefingPrompt({dateLabel: DATE, evidence: {unavailable: 'stale'}}), /GROUNDING/);
  assert.doesNotMatch(buildBriefingPrompt({dateLabel: DATE, evidence: {}}), /GROUNDING/);
});

test('standing rules state the no-advice and no-forced-link prohibitions', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE, context: context_});
  assert.match(prompt, /Never recommend buying, selling, holding, exiting, sizing or hedging/);
  assert.match(prompt, /Do not manufacture a connection/);
  assert.match(prompt, /stated invalidation line of an open call/);
});

test('watch rules and the previous-watch block travel together', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE, context: context_});
  assert.match(prompt, /WATCH FOLLOW-UP:/);
  assert.match(prompt, /PREVIOUS WATCH — what Bob was told to watch on Wednesday, September 10, 2026:/);
  assert.match(prompt, /\(source given: AFR\)/);
  const noWatch = buildBriefingPrompt({dateLabel: DATE, context: {standing: context_.standing}});
  assert.doesNotMatch(noWatch, /WATCH FOLLOW-UP/);
  assert.match(noWatch, /STANDING CONTEXT/);
});

test('facts rules forbid the model producing figures of its own', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE, facts});
  assert.match(prompt, /MARKET AND WEATHER FACTS/);
  assert.match(prompt, /Do not produce a market, FX or weather figure of your own/);
  assert.match(prompt, /VERIFIED FIGURES:/);
  assert.match(prompt, /- PSEi: 6,450\.23/);
});

// A blank is honest; a guess is not — and the model must be told which fields
// are blank rather than left to fill them.
test('facts rules name the unavailable figures and require a blank', () => {
  const partial = Object.assign({}, facts, {missing: ['ASX 200', 'S&P 500']});
  const prompt = buildBriefingPrompt({dateLabel: DATE, facts: partial});
  assert.match(prompt, /No verified figure was available for: ASX 200, S&P 500/);
  assert.match(prompt, /a blank is honest and a guess is not/);
});

test('facts with no lines contribute nothing', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE, facts: {values: {}, lines: [], missing: [], available: 0}});
  assert.doesNotMatch(prompt, /VERIFIED FIGURES/);
  assert.doesNotMatch(prompt, /MARKET AND WEATHER FACTS/);
});

// ── ordering ──

// The grounding rules address the evidence as the list "at the end of this
// prompt", so it has to actually be last however many blocks are added.
test('the evidence block stays last with every option supplied', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE, evidence, context: context_, facts});
  assert.ok(prompt.trimEnd().endsWith('https://example.com/a'));
  const order = ['GROUNDING —', 'STANDING CONTEXT — this is what makes', 'WATCH FOLLOW-UP:',
    'MARKET AND WEATHER FACTS', 'OPEN CALLS', 'PREVIOUS WATCH —', 'VERIFIED FIGURES:',
    'FETCHED AUSTRALIAN INSURANCE STORIES:'];
  const positions = order.map((needle) => prompt.indexOf(needle));
  positions.forEach((at, i) => assert.ok(at > 0, 'missing marker: ' + order[i]));
  positions.slice(1).forEach((at, i) => assert.ok(at > positions[i],
    order[i + 1] + ' must follow ' + order[i]));
});

test('rules come before every content block', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE, evidence, context: context_, facts});
  assert.ok(prompt.indexOf('MARKET AND WEATHER FACTS') < prompt.indexOf('OPEN CALLS'));
});
