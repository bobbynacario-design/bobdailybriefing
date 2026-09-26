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
  assert.match(prompt, /high is earned, not allotted: most days have one or two, and a day with none is a real answer\. Never mark a story high to reach three\./);
  assert.match(prompt, /high means Bob would act on it or raise it this week/);
  assert.match(prompt, /it does not make it high/, 'a section does not confer high');
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
  // Three highs in the example (global, insurance, interruptions) became the
  // daily split. One high shows the shape without setting a count.
  assert.equal((schema.match(/"relevance_level": "high"/g) || []).length, 1);
});

// ── breaking the template ──

test('relevance lines start with the substance, not a stock opener', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE});
  assert.match(prompt, /never open with "This matters to Bob", "For Bob", "Bob should", "This matters because" or "This is relevant"/);
  assert.match(prompt, /No two relevance lines in the briefing may open with the same three words\./);
  assert.match(prompt, /Do not write "\.\.\. are exposed through \.\.\."/);
  assert.match(prompt, /WHO is exposed and THROUGH WHAT/, 'the loss mechanism is still required, just not in one frame');
  assert.doesNotMatch(prompt, /The relevance field must explain why it matters to Bob/, 'the line that invited "This matters to Bob because"');
});

test('an index or currency close is not a story on its own', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE});
  assert.match(prompt, /A daily index or currency close \(PSEi, ASX 200, S&P 500, the peso\) is not a story/);
  assert.match(prompt, /a peso record belongs in peso\.driver/);
  assert.match(prompt, /Lead with the cause, not the close\./);
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

// ── source links ──

test('every section asks for the article url, taken only from a search result', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE});
  ['global', 'ph', 'insurance', 'interruptions', 'ai', 'markets', 'ev'].forEach((section) => {
    const line = prompt.split('\n').find((row) => row.includes('"' + section + '": [{'));
    assert.match(line, /"url": ""/, section + ' has no url field');
  });
  assert.match(prompt, /Every story carries url: the address of the article page/);
  assert.match(prompt, /never use a homepage|Do not use a homepage/);
  assert.match(prompt, /If the story did not come from a search result, leave url empty/);
});

test('grounding no longer tells the open sections to leave url empty', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE, evidence});
  assert.doesNotMatch(prompt, /Leave url empty in every other section/);
  assert.match(prompt, /Every other section follows the url rule above/);
  assert.match(prompt, /Build the insurance section ONLY from that list/);
});

// ── reader feedback ──

test('reader feedback adds its rules and block, and stays out when absent', () => {
  const feedback = {block: 'READER FEEDBACK — Bob\'s reactions to recent briefing stories (last 30 days):\nMore like this:\n- [insurance] Insurer lifts BI reserves'};
  const withIt = buildBriefingPrompt({dateLabel: DATE, feedback, evidence});
  assert.match(withIt, /READER FEEDBACK:\n- A READER FEEDBACK block near the end of this prompt/);
  assert.match(withIt, /never mention the feedback itself/);
  assert.match(withIt, /It never overrides grounding, the item budget or the relevance definitions/);
  assert.ok(withIt.indexOf('- [insurance] Insurer lifts BI reserves') < withIt.indexOf('FETCHED AUSTRALIAN INSURANCE STORIES'), 'the evidence list stays last');
  const without = buildBriefingPrompt({dateLabel: DATE, evidence});
  assert.doesNotMatch(without, /READER FEEDBACK/);
});

// The copy button builds the feedback block in the browser from the same
// function the server uses (the functions suite checks its exact output).
test('the reader-feedback summariser is on the browser global too', () => {
  const {buildReaderFeedback} = context.BriefingPromptCore;
  assert.equal(typeof buildReaderFeedback, 'function');
  assert.equal(buildReaderFeedback(null, '2026-09-25'), null);
  assert.equal(buildReaderFeedback({}, 'not a day'), null);
  const feedback = buildReaderFeedback({'2026-09-25': {feedback: [{headline: 'Port strike halts Botany', section: 'interruptions', vote: 1}]}}, '2026-09-25');
  assert.equal(feedback.stats.up, 1);
  assert.match(buildBriefingPrompt({dateLabel: DATE, feedback}), /- \[interruptions\] Port strike halts Botany/);
});

// ── the aha ──

