// news/parse.js
//
// PURE — no I/O, no network. Turns one feed's XML body into normalized items.
//
// WHY A HAND-ROLLED PARSER: these are nine small, well-formed publisher feeds,
// and the alternative is adding an XML dependency to a module whose entire job
// is nine HTTP GETs. The repo already keeps its refresh workspaces to a single
// dependency (firebase-admin). A regex reader is the smaller risk here — but it
// is only defensible because the failure mode is loud: parseFeed reports the
// dialect it detected and how many items it found, and refresh-news.js records a
// feed that parsed to zero items as a FAILURE rather than an empty-but-fine day.
//
// TWO DIALECTS, because the sources genuinely differ (verified 2026-08-29):
//   RSS 2.0   insuranceNEWS.com.au   <item><title><link><guid><description><pubDate>
//   Atom      Insurance Business AU  <entry><title><link href><id><content><updated>
// Insurance Business AU has no <item> element at all. A reader that assumes RSS
// gets zero items from it and no error, which is the exact silent-emptiness this
// module is written to prevent.

// Entity decoding runs TWICE (bounded). insuranceNEWS double-encodes: the raw
// XML carries `&amp;ldquo;`, which one pass turns into `&ldquo;` and only a
// second pass turns into a real quote mark. Two passes is enough for every feed
// sampled; it is capped at two so a pathological input cannot loop.
var NAMED = {
  lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…', trade: '™',
  copy: '©', reg: '®', deg: '°', pound: '£', euro: '€'
};

function decodeOnce(text) {
  return String(text == null ? '' : text)
    .replace(/&#x([0-9a-fA-F]+);/g, function (m, hex) {
      var code = parseInt(hex, 16);
      return isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    })
    .replace(/&#(\d+);/g, function (m, dec) {
      var code = parseInt(dec, 10);
      return isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    })
    .replace(/&([a-zA-Z]+);/g, function (m, name) {
      var key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED, key) ? NAMED[key] : m;
    });
}

function decodeEntities(text) {
  return decodeOnce(decodeOnce(text));
}

function stripCdata(text) {
  return String(text == null ? '' : text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

// Decode BEFORE stripping tags: the descriptions arrive as escaped HTML
// (`&lt;p&gt;`), so tags only become tags after a decode pass. Stripping first
// would leave the markup intact as visible text.
function toPlainText(raw, maxChars) {
  var text = decodeEntities(stripCdata(raw))
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (maxChars && text.length > maxChars) {
    text = text.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
  }
  return text;
}

// First matching child tag, ignoring namespace prefixes (`<dc:date>` matches
// `date`). Non-greedy so it stops at the first close.
function tagText(block, name) {
  var re = new RegExp('<(?:[a-zA-Z0-9]+:)?' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?' + name + '>', 'i');
  var match = re.exec(block);
  return match ? match[1] : '';
}

function attr(tagSource, name) {
  var re = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i');
  var match = re.exec(tagSource);
  if (match) return match[1];
  re = new RegExp(name + "\\s*=\\s*'([^']*)'", 'i');
  match = re.exec(tagSource);
  return match ? match[1] : '';
}

// Atom puts the URL in an attribute and may carry several <link> elements
// (alternate, self, replies). Prefer rel="alternate"; fall back to the first
// link that has an href and is not explicitly rel="self".
function atomLink(block) {
  var links = block.match(/<link\b[^>]*\/?>/gi) || [];
  var fallback = '';
  for (var i = 0; i < links.length; i++) {
    var rel = attr(links[i], 'rel').toLowerCase();
    var href = decodeEntities(attr(links[i], 'href')).trim();
    if (!href) continue;
    if (rel === 'alternate') return href;
    if (!fallback && rel !== 'self') fallback = href;
  }
  return fallback;
}

// Feeds date-stamp in RFC-822 (`Mon, 24 Aug 2026 04:42:24 GMT`) or ISO 8601
// (`2026-08-28T14:59:00Z`). Date.parse handles both. Anything else returns null
// and the item is flagged undated rather than being given a fabricated date.
function toIso(raw) {
  var text = decodeEntities(stripCdata(raw)).trim();
  if (!text) return null;
  var ms = Date.parse(text);
  return isFinite(ms) ? new Date(ms).toISOString() : null;
}

function blocks(xml, name) {
  var re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'gi');
  var out = [];
  var match;
  while ((match = re.exec(xml)) !== null) out.push(match[1]);
  return out;
}

// Parse one feed body.
//   returns { dialect: 'rss'|'atom'|'unknown', items: [...], itemCount }
// Every item: { title, url, guid, summary, publishedAt (ISO or null) }.
// Items with no title AND no url are dropped — they carry nothing usable — but
// that is the only drop this function performs. Filtering by date or relevance
// is rank.js's job, so a caller can always see the raw yield of a feed.
function parseFeed(xml, options) {
  options = options || {};
  var maxSummaryChars = options.maxSummaryChars || 0;
  var body = String(xml == null ? '' : xml);

  var rssBlocks = blocks(body, 'item');
  var atomBlocks = rssBlocks.length ? [] : blocks(body, 'entry');
  var dialect = rssBlocks.length ? 'rss' : (atomBlocks.length ? 'atom' : 'unknown');
  var raw = rssBlocks.length ? rssBlocks : atomBlocks;

  var items = raw.map(function (block) {
    var isAtom = dialect === 'atom';
    var url = isAtom
      ? atomLink(block)
      : decodeEntities(stripCdata(tagText(block, 'link'))).trim();
    var summarySource = tagText(block, 'description') ||
      tagText(block, 'summary') ||
      tagText(block, 'content') ||
      tagText(block, 'encoded');
    var dateSource = tagText(block, 'pubDate') ||
      tagText(block, 'published') ||
      tagText(block, 'updated') ||
      tagText(block, 'date');
    return {
      title: toPlainText(tagText(block, 'title'), 0),
      url: url,
      guid: decodeEntities(stripCdata(tagText(block, 'guid') || tagText(block, 'id'))).trim(),
      summary: toPlainText(summarySource, maxSummaryChars),
      publishedAt: toIso(dateSource)
    };
  }).filter(function (item) {
    return item.title || item.url;
  });

  return { dialect: dialect, items: items, itemCount: items.length };
}

export { parseFeed, toPlainText, decodeEntities, toIso };
