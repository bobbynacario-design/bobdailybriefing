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

// ── Insurance news (news/ feed) ──

const NEWS_NOW = Date.parse('2026-08-29T01:00:00Z');

function newsInput(over) {
  return Object.assign({
    today: '2026-08-29',
    news: {
      date: '2026-08-29',
      generatedAt: '2026-08-29T00:52:53Z',
      items: [
        {id: 'a', title: 'Supply chain cyber cover gap', url: 'https://pub/a', source: 'Insurance Business AU', tier: 'core', score: 50, ageDays: 1.7},
        {id: 'b', title: 'Code feedback published', url: 'https://pub/b', source: 'insuranceNEWS.com.au', tier: 'context', score: 41, ageDays: 0.8},
        {id: 'c', title: 'Broker network expands', url: 'https://pub/c', source: 'insuranceNEWS.com.au', tier: 'trade', score: 30, ageDays: 2}
      ]
    }
  }, over || {});
}

test('surfaces insurance news as monitor items carrying the publisher url', () => {
  const result = buildCommandCenter(newsInput(), NEWS_NOW);
  const news = result.items.filter(item => item.source === 'News');
  assert.equal(news.length, 2, 'core and context only');
  assert.equal(news[0].title, 'Supply chain cyber cover gap');
  assert.equal(news[0].url, 'https://pub/a');
  assert.equal(news[0].page, 'today');
  assert.match(news[0].basis, /^Core insurance story from Insurance Business AU/);
  assert.match(news[0].detail, /1\.7d old/);
});

test('news never claims act, so it cannot outrank real act items', () => {
  const result = buildCommandCenter(newsInput(), NEWS_NOW);
  const news = result.items.filter(item => item.source === 'News');
  assert.ok(news.length);
  assert.ok(news.every(item => item.urgency === 'monitor'));
});

test('trade and general tier stories stay out of the attention queue', () => {
  const result = buildCommandCenter(newsInput(), NEWS_NOW);
  const titles = result.items.filter(item => item.source === 'News').map(item => item.title);
  assert.ok(!titles.includes('Broker network expands'));
});

test('at most three news items reach the queue', () => {
  const many = [];
  for (let i = 0; i < 9; i++) {
    many.push({id: 'n' + i, title: 'Story ' + i, url: 'https://pub/' + i, source: 'insuranceNEWS.com.au', tier: 'core', score: 50 - i, ageDays: 1});
  }
  const result = buildCommandCenter(newsInput({news: {generatedAt: '2026-08-29T00:52:53Z', items: many}}), NEWS_NOW);
  assert.equal(result.items.filter(item => item.source === 'News').length, 3);
});

test('a stale news snapshot contributes nothing rather than replaying old headlines', () => {
  const result = buildCommandCenter(
    newsInput({news: {generatedAt: '2026-08-26T00:00:00Z', items: newsInput().news.items}}), NEWS_NOW);
  assert.equal(result.items.filter(item => item.source === 'News').length, 0);
});

test('a snapshot with no timestamp is not treated as current', () => {
  const result = buildCommandCenter(newsInput({news: {items: newsInput().news.items}}), NEWS_NOW);
  assert.equal(result.items.filter(item => item.source === 'News').length, 0);
});

test('news counts toward Morning 5 source diversity', () => {
  const result = buildCommandCenter(newsInput({
    radar: {signals: [{symbol: 'NVDA', status: 'confirmed', score: 88}]},
    decisions: [{id: 'd1', asset: 'GLD', action: 'took', status: 'open', createdDate: '2026-08-27'}]
  }), NEWS_NOW);
  assert.ok(result.morningFive.some(item => item.source === 'News'));
  assert.ok(result.counts.sources >= 3);
});

test('news honours source weights and can be quieted like any other source', () => {
  const weighted = buildCommandCenter(newsInput({
    preferences: {sourceWeights: {News: 0.5}}
  }), NEWS_NOW).items.filter(item => item.source === 'News');
  assert.equal(weighted[0].score, 37, 'base 74 x 0.5');

  const quiet = buildCommandCenter(newsInput({
    preferences: {quietSources: ['News']}
  }), NEWS_NOW).items.filter(item => item.source === 'News');
  assert.equal(quiet.length, 0);
});

test('a failed news refresh is reported as a reliability item that cannot be quieted', () => {
  const result = buildCommandCenter({
    today: '2026-08-29',
    health: {feeds: {news: {status: 'failed', lastOkAt: '2026-08-28T00:00:00Z', message: 'all 9 feeds failed'}}},
    preferences: {quietSources: ['Reliability', 'News']}
  }, NEWS_NOW);
  const health = result.items.filter(item => item.source === 'Reliability');
  assert.equal(health.length, 1);
  assert.equal(health[0].title, 'Insurance news refresh failed');
  assert.equal(health[0].page, 'today');
  assert.equal(health[0].urgency, 'act');
});

test('a news feed that has not run for over 30 hours is reported stale', () => {
  const result = buildCommandCenter({
    today: '2026-08-29',
    health: {feeds: {news: {status: 'ok', lastOkAt: '2026-08-27T00:00:00Z'}}}
  }, NEWS_NOW);
  assert.equal(result.items[0].title, 'Insurance news feed is stale');
});
