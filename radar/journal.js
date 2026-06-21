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
function resolveOutcome(stop, target, windowBars, isCrypto, fullWindow) {
  var resolution = isCrypto ? 'close-only' : 'ohlc';
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

function buildJournal(barsByAsset, config, opts) {
  opts = opts || {};
  var jc = config.journal || {};
  var horizon = opts.horizonBars || jc.horizonBars || 20;
  var lookback = opts.lookbackDays || jc.lookbackDays || 60;
  var entryMode = opts.entryMode || jc.entryMode || 'next-session';
  var ambiguousResolution = opts.ambiguousResolution || jc.ambiguousResolution || 'conservative';
  var recentCap = opts.recentCap || jc.recentCap || 120;
  var cryptoIds = config.coingeckoIds || {};

  var journalConfig = {
    horizonBars: horizon,
    entryMode: entryMode,
    ambiguousResolution: ambiguousResolution,
    scoringModelMeasured: jc.scoringModelMeasured || 'v1-with-riskReward'
  };

  function bodyFrom(entries, pendingCount) {
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
    var caveats = [
      'Universe still tilts toward correlated AI / risk-on names; non-overlapping counts overstate independence. Treat headline stats as indicative, not statistically significant.'
    ];
    if (entries.some(function (e) { return e.resolution === 'close-only'; })) {
      caveats.push('Crypto outcomes resolved on close only (no intrabar high/low).');
    }

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
        byTheme: themeCounts,
        byAsset: assetCounts
      },
      caveats: caveats,
      byStatus: byStatus,
      byScoreBucket: byScoreBucket,
      byTheme: byTheme,
      byAsset: byAsset,
      byDate: byDate,
      recentOutcomes: recentOutcomes
    };
  }

  var calendar = (barsByAsset.SPY || []).map(function (b) { return b.date; });
  if (!calendar.length) return bodyFrom([], 0);

  // Emit dates: the lookback window, excluding the most recent day (no t+1 fill).
  var start = Math.max(0, calendar.length - 1 - lookback);
  var emitDates = calendar.slice(start, calendar.length - 1);

  var entries = [];
  var pendingCount = 0;

  emitDates.forEach(function (D) {
    var sliced = {};
    Object.keys(barsByAsset).forEach(function (sym) {
      sliced[sym] = barsByAsset[sym].filter(function (b) { return b.date <= D; });
    });
    var res = scoreUniverse(sliced, config);

    res.signals.forEach(function (s) {
      var sym = s.symbol;
      var bars = barsByAsset[sym] || [];
      var idxD = idxOfDate(bars, D);
      if (idxD < 0) return;
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
      var oc = resolveOutcome(s.stop, s.target, windowBars, isCrypto, fullWindow);
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
        entryBasis: entryBasis, publishedEntry: s.entry, fill: round(fill, 2),
        exit: oc.exit != null ? round(oc.exit, 2) : null, exitReason: oc.exitReason,
        ambiguous: oc.ambiguous, resolution: oc.resolution,
        forwardReturn: forwardReturn, benchmark: s.benchmark,
        benchmarkReturn: benchmarkReturn, excessReturn: excessReturn
      });
    });
  });

  return bodyFrom(entries, pendingCount);
}

export { buildJournal, resolveOutcome, scoreBucket };
