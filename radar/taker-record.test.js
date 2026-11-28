import test from 'node:test';
import assert from 'node:assert/strict';
import { picksFromRun, resolvePick, measureTakerRecord, RECORD_DOC } from './taker-record.js';

// Weekday closes from a start day: asset grows by `a` a day, benchmark by `b`.
function series(start, n, first, step) {
  const out = [];
  let d = new Date(start + 'T00:00:00Z'), v = first;
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) { out.push({date: d.toISOString().slice(0, 10), close: Math.round(v * 1000) / 1000}); v += step; }
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

const run = (taker, extra = {}) => Object.assign({generatedAt: '2026-11-02T04:01:00.000Z', picks: {taker, wildcard: []},
  signals: [{symbol: 'XLV', benchmark: 'SPY', theme: 'Healthcare', score: 79}, {symbol: 'LMT', benchmark: 'SPY', theme: 'Defense', score: 61}, {symbol: 'ODD', score: 10}]}, extra);

test('a run gives one pending entry per Taker pick it can score', () => {
  assert.equal(RECORD_DOC, 'radar-taker-record');
  const picks = picksFromRun(run(['XLV', 'LMT', 'ODD']), '2026-11-02');
  assert.deepEqual(picks.map((p) => p.key), ['XLV|2026-11-02', 'LMT|2026-11-02'], 'a pick with no benchmark is left out');
  assert.equal(picks[0].benchmark, 'SPY'); assert.equal(picks[0].theme, 'Healthcare'); assert.equal(picks[0].score, 79); assert.equal(picks[0].status, 'pending');
  assert.deepEqual(picksFromRun(null, '2026-11-02'), []); assert.deepEqual(picksFromRun(run(['XLV']), 'bad'), []);
});

test('a pick resolves after ten sessions that start after the day it was published', () => {
  const bars = {XLV: series('2026-11-02', 20, 100, 1), SPY: series('2026-11-02', 20, 100, 0.5)};
  const [pick] = picksFromRun(run(['XLV']), '2026-11-02');
  // Published Mon 2 Nov: the start is Tue 3 Nov's close, the end ten sessions later (Tue 17 Nov).
  const early = resolvePick(pick, bars, '2026-11-16T22:00:00.000Z');
  assert.equal(early.status, 'pending', 'only nine sessions done');
  const done = resolvePick(pick, bars, '2026-11-17T22:00:00.000Z');
  assert.equal(done.status, 'resolved'); assert.equal(done.result.start, '2026-11-03'); assert.equal(done.result.end, '2026-11-17');
  // XLV 101 -> 111 (+9.90%), SPY 100.5 -> 105.5 (+4.98%): +4.93 points.
  assert.equal(done.result.excessReturn, 4.93);
  assert.equal(pick.status, 'pending', 'the stored entry is not edited in place');
  const lost = resolvePick({...pick, symbol: 'GONE'}, bars, '2027-01-15T00:00:00.000Z');
  assert.equal(lost.status, 'unavailable', 'no bars after 60 days: unavailable, never a loss');
});

test('the record keeps the first stored pick, counts wins and the recent list', () => {
  const up = {XLV: series('2026-10-01', 60, 100, 1), LMT: series('2026-10-01', 60, 100, -0.2), SPY: series('2026-10-01', 60, 100, 0.3)};
  const first = measureTakerRecord(null, picksFromRun(run(['XLV', 'LMT'], {generatedAt: '2026-10-05T04:00:00.000Z'}), '2026-10-05'), up, '2026-11-27T22:00:00.000Z');
  assert.equal(first.stats.picks, 2); assert.equal(first.stats.resolved, 2); assert.equal(first.stats.beat, 1);
  assert.equal(first.stats.since, '2026-10-05');
  assert.deepEqual(first.stats.recent.map((r) => r.symbol).sort(), ['LMT', 'XLV']);
  assert.ok(first.stats.meanExcessReturn != null && first.stats.medianExcessReturn === first.stats.meanExcessReturn, 'two picks: median is the mean');
  assert.equal(first.stats.effectiveSample, 2);
  // A later run re-sends the same day (a forced rerun) and adds a new one: the stored pick stays.
  const again = measureTakerRecord(first, picksFromRun(run(['XLV'], {generatedAt: '2026-10-05T09:00:00.000Z'}), '2026-10-05')
    .concat(picksFromRun(run(['XLV'], {generatedAt: '2026-11-25T04:00:00.000Z'}), '2026-11-25')), up, '2026-11-27T22:00:00.000Z');
  assert.equal(again.entries['XLV|2026-10-05'].generatedAt, '2026-10-05T04:00:00.000Z', 'first stored wins');
  assert.equal(again.stats.picks, 3); assert.equal(again.stats.pending, 1, 'the 25 Nov pick has not had ten sessions');
  assert.match(again.method, /ten matched sessions/);
});
