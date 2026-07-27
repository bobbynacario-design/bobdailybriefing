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

// `kind` is a SELECTION-EXPOSURE tag, not an asset class — it exists so the
// journal can run a control on itself, and it changes no scoring.
//
// The journal's positive result is undermined by one thing: this watchlist was
// chosen in 2026 knowing how these names turned out. A momentum score applied to
// names picked because they trended will rank them correctly whether or not the
// score is any good.
//
//   single — a hand-picked company. Maximum survivorship exposure: NVDA / GEV /
//            VRT are exactly the names you would choose after the fact.
//   etf    — a sector or commodity fund. Far less exposed: holdings rebalance by
//            rule, it is not delisted for underperforming, and it cannot 10x or
//            go to zero the way one company can.
//   crypto — reported separately; three names is too few to control anything.
//
// If the score ranks the `etf` half as well as the `single` half, the result is
// doing real work. If it only ranks the singles, it was measuring the picks.
// PARTIAL control: choosing ITA and GDX was still a 2026 call about defense and
// gold miners, so theme-level bias survives even where stock-level bias does not.
var WATCHLIST = [
  // AI semis — benchmark QQQ
  { symbol: 'NVDA', theme: 'AI semis', benchmark: 'QQQ', kind: 'single' },
  { symbol: 'AVGO', theme: 'AI semis', benchmark: 'QQQ', kind: 'single' },
  { symbol: 'AMD',  theme: 'AI semis', benchmark: 'QQQ', kind: 'single' },
  { symbol: 'SMH',  theme: 'AI semis', benchmark: 'QQQ', kind: 'etf' },
  { symbol: 'SOXX', theme: 'AI semis', benchmark: 'QQQ', kind: 'etf' },

  // AI infra / power — benchmark QQQ
  { symbol: 'VRT', theme: 'AI infra', benchmark: 'QQQ', kind: 'single' },
  { symbol: 'GEV', theme: 'AI infra', benchmark: 'QQQ', kind: 'single' },
  { symbol: 'PWR', theme: 'AI infra', benchmark: 'QQQ', kind: 'single' },
  { symbol: 'ETN', theme: 'AI infra', benchmark: 'QQQ', kind: 'single' },
  { symbol: 'CEG', theme: 'AI infra', benchmark: 'QQQ', kind: 'single' },

  // Crypto — benchmark BTC (BTC vs itself resolves to a neutral 0-spread)
  { symbol: 'BTC', theme: 'Crypto', benchmark: 'BTC', kind: 'crypto' },
  { symbol: 'ETH', theme: 'Crypto', benchmark: 'BTC', kind: 'crypto' },
  { symbol: 'SOL', theme: 'Crypto', benchmark: 'BTC', kind: 'crypto' },

  // Crypto equities — benchmark QQQ
  { symbol: 'COIN', theme: 'Crypto eq', benchmark: 'QQQ', kind: 'single' },
  { symbol: 'MSTR', theme: 'Crypto eq', benchmark: 'QQQ', kind: 'single' },

  // Energy / geo — benchmark SPY
  { symbol: 'USO', theme: 'Energy/geo', benchmark: 'SPY', kind: 'etf' },
  { symbol: 'XLE', theme: 'Energy/geo', benchmark: 'SPY', kind: 'etf' },
  { symbol: 'XOM', theme: 'Energy/geo', benchmark: 'SPY', kind: 'single' },
  { symbol: 'CVX', theme: 'Energy/geo', benchmark: 'SPY', kind: 'single' },
  { symbol: 'GLD', theme: 'Energy/geo', benchmark: 'SPY', kind: 'etf' },

  // Diversifiers — uncorrelated to the AI trade, so the score has something to
  // discriminate against (the journal flagged the universe as AI-concentrated).
  // All benchmark SPY.
  { symbol: 'XLF', theme: 'Financials',     benchmark: 'SPY', kind: 'etf' },
  { symbol: 'XLV', theme: 'Healthcare',     benchmark: 'SPY', kind: 'etf' },
  { symbol: 'XLI', theme: 'Industrials',    benchmark: 'SPY', kind: 'etf' },
  { symbol: 'XLY', theme: 'Consumer',       benchmark: 'SPY', kind: 'etf' },
  { symbol: 'ITA', theme: 'Defense',        benchmark: 'SPY', kind: 'etf' },
  { symbol: 'LMT', theme: 'Defense',        benchmark: 'SPY', kind: 'single' },
  { symbol: 'RTX', theme: 'Defense',        benchmark: 'SPY', kind: 'single' },
  { symbol: 'GDX', theme: 'Metals/commod',  benchmark: 'SPY', kind: 'etf' },
  { symbol: 'SLV', theme: 'Metals/commod',  benchmark: 'SPY', kind: 'etf' },
  { symbol: 'DBC', theme: 'Metals/commod',  benchmark: 'SPY', kind: 'etf' },

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

// How far back to FETCH daily bars. This bounds how much history the journal can
// ever measure, so it is the real limit on every statistic the journal reports.
//
// At 400 days the journal had ~275 trading days to work with and used 60 of them,
// which is ~3 independent windows at a 20-bar horizon — too few for any finding
// to mean anything. ~3 years of daily bars costs nothing (Alpaca daily bars are
// free and the fetch already pages through `next_page_token`) and takes the
// sample to a few dozen independent windows.
//
// CRYPTO IS CAPPED SEPARATELY at 365 days — that is CoinGecko's free-tier limit,
// not a choice — so on dates older than that the universe is equities only. The
// journal reports the per-date universe size rather than assuming it is constant.
var BARS_LOOKBACK_DAYS = 1100;
var CRYPTO_LOOKBACK_DAYS = 365;   // CoinGecko free tier maximum

// V3 journal: re-score the last `lookbackDays` trading days point-in-time and
// calibrate each signal's outcome over the next `horizonBars` bars. Measurement
// only — these keys never touch scoring.
var JOURNAL = {
  // Deliberately larger than the fetch can supply: the available bars are the
  // real bound, and this should not silently become the tighter one again.
  lookbackDays: 900,
  // A date is only scored once an asset has this many bars behind it. Scoring
  // needs 50 for SMA50, and nothing previously stopped a date being scored on a
  // dozen bars — it just produced a quietly worse score that the journal then
  // measured as if it were the real model.
  minBarsToScore: 60,
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
  barsLookbackDays: BARS_LOOKBACK_DAYS,
  cryptoLookbackDays: CRYPTO_LOOKBACK_DAYS,
  journal: JOURNAL,
  ph: PH
};

export { CONFIG };
