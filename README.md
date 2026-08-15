# Bob Daily Briefing

Private daily intelligence briefing desk for Bob.

## Features

- **Command Center** — a zero-extra-cost cross-feed “Morning 5” and attention
  queue. It ranks current briefing items, Radar setups, Markets changes, open
  decision reviews, followed sports fixtures, and feed-health warnings while
  preserving a direct link back to the source tab. Source weights, quiet
  sources, daily pins/dismissals, and score explanations sync with the signed-in
  account; reliability warnings cannot be silenced. Optional Firebase web-push
  delivery sends a materially changed Morning 5 during the PHT morning window,
  with quiet hours, source thresholds, a test action, audit history, and mute.

- **Daily briefing** — OpenAI-generated intelligence desk (see below).
- **📡 Market Radar** — daily ranking of ~30 assets across 11 themes, with a
  performance journal. Docs: [`radar/README.md`](radar/README.md).
- **🎲 Markets** — daily "scenario read" over curated Polymarket event markets:
  market price vs an independent AI panel, executable edge, GO/NO-GO, and a
  Brier-score journal. The honest version of "MiroFish" — research framing, never
  a bet or execution. Docs: [`miro/README.md`](miro/README.md).
- **⚽ Sports** — a provider-backed sports briefing tab. NBA is the default lane,
  with rolling results, conference standings, a last-five momentum model, rest/
  back-to-back flags, recent game leaders, availability, and a configurable team
  watchlist from ESPN's public basketball feed. PH Local/PBA adds official
  fixtures, recaps, standings, momentum, and player leaderboards from
  pba.ph, while FIFA World Cup remains available as an archive. Each module shows
  explicit current, stale, failed, or fallback freshness status. The local
  runner writes `briefings-bob/sports-*` docs and a `sports-public.json` mirror.

- **💰 LLM usage & cost** (Help tab) — every OpenAI call across the app (briefing,
  deep-research, radar catalyst, Markets panel) records token usage to a shared
  ledger (`briefings-bob/llm-usage`); the Help tab ranks the spend by feature in
  USD from a single auditable rate table (raw API cost, no markup; unconfirmed
  model rates shown "unpriced", never guessed).

Each feed retains a local Node refresh script for dry runs and recovery. Managed
GitHub Actions schedules now run production refreshes and write Firestore; the
front end remains a static reader.

## Sports refresh

The Sports tab defaults to NBA. NBA ingestion needs no API key. The archived FIFA
module still uses football-data.org; keep that token local/server-side.

```powershell
cd C:\Users\AO\projects\bobdailybriefing\sports
npm install
set FOOTBALL_DATA_TOKEN=your_token_here
set SPORTS_FOLLOW_TEAMS=Australia,England
set NBA_FOLLOW_TEAMS=Lakers,Warriors,Knicks,Spurs,Mavericks
set NBA_FOLLOW_PLAYERS=Jalen Brunson,Victor Wembanyama,Stephen Curry
set PBA_FOLLOW_TEAMS=Ginebra,San Miguel,TNT,Magnolia
npm run dry-run:nba
npm run dry-run:pba
npm run refresh
npm run refresh:nba
npm run refresh:pba
```

Use `npm run dry-run:nba` to inspect NBA only, or `npm run dry-run` to inspect the
combined document without writing `briefings-bob/sports-<date>` and
`briefings-bob/sports-latest`.

**Auto-refresh:** managed GitHub Actions run the production cadence. The Windows
scheduler remains a recovery option. After three successful PHT days for a
module, install its guarded local task:

```powershell
.\install-sports-schedule.ps1 -Module pba
.\install-sports-schedule.ps1 -Module nba
```

PBA installs at 08:20 and 21:30 PHT, NBA at 09:00 and 15:00 PHT, and tennis at
08:00 and 20:00 PHT. Each module writes a bounded ignored log. Transactional
writes preserve lanes committed concurrently by another module.

## OpenAI generation

The browser app does not call OpenAI directly. It calls the Firebase callable
function `generateBobDailyBriefing`, which keeps the API key server-side.

Setup:

```powershell
cd C:\Users\AO\projects\bobdailybriefing\functions
npm install
firebase functions:secrets:set OPENAI_API_KEY --project pokerhq-a67e4
firebase functions:secrets:set OPENAI_WEBHOOK_SECRET --project pokerhq-a67e4
npm run deploy
```

After deploy, sign in to the app and use `OPENAI GENERATE`.

Create an OpenAI project webhook subscribed to response completion events and
point it at the deployed `openaiWebhook` function URL. The 15-minute poller is
retained only as recovery if webhook delivery fails. See
[`docs/phase-1-operations.md`](docs/phase-1-operations.md) for cutover steps.

Morning 5 web-push setup and verification are documented in
[`docs/phase-2-delivery.md`](docs/phase-2-delivery.md).

Notes:

- ChatGPT Pro is a ChatGPT subscription, not the API endpoint.
- This app uses the OpenAI API through Firebase Functions.
- The default model is `gpt-5.5`; override with `OPENAI_MODEL` if needed.
