import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('./command-center-core.js', import.meta.url), 'utf8');
const context = {Intl, Date, console};
vm.createContext(context);
vm.runInContext(source, context);
const {buildCommandCenter} = context.CommandCenterCore;

test('builds a source-diverse Morning 5 in priority order', () => {
  const now = Date.parse('2026-08-12T01:00:00Z');
  const result = buildCommandCenter({
    today: '2026-08-12',
    briefing: {sections: {global: [{headline: 'Claims disruption', relevance_level: 'high'}]}},
    radar: {signals: [{symbol: 'NVDA', status: 'confirmed', score: 88}]},
    markets: {markets: [{slug: 'rates', label: 'Rate cut', priceChange: 0.04, attentionScore: 70}]},
    decisions: [{id: 'd1', asset: 'GLD', action: 'took', status: 'open', createdDate: '2026-08-10'}],
    sports: {modules: {nba: {title: 'NBA', watchlist: [{team: 'Lakers'}], upcoming: [{id: 'g1', home: 'Lakers', away: 'Knicks', utcDate: '2026-08-12T12:00:00Z'}]}}}
  }, now);
  assert.equal(result.morningFive.length, 5);
  assert.equal(new Set(result.morningFive.map(item => item.source)).size, 5);
  assert.equal(result.morningFive[0].source, 'Decisions');
});

test('raises failed or stale feed health above content', () => {
  const now = Date.parse('2026-08-12T01:00:00Z');
  const result = buildCommandCenter({health: {feeds: {
    radar: {status: 'failed', lastOkAt: '2026-08-11T00:00:00Z', message: 'provider timeout'},
    sports: {status: 'ok', lastOkAt: '2026-08-09T00:00:00Z'}
  }}}, now);
  assert.equal(Array.from(result.items, item => item.id).join(','), 'health-radar,health-sports');
  assert.equal(result.items[0].score, 100);
  assert.match(result.items[0].detail, /provider timeout/);
});

test('keeps low-relevance briefing noise out of the queue', () => {
  const result = buildCommandCenter({briefing: {sections: {global: [
    {headline: 'Relevant', relevance_level: 'medium'},
    {headline: 'Noise', relevance_level: 'low'}
  ]}}}, Date.now());
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Relevant');
});

test('applies source weights and explains the resulting score', () => {
  const result = buildCommandCenter({
    today: '2026-08-12',
    radar: {signals: [{symbol: 'NVDA', status: 'confirmed', score: 80}]},
    preferences: {sourceWeights: {Radar: 0.5}}
  }, Date.parse('2026-08-12T01:00:00Z'));
  assert.equal(result.items[0].preferenceWeight, 0.5);
  assert.equal(result.items[0].score, Math.round(result.items[0].baseScore * 0.5));
  assert.ok(Array.from(result.items[0].scoreBreakdown).some(line => /Source weight/.test(line)));
});

test('quiet sources hide ordinary items while pins override quiet and sort first', () => {
  const result = buildCommandCenter({
    today: '2026-08-12',
    briefing: {sections: {global: [{headline: 'Pinned brief', relevance_level: 'high'}]}},
    radar: {signals: [{symbol: 'NVDA', status: 'confirmed', score: 99}]},
    preferences: {
      quietSources: ['Briefing', 'Radar'],
      daily: {date: '2026-08-12', pinned: ['briefing-global-0'], dismissed: []}
    }
  }, Date.parse('2026-08-12T01:00:00Z'));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'briefing-global-0');
  assert.equal(result.items[0].pinned, true);
  assert.equal(result.items[0].score, 110);
  assert.equal(result.counts.hidden, 1);
});

test('today dismissals remove matching items but expire on a new date', () => {
  const input = {
    today: '2026-08-12',
    radar: {signals: [{symbol: 'NVDA', status: 'confirmed', score: 90}]},
    preferences: {daily: {date: '2026-08-12', pinned: [], dismissed: ['radar-NVDA']}}
  };
  assert.equal(buildCommandCenter(input, Date.parse('2026-08-12T01:00:00Z')).items.length, 0);
  input.today = '2026-08-13';
  assert.equal(buildCommandCenter(input, Date.parse('2026-08-13T01:00:00Z')).items.length, 1);
});
