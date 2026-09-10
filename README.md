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
  An account-synced review loop classifies each priority as acted, reviewed, or
  ignored and shows seven-day review discipline, source-level misses, and linked
  closed decision outcomes without treating workflow metrics as forecast skill.

- **Daily briefing** — OpenAI-generated intelligence desk (see below).
- **Unified search** — press `Ctrl+K` (`Cmd+K` on macOS) to search up to 100
  archived briefings plus research reports, decisions, and current Radar,
  Markets, and Sports snapshots. Ranking runs locally with no model call and
  every result opens its original source surface. Search results and Command
  Center priorities can be saved into account-synced **Evidence** sets with
  provenance, capture time, and personal notes. **Entity Timeline** groups the
  same stored records around a selected asset, company, event, team, or topic
  while keeping archive gaps explicit.
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
The review-state model and metric definitions are documented in
[`docs/phase-2-review-loop.md`](docs/phase-2-review-loop.md).

The prompt itself lives in one place — `lib/briefing-prompt-core.js`, shared by the
server generator and the app’s copy-prompt button, so what Bob can read is what
actually runs. The generated briefing is shaped by four things beyond it:

- **Grounding** — the insurance section is built only from the day's fetched
  news snapshot, and returned URLs are verified against what was supplied
  (`functions/briefing-evidence.js`).
- **Standing context** — Bob's open decision-journal calls with their
  invalidation lines, confirmed/forming Radar setups, and event markets past the
  research gate are put in front of the model as private state
  (`functions/briefing-context.js`). Stories that bear on a named call are said
  to do so; connections are never manufactured, and the briefing never
  recommends an entry, exit or size. Missing feeds degrade section by section
  and never block generation.
- **Verified figures** — PSEi and USD/PHP come from the `radar-ph` snapshot;
  ASX 200 and the S&P 500 from Yahoo; the Metro Manila forecast from open-meteo.
  The model is given the real numbers and forbidden from producing its own, then
  the server overwrites the fields anyway and **blanks any figure no source could
  confirm** (`functions/market-facts.js`). Every value carries its as-of date and
  source, shown under the ticker’s “As of / details”. Prose — the peso driver, the
  weather impact note — stays the model’s.
- **Watch follow-up** — the previous briefing's `watch` line is carried into
  today's prompt and graded `advanced`, `stalled`, `resolved`, `dead` or
  `no_news` in `watch_followup`, rendered as the LAST WATCH card. Same-day
  regenerations are skipped so the model never grades its own line.

Section quotas are a budget, not a floor: at most 14 stories overall and 4 per
section, spent on insurance and interruptions first. Sections may be empty, and
a quiet day is expected to produce a shorter briefing rather than a padded one.

Notes:

- ChatGPT Pro is a ChatGPT subscription, not the API endpoint.
- This app uses the OpenAI API through Firebase Functions.
- The default model is `gpt-5.5`; override with `OPENAI_MODEL` if needed.
