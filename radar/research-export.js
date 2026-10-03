// radar/research-export.js
//
// RESEARCH ONLY. Lives on the radar-research branch and never on main.
//
// Fetches the radar's bars the way refresh-radar.js does, re-scores every past
// date with the shipped scoring.js exactly as journal.js does (same emit dates,
// warm-up floor, next-session fill, resolveOutcome), and writes one row per
// (date, symbol): the shipped sub-scores, candidate features and outcomes.
// Rows hold ratios and returns only, never raw prices (the repo is public).
//
//   node radar/research-export.js   -> radar/research-rows.json

import { writeFileSync } from 'fs';
import { CONFIG } from './config.js';
import { scoreUniverse } from './scoring.js';
import { resolveOutcome, buildJournal } from './journal.js';
import { fetchRetry } from '../lib/http.js';

var KEY = process.env.APCA_API_KEY_ID || '';
var SECRET = process.env.APCA_API_SECRET_KEY || '';

async function fetchEquityBars(symbols) {
  var out = {};
  symbols.forEach(function (s) { out[s] = []; });
  var start = new Date(Date.now() - CONFIG.barsLookbackDays * 86400000).toISOString();
  var token = null;
  do {
    var url = 'https://data.alpaca.markets/v2/stocks/bars?symbols=' + encodeURIComponent(symbols.join(',')) +
      '&timeframe=1Day&adjustment=split&feed=iex&limit=10000&start=' + encodeURIComponent(start) +
      (token ? '&page_token=' + encodeURIComponent(token) : '');
    var res = await fetchRetry(url, { headers: { 'APCA-API-KEY-ID': KEY, 'APCA-API-SECRET-KEY': SECRET } }, 'Alpaca');
    if (!res.ok) throw new Error('Alpaca ' + res.status);
    var json = await res.json();
    Object.keys(json.bars || {}).forEach(function (sym) {
      json.bars[sym].forEach(function (b) {
        out[sym].push({ date: String(b.t).slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
      });
    });
    token = json.next_page_token || null;
  } while (token);
  return out;
}

async function fetchCryptoBars(ids) {
  var out = {};
  for (var sym of Object.keys(ids)) {
    var url = 'https://api.coingecko.com/api/v3/coins/' + ids[sym] + '/market_chart?vs_currency=usd&days=' +
      CONFIG.cryptoLookbackDays + '&interval=daily';
    var res = await fetchRetry(url, { headers: { accept: 'application/json' } }, 'CoinGecko ' + sym);
    if (!res.ok) throw new Error('CoinGecko ' + sym + ' ' + res.status);
    var json = await res.json(), vol = {}, seen = {}, bars = [];
    (json.total_volumes || []).forEach(function (v) { vol[new Date(v[0]).toISOString().slice(0, 10)] = v[1]; });
    (json.prices || []).forEach(function (p) {
      var d = new Date(p[0]).toISOString().slice(0, 10);
      if (seen[d]) return;
      seen[d] = true;
      bars.push({ date: d, open: p[1], high: p[1], low: p[1], close: p[1], volume: vol[d] || 0 });
    });
    out[sym] = bars;
    await new Promise(function (r) { setTimeout(r, 1500); });
  }
  return out;
}

// ── helpers (mirroring journal.js / scoring.js) ──

function r3(v) { return v == null || !isFinite(v) ? null : Math.round(v * 1000) / 1000; }
function avg(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
function idxOfDate(bars, date) { for (var i = 0; i < bars.length; i++) if (bars[i].date === date) return i; return -1; }
function lastIdxOnOrBefore(bars, date) {
  var lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { var mid = (lo + hi) >> 1; if (bars[mid].date <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
function closeOnOrBefore(bars, date) { var i = lastIdxOnOrBefore(bars, date); return i < 0 ? null : bars[i].close; }
function atr(b, n) {
  if (b.length < n + 1) return null;
  var s = 0;
  for (var i = b.length - n; i < b.length; i++) {
    var x = b[i], p = b[i - 1];
    s += Math.max(x.high - x.low, Math.abs(x.high - p.close), Math.abs(x.low - p.close));
  }
  return s / n;
}

// Percent return over k bars, ending `off` bars before the last bar.
function retK(c, k, off) {
  off = off || 0;
  var end = c.length - 1 - off, st = end - k;
  return st >= 0 && c[st] ? (c[end] / c[st] - 1) * 100 : null;
}

// Candidate features at the scored date. b = the asset's bars up to D, bb = its
// benchmark's bars up to D, s = the shipped signal.
function features(b, bb, s) {
  var c = b.map(function (x) { return x.close; }), n = c.length, close = c[n - 1];
  var bc = bb && bb.length ? bb.map(function (x) { return x.close; }) : null;
  function sma(k) { return n >= k ? avg(c.slice(n - k)) : null; }
  function rs(k, off) { var a = retK(c, k, off), z = bc ? retK(bc, k, off) : null; return a == null || z == null ? null : a - z; }
  var s20 = sma(20), s50 = sma(50), a14 = atr(b, 14);
  var v = b.map(function (x) { return x.volume || 0; });
  var v20 = n >= 20 ? avg(v.slice(n - 20)) : null, v60 = n >= 60 ? avg(v.slice(n - 60)) : null;
  var up = 0, dn = 0;
  for (var i = Math.max(1, n - 20); i < n; i++) { if (c[i] > c[i - 1]) up += v[i]; else if (c[i] < c[i - 1]) dn += v[i]; }
  var hi20 = -Infinity;
  for (var j = Math.max(0, n - 20); j < n; j++) if (b[j].high > hi20) hi20 = b[j].high;
  var rets = [];
  for (var k = Math.max(1, n - 20); k < n; k++) rets.push((c[k] / c[k - 1] - 1) * 100);
  var m = avg(rets), sd = rets.length > 1 ? Math.sqrt(rets.reduce(function (t, x) { return t + (x - m) * (x - m); }, 0) / (rets.length - 1)) : null;
  var rs20 = rs(20, 0), rs20lag5 = rs(20, 5);
  return {
    cS20: s20 ? (close / s20 - 1) * 100 : null,
    cS50: s50 ? (close / s50 - 1) * 100 : null,
    s20S50: s20 && s50 ? (s20 / s50 - 1) * 100 : null,
    volRatio: s.volRatio,
    rs20: rs20,
    rsAccel: rs20 != null && rs20lag5 != null ? rs20 - rs20lag5 : null,
    rs60: rs(60, 0),
    rs120: rs(120, 0),
    mom126: n > 126 && c[n - 1 - 126] ? (c[n - 1 - 21] / c[n - 1 - 126] - 1) * 100 : null,
    mom252: n > 252 && c[n - 1 - 252] ? (c[n - 1 - 21] / c[n - 1 - 252] - 1) * 100 : null,
    ret5: retK(c, 5, 0),
    ret20: retK(c, 20, 0),
    hi52: s.pctFromHigh52,
    lo52: s.pctAboveLow52,
    hi20: isFinite(hi20) && hi20 > 0 ? (close / hi20 - 1) * 100 : null,
    volTrend: v20 && v60 ? v20 / v60 : null,
    upDown20: dn > 0 ? up / dn : null,
    atrPct: a14 ? a14 / close * 100 : null,
    extATR: a14 && s20 ? (close - s20) / a14 : null,
    stopATR: a14 && s.stop != null ? (s.entry - s.stop) / a14 : null,
    rv20: sd,
    beta: s.beta,
    tReg: s.regimeScore
  };
}

async function main() {
  var t0 = Date.now();
  var eq = CONFIG.watchlist.map(function (w) { return w.symbol; }).filter(function (s) { return !CONFIG.coingeckoIds[s]; });
  var bars = Object.assign(await fetchEquityBars(eq), await fetchCryptoBars(CONFIG.coingeckoIds));
  console.log('bars: ' + Object.keys(bars).map(function (s) { return s + ':' + bars[s].length; }).join(' '));

  var jc = CONFIG.journal, H = jc.horizonBars, minBars = jc.minBarsToScore;
  var kindOf = {};
  CONFIG.watchlist.forEach(function (w) { kindOf[w.symbol] = w.kind || 'unclassified'; });
  var calendar = bars.SPY.map(function (b) { return b.date; });
  var start = Math.max(minBars, calendar.length - 1 - jc.lookbackDays);
  // Every date through the latest, so the most recent rows exist (with no outcome yet).
  var emit = calendar.slice(start);
  var rows = [];

  emit.forEach(function (D) {
    var sliced = {};
    Object.keys(bars).forEach(function (sym) { sliced[sym] = bars[sym].slice(0, lastIdxOnOrBefore(bars[sym], D) + 1); });
    var res = scoreUniverse(sliced, CONFIG);
    var mReg = res.regime ? res.regime.score : null;
    res.signals.forEach(function (s) {
      var b = bars[s.symbol], idxD = idxOfDate(b, D);
      if (idxD < 0 || idxD + 1 < minBars) return;
      var crypto = !!CONFIG.coingeckoIds[s.symbol];
      var row = {
        d: D, s: s.symbol, th: s.theme, k: kindOf[s.symbol], bm: s.benchmark, cr: crypto,
        st: s.status, sc: s.score, ss: s.subScores, mr: mReg,
        nb: s.nearBreakout, ea: s.early === true, f: {}, o: { er: 'pending', x: null, fr: null, fx5: null, fx10: null, fx20: null }
      };
      var f = features(sliced[s.symbol], sliced[s.benchmark], s);
      Object.keys(f).forEach(function (k) { row.f[k] = r3(f[k]); });

      var idxFill = idxD + 1;
      if (idxFill < b.length) {
        var fillBar = b[idxFill], fill = crypto ? fillBar.close : fillBar.open;
        var win = b.slice(idxFill, idxFill + H), full = idxFill + H <= b.length;
        var oc = resolveOutcome(s.stop, s.target, win, crypto, full, fill);
        var bb = bars[s.benchmark] || [];
        row.o.er = oc.exitReason;
        if (oc.exitReason !== 'unfillable' && oc.exit != null) {
          var fr = (oc.exit / fill - 1) * 100;
          var exitDate = oc.exitDate || win[win.length - 1].date;
          var b0 = closeOnOrBefore(bb, fillBar.date), b1 = closeOnOrBefore(bb, exitDate);
          row.o.fr = r3(fr);
          row.o.x = b0 && b1 ? r3(fr - (b1 / b0 - 1) * 100) : null;
        }
        // Plain forward excess, close of the k-th window bar vs the fill, with no
        // stop or target: the model-free outcome for testing a feature on its own.
        [5, 10, 20].forEach(function (k) {
          if (idxFill + k > b.length) return;
          var end = b[idxFill + k - 1], a = (end.close / fill - 1) * 100;
          var z0 = closeOnOrBefore(bb, fillBar.date), z1 = closeOnOrBefore(bb, end.date);
          row.o['fx' + k] = z0 && z1 ? r3(a - (z1 / z0 - 1) * 100) : null;
        });
      }
      rows.push(row);
    });
  });

  // Sanity check against the live journal: the score bands from the same rows.
  var bands = { '80-100': [], '60-79': [], '40-59': [], '0-39': [] };
  rows.forEach(function (r) {
    if (r.o.x == null) return;
    var k = r.sc >= 80 ? '80-100' : r.sc >= 60 ? '60-79' : r.sc >= 40 ? '40-59' : '0-39';
    bands[k].push(r.o.x);
  });
  Object.keys(bands).forEach(function (k) { console.log('band ' + k + ' n=' + bands[k].length + ' avgExcess=' + r3(avg(bands[k]))); });

  writeFileSync(new URL('./research-rows.json', import.meta.url), JSON.stringify({
    generatedAt: new Date().toISOString(), horizon: H, emitFrom: emit[0], emitTo: emit[emit.length - 1], rows: rows
  }));
  console.log(rows.length + ' rows, ' + emit.length + ' dates, ' + Math.round((Date.now() - t0) / 1000) + 's');

  // Verification: the real buildJournal on the real bars with the branch's config,
  // exactly as refresh-radar.js calls it, minus the Firestore write.
  var j = buildJournal(bars, CONFIG, CONFIG.journal);
  console.log('\n=== buildJournal (' + j.journalConfig.scoringModelMeasured + ') ===');
  ['80-100', '60-79', '40-59', '0-39'].forEach(function (k) {
    var g = j.byScoreBucket[k];
    console.log('band ' + k + ' n=' + g.n + ' avgExcess=' + g.avgExcessReturn);
  });
  console.log('IC ' + j.informationCoefficient.meanIC + ' days+ ' + j.informationCoefficient.positiveDayRate + '% :: ' + j.informationCoefficient.verdict);
  var mc = j.modelCheck;
  ['chosenOn', 'checked', 'live'].forEach(function (k) {
    var w = mc.windows[k];
    console.log('model ' + k + ' ' + w.from + '..' + w.to + ' days=' + w.current.days +
      ' top5 ' + w.current.top5VsDay + ' (was ' + w.previous.top5VsDay + ') IC ' + w.current.meanIC + ' (was ' + w.previous.meanIC + ')' +
      ' topBand ' + w.current.topBandExcess + ' (was ' + w.previous.topBandExcess + ')');
  });
  console.log('verdict: ' + mc.verdict);
  Object.keys(j.weightCalibration.components).forEach(function (c) {
    var g = j.weightCalibration.components[c];
    console.log('calib ' + c + ' fit ' + g.spreadFit + ' hold ' + g.spreadHoldout + ' robust ' + g.robust);
  });
  console.log('selection: ' + j.selectionControl.verdict);
  ['all', 'live'].forEach(function (k) { var w = j.earlyZone && j.earlyZone[k]; if (w) console.log('early ' + k + ' early ' + w.early.avgExcessReturn + ' (n' + w.early.n + ') other forming ' + w.otherForming.avgExcessReturn + ' (n' + w.otherForming.n + ') confirmed ' + w.confirmed.avgExcessReturn + ' (n' + w.confirmed.n + ')'); });
  var slim = Object.assign({}, j, { byDate: undefined, recentOutcomes: undefined });
  writeFileSync(new URL('./research-journal.json', import.meta.url), JSON.stringify(slim));
}

main().catch(function (e) { console.error('research export failed: ' + (e.message || e)); process.exit(1); });
