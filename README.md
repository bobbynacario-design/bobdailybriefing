# Bob Daily Briefing

Private daily intelligence briefing desk for Bob.

## Features

- **Daily briefing** — OpenAI-generated intelligence desk (see below).
- **📡 Market Radar** — daily ranking of ~30 assets across 11 themes, with a
  performance journal. Docs: [`radar/README.md`](radar/README.md).
- **🎲 Markets** — daily "scenario read" over curated Polymarket event markets:
  market price vs an independent AI panel, executable edge, GO/NO-GO, and a
  Brier-score journal. The honest version of "MiroFish" — research framing, never
  a bet or execution. Docs: [`miro/README.md`](miro/README.md).
- **⚽ Sports** — a provider-backed sports briefing tab. NBA is the default lane,
  with rolling results, conference standings, a last-five momentum model, and a
  configurable team watchlist from ESPN's public basketball feed. PH Local/PVL
  adds official fixtures, recaps, standings, and set-based momentum from pvl.ph,
  while FIFA World Cup remains available as an archive. The local
  runner writes `briefings-bob/sports-*` docs and a `sports-public.json` mirror.

- **💰 LLM usage & cost** (Help tab) — every OpenAI call across the app (briefing,
  deep-research, radar catalyst, Markets panel) records token usage to a shared
  ledger (`briefings-bob/llm-usage`); the Help tab ranks the spend by feature in
  USD from a single auditable rate table (raw API cost, no markup; unconfirmed
  model rates shown "unpriced", never guessed).

Each market feature is a **local Node refresh script** that writes Firestore docs
the front end reads — no Cloud Functions, no build step.

## Sports refresh

The Sports tab defaults to NBA. NBA ingestion needs no API key. The archived FIFA
module still uses football-data.org; keep that token local/server-side.

```powershell
cd C:\Users\AO\projects\bobdailybriefing\sports
npm install
set FOOTBALL_DATA_TOKEN=your_token_here
set SPORTS_FOLLOW_TEAMS=Australia,England
set NBA_FOLLOW_TEAMS=Lakers,Warriors,Knicks,Spurs,Mavericks
set PVL_FOLLOW_TEAMS=Creamline,Choco Mucho,PLDT,ZUS Coffee
npm run dry-run:nba
npm run dry-run:pvl
npm run refresh
```

Use `npm run dry-run:nba` to inspect NBA only, or `npm run dry-run` to inspect the
combined document without writing `briefings-bob/sports-<date>` and
`briefings-bob/sports-latest`.

**Auto-refresh:** paused after the FIFA lane. The previous Windows Task Scheduler
job `BobDailyBriefing-SportsRefresh` has been removed; run the script manually
when a new sports module is active. The app reads the latest Firestore doc when
the Sports tab opens.

## OpenAI generation

The browser app does not call OpenAI directly. It calls the Firebase callable
function `generateBobDailyBriefing`, which keeps the API key server-side.

Setup:

```powershell
cd C:\Users\AO\projects\bobdailybriefing\functions
npm install
firebase functions:secrets:set OPENAI_API_KEY --project pokerhq-a67e4
npm run deploy
```

After deploy, sign in to the app and use `OPENAI GENERATE`.

Notes:

- ChatGPT Pro is a ChatGPT subscription, not the API endpoint.
- This app uses the OpenAI API through Firebase Functions.
- The default model is `gpt-5.5`; override with `OPENAI_MODEL` if needed.
