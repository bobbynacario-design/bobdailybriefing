// Offline tests for lib/story-tagger.js. No I/O, no network, no model.
//   node lib/story-tagger.test.js
//
// The load-bearing property is that a tagging pass can never make the PSE tab
// WORSE than the heuristic it replaces. Most of these pin that.
import assert from 'assert';
import {
  heuristicCategory, normalizeAnswer, resolveTags, agreementStats, buildPrompt, hasCompany
} from './story-tagger.js';

var n = 0;
function t(name, fn) { fn(); n++; console.log('  PASS  ' + name); }
function st(headline, body) { return { headline: headline, body: body || '' }; }

// ── heuristic: must mirror index.html phStoryCat ──────────────────────────
t('a named PH company reads specific', function () {
  assert.equal(heuristicCategory(st('Ayala Land posts higher profit'), 'ph'), 'specific');
});

t('a PH market story with no company reads macro', function () {
  assert.equal(heuristicCategory(st('BSP holds rates as inflation cools'), 'ph'), 'macro');
});

t('a PH story with no market angle is excluded', function () {
  assert.equal(heuristicCategory(st('Two dead in Marikina highway crash'), 'ph'), 'none');
});

t('the markets section requires a PH angle as well as a market one', function () {
  // This asymmetry is the whole reason the markets section has its own rule: it
  // is a GLOBAL section, so a US-only story must not reach the PH tab.
  assert.equal(heuristicCategory(st('S&P 500 completes fastest rally since 1990'), 'markets'), 'none');
  assert.equal(heuristicCategory(st('PSEi retreats as peso weakens'), 'markets'), 'macro');
  // ...whereas the ph section is already PH news, so market-relevance is enough.
  assert.equal(heuristicCategory(st('Inflation eases to 3 percent'), 'ph'), 'macro');
});

t('company detection is substring-based, matching the front end', function () {
  assert.ok(hasCompany('shares of jollibee rose'));
  assert.ok(!hasCompany('a story about nothing in particular'));
});

// ── model answer validation ──────────────────────────────────────────────
t('valid categories normalise, including case and padding', function () {
  assert.deepEqual(normalizeAnswer({ category: ' MACRO ', subject: 'BSP' }), { category: 'macro', subject: 'BSP' });
});

t('"none" from the model is REJECTED', function () {
  // The model only ever sees stories the heuristic already included, so a "none"
  // is out of scope. Accepting it would let the model hide a story the app shows.
  assert.equal(normalizeAnswer({ category: 'none', subject: '' }), null);
});

t('garbage answers are rejected rather than coerced', function () {
  [null, undefined, 'macro', 42, {}, { category: 'maybe' }, { category: '' }].forEach(function (bad) {
    assert.equal(normalizeAnswer(bad), null, JSON.stringify(bad) + ' must not produce a tag');
  });
});

t('an over-long subject is truncated, not dropped', function () {
  var long = normalizeAnswer({ category: 'specific', subject: 'x'.repeat(200) });
  assert.equal(long.category, 'specific');
  assert.equal(long.subject.length, 60);
});

// ── resolution + fallback ────────────────────────────────────────────────
var ITEMS = [
  { section: 'ph', story: st('Ayala Land posts higher profit') },
  { section: 'ph', story: st('BSP holds rates as inflation cools') }
];

t('valid model answers are used and marked as model-sourced', function () {
  var tags = resolveTags(ITEMS, { '1': { category: 'specific', subject: 'Ayala' },
                                  '2': { category: 'macro', subject: 'BSP' } });
  assert.deepEqual(tags.map(function (x) { return x.category; }), ['specific', 'macro']);
  assert.ok(tags.every(function (x) { return x.source === 'model'; }));
});

t('a missing answer falls back to the heuristic, per item', function () {
  var tags = resolveTags(ITEMS, { '1': { category: 'macro', subject: 'x' } });
  assert.equal(tags[0].source, 'model');
  assert.equal(tags[1].source, 'heuristic');
  assert.equal(tags[1].category, 'macro');   // what the heuristic says for a BSP story
});

t('a completely unusable response degrades every item, and does not throw', function () {
  [null, undefined, 'not an object', 42].forEach(function (bad) {
    var tags = resolveTags(ITEMS, bad);
    assert.equal(tags.length, 2);
    assert.ok(tags.every(function (x) { return x.source === 'heuristic'; }));
  });
});

t('fallback output is exactly what the app already shows today', function () {
  // The no-regression guarantee: with no model at all, tags equal the heuristic.
  var tags = resolveTags(ITEMS, {});
  tags.forEach(function (tag, i) {
    assert.equal(tag.category, heuristicCategory(ITEMS[i].story, ITEMS[i].section));
  });
});

t('agreement stats count sources and matches separately', function () {
  var tags = resolveTags(ITEMS, { '1': { category: 'macro', subject: '' } });  // disagrees on item 1
  var s = agreementStats(ITEMS, tags);
  assert.equal(s.n, 2);
  assert.equal(s.fromModel, 1);
  assert.equal(s.fromHeuristic, 1);
  assert.equal(s.agreed, 1);          // item 2 agrees, item 1 does not
  assert.equal(s.agreementPct, 50);
});

// ── prompt ───────────────────────────────────────────────────────────────
t('the prompt never offers "none" as an option', function () {
  // Inclusion is the heuristic's decision. Offering "none" would invite the model
  // to make a call it has measurably got wrong.
  var p = buildPrompt(ITEMS);
  assert.ok(!/"none"/.test(p), 'prompt must not present none as a category');
  assert.ok(/specific/.test(p) && /macro/.test(p));
  assert.ok(/1\. Ayala Land/.test(p), 'items are numbered for a compact keyed reply');
});

console.log('\n' + n + ' checks passed.');
