# Market Radar

A daily market-opportunity radar embedded in the Daily Briefer. It ranks ~20
assets across AI / crypto / energy / index themes once per day on daily bars and
surfaces them as opportunity cards in the brief, each with a 0–100 score, a
forming / confirmed / invalidated status, the reason it matters, an explicit
invalidation level, a recent news catalyst, and a performance journal that
measures whether the scoring is actually informative.

**Value is framing, not prediction. Nothing here is advice — no "buy"/"sell"
language anywhere.**

---

## Architecture

A **local Node script** does all the work once a day; the **front end is a pure
reader**. No Cloud Function, no build tools, no new front-end deps.

```
radar/
  scoring.js        # PURE, no I/O — scoreUniverse(barsByAsset, config)
  journal.js        # PURE, no I/O — buildJournal(bars, config, opts)
  refresh-radar.js  # the only I/O: fetch → score → tag → journal → write Firestore
  config.js         # watchlist, benchmarks, weights, journal settings
  package.json      # firebase-admin only (Node fetch is global)
  .env              # local secrets (gitignored)
  serviceAccountKey.json  # pokerhq-a67e4 admin key (gitignored)
```

The pure modules do no fetching and no Firestore access, so the same logic could
later be lifted into a scheduled Cloud Function unchanged.

**Data flow per run:**

```
Alpaca (equity daily OHLCV, IEX feed) ---+
                                         +--> barsByAsset --> scoreUniverse --> signals
CoinGecko (crypto daily close+volume) ---+                                        |
                                                                                  |
OpenAI /v1/responses + web_search --> catalyst per signal ------------------------+  (display-only)
                                                                                  |
barsByAsset --> buildJournal (re-score last 60d, track outcomes) -----------------+
                                                                                  |
                                                                                  v
       Firestore: briefings-bob/radar-<date>, radar-latest, radar-journal
```

**Firestore documents** (all single-segment under `briefings-bob`, written with
no `uid` field so the signed-in front end can read them under the existing rule;
the Admin SDK bypasses rules on write):

| Doc | Contents |
|---|---|
| `radar-<YYYY-MM-DD>` | regime + ranked `signals[]` for that day (PHT date) |
| `radar-latest` | `{ value: "<YYYY-MM-DD>" }` pointer to the newest day |
| `radar-journal` | rolling performance stats + recent outcomes |

---

## What was built

### V1 — data → score → ranked render

Fetches daily bars and scores each watchlist asset with a deterministic engine.

**Score** = `0.30·trend + 0.25·volume + 0.25·relStrength + 0.10·riskReward + 0.10·regime`,
each sub-score 0–100:

- **trend** — close vs SMA20/SMA50 (above both = 100 … below both = 20; capped at
  60 if SMA20 < SMA50).
- **volume** — today's volume vs trailing-20 average, interpolated.
- **relStrength** — asset 20-day return minus its benchmark's, in points.
- **riskReward** — rule-based 2R plan: `stop = min(prior-day low, SMA20)`,
  `target = entry + 2·(entry−stop)`. (By construction rr ≈ 2.0; the useful output
  is the entry/stop/target *levels* shown on the card.)
- **regime** — SPY & QQQ vs their SMA20, applied to every asset that day.

**Status:** `confirmed` (trend≥70 & volume≥65 & relStrength≥50 & regime≥60),
`invalidated` (close<stop, or relStrength<30, or weak regime+trend), else
`forming`.

**Front end:** a 📡 **Radar** tab renders one opportunity card per signal (sorted
by score) with a status badge (confirmed = gold, forming = amber, invalidated =
red), the `why` sentence, an entry/stop/target/R:R plan line, and the
invalidation footer. A one-line regime header (Supportive / Mixed / Risk-off)
sits above the cards.

### V2 — catalyst / news tagging (display-only)

