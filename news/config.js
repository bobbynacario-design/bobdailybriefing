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
  { id: 'in-intl',       url: 'https://www.insurancenews.com.au/rss/international',         source: 'insuranceNEWS.com.au',  section: 'International',           priority: 2 },
  // Added 2026-09-26: his files turn on electricity-network and heavy-vehicle
  // costs (pole and asset repair invoices; trucking downtime, parts and freight),
  // which insurance trade press rarely covers. Each URL was fetched with this
  // module's own USER_AGENT and returned RSS with items dated that week. Several
  // obvious sources (Utility Magazine, Big Rigs, Fully Loaded/ATN, Roads Online)
  // refuse non-browser clients with HTTP 403; they are deliberately left out
  // rather than fetched under a disguised user agent.
  //
  // `beat` splits the reserved places (WINDOW.beatSlots) between the two, so
  // one cannot take them all. `skipUrl` drops a feed's non-news pages.
  { id: 'ena',           url: 'https://www.energynetworks.com.au/feed/',                    source: 'Energy Networks Australia', section: 'Networks',           priority: 3, lane: 'beats', beat: 'network' },
  { id: 'esd',           url: 'https://esdnews.com.au/feed/',                               source: 'Energy Source & Distribution', section: 'Networks',        priority: 3, lane: 'beats', beat: 'network' },
  { id: 'aemc',          url: 'https://www.aemc.gov.au/rss.xml',                            source: 'AEMC',                  section: 'Network regulation',      priority: 2, lane: 'beats', beat: 'network' },
  // Added 2026-10-06: ENA publishes every week or two and ESD is mostly
  // generation, so network news was thin. RenewEconomy returned RSS to this
  // module's USER_AGENT with 10 items from the last three days. Its generation
  // stories hit no network term, so they never take a reserved place, and at
  // priority 2 they score below the insurance press.
  { id: 'reneweconomy',  url: 'https://reneweconomy.com.au/feed/',                          source: 'RenewEconomy',          section: 'Energy',                  priority: 2, lane: 'beats', beat: 'network' },
  { id: 'ata',           url: 'https://www.truck.net.au/rss.xml',                           source: 'Australian Trucking Association', section: 'Trucking',     priority: 3, lane: 'beats', beat: 'trucking' },
  // NHVR's feed also carries its static pages (/node/4998 "Driver information")
  // and event listings; on 4-6 Oct 2026 those took three of the five beat
  // places used, through "heavy vehicle" in their summaries.
  { id: 'nhvr',          url: 'https://www.nhvr.gov.au/rss.xml',                            source: 'NHVR',                  section: 'Heavy vehicles',          priority: 2, lane: 'beats', beat: 'trucking',
    skipUrl: /\/node\/\d+\/?$|\/events\/|\/avm-search\/?$/i },
  { id: 'truckbus',      url: 'https://www.truckandbus.net.au/feed/',                       source: 'Truck & Bus',           section: 'Trucking',                priority: 2, lane: 'beats', beat: 'trucking' }
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
  // Network and trucking stories rarely outscore insurance trade press (priority
  // and "insurer" terms), so without this none reached the kept list. Up to this
  // many "beats" stories that hit a core or context term keep a place of their own,
  // taken in turn from each beat in beatOrder (network first: half his files).
  beatSlots: 8,
  beatOrder: ['network', 'trucking'],
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
    'cat pool', 'cyclone pool', 'supply chain', 'contingent business',
    // His quantum topics (added 2026-09-26 with the network and trucking feeds).
    // Whole phrases: matching is by substring, so "aer" alone would hit "aerial".
    'betterment', 'loss of use', 'linesworker', 'network charges', 'network tariff',
    'pole replacement', 'traffic control', 'traffic management', 'incident response',
    'prime mover', 'freight rate', 'parts shortage', 'repair times', 'credit hire',
    // The assets and invoices in his pole-strike files (added 2026-10-06).
    'pole strike', 'power pole', 'stobie', 'streetlight', 'traffic signal', 'asset damage',
    'cost pass-through', 'cost pass through', 'pass-through application', 'labour rate', 'contractor rate'
  ],
  // Tier 2 — the regulatory and peril environment those engagements sit in.
  context: [
    'apra', 'asic', 'afca', 'insurance council', 'code of practice',
    'underwriting', 'premium', 'claims handling', 'flood', 'bushfire',
    'storm', 'cyclone', 'hail', 'cyber', 'outage', 'recall', 'litigation',
    'class action', 'royal commission', 'inquiry', 'prudential', 'solvency',
    'reserving', 'fraud',
    'australian energy regulator', 'aemc', 'determination', 'enterprise agreement', 'heavy vehicle',
    'distribution network', 'power outage', 'blackout', 'diesel', 'fuel tax', 'haulage',
    'roadworks', 'road maintenance', 'payment terms',
    // The network businesses by name, so a story about one is recognised as the
    // network beat (added 2026-10-06; on 4-6 Oct no network story hit a term).
    // "ergon energy", not "ergon", which would match "ergonomic".
    'electricity network', 'energy regulator', 'network business', 'transmission works', 'network outage',
    'ausgrid', 'essential energy', 'endeavour energy', 'energex', 'ergon energy', 'energy queensland',
    'sa power networks', 'powercor', 'citipower', 'united energy', 'ausnet', 'jemena', 'evoenergy',
    'tasnetworks', 'western power', 'horizon power', 'transgrid', 'powerlink', 'electranet'
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

// What earns a beat story a reserved place: a hit on its OWN beat's terms (each
// one is also in KEYWORDS, which is what tags it). Any core or context hit was
// the old test, and it let a RenewEconomy story on Pacific diesel aid take a
// network place through "diesel" (6 Oct 2026). A beat with no list here falls
// back to any core or context hit.
var BEAT_TERMS = {
  network: [
    'linesworker', 'network charges', 'network tariff', 'pole replacement', 'pole strike', 'power pole', 'stobie',
    'streetlight', 'traffic signal', 'asset damage', 'cost pass-through', 'cost pass through', 'pass-through application',
    'labour rate', 'contractor rate', 'incident response', 'australian energy regulator', 'energy regulator', 'aemc',
    'determination', 'enterprise agreement', 'distribution network', 'electricity network', 'network business',
    'transmission works', 'network outage', 'power outage', 'blackout', 'outage', 'bushfire', 'storm',
    'ausgrid', 'essential energy', 'endeavour energy', 'energex', 'ergon energy', 'energy queensland',
    'sa power networks', 'powercor', 'citipower', 'united energy', 'ausnet', 'jemena', 'evoenergy',
    'tasnetworks', 'western power', 'horizon power', 'transgrid', 'powerlink', 'electranet'
  ],
  trucking: [
    'prime mover', 'freight rate', 'parts shortage', 'repair times', 'credit hire', 'loss of use',
    'heavy vehicle', 'haulage', 'diesel', 'fuel tax', 'payment terms', 'traffic control', 'traffic management',
    'roadworks', 'road maintenance', 'enterprise agreement', 'flood', 'storm'
  ]
};

var CONFIG = {
  feeds: FEEDS,
  window: WINDOW,
  keywords: KEYWORDS,
  scoring: SCORING,
  beatTerms: BEAT_TERMS
};

export { CONFIG };
