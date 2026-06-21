// radar/config.js
//
// Watchlist, benchmarks, scoring weights and status thresholds for the Market
// Radar. This is the only place to tune the universe. scoring.js reads `weights`
// from the config object it is handed; it imports nothing from here directly.
//
// Themes: AI semis / AI infra / Crypto / Crypto eq / Energy-geo / Financials /
// Healthcare / Industrials / Consumer / Defense / Metals-commod. Index symbols
// (SPY, QQQ, IWM) are fetched for regime + as benchmarks but are NOT scored as
// ideas (scoring.js skips anything listed in indexSymbols).

var WATCHLIST = [
  // AI semis — benchmark QQQ
  { symbol: 'NVDA', theme: 'AI semis', benchmark: 'QQQ' },
  { symbol: 'AVGO', theme: 'AI semis', benchmark: 'QQQ' },
  { symbol: 'AMD',  theme: 'AI semis', benchmark: 'QQQ' },
  { symbol: 'SMH',  theme: 'AI semis', benchmark: 'QQQ' },
  { symbol: 'SOXX', theme: 'AI semis', benchmark: 'QQQ' },

  // AI infra / power — benchmark QQQ
  { symbol: 'VRT', theme: 'AI infra', benchmark: 'QQQ' },
  { symbol: 'GEV', theme: 'AI infra', benchmark: 'QQQ' },
  { symbol: 'PWR', theme: 'AI infra', benchmark: 'QQQ' },
  { symbol: 'ETN', theme: 'AI infra', benchmark: 'QQQ' },
  { symbol: 'CEG', theme: 'AI infra', benchmark: 'QQQ' },

  // Crypto — benchmark BTC (BTC vs itself resolves to a neutral 0-spread)
  { symbol: 'BTC', theme: 'Crypto', benchmark: 'BTC' },
  { symbol: 'ETH', theme: 'Crypto', benchmark: 'BTC' },
  { symbol: 'SOL', theme: 'Crypto', benchmark: 'BTC' },

  // Crypto equities — benchmark QQQ
  { symbol: 'COIN', theme: 'Crypto eq', benchmark: 'QQQ' },
  { symbol: 'MSTR', theme: 'Crypto eq', benchmark: 'QQQ' },

  // Energy / geo — benchmark SPY
  { symbol: 'USO', theme: 'Energy/geo', benchmark: 'SPY' },
  { symbol: 'XLE', theme: 'Energy/geo', benchmark: 'SPY' },
  { symbol: 'XOM', theme: 'Energy/geo', benchmark: 'SPY' },
  { symbol: 'CVX', theme: 'Energy/geo', benchmark: 'SPY' },
  { symbol: 'GLD', theme: 'Energy/geo', benchmark: 'SPY' },

  // Diversifiers — uncorrelated to the AI trade, so the score has something to
  // discriminate against (the journal flagged the universe as AI-concentrated).
  // All benchmark SPY.
  { symbol: 'XLF', theme: 'Financials',     benchmark: 'SPY' },
  { symbol: 'XLV', theme: 'Healthcare',     benchmark: 'SPY' },
  { symbol: 'XLI', theme: 'Industrials',    benchmark: 'SPY' },
  { symbol: 'XLY', theme: 'Consumer',       benchmark: 'SPY' },
  { symbol: 'ITA', theme: 'Defense',        benchmark: 'SPY' },
  { symbol: 'LMT', theme: 'Defense',        benchmark: 'SPY' },
  { symbol: 'RTX', theme: 'Defense',        benchmark: 'SPY' },
  { symbol: 'GDX', theme: 'Metals/commod',  benchmark: 'SPY' },
  { symbol: 'SLV', theme: 'Metals/commod',  benchmark: 'SPY' },
  { symbol: 'DBC', theme: 'Metals/commod',  benchmark: 'SPY' },

  // Index / regime — fetched for regime + benchmarks, never scored as ideas
  { symbol: 'SPY', theme: 'Index/regime', benchmark: 'SPY' },
  { symbol: 'QQQ', theme: 'Index/regime', benchmark: 'QQQ' },
  { symbol: 'IWM', theme: 'Index/regime', benchmark: 'SPY' }
];

// Symbols used only for regime/benchmarks — excluded from the scored signals.
var INDEX_SYMBOLS = ['SPY', 'QQQ', 'IWM'];

// Crypto symbol -> CoinGecko coin id (used by refresh-radar.js for the data pull).
var COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana'
};

