# Sports Tab Roadmap: NBA + PH Local Pulse

Created: 2026-07-18

## Implementation Status

- NBA MVP: implemented on 2026-07-18 using ESPN's public basketball feed.
- NBA output: rolling games, recent results, conference standings, last-five momentum, and configurable watchlist.
- NBA enrichment: rest/back-to-back flags, recent game leaders, and ESPN availability entries.
- NBA postseason: ESPN round labels and series scores drive an event-based bracket; configurable player pins are supported through `NBA_FOLLOW_PLAYERS`.
- NBA resilience: the refresh retains the last good NBA snapshot when the provider fails.
- NBA refresh: remains manual during the offseason; no Windows schedule has been restored.
- PVL MVP: implemented on 2026-07-18 using official pvl.ph schedule, homepage recap, and standings pages.
- PVL output: upcoming matches with venues, current recaps, standings, set-based momentum, and configurable watchlist.
- PVL enrichment: official scorer, spiker, blocker, server, digger, setter, and receiver leader tables with conference labels.
- Shared team detail: each NBA/PVL team profile combines record, momentum, next/latest match, margin, and availability where supplied.
- PVL postseason: quarterfinal, semifinal, third-place, and final stage labels automatically activate the shared bracket renderer.
- PVL resilience: the refresh retains the last good PVL snapshot when the official page structure or network fails.
- Shared freshness: each module publishes last-success, attempted-refresh, stale threshold, and fallback status fields; both UIs render a visible health banner.
- Operations: module-specific logs and run history are implemented. The guarded scheduler installer requires three successful PHT days before registration.

## Decision

Replace the paused FIFA World Cup sports lane with two basketball/volleyball-oriented tracks:

1. NBA Momentum Radar as the main long-term Sports tab module.
2. PH Local Pulse as a smaller local module, starting with PVL because its schedule, recaps, standings, and player/team pages are currently more accessible than PBA.

The old `BobDailyBriefing-SportsRefresh` scheduler has been removed. Sports refresh should stay manual until the new module has a stable feed and output contract.

## Product Goal

Turn the Sports tab from a one-event FIFA tracker into a repeatable sports intelligence surface:

- Show what is active now.
- Rank teams by form and momentum.
- Surface upcoming fixtures that are worth watching.
- Keep clear separation between factual score/schedule data and any model-style interpretation.
- Keep the framing research-only, with no betting execution language.

## Module 1: NBA Momentum Radar

### Why NBA First

NBA is the best long-term technical fit:

- Cleaner schedule, standings, and game data ecosystem than most PH local leagues.
- Strong recurring season from preseason through playoffs.
- Easy to produce useful momentum metrics from box scores, rest, streaks, and recent margins.
- Natural fit for a dashboard: team form, next games, star watch, injury/news context later.

### Initial Scope

The first NBA version should include:

- League status card: phase, next key date, last refresh time.
- Upcoming games: next 7-10 games, localized to PHT.
- Recent results: last 10-15 completed games.
- Team Momentum table:
  - team
  - score
  - label: RISING, WATCH, STEADY, FADING
  - last 5 form
  - recent net rating proxy
  - average margin
  - rest/back-to-back flag
- Watchlist:
  - configurable favorite teams
  - default can be Lakers, Warriors, Knicks, Spurs, Mavericks unless overridden.
- Notes:
  - season phase caveat
  - data-provider caveat
  - "research only, not advice" disclaimer

### Later NBA Enhancements

Implemented after the basic feed stabilized:

- Recent player/game-leader watch.
- Injuries and availability.
- Rest and back-to-back alerts.

Still optional later:

- Configurable star and rookie watchlists.
- Confirmed lineup alerts when a reliable source is available.
- NBA Cup group tracking.
- Richer bracket seeding only if ESPN exposes a stable seed contract.
- Market Lens only if there is a clean, legal, and useful market source.

### NBA Data Options

Preferred order:

1. Official or semi-official NBA stats endpoints if stable enough for local refresh.
2. TheSportsDB for schedule/teams as a fallback or supplemental source.
3. Manual/static key-date fallback for offseason periods.

Avoid building the module around fragile news scraping for MVP.

## Module 2: PH Local Pulse: PVL First

### Why PVL First

PVL is the best immediate PH local option:

- Active schedule and recaps are available.
- Official site exposes upcoming matches, recent results, standings, and player-of-the-game style data.
- It gives the Sports tab a local PH lane before NBA fully restarts.

### Initial Scope

The first PVL version should include:

- Upcoming matches:
  - date
  - venue
  - teams
  - time in PHT
- Recent recaps:
  - teams
  - set score
  - winner
  - player of the game if available
- Standings:
  - rank
  - team
  - wins
  - losses
- Team Pulse:
  - recent form
  - set differential
  - match streak
  - label: RISING, WATCH, STEADY, FADING

### Later PVL Enhancements

- Player leaderboards: scorer, spiker, blocker, server, digger, setter, receiver. Implemented.
- Conference stage tracking.
- Finals/playoff bracket when available. Renderer implemented; activates from official stage labels.
- Team detail pages/cards. Implemented.

