# Daybook

Private daily briefing desk: briefing, markets, decisions and a daily spark.
(The repository and Pages URL keep the original `bobdailybriefing` name.)

## Features

- **From insight to action** — weekly read-back suggestions have a review date
  and **Try this** action that saves an experiment without replacing one already
  saved today. Theme day citations open the matching daily entry; explicit ISO
  dates in the prose also link when inside that read's seven-day window. Missing
  entries are explained instead of guessed. The read-back waits for confirmed
  reflection sync, stops on save failure, and retains a fresh result when an older
  history request finishes later.
- **Aha actions** — **Save insight** opens the Evidence picker with a snapshot of
  the interpretation, sources and “Wrong if” condition. **Write my take** opens
  the daily reflection without truncating an existing note. **Check this later**
  lets you choose a review date and creates an experiment with its source context.
  These reviews appear in the app; they do not add push notifications.

- **Personal daily practice** — choose motivation, clarity, curiosity, calm, or
  a challenge to select a fitting spark. Save favourites and filter the library
  to revisit them. One experiment per day captures an action, review date, and
  outcome; the experiments panel (open experiments plus those reviewed in the
  last two weeks) remains visible when the spark is tucked away.
  Review dates are in-app prompts, not additional push notifications. Experiments
  follow the existing 90-entry retention and appear in the reflection export.
  Favourites carry forward into new daily entries and sync with the account.
- **Safer reflection sync** — atomic account transactions merge edits by field
  and individual story/reminder, including removal markers. Conflicting note text
  is retained in “Recovered reflection versions” (up to three per day, kept two
  weeks, each with Use this version, which keeps the replaced note, and Dismiss,
  which sticks across devices), rather than silently discarded. A note builds on
  the version the device last synced, so typing between syncs, or while a save is
  in flight, is never mistaken for a conflict; saves send a snapshot. Legacy entries migrate on sync. Watch
  reminders accept an explicit date of today, and their Due date can be changed
  in place.

- **Help** — the Help tab opens with a plain-language Today section (the spark,
  reading the briefing, reminders and experiments, sync/search/archive, keys)
  before the Radar, Journal, Markets and Sports guides.

