// news/rank.test.js — the ranker is pure and takes its clock from the caller,
// so every case below is deterministic.
//
// Assertions are structural (ordering, flags, provenance) rather than exact
// scores: the weights in config.js are meant to be tuned, and a test that locks
// them to the decimal makes tuning look like breakage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankNews, dedupeKey, scoreItem } from './rank.js';
import { CONFIG as REAL_CONFIG } from './config.js';

var NOW = Date.parse('2026-08-29T00:00:00.000Z');
var DAY = 86400000;

function iso(daysAgo) { return new Date(NOW - daysAgo * DAY).toISOString(); }

var CONFIG = {
  feeds: [
    { id: 'reg',   url: 'https://x/reg',   source: 'insuranceNEWS.com.au',  section: 'Regulatory', priority: 5 },
    { id: 'daily', url: 'https://x/daily', source: 'insuranceNEWS.com.au',  section: 'Daily',      priority: 5 },
    { id: 'ib',    url: 'https://x/ib',    source: 'Insurance Business AU', section: 'Australia',  priority: 4 },
    { id: 'intl',  url: 'https://x/intl',  source: 'insuranceNEWS.com.au',  section: 'Intl',       priority: 2 }
  ],
  window: { lookbackDays: 10, staleFeedDays: 14, maxItems: 3, maxSummaryChars: 320, keepUndated: true },
  keywords: {
    core: ['business interruption', 'reinsurance'],
    context: ['apra', 'flood'],
    trade: ['broker']
  },
  scoring: {
    feedPriorityWeight: 3, coreHit: 9, contextHit: 4, tradeHit: 1.5,
    maxKeywordScore: 34, recencyMax: 18, titleBonus: 1.4
  }
};

function item(over) {
  return Object.assign({
    title: 'A story', url: 'https://news.example/a', summary: '', publishedAt: iso(1)
  }, over || {});
}

function ok(feedId, items, over) {
  return Object.assign({ feedId: feedId, status: 'ok', httpStatus: 200, dialect: 'rss', items: items, durationMs: 5 }, over || {});
}

test('a story arriving through two feeds is kept once and attributed to the higher-priority feed', function () {
  var story = { title: 'Flood inquiry opens', url: 'https://news.example/flood', summary: '', publishedAt: iso(1) };
  var doc = rankNews([
    ok('intl', [story]),
    ok('reg', [story])
  ], CONFIG, { now: NOW, dateKey: '2026-08-29' });

  assert.equal(doc.counts.unique, 1);
  assert.equal(doc.items[0].feedId, 'reg', 'priority 5 feed wins over priority 2');
  assert.deepEqual(doc.items[0].alsoIn, ['intl'], 'the other feed is recorded, not lost');
});

test('duplicate URLs differing only by query, fragment, scheme or trailing slash collapse', function () {
  var base = 'https://news.example/story';
  var doc = rankNews([
    ok('reg', [item({ url: base })]),
    ok('daily', [item({ url: 'http://www.news.example/story/?utm_source=rss#top' })])
  ], CONFIG, { now: NOW });
  assert.equal(doc.counts.unique, 1);
  assert.equal(doc.feeds.filter(function (f) { return f.id === 'daily'; })[0].duplicates, 1);
});

test('items older than the lookback window are excluded', function () {
  var doc = rankNews([ok('reg', [
    item({ url: 'https://news.example/fresh', publishedAt: iso(2) }),
    item({ url: 'https://news.example/stale', publishedAt: iso(30) })
  ])], CONFIG, { now: NOW });
  assert.equal(doc.counts.unique, 1);
  assert.equal(doc.items[0].url, 'https://news.example/fresh');
});

test('an undated item is kept and flagged, never given a fabricated date', function () {
  var doc = rankNews([ok('reg', [item({ url: 'https://news.example/undated', publishedAt: null })])],
    CONFIG, { now: NOW });
  assert.equal(doc.counts.undated, 1);
  assert.equal(doc.items[0].undated, true);
  assert.equal(doc.items[0].publishedAt, null);
  assert.equal(doc.items[0].ageDays, null);
});

test('undated items can be excluded by config', function () {
  var strict = Object.assign({}, CONFIG, { window: Object.assign({}, CONFIG.window, { keepUndated: false }) });
  var doc = rankNews([ok('reg', [item({ publishedAt: null })])], strict, { now: NOW });
  assert.equal(doc.counts.unique, 0);
});

