import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichMarketChanges, probabilityInterpretation } from './briefing.js';

test('interprets implied probabilities without assuming a positive event', function () {
  assert.equal(probabilityInterpretation(0.82), 'Market strongly expects this');
  assert.equal(probabilityInterpretation(0.61), 'Market leans this happens');
  assert.equal(probabilityInterpretation(0.50), 'Market sees an open question');
  assert.equal(probabilityInterpretation(0.31), 'Market leans this does not happen');
  assert.equal(probabilityInterpretation(0.12), 'Market sees this as a tail risk');
});

test('adds price changes and ranks material moves', function () {
  var previous = {
    generatedAt: '2026-07-21T22:15:00.000Z',
    markets: [
      { slug: 'macro', impliedYes: 0.40 },
      { slug: 'risk', impliedYes: 0.20 }
    ]
  };
  var result = enrichMarketChanges([
    { slug: 'macro', label: 'Macro', theme: 'Macro', impliedYes: 0.405, priority: 5, liquidityNum: 10000 },
    { slug: 'risk', label: 'Risk', theme: 'Risk', impliedYes: 0.17, priority: 4, liquidityNum: 10000 }
  ], previous);

  assert.equal(result.markets[0].previousImpliedYes, 0.40);
  assert.ok(Math.abs(result.markets[0].priceChange - 0.005) < 1e-12);
  assert.equal(result.changes.since, previous.generatedAt);
  assert.equal(result.changes.items[0].slug, 'risk');
  assert.equal(result.changes.items[0].direction, 'down');
});

test('does not invent changes for a newly followed market', function () {
  var result = enrichMarketChanges([
    { slug: 'new', impliedYes: 0.52, priority: 3 }
  ], { markets: [] });

  assert.equal(result.markets[0].previousImpliedYes, null);
  assert.equal(result.markets[0].priceChange, null);
  assert.deepEqual(result.changes.items, []);
});
