import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toScoringBars, equalWeightIndex, pseRadarConfig, buildPseRadar } from './pse-radar.js';
import { CONFIG } from './config.js';

function weekdays(end, n) {
  var out = [], t = Date.parse(end + 'T00:00:00Z');
  while (out.length < n) {
    var d = new Date(t), wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10));
    t -= 86400000;
  }
  return out;
}

test('PSE Edge bars become scoring bars: value stands in for volume, gaps fall back to the close', () => {
  assert.deepEqual(toScoringBars([{ date: '2026-10-12', open: null, high: 113.1, low: null, close: 112, value: 254085476 },
    { date: '2026-10-13', close: null }, { date: '2026-10-14', open: 1, high: 1, low: 1, close: 1, value: null }]),
  [{ date: '2026-10-12', open: 112, high: 113.1, low: 112, close: 112, volume: 254085476 },
    { date: '2026-10-14', open: 1, high: 1, low: 1, close: 1, volume: 0 }]);
});

test('PSE30 averages each day’s returns of the stocks that traded, from each one’s own last close', () => {
  const b = (pairs) => pairs.map(([date, close]) => ({ date, close }));
  const ew = equalWeightIndex({
    A: b([['2026-10-07', 10], ['2026-10-08', 11], ['2026-10-09', 11]]),    // +10%, 0%
    B: b([['2026-10-07', 20], ['2026-10-08', 20], ['2026-10-09', 22]]),    // 0%, +10%
    C: b([['2026-10-07', 5], ['2026-10-09', 4]]),                          // no trade on the 8th; then -20% from its own last close
    D: b([['2026-10-04', 1]])                                              // a lone date: fewer than half traded, dropped
  });
  assert.deepEqual(ew.map(x => x.date), ['2026-10-07', '2026-10-08', '2026-10-09']);
  assert.equal(ew[0].close, 100);
  assert.equal(ew[1].close, 105, '(10% + 0%) / 2');
  assert.equal(ew[2].close, Math.round(105 * (1 + (0 + 0.1 - 0.2) / 3) * 10000) / 10000);
  assert.equal(ew[2].high, ew[2].close); assert.equal(ew[2].volume, 0);
});

test('the scoring config: the 30 by PSE sector against PSE30, US weights, no US reweight check', () => {
  const cfg = pseRadarConfig(CONFIG);
  assert.equal(cfg.watchlist.length, 30);
  assert.ok(cfg.watchlist.every(w => w.benchmark === 'PSE30' && w.kind === 'single'));
  assert.deepEqual(Object.keys(cfg.themeRegime).sort(), ['Financials', 'Holding firms', 'Industrial', 'Property', 'Services']);
  assert.deepEqual(cfg.themeRegime.Financials.sort(), ['BDO', 'BPI', 'CBC', 'MBT']);
  assert.equal(Object.values(cfg.themeRegime).reduce((n, l) => n + l.length, 0), 30);
  assert.equal(cfg.weights, CONFIG.weights); assert.equal(cfg.model, undefined); assert.equal(cfg.previousWeights, undefined);
  assert.deepEqual(cfg.indexSymbols, ['PSE30', 'SPY', 'QQQ']);
});

test('buildPseRadar scores every stock against PSE30 and the journal walks back over the bars', () => {
  const dates = weekdays('2026-10-12', 200);
  const stocks = CONFIG.ph.board.stocks;
  const barsBySymbol = {};
  stocks.forEach((s, k) => {
    // a gentle trend per stock, up for half, down for half, with a wobble
    barsBySymbol[s.symbol] = dates.map((d, i) => {
      const c = 50 * (1 + (k % 2 ? 0.002 : -0.001) * i) * (1 + 0.01 * Math.sin(i / 3 + k));
      return { date: d, open: c, high: c * 1.01, low: c * 0.99, close: Math.round(c * 100) / 100, value: 1e6 + 1e4 * ((i + k) % 7) };
    });
  });
  const { radar, journal } = buildPseRadar(barsBySymbol, CONFIG);
  assert.equal(radar.asOf, '2026-10-12');
  assert.equal(radar.signals.length, 30);
  assert.ok(radar.signals.every(s => s.benchmark === 'PSE30' && s.name && s.sector && typeof s.score === 'number'));
  assert.ok(radar.signals[0].score >= radar.signals[29].score, 'ranked by score');
  assert.equal(radar.benchmark.symbol, 'PSE30'); assert.ok(radar.benchmark.close > 0);
  assert.ok([25, 100].includes(radar.regime.score)); assert.equal(typeof radar.regime.pse30AboveSma20, 'boolean');
  assert.equal(radar.sectors.length, 5);
  assert.ok(!radar.signals.some(s => ['PSE30', 'SPY', 'QQQ'].includes(s.symbol)), 'the benchmark is never a pick');
  assert.ok(journal.counts.raw > 0 && journal.counts.uniqueDates > 50);
  assert.ok(journal.byScoreBucket && journal.informationCoefficient);
  assert.throws(() => buildPseRadar({}, CONFIG), /not enough bars/);
});