test('a core-vocabulary story outranks a trade story from the same feed and day', function () {
  var doc = rankNews([ok('reg', [
    item({ title: 'Broker network expands', url: 'https://news.example/trade' }),
    item({ title: 'Business interruption claim disputed', url: 'https://news.example/core' })
  ])], CONFIG, { now: NOW });
  assert.equal(doc.items[0].url, 'https://news.example/core');
  assert.equal(doc.items[0].tier, 'core');
  assert.equal(doc.items[1].tier, 'trade');
});

test('tier reports which vocabulary was hit, independent of the numeric score', function () {
  var doc = rankNews([ok('reg', [item({ title: 'Nothing relevant here', url: 'https://news.example/x' })])],
    CONFIG, { now: NOW });
  assert.equal(doc.items[0].tier, 'general');
  assert.deepEqual(doc.items[0].tags, []);
  assert.ok(doc.items[0].score > 0, 'feed priority and recency still rank it');
});

test('a title hit is weighted above the same term in the summary', function () {
  var doc = rankNews([ok('reg', [
    item({ title: 'APRA update', url: 'https://news.example/title-hit' }),
    item({ title: 'Quiet week', url: 'https://news.example/body-hit', summary: 'A note on APRA.' })
  ])], CONFIG, { now: NOW });
  assert.equal(doc.items[0].url, 'https://news.example/title-hit');
});

test('newer wins between otherwise identical items', function () {
  var doc = rankNews([ok('reg', [
    item({ title: 'Flood inquiry', url: 'https://news.example/old', publishedAt: iso(8) }),
    item({ title: 'Flood inquiry', url: 'https://news.example/new', publishedAt: iso(0) })
  ])], CONFIG, { now: NOW });
  assert.equal(doc.items[0].url, 'https://news.example/new');
});

test('items are capped at maxItems while counts report the full unique yield', function () {
  var many = [];
  for (var i = 0; i < 9; i++) many.push(item({ url: 'https://news.example/' + i }));
  var doc = rankNews([ok('reg', many)], CONFIG, { now: NOW });
  assert.equal(doc.counts.unique, 9);
  assert.equal(doc.items.length, 3);
  assert.equal(doc.counts.kept, 3);
});

test('a feed that answers 200 with zero parseable items is empty, not ok', function () {
  var doc = rankNews([ok('ib', [], { dialect: 'unknown' })], CONFIG, { now: NOW });
  var row = doc.feeds.filter(function (f) { return f.id === 'ib'; })[0];
  assert.equal(row.status, 'empty');
  assert.ok(doc.warnings.some(function (w) { return w.indexOf('ib') === 0; }));
});

test('a failed feed still gets a named row and a warning', function () {
  var doc = rankNews([
    { feedId: 'reg', status: 'failed', httpStatus: 503, items: [], message: 'HTTP 503', durationMs: 9 },
    ok('daily', [item()])
  ], CONFIG, { now: NOW });
  var row = doc.feeds.filter(function (f) { return f.id === 'reg'; })[0];
  assert.equal(row.status, 'failed');
  assert.equal(row.httpStatus, 503);
  assert.equal(doc.counts.feedsFailed, 3, 'reg failed; ib and intl never reported');
  assert.ok(doc.warnings.some(function (w) { return w.indexOf('reg fetch failed') === 0; }));
});

test('every configured feed appears in the doc even when it was never fetched', function () {
  var doc = rankNews([ok('reg', [item()])], CONFIG, { now: NOW });
  assert.equal(doc.feeds.length, CONFIG.feeds.length);
});

test('a feed silent past staleFeedDays is flagged stale', function () {
  var doc = rankNews([ok('reg', [item({ publishedAt: iso(40) })])], CONFIG, { now: NOW });
  var row = doc.feeds.filter(function (f) { return f.id === 'reg'; })[0];
  assert.equal(row.stale, true);
  assert.equal(row.newestAgeDays, 40);
  assert.ok(doc.warnings.some(function (w) { return w.indexOf('reg has published nothing') === 0; }));
});