test('every prompt asks for one aha, with the rules that keep it honest', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE});
  assert.match(prompt, /"aha": \{"kind": "connection", "title": "", "insight": "", "chain": \["", ""\], "links": \[""\], "wrong_if": ""\}/);
  assert.match(prompt, /AHA — the one non-obvious read of the day:/);
  assert.match(prompt, /would NOT get from skimming today's headlines\. It is not a story and does not count toward the item budget/);
  assert.match(prompt, /kind is exactly one of: connection .*, second-order .*, contrarian /);
  assert.match(prompt, /links: the exact headlines, copied from the sections above/);
  assert.match(prompt, /wrong_if: ONE checkable signal/);
  // The two tightenings from the first real aha.
  assert.match(prompt, /the step BEYOND what the linked stories say/);
  assert.match(prompt, /Test: would the author of either linked story already say this\? If yes, go one step further, or return null/);
  assert.match(prompt, /Prefer the nearest one \(days or weeks, not months\) that bears directly on the linked stories/);
  assert.match(prompt, /never a report that may not break the figure out/);
  assert.match(prompt, /it must not be a first-order consequence/);
  assert.match(prompt, /Prefer the read that would be early rather than safe/);
  assert.match(prompt, /If nothing today clears that bar, set aha to null/);
  assert.match(prompt, /never recommend buying, selling, holding, exiting, sizing or hedging anything/);
});

test('the aha rules sit with the rules, before every content block', () => {
  const prompt = buildBriefingPrompt({dateLabel: DATE, evidence, context: context_, facts});
  assert.ok(prompt.indexOf('AHA — the one non-obvious read') < prompt.indexOf('GROUNDING —'));
  assert.ok(prompt.trimEnd().endsWith('https://example.com/a'), 'the evidence list is still last');
});

test('cleanAha keeps known fields, bounds them, and keeps only links to stories in the briefing', () => {
  const {cleanAha} = context.BriefingPromptCore;
  const sections = {
    interruptions: [{headline: 'Visayas grid on yellow alert anew'}],
    insurance: [{headline: 'Tower renews reinsurance program'}],
    markets: [{headline: 'US Treasury yields hit multi-decade highs despite oil pullback'}],
  };
  const aha = cleanAha({
    kind: 'connection', title: '  Grid alerts are a  reinsurance story ', insight: 'Two stories, one exposure.',
    chain: ['Visayas reserves are thin.', 'Cold-chain spoilage claims follow outages.', 'Retentions went up at renewal.', 'So insurers keep more of it.', 'A fifth step is dropped.'],
    links: ['visayas grid on yellow alert anew', 'Tower renews reinsurance program.', 'A headline the briefing never had', 'US Treasury yields hit multi-decade highs', 'Visayas grid on yellow alert anew'],
    wrong_if: 'NGCP reserve margin above 300 MW through Friday (NGCP daily outlook).', extra: '<script>',
  }, sections);
  assert.equal(aha.title, 'Grid alerts are a reinsurance story');
  assert.equal(aha.chain.length, 4);
  assert.deepEqual([...aha.links], ['Visayas grid on yellow alert anew', 'Tower renews reinsurance program', 'US Treasury yields hit multi-decade highs despite oil pullback'],
    'case and punctuation are forgiven, a long prefix matches, an unknown headline and a duplicate are dropped');
  assert.equal(aha.extra, undefined);
  assert.equal(cleanAha(Object.assign({}, aha, {kind: 'hunch'}), sections).kind, '');
  assert.deepEqual([...cleanAha({title: 'T', insight: 'I', links: ['US Treasury']}, sections).links], [], 'a short fragment is not a match');
  assert.equal(cleanAha({title: 'Only a title'}, sections), null);
  assert.equal(cleanAha(null, sections), null);
  assert.equal(cleanAha(['not', 'an', 'object'], sections), null);
});

// ── recent briefings: no reruns ──

