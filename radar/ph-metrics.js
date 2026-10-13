// radar/ph-metrics.js
//
// PURE metrics for the PSE tab (briefings-bob/radar-ph): the PSEi index read,
// one row per PSEi stock, and the breadth of those stocks. No I/O; the fetches
// live in ph-snapshot.js (Yahoo) and pse-edge.js (PSE Edge).

function r2(v) { return (v == null || isNaN(v)) ? null : Math.round(v * 100) / 100; }

// ── metric helpers (operate on a closes[] array, ascending) ──
function sma(a, n) { if (a.length < n) return null; var s = 0; for (var i = a.length - n; i < a.length; i++) s += a[i]; return s / n; }
function dayPct(bars) { if (bars.length < 2) return null; var l = bars[bars.length - 1].close, p = bars[bars.length - 2].close; return p ? (l / p - 1) * 100 : null; }
// return over the last n trading bars (n bars ago -> last).
function retN(closes, n) { if (closes.length <= n) return null; var b = closes[closes.length - 1 - n], l = closes[closes.length - 1]; return b ? (l / b - 1) * 100 : null; }
// Return since the last close on or before `days` calendar days before the last
// bar. Date-based, so a missing day in a stored history can't stretch "1M".
// Null when the history doesn't reach back that far, or its nearest close is
// more than a week older than the cutoff (a gap, not a holiday).
function isoMinus(iso, days) { return new Date(Date.parse(iso + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10); }
function retDays(bars, days) {
  if (bars.length < 2) return null;
  var last = bars[bars.length - 1];
  var cutoff = isoMinus(last.date, days), floor = isoMinus(last.date, days + 7);
  for (var i = bars.length - 2; i >= 0; i--) {
    if (bars[i].date <= cutoff) return bars[i].date >= floor && bars[i].close ? (last.close / bars[i].close - 1) * 100 : null;
  }
  return null;
}
function maxOf(a) { return a.length ? a.reduce(function (m, v) { return v > m ? v : m; }, a[0]) : null; }
function minOf(a) { return a.length ? a.reduce(function (m, v) { return v < m ? v : m; }, a[0]) : null; }

// Year-to-date return: baseline = the close of the last bar BEFORE Jan 1 of the
// latest bar's year (i.e. prior-year close), else the first bar of the year.
function ytdPct(bars) {
  if (!bars.length) return null;
  var year = bars[bars.length - 1].date.slice(0, 4);
  var base = null;
  for (var i = 0; i < bars.length; i++) {
    if (bars[i].date.slice(0, 4) < year) base = bars[i].close;
    else { if (base == null) base = bars[i].close; break; }
  }
  var last = bars[bars.length - 1].close;
  return base ? (last / base - 1) * 100 : null;
}

// Wilder-style RSI(14) on closes.
function rsi(closes, n) {
  n = n || 14;
  if (closes.length <= n) return null;
  var gain = 0, loss = 0, i;
  for (i = closes.length - n; i < closes.length; i++) {
    var ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  if (loss === 0) return 100;
  var rs = (gain / n) / (loss / n);
  return 100 - 100 / (1 + rs);
}

// Annualized realized volatility (%) from the last n daily returns.
function vol(closes, n) {
  n = n || 20;
  if (closes.length <= n) return null;
  var rets = [];
  for (var i = closes.length - n; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
  var m = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
  var v = rets.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / rets.length;
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

function median(a) {
  var v = a.filter(function (x) { return x != null && !isNaN(x); }).sort(function (x, y) { return x - y; });
  if (!v.length) return null;
  var m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Daily PSEi closes kept on the doc. Yahoo's PSEI.PS chart stopped returning
// history around 17 Sep 2026 (it sends only the latest bar), so the index read
// keeps its own: the stored closes plus whatever Yahoo sends, newest value per
// date, ascending, capped at `max` days.
function mergeHistory(prev, bars, max) {
  var byDate = {};
  (prev || []).concat(bars || []).forEach(function (b) {
    if (b && /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') && b.close != null && isFinite(b.close)) byDate[b.date] = r2(b.close);
  });
  return Object.keys(byDate).sort().slice(-(max || 400)).map(function (d) { return { date: d, close: byDate[d] }; });
}

// The PSEi read. Every average, return and range is null until enough history
// exists for it; historyDays says how many daily closes it was computed from.
function indexMetrics(bars) {
  var closes = bars.map(function (b) { return b.close; });
  var last = bars[bars.length - 1];
  var s20 = sma(closes, 20), s50 = sma(closes, 50), s200 = sma(closes, 200);
  var yearCloses = lastYear(bars).map(function (b) { return b.close; });
  var hi = closes.length >= 200 ? maxOf(yearCloses) : null;
  var lo = closes.length >= 200 ? minOf(yearCloses) : null;
  return {
    symbol: 'PSEI.PS', name: 'PSEi', currency: last.currency || 'PHP',
    asOf: last.date, close: r2(last.close), dayChangePct: r2(dayPct(bars)),
    historyDays: bars.length,
    sma20: r2(s20), sma50: r2(s50), sma200: r2(s200),
    aboveSma20: s20 != null ? last.close > s20 : null,
    aboveSma50: s50 != null ? last.close > s50 : null,
    aboveSma200: s200 != null ? last.close > s200 : null,
    ret1w: r2(retDays(bars, 7)), ret1m: r2(retDays(bars, 30)),
    ret3m: r2(retDays(bars, 91)), retYtd: r2(ytdPctKnown(bars)),
    high52: r2(hi), low52: r2(lo),
    pctFromHigh: hi ? r2((last.close / hi - 1) * 100) : null,
    pctFromLow: lo ? r2((last.close / lo - 1) * 100) : null,
    rsi14: r2(rsi(closes, 14)), vol20: r2(vol(closes, 20)),
    // ~60 most recent closes for a front-end sparkline.
    spark: closes.slice(-60).map(function (c) { return r2(c); })
  };
}

// YTD only when the history reaches back past Jan 1; otherwise the first stored
// day would pose as the year's start (the old feed showed YTD 0% for weeks).
function ytdPctKnown(bars) {
  if (!bars.length) return null;
  var year = bars[bars.length - 1].date.slice(0, 4);
  return bars[0].date.slice(0, 4) < year ? ytdPct(bars) : null;
}

// Bars in the 52 weeks (364 days) to the last bar, the window PSE Edge's own
// 52-week high/low use (checked 13 Oct 2026 on EMI, AREIT, SCC, BDO and ICT;
// 252 sessions run longer than a year with PH holidays).
function lastYear(bars) {
  if (!bars.length) return [];
  var from = isoMinus(bars[bars.length - 1].date, 364);
  return bars.filter(function (b) { return b.date > from; });
}

// One PSEi stock from its PSE Edge daily bars ({date, open, high, low, close,
// value}, ascending). The 52-week range uses the bars' intraday highs and lows
// over the last 52 weeks, the same basis as PSE Edge's own figures.
function stockMetrics(bars) {
  if (!bars || !bars.length) return null;
  var closes = bars.map(function (b) { return b.close; });
  var last = bars[bars.length - 1];
  var yr = lastYear(bars);
  var highs = yr.map(function (b) { return b.high != null ? b.high : b.close; });
  var lows = yr.map(function (b) { return b.low != null ? b.low : b.close; });
  var hi = maxOf(highs), lo = minOf(lows);
  var priorHi = highs.length > 1 ? maxOf(highs.slice(0, -1)) : null;
  var priorLo = lows.length > 1 ? minOf(lows.slice(0, -1)) : null;
  var s50 = sma(closes, 50), s200 = sma(closes, 200);
  var values = bars.slice(-20).map(function (b) { return b.value; }).filter(function (v) { return v != null; });
  // Did the last close cross the 200-day average? Yesterday's close against
  // yesterday's average, today's against today's.
  var s200prev = sma(closes.slice(0, -1), 200), crossed = null;
  if (s200 != null && s200prev != null) {
    var nowAbove = last.close > s200, wasAbove = closes[closes.length - 2] > s200prev;
    if (nowAbove !== wasAbove) crossed = nowAbove ? 'up' : 'down';
  }
  return {
    asOf: last.date, close: r2(last.close), dayChangePct: r2(dayPct(bars)),
    ret1w: r2(retDays(bars, 7)), ret1m: r2(retDays(bars, 30)), ret3m: r2(retDays(bars, 91)),
    retYtd: r2(ytdPctKnown(bars)),
    high52: r2(hi), low52: r2(lo),
    pctFromHigh: hi ? r2((last.close / hi - 1) * 100) : null,
    pctFromLow: lo ? r2((last.close / lo - 1) * 100) : null,
    // where the close sits in the 52-week range: 0 = at the low, 100 = at the high
    rangePos: hi != null && lo != null && hi > lo ? r2((last.close - lo) / (hi - lo) * 100) : null,
    sma50: r2(s50), sma200: r2(s200),
    above50: s50 != null ? last.close > s50 : null,
    above200: s200 != null ? last.close > s200 : null,
    crossed200: crossed,
    // the last session broke below / above every other session of the 52 weeks
    // (strictly, so a stock that hasn't moved doesn't make a "new low" daily)
    newLow52: priorLo != null && last.low != null ? last.low < priorLo : false,
    newHigh52: priorHi != null && last.high != null ? last.high > priorHi : false,
    rsi14: r2(rsi(closes, 14)),
    avgValue20: values.length ? Math.round(values.reduce(function (a, b) { return a + b; }, 0) / values.length) : null,
    bars: bars.length,
    spark: closes.slice(-60).map(function (c) { return r2(c); })
  };
}

// How broad the move is across the PSEi stocks. `mood` is a fixed rule on the
// share above their 200-day average: 60%+ healthy, 40-59% mixed, under 40% weak.
// Near a low = within 5% of the 52-week low; near a high = within 3% of the high.
function buildBreadth(stocks) {
  var rows = (stocks || []).filter(function (s) { return s && s.close != null; });
  var dates = {};
  rows.forEach(function (s) { dates[s.asOf] = (dates[s.asOf] || 0) + 1; });
  var asOf = Object.keys(dates).sort(function (a, b) { return dates[b] - dates[a] || (a < b ? 1 : -1); })[0] || null;
  var current = rows.filter(function (s) { return s.asOf === asOf; });
  var with200 = rows.filter(function (s) { return s.above200 != null; });
  var with50 = rows.filter(function (s) { return s.above50 != null; });
  var above200 = with200.filter(function (s) { return s.above200; }).length;
  var share = with200.length ? above200 / with200.length : null;
  return {
    asOf: asOf, count: rows.length,
    staleSymbols: rows.filter(function (s) { return s.asOf !== asOf; }).map(function (s) { return s.symbol; }),
    above200: above200, with200: with200.length,
    above50: with50.filter(function (s) { return s.above50; }).length, with50: with50.length,
    advancers: current.filter(function (s) { return s.dayChangePct > 0; }).length,
    decliners: current.filter(function (s) { return s.dayChangePct < 0; }).length,
    unchanged: current.filter(function (s) { return s.dayChangePct === 0; }).length,
    nearLow: rows.filter(function (s) { return s.low52 != null && s.close <= s.low52 * 1.05; }).map(function (s) { return s.symbol; }),
    nearHigh: rows.filter(function (s) { return s.high52 != null && s.close >= s.high52 * 0.97; }).map(function (s) { return s.symbol; }),
    medianRet1m: r2(median(rows.map(function (s) { return s.ret1m; }))),
    medianRetYtd: r2(median(rows.map(function (s) { return s.retYtd; }))),
    mood: share == null ? null : share >= 0.6 ? 'healthy' : share >= 0.4 ? 'mixed' : 'weak'
  };
}

// Watchlist alerts for one person's list after a close. `items` is
// {SYMBOL: {target}} (target = the buy-below price they set, optional);
// `rows` is {SYMBOL: stock row}; only rows from `asOf`'s session alert, so a
// stock that did not trade cannot repeat yesterday's news. One alert per
// stock, the most useful first: their own price, a new 52-week low, a 200-day
// cross, a 4%+ day, a new 52-week high.
var WATCH_MOVE = 4;
function peso(v) { return '₱' + Number(v).toFixed(2); }
function watchAlerts(items, rows, asOf) {
  var rank = { target: 0, low: 1, cross: 2, move: 3, high: 4 };
  var out = [];
  Object.keys(items || {}).sort().forEach(function (sym) {
    var r = rows && rows[sym], it = items[sym] || {};
    if (!r || r.close == null || r.asOf !== asOf) return;
    var a = null;
    if (it.target > 0 && r.close <= it.target) a = { kind: 'target', text: sym + ' ' + peso(r.close) + ', at or below your ' + peso(it.target) };
    else if (r.newLow52) a = { kind: 'low', text: sym + ' made a new 52-week low (' + peso(r.close) + ')' };
    else if (r.crossed200) a = { kind: 'cross', text: sym + ' crossed ' + (r.crossed200 === 'up' ? 'above' : 'below') + ' its 200-day average' };
    else if (r.dayChangePct != null && Math.abs(r.dayChangePct) >= WATCH_MOVE) a = { kind: 'move', text: sym + ' ' + (r.dayChangePct > 0 ? '+' : '−') + Math.abs(r.dayChangePct).toFixed(1) + '% today' };
    else if (r.newHigh52) a = { kind: 'high', text: sym + ' made a new 52-week high (' + peso(r.close) + ')' };
    if (a) out.push(Object.assign({ symbol: sym }, a));
  });
  return out.sort(function (x, y) { return rank[x.kind] - rank[y.kind]; });
}

export { r2, sma, dayPct, retN, retDays, maxOf, minOf, ytdPct, rsi, vol, median, mergeHistory, indexMetrics, stockMetrics, buildBreadth, watchAlerts };
