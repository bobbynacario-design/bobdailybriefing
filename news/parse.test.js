// news/parse.test.js — the parser is pure, so every case runs offline.
//
// The fixtures below are trimmed from the REAL bodies fetched on 2026-08-29,
// including insuranceNEWS's double-encoded entities and Insurance Business AU's
// Atom shape. If a publisher changes dialect, these are the tests that should
// fail first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, decodeEntities, toPlainText } from './parse.js';

var RSS = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>' +
  '<title>insuranceNEWS.com.au - Regulatory &amp; Government</title>' +
  '<item>' +
  '<title>Move to reform &#8216;essential&#8217; last resort compo scheme</title>' +
  '<link>https://www.insurancenews.com.au/regulatory-government/move-to-reform</link>' +
  '<guid isPermaLink="true">https://www.insurancenews.com.au/regulatory-government/move-to-reform</guid>' +
  '<description>&lt;p&gt;The scheme &amp;ldquo;remains an essential backstop&amp;rdquo; for consumers...&lt;/p&gt;</description>' +
  '<pubDate>Mon, 24 Aug 2026 04:42:24 GMT</pubDate>' +
  '</item>' +
  '<item>' +
  '<title>Bank faces record penalty over cybersecurity failings</title>' +
  '<link>https://www.insurancenews.com.au/regulatory-government/bank-faces-record-penalty</link>' +
  '<description>&lt;p&gt;Bendigo and Adelaide Bank faces an $8 million fine...&lt;/p&gt;</description>' +
  '<pubDate>Mon, 17 Aug 2026 04:03:07 GMT</pubDate>' +
  '</item>' +
  '</channel></rss>';

var ATOM = '<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom">' +
  '<title type="text">Insurance Business</title>' +
  '<link rel="self" href="https://www.insurancebusinessmag.com/au/rss/" />' +
  '<entry>' +
  '<id>tag:insurancebusinessmag.com,2026-08-29:/au/news/cyber/587796</id>' +
  '<title type="text">Cyber underwriter blames insurers for stalled SME take-up</title>' +
  '<updated>2026-08-28T14:59:00Z</updated>' +
  '<link rel="alternate" href="https://www.insurancebusinessmag.com/au/news/cyber/stalled-587796.aspx" />' +
  '<content type="html">&lt;p&gt;The barrier isn\'t price&lt;/p&gt;&lt;img src="x.png" /&gt;</content>' +
  '</entry>' +
  '</feed>';

test('reads RSS 2.0 items with dialect reported', function () {
  var out = parseFeed(RSS);
  assert.equal(out.dialect, 'rss');
  assert.equal(out.itemCount, 2);
  assert.equal(out.items[0].url, 'https://www.insurancenews.com.au/regulatory-government/move-to-reform');
  assert.equal(out.items[0].publishedAt, '2026-08-24T04:42:24.000Z');
});

test('reads Atom entries, which carry no <item> at all', function () {
  var out = parseFeed(ATOM);
  assert.equal(out.dialect, 'atom');
  assert.equal(out.itemCount, 1);
  // The regression this guards: an RSS-only reader returns zero here and no error.
  assert.equal(out.items[0].title, 'Cyber underwriter blames insurers for stalled SME take-up');
  assert.equal(out.items[0].publishedAt, '2026-08-28T14:59:00.000Z');
});

test('Atom link prefers rel=alternate over the feed-level self link', function () {
  var out = parseFeed(ATOM);
  assert.equal(out.items[0].url, 'https://www.insurancebusinessmag.com/au/news/cyber/stalled-587796.aspx');
});

test('double-encoded entities decode fully and HTML is stripped', function () {
  var out = parseFeed(RSS);
  // Raw carried `&amp;ldquo;`: one decode pass leaves `&ldquo;` visible.
  assert.ok(!/&/.test(out.items[0].summary), 'no residual entity: ' + out.items[0].summary);
  assert.ok(!/[<>]/.test(out.items[0].summary), 'no residual markup');
  assert.ok(out.items[0].summary.indexOf('remains an essential backstop') >= 0);
});

test('numeric entities decode in titles', function () {
  var out = parseFeed(RSS);
  assert.equal(out.items[0].title, 'Move to reform ‘essential’ last resort compo scheme');
});

test('summary truncation respects a word boundary', function () {
  var out = parseFeed(RSS, { maxSummaryChars: 20 });
  assert.ok(out.items[0].summary.length <= 21, out.items[0].summary);
  assert.ok(out.items[0].summary.endsWith('…'));
});

test('an unparseable body reports unknown rather than throwing', function () {
  var out = parseFeed('<html><body>not a feed</body></html>');
  assert.equal(out.dialect, 'unknown');
  assert.equal(out.itemCount, 0);
});

test('empty and null bodies are safe', function () {
  assert.equal(parseFeed('').itemCount, 0);
  assert.equal(parseFeed(null).itemCount, 0);
});

test('items with neither title nor url are dropped', function () {
  var out = parseFeed('<rss><channel><item><pubDate>Mon, 24 Aug 2026 04:42:24 GMT</pubDate></item></channel></rss>');
  assert.equal(out.itemCount, 0);
});

test('an unparseable date yields null, never a fabricated one', function () {
  var out = parseFeed('<rss><channel><item><title>T</title><link>https://x/1</link><pubDate>soon</pubDate></item></channel></rss>');
  assert.equal(out.items[0].publishedAt, null);
});

test('CDATA is unwrapped', function () {
  var out = parseFeed('<rss><channel><item><title><![CDATA[Flood & storm]]></title><link>https://x/1</link></item></channel></rss>');
  assert.equal(out.items[0].title, 'Flood & storm');
});

test('decodeEntities and toPlainText are exported for reuse', function () {
  assert.equal(decodeEntities('&amp;lt;'), '<');
  assert.equal(toPlainText('<p>a</p><p>b</p>'), 'a b');
});
