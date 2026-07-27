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
| `radar-journal` | benchmark-excess calibration: `byStatus` / `byScoreBucket` (raw + excess), `byTheme` / `byAsset` / `byDate`, `counts` (raw / non-overlapping / unique-dates / pending), `caveats[]`, `informationCoefficient`, `byRegime` + `regimeCoverage`, `weightCalibration`, and recent outcomes |

---

## What was built

### V1 — data → score → ranked render

Fetches daily bars and scores each watchlist asset with a deterministic engine.

**Score** = `0.30·trend + 0.25·volume + 0.25·relStrength + 0.10·riskQuality + 0.10·regime`,
each sub-score 0–100. The weights are **round priors — chosen, not fitted.** The
journal surfaces a `weightCalibration` diagnostic (see V3 below), but on ~60 days
of one correlated regime — where it also finds excess basically flat — fitting
weights is fitting to noise, so the calibration is reviewed, not applied. They
live in `config.js` `WEIGHTS`.

- **trend** — close vs SMA20/SMA50 (above both = 100 … below both = 20; capped at
  60 if SMA20 < SMA50).
- **volume** — today's volume vs trailing-20 average, interpolated.
- **relStrength** — asset 20-day return minus its benchmark's, in points.
- **riskQuality** (replaced the inert `riskReward`; a post-V3 refinement, not the
  V2 catalyst lane) — is the risk *well-formed*? Two ATR-calibrated curves: a stop
  a healthy ATR multiple below entry (not noise-tight, not chasing-wide) and an
  entry not overextended above SMA20. The old `riskReward` was a near-constant
  ≈2.0 that fed the score nothing.
- **regime** — **theme-specific**: the breadth of the theme's own driver basket
  above SMA20, graded 25..100 (none up → 25, half → ~62, all → 100). Crypto reads
  BTC/ETH, energy reads USO/XLE, metals read GLD/SLV/DBC, AI semis read
  QQQ/SMH/SOXX, etc. (`config.js` `THEME_REGIME`; drivers are existing watchlist
  symbols, so no extra fetch). A theme with no available drivers falls back to the
  global SPY & QQQ regime. This score also drives the confirm/invalidate gate, so
  a crypto setup is no longer gated by US-equity regime, and a weak QQQ no longer
  drags a defensive-metals setup. The global SPY & QQQ regime is still computed as
  the market-backdrop header shown above the cards. Each signal records its
  `regimeScore` and `regimeBasis` (the drivers) for transparency.

The 2R plan itself (`stop = min(prior-day low, SMA20)`, `target = entry + 2·(entry−stop)`)
still computes the entry/stop/target **levels** shown on the card and used as the
journal's published stop/target — it just no longer feeds the score.

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

### V3 — calibration harness (benchmark-excess)

Because `scoreUniverse` is deterministic, the journal is a pure function of the
bars: it re-scores each of the last ~60 trading days **point-in-time** (bars
sliced to that date) and measures what actually happened next. The original V3
just tracked raw forward returns; in a one-correlated-AI-bull-run window those
numbers were near-uninterpretable (even the "don't chase" `invalidated` bucket
printed positive — everything went up). So the journal was rebuilt as an **honest
calibration harness**. It changes *measurement only* — it never touches the score.

Five measurement disciplines (`radar/journal.js`, pure — all I/O stays in
`refresh-radar.js`):

1. **Next-session fill** — a brief reader can't transact at the close a signal
   was scored on. Fill at `open(t+1)` for equities (`entryBasis: "next-open"`),
   `close(t+1)` for crypto (`next-close`, CoinGecko has no open). The newest day
   has no `t+1`, so it's excluded and counted as `pending`. The signal's
   **published** stop/target levels are used — *not* recomputed off the fill — so
   the gap between published level and real fill is captured, not hidden.
2. **Conservative outcome resolution** — resolve over `H = 20` forward bars.
   Equities use intrabar high/low; on a bar where `low ≤ stop` **and**
   `high ≥ target` it counts the **stop** and flags `ambiguous: true` (never a
   silent win). Crypto is close-only (`resolution: "close-only"`, no intrabar, so
   never ambiguous). Unhit within the window → `expired` (or `open` if the window
   runs past available data).
3. **Benchmark-excess is the headline** — for each signal, the configured
   benchmark's return over the same fill→exit window is subtracted:
   `excessReturn = forwardReturn − benchmarkReturn`. `avgExcessReturn` /
   `excessWinRate` are the primary stats (raw kept alongside for contrast). The
   question this answers: does the score **beat its own benchmark** (QQQ / SPY /
   BTC), or just ride sector beta?
4. **Grouped by status, score bucket, theme, asset, and date** — so a single
   ticker or one good stretch can't masquerade as skill (`byStatus` /
   `byScoreBucket` carry both raw and excess; `byTheme` / `byAsset` / `byDate`
   are excess-only rollups).
