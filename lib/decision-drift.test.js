// Offline tests for lib/decision-drift.js. No I/O, no network.
//   node lib/decision-drift.test.js
import assert from 'assert';
import { computeDrift, groupByUid, isTracked } from './decision-drift.js';

var SIG = {
  NVDA: { symbol: 'NVDA', status: 'confirmed', score: 82, close: 190.15, stop: 178.40,
          invalidation: 'NVDA would need to lose 178.40.' },
  PWR:  { symbol: 'PWR', status: 'invalidated', score: 38, close: 625.69, stop: 642.37,
          invalidation: 'PWR would need to reclaim 642.37 to re-set.' },
  COIN: { symbol: 'COIN', status: 'forming', score: 55, close: 300, stop: 280,
          invalidation: 'COIN losing 280 ends it.' },
  BTC:  { symbol: 'BTC', status: 'forming', score: 61, close: 118400, stop: 109500,
          invalidation: 'BTC losing 109500 ends this attempt.' }
};
function dec(o) {
  return Object.assign({ id: 'd', asset: 'NVDA', action: 'took', direction: 'long',
    status: 'open', createdDate: '2026-07-14', uid: 'u1' }, o);
}
var n = 0;
function t(name, fn) { fn(); n++; console.log('  PASS  ' + name); }

t('setup weakening is flagged', function () {
  var r = computeDrift([dec({ asset: 'PWR', linkedSignal: { status: 'confirmed', score: 74, close: 700 } })], SIG);
  assert.equal(r.length, 1);
  assert.equal(r[0].weakened, true);
  assert.ok(r[0].reasons.some(function (x) { return /weakened from confirmed to invalidated/.test(x); }));
});

t('price below the stop is flagged', function () {
  var r = computeDrift([dec({ asset: 'PWR', linkedSignal: { status: 'invalidated', score: 40, close: 700 } })], SIG);
  assert.equal(r.length, 1);
  assert.equal(r[0].weakened, false, 'same status -> not weakened');
  assert.equal(r[0].belowStop, true);
});

t('a healthy call is NOT flagged', function () {
  var r = computeDrift([dec({ linkedSignal: { status: 'forming', score: 61, close: 182.40 } })], SIG);
  assert.deepEqual(r, [], 'strengthened forming->confirmed, above stop');
});

t('skipped calls are out of scope', function () {
  var r = computeDrift([dec({ asset: 'PWR', action: 'skipped', linkedSignal: { status: 'confirmed', score: 74 } })], SIG);
  assert.deepEqual(r, []);
});

t('closed calls are out of scope', function () {
  var r = computeDrift([dec({ asset: 'PWR', status: 'closed', linkedSignal: { status: 'confirmed', score: 74 } })], SIG);
  assert.deepEqual(r, []);
});

t('watched calls ARE in scope', function () {
  var r = computeDrift([dec({ asset: 'PWR', action: 'watched', linkedSignal: { status: 'confirmed', score: 74 } })], SIG);
  assert.equal(r.length, 1);
});

t('off-radar assets are skipped, not crashed on', function () {
  var r = computeDrift([dec({ asset: 'SM', linkedSignal: { status: 'confirmed', score: 74 } })], SIG);
  assert.deepEqual(r, []);
});

t('missing linkedSignal cannot weaken but can break a stop', function () {
  var r = computeDrift([dec({ asset: 'PWR', linkedSignal: null })], SIG);
  assert.equal(r.length, 1);
  assert.equal(r[0].weakened, false);
  assert.equal(r[0].belowStop, true);
  assert.equal(r[0].movePct, null, 'no reference price available');
});

t('move% is direction-aware', function () {
  var long = computeDrift([dec({ asset: 'PWR', entryPrice: 700,
    linkedSignal: { status: 'confirmed', score: 74 } })], SIG)[0];
  assert.equal(long.movePct, -10.6);
  // a short in a falling name is winning even though the setup broke
  var short = computeDrift([dec({ asset: 'PWR', direction: 'short', entryPrice: 700,
    linkedSignal: { status: 'confirmed', score: 74 } })], SIG)[0];
  assert.equal(short.movePct, 10.6);
});

t('entryPrice wins over the snapshot close as reference', function () {
  var r = computeDrift([dec({ asset: 'PWR', entryPrice: 650,
    linkedSignal: { status: 'confirmed', score: 74, close: 700 } })], SIG)[0];
  assert.equal(r.movePct, -3.7, '(625.69-650)/650');
});

t('quotes the radar invalidation, never invents advice', function () {
  var r = computeDrift([dec({ asset: 'PWR', linkedSignal: { status: 'confirmed', score: 74 } })], SIG)[0];
  assert.equal(r.invalidation, 'PWR would need to reclaim 642.37 to re-set.');
});

t('worst first: both reasons before one', function () {
  var both = dec({ id: 'both', asset: 'PWR', linkedSignal: { status: 'confirmed', score: 74 } });
  var oneWeak = dec({ id: 'weak', asset: 'COIN', linkedSignal: { status: 'confirmed', score: 70 } });
  var r = computeDrift([oneWeak, both], SIG);
  assert.equal(r.length, 2);
  assert.equal(r[0].id, 'both', 'weakened AND below stop ranks first');
  assert.equal(r[1].id, 'weak');
});

t('groupByUid separates owners and drops unowned', function () {
  var g = groupByUid([dec({ uid: 'u1' }), dec({ uid: 'u2' }), dec({ uid: null })]);
  assert.deepEqual(Object.keys(g).sort(), ['u1', 'u2']);
  assert.equal(g.u1.length, 1);
});

t('one owner never sees another owner drift', function () {
  var g = groupByUid([
    dec({ uid: 'u1', asset: 'PWR', linkedSignal: { status: 'confirmed', score: 74 } }),
    dec({ uid: 'u2', asset: 'PWR', linkedSignal: { status: 'confirmed', score: 74 } })
  ]);
  assert.equal(computeDrift(g.u1, SIG).length, 1);
  assert.equal(computeDrift(g.u2, SIG).length, 1);
  assert.notEqual(g.u1[0].uid, g.u2[0].uid);
});

t('empty / malformed input does not throw', function () {
  assert.deepEqual(computeDrift([], SIG), []);
  assert.deepEqual(computeDrift(null, SIG), []);
  assert.deepEqual(computeDrift([{}], SIG), []);
  assert.deepEqual(computeDrift([dec({ asset: '' })], SIG), []);
  assert.equal(isTracked({ status: 'open', action: 'took' }), true);
});

t('a null stop cannot fabricate a breach', function () {
  var sig = { X: { symbol: 'X', status: 'forming', score: 50, close: 10, stop: null, invalidation: '' } };
  var r = computeDrift([dec({ asset: 'X', linkedSignal: { status: 'forming', score: 50 } })], sig);
  assert.deepEqual(r, []);
});

console.log('\n' + n + ' checks passed');
