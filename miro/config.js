// miro/config.js
//
// Curated event-market universe + knobs for the "scenario read" feature — the
// HONEST version of the viral MiroFish idea. We do NOT run a money-printing
// autopilot on near-efficient 5-minute BTC candles. We run a small persona panel
// as a RESEARCH engine over a hand-picked set of slower-resolving event markets,
// haircut its read for uncertainty, and compare it to the market's OWN implied
// price. Value is framing — GO/NO-GO research, never "bet this", never execution.
//
// This file is PURE config (no I/O). refresh-miro.js reads MARKETS to fetch from
// Polymarket's free Gamma API; scenario.js (Lane 2) reads FEES/HAIRCUT/EDGE_GATE/
// PANEL; journal-miro.js (Lane 3) reads JOURNAL. scenario.js imports nothing from
// here directly — it receives the config object it is handed (mirrors scoring.js).

// Curated markets. Each: Polymarket `slug` (stable id for the Gamma fetch), a
// short human label, a theme, and `yesOutcome` — the outcome string whose price
// we treat as P(YES). All current entries are ["Yes","No"] markets, so yesOutcome
// is "Yes" and yesIndex resolves to 0; the refresh matches by string so a market
// with differently-named outcomes still works if you set yesOutcome.
//
// Selection rationale (deliberate): SLOWER markets (resolve weeks-to-months out)
// where a panel can actually reason about news/base rates — NOT short-horizon
// crypto-price markets, which are near-efficient coinflips the analysis warns
// against. Prices are not pinned at 0/1, so there is room for a read to differ.
// Edit freely — this is your watchlist; the journal stays honest as it changes.
var MARKETS = [
  { slug: 'will-the-philippine-senate-convict-sara-duterte', label: 'Philippine Senate convicts Sara Duterte', theme: 'Philippines', priority: 5, why: 'Direct Philippine political and policy signal.', yesOutcome: 'Yes' },
  { slug: 'us-recession-by-end-of-2026', label: 'US recession by end-2026', theme: 'Macro & Rates', priority: 5, why: 'Global growth and risk-appetite proxy with PH spillovers.', yesOutcome: 'Yes' },
  { slug: 'will-no-fed-rate-hikes-happen-in-2026-20260623190852889', label: 'No Fed rate hikes in 2026', theme: 'Macro & Rates', priority: 5, why: 'Rates regime signal for the dollar, peso and equities.', yesOutcome: 'Yes' },
  { slug: 'will-crude-oil-reach-a-new-all-time-high-by-december-31', label: 'Crude oil reaches a new high by year-end', theme: 'Energy', priority: 5, why: 'Inflation and import-cost tail risk for the Philippines.', yesOutcome: 'Yes' },
  { slug: 'china-x-taiwan-military-clash-before-2027', label: 'China-Taiwan military clash before 2027', theme: 'Regional Risk', priority: 5, why: 'High-impact regional security and supply-chain risk.', yesOutcome: 'Yes' },
  { slug: 'will-china-blockade-taiwan-by-in-2026', label: 'China blockades Taiwan in 2026', theme: 'Regional Risk', priority: 4, why: 'Semiconductor, shipping and regional-security tail risk.', yesOutcome: 'Yes' },
  { slug: 'us-x-china-tariff-agreement-by-december-31', label: 'US-China tariff agreement by year-end', theme: 'Trade', priority: 4, why: 'Trade and manufacturing sentiment signal for Asia.', yesOutcome: 'Yes' },
  { slug: 'will-openai-ipo-by-december-31-2026', label: 'OpenAI IPO by year-end', theme: 'AI & Technology', priority: 3, why: 'AI capital-markets and commercialization signal.', yesOutcome: 'Yes' },
  { slug: 'will-a-chinese-company-have-one-of-the-top-3-ai-models-by-december-31', label: 'Chinese company has a top-3 AI model by year-end', theme: 'AI & Technology', priority: 3, why: 'AI competition and technology-policy signal.', yesOutcome: 'Yes' }
];

