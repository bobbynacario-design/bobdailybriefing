# Markets — Event-Market Scenario Read

A daily "scenario read" over a curated set of **Polymarket event markets**,
embedded in the Daily Briefer as the 🎲 **Markets** tab. It is the *honest*
version of the viral "MiroFish money machine": a **research engine**, not a
5-minute-BTC autopilot. For each market it shows the market's own implied
probability, an independent AI panel's haircut estimate, the executable edge
between them, and a GO/NO-GO verdict — plus a Brier-score journal that checks,
over time, whether the panel ever actually beats the price.

**Value is framing, not prediction. Nothing here is a bet or advice — no order
placement, no execution path, ever.** The honest, expected outcome is *little or
no edge*: these markets are close to efficient, so a handful of AI guesses rarely
beats the crowd's price. The feature is built to surface that truth, not hide it.

---

## Architecture

Mirrors the [Market Radar](../radar/README.md): a **local Node script** does all
the work; the **front end is a pure reader**. No Cloud Function, no build tools,
no new front-end deps.

```
miro/
  scenario.js       # PURE, no I/O — aggregatePanel(markets, config)
  journal-miro.js   # PURE, no I/O — buildMiroJournal(prior, today, resolutions, config)
  refresh-miro.js   # the only I/O: fetch → panel → aggregate → journal → write Firestore
  config.js         # curated markets, personas, haircut/fee/gate knobs
  package.json      # firebase-admin only (Node fetch is global)
  .env              # optional; falls back to ../radar/.env (gitignored)
  serviceAccountKey.json  # optional; falls back to ../radar/serviceAccountKey.json (gitignored)
```

The pure modules do no fetching and no Firestore access, so the same logic could
later be lifted into a scheduled Cloud Function unchanged.

**Data flow per run:**

```
Polymarket Gamma API (free, no key) --> curated markets + implied prices ---+
Polymarket CLOB API  (free, no key) --> YES-token order book (bid/ask/depth)-+
                                                                            +--> aggregatePanel --> edge + GO/NO-GO
OpenAI /v1/responses (~7 price-blind personas) --> independent YES probs ---+                            |
                                                                            |                            v
prior journal + today's predictions + detected resolutions --> buildMiroJournal --> Brier(ours vs price) |
                                                                            |                            |
                                                                            v                            v
        Firestore: briefings-bob/miro-<date>, miro-latest, miro-journal  <--------------------------------
```

**Firestore documents** (all single-segment under `briefings-bob`, written with
no `uid` field so the signed-in front end can read them under the existing rule;
the Admin SDK bypasses rules on write):

| Doc | Contents |
|---|---|
| `miro-<YYYY-MM-DD>` | curated `markets[]` for that day (PHT date): implied price, panel prob, dispersion, haircut, edge, side, GO/NO-GO |
| `miro-latest` | `{ value: "<YYYY-MM-DD>" }` pointer to the newest day |
| `miro-journal` | accumulating record: `open{}` (predictions awaiting resolution), `resolved[]`, `stats` (Brier ours vs market, skill), `calibration[]`, `caveats[]` |

---

## How a read is built

1. **Executable price.** The CLOB order book gives the YES token's best bid/ask;
   the **mid** is the efficient prior (the number to beat) and edge is later
   computed against the price you'd actually HIT — buy YES at the ask, "buy NO" by
   selling YES at the bid. If the book can't be fetched it falls back to the Gamma
   `outcomePrices` mid with a flat cost (`noBook`).
2. **Panel.** ~7 deliberately diverse personas (base-rate historian, insider,
   contrarian, cautious quant, newsdesk, devil's-advocate, generalist) each
   return an independent probability for every market in a single OpenAI call.
   They are **blind to the market price**, so their reads aren't the price echoed
   back to itself.
3. **Haircut.** `haircutProb = price + k · (panelProb − price)`, with `k < 1`
   falling as the panel disagrees with itself. We shrink toward the **price**, not
   0.5 — anchoring on 0.5 inflates a correct ~0% read on a cheap longshot into
   fake YES-edge. (This was caught on the first live run, which flagged a bogus
   "GO" on *"Second Coming before 2027"*.)
4. **Edge & gate.** `edge = k · (panelProb − price) − costs`, with the side
   (YES/NO) of the discrepancy. The verdict is framed as research, not a trade: a
   **RESEARCH FLAG** ("watch only — not advice") only if the market is open,
   liquid enough, the panel isn't too split, the spread is tight, and the edge
   clears the threshold — otherwise **no edge**, with the failed check named
   (`no-edge` / `panel-split` / `thin` / `wide-spread` / `closed`).
5. **Journal.** Each market's haircut prediction is recorded **once** at first
   sighting (no peeking as the price converges). When the market resolves, it is
   scored with a **Brier score** against the outcome, vs the Brier of the market
   price. `skill = Brier(market) − Brier(ours)` — positive means the panel beat
   the price.

---

## Running it

```powershell
cd C:\Users\AO\projects\bobdailybriefing\miro
npm install
node refresh-miro.js
```

Secrets are reused from the radar — there is **no new setup**. The script loads
`miro/.env` then `../radar/.env` (needs `OPENAI_API_KEY`; without it the run still
completes and writes implied-only markets), and authenticates Firestore with
`miro/serviceAccountKey.json` or `../radar/serviceAccountKey.json` (same project,
`pokerhq-a67e4`). A run makes ~7 OpenAI `gpt-5.5` calls (web-search grounded).

The curated universe lives in `config.js` (`MARKETS`) — edit it freely; the
journal stays honest as the list changes. Prefer **slower-resolving** markets
where a panel can reason (geopolitics, tournament outrights), not near-efficient
short-horizon crypto-price markets.

The front end reads the docs but, like every tab, requires Bob's Google sign-in
(the Firestore rule requires an authenticated request); a `permission-denied`
logged out is that gate, not a bug.

---

## Status

Lanes 1–3 shipped: data + render, scenario panel + edge, and the Brier resolution
journal. No alerts, no execution. Possible later work: a scheduled Cloud Function
(the pure modules port unchanged) and a curated list with more near-50% markets
(longshots maximize the LLM's calibration bias, but slower ~50% markets are scarce
on Polymarket).
