import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildShadowJournal, shadowTargets} from './shadow-journal.js';
import {readSummary} from './scenario.js';
import {CONFIG} from './config.js';

const hc = CONFIG.haircut;
const market = (slug, shadow, extra) => Object.assign({slug, label: slug, impliedYes: 0.625, mid: 0.625, anchor: 0.625,
  panelRead: {model: 'claude-haiku-5-5', readAt: '2026-10-14T00:00:00Z', reads: [0.12, 0.08, 0.12, 0.12, 0.08], shadow}}, extra || {});

test('readSummary gives the raw mean, the split and the card haircut; too few reads give nothing', () => {
  const s = readSummary([0.1, 0.1, 0.1], 0.6, hc);
  assert.deepEqual(s, {n: 3, raw: 0.1, sd: 0, cut: 0.3});
  assert.equal(readSummary([0.1, 0.2], 0.6, hc), null);
  assert.equal(readSummary([0.1, 0.2, 0.3], null, hc), null);
});

test('every model is locked at the same read and price, once, and only when there is something to compare', () => {
  const j1 = buildShadowJournal(null, [market('duterte', {'claude-sonnet-5-5': [0.2, 0.2, 0.2, 0.2, 0.2], 'claude-fable-5-1': [0.18, 0.25, 0.28, 0.22, 0.13]}),
    market('noshadow', undefined)], [], '2026-10-14', 'claude-haiku-5-5', hc, readSummary);
  const rec = j1.open.duterte;
  assert.equal(rec.price, 0.625); assert.equal(rec.live, 'claude-haiku-5-5');
  assert.deepEqual(Object.keys(rec.models).sort(), ['claude-fable-5-1', 'claude-haiku-5-5', 'claude-sonnet-5-5']);
  assert.equal(rec.models['claude-sonnet-5-5'].raw, 0.2); assert.equal(rec.models['claude-haiku-5-5'].raw, 0.104);
  assert.equal(j1.open.noshadow, undefined);
  const later = buildShadowJournal(j1, [market('duterte', {'claude-sonnet-5-5': [0.9, 0.9, 0.9]}, {anchor: 0.9})], [], '2026-10-21', 'claude-haiku-5-5', hc, readSummary);
  assert.equal(later.open.duterte.models['claude-sonnet-5-5'].raw, 0.2, 'a later read never moves the lock');
});

test('resolution scores each model raw and after the haircut beside the price on the same markets', () => {
  const j1 = buildShadowJournal(null, [market('duterte', {'claude-sonnet-5-5': [0.2, 0.2, 0.2]})], [], '2026-10-14', 'claude-haiku-5-5', hc, readSummary);
  const j2 = buildShadowJournal(j1, [], [{slug: 'duterte', outcome: 1, resolvedDate: '2026-12-20'}], '2026-12-20', 'claude-haiku-5-5', hc, readSummary);
  assert.equal(j2.stats.nResolved, 1); assert.equal(j2.stats.nOpen, 0); assert.equal(j2.stats.newlyResolved, 1);
  const sonnet = j2.stats.models.find(m => m.model === 'claude-sonnet-5-5');
  assert.equal(sonnet.brierRaw, 0.64); assert.equal(sonnet.brierPrice, 0.1406);
  assert.ok(sonnet.brierCut < sonnet.brierRaw);
  const again = buildShadowJournal(j2, [], [{slug: 'duterte', outcome: 1}], '2026-12-21', 'claude-haiku-5-5', hc, readSummary);
  assert.equal(again.stats.nResolved, 1, 'a resolution is counted once');
});

// 17 Oct 2026: a market joins the contest once, so only markets not yet in it
// are shadow-read, and none after the contest closes to new markets.
test('shadow models read only markets not yet in the contest, and none after it closes', () => {
  const markets = [{slug: 'locked-open'}, {slug: 'locked-resolved'}, {slug: 'new-market'}, null, {}];
  const journal = {open: {'locked-open': {}}, resolved: [{slug: 'locked-resolved'}]};
  assert.deepEqual(shadowTargets(markets, journal, '2026-10-17', '2026-12-31').map((m) => m.slug), ['new-market']);
  assert.deepEqual(shadowTargets(markets, journal, '2026-12-31', '2026-12-31').map((m) => m.slug), ['new-market'], 'the last day still counts');
  assert.deepEqual(shadowTargets(markets, journal, '2027-01-01', '2026-12-31'), [], 'closed to new markets');
  assert.deepEqual(shadowTargets(markets, null, '2027-01-01', '').map((m) => m.slug), ['locked-open', 'locked-resolved', 'new-market'], 'no contest yet and no end date: every market');
  assert.equal(CONFIG.panel.shadowUntil, '2026-12-31');
});