- **Daily Boost** — Today opens with a rotating perspective and a small, actionable
  quest. Choose a two-minute step or ten-minute exploration, switch quests, mark a
  small win, and capture a reflection. The reflection saves as it is typed; the
  line beside the box reads “Saving…”, then “✓ Saved 9:41 PM · on all your
  devices” (or “on this device”) and fades, and **Done ✓** (Ctrl/Cmd+Enter)
  sends a pending edit at once and closes the keyboard. Browse or search 50 curated sparks across
  eight themes, including Work craft (forensic, claims and reporting habits),
  each with a short and deeper quest. Prompts rotate by PHT date through a
  theme-interleaved order, so consecutive days (and each “Try another quest”)
  land on a different theme, and sparks used in the last 14 days are skipped.
  Sundays (PHT) bring a Weekly look-back instead: the notes from the six days
  before, one of which can be carried forward, and that note rides along on the
  spark card from Monday to Saturday. The look-back sits outside the rotation
  and can also be chosen from the library on another day. Ten evidence sparks
  are briefing-linked (Turn a headline into a question, Look for the exception,
  Test one assumption, Find the missing voice, Build a question ladder,
  Separate seeing from assuming, Give disagreement a fair hearing, and the claims
  sparks Read it as the insured would, Test the “but for” story and Look for the
  missing document): their quests name the top story of the briefing shown on
  Today (highest relevance first; the claims sparks prefer insurance and
  interruptions stories; labelled with its date when it is not today’s), with a
  button that jumps to that card. The story is fixed on the day’s entry once the
  quest is started, and with no briefing loaded each spark keeps its own words.
  Each briefing card has **✎ Note this**: it opens today’s reflection with
  “On <headline> (<source>): ” filled in and keeps the story, with its link, on
  the day (up to six). Noted stories show under the reflection as chips that jump
  back to the card, open the source, or come off the list. **⧉ Copy citation**
  copies “Headline” — Source, 25 September 2026. https://… (briefing date,
  day-month-year; the link only when the story has a web link) for reports,
  RFIs and emails. **＋ Evidence** saves the story, with its link, to an Evidence
  set (the same item a Search result would make, reopening this briefing); saved
  items show **Source ↗**, and research notes print the link. Opening a card's source link (click or middle-click) keeps the
  story on the day, and any card opened in the last seven days shows **✓ Opened**
  on every device (up to 20 a day, kept two weeks, trimmed on the account copy
  too). The Sunday look-back adds **Stories from your week**: everything opened,
  noted or taken to a linked spark over the week, once each, with its link and
  **✎ Write about it**. A small line under the spark title says why it is there
  (today’s rotation, Sunday look-back, picked from the library, or swapped to) and
  what it is paired with (e.g. “paired with today’s top insurance story”).
  Quick keys on Today: **N** jumps to the note, **D** marks the quest done (or
  undoes it), **T** tucks the card away or reopens it. They are ignored while
  typing, with Ctrl/Cmd/Alt held, off Today, or behind an overlay; the hint shows
  only on devices with a keyboard and mouse. Reflections are searchable with
  **Ctrl+K** alongside briefings, research and decisions: by the note’s words or
  the headlines of the stories that day was about, indexed fresh on each search.
  A result opens that day: today goes to the note, an earlier day is pinned to the
  top of “Your recent discoveries”, opened and highlighted. The Morning 5 push
  adds a second line, “Today’s spark: …”: the spark already on today’s entry,
  else the default the app would show, worked out on the server from the synced
  history with the same code (lib/daily-boost.js, synced into functions/).
  They work independently of live feeds and require no model calls. Reflections
  and completion sync across devices through the signed-in account
  (`briefings-bob/daily-boost-<uid>`, private to that account under the existing
  rules), keeping up to 90 dated entries with the seven most recent prior entries
  shown. Older days are not lost: the save that pushes a day out of that window
  first copies it (note, spark, stories, reminders, experiment, carried note;
  not reading history or sync bookkeeping) into a yearly archive,
  `daily-boost-archive-<uid>-<year>`, in the same transaction. The archive loads
  after sign-in, so Ctrl+K search, opening a result and Copy all reflections
  reach every day; the discoveries list shows how many are archived. Each device keeps a working copy; the account copy is merged in on
  sign-in and on return, independent fields and list items merge, and changed days are
  written 1.5 s after an edit or at once when the page is left. Progress is
  gentle, with no streak penalties. The intelligence briefing remains directly
  below the daily practice. Once today’s quest is done
  (or tucked away with “Tuck away · briefing first”), returning to Today shows it
  as a one-line strip with your note, so the briefing comes first; it reopens on
  request and starts fresh the next day. A Monday-to-Sunday dot row counts this
  week’s small wins (no streaks), and “Copy all reflections” puts every stored
  entry on the clipboard as plain text, falling back to a selectable box.

- **Your week, read back** — a panel on Today (open by itself on Sundays).
  **Read my week back** calls `generateWeeklyMirror`, which reads the last seven
  PHT days server-side — Daily Boost notes, quests, noted/opened/voted stories,
  reminders and experiments, plus journal decisions logged or closed that week
  (process only: no prices or sizes) — and asks the model for a strict-JSON read:
  the week in a line, up to three recurring themes with their days, what gave or
  took energy, where what he said and did part ways, where his attention went,
  how he decided, a follow-up on the question and try of the last read at least
  five days old (never one from the day before), one small
  thing he has not done yet, and one question to sit with
  (`functions/weekly-mirror.js`). The rules are evidence-only (every point cites a
  day; a quiet week is called thin), no diagnosis or flattery, and no trading
  advice. Today is marked as still in progress, with the read time, so its
  unfinished quest is never held against him; “Note this” lines left without a
  comment count as noted stories, not as his words (and a blank “Write my take”
  line on the aha is dropped, while a written one is kept as his take); energy comes only from his
  own words or explicit choices; and a theme needs two or more days (the app
  labels single-day themes “What stood out”). An empty week makes no model call. Up to three reads a day
  (`MIRROR_DAILY_CAP`); the latest twelve are kept on
  `briefings-bob/weekly-mirror-<uid>` and shown by `lib/weekly-mirror.js`. Cost is
  metered as `weekly-mirror` in the Help tab.