### PBA Position

PBA is still possible, but should not be the first PH local implementation unless the user explicitly wants PBA over PVL.

Reason:

- Official public data appears less consistently structured.
- It may require heavier scraping or manual fallback.
- PVL is likely faster to ship and easier to keep reliable.

## Shared Data Contract

Keep the current Sports tab pattern but generalize it beyond FIFA:

```json
{
  "title": "Sports Briefing",
  "asOf": "2026-07-18",
  "generatedAt": "2026-07-18T00:00:00.000Z",
  "modules": {
    "nba": {
      "enabled": true,
      "phase": "offseason",
      "upcoming": [],
      "recent": [],
      "standings": [],
      "momentum": [],
      "watchlist": [],
      "providerNote": ""
    },
    "pvl": {
      "enabled": true,
      "phase": "active",
      "upcoming": [],
      "recent": [],
      "standings": [],
      "momentum": [],
      "providerNote": ""
    }
  }
}
```

For backward compatibility, keep `worldCup` rendering available until the UI is fully migrated.

## UI Plan

### Sports Home

Top-level Sports tab should become a module selector:

- NBA
- PH Local
- Archive: FIFA World Cup

### NBA View

Recommended sections:

1. Key Dates / League Status
2. Team Momentum
3. Next Games
4. Watchlist
5. Recent Results
6. Standings

### PH Local View

Recommended sections:

1. PVL Status
2. Upcoming Matches
3. Team Pulse
4. Recent Recaps
5. Standings
6. Player Leaders, later

## Refresh Plan

### Phase 0: Manual Only

Keep all sports refreshes manual until the data source proves stable:

```powershell
cd C:\Users\AO\projects\bobdailybriefing\sports
node refresh-sports.js --module nba --dry-run
node refresh-sports.js --module pvl --dry-run
```

### Phase 1: Manual Firestore Writes

Once dry-run output is good:

```powershell
node refresh-sports.js --module nba
node refresh-sports.js --module pvl
```

### Phase 2: Scheduled Refresh

The guarded installer is implemented in `install-sports-schedule.ps1`. It refuses
to register a task until `run-history.json` contains successful refreshes on at
least three distinct PHT days for that module.

Suggested cadence:

- NBA in-season: every 6 hours, or daily at 07:00 PHT and 19:00 PHT.
- NBA offseason: weekly or manual only.
- PVL active conference: daily at 08:00 PHT, plus match-day evening refresh if useful.

Do not restore the old every-30-minutes FIFA cadence. It is too noisy for these modules.

## Implementation Steps

### Step 1: Split the Sports Data Builder - Complete

Refactor `sports/refresh-sports.js` into module builders:

- `buildWorldCupDoc()`
- `buildNbaDoc()`
- `buildPvlDoc()`
- shared helpers for dates, status labels, momentum labels, Firestore writes

Keep the current script entrypoint, but add module flags:

```powershell
node refresh-sports.js --module nba
node refresh-sports.js --module pvl
node refresh-sports.js --module all
```

### Step 2: NBA MVP - Complete

Build NBA feed and renderer first:

- key dates fallback
- teams list
- schedule/upcoming
- recent games if available
- basic team momentum
- Firestore write to `briefings-bob/sports-nba-<date>` and pointer `sports-nba-latest`

### Step 3: PVL MVP - Complete

Build PVL scraper/feed:

- schedule
- recaps
- standings
- basic team pulse
- Firestore write to `briefings-bob/sports-pvl-<date>` and pointer `sports-pvl-latest`

### Step 4: UI Migration - Complete

Update `index.html` Sports tab:

- Add module tabs inside Sports.
- Render NBA as the default once it has useful data.
- Render PH Local as secondary.
- Move FIFA to archived/legacy view.

Update `sports.html` public page only after the main app is stable.

### Step 5: Validation - In Progress

Before enabling schedule:

- Run dry-runs for NBA and PVL.
- Verify generated JSON shape.
- Verify browser render does not show empty or stale sections.
- Verify Firestore latest pointers update correctly.
- Confirm stale-data banners work.

### Step 6: Scheduler Reintroduction - Guarded Installer Complete

Only after stable manual runs:

- Create `BobDailyBriefing-NbaRefresh`.
- Create `BobDailyBriefing-PvlRefresh` only if PVL feed is reliable.
- Log to separate files:
  - `sports/refresh-nba.log`
  - `sports/refresh-pvl.log`

## Risks

- NBA data endpoints may be unofficial or rate-limited.
- PVL pages may change markup without notice.
- PBA may require manual fallback or a paid/less obvious data source.
- A generic sports page can become cluttered if every module tries to show the same sections.

## Recommended Next Action

Complete the three-distinct-day reliability trial for PVL, then install its
guarded schedule. Keep NBA weekly/manual during the offseason. The next product
work after operations stabilize is PVL stage/bracket support and configurable NBA
star/rookie watchlists.