5. **Overlap honesty** — alongside `raw` count, it reports `nonOverlapping`
   (greedily keep per-asset signals ≥ `H` bars apart, killing forward-window
   double-counting), `uniqueDates`, per-theme/asset counts, and a fixed
   `caveats[]` always warning that the universe is correlated and the counts
   overstate independence (plus a crypto close-only caveat when any crypto signal
   is present).

It also surfaces a **weight-calibration diagnostic** (`weightCalibration`): each
component's forward-excess tercile-spread on a fit/holdout time-split, and a
conservative shrunk reweight suggestion *only* for components that survive
out-of-sample. On the current sample just `riskQuality` survived — and its robust
spread was **negative** (cleaner setups lagged in this momentum tape), which would
*down*-weight it. The diagnostic is **surfaced for review, never applied**: the
live `WEIGHTS` are the round priors, not these fitted numbers. Fitting weights on
~60 days of one flat-excess regime is fitting to noise — the honest read is *keep
the priors* until multi-regime, non-overlapping history accumulates. (This was
briefly applied as a shrunk fit and reverted; tuning stays manual by design.)

#### Ranking skill (`informationCoefficient`) and regime conditioning (`byRegime`)

`byScoreBucket` pools every signal in the window, so it is dominated by whichever
weeks happen to fall inside it and cannot tell a broken score from one that only
works in certain conditions. Two additions answer that:

- **Information coefficient** — on each scored date, the Spearman rank
  correlation between a name's score and the excess it went on to earn. One
  number per **day** (~30 names) instead of one per window, so a persistent tilt
  is distinguishable from a bad stretch. Reports `meanIC` / `medianIC` / `stdIC`
  / `positiveDayRate` plus the full daily `series`. Spearman rather than Pearson
  because the score is an ordinal ranking device and excess returns are fat-tailed
  enough that one outlier would otherwise set the correlation by itself. A date
  needs ≥ 8 names, and a day with no spread on either side yields `null` (not 0),
  so a non-observation cannot dilute the mean.
- **Overlap penalty** — consecutive dates share almost all of a 20-bar forward
  window, so the naive `tStat` is badly inflated. `tStatOverlapAdj` deflates the
  sample to `effectiveNDates ≈ nDates / horizon`. Both are reported: the naive one
  because it is what a reader would compute, the adjusted one because it is the
  one that is not lying.
- **`byRegime`** — `scoreUniverse`'s market backdrop is already discrete (SPY and
  QQQ both above SMA20 → `risk-on`, one → `mixed`, neither → `risk-off`), so the
  split needs no arbitrary banding. The journal re-scores every past date anyway,
  so the regime is free — it was simply being discarded. Each regime reports its
  own IC and its **band spread**: what the 80-100 band earned minus what 0-39
  earned. `regimeCoverage` then states whether the sign holds across regimes
  (a property of the score) or flips (regime-dependent), and refuses to conclude
  anything when the window covers only one tape.

**Live measurement (2026-07-27, 60 dates):** `meanIC` **−0.015**, median +0.026,
positive on **53.3%** of days; naive `t` −0.41, overlap-adjusted **−0.09**. The
verdict is *no usable ranking information* — close to noise. The band spread
**flips sign** between regimes (risk-on **+0.73pp**, mixed −0.45pp, risk-off
−0.42pp), so what edge there is, is regime-dependent rather than absent
everywhere. Like `weightCalibration`, this is a diagnostic: `WEIGHTS` in
`config.js` stay static and nothing is auto-applied.

> **The first measurement of this was wrong, and the correction matters.** Before
> the unfillable guard below, the same code reported `meanIC` −0.134 with only 30%
> positive days and a negative band spread in *all three* regimes — read as "the
> score ranks inversely, and it is a property of the score, not the tape". That
> was an artifact of impossible fills, not a finding. Both conclusions reversed
> once the fills were fixed.

#### The unfillable guard (`counts.unfillable`)

A stop-hit that **makes money** is impossible for a long position, and the stored
outcomes contained 14 of them in a 120-row sample — 13 of the 14 `invalidated`.

The cause is structural. `classify()` marks a signal `invalidated` *precisely
because* `close < stop`, so its next-session fill is usually still below that
stop. `resolveOutcome` then matched `low <= stop` on the very first window bar and
"exited" at the stop — **above** the fill — booking a guaranteed gain on a
position nobody could have held. Real example: XLY filled 109.06 against a stop of
113.82 and was credited **+4.36%**.

`resolveOutcome` now takes the `fill` and returns `unfillable` when the published
levels no longer bracket it: `below-stop` (the proven defect) or `above-target`
(the mirror case — rarer, and it booked a small fake *loss*, so it deflated rather
than inflated). These are **excluded from every statistic but counted**, the same
treatment `pending` gets, because "the screen produced N ideas already broken by
the open" is a finding about the radar rather than a footnote.

