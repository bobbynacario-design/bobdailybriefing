// Offline tests for the IC + regime block in radar/journal.js. No I/O, no
// network, no Firestore — synthetic entries only.
//   node radar/journal.test.js
import assert from 'assert';
import {
  ranks, spearman, informationCoefficient, byRegimeStats, regimeCoverage,
  regimeLabel, bandSpread, resolveOutcome
} from './journal.js';

var n = 0;
function t(name, fn) { fn(); n++; console.log('  PASS  ' + name); }
function close(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// One synthetic entry. Defaults put it in risk-on tape with a mid score.
function e(o) {
  return Object.assign({
    date: '2026-07-01', symbol: 'AAA', theme: 'AI semis', status: 'forming',
    score: 50, excessReturn: 0, marketRegime: 100, themeRegime: 75
  }, o);
}
// A whole day of `k` names whose scores and excess move together (perfect IC=+1)
// or against each other (IC=-1), depending on `sign`.
function day(date, k, sign, regime) {
  var out = [];
  for (var i = 0; i < k; i++) {
    out.push(e({
      date: date, symbol: 'S' + i, score: 10 + i * 5,
      excessReturn: sign * (10 + i * 5) / 10,
      marketRegime: regime == null ? 100 : regime
    }));
  }
  return out;
}

// ── rank helper ──────────────────────────────────────────────────────────
t('ranks are 1-based and ordered', function () {
  assert.deepEqual(ranks([30, 10, 20]), [3, 1, 2]);
});

t('tied values share the average rank', function () {
  // 10,10 occupy ranks 1 and 2 -> both 1.5; 20 takes rank 3.
  assert.deepEqual(ranks([10, 10, 20]), [1.5, 1.5, 3]);
  // all tied -> everyone sits at the midpoint
  assert.deepEqual(ranks([5, 5, 5, 5]), [2.5, 2.5, 2.5, 2.5]);
});

// ── spearman ─────────────────────────────────────────────────────────────
t('perfect agreement is +1, perfect inversion is -1', function () {
  assert.ok(close(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1));
  assert.ok(close(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1));
});

t('spearman ranks, so one outlier cannot hijack it', function () {
  // Pearson on this would be dragged hard by the 900; the ranking is unchanged.
  var withOutlier = spearman([1, 2, 3, 4], [10, 20, 30, 900]);
  assert.ok(close(withOutlier, 1), 'monotone data stays +1 regardless of magnitude');
});

t('no spread on either side yields null, not zero', function () {
  // A day where every score is identical carries no ranking information at all.
  // Scoring it 0 would dilute the mean IC with a non-observation.
  assert.equal(spearman([5, 5, 5, 5], [1, 2, 3, 4]), null);
  assert.equal(spearman([1, 2, 3, 4], [7, 7, 7, 7]), null);
});

t('too few points yields null', function () {
  assert.equal(spearman([1, 2], [1, 2]), null);
});

// ── information coefficient ──────────────────────────────────────────────
t('a perfectly ranked universe reads IC +1 every day', function () {
  var entries = day('2026-07-01', 10, 1).concat(day('2026-07-02', 10, 1));
  var ic = informationCoefficient(entries, 20);
  assert.equal(ic.nDates, 2);
  assert.ok(close(ic.meanIC, 1, 1e-6));
  assert.equal(ic.positiveDayRate, 100);
  assert.ok(/right direction/.test(ic.verdict));
});

t('an inverted universe is called INVERSELY, not "weak"', function () {
  var entries = day('2026-07-01', 10, -1).concat(day('2026-07-02', 10, -1));
  var ic = informationCoefficient(entries, 20);
  assert.ok(close(ic.meanIC, -1, 1e-6));
  assert.equal(ic.positiveDayRate, 0);
  assert.ok(/INVERSELY/.test(ic.verdict), 'direction must be stated bluntly');
});

t('a day with fewer than the minimum names is skipped, not scored', function () {
  // 5 names is below MIN_IC_NAMES (8): a rank correlation on a handful of names
  // is noise, and including it would let a thin day move the mean.
  var entries = day('2026-07-01', 10, 1).concat(day('2026-07-02', 5, -1));
  var ic = informationCoefficient(entries, 20);
  assert.equal(ic.nDates, 1);
  assert.equal(ic.series[0].date, '2026-07-01');
});

t('entries with no excess return are excluded from the day', function () {
  var d = day('2026-07-01', 10, 1);
  d.forEach(function (x, i) { if (i > 2) x.excessReturn = null; });  // leaves 3 < min
  assert.equal(informationCoefficient(d, 20).nDates, 0);
});

t('mixed days average out to no usable signal', function () {
  var entries = day('2026-07-01', 10, 1).concat(day('2026-07-02', 10, -1));
  var ic = informationCoefficient(entries, 20);
  assert.ok(close(ic.meanIC, 0, 1e-6));
  assert.equal(ic.positiveDayRate, 50);
  assert.ok(/no usable ranking information/.test(ic.verdict));
});

t('the overlap adjustment always deflates the naive t-stat', function () {
  // Build days with a positive but varying IC so sd > 0 and a t-stat exists.
  var entries = [];
  for (var i = 0; i < 40; i++) {
    var dd = day('2026-07-' + String(i + 1).padStart(2, '0'), 10, 1);
    // perturb one name so the daily ICs differ and sd is non-zero
    dd[3].excessReturn = dd[3].excessReturn + (i % 3) * 4;
    entries = entries.concat(dd);
  }
  var ic = informationCoefficient(entries, 20);
  assert.ok(ic.tStat != null && ic.tStatOverlapAdj != null);
  assert.ok(Math.abs(ic.tStatOverlapAdj) < Math.abs(ic.tStat),
    'a 20-bar window over consecutive dates cannot be treated as independent');
  assert.ok(close(ic.effectiveNDates, 2, 0.05), '40 dates / 20-bar horizon = 2 effective windows');
  assert.ok(/NOT independent/.test(ic.overlapNote));
});

t('no scored days degrades to a stated absence, not a crash', function () {
  var ic = informationCoefficient([], 20);
  assert.equal(ic.nDates, 0);
  assert.equal(ic.meanIC, null);
  assert.ok(/not enough scored days/.test(ic.verdict));
});

// ── regime labelling + band spread ───────────────────────────────────────
t('regime labels map the three discrete backdrop scores', function () {
  assert.equal(regimeLabel(100), 'risk-on');
  assert.equal(regimeLabel(60), 'mixed');
  assert.equal(regimeLabel(25), 'risk-off');
  assert.equal(regimeLabel(null), 'unknown');
});

t('band spread is top band minus bottom band', function () {
  var list = [
    e({ score: 90, excessReturn: 2 }), e({ score: 85, excessReturn: 4 }),   // top: +3
    e({ score: 30, excessReturn: 1 }), e({ score: 20, excessReturn: -1 })   // bottom: 0
  ];
  var bs = bandSpread(list);
  assert.equal(bs.topBandExcess, 3);
  assert.equal(bs.bottomBandExcess, 0);
  assert.equal(bs.spread, 3);
});

t('a missing band yields a null spread rather than a fabricated one', function () {
  var bs = bandSpread([e({ score: 90, excessReturn: 2 })]);
  assert.equal(bs.topBandExcess, 2);
  assert.equal(bs.bottomBandExcess, null);
  assert.equal(bs.spread, null, 'nothing to subtract means no comparison exists');
});

// ── regime conditioning ──────────────────────────────────────────────────
t('entries are split by the regime they were scored in', function () {
  var entries = day('2026-07-01', 10, 1, 100).concat(day('2026-07-02', 10, -1, 25));
  var by = byRegimeStats(entries, 20);
  assert.equal(by['risk-on'].dates, 1);
  assert.equal(by['risk-off'].dates, 1);
  assert.equal(by['mixed'].dates, 0);
  assert.ok(close(by['risk-on'].meanIC, 1, 1e-6));
  assert.ok(close(by['risk-off'].meanIC, -1, 1e-6));
});

t('a sign flip across regimes is reported as regime-dependent', function () {
  // Score works in risk-on, inverts in risk-off — the exact case the split exists
  // to detect. Both regimes need populated top AND bottom bands to be comparable.
  var entries = [
    e({ date: '2026-07-01', symbol: 'A', score: 90, excessReturn: 5, marketRegime: 100 }),
    e({ date: '2026-07-01', symbol: 'B', score: 20, excessReturn: -5, marketRegime: 100 }),
    e({ date: '2026-07-02', symbol: 'A', score: 90, excessReturn: -5, marketRegime: 25 }),
    e({ date: '2026-07-02', symbol: 'B', score: 20, excessReturn: 5, marketRegime: 25 })
  ];
  var by = byRegimeStats(entries, 20);
  assert.equal(by['risk-on'].spread, 10);
  assert.equal(by['risk-off'].spread, -10);
  var cov = regimeCoverage(by);
  assert.equal(cov.sameSignAcrossRegimes, false);
  assert.ok(/FLIPS sign/.test(cov.note));
});

t('a consistent sign is reported as a property of the score', function () {
  var entries = [
    e({ date: '2026-07-01', symbol: 'A', score: 90, excessReturn: -5, marketRegime: 100 }),
    e({ date: '2026-07-01', symbol: 'B', score: 20, excessReturn: 5, marketRegime: 100 }),
    e({ date: '2026-07-02', symbol: 'A', score: 90, excessReturn: -3, marketRegime: 25 }),
    e({ date: '2026-07-02', symbol: 'B', score: 20, excessReturn: 3, marketRegime: 25 })
  ];
  var cov = regimeCoverage(byRegimeStats(entries, 20));
  assert.equal(cov.sameSignAcrossRegimes, true);
  assert.ok(/property of the score/.test(cov.note));
});

t('a single-regime sample admits that it cannot separate the two cases', function () {
  // This is the live situation today, and the most important honesty case: a
  // window covering one tape must not be read as evidence about the score.
  var entries = day('2026-07-01', 10, -1, 100).concat(day('2026-07-02', 10, -1, 100));
  var cov = regimeCoverage(byRegimeStats(entries, 20));
  assert.deepEqual(cov.regimesSeen, ['risk-on']);
  assert.ok(/only risk-on tape/.test(cov.note));
  assert.ok(/nothing here can separate/.test(cov.note));
});

t('regime stats survive entries with no regime recorded', function () {
  // Docs written before marketRegime existed must not crash the aggregation.
  var entries = day('2026-07-01', 10, 1).map(function (x) { x.marketRegime = null; return x; });
  var by = byRegimeStats(entries, 20);
  assert.equal(by['risk-on'].n, 0);
  assert.equal(by['risk-on'].spread, null);
  var cov = regimeCoverage(by);
  assert.deepEqual(cov.regimesSeen, []);
  assert.ok(/no tape/.test(cov.note));
});

t('malformed input does not throw', function () {
  assert.doesNotThrow(function () {
    informationCoefficient([{}, { date: 'x' }, { date: 'x', score: 1 }], 20);
    byRegimeStats([{}], 20);
    regimeCoverage(byRegimeStats([], 20));
  });
});

// ── unfillable guard ─────────────────────────────────────────────────────
// A stop-hit that MAKES money is impossible for a long. These fire when the
// next-session fill is already through the published stop, which is the normal
// case for an `invalidated` signal — it is invalidated BECAUSE the close broke
// the stop. Resolving it at the stop booked a guaranteed gain on a position
// nobody could have held.
function bar(o) { return Object.assign({ date: '2026-07-01', open: 100, high: 101, low: 99, close: 100 }, o); }

t('a fill already through the stop is unfillable, not a winning stop-hit', function () {
  // The real XLY row: filled 109.06 with a stop at 113.82 -> the old code
  // "exited" at 113.82 for +4.36%.
  var oc = resolveOutcome(113.82, 130, [bar({ low: 108, high: 112, close: 110 })], false, true, 109.06);
  assert.equal(oc.exitReason, 'unfillable');
  assert.equal(oc.unfillable, 'below-stop');
  assert.equal(oc.exit, null, 'no exit price means no return can be computed from it');
});

t('a fill exactly at the stop is still unfillable', function () {
  // A resting stop at the fill triggers immediately; it is not a real entry.
  var oc = resolveOutcome(100, 130, [bar({})], false, true, 100);
  assert.equal(oc.exitReason, 'unfillable');
});

t('a fill already past the target is unfillable too', function () {
  // The mirror defect. It booked a small fake LOSS rather than a gain, so it
  // was never as visible, but the published levels are just as stale.
  var oc = resolveOutcome(90, 105, [bar({ high: 120, low: 104, close: 110 })], false, true, 106);
  assert.equal(oc.exitReason, 'unfillable');
  assert.equal(oc.unfillable, 'above-target');
});

t('a normal fill inside its levels still resolves exactly as before', function () {
  var win = resolveOutcome(90, 110, [bar({ high: 112, low: 99, close: 111 })], false, true, 100);
  assert.equal(win.exitReason, 'target-hit');
  assert.equal(win.exit, 110);
  var loss = resolveOutcome(95, 130, [bar({ high: 101, low: 94, close: 96 })], false, true, 100);
  assert.equal(loss.exitReason, 'stop-hit');
  assert.equal(loss.exit, 95);
});

t('a genuine stop-hit can never produce a positive return', function () {
  // The invariant the whole guard exists to protect.
  var fills = [100, 250, 1016.75];
  fills.forEach(function (f) {
    var oc = resolveOutcome(f * 0.95, f * 1.2, [bar({ high: f, low: f * 0.9, close: f * 0.92 })], false, true, f);
    if (oc.exitReason === 'stop-hit') {
      assert.ok(oc.exit <= f, 'a long stopped out at ' + oc.exit + ' cannot beat its fill of ' + f);
    }
  });
});

t('crypto close-only resolution honours the same guard', function () {
  var oc = resolveOutcome(78.06, 95, [bar({ close: 76 })], true, true, 75.76);  // the real SOL row
  assert.equal(oc.exitReason, 'unfillable');
  assert.equal(oc.resolution, 'close-only');
});

t('omitting fill preserves the old signature for any other caller', function () {
  var oc = resolveOutcome(95, 110, [bar({ high: 112, low: 99, close: 111 })], false, true);
  assert.equal(oc.exitReason, 'target-hit');
});

t('a null stop cannot make a signal unfillable', function () {
  var oc = resolveOutcome(null, 110, [bar({ high: 112, low: 50, close: 111 })], false, true, 100);
  assert.equal(oc.exitReason, 'target-hit');
});

console.log('\n' + n + ' checks passed.');
