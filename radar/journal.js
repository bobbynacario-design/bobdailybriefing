// radar/journal.js
//
// PURE performance-tracking module for the Market Radar (V3). No I/O.
//
// Because scoreUniverse() is deterministic, the journal is a pure function of
// the price bars: re-score each past day point-in-time (bars sliced to that
// date), then measure what the asset actually did afterwards. This is the
// feedback loop for tuning the V1 heuristics — it does NOT change scoring.
//
//   buildJournal(barsByAsset, config, opts) -> { lookbackDays, horizonDays,
//                                                entries, stats }

import { scoreUniverse } from './scoring.js';

// Score buckets for the "does a higher score actually do better?" question.
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

// Walk forward bars (strictly after the emit date, ascending) and decide the
// outcome of a signal: did price reach the target or the stop first?
//   target -> hit target before stop (a win)
//   stop   -> hit stop first (a loss)
//   expired-> neither within the horizon, but the full horizon elapsed
//   open   -> neither yet, and fewer than `horizon` bars exist (still tracking)
// Equity bars carry real high/low; crypto bars use close for both (proxy).
function evaluateOutcome(signal, forwardBars, horizon) {
  var entry = signal.entry;
  var stop = signal.stop;
  var target = signal.target;
  var n = Math.min(forwardBars.length, horizon);

  for (var i = 0; i < n; i++) {
    var b = forwardBars[i];
    var hitStop = (stop != null) && (b.low <= stop);
    var hitTarget = (target != null) && (b.high >= target);
    // Same-bar ambiguity resolves conservatively to the stop.
    if (hitStop) {
      return { outcome: 'stop', exitDate: b.date, barsHeld: i + 1,
        forwardReturnPct: round((stop / entry - 1) * 100, 2) };
    }
    if (hitTarget) {
      return { outcome: 'target', exitDate: b.date, barsHeld: i + 1,
        forwardReturnPct: round((target / entry - 1) * 100, 2) };
    }
  }

  // No level hit within the window.
  var lastClose = forwardBars.length ? forwardBars[Math.min(n, forwardBars.length) - 1].close : null;
  var mtm = lastClose != null ? round((lastClose / entry - 1) * 100, 2) : null;
  if (forwardBars.length >= horizon) {
    return { outcome: 'expired', exitDate: forwardBars[horizon - 1].date, barsHeld: horizon, forwardReturnPct: mtm };
  }
  return { outcome: 'open', exitDate: null, barsHeld: forwardBars.length, forwardReturnPct: mtm };
}

// Aggregate a flat list of evaluated entries into win-rate / avg-return groups.
// "decided" = target|stop (used for win rate); "closed" = target|stop|expired
// (used for avg return); "open" entries are still tracking.
function summarize(entries) {
  var wins = 0, losses = 0, expired = 0, open = 0;
  var closedReturns = [];
  entries.forEach(function (e) {
    if (e.outcome === 'target') { wins++; }
    else if (e.outcome === 'stop') { losses++; }
    else if (e.outcome === 'expired') { expired++; }
    else { open++; }
    if (e.outcome !== 'open' && e.forwardReturnPct != null) closedReturns.push(e.forwardReturnPct);
  });
  var decided = wins + losses;
  return {
    n: entries.length,
    closed: wins + losses + expired,
    open: open,
    wins: wins,
    losses: losses,
    expired: expired,
    winRate: decided ? round((wins / decided) * 100, 1) : null,
    avgReturn: round(mean(closedReturns), 2)
  };
}

function aggregateStats(entries) {
  var byStatus = {};
  ['confirmed', 'forming', 'invalidated'].forEach(function (st) {
    byStatus[st] = summarize(entries.filter(function (e) { return e.status === st; }));
  });
  var byScore = {};
  ['80-100', '60-79', '40-59', '0-39'].forEach(function (bk) {
    byScore[bk] = summarize(entries.filter(function (e) { return scoreBucket(e.score) === bk; }));
  });
  return { overall: summarize(entries), byStatus: byStatus, byScore: byScore };
}

// Build the full journal from bars. Uses SPY's trading days as the master
// calendar so every asset is sliced to the same emit date.
function buildJournal(barsByAsset, config, opts) {
  var lookbackDays = (opts && opts.lookbackDays) || 60;
  var horizonDays = (opts && opts.horizonDays) || 20;

  var calendar = (barsByAsset.SPY || []).map(function (b) { return b.date; });
  if (!calendar.length) return { lookbackDays: lookbackDays, horizonDays: horizonDays, entries: [], stats: aggregateStats([]) };

  // Emit dates: the lookback window, EXCLUDING the most recent day (it has no
  // forward bars yet — it is just today's live signals, tracked from here on).
  var start = Math.max(0, calendar.length - 1 - lookbackDays);
  var emitDates = calendar.slice(start, calendar.length - 1);

  var entries = [];
  emitDates.forEach(function (D) {
    var sliced = {};
    Object.keys(barsByAsset).forEach(function (sym) {
      sliced[sym] = barsByAsset[sym].filter(function (b) { return b.date <= D; });
    });
    var res = scoreUniverse(sliced, config);
    res.signals.forEach(function (s) {
      var full = barsByAsset[s.symbol] || [];
      var forward = full.filter(function (b) { return b.date > D; }).slice(0, horizonDays);
      var oc = evaluateOutcome(s, forward, horizonDays);
      entries.push({
        symbol: s.symbol, theme: s.theme, emitDate: D,
        status: s.status, score: s.score,
        entry: s.entry, stop: s.stop, target: s.target,
        outcome: oc.outcome, exitDate: oc.exitDate,
        barsHeld: oc.barsHeld, forwardReturnPct: oc.forwardReturnPct
      });
    });
  });

  return {
    lookbackDays: lookbackDays,
    horizonDays: horizonDays,
    entries: entries,
    stats: aggregateStats(entries)
  };
}

export { buildJournal, evaluateOutcome, aggregateStats, scoreBucket };
