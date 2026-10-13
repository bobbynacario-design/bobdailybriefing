// radar/ph-snapshot.js
//
// Builds the Philippine-market snapshot written to briefings-bob/radar-ph:
//   - the PSEi index read. Yahoo PSEI.PS stopped returning history around
//     17 Sep 2026 (it sends only the latest bar), so the doc keeps its own daily
//     closes (indexHistory) and the averages fill in as days accumulate;
//   - one row per PSEi stock from PSE Edge, in pesos (pse-edge.js), and the
//     breadth of those stocks (ph-metrics.js);
//   - the USD/PHP and AUD/PHP rates.
// A market-health read: not scored, not advice.
//
// Written by radar/refresh-ph.js after the PSE close (GitHub Actions 16:30 PHT).
// Nothing here is fatal on its own: a run fails only when neither the PSEi nor
// any PSE Edge stock came back.
//
//   buildPhSnapshot(config, previousDoc, barSink) -> { asOf, index, indexHistory, fx, board, breadth, ... }
//   barSink (optional {}) receives each stock's raw bars by symbol, for the PSE
//   radar; the doc itself keeps only the computed figures.

import { r2, dayPct, retN, mergeHistory, finishedBars, completedSnapshotDate, indexMetrics, stockMetrics, buildBreadth } from './ph-metrics.js';
import { fetchEdgeStock } from './pse-edge.js';

// fetch with retry + backoff (this box's network intermittently ECONNRESETs).
async function fetchRetry(url, opts, label) {
  var lastErr;
  for (var i = 0; i < 4; i++) {
    try { return await fetch(url, opts); }
    catch (e) {
      lastErr = e;
      console.log('  ' + (label || 'fetch') + ' transient (' + ((e && e.cause && e.cause.code) || e.message) + '), retry ' + (i + 1) + '/3');
      await new Promise(function (r) { setTimeout(r, 1200 * (i + 1)); });
    }
  }
  throw lastErr;
}

// Daily bars for a Yahoo symbol. range defaults to 1y so SMA200 / 52-week / YTD
// are well-defined for the index.
async function fetchYahooChart(symbol, range) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(symbol) + '?interval=1d&range=' + (range || '1y');
  var res = await fetchRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 'Yahoo ' + symbol);
  if (!res.ok) throw new Error('Yahoo ' + symbol + ' HTTP ' + res.status);
  var j = await res.json();
  var r = j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp) return [];
  var ts = r.timestamp;
  var q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  var ccy = r.meta && r.meta.currency;
  var bars = [];
  for (var i = 0; i < ts.length; i++) {
    if (!q.close || q.close[i] == null) continue;
    bars.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: q.close[i], currency: ccy });
  }
  return bars;
}

// Manila minutes since midnight, for finishedBars().
function phtMinutes() {
  var p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  return Number(p.slice(0, 2)) % 24 * 60 + Number(p.slice(3, 5));
}

function phtToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function buildPhSnapshot(config, prev, barSink) {
  var ph = config.ph;
  prev = prev || {};
  console.log('Fetching PH snapshot (PSEi from Yahoo, ' + ph.board.stocks.length + ' PSEi stocks from PSE Edge, FX)...');

  var idxBars = [];
  try { idxBars = await fetchYahooChart(ph.index.symbol, '1y'); }
  catch (e) { console.log('  PSEi (Yahoo) skipped: ' + (e.message || e)); }
  // Finished sessions only, in the stored history too (a partial bar stored by
  // an earlier daytime run is dropped until the real close replaces it).
  var today = phtToday(), mins = phtMinutes();
  var indexHistory = finishedBars(mergeHistory(prev.indexHistory, finishedBars(idxBars, today, mins), 400), today, mins);
  var index = indexHistory.length ? indexMetrics(indexHistory) : null;

  // FX context — peso strength matters for a PHP/AUD BI consultant. USDPHP has
  // good history; AUDPHP is sparse on Yahoo (level only, caveated).
  var fx = {};
  try {
    var usd = await fetchYahooChart('USDPHP=X', '3mo');
    if (usd.length) {
      var uc = usd.map(function (b) { return b.close; });
      fx.usdphp = { level: r2(usd[usd.length - 1].close), dayChangePct: r2(dayPct(usd)), ret1m: r2(retN(uc, 21)) };
    }
  } catch (e) { console.log('  FX USDPHP skipped: ' + (e.message || e)); }
  try {
    var aud = await fetchYahooChart('AUDPHP=X', '5d');
    if (aud.length) fx.audphp = { level: r2(aud[aud.length - 1].close) };
  } catch (e) { console.log('  FX AUDPHP skipped: ' + (e.message || e)); }

  // PSEi stocks from PSE Edge. Company and security ids are reused from the
  // last doc, so a normal run is two requests per stock.
  var known = {};
  (prev.board || []).forEach(function (s) { if (s && s.symbol) known[s.symbol] = s; });
  var board = [], failed = [];
  for (var i = 0; i < ph.board.stocks.length; i++) {
    var item = ph.board.stocks[i];
    try {
      var got = await fetchEdgeStock(item.symbol, known[item.symbol], today, 400);
      got.bars = finishedBars(got.bars, today, mins);
      if (barSink) barSink[item.symbol] = got.bars;
      var metrics = stockMetrics(got.bars);
      if (!metrics) throw new Error('no daily bars');
      board.push(Object.assign({
        symbol: item.symbol, name: item.name, cmpyId: got.cmpyId, securityId: got.securityId,
        marketCap: got.page.marketCap,
        // PSE Edge's own figures, to check the computed ones against
        edge: { lastPrice: got.page.lastPrice, high52: got.page.high52, low52: got.page.low52 }
      }, metrics));
    } catch (e) {
      failed.push(item.symbol);
      console.log('  PSE Edge ' + item.symbol + ' skipped: ' + (e.message || e));
    }
  }
  board.sort(function (a, b) { return (b.marketCap || 0) - (a.marketCap || 0); });
  var breadth = buildBreadth(board);
  if (!index && !board.length) throw new Error('no PSEi data and no PSE Edge prices');

  var dates = [index && index.asOf, breadth.asOf].filter(Boolean).sort();
  return {
    asOf: dates[dates.length - 1],
    index: index,
    indexHistory: indexHistory,
    fx: fx,
    board: board,
    boardFailed: failed,
    boardList: ph.board.source,
    breadth: breadth,
    caveat: 'A market-health read, not advice. Stock prices are end-of-day from PSE Edge, the exchange’s own site, checked after the 15:30 close. ' +
      'PSEi averages and returns come from Daybook’s own record of daily closes, so they appear once enough days are stored.'
  };
}

// Write the PH snapshot to briefings-bob/radar-ph, but NEVER regress the date:
// skip the write if a stored snapshot already has a strictly NEWER asOf. Yahoo's
// PSEI.PS feed is flaky and intermittently drops its latest bars, so the pre-open
// 06:00 run can otherwise clobber a good after-close close with a stale older one
// (exactly how the tab got stuck on an old date). asOf is YYYY-MM-DD, so a string
// compare is a date compare. Same-date writes are allowed (values can be revised).
async function writePhSnapshot(db, coll, phDoc) {
  var ref = db.collection(coll).doc('radar-ph');
  var snap = await ref.get();
  var prev = snap.exists ? completedSnapshotDate(snap.data()) : null;
  if (prev && phDoc.asOf && String(phDoc.asOf) < String(prev)) {
    console.log('radar-ph NOT written: new asOf ' + phDoc.asOf + ' is older than stored ' + prev + ' — kept the fresher snapshot.');
    return false;
  }
  await ref.set(phDoc);
  return true;
}

async function loadPhSnapshot(db, coll) {
  var snap = await db.collection(coll).doc('radar-ph').get();
  return snap.exists ? (snap.data() || null) : null;
}

export { buildPhSnapshot, fetchYahooChart, writePhSnapshot, loadPhSnapshot, phtToday };
