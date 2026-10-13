import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistory, finishedBars, completedSnapshotDate, indexMetrics, stockMetrics, buildBreadth, retDays } from './ph-metrics.js';

test('stored pre-close dates do not prevent repairing a partial snapshot',()=>{
  const partial={generatedAt:'2026-10-13T01:56:13Z',asOf:'2026-10-13',index:{asOf:'2026-10-13'},breadth:{asOf:'2026-10-12'}};
  assert.equal(completedSnapshotDate(partial),'2026-10-12');
  assert.equal(completedSnapshotDate({...partial,generatedAt:'2026-10-13T08:30:00Z'}),'2026-10-13');
  assert.equal(completedSnapshotDate({asOf:'2026-10-12'}),'2026-10-12','legacy timestamp unavailable: preserve the write guard');
  assert.equal(finishedBars([{date:'2026-10-14'}],'2026-10-13',1000).length,0,'future dates never become closes');
});

test('current breadth cannot be improved by older bullish rows, even when most rows are old',()=>{
  const rows=[{symbol:'A',asOf:'2026-10-12',close:100,above200:true},
    {symbol:'B',asOf:'2026-10-12',close:100,above200:false},
    ...['C','D','E'].map(symbol=>({symbol,asOf:'2026-10-09',close:100,above200:true,ret1m:99}))];
  const b=buildBreadth(rows);
  assert.equal(b.asOf,'2026-10-12');assert.equal(b.currentCount,2);assert.equal(b.with200,2);assert.equal(b.above200,1);assert.equal(b.mood,'mixed');assert.equal(b.medianRet1m,null);
});
import { parseEdgeChart, parseEdgeStockPage, edgeDate, edgeQueryDate } from './pse-edge.js';

// n weekday bars ending on `end`, closes from fn(i).
function weekdays(end, n, fn) {
  var out = [], t = Date.parse(end + 'T00:00:00Z');
  while (out.length < n) {
    var d = new Date(t), wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10));
    t -= 86400000;
  }
  return out.map(function (date, i) { var c = fn(i); return { date: date, open: c, high: c * 1.01, low: c * 0.99, close: c, value: 1000 + i }; });
}

test('PSEi history keeps the newest close per date, ascending, capped, and drops junk', () => {
  const h = mergeHistory(
    [{ date: '2026-10-08', close: 5610.39 }, { date: '2026-10-09', close: 5700 }, { date: 'bad', close: 1 }, { date: '2026-10-07', close: null }],
    [{ date: '2026-10-09', close: 5700.99 }, { date: '2026-10-12', close: 5743.18 }], 2);
  assert.deepEqual(h, [{ date: '2026-10-09', close: 5700.99 }, { date: '2026-10-12', close: 5743.18 }]);
});

test('before 15:45 Manila time today’s bar is partial and left out; after it, kept', () => {
  const bars = [{ date: '2026-10-12', close: 5743.18 }, { date: '2026-10-13', close: 5699.01 }];
  assert.deepEqual(finishedBars(bars, '2026-10-13', 9 * 60 + 56).map(b => b.date), ['2026-10-12'], 'the 09:56 run on 13 Oct');
  assert.deepEqual(finishedBars(bars, '2026-10-13', 15 * 60 + 44).map(b => b.date), ['2026-10-12']);
  assert.deepEqual(finishedBars(bars, '2026-10-13', 16 * 60 + 30).map(b => b.date), ['2026-10-12', '2026-10-13'], 'the 16:30 run');
  assert.deepEqual(finishedBars(bars, '2026-10-14', 60).map(b => b.date), ['2026-10-12', '2026-10-13'], 'after midnight, yesterday is finished');
  assert.deepEqual(finishedBars(null, '2026-10-13', 600), []);
});

test('one stored PSEi close gives no trend, no returns and no range, never a false downtrend', () => {
  const ix = indexMetrics([{ date: '2026-10-12', close: 5743.18 }]);
  assert.equal(ix.historyDays, 1);
  assert.equal(ix.aboveSma20, null); assert.equal(ix.aboveSma50, null); assert.equal(ix.aboveSma200, null);
  assert.equal(ix.dayChangePct, null); assert.equal(ix.ret1m, null); assert.equal(ix.retYtd, null);
  assert.equal(ix.high52, null); assert.equal(ix.low52, null);
});

test('returns are date-based: a missing day does not stretch 1M, a long gap gives none', () => {
  const bars = [
    { date: '2026-09-10', close: 100 }, { date: '2026-09-12', close: 105 },
    { date: '2026-10-09', close: 108 }, { date: '2026-10-12', close: 110 }
  ];
  assert.equal(Math.round(retDays(bars, 30) * 100) / 100, 4.76);  // vs 12 Sep (on or before 12 Sep)
  assert.equal(retDays(bars, 91), null);                           // history too short
  assert.equal(retDays([{ date: '2026-08-01', close: 100 }, { date: '2026-10-12', close: 110 }], 30), null); // 72-day gap
});

