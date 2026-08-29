// news/rank.js
//
// PURE — no I/O, no network, no clock of its own (the caller passes `now`).
// Takes what refresh-news.js fetched and parsed, and produces the document that
// gets written to Firestore: deduped, scored, ranked items plus a per-feed
// health block.
//
// This is the radar/scoring.js arrangement: the runner does every side effect,
// this file does every judgement, and the judgement is testable offline against
// fixtures. Nothing here decides WHETHER to write — that stays in the runner.
//
// What this file deliberately does NOT do: infer, summarize, rewrite or
// editorialize a headline. Items are carried through verbatim from the
// publisher with a computed rank attached. The score is an ordering device for
// one morning's reading, not a claim about importance, and the doc says so.

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value == null ? '' : value).trim(); }

// Dedupe key: scheme-less host + path, lowercased, query and fragment stripped.
//
// MEASURED 2026-08-29: across all nine feeds, 204 items yielded 204 distinct
// titles and zero duplicate URLs. The section feeds are genuinely disjoint —
// `daily` is its own section, NOT a roll-up of the others, which is what a
// reasonable person would assume from the name. So this is a guard, not a hot
// path, and the counts it reports are expected to read zero. If `duplicates`
// starts climbing, a publisher has changed how it syndicates and the config's
// feed selection deserves a fresh look rather than silent absorption.
//
// Falls back to the normalized title when an item has no URL at all, so an
// untitled-but-linked and a linked-but-untitled item never collide on an
// empty key.
function dedupeKey(item) {
  var url = text(item && item.url);
  if (url) {
    var stripped = url
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('#')[0]
      .split('?')[0]
      .replace(/\/+$/, '')
      .toLowerCase();
    if (stripped) return 'u:' + stripped;
  }
  var title = text(item && item.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return title ? 't:' + title : '';
}

// Count DISTINCT matched terms per tier, weighting a title hit above a summary
// hit. Distinct rather than total occurrences: an article that says "flood" nine
// times is not nine times more relevant than one that says it once.
function matchTerms(haystackTitle, haystackBody, terms, hitWeight, titleBonus) {
  var matched = [];
  var score = 0;
  arr(terms).forEach(function (term) {
    var needle = String(term).toLowerCase();
    var inTitle = haystackTitle.indexOf(needle) >= 0;
    var inBody = haystackBody.indexOf(needle) >= 0;
    if (!inTitle && !inBody) return;
    matched.push(term);
    score += hitWeight * (inTitle ? titleBonus : 1);
  });
  return { matched: matched, score: score };
}

// Linear recency decay across the window: newest possible = full marks, an item
// at the far edge of the lookback = zero. Undated items score zero here and are
// flagged `undated` — they are not given a pretend date, and they are not
// dropped either, so a publisher that stops stamping dates degrades the ranking
// rather than silently emptying the feed.
function recencyScore(publishedAt, nowMs, lookbackDays, recencyMax) {
  if (!publishedAt) return 0;
  var ms = Date.parse(publishedAt);
  if (!isFinite(ms)) return 0;
  var ageDays = (nowMs - ms) / 86400000;
  if (ageDays <= 0) return recencyMax;
  if (ageDays >= lookbackDays) return 0;
  return recencyMax * (1 - ageDays / lookbackDays);
}

function ageDays(publishedAt, nowMs) {
  if (!publishedAt) return null;
  var ms = Date.parse(publishedAt);
  if (!isFinite(ms)) return null;
  return Math.max(0, (nowMs - ms) / 86400000);
}

function scoreItem(item, feed, config, nowMs) {
  var scoring = config.scoring;
  var keywords = config.keywords;
  var title = text(item.title).toLowerCase();
  var body = text(item.summary).toLowerCase();

  var core = matchTerms(title, body, keywords.core, scoring.coreHit, scoring.titleBonus);
  var context = matchTerms(title, body, keywords.context, scoring.contextHit, scoring.titleBonus);
  var trade = matchTerms(title, body, keywords.trade, scoring.tradeHit, scoring.titleBonus);

  var keywordScore = Math.min(scoring.maxKeywordScore, core.score + context.score + trade.score);
  var feedScore = Number(feed.priority || 0) * scoring.feedPriorityWeight;
  var recency = recencyScore(item.publishedAt, nowMs, config.window.lookbackDays, scoring.recencyMax);

  // Tier is the honest one-word answer to "why is this here": which vocabulary
  // it actually hit. It is NOT derived from the numeric score, so a high-scoring
  // trade item cannot dress itself up as core work.
  var tier = core.matched.length ? 'core' : (context.matched.length ? 'context' : (trade.matched.length ? 'trade' : 'general'));

  return {
    score: Math.round((feedScore + keywordScore + recency) * 10) / 10,
    tier: tier,
    tags: core.matched.concat(context.matched).concat(trade.matched).slice(0, 12),
    components: {
      feed: Math.round(feedScore * 10) / 10,
      keywords: Math.round(keywordScore * 10) / 10,
      recency: Math.round(recency * 10) / 10
    }
  };
}

// Build the day's document.
//
// `feedResults` is one entry per configured feed, as produced by the runner:
//   { feedId, status: 'ok'|'failed', httpStatus, dialect, items: [...], message, durationMs }
// A feed that failed contributes no items but still gets a row in `feeds`, so
// the front end can show a named source as broken instead of it just vanishing.
function rankNews(feedResults, config, options) {
  options = options || {};
  var nowMs = options.now == null ? Date.now() : Number(options.now);
  var dateKey = options.dateKey || '';
  var lookbackDays = config.window.lookbackDays;
  var cutoffMs = nowMs - lookbackDays * 86400000;

  var byId = {};
  arr(config.feeds).forEach(function (feed) { byId[feed.id] = feed; });

  var seen = {};
  var kept = [];
  var fetchedTotal = 0;
  var undatedCount = 0;
  var perFeed = {};

  arr(feedResults).forEach(function (result) {
    var feed = byId[result.feedId];
    if (!feed) return;
    var items = arr(result.items);
    fetchedTotal += items.length;
    var newestMs = null;
    items.forEach(function (item) {
      var ms = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
      if (isFinite(ms) && (newestMs == null || ms > newestMs)) newestMs = ms;
    });
    perFeed[feed.id] = {
      fetched: items.length,
      kept: 0,
      duplicates: 0,
      newestAt: newestMs == null ? null : new Date(newestMs).toISOString()
    };
  });

  // Highest-priority feed wins a duplicate, so a story reaching us through both
  // `daily` and its section feed is attributed to whichever we rank higher, and
  // the other feed is recorded in `alsoIn` rather than lost. Config order breaks
  // ties, which is why FEEDS is written in priority order.
  var ordered = arr(feedResults).slice().sort(function (a, b) {
    var fa = byId[a.feedId], fb = byId[b.feedId];
    var pa = fa ? Number(fa.priority || 0) : -1;
    var pb = fb ? Number(fb.priority || 0) : -1;
    if (pb !== pa) return pb - pa;
    return arr(config.feeds).indexOf(fa) - arr(config.feeds).indexOf(fb);
  });

  ordered.forEach(function (result) {
    var feed = byId[result.feedId];
    if (!feed) return;
    arr(result.items).forEach(function (item) {
      var key = dedupeKey(item);
      if (!key) return;

      if (seen[key]) {
        if (seen[key].alsoIn.indexOf(feed.id) < 0) seen[key].alsoIn.push(feed.id);
        perFeed[feed.id].duplicates++;
        return;
      }

      // Window filter. Undated items are kept when config says so — see
      // recencyScore: they rank at the bottom and are labelled, which beats
      // dropping a real story because a publisher omitted a timestamp.
      var ms = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
      var dated = isFinite(ms);
      if (dated && ms < cutoffMs) return;
      if (!dated && !config.window.keepUndated) return;
      if (!dated) undatedCount++;

      var scored = scoreItem(item, feed, config, nowMs);
      var age = ageDays(item.publishedAt, nowMs);
      var entry = {
        id: feed.id + ':' + key.slice(0, 180),
        title: item.title,
        url: item.url,
        summary: item.summary,
        publishedAt: item.publishedAt || null,
        undated: !dated,
        ageDays: age == null ? null : Math.round(age * 10) / 10,
        feedId: feed.id,
        source: feed.source,
        section: feed.section,
        alsoIn: [],
        score: scored.score,
        tier: scored.tier,
        tags: scored.tags,
        components: scored.components
      };
      seen[key] = entry;
      kept.push(entry);
      perFeed[feed.id].kept++;
    });
  });

  kept.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    var at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    var bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    if (bt !== at) return bt - at;
    return text(a.title).localeCompare(text(b.title));
  });

  var uniqueCount = kept.length;
  var items = kept.slice(0, config.window.maxItems);

  var warnings = [];
  var feeds = arr(config.feeds).map(function (feed) {
    var result = arr(feedResults).filter(function (r) { return r.feedId === feed.id; })[0] || {};
    var stats = perFeed[feed.id] || { fetched: 0, kept: 0, duplicates: 0, newestAt: null };
    var age = ageDays(stats.newestAt, nowMs);
    var status = result.status === 'ok' ? 'ok' : 'failed';

    // A feed that answered 200 and parsed to zero items is NOT healthy — that is
    // the shape a moved endpoint or a changed dialect takes, and it is exactly
    // the failure the whole module exists to make visible.
    if (status === 'ok' && stats.fetched === 0) {
      status = 'empty';
      warnings.push(feed.id + ' returned no parseable items (endpoint or feed format may have changed)');
    }
    if (status === 'failed') {
      warnings.push(feed.id + ' fetch failed: ' + (text(result.message) || 'unknown error'));
    }
    var stale = age != null && age > config.window.staleFeedDays;
    if (stale) {
      warnings.push(feed.id + ' has published nothing for ' + Math.round(age) + ' days');
    }
    return {
      id: feed.id,
      source: feed.source,
      section: feed.section,
      url: feed.url,
      priority: feed.priority,
      status: status,
      httpStatus: result.httpStatus == null ? null : Number(result.httpStatus),
      dialect: text(result.dialect) || null,
      fetched: stats.fetched,
      kept: stats.kept,
      duplicates: stats.duplicates,
      newestAt: stats.newestAt,
      newestAgeDays: age == null ? null : Math.round(age * 10) / 10,
      stale: !!stale,
      message: text(result.message).slice(0, 300) || null,
      durationMs: result.durationMs == null ? null : Math.round(result.durationMs)
    };
  });

  var feedsOk = feeds.filter(function (f) { return f.status === 'ok'; }).length;
  if (!items.length) warnings.push('no items inside the ' + lookbackDays + '-day window');

  return {
    date: dateKey,
    generatedAt: new Date(nowMs).toISOString(),
    window: {
      lookbackDays: lookbackDays,
      since: new Date(cutoffMs).toISOString(),
      maxItems: config.window.maxItems
    },
    counts: {
      feeds: feeds.length,
      feedsOk: feedsOk,
      feedsFailed: feeds.length - feedsOk,
      fetched: fetchedTotal,
      unique: uniqueCount,
      kept: items.length,
      undated: undatedCount
    },
    items: items,
    feeds: feeds,
    warnings: warnings,
    note: 'Ranking orders one morning of reading by feed priority, keyword tier and recency. It is not a forecast, a confidence or a measure of importance. Headlines and summaries are the publisher’s own text, unedited.'
  };
}

export { rankNews, scoreItem, dedupeKey, recencyScore };