// Component weights (sum to 1.0). Deliberately round PRIORS — chosen, not fitted.
// journal.js surfaces a weightCalibration diagnostic (forward-excess tercile
// spread on a fit/holdout split), and on the current sample only riskQuality had
// a robust OOS spread — but it was NEGATIVE, and the same journal finds aggregate
// excess basically flat. Fitting weights to ~60 days of one correlated regime is
// fitting to noise; the project defers auto-tuning the heuristics from journal
// stats (overfitting risk on short history). So the calibration stays
// SURFACED-ONLY: review it in the journal doc, do not apply it, until there is
// multi-regime, non-overlapping history that can support a reweight. (These were
// briefly set to a shrunk fit 0.308/0.258/0.258/0.073/0.103 and reverted here.)
var WEIGHTS = {
  trend: 0.30,
  volume: 0.25,
  relStrength: 0.25,
  riskQuality: 0.10,
  regime: 0.10
};

// Theme-specific regime drivers. The regime sub-score (and the confirm/invalidate
// gate) reads the breadth of a theme's OWN driver basket above its SMA20 — graded
// 25..100 — instead of judging every asset by SPY & QQQ. Every driver here is
// already a fetched watchlist symbol, so this adds no I/O and the journal
// re-scores it point-in-time unchanged. A theme with no mapped/available drivers
// falls back to the global market regime. (e.g. crypto now reads BTC/ETH, energy
// reads USO/XLE, metals read gold/silver — so a weak QQQ no longer drags a
// defensive-metals setup, and a crypto setup is no longer gated by US equities.)
var THEME_REGIME = {
  'AI semis':      ['QQQ', 'SMH', 'SOXX'],
  'AI infra':      ['QQQ', 'XLI'],
  'Crypto':        ['BTC', 'ETH'],
  'Crypto eq':     ['QQQ', 'BTC'],
  'Energy/geo':    ['USO', 'XLE'],
  'Financials':    ['XLF', 'SPY'],
  'Healthcare':    ['XLV', 'SPY'],
  'Industrials':   ['XLI', 'SPY'],
  'Consumer':      ['XLY', 'SPY'],
  'Defense':       ['ITA', 'SPY'],
  'Metals/commod': ['GLD', 'SLV', 'DBC'],
  'Index/regime':  ['SPY', 'QQQ', 'IWM']
};

// How many trailing daily bars to request so SMA50 + 20d returns are well-defined.
var LOOKBACK_BARS = 160;

// V3 journal: re-score the last `lookbackDays` trading days point-in-time and
// calibrate each signal's outcome over the next `horizonBars` bars. Measurement
// only — these keys never touch scoring.
var JOURNAL = {
  lookbackDays: 60,
  horizonBars: 20,                      // forward window for outcome resolution
  entryMode: 'next-session',            // fill at next open (equity) / next close (crypto)
  ambiguousResolution: 'conservative',  // same-bar stop+target -> count the stop
  recentCap: 120,                       // how many recent outcomes to persist
  scoringModelMeasured: 'v2-riskQuality' // label: which scoring model the journal measured
};

// PH market snapshot (NOT scored — there is no free historical per-stock PSE
// feed). The PSEi index has clean Yahoo history (PHP); company rows are
// US-listed proxies (ADR/OTC, USD) that only track the local shares loosely.
// Snapshot only, heavily caveated. See buildPhSnapshot() in refresh-radar.js.
var PH = {
  index: { symbol: 'PSEI.PS', name: 'PSEi' },
  proxies: [
    { symbol: 'PHI',   name: 'PLDT',           listing: 'NYSE ADR' },
    { symbol: 'SVTMF', name: 'SM Investments', listing: 'US OTC' },
    { symbol: 'BDOUY', name: 'BDO Unibank',    listing: 'US OTC ADR' },
    { symbol: 'JBFCY', name: 'Jollibee',       listing: 'US OTC ADR' },
    { symbol: 'AYYLF', name: 'Ayala Corp',     listing: 'US OTC' }
  ]
};

var CONFIG = {
  watchlist: WATCHLIST,
  indexSymbols: INDEX_SYMBOLS,
  coingeckoIds: COINGECKO_IDS,
  weights: WEIGHTS,
  themeRegime: THEME_REGIME,
  lookbackBars: LOOKBACK_BARS,
  journal: JOURNAL,
  ph: PH
};

export { CONFIG };
