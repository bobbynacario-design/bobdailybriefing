// radar/config.js
//
// Watchlist, benchmarks, scoring weights and status thresholds for the Market
// Radar. This is the only place to tune the universe. scoring.js reads `weights`
// from the config object it is handed; it imports nothing from here directly.
//
// Themes: AI semis / AI infra / Crypto / Crypto eq / Energy-geo. Index symbols
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

// Renormalised V1 weights (catalyst + event-penalty dropped; sums to 1.0).
var WEIGHTS = {
  trend: 0.30,
  volume: 0.25,
  relStrength: 0.25,
  riskReward: 0.10,
  regime: 0.10
};

// How many trailing daily bars to request so SMA50 + 20d returns are well-defined.
var LOOKBACK_BARS = 160;

// V3 journal: re-score the last `lookbackDays` trading days point-in-time and
// track each signal's outcome over the next `horizonDays` bars.
var JOURNAL = {
  lookbackDays: 60,
  horizonDays: 20,
  recentCap: 120   // how many recent closed outcomes to persist for the table
};

var CONFIG = {
  watchlist: WATCHLIST,
  indexSymbols: INDEX_SYMBOLS,
  coingeckoIds: COINGECKO_IDS,
  weights: WEIGHTS,
  lookbackBars: LOOKBACK_BARS,
  journal: JOURNAL
};

export { CONFIG };
