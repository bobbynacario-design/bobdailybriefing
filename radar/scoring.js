// radar/scoring.js
//
// PURE scoring engine for the Daily Briefer Market Radar.
// No I/O of any kind: no fetch, no Firestore, no file access, no Date.now().
// Everything it needs arrives via its two arguments. This is deliberate so the
// exact same module can run unchanged inside a future scheduled Cloud Function.
//
//   scoreUniverse(barsByAsset, config) -> { asOf, regime, signals }
//
// `barsByAsset` is a map of SYMBOL -> array of daily bars, ascending by date.
// Each bar: { date, open, high, low, close, volume }. Equity bars come from
// Alpaca (real OHLCV); crypto bars from CoinGecko (low may be a prior-close
// proxy — see refresh-radar.js). The engine only reads close, low, volume, date.

// ── interpolation knot tables (the V1 scoring spec, deterministic) ──
// Each table maps an input value to a 0–100 sub-score via piecewise-linear
// interpolation, clamped at both ends.
var VOLUME_KNOTS = [
  [0.6, 20], [0.8, 35], [1.0, 50], [1.2, 65], [1.5, 80], [2.0, 100]
];
var RELSTRENGTH_KNOTS = [
  [-10, 10], [-5, 30], [0, 50], [5, 80], [10, 100]
];
// riskQuality replaces the inert riskReward sub-score (post-V3 refinement; not
// the V2 catalyst lane). Two ATR-calibrated curves: stop distance (risk / ATR)
// and extension above SMA20 ((close-SMA20)/ATR). Heuristic — tune via the journal.
var RQ_STOP_KNOTS = [
  [0.5, 30], [1.0, 80], [1.5, 100], [2.5, 70], [4.0, 30]
];
var RQ_EXT_KNOTS = [
  [0, 80], [0.5, 100], [2.0, 70], [4.0, 40], [6.0, 20]
];

