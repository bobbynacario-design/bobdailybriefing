// radar/journal.js
//
// PURE calibration harness for the Market Radar (V3). No I/O (no fetch, no
// Firestore, no Date) — all I/O stays in refresh-radar.js.
//
// Because scoreUniverse() is deterministic, the journal is a pure function of
// the price bars: re-score each past day point-in-time (bars sliced to that
// date), then measure what actually happened — but honestly:
//   - fill at the NEXT session (a brief reader can't transact at the scored close),
//   - resolve target/stop with a conservative same-bar tie-break,
//   - report BENCHMARK-EXCESS return (the score must beat its own benchmark, not
//     just ride sector beta), alongside raw return,
//   - break results out by theme / asset / date and report overlap honesty,
//     so one ticker or one good stretch can't masquerade as skill.
//
// It calibrates the SHIPPED model — it does NOT change scoring.js.
//
//   buildJournal(barsByAsset, config, opts) -> journal doc body (see bottom)

import { scoreUniverse } from './scoring.js';

// All percentages are stored as percentage points (e.g. 4.36 == +4.36%).

function scoreBucket(score) {
  if (score >= 80) return '80-100';
  if (score >= 60) return '60-79';
  if (score >= 40) return '40-59';
  return '0-39';
}

function mean(arr) {
  if (!arr.length) return null;
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function round(v, dp) {
  if (v === null || v === undefined || isNaN(v)) return null;
  var m = Math.pow(10, dp || 0);
  return Math.round(v * m) / m;
}

function idxOfDate(bars, date) {
  for (var i = 0; i < bars.length; i++) if (bars[i].date === date) return i;
  return -1;
}

// Most recent close at or before `date` (bars ascending). Lets a benchmark with
// a different calendar (e.g. equity QQQ vs a weekend crypto exit) still resolve.
function closeOnOrBefore(bars, date) {
  var c = null;
  for (var i = 0; i < bars.length; i++) {
    if (bars[i].date <= date) c = bars[i].close; else break;
  }
  return c;
}

// Resolve one signal's outcome over its forward window (bars from the fill bar
// onward, already capped to the horizon). Equity uses intrabar high/low with a
// conservative same-bar tie-break; crypto resolves on close only.
//
// `fill` guards against resolving a trade that could never have been entered.
// A signal is `invalidated` precisely BECAUSE its close broke the stop, so its
// next-session fill is usually still below that stop — and the loop below would
// then match `low <= stop` on the very first bar and "exit" at the stop, ABOVE
// the fill, booking a guaranteed gain on a position nobody could have held. That
// artifact is what made the invalidated bucket and the 0-39 score band look like
// the best performers in the journal. The mirror case (a fill already at or
// beyond the target) is rarer and books a small fake LOSS rather than a gain,
// but it is the same defect: the published levels no longer bracket the entry.
// Both are reported as unfillable and excluded upstream — never scored.
function resolveOutcome(stop, target, windowBars, isCrypto, fullWindow, fill) {
  var resolution = isCrypto ? 'close-only' : 'ohlc';
  if (fill != null) {
    if (stop != null && fill <= stop) {
      return { exitReason: 'unfillable', unfillable: 'below-stop', exit: null, exitDate: null,
               ambiguous: false, resolution: resolution };
    }
    if (target != null && fill >= target) {
      return { exitReason: 'unfillable', unfillable: 'above-target', exit: null, exitDate: null,
               ambiguous: false, resolution: resolution };
    }
  }
  for (var i = 0; i < windowBars.length; i++) {
    var b = windowBars[i];
    if (isCrypto) {
      if (stop != null && b.close <= stop) return { exitReason: 'stop-hit', exit: stop, exitDate: b.date, ambiguous: false, resolution: resolution };
      if (target != null && b.close >= target) return { exitReason: 'target-hit', exit: target, exitDate: b.date, ambiguous: false, resolution: resolution };
    } else {
      var hitStop = (stop != null) && (b.low <= stop);
      var hitTarget = (target != null) && (b.high >= target);
      if (hitStop && hitTarget) {
        // Same-bar ambiguity: conservatively count the stop, never a win.
        return { exitReason: 'stop-hit', exit: stop, exitDate: b.date, ambiguous: true, resolution: resolution };
      }
      if (hitStop) return { exitReason: 'stop-hit', exit: stop, exitDate: b.date, ambiguous: false, resolution: resolution };
      if (hitTarget) return { exitReason: 'target-hit', exit: target, exitDate: b.date, ambiguous: false, resolution: resolution };
    }
  }
  // No level hit within the window.
  if (windowBars.length) {
    var last = windowBars[windowBars.length - 1];
    return { exitReason: fullWindow ? 'expired' : 'open', exit: last.close, exitDate: last.date, ambiguous: false, resolution: resolution };
  }
  return { exitReason: 'open', exit: null, exitDate: null, ambiguous: false, resolution: resolution };
}

// ── aggregation ──

// Full group stats (used by byStatus and byScoreBucket).
function groupStats(list) {
  var wins = 0, losses = 0, amb = 0, exWins = 0;
  var fwd = [], ex = [];
  list.forEach(function (e) {
    if (e.exitReason === 'target-hit') wins++;
    else if (e.exitReason === 'stop-hit') losses++;
    if (e.ambiguous) amb++;
    if (e.forwardReturn != null) fwd.push(e.forwardReturn);
    if (e.excessReturn != null) { ex.push(e.excessReturn); if (e.excessReturn > 0) exWins++; }
  });
  var decided = wins + losses;
  return {
    n: list.length,
    winRate: decided ? round((wins / decided) * 100, 1) : null,
    avgForwardReturn: round(mean(fwd), 2),
    excessWinRate: ex.length ? round((exWins / ex.length) * 100, 1) : null,
    avgExcessReturn: round(mean(ex), 2),
    ambiguousN: amb
  };
}

// Slim excess-only group (used by byTheme and byAsset).
function excessStats(list) {
  var exWins = 0, ex = [];
  list.forEach(function (e) {
    if (e.excessReturn != null) { ex.push(e.excessReturn); if (e.excessReturn > 0) exWins++; }
  });
  return {
    n: list.length,
    excessWinRate: ex.length ? round((exWins / ex.length) * 100, 1) : null,
    avgExcessReturn: round(mean(ex), 2)
  };
}

function groupBy(entries, keyFn) {
  var out = {};
  entries.forEach(function (e) {
    var k = keyFn(e);
    (out[k] = out[k] || []).push(e);
  });
  return out;
}

// Greedy non-overlapping count per asset: keep a signal only if it sits at least
// `horizon` bars after the last kept one (its forward window doesn't overlap).
function nonOverlappingCount(entries, horizon) {
  var bySym = groupBy(entries, function (e) { return e.symbol; });
  var total = 0;
  Object.keys(bySym).forEach(function (sym) {
    var arr = bySym[sym].slice().sort(function (a, b) { return a.idx - b.idx; });
    var lastKept = -Infinity, kept = 0;
    arr.forEach(function (e) {
      if (e.idx >= lastKept + horizon) { kept++; lastKept = e.idx; }
    });
    total += kept;
  });
  return total;
}

function emptyGroup() {
  return { n: 0, winRate: null, avgForwardReturn: null, excessWinRate: null, avgExcessReturn: null, ambiguousN: 0 };
}

// ── information coefficient (does the score RANK correctly?) ──────────────
//
// byScoreBucket answers "what did the 80-100 band earn", which pools every
// signal in the window and is dominated by whichever weeks happened to be in
// it. The IC asks a different and much harder question, once per DAY: on this
// day's ~30 names, did a higher score go with higher forward excess?
//
// That gives one number per date instead of one number per window, so the
// finding can be examined for persistence — a score that is inverted every day
// is broken, a score that is inverted in five bad weeks and fine otherwise is
// regime-dependent, and the bucket table cannot tell those apart.
//
// Spearman (rank) rather than Pearson: the score is an ordinal ranking device,
// and excess returns are fat-tailed enough that one 30% outlier would otherwise
// set the correlation on its own.

// Average ranks, so tied scores cannot manufacture an ordering that isn't there.
function ranks(values) {
  var idx = values.map(function (v, i) { return { v: v, i: i }; });
  idx.sort(function (a, b) { return a.v - b.v; });
  var out = new Array(values.length);
  var i = 0;
  while (i < idx.length) {
    var j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    var avg = (i + j) / 2 + 1;                 // 1-based average rank of the tie block
    for (var k = i; k <= j; k++) out[idx[k].i] = avg;
    i = j + 1;
  }
  return out;
}

// Spearman correlation. Returns null when either side has no spread at all —
// a day where every score is identical carries no ranking information, and
// reporting 0 for it would dilute the mean with a non-observation.
function spearman(xs, ys) {
  var n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  var rx = ranks(xs), ry = ranks(ys);
  var mx = mean(rx), my = mean(ry);
  var num = 0, dx = 0, dy = 0;
  for (var i = 0; i < n; i++) {
    var a = rx[i] - mx, b = ry[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx <= 0 || dy <= 0) return null;
  return num / Math.sqrt(dx * dy);
}

function stdev(arr) {
  if (arr.length < 2) return null;
  var m = mean(arr), s = 0;
  for (var i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
  return Math.sqrt(s / (arr.length - 1));      // sample sd
}

// A date needs enough names for a rank correlation to mean anything. The live
// universe is ~30, so this only bites on a thin slice (one regime with few days,
// or an early run before the watchlist filled out).
var MIN_IC_NAMES = 8;

// One IC per date, plus the regime that date was scored in.
function icByDate(entries) {
  var groups = groupBy(entries, function (e) { return e.date; });
  var out = {};
  Object.keys(groups).forEach(function (d) {
    var list = groups[d].filter(function (e) { return e.excessReturn != null && e.score != null; });
    if (list.length < MIN_IC_NAMES) return;
    var ic = spearman(
      list.map(function (e) { return e.score; }),
      list.map(function (e) { return e.excessReturn; })
    );
    if (ic == null) return;
    out[d] = {
      ic: round(ic, 3),
      n: list.length,
      regime: regimeLabel(groups[d][0].marketRegime)
    };
  });
  return out;
}

// Summarise a set of daily ICs. `horizon` is needed for the overlap penalty:
// consecutive dates share almost all of their forward window, so the naive
// t-stat over ~60 dates is measuring roughly 60/horizon independent windows.
// Both are reported — the naive one because it is what a reader would compute,
// the adjusted one because it is the one that is not lying.
function icStats(series, horizon) {
  var vals = series.map(function (s) { return s.ic; });
  if (!vals.length) {
    return { nDates: 0, meanIC: null, medianIC: null, stdIC: null, positiveDayRate: null,
             tStat: null, effectiveNDates: null, tStatOverlapAdj: null };
  }
  var sorted = vals.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(sorted.length / 2);
  var median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  var m = mean(vals), sd = stdev(vals);
  var pos = vals.filter(function (v) { return v > 0; }).length;

  var t = null, tAdj = null, effN = null;
  if (sd != null && sd > 0) {
    t = m / (sd / Math.sqrt(vals.length));
    effN = vals.length / Math.max(1, horizon);
    if (effN >= 2) tAdj = m / (sd / Math.sqrt(effN));
  }
  return {
    nDates: vals.length,
    meanIC: round(m, 3),
    medianIC: round(median, 3),
    stdIC: round(sd, 3),
    positiveDayRate: round((pos / vals.length) * 100, 1),
    tStat: round(t, 2),
    effectiveNDates: round(effN, 1),
    tStatOverlapAdj: round(tAdj, 2)
  };
}

// Plain verdict. Deliberately blunt about direction — an inverted score is a
// finding, not a rounding error — while refusing to call anything significant,
// because with overlapping windows nothing here can be.
function icVerdict(st) {
  if (!st.nDates) return 'not enough scored days to measure ranking skill yet';
  if (st.meanIC == null) return 'no ranking measurement available';
  if (st.meanIC <= -0.03) return 'the score ranks INVERSELY — lower-scored names ran ahead of higher-scored ones';
  if (st.meanIC >= 0.03) return 'the score ranks in the right direction';
  return 'the score carries no usable ranking information — it is close to noise';
}

function informationCoefficient(entries, horizon) {
  var byDate = icByDate(entries);
  var series = Object.keys(byDate).sort().map(function (d) {
    return { date: d, ic: byDate[d].ic, n: byDate[d].n, regime: byDate[d].regime };
  });
  var st = icStats(series, horizon);
  return {
    method: 'Spearman rank correlation of score vs forward benchmark-excess, computed across the universe on each scored date (min ' +
      MIN_IC_NAMES + ' names); summarised across dates. IC +1 = perfect ranking, 0 = none, -1 = perfectly inverted.',
    overlapNote: 'Daily ICs are NOT independent: a ' + horizon + '-bar forward window means consecutive dates share almost all of their outcome. ' +
      'tStatOverlapAdj deflates the sample to ~nDates/horizon independent windows; treat even that as indicative, never as significance.',
    nDates: st.nDates,
    meanIC: st.meanIC,
    medianIC: st.medianIC,
    stdIC: st.stdIC,
    positiveDayRate: st.positiveDayRate,
    tStat: st.tStat,
    effectiveNDates: st.effectiveNDates,
    tStatOverlapAdj: st.tStatOverlapAdj,
    verdict: icVerdict(st),
    series: series
  };
}

// ── regime conditioning ───────────────────────────────────────────────────
//
// computeRegime() in scoring.js is already discrete — SPY and QQQ both above
// their SMA20, one, or neither — so the split needs no arbitrary banding. The
// journal re-scores every past date anyway, so the regime it was scored in is
// free; it was simply being discarded.
//
// The question this answers: is the score's measured inversion a property of
// the score, or of the one tape the sample happens to cover?

var REGIME_LABELS = { 100: 'risk-on', 60: 'mixed', 25: 'risk-off' };
var REGIME_ORDER = ['risk-on', 'mixed', 'risk-off'];
var REGIME_BASIS = {
  'risk-on': 'SPY and QQQ both above SMA20',
  'mixed': 'one of SPY / QQQ above SMA20',
  'risk-off': 'neither SPY nor QQQ above SMA20'
};

function regimeLabel(score) {
  return REGIME_LABELS[score] || 'unknown';
}

// The headline per regime: what the top score band earned minus what the bottom
// band earned. Positive = the score sorted the universe correctly in that tape.
// This is the same comparison the Radar's calibration banner makes, but computed
// inside one regime instead of across all of them at once.
function bandSpread(list) {
  var top = list.filter(function (e) { return scoreBucket(e.score) === '80-100'; });
  var bottom = list.filter(function (e) { return scoreBucket(e.score) === '0-39'; });
  var tx = top.map(function (e) { return e.excessReturn; }).filter(function (v) { return v != null; });
  var bx = bottom.map(function (e) { return e.excessReturn; }).filter(function (v) { return v != null; });
  var tm = tx.length ? mean(tx) : null;
  var bm = bx.length ? mean(bx) : null;
  return {
    topBandN: top.length,
    topBandExcess: round(tm, 2),
    bottomBandN: bottom.length,
    bottomBandExcess: round(bm, 2),
    spread: (tm != null && bm != null) ? round(tm - bm, 2) : null
  };
}

function byRegimeStats(entries, horizon) {
  var groups = groupBy(entries, function (e) { return regimeLabel(e.marketRegime); });
  var allIc = icByDate(entries);
  var out = {};
  REGIME_ORDER.forEach(function (label) {
    var list = groups[label] || [];
    var dates = Object.keys(allIc).filter(function (d) { return allIc[d].regime === label; }).sort();
    var series = dates.map(function (d) { return { date: d, ic: allIc[d].ic, n: allIc[d].n, regime: label }; });
    var st = icStats(series, horizon);
    var bs = bandSpread(list);
    out[label] = Object.assign({
      basis: REGIME_BASIS[label],
      n: list.length,
      dates: dates.length,
      firstDate: dates[0] || null,
      lastDate: dates[dates.length - 1] || null,
      avgExcessReturn: excessStats(list).avgExcessReturn,
      excessWinRate: excessStats(list).excessWinRate,
      meanIC: st.meanIC,
      positiveDayRate: st.positiveDayRate
    }, bs);
  });
  return out;
}

// Does the sample actually contain more than one regime? If it does not, the
// per-regime table is describing one tape and must say so — that is the whole
// reason the split exists.
function regimeCoverage(byRegime) {
  // Coverage is about whether the SAMPLE spans more than one backdrop, so it
  // counts entries — not IC-eligible dates. A regime can hold plenty of signals
  // while no single day clears MIN_IC_NAMES, and calling that "no tape" would
  // wrongly imply the window never saw the regime at all.
  var seen = REGIME_ORDER.filter(function (r) { return byRegime[r] && byRegime[r].n > 0; });
  var measurable = REGIME_ORDER.filter(function (r) { return byRegime[r] && byRegime[r].spread != null; });
  var signs = measurable.map(function (r) { return byRegime[r].spread >= 0; });
  var allSame = signs.length > 1 && signs.every(function (s) { return s === signs[0]; });
  var note;
  if (seen.length <= 1) {
    note = 'The window covers only ' + (seen[0] || 'no') + ' tape, so nothing here can separate a broken score from a regime-dependent one. ' +
      'The split sharpens as the sample spans a different backdrop.';
  } else if (measurable.length <= 1) {
    note = 'Only ' + (measurable[0] || 'one') + ' has both score bands populated, so the bands cannot yet be compared across regimes.';
  } else if (allSame) {
    note = 'The band spread keeps the same sign in every regime measured, so the finding is not explained by the backdrop — it looks like a property of the score.';
  } else {
    note = 'The band spread FLIPS sign between regimes: the score sorts the universe in some tape and not in others. Regime-dependent, not uniformly broken.';
  }
  return { regimesSeen: seen, regimesComparable: measurable, sameSignAcrossRegimes: allSame, note: note };
}

// ── weight calibration (diagnostic only — never auto-applied to scoring) ──
// For one component, the spread = avg forward-excess of the top value-tercile
// minus the bottom value-tercile. Positive => higher component value tends to
// precede higher excess (predictive); ~0 or sign-flipping => no edge.
function tercileSpread(list, comp) {
  var pts = [];
  list.forEach(function (e) {
    if (e.subScores && e.subScores[comp] != null && e.excessReturn != null) {
      pts.push({ v: e.subScores[comp], x: e.excessReturn });
    }
  });
  if (pts.length < 9) return null;
  pts.sort(function (a, b) { return a.v - b.v; });
  var t = Math.floor(pts.length / 3);
  var bottom = pts.slice(0, t).map(function (p) { return p.x; });
  var top = pts.slice(pts.length - t).map(function (p) { return p.x; });
  return round(mean(top) - mean(bottom), 2);
}

// Calibrate component weights against forward excess on a time-split. A component
// only earns a (small, shrunk, capped) weight nudge if its excess-tercile spread
// keeps the same sign in BOTH the older fit window and the recent holdout window
// — i.e. it survives out-of-sample. Otherwise weights are left as-is. This is a
// diagnostic surfaced for human review; scoring weights stay static in config.
function weightCalibration(entries, weights) {
  var comps = ['trend', 'volume', 'relStrength', 'riskQuality', 'regime'];
  var withX = entries.filter(function (e) { return e.excessReturn != null && e.subScores; });
  var dates = [];
  withX.forEach(function (e) { if (dates.indexOf(e.date) === -1) dates.push(e.date); });
  dates.sort();
  if (dates.length < 6) {
    return { method: 'insufficient history for a time-split', components: {}, anyRobust: false,
      currentWeights: weights, suggestedWeights: weights, note: 'Not enough dates to calibrate weights.' };
  }
  var cut = dates[Math.floor(dates.length * 2 / 3)];
  var fit = withX.filter(function (e) { return e.date < cut; });
  var hold = withX.filter(function (e) { return e.date >= cut; });

  var components = {}, current = {}, suggestedRaw = {};
  comps.forEach(function (c) {
    var sf = tercileSpread(fit, c);
    var sh = tercileSpread(hold, c);
    var robust = sf != null && sh != null && (sf > 0) === (sh > 0) &&
      Math.abs(sf) >= 0.3 && Math.abs(sh) >= 0.3;
    components[c] = { spreadFit: sf, spreadHoldout: sh, robust: robust };
    current[c] = weights[c] != null ? weights[c] : 0;
    var delta = 0;
    if (robust) delta = Math.max(-0.03, Math.min(0.03, ((sf + sh) / 2) * 0.01)); // tiny + capped
    suggestedRaw[c] = Math.max(0, current[c] + delta);
  });
  var sum = 0; comps.forEach(function (c) { sum += suggestedRaw[c]; });
  var suggested = {};
  comps.forEach(function (c) { suggested[c] = sum > 0 ? round(suggestedRaw[c] / sum, 3) : current[c]; });
  var anyRobust = comps.some(function (c) { return components[c].robust; });

  return {
    method: 'forward-excess tercile spread, time-split (fit = older 2/3 of dates, holdout = recent 1/3); robust = same sign in both and |spread| >= 0.3pp',
    holdoutFrom: cut,
    components: components,
    currentWeights: current,
    suggestedWeights: suggested,
    anyRobust: anyRobust,
    note: anyRobust
      ? 'Some component survived out-of-sample; a conservative shrunk reweight is suggested — review before applying.'
      : 'No component robustly predicts excess out-of-sample; weights should stay as they are.'
  };
}

function buildJournal(barsByAsset, config, opts) {
  opts = opts || {};
  var jc = config.journal || {};
  var horizon = opts.horizonBars || jc.horizonBars || 20;
  var lookback = opts.lookbackDays || jc.lookbackDays || 60;
  var entryMode = opts.entryMode || jc.entryMode || 'next-session';
  var ambiguousResolution = opts.ambiguousResolution || jc.ambiguousResolution || 'conservative';
  var recentCap = opts.recentCap || jc.recentCap || 120;
  var minBars = opts.minBarsToScore || jc.minBarsToScore || 60;
  var cryptoIds = config.coingeckoIds || {};

  var journalConfig = {
    horizonBars: horizon,
    entryMode: entryMode,
    ambiguousResolution: ambiguousResolution,
    scoringModelMeasured: jc.scoringModelMeasured || 'v1-with-riskReward'
  };

  function bodyFrom(entries, pendingCount, unfillable, thinCount) {
    unfillable = unfillable || { total: 0, belowStop: 0, aboveTarget: 0, byStatus: {} };
    thinCount = thinCount || 0;
    var byStatus = {};
    ['confirmed', 'forming', 'invalidated'].forEach(function (st) {
      var list = entries.filter(function (e) { return e.status === st; });
      byStatus[st] = list.length ? groupStats(list) : emptyGroup();
    });
    var byScoreBucket = {};
    ['80-100', '60-79', '40-59', '0-39'].forEach(function (bk) {
      var list = entries.filter(function (e) { return scoreBucket(e.score) === bk; });
      byScoreBucket[bk] = list.length ? groupStats(list) : emptyGroup();
    });
    var themeGroups = groupBy(entries, function (e) { return e.theme; });
    var byTheme = {}, themeCounts = {};
    Object.keys(themeGroups).forEach(function (t) { byTheme[t] = excessStats(themeGroups[t]); themeCounts[t] = themeGroups[t].length; });
    var assetGroups = groupBy(entries, function (e) { return e.symbol; });
    var byAsset = {}, assetCounts = {};
    Object.keys(assetGroups).forEach(function (a) { byAsset[a] = excessStats(assetGroups[a]); assetCounts[a] = assetGroups[a].length; });
    var dateGroups = groupBy(entries, function (e) { return e.date; });
    var byDate = {};
    Object.keys(dateGroups).forEach(function (d) {
      var list = dateGroups[d];
      var ex = list.map(function (e) { return e.excessReturn; }).filter(function (v) { return v != null; });
      byDate[d] = { n: list.length, avgExcessReturn: round(mean(ex), 2) };
    });

    var uniqueDates = Object.keys(dateGroups).length;

    // How wide the measured universe actually was, date by date. It is NOT
    // constant: crypto stops at CoinGecko's 365-day free cap while equities run
    // years, so older dates are equities-only. An IC computed across 27 names is
    // a different measurement from one across 30, and a reader comparing dates
    // needs to see that rather than assume it away.
    var sortedDates = Object.keys(universeByDate).sort();
    var sizes = sortedDates.map(function (d) { return universeByDate[d]; }).sort(function (a, b) { return a - b; });
    var med = sizes.length ? (sizes.length % 2 ? sizes[(sizes.length - 1) / 2]
      : (sizes[sizes.length / 2 - 1] + sizes[sizes.length / 2]) / 2) : null;
    var coverage = {
      firstDate: sortedDates[0] || null,
      lastDate: sortedDates[sortedDates.length - 1] || null,
      // Dates actually scored, vs dates that produced a measurable outcome —
      // they differ once pending/unfillable exclusions bite, and conflating them
      // would overstate the sample.
      emitDates: sortedDates.length,
      datesWithOutcomes: uniqueDates,
      minBarsToScore: minBars,
      thinAssetDatesSkipped: thinCount,
      universePerDate: { min: sizes[0] == null ? null : sizes[0], median: med,
                         max: sizes.length ? sizes[sizes.length - 1] : null },
      // The honest denominator for anything claimed about significance.
      effectiveWindows: round(uniqueDates / Math.max(1, horizon), 1)
    };

    var ic = informationCoefficient(entries, horizon);
    var byRegime = byRegimeStats(entries, horizon);
    var regimeCov = regimeCoverage(byRegime);

    var caveats = [
      'Universe still tilts toward correlated AI / risk-on names; non-overlapping counts overstate independence. Treat headline stats as indicative, not statistically significant.'
    ];
    // Survivorship / selection bias scales with the length of the window, so it
    // has to be stated loudest exactly when the sample looks most impressive.
    // The watchlist was chosen in the present; re-running it through years of
    // past bars asks how names we already know worked out would have scored,
    // which is not the question the score has to answer live.
    if (coverage.emitDates > 300) {
      caveats.push('SELECTION BIAS, and it grows with this window: the watchlist is the CURRENT set of ~30 names, ' +
        'chosen knowing how they turned out, then re-scored back to ' + coverage.firstDate + '. Names that were ' +
        'dropped or never added cannot appear, so a positive result here partly measures the watchlist rather than ' +
        'the score. This matters more over ' + coverage.emitDates + ' dates than it did over 60 — treat the ' +
        'DIRECTION and the monotonicity across bands as the signal, not the magnitude.');
    }
    if (entries.some(function (e) { return e.resolution === 'close-only'; })) {
      caveats.push('Crypto outcomes resolved on close only (no intrabar high/low).');
    }
    if (unfillable.total) {
      caveats.push(unfillable.total + ' signal(s) were dropped as unfillable — their published stop/target no longer bracketed the next-session fill, ' +
        'so no entry was possible (' + unfillable.belowStop + ' already through the stop, ' + unfillable.aboveTarget + ' already past the target). ' +
        'Counted, never scored: resolving these at the stop booked a gain on a position nobody could have held, which is what previously made the ' +
        'invalidated bucket and the 0-39 score band look like the strongest performers.');
    }
    if (coverage.universePerDate.min != null &&
        coverage.universePerDate.min !== coverage.universePerDate.max) {
      caveats.push('The measured universe is not constant across dates (' + coverage.universePerDate.min +
        '-' + coverage.universePerDate.max + ' names, median ' + coverage.universePerDate.median +
        '). Crypto history stops at CoinGecko\'s free 365-day cap while equities run years, so the oldest ' +
        'dates are equities-only' + (thinCount ? ' (' + thinCount + ' asset-dates skipped for insufficient warm-up)' : '') + '.');
    }
    caveats.push(ic.overlapNote);
    caveats.push(regimeCov.note);

    var recentOutcomes = entries.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);
    }).slice(0, recentCap).map(function (e) {
      return {
        date: e.date, symbol: e.symbol, theme: e.theme, status: e.status, score: e.score,
        entryBasis: e.entryBasis, publishedEntry: e.publishedEntry, fill: e.fill,
        exit: e.exit, exitReason: e.exitReason, ambiguous: e.ambiguous, resolution: e.resolution,
        forwardReturn: e.forwardReturn, benchmark: e.benchmark,
        benchmarkReturn: e.benchmarkReturn, excessReturn: e.excessReturn
      };
    });

    return {
      journalConfig: journalConfig,
      counts: {
        raw: entries.length,
        nonOverlapping: nonOverlappingCount(entries, horizon),
        uniqueDates: uniqueDates,
        pending: pendingCount,
        unfillable: unfillable.total,
        unfillableBelowStop: unfillable.belowStop,
        unfillableAboveTarget: unfillable.aboveTarget,
        unfillableByStatus: unfillable.byStatus,
        byTheme: themeCounts,
        byAsset: assetCounts
      },
      caveats: caveats,
      byStatus: byStatus,
      byScoreBucket: byScoreBucket,
      byTheme: byTheme,
      byAsset: byAsset,
      byDate: byDate,
      informationCoefficient: ic,
      byRegime: byRegime,
      regimeCoverage: regimeCov,
      coverage: coverage,
      weightCalibration: weightCalibration(entries, config.weights || {}),
      recentOutcomes: recentOutcomes
    };
  }

  var calendar = (barsByAsset.SPY || []).map(function (b) { return b.date; });
  if (!calendar.length) return bodyFrom([], 0);

  // Emit dates: the lookback window, excluding the most recent day (no t+1 fill).
  // The floor at `minBars` skips the warm-up stretch outright — scoring a date
  // on a dozen bars produces a quietly degraded score, and measuring that as if
  // it were the shipped model is worse than not measuring it.
  var start = Math.max(minBars, calendar.length - 1 - lookback);
  var emitDates = calendar.slice(start, calendar.length - 1);

  var entries = [];
  var pendingCount = 0;
  var thinCount = 0;             // asset-dates skipped for insufficient warm-up
  var universeByDate = {};       // date -> assets with enough history to score
  var unfillable = { total: 0, belowStop: 0, aboveTarget: 0, byStatus: {} };

  emitDates.forEach(function (D) {
    var sliced = {};
    Object.keys(barsByAsset).forEach(function (sym) {
      sliced[sym] = barsByAsset[sym].filter(function (b) { return b.date <= D; });
    });
    var res = scoreUniverse(sliced, config);
    // The market backdrop this date was scored in. scoreUniverse already
    // computes it; the journal used to throw it away, which is why nothing
    // downstream could ask whether a finding was regime-dependent.
    var marketRegime = (res.regime && res.regime.score != null) ? res.regime.score : null;

    res.signals.forEach(function (s) {
      var sym = s.symbol;
      var bars = barsByAsset[sym] || [];
      var idxD = idxOfDate(bars, D);
      if (idxD < 0) return;
      // Per-asset warm-up. An asset with a shorter history than the calendar —
      // crypto, capped at CoinGecko's free 365 days while equities run years —
      // simply is not scored on dates before it has enough bars, rather than
      // being scored badly. idxD + 1 = bars available up to and including D.
      if (idxD + 1 < minBars) { thinCount++; return; }
      // Universe = what the screen could actually score that day. Counted here,
      // BEFORE the pending/unfillable exclusions, so it measures history
      // availability rather than how many signals happened to be measurable.
      universeByDate[D] = (universeByDate[D] || 0) + 1;
      var isCrypto = !!cryptoIds[sym];

      // Next-session fill: a brief reader cannot transact at the scored close.
      var idxFill = idxD + 1;
      if (idxFill >= bars.length) { pendingCount++; return; }   // no t+1 yet -> pending, excluded
      var fillBar = bars[idxFill];
      var fill = isCrypto ? fillBar.close : fillBar.open;
      if (fill == null) { pendingCount++; return; }
      var entryBasis = isCrypto ? 'next-close' : 'next-open';

      // Resolve over the horizon, starting at the fill bar. Use the PUBLISHED
      // stop/target (the levels the card showed) — not recomputed off the fill.
      var windowBars = bars.slice(idxFill, idxFill + horizon);
      var fullWindow = (idxFill + horizon) <= bars.length;
      var oc = resolveOutcome(s.stop, s.target, windowBars, isCrypto, fullWindow, fill);

      // A setup whose published levels no longer bracket the fill was never
      // takeable. Excluded from every statistic — but COUNTED, because "the
      // screen produced N ideas that were already broken at the open" is itself
      // a finding about the radar. Same treatment as `pending`.
      if (oc.exitReason === 'unfillable') {
        unfillable.total++;
        unfillable[oc.unfillable === 'above-target' ? 'aboveTarget' : 'belowStop']++;
        unfillable.byStatus[s.status] = (unfillable.byStatus[s.status] || 0) + 1;
        return;
      }

      var forwardReturn = oc.exit != null ? round((oc.exit / fill - 1) * 100, 2) : null;

      // Benchmark-excess over the same window (fill date -> exit/window-end date).
      var benchBars = barsByAsset[s.benchmark] || [];
      var exitDate = oc.exitDate || (windowBars.length ? windowBars[windowBars.length - 1].date : fillBar.date);
      var bFill = closeOnOrBefore(benchBars, fillBar.date);
      var bExit = closeOnOrBefore(benchBars, exitDate);
      var benchmarkReturn = (bFill && bExit) ? round((bExit / bFill - 1) * 100, 2) : null;
      var excessReturn = (forwardReturn != null && benchmarkReturn != null) ? round(forwardReturn - benchmarkReturn, 2) : null;

      entries.push({
        date: D, symbol: sym, theme: s.theme, status: s.status, score: s.score, idx: idxD,
        subScores: s.subScores,
        // marketRegime = global SPY/QQQ backdrop (100/60/25) for this date;
        // themeRegime = the signal's own theme breadth, which drove its status
        // gate. Both are captured at score time, so neither can look ahead.
        marketRegime: marketRegime,
        themeRegime: s.regimeScore == null ? null : s.regimeScore,
        entryBasis: entryBasis, publishedEntry: s.entry, fill: round(fill, 2),
        exit: oc.exit != null ? round(oc.exit, 2) : null, exitReason: oc.exitReason,
        ambiguous: oc.ambiguous, resolution: oc.resolution,
        forwardReturn: forwardReturn, benchmark: s.benchmark,
        benchmarkReturn: benchmarkReturn, excessReturn: excessReturn
      });
    });
  });

  return bodyFrom(entries, pendingCount, unfillable, thinCount);
}

export {
  buildJournal, resolveOutcome, scoreBucket, weightCalibration,
  // exported for offline tests
  ranks, spearman, informationCoefficient, byRegimeStats, regimeCoverage, regimeLabel, bandSpread
};
