// radar/ph-snapshot.js
//
// Builds the Philippine-market snapshot written to briefings-bob/radar-ph. The
// only robust FREE source with history is the PSEi index itself (Yahoo PSEI.PS,
// PHP); company rows are US-listed ADR/OTC proxies (USD, indicative only); plus
// the USD/PHP (and AUD/PHP) FX cross. There is NO free per-stock PSE feed, so
// this stays a NOT-scored "market health" read, heavily caveated.
//
// Shared by radar/refresh-radar.js (the 06:00 run) and radar/refresh-ph.js (the
// after-close ~16:00 run). All I/O is the Yahoo fetch; never throws fatally for
// proxies/FX (only a missing PSEi index is fatal).
//
//   buildPhSnapshot(config) -> { index, fx, proxies, caveat }

function r2(v) { return (v == null || isNaN(v)) ? null : Math.round(v * 100) / 100; }

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

// ── pure metric helpers (operate on a closes[] array, ascending) ──
function sma(a, n) { if (a.length < n) return null; var s = 0; for (var i = a.length - n; i < a.length; i++) s += a[i]; return s / n; }
function dayPct(bars) { if (bars.length < 2) return null; var l = bars[bars.length - 1].close, p = bars[bars.length - 2].close; return p ? (l / p - 1) * 100 : null; }
// return over the last n trading bars (n bars ago -> last).
function retN(closes, n) { if (closes.length <= n) return null; var b = closes[closes.length - 1 - n], l = closes[closes.length - 1]; return b ? (l / b - 1) * 100 : null; }
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

function indexMetrics(bars) {
  var closes = bars.map(function (b) { return b.close; });
  var last = bars[bars.length - 1];
  var s20 = sma(closes, 20), s50 = sma(closes, 50), s200 = sma(closes, 200);
  var hi = maxOf(closes), lo = minOf(closes);
  return {
    symbol: 'PSEI.PS', name: 'PSEi', currency: last.currency || 'PHP',
    asOf: last.date, close: r2(last.close), dayChangePct: r2(dayPct(bars)),
    sma20: r2(s20), sma50: r2(s50), sma200: r2(s200),
    aboveSma20: s20 != null ? last.close > s20 : null,
    aboveSma50: s50 != null ? last.close > s50 : null,
    aboveSma200: s200 != null ? last.close > s200 : null,
    ret1w: r2(retN(closes, 5)), ret1m: r2(retN(closes, 21)),
    ret3m: r2(retN(closes, 63)), retYtd: r2(ytdPct(bars)),
    high52: r2(hi), low52: r2(lo),
    pctFromHigh: hi ? r2((last.close / hi - 1) * 100) : null,
    pctFromLow: lo ? r2((last.close / lo - 1) * 100) : null,
    rsi14: r2(rsi(closes, 14)), vol20: r2(vol(closes, 20)),
    // ~60 most recent closes for a front-end sparkline.
    spark: closes.slice(-60).map(function (c) { return r2(c); })
  };
}

async function buildPhSnapshot(config) {
  var ph = config.ph;
  console.log('Fetching PH snapshot (PSEi 1y + proxies + FX) from Yahoo...');

  var idxBars = await fetchYahooChart(ph.index.symbol, '1y');
  if (!idxBars.length) throw new Error('no PSEi data');
  var index = indexMetrics(idxBars);

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

  var proxies = [];
  for (var i = 0; i < ph.proxies.length; i++) {
    var p = ph.proxies[i];
    try {
      var b = await fetchYahooChart(p.symbol, '6mo');
      if (b.length) {
        var l = b[b.length - 1];
        var pc = b.map(function (x) { return x.close; });
        proxies.push({
          symbol: p.symbol, name: p.name, listing: p.listing,
          currency: l.currency || 'USD', asOf: l.date,
          close: r2(l.close), dayChangePct: r2(dayPct(b)),
          ret1w: r2(retN(pc, 5)), ret1m: r2(retN(pc, 21))
        });
      }
    } catch (e) { console.log('  PH proxy ' + p.symbol + ' skipped: ' + (e.message || e)); }
    await new Promise(function (r) { setTimeout(r, 400); });
  }

  return {
    index: index,
    fx: fx,
    proxies: proxies,
    caveat: 'Market-health read only — not scored, not backtested, not advice. PSEi is the live Philippine index (PHP, full history). Company rows are US-listed proxies (ADR/OTC, USD) that track their PSE-local shares only loosely and trade thinly; treat as indicative, not exact PSE prices. There is no free per-stock PSE feed.'
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
  var prev = snap.exists ? (snap.data() || {}).asOf : null;
  if (prev && phDoc.asOf && String(phDoc.asOf) < String(prev)) {
    console.log('radar-ph NOT written: new asOf ' + phDoc.asOf + ' is older than stored ' + prev + ' — kept the fresher snapshot.');
    return false;
  }
  await ref.set(phDoc);
  return true;
}

export { buildPhSnapshot, fetchYahooChart, writePhSnapshot };
