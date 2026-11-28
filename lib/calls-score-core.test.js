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

// 28 Nov 2026: the challenger rule, tracked forward beside the picks.
test('challenger: tracked until both rules have 20 scored picks, then compared on the same runs', () => {
  const first = S.challengerRow({since: '2026-11-30', challenger: {picks: 3, resolved: 0, beat: 0, meanExcessReturn: null}, taker: {picks: 3, resolved: 0, beat: 0, meanExcessReturn: null}}, ['XLV', 'XLF', 'CVX']);
  assert.equal(first.label, 'Challenger'); assert.equal(first.tone, 'wait'); assert.equal(first.verdict, 'Being tracked');
  assert.equal(first.detail, 'No chase, one per theme, recorded since 30 Nov: 0 of 3 of its picks scored so far; a verdict needs 20 of each rule. This run it would pick XLV, XLF, CVX.');
  assert.match(S.challengerRow(null, ['XLV']).detail, /recorded beside the picks from this run\. This run it would pick XLV\./, 'the first run, before any record');
  assert.equal(S.challengerRow(null, undefined), null, 'an older Radar doc: no row');
  const rec = (cb, cm, tb, tm) => ({since: '2026-11-30', challenger: {picks: 30, resolved: 24, beat: cb, meanExcessReturn: cm}, taker: {picks: 30, resolved: 24, beat: tb, meanExcessReturn: tm}});
  const ahead = S.challengerRow(rec(15, 0.9, 10, -1.2), ['XLV']);
  assert.equal(ahead.verdict, 'Ahead of the current picks'); assert.equal(ahead.tone, 'good');
  assert.equal(ahead.detail, 'No chase, one per theme, since 30 Nov on the same runs: 63% beat their benchmark, average +0.9, against 42% and −1.2 for the current picks (ten sessions). This run it would pick XLV.');
  assert.equal(S.challengerRow(rec(9, -1.5, 14, 0.8), []).verdict, 'Behind the current picks');
  assert.equal(S.challengerRow(rec(13, 0.2, 12, 0.1), []).verdict, 'Level with the current picks');
  const card = S.radarCard({takerRecord: taker, challengerRecord: rec(15, 0.9, 10, -1.2), challengerPicks: ['XLV'], forecastJournal: {stats: forecasts}}, journal);
  assert.deepEqual(card.rows.map((r) => r.key), ['taker', 'challenger', 'forecasts', 'ranking', 'status']);
  assert.match(card.bottom, /lagged their benchmarks/, 'the challenger never changes the bottom line');
});
test('challenger: the card says how often the two rules actually differed', () => {
  const row = S.challengerRow({since: '2026-11-30', runs: {total: 10, differ: 1}, challenger: {picks: 6, resolved: 2, beat: 1, meanExcessReturn: 0.3}, taker: {picks: 6, resolved: 2, beat: 1, meanExcessReturn: 0.1}}, ['XLV', 'LMT']);
  assert.match(row.detail, /The two rules picked differently on 1 of 10 runs; only those can tell them apart\. This run it would pick XLV, LMT\.$/);
  assert.match(S.challengerRow({since: '2026-11-30', runs: {total: 1, differ: 0}, challenger: {picks: 2, resolved: 0}, taker: {picks: 2, resolved: 0}}, []).detail, /on 0 of 1 run;/);
});