- **New since yesterday** — each briefing card is marked **New** (not in the
  previous briefing) or **Day N** (its Nth briefing in a row), compared with the
  archive by link or by headline wording (two content words and 60% of the
  shorter headline shared, since running stories are reworded daily). Nothing is
  marked when there is no earlier briefing to compare with. A **reading
  progress** line at the top of the briefing counts stories read (“4 of 11 read ·
  1 high-relevance left”) with a meter and **Next unread** (highest relevance
  first). A story counts as read when its source was opened, it was noted, or it
  was **Mark read** by hand (which also works for stories with no link, and can be
  undone); cards show ✓ Opened, ✓ Noted or ✓ Read, synced with Daily Boost.
  Insurance and interruptions cards that name a watch metric have **⏰ Remind
  me**: the reminder is due on a date named in the metric (“due 12 Oct”), else
  by its horizon (days 3, weeks 14, months 30 days). Due and overdue reminders
  appear in a **⏰ To check** panel above the briefing with ✓ Checked, ✎ Note what
  you found (starts today’s note) and Snooze a week; upcoming ones fold beneath.
  Reminders live on the day they were set, sync, and appear in copied reflections.
  Due reminders also reach the Morning 5 push: a “⏰ To check: …” line in the
  regular notification, or, on a morning the Morning 5 has not changed, a push
  of their own (“⏰ To check today”, opening Today). Each reminder is announced
  once, so checking one off never re-sends the rest; a snoozed one returns when
  it is due again. Quiet hours still apply.

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
- **Source links** — every story asks for the url of the article it came from.
  The generator requests the full list of pages its web search returned
  (`include: web_search_call.action.sources`) and keeps a story link only if it
  matches that list or the news snapshot; anything else is removed and counted
  in `briefing.links`. Insurance stays closed to the snapshot on a grounded day.
  Kept links open from the card's source chip ("Source matched" for the news
  feed, "Link verified" for a search result).
- **Today’s aha** — every briefing asks for one non-obvious read (`aha`): a
  connection between two stories from different sections, a second-order effect
  further downstream than any source goes, or a contrarian case that the
  consensus reading is wrong — with a 2–4 step chain, the headlines it is built
  on, and one checkable `wrong_if` signal (the nearest one that bears on those
  stories, and one that will actually be published in a form that answers it).
  Its title must be the step beyond what the linked stories already say. It must
  not restate a relevance line or a first-order consequence, leans early rather than safe, never advises a trade,
  and is null when nothing clears the bar. `cleanAha` in
  `lib/briefing-prompt-core.js` (shared by the generator and the paste path)
  bounds the fields and keeps only links that name a story in the briefing; the
  app shows it as a card at the top, with chips that jump to those stories, and
  in the Markdown and PDF exports.
- **Reader feedback** — each briefing card has ▲ More like this / ▼ Less like
  this (the newest vote on a story counts; the same button takes it back). Votes
  sync on the Daily Boost days, and the generator turns the last 30 days into a
  READER FEEDBACK block of up to ten examples each way plus a per-section tally
  (`buildReaderFeedback` in `lib/briefing-prompt-core.js`), with rules that it
  steers priority only, never overrides grounding, the budget or relevance
  levels, and is never reported back. The verification line shows “Tuned by
  your feedback: N more, M less.” **Copy AI prompt** carries the same block,
  built on the device from the synced votes, so a briefing generated in an
  outside AI and pasted back is steered by them too (votes on a pasted briefing
  are saved like any other).
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
