// radar/pse-radar.js
//
// The PSE radar: the US Market Radar's scoring (scoring.js) and its journal
// (journal.js), unchanged, run over the 30 PSEi stocks' PSE Edge bars. Pure:
// the bars come in from ph-snapshot.js, the docs go out through refresh-ph.js.
//
// Three adaptations, all here, none in the shared modules:
//   1. Volume. PSE Edge gives peso traded value, not shares, so value stands in
//      for volume. The volume and accumulation scores are ratios to their own
//      20-day average, so pesos work; they drift a little with price.
//   2. Benchmark. The PSEi has only Daybook's own ~60 stored closes, so each
//      stock is measured against PSE30: an equal-weight index of the 30 built
//      from their bars (the average stock's daily return, compounded).
//   3. Market. scoring.js reads the market backdrop, the data date and beta
//      from SPY and QQQ, and journal.js takes its calendar from SPY. PSE30 is
//      passed under those two names as well, so both work unchanged. With one
//      series under both names the backdrop is 100 (PSE30 above its 20-day
//      average) or 25 (below), never 60.
// Each stock's theme is its PSE sector; a sector's regime is the share of its
// members above their 20-day average, which is what the confirmed / forming /
// invalidated call reads.
//
// The weights are the US model's, untouched. Whether they rank PSE stocks is
// what the journal measures: it re-scores every past day from the bars, so its
// evidence covers the ~10 months the bars reach, not just runs since launch.

import { scoreUniverse } from './scoring.js';
import { buildJournal } from './journal.js';

var BENCH = 'PSE30';

function num(v) { return v == null || !isFinite(v) ? null : Number(v); }

// PSE Edge bars -> what scoring.js reads. Rows without a close are dropped;
// a missing high/low/open falls back to the close; volume = peso value (0 when
// absent, so one gap can't null a 20-day average).
function toScoringBars(bars) {
  return (bars || []).filter(function (b) { return b && b.date && num(b.close) != null; }).map(function (b) {
    var c = num(b.close);
    return { date: b.date, open: num(b.open) == null ? c : num(b.open), high: num(b.high) == null ? c : num(b.high),
      low: num(b.low) == null ? c : num(b.low), close: c, volume: num(b.value) || 0 };
  });
}

// Equal-weight index of the given series: each day, the average return of the
// stocks that traded that day and the one before (their own previous close),
// compounded from 100. Only days on which at least half the stocks traded.
function equalWeightIndex(barsBySymbol) {
  var syms = Object.keys(barsBySymbol || {});
  var byDate = {};
  syms.forEach(function (s) {
    var bars = barsBySymbol[s] || [];
    for (var i = 0; i < bars.length; i++) {
      var d = bars[i].date;
      (byDate[d] = byDate[d] || []).push(i > 0 && bars[i - 1].close ? bars[i].close / bars[i - 1].close - 1 : null);
    }
  });
  var dates = Object.keys(byDate).filter(function (d) { return byDate[d].length >= syms.length / 2; }).sort();
  var level = 100, out = [];
  dates.forEach(function (d, k) {
    if (k > 0) {
      var rets = byDate[d].filter(function (r) { return r != null; });
      if (rets.length) level *= 1 + rets.reduce(function (a, r) { return a + r; }, 0) / rets.length;
    }
    var l = Math.round(level * 10000) / 10000;
    out.push({ date: d, open: l, high: l, low: l, close: l, volume: 0 });
  });
  return out;
}

// The config scoring.js and journal.js read, built from the shared radar
// config: same weights and early-accumulation bar, PSE stocks and sectors.
function pseRadarConfig(config) {
  var stocks = (config.ph && config.ph.board && config.ph.board.stocks) || [];
  var sectors = {};
  stocks.forEach(function (s) { (sectors[s.sector || 'Other'] = sectors[s.sector || 'Other'] || []).push(s.symbol); });
  return {
    watchlist: stocks.map(function (s) { return { symbol: s.symbol, theme: s.sector || 'Other', benchmark: BENCH, kind: 'single' }; }),
    indexSymbols: [BENCH, 'SPY', 'QQQ'],
    coingeckoIds: {},
    weights: config.weights,
    earlyAccumulationMin: config.earlyAccumulationMin,
    themeRegime: sectors,
    // No model / previousWeights: the US reweight check does not apply here.
    journal: Object.assign({}, config.journal, { scoringModelMeasured: 'US radar weights on PSE Edge bars (peso value as volume)' })
  };
}

// {radar, journal} for the bars of each stock ({SYMBOL: PSE Edge bars}).
function buildPseRadar(barsBySymbol, config) {
  var cfg = pseRadarConfig(config);
  var names = {}, sectorOf = {};
  ((config.ph && config.ph.board && config.ph.board.stocks) || []).forEach(function (s) { names[s.symbol] = s.name; sectorOf[s.symbol] = s.sector; });
  var bars = {};
  cfg.watchlist.forEach(function (w) {
    var b = toScoringBars(barsBySymbol[w.symbol]);
    if (b.length) bars[w.symbol] = b;
  });
  var ew = equalWeightIndex(bars);
  if (ew.length < 21) throw new Error('not enough bars for the PSE30 benchmark');
  bars[BENCH] = ew; bars.SPY = ew; bars.QQQ = ew;

  var res = scoreUniverse(bars, cfg);
  var closes = ew.map(function (b) { return b.close; });
  var s20 = closes.length >= 20 ? closes.slice(-20).reduce(function (a, c) { return a + c; }, 0) / 20 : null;
  var radar = {
    asOf: res.asOf,
    benchmark: { symbol: BENCH, close: closes[closes.length - 1], sma20: s20 == null ? null : Math.round(s20 * 100) / 100,
      ret20: closes.length > 20 ? Math.round((closes[closes.length - 1] / closes[closes.length - 21] - 1) * 10000) / 100 : null },
    regime: { score: res.regime.score, pse30AboveSma20: res.regime.spyAboveSma20 },
    sectors: Object.keys(cfg.themeRegime).map(function (k) {
      var sig = res.signals.filter(function (s) { return s.theme === k; })[0];
      return { sector: k, members: cfg.themeRegime[k].length, regimeScore: sig ? sig.regimeScore : null };
    }),
    model: cfg.journal.scoringModelMeasured,
    signals: res.signals.map(function (s) { return Object.assign({ name: names[s.symbol] || '', sector: sectorOf[s.symbol] || s.theme }, s); })
  };
  var journal = buildJournal(bars, cfg, cfg.journal);
  return { radar: radar, journal: journal };
}

export { toScoringBars, equalWeightIndex, pseRadarConfig, buildPseRadar };
