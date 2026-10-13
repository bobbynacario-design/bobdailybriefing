// radar/pse-watch.js
//
// PSE watchlists: briefings-bob/pse-watch-<uid>, one per person. The app writes
// `items` ({SYMBOL: {addedAt, target}}, target = an optional buy-below price);
// this job, after the close, adds for each list:
//   rows       the stocks it watches that are NOT among the 30 PSEi stocks
//              (those already sit on radar-ph), fetched from PSE Edge
//   missing    codes PSE Edge does not know
//   alerts     watchAlerts() for the session (ph-metrics.js), read by the
//              morning push
//   alertsAsOf the session the alerts are for
// It writes with update(), which replaces those fields whole and leaves the
// person's `items` and `uid` alone.
//
// The repo is public and so are its Actions logs: log counts only, never a
// watched code, a target price or an alert's text.

import { stockMetrics, watchAlerts } from './ph-metrics.js';
import { fetchEdgeStock } from './pse-edge.js';

var SYMBOL = /^[A-Z0-9]{1,8}$/;
var MAX_ITEMS = 30;

// The codes a list watches: valid PSE-style codes only, at most 30.
function watchSymbols(doc) {
  return Object.keys((doc && doc.items) || {}).filter(function (s) { return SYMBOL.test(s); }).sort().slice(0, MAX_ITEMS);
}

async function refreshWatchlists(db, coll, ph, today, opts) {
  opts = opts || {};
  var fetchStock = opts.fetchStock || fetchEdgeStock;
  var snap = await db.collection(coll).where('kind', '==', 'pse-watch').get();
  var docs = snap.docs.filter(function (d) { return d.data() && d.data().uid; });
  var board = {};
  (ph.board || []).forEach(function (s) { board[s.symbol] = s; });

  // Every code any list watches that the board doesn't carry, fetched once.
  var known = {}, extra = {};
  docs.forEach(function (d) {
    var data = d.data();
    Object.keys(data.rows || {}).forEach(function (k) { known[k] = data.rows[k]; });
    watchSymbols(data).forEach(function (s) { if (!board[s]) extra[s] = true; });
  });
  var fetched = {}, missing = {};
  var codes = Object.keys(extra).sort();
  for (var i = 0; i < codes.length; i++) {
    var sym = codes[i];
    try {
      var got = await fetchStock(sym, known[sym], today, 400);
      var m = stockMetrics(got.bars);
      if (!m) throw new Error('no daily bars');
      fetched[sym] = Object.assign({ symbol: sym, name: got.name, cmpyId: got.cmpyId, securityId: got.securityId, marketCap: got.page.marketCap }, m);
    } catch (e) {
      missing[sym] = e.message || String(e);
    }
  }

  var asOf = ph.breadth && ph.breadth.asOf;
  var summary = { lists: docs.length, extra: codes.length, fetched: Object.keys(fetched).length, missing: Object.keys(missing).length, alerts: 0 };
  for (var j = 0; j < docs.length; j++) {
    var data = docs[j].data(), syms = watchSymbols(data);
    var rows = {}, gone = [];
    syms.forEach(function (s) {
      if (board[s]) return;
      if (fetched[s]) rows[s] = fetched[s]; else gone.push(s);
    });
    var items = {};
    syms.forEach(function (s) { items[s] = data.items[s] || {}; });
    var alerts = watchAlerts(items, Object.assign({}, board, rows), asOf);
    summary.alerts += alerts.length;
    if (opts.dryRun && opts.verbose) console.log('  [local] ' + syms.length + ' stocks: ' + (alerts.map(function (a) { return a.text; }).join('; ') || 'no alerts'));
    if (!opts.dryRun) {
      await docs[j].ref.update({ rows: rows, missing: gone, alerts: alerts, alertsAsOf: asOf || null, rowsAt: new Date().toISOString() });
    }
  }
  return summary;
}

export { refreshWatchlists, watchSymbols };
