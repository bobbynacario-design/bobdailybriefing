// news/config.js
//
// PURE config (no I/O) for the Australian insurance news feed. refresh-news.js
// reads FEEDS to fetch; rank.js receives this object and never imports it
// directly (mirrors how scoring.js is handed the radar config).
//
// WHY THIS FEED EXISTS: the briefing's `insurance` and `interruptions` sections
// are model-written with a hosted web_search tool (functions/index.js:151). That
// makes the most work-relevant part of the day non-deterministic — different
// sources every run, a `source` string with no URL behind it, and search tokens
// billed on every generate. This module fetches a NAMED, auditable set of
// Australian trade feeds instead, so those sections can later be grounded in
// stories that provably exist and carry a link into Evidence and Timelines.
//
// FEEDS VERIFIED 2026-08-29 (every URL fetched, status and shape recorded):
//   - All eight insuranceNEWS.com.au section feeds returned HTTP 200 / RSS 2.0
//     with 20 <item> each.
//   - insurancebusinessmag.com/au/rss returned HTTP 200 but is ATOM, not RSS —
//     44 <entry> elements, no <item> at all. A naive <item> parser silently
//     reads zero items from it, which is why parse.js handles both dialects.
//
// FRESHNESS IS NOT UNIFORM, and this drove the window design. Sampling the
// newest pubDate and the number of distinct publish timestamps per feed:
//   daily                  28 Aug    5 distinct   <- genuinely daily
//   the-broker             27 Aug    3
//   corporate / local /    24 Aug    4            <- 20 items across only four
//   international /                                  Monday batches: these are
//   regulatory-government  24 Aug    4               published WEEKLY
//   breaking-news          21 Aug   19            <- slow trickle, and despite
//                                                    the name the least fresh
//   insurancebusinessmag   28 Aug                 <- fresh
// So a "last 24 hours" window — the obvious choice — would return NOTHING from
// most of these feeds on most days. The window is a rolling multi-day lookback
// instead, and every feed reports its own newest item so a feed that has
// actually died stays distinguishable from one merely between weekly batches.

// Each feed: stable `id` (used as the dedupe precedence key), fetch `url`, the
// publisher label, its section, and `priority` 1-5 feeding the rank.
//
// Priority is set for BOB's work (forensic BI and claims quantum on Australian
// risks), not for general interest: regulatory-government is the backbone
// because it is where APRA, ASIC, AFCA and ICA developments surface without
// scraping regulator pages that publish no feed at all; daily is the freshness
// backbone; the-broker and analysis carry market-condition commentary.
var FEEDS = [
  { id: 'in-daily',      url: 'https://www.insurancenews.com.au/rss/daily',                 source: 'insuranceNEWS.com.au',  section: 'Daily',                   priority: 5 },
  { id: 'in-regulatory', url: 'https://www.insurancenews.com.au/rss/regulatory-government', source: 'insuranceNEWS.com.au',  section: 'Regulatory & Government', priority: 5 },
  { id: 'in-broker',     url: 'https://www.insurancenews.com.au/rss/the-broker',            source: 'insuranceNEWS.com.au',  section: 'The Broker',              priority: 4 },
  { id: 'in-analysis',   url: 'https://www.insurancenews.com.au/rss/analysis',              source: 'insuranceNEWS.com.au',  section: 'Analysis',                priority: 4 },
  { id: 'ib-au',         url: 'https://www.insurancebusinessmag.com/au/rss',                source: 'Insurance Business AU', section: 'Australia',               priority: 4 },
  { id: 'in-corporate',  url: 'https://www.insurancenews.com.au/rss/corporate',             source: 'insuranceNEWS.com.au',  section: 'Corporate',               priority: 3 },
  { id: 'in-local',      url: 'https://www.insurancenews.com.au/rss/local',                 source: 'insuranceNEWS.com.au',  section: 'Local',                   priority: 3 },
  { id: 'in-breaking',   url: 'https://www.insurancenews.com.au/rss/breaking-news',         source: 'insuranceNEWS.com.au',  section: 'Breaking News',           priority: 3 },
  { id: 'in-intl',       url: 'https://www.insurancenews.com.au/rss/international',         source: 'insuranceNEWS.com.au',  section: 'International',           priority: 2 }
];

// The rolling window. `lookbackDays` is 10 rather than 1 because of the weekly
// batching documented above — a Monday-batched section feed read on a Friday is
// six days behind and still the newest that publisher has. `staleFeedDays` is
// where a feed's silence is reported as a warning on the doc; it is deliberately
// longer than the batch cadence so a healthy weekly feed does not cry wolf.
var WINDOW = {
  lookbackDays: 10,
  staleFeedDays: 14,
  maxItems: 40,          // Firestore caps a doc at 1 MiB; 40 trimmed items sits far under
  maxSummaryChars: 320,  // summaries are already 1-2 sentences; this only guards outliers
  keepUndated: true      // an item with no parseable date is kept and FLAGGED, never silently dropped
};

// Relevance vocabulary, tiered by how directly a term maps to work Bob actually
// bills for, NOT by how important it sounds.
//
// NOTE: lib/command-center-core.js:23 has its own one-line relevance regex for
// MODEL-WRITTEN briefing stories. This table is deliberately separate and richer
// because it scores RAW HEADLINES, which are shorter and carry no `relevance`
// prose to lean on. The two are allowed to differ. What is not allowed is
// editing one on the assumption that it changes the other.
var KEYWORDS = {
  // Tier 1 — his actual engagement types. A headline hitting these is worth
  // opening even when it is a week old.
  core: [
    'business interruption', 'forensic', 'loss adjust', 'claims inflation',
    'quantum', 'indemnity', 'claim denial', 'denied claim', 'disputed claim',
    'claims dispute', 'expert evidence', 'reinsurance', 'catastrophe',
    'cat pool', 'cyclone pool', 'supply chain', 'contingent business'
  ],
  // Tier 2 — the regulatory and peril environment those engagements sit in.
  context: [
    'apra', 'asic', 'afca', 'insurance council', 'code of practice',
    'underwriting', 'premium', 'claims handling', 'flood', 'bushfire',
    'storm', 'cyclone', 'hail', 'cyber', 'outage', 'recall', 'litigation',
    'class action', 'royal commission', 'inquiry', 'prudential', 'solvency',
    'reserving', 'fraud'
  ],
  // Tier 3 — general trade news. Present so the feed is not empty on a quiet
  // week, weighted low so it can never outrank the tiers above.
  trade: [
    'broker', 'insurer', 'underwriter', 'policy', 'coverage', 'liability',
    'workers compensation', 'professional indemnity', 'strata', 'motor'
  ]
};

// Score weights. A score is feed priority + keyword hits + recency, each bounded
// so no single component runs away. These are RANKING weights only — nothing
// here is a forecast, a confidence or a probability, and the doc does not
// present them as one.
var SCORING = {
  feedPriorityWeight: 3.0,   // x priority 1-5 -> up to 15
  coreHit: 9.0,
  contextHit: 4.0,
  tradeHit: 1.5,
  maxKeywordScore: 34.0,     // a term-stuffed headline cannot dominate the rank
  recencyMax: 18.0,          // newest = full, decaying linearly across the window
  titleBonus: 1.4            // a term in the TITLE counts more than one in the summary
};

var CONFIG = {
  feeds: FEEDS,
  window: WINDOW,
  keywords: KEYWORDS,
  scoring: SCORING
};

export { CONFIG };
