// news/rank.test.js — the ranker is pure and takes its clock from the caller,
// so every case below is deterministic.
//
// Assertions are structural (ordering, flags, provenance) rather than exact
// scores: the weights in config.js are meant to be tuned, and a test that locks
// them to the decimal makes tuning look like breakage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankNews, dedupeKey, scoreItem, takeInTurn } from './rank.js';
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

// 4-6 Oct 2026: trucking took every reserved place and no network story reached
// the list; three of the five were NHVR's static pages.
test('reserved places go to each beat in turn, and a feed drops its non-news pages', function () {
  var config = JSON.parse(JSON.stringify(CONFIG));
  config.feeds.push({ id: 'trucks', url: 'https://x/trucks', source: 'Trucking', section: 'Trucking', priority: 3, lane: 'beats', beat: 'trucking', skipUrl: /\/node\/\d+\/?$/i });
  config.feeds.push({ id: 'grid', url: 'https://x/grid', source: 'Grid', section: 'Networks', priority: 1, lane: 'beats', beat: 'network' });
  config.window.beatSlots = 3;
  config.window.beatOrder = ['network', 'trucking'];
  var doc = rankNews([
    ok('reg', [1, 2, 3, 4].map(function (n) { return item({ title: 'Reinsurance ' + n, url: 'https://n/' + n }); })),
    ok('trucks', [item({ title: 'Flood closes the highway for trucks', url: 'https://t/1' }), item({ title: 'Flood delays freight', url: 'https://t/2' }),
      item({ title: 'Heavy vehicle page', summary: 'flood', url: 'https://t/node/4998' })]),
    ok('grid', [item({ title: 'Flood damages the distribution network', url: 'https://g/1' }), item({ title: 'Grid award night', url: 'https://g/2' })])
  ], config, { now: NOW });
  var beats = doc.items.filter(function (e) { return e.lane === 'beats'; }).map(function (e) { return e.title; }).sort();
  assert.deepEqual(beats, ['Flood closes the highway for trucks', 'Flood damages the distribution network', 'Flood delays freight'], 'the network story keeps a place; fluff still does not');
  assert.equal(doc.items.filter(function (e) { return e.title === 'Flood damages the distribution network'; })[0].beat, 'network');
  var trucks = doc.feeds.filter(function (f) { return f.id === 'trucks'; })[0];
  assert.equal(trucks.skipped, 1); assert.equal(trucks.kept, 2);
  assert.ok(!doc.items.some(function (e) { return /node/.test(e.url); }), 'a static page never enters the list');
});

test('takeInTurn alternates beats in order and hands an empty beat\'s turn on', function () {
  var e = function (beat, n) { return { beat: beat, n: n }; };
  var list = [e('trucking', 1), e('trucking', 2), e('trucking', 3), e('network', 1), e('', 1)];
  assert.deepEqual(takeInTurn(list, ['network', 'trucking'], 4).map(function (x) { return x.beat + x.n; }), ['network1', 'trucking1', '1', 'trucking2']);
  assert.deepEqual(takeInTurn(list, ['network', 'trucking'], 0), []);
  assert.deepEqual(takeInTurn([e('trucking', 1)], ['network', 'trucking'], 3).map(function (x) { return x.n; }), [1]);
});

test('the real config recognises the network businesses and his pole-strike costs, and skips NHVR pages', function () {
  var esd = REAL_CONFIG.feeds.find(function (f) { return f.id === 'esd'; });
  ['Powerlink appoints Zinfra for critical CQ transmission works', 'Ausgrid seeks cost pass-through for storm repairs', 'Ergon Energy crews restore power'].forEach(function (title) {
    var tier = scoreItem({ title: title, summary: '', publishedAt: iso(1) }, esd, REAL_CONFIG, NOW).tier;
    assert.ok(tier === 'core' || tier === 'context', title + ' qualifies for a beat place (' + tier + ')');
  });
  assert.equal(scoreItem({ title: 'Ergonomic chairs for the office', summary: '', publishedAt: iso(1) }, esd, REAL_CONFIG, NOW).tier, 'general', '"ergon energy", not "ergon"');
  var nhvr = REAL_CONFIG.feeds.find(function (f) { return f.id === 'nhvr'; });
  ['https://www.nhvr.gov.au/node/4998', 'https://www.nhvr.gov.au/events/tasmanian-safety-collaboration-forum-2026'].forEach(function (url) { assert.ok(nhvr.skipUrl.test(url), url); });
  assert.ok(!nhvr.skipUrl.test('https://www.nhvr.gov.au/news/2026/new-fatigue-rules'), 'a news release is kept');
  REAL_CONFIG.feeds.filter(function (f) { return f.lane === 'beats'; }).forEach(function (f) { assert.ok(f.beat === 'network' || f.beat === 'trucking', f.id + ' has a beat'); });
  assert.ok(REAL_CONFIG.feeds.some(function (f) { return f.id === 'reneweconomy'; }));
});

// 6 Oct 2026: a RenewEconomy story on Pacific diesel aid took a network place
// through "diesel", a trucking term.
test('a beat story takes a reserved place only with a hit on its own beat\'s terms', function () {
  var tiered = REAL_CONFIG.keywords.core.concat(REAL_CONFIG.keywords.context);
  Object.keys(REAL_CONFIG.beatTerms).forEach(function (beat) {
    REAL_CONFIG.beatTerms[beat].forEach(function (term) { assert.ok(tiered.indexOf(term) >= 0, beat + ' term "' + term + '" is a core or context keyword, so it can tag'); });
  });
  var rank = function (feedId, title) {
    var doc = rankNews([ok(feedId, [item({ title: title, url: 'https://x/' + feedId })])], REAL_CONFIG, { now: NOW });
    return doc.items[0];
  };
  assert.equal(rank('reneweconomy', 'Australia pledges $13 million to help Pacific nations quit diesel').beatHit, false, 'diesel is trucking, not network');
  assert.equal(rank('reneweconomy', 'Powerlink appoints Zinfra for critical CQ transmission works').beatHit, true);
  assert.equal(rank('truckbus', 'Diesel price spike hits haulage operators').beatHit, true);
  assert.equal(rank('in-daily', 'Ausgrid outage claims rise').beatHit, undefined, 'only beat stories carry it');
});