In the same daily run, after scoring, the script asks **OpenAI** (`/v1/responses`
with the `web_search` tool, model `gpt-5.5`) for the single most relevant recent
catalyst per symbol and an event type, then bakes `catalyst` / `eventType` /
`catalystAsOf` onto each signal. **Scoring is unchanged** — catalysts are context,
not a score input. If the OpenAI key is missing or the call fails, the run still
writes signals without catalysts.

Each card gains a colour-coded event chip (earnings/guidance = blue,
analyst = purple, regulatory = amber, macro = teal, product/partnership = green)
plus the one-line catalyst and its date.

### V3 — performance journal (feedback loop)

Because `scoreUniverse` is deterministic, the journal is a pure function of the
bars: it re-scores each of the last ~60 trading days **point-in-time** (bars
sliced to that date) and measures the **actual forward outcome** over the next
20 bars — target hit / stop hit / expired / still-open — plus the forward return.
It rolls these up into win-rate and average forward return **by status** and
**by score bucket**.

A 📓 **Journal** tab shows overall stat tiles, win-rate bars by status and score,
and a list of recent outcomes. This is the feedback loop for tuning the V1
heuristics; it does not auto-tune (tuning stays manual by design).

### Quick filters (front-end only)

Two pill rows under the regime line narrow the rendered cards. **Display only —
no scoring, no extra data, no pipeline change.** Asset type is derived
client-side from each signal's `theme` / `symbol`, so the filters work on any
existing `radar-<date>` doc:

- **Asset type** — `All / Stocks / Crypto / Commodities`, each with a live count.
  `Crypto` = coins (theme `Crypto`); `Commodities` = theme `Metals/commod` plus
  the commodity/metal/energy ETFs (`USO, GLD, SLV, DBC, GDX`); everything else —
  including equity sector ETFs, crypto-equities (COIN/MSTR) and energy equities
  (XOM/CVX/XLE) — is `Stocks`. The symbol set lives in `RADAR_COMMODITY_SYMS` in
  `index.html`.
- **Status** (sub-filter) — `confirmed / forming / invalidated`, colour-dot
  coded, counted **within the selected asset type**. The row hides itself when
  fewer than two statuses are present, and a status selection is cleared
  automatically when switching to an asset type that lacks it, so you can't get
  stranded on an empty grid behind a hidden row.

---

## How to run

All secrets live in `radar/.env` (gitignored): Alpaca keys + optional
`OPENAI_API_KEY`. The Firebase admin key is `radar/serviceAccountKey.json`
(gitignored).

```
cd radar
npm install          # first time only
node refresh-radar.js
```

The script loads `.env` automatically, so a Windows Task Scheduler job needs no
extra environment setup. It logs the exact doc it writes and a one-line journal
summary. Markets are closed on weekends, so `asOf` will be the last trading day.

**Data providers:** Alpaca (equities/ETFs, free IEX daily bars), CoinGecko (free,
no key, crypto), OpenAI (catalysts; reuses the app's existing integration).

---

## Latest run snapshot (2026-06-21, as-of 2026-06-18)

- **Regime:** Mixed (SPY below its SMA20, QQQ above).
- **Top signals:** AMD 81, SMH 81, SOXX 75 (AI semis leading QQQ) — *forming* on a
  low-volume session; energy names invalidated on the oil selloff.
- **Catalysts:** 20/20 tagged (analyst upgrades, Broadcom guidance reset, a FERC
  grid order, the US–Iran deal weighing on crude).
- **Journal (60d / 20d horizon, 1200 signals):** the ranking is informative —
  confirmed 48.1% win / +4.36% avg, forming 43.5% / +3.5%, invalidated 20.2% /
  +1.14%; score buckets monotonic (80–100 → 48.8% / +5.16%).

---

## Scope boundaries

Out of scope, by design: paper trading or execution (never, in a briefer);
alerts (the brief section is the delivery); a `price_bars` warehouse (bars are
fetched at run time, only result docs persist); auto-tuning the heuristics from
journal stats (deferred — overfitting risk on short history). The project is on
Blaze, so a scheduled Cloud Function is possible later — `scoring.js` and
`journal.js` would move across unchanged.