// Trading-cost assumption. The real edge has to clear the price you can actually
// HIT, not the mid/last. refresh-miro.js reads the live CLOB order book, so the
// spread is paid implicitly (buy YES at the ask, "buy NO" by selling YES at the
// bid). `slippage` is the extra buffer on top of crossing the spread (Polymarket
// has no maker/taker fee on most markets). `roundTripCost` is only the FALLBACK
// used when the order book can't be fetched (no executable quote available).
var FEES = {
  slippage: 0.005,     // probability-point buffer beyond the spread (book path)
  roundTripCost: 0.02  // fallback spread proxy when there is no order book
};

// Uncertainty haircut. A panel of correlated LLM passes is NOT an independent
// weather ensemble — its apparent confidence is partly cosmetic, and a one-model
// panel shares that model's biases (notably LLM longshot OVER-estimation). So we
// shrink the panel toward the MARKET PRICE (the efficient prior), keeping only a
// fraction k of its deviation: haircutProb = price + k*(panelProb - price), k<1.
// Wider panel dispersion shrinks harder (less agreement -> less trust). Anchoring
// on the price — not 0.5 — is what stops a correct ~0% read on a cheap longshot
// from being inflated into fake YES-edge.
var HAIRCUT = {
  baseShrink: 0.60,        // k at zero dispersion (keep 60% of the panel's deviation from the price)
  dispersionPenalty: 1.50, // extra shrink proportional to panel stdev (in prob units)
  minShrink: 0.20          // never keep less than 20% (floor so the read isn't fully erased)
};

// The gate. A market is only "GO" (worth researching as a position) if the
// executable edge clears the threshold AND the panel isn't hopelessly split.
// Otherwise NO-GO with the failed check named — "if even one check fails, you
// don't have a trade, you have a story."
var EDGE_GATE = {
  minEdge: 0.05,          // executable edge must be >= 5 percentage points
  maxDispersion: 0.20,    // panel stdev above this -> NO-GO (panel-split)
  minLiquidityNum: 5000,  // Gamma liquidity floor -> NO-GO (thin)
  maxSpread: 0.03,        // top-of-book bid/ask spread above this -> NO-GO (wide-spread)
  minDepthShares: 100     // top-of-book size (shares) below this -> NO-GO (thin)
};

// The persona panel (Lane 2). 5 deliberately DIVERSE personas so the passes are
// less correlated than asking the same model the same way N times. Each returns
// a probability for the YES outcome; scenario.js aggregates them. Trimmed from 7
// to 5 (2026-06-25, cost) by dropping the two least-distinct: 'quant' overlapped
// 'base-rate' (both base-rate-anchored conservatives) and 'devils-adv' overlapped
// 'contrarian' (both argue against consensus). The kept five span a base-rate
// anchor, a signal-chaser, a tail-risk contrarian, a strict-facts reporter, and a
// calibrated blender. Each persona = one OpenAI call/run, so this is the cost lever.
var PANEL = {
  model: 'gpt-5.5',  // overridable via OPENAI_MODEL; reuses the radar's OpenAI integration
  webSearch: true,   // ground each persona in recent news (web_search, low context)
  personas: [
    { id: 'base-rate',  brief: 'A historian who anchors hard on base rates and how often this CLASS of event actually happens. Skeptical of recency and narrative.' },
    { id: 'insider',    brief: 'A domain specialist who weighs the latest concrete signals, official statements, and on-the-ground specifics for THIS event.' },
    { id: 'contrarian', brief: 'A contrarian who actively looks for why the consensus narrative is wrong in EITHER direction, and prices tail risks. (You are NOT told any market price — form your own view.)' },
    { id: 'newsdesk',   brief: 'A wire-service reporter focused strictly on what is verifiably known right now versus speculation.' },
    { id: 'generalist', brief: 'A calibrated generalist forecaster (superforecaster style) who blends base rates with current evidence and avoids overconfidence.' }
  ]
};

// Lane 3 journal knobs. The journal scores RESOLVED markets: Brier(our haircut
// prob) vs Brier(market implied price). We must BEAT THE PRICE to claim an edge,
// not merely be directionally right — mirrors radar journal's benchmark-excess.
var JOURNAL = {
  recentCap: 200,        // how many resolved-market records to persist
  calibrationBins: 10    // predicted-probability buckets for the calibration table
};

var CONFIG = {
  markets: MARKETS,
  fees: FEES,
  haircut: HAIRCUT,
  edgeGate: EDGE_GATE,
  panel: PANEL,
  journal: JOURNAL
};

export { CONFIG };