**Impact of the fix (same bars, same dates):**

| | before | after |
|---|---|---|
| `meanIC` | −0.134 | **−0.015** |
| positive days | 30% | **53.3%** |
| `invalidated` avg excess | +0.95% | **−0.10%** |
| `0-39` band avg excess | +1.03% | **−0.01%** |
| band spread across regimes | negative in all three | **flips sign** |

**535 of 1800** signals (29.7%) were unfillable — 453 already through the stop,
82 already past the target; 450 of them `invalidated`. The invalidated bucket fell
from n=956 to n=505 and its average excess went from +0.95% to −0.10%. Re-checked
after the fix: **zero** impossible stop-hits remain.

A 📓 **Journal** tab renders excess bars by status/score/theme, stat tiles
(raw / non-overlapping / unique dates / horizon), the IC headline with a daily
bar strip, the per-regime band-spread table, and a list of recent outcomes.

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

### Scheduling and unattended reliability

`BobDailyBriefing-RadarRefresh` runs the script **twice daily — 06:00 and 08:30
PHT**. The 08:30 run is a catch-up, not a second refresh: `main()` exits in ~2s
if `radar-<today PHT>` already exists. Pass `--force` (or `RADAR_FORCE=1`) to
re-run and overwrite a day deliberately.

This matters because the box is Modern Standby (S0) and the task does **not**
wake it. Through July 2026 the 06:00 run missed roughly 1 day in 4: either the
machine was asleep (no run at all) or Task Scheduler's `StartWhenAvailable`
caught up seconds after a resume — before Wi-Fi had associated — and every
Alpaca call died `ENOTFOUND` inside the 15s retry ladder. So:

- `waitForNetwork()` runs before any API call and polls DNS + one real HTTPS
  request for up to 5 min (`RADAR_NET_WAIT_MS`, host `RADAR_NET_PROBE_HOST`).
- `fetchRetry` covers mid-run drops with a ~22s exponential ladder.
- Every run brackets `refresh.log` with a timestamped
  `===== refresh-radar run started … =====` / `OK|FAILED … after Ns` banner, so
  a late run is distinguishable from one that never fired.

Still unfixed by design: wake timers are disabled on battery in the active power
plan, and `WakeToRun` is off — an unplugged, sleeping box will still miss 06:00
and rely on the catch-up.

**Data providers:** Alpaca (equities/ETFs, free IEX daily bars), CoinGecko (free,
no key, crypto), OpenAI (catalysts; reuses the app's existing integration).

**PH market-health (🇵🇭 PSE tab, `radar-ph`):** NOT scored — there is no free
per-stock PSE feed. `radar/ph-snapshot.js` builds a PSEi health read from free
Yahoo data (1y bars → SMA20/50/200, 1w/1m/3m/YTD returns, 52-wk range, RSI, vol,
sparkline) plus USD/PHP + AUD/PHP FX and US-listed ADR proxies. The 06:00 radar
run builds it pre-open (prior close); a separate Task Scheduler job
`BobDailyBriefing-PhRefresh` runs `node refresh-ph.js` at **16:30 PHT** (after the
15:30 close) so the tab shows today's close — standalone, no US re-fetch, no LLM
cost. A real *scored* per-stock PH radar would need a paid feed (e.g. EOD
Historical Data) reusing `scoring.js`/`journal.js`.

---

## Latest run snapshot (2026-06-21, as-of 2026-06-18)

- **Regime:** Mixed (SPY below its SMA20, QQQ above).
- **Top signals:** AMD 81, SMH 81, SOXX 75 (AI semis leading QQQ) — *forming* on a
  low-volume session; energy names invalidated on the oil selloff.
- **Catalysts:** 20/20 tagged (analyst upgrades, Broadcom guidance reset, a FERC
  grid order, the US–Iran deal weighing on crude).
- **Journal (60d / 20d horizon, benchmark-excess):** raw forward returns look
  nicely ordered by score, but **excess is roughly flat** — only AI semis show
  real excess over QQQ. Read: the score's apparent edge has mostly been *riding
  the AI wave*, not beating peers. That's a valid, informative pass (honest
  numbers, not good ones), and exactly why the headline metric is excess, not
  raw. Live figures are in the 📓 Journal tab; non-overlapping counts and the
  correlated-universe caveat are carried in the doc.

---

## Scope boundaries

Out of scope, by design: paper trading or execution (never, in a briefer);
alerts (the brief section is the delivery); a `price_bars` warehouse (bars are
fetched at run time, only result docs persist); auto-tuning the heuristics from
journal stats (deferred — overfitting risk on short history). The project is on
Blaze, so a scheduled Cloud Function is possible later — `scoring.js` and
`journal.js` would move across unchanged.