const archiveRows = [
  {dateKey: '2026-09-26', briefing: {date: 'Saturday, September 26, 2026', watch: 'Today’s own watch', sections: {global: [{headline: 'Today, not old news'}]}}},
  {dateKey: '2026-09-25', briefing: {date: 'Friday, September 25, 2026', watch: 'NGCP Visayas grid alerts through the weekend', sections: {markets: [{headline: 'US Treasury yields hit multi-decade highs'}], interruptions: [{headline: 'Visayas grid on yellow alert anew'}], global: [{headline: 'Oil eases'}]}}},
  {dateKey: '2026-09-24', briefing: {date: 'Thursday, September 24, 2026', watch: 'RBA decision on Tuesday', sections: {insurance: [{headline: 'Tower renews reinsurance program'}]}}},
  {dateKey: '2026-09-23', briefing: {date: 'Wednesday, September 23, 2026', sections: {ph: [{headline: 'BSP holds rates'}]}}},
  {dateKey: '2026-09-22', briefing: {date: 'Tuesday', sections: {ph: [{headline: 'Too old to show'}]}}},
];

test('recent briefings: the three days before today, sections in order, with their watch lines', () => {
  const {buildRecentBriefings} = context.BriefingPromptCore;
  const recent = buildRecentBriefings(archiveRows, '2026-09-26');
  assert.deepEqual([...recent.days.map((day) => day.dateKey)], ['2026-09-25', '2026-09-24', '2026-09-23'], 'today skipped, newest first, three shown');
  assert.deepEqual([...recent.days[0].items.map((item) => item.section)], ['global', 'interruptions', 'markets'], 'in section order');
  assert.equal(recent.days[0].watch, 'NGCP Visayas grid alerts through the weekend');
  assert.deepEqual({...recent.stats}, {briefings: 3, headlines: 5});
  const many = [{dateKey: '2026-09-25', briefing: {sections: {global: Array.from({length: 20}, (_, i) => ({headline: 'Story ' + i}))}}}];
  assert.equal(buildRecentBriefings(many, '2026-09-26').days[0].items.length, 14, 'capped at fourteen headlines a day');
  assert.equal(buildRecentBriefings([], '2026-09-26'), null);
  assert.equal(buildRecentBriefings([archiveRows[0]], '2026-09-26'), null, 'only today: nothing recent');
  assert.equal(buildRecentBriefings(archiveRows, 'not a day'), null);
});

test('the no-rerun rules and the recent block appear only with recent briefings, and the evidence stays last', () => {
  const {buildRecentBriefings} = context.BriefingPromptCore;
  const recent = buildRecentBriefings(archiveRows, '2026-09-26');
  const prompt = buildBriefingPrompt({dateLabel: DATE, evidence, context: Object.assign({}, context_, {recent}), facts});
  assert.match(prompt, /RECENT BRIEFINGS — no reruns:/);
  assert.match(prompt, /the headline must start with "Update: " and the body must open with what changed\. Never retell the earlier story\./);
  assert.match(prompt, /A shorter briefing beats a rerun\./);
  assert.match(prompt, /watch must not repeat either of the last two watch lines unless that event is decided or due today/);
  assert.match(prompt, /RECENT BRIEFINGS — already given to Bob, newest first:\nFriday, September 25, 2026:\n- \[global\] Oil eases\n- \[interruptions\] Visayas grid on yellow alert anew/);
  assert.match(prompt, /  Watch: NGCP Visayas grid alerts through the weekend/);
  assert.ok(prompt.indexOf('RECENT BRIEFINGS — no reruns') < prompt.indexOf('RECENT BRIEFINGS — already given'), 'rules before content');
  assert.ok(prompt.trimEnd().endsWith('https://example.com/a'), 'the evidence list is still last');
  assert.doesNotMatch(buildBriefingPrompt({dateLabel: DATE, context: context_}), /RECENT BRIEFINGS/);
});

test('countReruns tells declared updates from silent repeats', () => {
  const {buildRecentBriefings, countReruns} = context.BriefingPromptCore;
  const recent = buildRecentBriefings(archiveRows, '2026-09-26');
  const briefing = {sections: {
    interruptions: [{headline: 'Update: Visayas grid alert lifted as reserves recover'}, {headline: 'Visayas grid on yellow alert again'}],
    insurance: [{headline: 'Tower renews its reinsurance program'}, {headline: 'APRA targets regulatory burden'}],
    markets: [{headline: 'Peso strengthens on remittances'}],
  }};
  assert.deepEqual({...countReruns(briefing, recent)}, {updates: 1, reruns: 2});
  assert.deepEqual({...countReruns(briefing, null)}, {updates: 1, reruns: 0});
});

