// lib/decision-drift.js
//
// PURE — no I/O, no imports. computeDrift(decisions, signalsBySymbol) returns
// the open calls whose setup no longer reads the way it did when they were
// logged. refresh-radar.js does the reading and writing around it.
//
// WHY: the Decisions tab already flags thesis drift, but only when Bob opens
// that tab. The 06:00 refresh knows every open call and every current signal,
// so the same finding can be computed once a day and put in front of him on the
// Today page he already reads — the useful part of a notification without any
// push infrastructure.
//
// The trigger rules are deliberately IDENTICAL to the front end's drift callout
// (index.html decisionLive/decisionLiveHtml): setup weakened, or price below the
// radar's stop. If these two ever diverge the same position would be flagged on
// one surface and not the other, which is worse than not flagging it at all.
//
// Nothing here generates advice. Each item states what changed and quotes the
// radar's own invalidation line.

var STATUS_RANK = { invalidated: 0, forming: 1, confirmed: 2 };

function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
function round(v, dp) {
  if (v == null) return null;
  var f = Math.pow(10, dp == null ? 2 : dp);
  return Math.round(v * f) / f;
}

// A call is in scope if it is still open and Bob actually has a view on it.
// 'skipped' is excluded: he decided not to act, so the setup changing is not
// something he needs to do anything about.
function isTracked(d) {
  var status = d.status || 'open';
  var action = d.action || 'watched';
  return status !== 'closed' && action !== 'skipped';
}

// decisions        — array of journal-bob entries
// signalsBySymbol  — { SYMBOL: signal } from today's radar
function computeDrift(decisions, signalsBySymbol) {
  var items = [];
  (decisions || []).forEach(function (d) {
    if (!isTracked(d)) return;
    var sym = String(d.asset || '').toUpperCase();
    var now = signalsBySymbol[sym];
    if (!now) return; // outside the radar universe — nothing to compare against

    var link = d.linkedSignal || {};
    var statusThen = link.status || '';
    var statusNow = now.status || '';
    var rThen = STATUS_RANK[statusThen], rNow = STATUS_RANK[statusNow];
    var weakened = (rThen != null && rNow != null && rNow < rThen);

    var close = num(now.close);
    var stop = num(now.stop);
    var belowStop = (close != null && stop != null && close < stop);

    if (!weakened && !belowStop) return;

    var reasons = [];
    if (weakened) reasons.push('setup weakened from ' + statusThen + ' to ' + statusNow);
    if (belowStop) reasons.push('trading below the radar stop of ' + stop);

    // Reference price for context only — never a trigger, so a call with no
    // usable reference still gets flagged on the structural reasons above.
    var ref = num(d.entryPrice) != null ? num(d.entryPrice) : num(link.close);
    var dir = d.direction === 'short' ? -1 : (d.direction === 'long' ? 1 : 0);
    var movePct = (ref && close != null) ? round((close - ref) / ref * 100 * (dir === -1 ? -1 : 1), 1) : null;

    items.push({
      id: d.id || '',
      asset: sym,
      direction: d.direction || 'none',
      action: d.action || 'watched',
      createdDate: d.createdDate || '',
      reasons: reasons,
      weakened: weakened,
      belowStop: belowStop,
      statusThen: statusThen,
      statusNow: statusNow,
      scoreThen: link.score == null ? null : link.score,
      scoreNow: now.score == null ? null : now.score,
      close: close,
      stop: stop,
      movePct: movePct,
      // The radar's own words, so the digest never invents a recommendation.
      invalidation: now.invalidation || ''
    });
  });

  // Worst first: both reasons, then a broken stop, then the bigger score drop.
  items.sort(function (a, b) {
    var an = (a.weakened ? 1 : 0) + (a.belowStop ? 1 : 0);
    var bn = (b.weakened ? 1 : 0) + (b.belowStop ? 1 : 0);
    if (an !== bn) return bn - an;
    if (a.belowStop !== b.belowStop) return a.belowStop ? -1 : 1;
    var ad = (a.scoreThen != null && a.scoreNow != null) ? a.scoreThen - a.scoreNow : -1;
    var bd = (b.scoreThen != null && b.scoreNow != null) ? b.scoreThen - b.scoreNow : -1;
    return bd - ad;
  });

  return items;
}

// Group tracked decisions by owner so each uid gets its own private digest.
function groupByUid(decisions) {
  var out = {};
  (decisions || []).forEach(function (d) {
    var uid = d.uid;
    if (!uid) return; // an unowned decision has nobody to notify
    if (!out[uid]) out[uid] = [];
    out[uid].push(d);
  });
  return out;
}

export { computeDrift, groupByUid, isTracked };