test('newestAt reflects the raw feed even when the item fell outside the window', function () {
  // The 40-day item is excluded from `items` but must still date the FEED, or a
  // weekly publisher looks dead every time its batch ages past the lookback.
  var doc = rankNews([ok('reg', [item({ publishedAt: iso(40) })])], CONFIG, { now: NOW });
  var row = doc.feeds.filter(function (f) { return f.id === 'reg'; })[0];
  assert.equal(row.fetched, 1);
  assert.equal(row.kept, 0);
  assert.equal(row.newestAt, iso(40));
});

test('an empty day is reported rather than hidden', function () {
  var doc = rankNews([ok('reg', [])], CONFIG, { now: NOW });
  assert.equal(doc.items.length, 0);
  assert.ok(doc.warnings.some(function (w) { return w.indexOf('no items inside') === 0; }));
});

test('the document carries its window and a plain-language note on what the score is not', function () {
  var doc = rankNews([ok('reg', [item()])], CONFIG, { now: NOW, dateKey: '2026-08-29' });
  assert.equal(doc.date, '2026-08-29');
  assert.equal(doc.window.lookbackDays, 10);
  assert.equal(doc.window.since, iso(10));
  assert.match(doc.note, /not a forecast/);
});

test('dedupeKey falls back to the title when an item has no url', function () {
  assert.equal(dedupeKey({ title: 'Flood inquiry opens', url: '' }), 't:flood-inquiry-opens');
  assert.equal(dedupeKey({ title: '', url: '' }), '');
});

// Added with the network and trucking feeds: his quantum topics score as core
// terms, and a short regulator acronym never matches inside another word.
test('network and heavy-vehicle cost stories rank on his quantum terms', () => {
  var feed = REAL_CONFIG.feeds.find(function (f) { return f.id === 'ata'; });
  assert.ok(feed, 'the trucking association feed is configured');
  var truck = scoreItem({ title: 'Prime mover repair times blow out as parts shortage bites', summary: 'Operators report longer downtime.', publishedAt: iso(1) }, feed, REAL_CONFIG, NOW);
  var awards = scoreItem({ title: 'Association announces award finalists', summary: 'A night of celebration.', publishedAt: iso(1) }, feed, REAL_CONFIG, NOW);
  assert.ok(truck.score > awards.score + 20, 'core terms lift a real cost story well above industry awards');
  var aerial = scoreItem({ title: 'Aerial survey of new estate', summary: '', publishedAt: iso(1) }, feed, REAL_CONFIG, NOW);
  assert.equal(aerial.score, awards.score, 'no regulator term matches inside "aerial"');
  ['ena', 'esd', 'aemc', 'ata', 'nhvr', 'truckbus'].forEach(function (id) {
    assert.ok(REAL_CONFIG.feeds.some(function (f) { return f.id === id; }), id + ' is configured');
  });
});

// Network and trucking stories rarely outscore insurance trade press. Up to
// window.beatSlots of them keep a place, but only with a core or context hit.
test('network and trucking stories with a keyword hit keep reserved places; fluff does not', function () {
  var config = JSON.parse(JSON.stringify(CONFIG));
  config.feeds.push({ id: 'trucks', url: 'https://x/trucks', source: 'Trucking', section: 'Trucking', priority: 1, lane: 'beats' });
  config.window.beatSlots = 1;
  var doc = rankNews([
    ok('reg', [item({ title: 'Reinsurance one', url: 'https://n/1' }), item({ title: 'Reinsurance two', url: 'https://n/2' }), item({ title: 'Reinsurance three', url: 'https://n/3' })]),
    ok('trucks', [item({ title: 'Flood closes the highway for trucks', url: 'https://t/1' }), item({ title: 'Driver of the year named', url: 'https://t/2' })])
  ], config, { now: NOW });
  var titles = doc.items.map(function (e) { return e.title; });
  assert.equal(doc.items.length, 3, 'the list is still maxItems long');
  assert.ok(titles.indexOf('Flood closes the highway for trucks') >= 0, 'a trucking story with a context hit keeps its place');
  assert.ok(titles.indexOf('Driver of the year named') < 0, 'no keyword hit, no reserved place');
  assert.equal(doc.items.filter(function (e) { return e.lane === 'beats'; }).length, 1);
  assert.equal(doc.items[doc.items.length - 1].title, 'Flood closes the highway for trucks', 'still ordered by score');
});