// ── the wildcard: one story from outside the beats ──

test('the wildcard lens turns with the weekday: seven distinct lenses', () => {
  const {wildcardLens, WILDCARD_LENSES} = context.BriefingPromptCore;
  const days = ['Sunday, September 27, 2026', 'Monday, September 28, 2026', 'Tuesday, September 29, 2026', 'Wednesday, September 30, 2026',
    'Thursday, October 1, 2026', 'Friday, October 2, 2026', 'Saturday, October 3, 2026'];
  assert.deepEqual(days.map((day) => wildcardLens(day).id), ['slow-change', 'number', 'history', 'against', 'far-field', 'solved', 'elsewhere']);
  assert.equal(new Set(WILDCARD_LENSES.map((lens) => lens.id)).size, 7);
  assert.equal(wildcardLens('Thursday, 10 September 2026').id, 'far-field', 'day-first labels too');
  assert.equal(wildcardLens('2026-10-01').id, 'far-field', 'a bare date is parsed');
});

test('the prompt asks for one wildcard through the day\'s lens, outside every section', () => {
  const prompt = buildBriefingPrompt({dateLabel: 'Monday, September 28, 2026'});
  assert.match(prompt, /"wrong_if": ""\},\n  "wildcard": \{"lens": "number", "headline": "", "body": "", "source": "", "url": "", "bridge": ""\}\n\}/, 'the schema stays one valid object');
  assert.match(prompt, /Today's lens is "A number that matters": one striking, recently published figure from any field/);
  assert.match(prompt, /not insurance, business interruption, markets, the Philippine or Australian economy, AI or EVs\. It does not count toward the item budget\./);
  assert.match(prompt, /The url is copied exactly from a web search result for this briefing; without one, set wildcard to null\./);
  assert.match(prompt, /Never force it: a light bridge beats a strained one\./);
  assert.match(buildBriefingPrompt({dateLabel: DATE}), /"lens": "far-field"/, 'DATE is a Thursday');
});

test('cleanWildcard keeps the known fields, a web link and the lens, or returns null', () => {
  const {cleanWildcard} = context.BriefingPromptCore;
  const kept = cleanWildcard({lens: 'history', headline: ' A canal reopens ', body: 'Reported.', source: 'BBC', url: 'https://bbc.co.uk/x', bridge: 'Worth asking whether…', grounded: true, extra: '<x>'}, DATE);
  assert.deepEqual({...kept}, {lens: 'history', headline: 'A canal reopens', body: 'Reported.', source: 'BBC', url: 'https://bbc.co.uk/x', bridge: 'Worth asking whether…', grounded: true});
  assert.equal(cleanWildcard({lens: 'made-up', headline: 'H', body: 'B', bridge: 'Br'}, DATE).lens, 'far-field', 'an unknown lens falls back to the day\'s');
  assert.equal(cleanWildcard({headline: 'H', body: 'B', bridge: 'Br', url: 'javascript:alert(1)'}).url, '');
  assert.equal(cleanWildcard({headline: 'H', body: 'B', bridge: 'Br', grounded: 'yes'}).grounded, false);
  assert.equal(cleanWildcard({headline: 'H', body: 'B'}), null, 'no bridge, no card');
  assert.equal(cleanWildcard(null), null);
  assert.equal(cleanWildcard(['x']), null);
});

test('recent wildcards are listed so they are not repeated', () => {
  const {buildRecentBriefings} = context.BriefingPromptCore;
  const rows = [{dateKey: '2026-09-25', briefing: {date: 'Friday, September 25, 2026', sections: {}, wildcard: {headline: 'A Roman aqueduct still carries water'}}}];
  const recent = buildRecentBriefings(rows, '2026-09-26');
  assert.equal(recent.days[0].wildcard, 'A Roman aqueduct still carries water', 'a day with only a wildcard still counts');
  const prompt = buildBriefingPrompt({dateLabel: DATE, context: Object.assign({}, context_, {recent})});
  assert.match(prompt, /\n  Wildcard: A Roman aqueduct still carries water/);
  assert.match(prompt, /- wildcard must not be a story, or a subject, listed as a Wildcard in the block\./);
  assert.doesNotMatch(buildBriefingPrompt({dateLabel: DATE}), /listed as a Wildcard/, 'only with a recent block');
});