// Linear interpolation across sorted [x, y] knots, clamped outside the range.
function interp(knots, v) {
  if (v <= knots[0][0]) return knots[0][1];
  var last = knots.length - 1;
  if (v >= knots[last][0]) return knots[last][1];
  for (var i = 0; i < last; i++) {
    var x0 = knots[i][0], y0 = knots[i][1];
    var x1 = knots[i + 1][0], y1 = knots[i + 1][1];
    if (v >= x0 && v <= x1) {
      var t = (v - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return knots[last][1];
}

function round(v, dp) {
  if (v === null || v === undefined || isNaN(v)) return null;
  var m = Math.pow(10, dp || 0);
  return Math.round(v * m) / m;
}

function sma(closes, n) {
  if (closes.length < n) return null;
  var sum = 0;
  for (var i = closes.length - n; i < closes.length; i++) sum += closes[i];
  return sum / n;
}

// 20-day percent return: latest close vs the close 20 bars back.
function ret20(closes) {
  if (closes.length < 21) return null;
  var now = closes[closes.length - 1];
  var then = closes[closes.length - 1 - 20];
  if (!then) return null;
  return (now / then - 1) * 100;
}

// ── sub-scores ──

// trend: position of close relative to SMA20/SMA50, with a downtrend-structure cap.
function trendScore(close, s20, s50) {
  var t;
  var above20 = s20 != null && close > s20;
  var above50 = s50 != null && close > s50;
  if (above20 && above50) t = 100;
  else if (above20 && !above50) t = 70;
  else if (!above20 && above50) t = 50;
  else t = 20;
  // If the structure itself is a downtrend (SMA20 below SMA50), cap optimism.
  if (s20 != null && s50 != null && s20 < s50) t = Math.min(t, 60);
  return t;
}

// volume: today's volume vs the trailing-20 average (prior 20 bars, excludes today).
function volumeMetrics(bars) {
  if (bars.length < 21) return { ratio: null, score: 50 };
  var today = bars[bars.length - 1].volume;
  var sum = 0;
  for (var i = bars.length - 21; i < bars.length - 1; i++) sum += bars[i].volume;
  var avg20 = sum / 20;
  if (!avg20) return { ratio: null, score: 50 };
  var r = today / avg20;
  return { ratio: r, score: interp(VOLUME_KNOTS, r) };
}

// relStrength: asset 20d return minus benchmark 20d return, in percentage points.
function relStrengthMetrics(assetCloses, benchCloses) {
  var a = ret20(assetCloses);
  var b = benchCloses ? ret20(benchCloses) : null;
  if (a == null || b == null) return { spread: null, score: 50 };
  var s = a - b;
  return { spread: s, score: interp(RELSTRENGTH_KNOTS, s) };
}

// Risk/reward LEVELS for the card: stop = min(prior-day low, SMA20); entry =
// close; target = entry + 2*(entry-stop). By construction rr is ~2.0 — these
// levels are the displayed plan and the journal's published stop/target. The
// score blend no longer reads rr (it was a constant); riskQuality replaces it.
function riskRewardMetrics(close, priorLow, s20) {
  var stop = Math.min(
    priorLow != null ? priorLow : Infinity,
    s20 != null ? s20 : Infinity
  );
  if (!isFinite(stop)) return { stop: null, entry: close, target: null, rr: null };
  var entry = close;
  var risk = entry - stop;
  if (risk <= 0) {
    // Close is at or below the stop: no valid long structure.
    return { stop: stop, entry: entry, target: null, rr: 0 };
  }
  var target = entry + 2 * risk;
  return { stop: stop, entry: entry, target: target, rr: (target - entry) / risk };
}

// ATR(14): mean True Range over the last 14 bars. Equity uses real high/low;
// crypto (high=low=close proxy) reduces to |close - prevClose| (close-to-close).
function atr(bars, n) {
  if (bars.length < n + 1) return null;
  var sum = 0;
  for (var i = bars.length - n; i < bars.length; i++) {
    var b = bars[i], p = bars[i - 1];
    var tr = Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close));
    sum += tr;
  }
  return sum / n;
}

// riskQuality (0-100): is the risk well-formed? Rewards a stop a healthy ATR
// multiple below entry (not noise-tight, not chasing-wide) and an entry not
// overextended above SMA20. Replaces the inert constant riskReward sub-score.
function riskQuality(entry, stop, s20, atrVal) {
  if (atrVal == null || atrVal <= 0) return 50;        // volatility undefined -> neutral
  if (stop == null || entry - stop <= 0) return 20;    // broken structure
  var a = (entry - stop) / atrVal;                     // stop distance, in ATRs
  var e = (s20 != null ? (entry - s20) : 0) / atrVal;  // extension above mean, in ATRs
  return Math.round(0.5 * interp(RQ_STOP_KNOTS, a) + 0.5 * interp(RQ_EXT_KNOTS, e));
}

// regime: SPY & QQQ both above their SMA20 -> 100; one -> 60; neither -> 25.
function computeRegime(barsByAsset) {
  function aboveSma20(sym) {
    var bars = barsByAsset[sym];
    if (!bars || bars.length < 20) return null;
    var closes = bars.map(function (b) { return b.close; });
    var s20 = sma(closes, 20);
    var close = closes[closes.length - 1];
    return s20 != null ? close > s20 : null;
  }
  var spy = aboveSma20('SPY');
  var qqq = aboveSma20('QQQ');
  var n = (spy ? 1 : 0) + (qqq ? 1 : 0);
  var score = n === 2 ? 100 : (n === 1 ? 60 : 25);
  return { score: score, spyAboveSma20: !!spy, qqqAboveSma20: !!qqq };
}

// status from the V1 heuristic gates. Invalidated is checked first: a setup that
// has broken its stop or lost relative strength is invalidated regardless.
function classify(sub, close, stop, regimeScore) {
  if ((stop != null && close < stop) ||
      sub.relStrength < 30 ||
      (regimeScore < 60 && sub.trend < 50)) {
    return 'invalidated';
  }
  if (sub.trend >= 70 && sub.volume >= 65 && sub.relStrength >= 50 && regimeScore >= 60) {
    return 'confirmed';
  }
  return 'forming';
}

// ── plain-language framing (deterministic text, no prediction, no "buy") ──

function fmtNum(v) {
  if (v == null) return '—';
  var abs = Math.abs(v);
  var dp = abs >= 100 ? 2 : (abs >= 1 ? 2 : 4);
  return v.toFixed(dp);
}

function buildWhy(sym, bench, status, sub, volRatio, relSpread) {
  var trendPhrase = sub.trend >= 100 ? 'holding above both its 20- and 50-day averages'
    : sub.trend >= 70 ? 'above its 20-day average'
    : sub.trend >= 50 ? 'above its 50-day average but below the 20-day'
    : 'below both moving averages';
  var volPhrase = volRatio == null ? 'with no clean volume read'
    : volRatio >= 1.2 ? ('on volume running ' + volRatio.toFixed(2) + '× its 20-day norm')
    : ('on volume near ' + volRatio.toFixed(2) + '× its 20-day norm');
  var rsPhrase = relSpread == null ? ('vs ' + bench)
    : relSpread >= 0 ? ('leading ' + bench + ' by +' + relSpread.toFixed(1) + ' pts over 20 days')
    : ('lagging ' + bench + ' by ' + relSpread.toFixed(1) + ' pts over 20 days');
  var frame = status === 'confirmed' ? 'a strong, confirmed move worth the defined risk'
    : status === 'invalidated' ? 'a setup that has lost its edge for now'
    : 'an early, still-forming move';
  return sym + ' is ' + trendPhrase + ' ' + volPhrase + ', ' + rsPhrase + ' — ' + frame + '.';
}

function buildInvalidation(sym, stop, status) {
  if (stop == null) return 'No clean structural stop is defined for ' + sym + ' yet.';
  if (status === 'invalidated') {
    return sym + ' has already lost its structure; it would need to reclaim ' + fmtNum(stop) + ' to re-set.';
  }
  return 'The idea is off if ' + sym + ' closes back below ' + fmtNum(stop) + ' (its 20-day average / prior-day low).';
}

// ── main entry point ──

function scoreUniverse(barsByAsset, config) {
  var weights = config.weights;
  var indexSet = {};
  (config.indexSymbols || []).forEach(function (s) { indexSet[s] = true; });

  // asOf = the data date of the most recent bar we have (prefer SPY, else any).
  var asOf = null;
  var ref = barsByAsset.SPY || barsByAsset.QQQ;
  if (ref && ref.length) asOf = ref[ref.length - 1].date;

  var regime = computeRegime(barsByAsset);

  var signals = [];
  (config.watchlist || []).forEach(function (item) {
    var sym = item.symbol;
    if (indexSet[sym]) return; // index/regime symbols are not scored as ideas
    var bars = barsByAsset[sym];
    if (!bars || bars.length < 21) return; // not enough data to score honestly

    var closes = bars.map(function (b) { return b.close; });
    var close = closes[closes.length - 1];
    var s20 = sma(closes, 20);
    var s50 = sma(closes, 50);
    var priorLow = bars.length >= 2 ? bars[bars.length - 2].low : null;

    var benchBars = barsByAsset[item.benchmark];
    var benchCloses = benchBars ? benchBars.map(function (b) { return b.close; }) : null;

    var vol = volumeMetrics(bars);
    var rs = relStrengthMetrics(closes, benchCloses);
    var rr = riskRewardMetrics(close, priorLow, s20);
    var atrVal = atr(bars, 14);
    var sub = {
      trend: trendScore(close, s20, s50),
      volume: vol.score,
      relStrength: rs.score,
      riskQuality: riskQuality(rr.entry, rr.stop, s20, atrVal),
      regime: regime.score
    };

    var score =
      weights.trend * sub.trend +
      weights.volume * sub.volume +
      weights.relStrength * sub.relStrength +
      weights.riskQuality * sub.riskQuality +
      weights.regime * sub.regime;

    var status = classify(sub, close, rr.stop, regime.score);

    signals.push({
      symbol: sym,
      theme: item.theme,
      benchmark: item.benchmark,
      score: Math.round(score),
      status: status,
      close: round(close, 2),
      sma20: round(s20, 2),
      sma50: round(s50, 2),
      volRatio: round(vol.ratio, 2),
      relStrength20d: round(rs.spread, 1),
      entry: round(rr.entry, 2),
      stop: round(rr.stop, 2),
      target: round(rr.target, 2),
      rr: round(rr.rr, 2),
      riskQuality: sub.riskQuality,
      // all five sub-scores, so the journal can calibrate each component's
      // predictive power for forward excess (weight calibration).
      subScores: {
        trend: sub.trend, volume: sub.volume, relStrength: sub.relStrength,
        riskQuality: sub.riskQuality, regime: sub.regime
      },
      why: buildWhy(sym, item.benchmark, status, sub, vol.ratio, rs.spread),
      invalidation: buildInvalidation(sym, rr.stop, status)
    });
  });

  signals.sort(function (a, b) { return b.score - a.score; });

  return { asOf: asOf, regime: regime, signals: signals };
}

export { scoreUniverse, interp, trendScore, sma, ret20 };
