// The Taker / Wildcard picks exist twice: index.html shows them, and
// catalysts.js focusPicks ports them to choose the morning news reads and the
// `picks` field Ask Daybook reports. When the two disagree, the app shows names
// with no news read and Ask names a list the app does not show (9 Oct 2026).
// These tests run both on the same signals.
//   node --test radar/picks-parity.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {focusPicks} from './catalysts.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function source(name) {
  const at = html.indexOf('\nfunction ' + name + '(');
  assert.ok(at >= 0, name + ' not found in index.html');
  return html.slice(at, html.indexOf('\n}', at + 1) + 2);
}
const app = vm.createContext({});
['radarUpsidePct', 'radarMedian', 'radarWildcardFloor', 'radarWildcardRank', 'radarTakerRank', 'radarTakerPicks', 'radarWildcardPicks']
  .forEach(name => vm.runInContext(source(name), app));

function appPicks(signals) {
  const taker = app.radarTakerPicks(signals);
  const taken = {};
  taker.forEach(s => { taken[s.symbol] = true; });
  // Array.from: arrays built inside the vm context have another realm's prototype.
  return {taker: Array.from(taker, s => s.symbol), wildcard: Array.from(app.radarWildcardPicks(signals, taken).picks, s => s.symbol)};
}
function serverPicks(signals) {
  const picks = focusPicks(signals);
  return {taker: picks.taker.map(s => s.symbol), wildcard: picks.wildcard.map(s => s.symbol)};
}
// Wildcard order differs on purpose (the app sorts by score, focusPicks lists
// the standout first); which names are picked is what must match.
const sorted = list => list.slice().sort();
function assertSame(signals, label) {
  const a = appPicks(signals), b = serverPicks(signals);
  assert.deepEqual(a.taker, b.taker, label + ': Taker');
  assert.deepEqual(sorted(a.wildcard), sorted(b.wildcard), label + ': Wildcard');
  return a;
}

const sig = (symbol, o) => Object.assign({symbol, theme: 'T', status: 'forming', early: false, score: 60,
  entry: 100, stop: 96, target: 105, relStrength20d: 0}, o);

test('the 9 Oct 2026 radar picks AMD, SOXX, SMH and GEV in both places', () => {
  const day = [
    sig('AMD', {status: 'forming', early: true, score: 89, relStrength20d: 17.8, target: 108.8}),
    sig('SOXX', {status: 'confirmed', score: 86, relStrength20d: 3.4, target: 102.9}),
    sig('SMH', {status: 'confirmed', score: 81, relStrength20d: 2.8, target: 103}),
    sig('NVDA', {status: 'confirmed', score: 80, relStrength20d: 0.1, target: 104}),
    sig('PWR', {status: 'confirmed', score: 76, relStrength20d: 5.3, target: 105}),
    sig('GEV', {status: 'forming', early: true, score: 69, relStrength20d: 2.7, target: 108.6}),
    sig('XOM', {score: 67, relStrength20d: -0.1, target: 104}),
    sig('MSTR', {status: 'invalidated', score: 57, relStrength20d: 12.3, target: 112}),
    sig('GLD', {status: 'invalidated', score: 36, relStrength20d: -6.6, target: 103})
  ];
  const picks = assertSame(day, '9 Oct');
  assert.deepEqual(picks.taker, ['AMD', 'SOXX', 'SMH']);
  assert.deepEqual(picks.wildcard, ['GEV']);
});

test('500 random radars pick the same Taker and Wildcard names in the app and in focusPicks', () => {
  let seed = 20261009;
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = list => list[Math.floor(rand() * list.length)];
  for (let run = 0; run < 500; run++) {
    const n = 5 + Math.floor(rand() * 30);
    const signals = Array.from({length: n}, (_, i) => {
      const entry = 50 + rand() * 200;
      return sig('S' + i, {
        status: pick(['confirmed', 'forming', 'forming', 'invalidated']),
        early: rand() < 0.35,
        score: Math.round(rand() * 100),          // whole numbers, so ties happen
        relStrength20d: rand() < 0.1 ? null : Math.round((rand() * 35 - 15) * 10) / 10,
        entry: rand() < 0.05 ? null : entry,
        target: rand() < 0.05 ? null : entry * (1 + rand() * 0.15)
      });
    });
    assertSame(signals, 'run ' + run);
  }
});