test('a PSE stock row: 52-week range, position in it, averages only with enough bars', () => {
  const bars = weekdays('2026-10-12', 280, i => 100 + i);   // steady climb
  const s = stockMetrics(bars);
  assert.equal(s.close, 379); assert.equal(s.asOf, '2026-10-12');
  assert.equal(s.above200, true); assert.equal(s.above50, true);
  // the 52-week low is the first bar after 364 days back, not the series low
  const yearStart = bars.find(b => b.date > '2025-10-13');
  assert.equal(s.low52, Math.round(yearStart.low * 100) / 100);
  assert.equal(s.high52, Math.round(379 * 1.01 * 100) / 100);
  assert.ok(s.rangePos > 90 && s.rangePos <= 100);
  assert.equal(s.avgValue20, Math.round((1260 + 1279) / 2));
  const short = stockMetrics(weekdays('2026-10-12', 120, i => 50));
  assert.equal(short.above200, null); assert.equal(short.sma200, null);
});

test('breadth counts the board and labels the mood by the share above the 200-day', () => {
  const row = (symbol, o) => Object.assign({ symbol, asOf: '2026-10-12', close: 10, dayChangePct: 0, above50: false, above200: false, high52: 20, low52: 9.6, ret1m: 0, retYtd: 0 }, o);
  const b = buildBreadth([
    row('A', { above200: true, above50: true, dayChangePct: 1.2, high52: 10.2, low52: 5 }),
    row('B', { dayChangePct: -0.5 }),
    row('C', { dayChangePct: -2 }),
    row('D', { asOf: '2026-10-09', above200: true }),
    row('E', { above200: null, above50: null })
  ]);
  assert.equal(b.asOf, '2026-10-12'); assert.deepEqual(b.staleSymbols, ['D']);
  assert.equal(b.above200, 1); assert.equal(b.with200, 3);assert.equal(b.currentCount,4);
  assert.equal(b.advancers, 1); assert.equal(b.decliners, 2); assert.equal(b.unchanged, 1);  // D's close is older, so not counted today
  assert.deepEqual(b.nearHigh, ['A']); assert.deepEqual(b.nearLow, ['B', 'C', 'E']);
  assert.equal(b.mood, 'weak');                                   // 1 of 3 current known averages
  assert.equal(buildBreadth([row('X', { above200: true })]).mood, 'healthy');
  assert.equal(buildBreadth([row('X')]).mood, 'weak');
  assert.equal(buildBreadth([row('X', { above200: null })]).mood, null);
});

test('PSE Edge chart rows become ascending ISO-dated bars; rows without a close are dropped', () => {
  const bars = parseEdgeChart({ chartData: [
    { OPEN: 112.6, VALUE: 254085476, CLOSE: 112, CHART_DATE: 'Oct 12, 2026 00:00:00', HIGH: 113.1, LOW: 111 },
    { OPEN: 1, CLOSE: null, CHART_DATE: 'Oct 10, 2026 00:00:00' },
    { OPEN: 113, VALUE: '1,000', CLOSE: '113.00', CHART_DATE: 'Oct 9, 2026 00:00:00', HIGH: 114, LOW: 112 }
  ] });
  assert.deepEqual(bars.map(b => b.date), ['2026-10-09', '2026-10-12']);
  assert.equal(bars[0].close, 113); assert.equal(bars[0].value, 1000);
  assert.equal(edgeDate('Sep 8, 2025 00:00:00'), '2025-09-08'); assert.equal(edgeDate('junk'), null);
  assert.equal(edgeQueryDate('2026-10-12'), '10-12-2026');
});

test('PSE Edge stock page: the security id for the symbol asked, and the page figures', () => {
  const html = '<select name="security_id"><option value="100">BDOP</option><option value="468" selected>BDO</option></select>' +
    '<th>Market Capitalization</th>\n  <td style="text-align:right">\n    602,968,557,090.00</td>' +
    '<th>Last Traded Price</th><td>\n112.00</td><th>52-Week High</th><td>144.60</td><th>52-Week Low</th><td>109.20</td>';
  const p = parseEdgeStockPage(html, 'BDO');
  assert.equal(p.securityId, '468'); assert.equal(p.marketCap, 602968557090);
  assert.equal(p.lastPrice, 112); assert.equal(p.high52, 144.6); assert.equal(p.low52, 109.2);
  assert.equal(parseEdgeStockPage(html, 'XYZ').securityId, null);
});
