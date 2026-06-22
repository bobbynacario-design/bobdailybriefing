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
  // Geopolitics
  { slug: 'will-the-us-invade-iran-before-2027',   label: 'US invades Iran before 2027',    theme: 'Geopolitics', yesOutcome: 'Yes' },
  { slug: 'will-china-invade-taiwan-before-2027',  label: 'China invades Taiwan by end 2026', theme: 'Geopolitics', yesOutcome: 'Yes' },

  // Sports — 2026 FIFA World Cup outright (resolve ~2026-07-20)
  { slug: 'will-france-win-the-2026-fifa-world-cup-924',    label: 'France win 2026 World Cup',    theme: 'Sports', yesOutcome: 'Yes' },
  { slug: 'will-spain-win-the-2026-fifa-world-cup-963',     label: 'Spain win 2026 World Cup',     theme: 'Sports', yesOutcome: 'Yes' },
  { slug: 'will-argentina-win-the-2026-fifa-world-cup-245', label: 'Argentina win 2026 World Cup', theme: 'Sports', yesOutcome: 'Yes' },
  { slug: 'will-england-win-the-2026-fifa-world-cup-937',   label: 'England win 2026 World Cup',   theme: 'Sports', yesOutcome: 'Yes' },
  { slug: 'will-usa-win-the-2026-fifa-world-cup-467',       label: 'USA win 2026 World Cup',       theme: 'Sports', yesOutcome: 'Yes' },

  // Control / sanity market — the panel should strongly disagree DOWNWARD; a
  // useful check that the haircut + gate behave (it must never produce a "GO").
  { slug: 'will-jesus-christ-return-before-2027', label: 'Second Coming before 2027', theme: 'Control', yesOutcome: 'Yes' }
];

// Trading-cost assumption used to turn a raw probability gap into an EXECUTABLE
// edge. Polymarket charges no maker/taker fee on most markets, so the real cost
// is the bid/ask spread you cross. A flat round-trip haircut in probability terms
// (~2 cents) is a conservative stand-in until Lane 2 reads the live order book.
var FEES = {
  roundTripCost: 0.02  // subtracted from |edge| before the gate (spread proxy)
};

// Uncertainty haircut. A panel of correlated LLM passes is NOT an independent
// weather ensemble — its apparent confidence is partly cosmetic. So we SHRINK the
// panel's probability toward 0.5 before trusting it: haircutProb = 0.5 + k*(p-0.5)
// with k<1. Wider panel dispersion shrinks harder (less agreement -> less trust).
var HAIRCUT = {
  baseShrink: 0.70,        // k at zero dispersion (keep 70% of the panel's deviation from 0.5)
  dispersionPenalty: 1.50, // extra shrink proportional to panel stdev (in prob units)
  minShrink: 0.25          // never keep less than 25% (floor so the read isn't erased)
};

// The gate. A market is only "GO" (worth researching as a position) if the
// executable edge clears the threshold AND the panel isn't hopelessly split.
// Otherwise NO-GO with the failed check named — "if even one check fails, you
// don't have a trade, you have a story."
var EDGE_GATE = {
  minEdge: 0.05,         // executable edge must be >= 5 percentage points
  maxDispersion: 0.20,   // panel stdev above this -> NO-GO (panel-split)
  minLiquidityNum: 5000  // thin markets -> NO-GO (you can't actually execute)
};

// The persona panel (Lane 2). ~5-7 deliberately DIVERSE personas so the passes
// are less correlated than asking the same model the same way N times. Each
// returns a probability for the YES outcome; scenario.js aggregates them.
var PANEL = {
  model: 'gpt-5.5',  // overridable via OPENAI_MODEL; reuses the radar's OpenAI integration
  personas: [
    { id: 'base-rate',  brief: 'A historian who anchors hard on base rates and how often this CLASS of event actually happens. Skeptical of recency and narrative.' },
    { id: 'insider',    brief: 'A domain specialist who weighs the latest concrete signals, official statements, and on-the-ground specifics for THIS event.' },
    { id: 'contrarian', brief: 'A contrarian who actively looks for why the crowd/market price is wrong in EITHER direction, and prices tail risks.' },
    { id: 'quant',      brief: 'A cautious quant who distrusts stories, defaults toward the market price, and only deviates when evidence is strong.' },
    { id: 'newsdesk',   brief: 'A wire-service reporter focused strictly on what is verifiably known right now versus speculation.' },
    { id: 'devils-adv', brief: 'A devil\'s advocate who argues the OPPOSITE of whatever seems obvious, to surface overlooked failure modes.' },
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
