import {test} from 'node:test';
import assert from 'node:assert/strict';
import './calls-score-core.js';
const S = globalThis.CallsScoreCore;

// The real records on 28 Nov 2026.
const taker = {picks: 116, resolved: 88, pending: 28, beat: 33, meanExcessReturn: -2.78, medianExcessReturn: -3.36, effectiveSample: 20, since: '2026-10-05'};
const forecasts = {resolved: 104, panelBrier: 0.25815865384615383, neutralBrier: 0.25, since: '2026-10-08'};
const journal = {journalConfig: {horizonBars: 20}, informationCoefficient: {meanIC: 0.001, nDates: 686},
  byStatus: {confirmed: {n: 1535, avgExcessReturn: 1.33}, forming: {n: 9525, avgExcessReturn: 0.35}, invalidated: {n: 3942, avgExcessReturn: -0.06}}};
const miro = {stats: {nResolved: 7, brierOurs: 0.1769, brierMarket: 0.1303, skill: -0.0466}};

test('Radar, as on 28 Nov: picks behind, forecasts a coin flip, score no ranking, status some', () => {
  const card = S.radarCard({takerRecord: taker, forecastJournal: {stats: forecasts}}, journal);
  assert.equal(card.title, 'Can you trust these calls?');
  assert.deepEqual(card.rows.map((r) => r.label + ': ' + r.verdict + ' [' + r.tone + ']'), [
    'Taker picks: Behind their benchmarks [bad]',
    'Forecasts: No better than a coin flip [flat]',
    'Score: Higher scores have not done better [flat]',
    'Status: Confirmed has done better than Invalidated [good]'
  ]);
  assert.equal(card.rows[0].detail, '33 of 88 scored picks beat their benchmark over ten sessions; the average pick trailed by 2.8 points (since 5 Oct, about 20 independent windows).');
  assert.equal(card.rows[1].detail, '104 scored since 8 Oct: 0.258 against 0.250 for always saying 50/50 (lower is better).');
  assert.match(card.rows[2].detail, /686 days: rank correlation 0\.00 .* flatters this/);
  assert.equal(card.rows[3].detail, 'Back-tested, 20 sessions: Confirmed +1.3 against Invalidated −0.1 points versus their benchmarks.');
  assert.match(card.bottom, /lagged their benchmarks: treat them as names to read about/);
});

test('verdicts need a sample, and a small edge is called level', () => {
  assert.equal(S.takerRow({picks: 9, resolved: 6, beat: 5, meanExcessReturn: 3}).verdict, 'Too few scored yet');
  assert.equal(S.takerRow({...taker, beat: 60, meanExcessReturn: 1.2}).tone, 'good');
  assert.equal(S.takerRow({...taker, beat: 44, meanExcessReturn: 0.2}).verdict, 'About level with their benchmarks');
  assert.equal(S.forecastRow({...forecasts, resolved: 12}).tone, 'wait');
  assert.equal(S.forecastRow({...forecasts, panelBrier: 0.231}).verdict, 'Better than a coin flip');
  assert.equal(S.forecastRow({...forecasts, panelBrier: 0.27}).verdict, 'Worse than a coin flip');
  assert.equal(S.rankingRow({informationCoefficient: {meanIC: 0.05, nDates: 30}}), null, 'too few days: no row');
  assert.equal(S.rankingRow({informationCoefficient: {meanIC: -0.05, nDates: 200}}).tone, 'bad');
  assert.equal(S.statusRow({byStatus: {confirmed: {n: 50, avgExcessReturn: 3}, invalidated: {n: 500, avgExcessReturn: 0}}}), null);
  assert.equal(S.radarCard(null, null), null);
  const good = S.radarCard({takerRecord: {...taker, beat: 60, meanExcessReturn: 1.2}}, null);
  assert.match(good.bottom, /Some sign of an edge/);
  const none = S.radarCard({forecastJournal: {stats: forecasts}}, journal);
  assert.match(none.bottom, /No proven edge yet/, 'no Taker record yet: the general line');
});

test('Markets, as on 28 Nov: too few settled, but the direction is shown', () => {
  const card = S.marketsCard(miro);
  assert.equal(card.rows[0].verdict, 'Too few settled yet');
  assert.equal(card.rows[0].detail, '7 questions have settled; a verdict needs 30. So far the market price has been closer: 0.130 for the price against 0.177 for our read (lower is better).');
  assert.match(card.bottom, /the market price is the better guess/);
  assert.equal(S.marketsCard({stats: {nResolved: 3, brierOurs: 0.1, brierMarket: 0.2}}).rows[0].detail, '3 questions have settled; a verdict needs 30.', 'under five: no direction');
  assert.equal(S.marketsCard({stats: {nResolved: 40, brierOurs: 0.15, brierMarket: 0.17}}).rows[0].verdict, 'Has beaten the market price');
  assert.equal(S.marketsCard({stats: {nResolved: 40, brierOurs: 0.171, brierMarket: 0.17}}).rows[0].verdict, 'About level with the market price');
  assert.equal(S.marketsCard(null), null);
});

// 28 Nov 2026: the picks against every name on the list, on the same runs.
test('picks vs the whole list: the replay\'s figures read worse, and the bottom line says so', () => {
  const list = {picks: 474, resolved: 393, beat: 210, meanExcessReturn: -0.3, medianExcessReturn: 0.52, effectiveSample: 56, since: '2026-10-05'};
  const row = S.listRow(taker, list);
  assert.equal(row.label, 'Picks vs list'); assert.equal(row.tone, 'bad'); assert.equal(row.verdict, 'Picks have done worse than the whole list');
  assert.equal(row.detail, 'On the same runs, 38% of picks beat their benchmark against 53% of every listed name; average −2.8 against −0.3 points over ten sessions.');
  const card = S.radarCard({takerRecord: taker, listRecord: list, forecastJournal: {stats: forecasts}}, journal);
  assert.deepEqual(card.rows.map((r) => r.key), ['taker', 'list', 'forecasts', 'ranking', 'status'], 'right after the picks');
  assert.match(card.bottom, /lagged both their benchmarks and the rest of the list/);
  assert.equal(S.listRow(taker, {...list, resolved: 30}).verdict, 'Too few scored yet');
  assert.equal(S.listRow({...taker, beat: 50, meanExcessReturn: 0.1}, list).verdict, 'Picks about level with the whole list', 'a higher share but a lower average is level');
  assert.equal(S.listRow({...taker, beat: 60, meanExcessReturn: 1.5}, list).tone, 'good');
  assert.equal(S.listRow(taker, null), null, 'no list record yet: no row');
  const listOnly = S.radarCard({takerRecord: {...taker, beat: 44, meanExcessReturn: -1.0}, listRecord: {...list, meanExcessReturn: 0.4}}, null);
  assert.match(listOnly.bottom, /picking the top names has done worse than the list as a whole/);
});
