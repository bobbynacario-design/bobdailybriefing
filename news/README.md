# Australian insurance news feed

A deterministic daily pull of named Australian insurance trade sources. No API
key, no model call, no cost — nine public RSS/Atom feeds, deduped, ranked by a
fixed formula, written to one Firestore doc per PHT day.

## Why it exists

The briefing's `insurance` and `interruptions` sections are model-written with a
hosted `web_search` tool ([`functions/index.js:151`](../functions/index.js)).
That makes the most work-relevant part of the day non-deterministic: different
sources every run, a `source` string with no URL behind it, and search tokens
billed on every generate. For evidence work you want named sources you can audit
and re-open, not whatever a general search surfaced that morning.

This module supplies that layer. It does not replace the briefing — it gives a
later lane something real to ground it in.

## Run it

```powershell
cd C:\Users\AO\projects\bobdailybriefing\news
npm install
node refresh-news.js --dry-run    # inspect, write nothing
node refresh-news.js              # write briefings-bob/news-<PHT date>
node refresh-news.js --force      # re-run and overwrite today
npm test                          # 30 offline tests, no network
```

Firestore auth reuses `radar/serviceAccountKey.json` if `news/` has no key of its
own (same project, `pokerhq-a67e4`). A run is a no-op when today's doc already
exists, so a catch-up trigger is free.

## Shape

`briefings-bob/news-<YYYY-MM-DD>` plus a `news-latest` pointer, mirroring radar
and miro. Roughly 34 KB for a full day.

- `items[]` — up to 40, publisher's own title/summary verbatim, with `url`,
  `publishedAt`, `source`, `section`, `score`, `tier`, `tags` and a `components`
  breakdown of how the score was reached.
- `feeds[]` — one row per configured feed whether or not it was reached:
  `status`, `httpStatus`, `dialect`, `fetched`, `kept`, `duplicates`,
  `newestAt`, `stale`.
- `counts`, `warnings`, and a `note` stating plainly that the score is a reading
  order, not a forecast.

## What the feeds actually do

Verified 2026-08-29, and worth knowing before trusting a freshness number:

| Feed | Cadence observed |
|---|---|
| `daily`, `ib-au` | genuinely daily |
| `the-broker` | every few days |
| `regulatory-government`, `corporate`, `local`, `international`, `analysis` | **weekly batches** — 20 items across four Monday timestamps |
| `breaking-news` | slow trickle; despite the name, often the least fresh |

Two consequences are baked into the design:

1. **The window is 10 days, not 24 hours.** A one-day window returns nothing
   from most of these feeds on most days.
2. **Insurance Business AU is Atom, not RSS** — 44 `<entry>` elements and no
   `<item>` at all. An RSS-only reader gets zero items from it and raises no
   error, so `parse.js` handles both dialects and a feed that parses to zero
   items is recorded as `empty`, never as a quiet day.

Cross-feed duplication was measured and is currently **zero** — 204 items, 204
distinct titles. The dedupe is a guard against a publisher changing how it
syndicates, not a hot path.

## Files

- `config.js` — pure config: feeds, window, keyword tiers, score weights.
- `parse.js` — pure. RSS 2.0 and Atom to normalized items.
- `rank.js` — pure. Dedupe, window, score, rank, and the document shape.
- `refresh-news.js` — the only file that does I/O.

## Schedule

Managed by `.github/workflows/refresh-intelligence.yml`:

| Cron (UTC) | PHT | Purpose |
|---|---|---|
| `45 21 * * *` | 05:45 daily | Production run |
| `45 0 * * *` | 08:45 daily | Catch-up |

05:45 puts it ahead of Radar (06:00) and Markets (06:15), and 15 minutes before
`deliverMorningFive` starts its 06:00–11:30 PHT checks, so the day's headlines
are in Firestore before anything reads them.

The catch-up costs nothing when it is not needed: the run is a no-op if today's
doc exists, so it exits `skipped` in about a second without fetching a feed. It
still lands inside the delivery window, so a recovered run can reach a later
delivery check.

To run one on demand: Actions → *Refresh intelligence feeds* → Run workflow →
feed `news`.

## Not done yet

- **Nothing reads the doc.** No Command Center source, no front-end surface, and
  the briefing is not yet grounded in it.
- **Regulators are covered indirectly**, via insuranceNEWS's regulatory section.
  APRA, ASIC and the ICA publish no usable feed; scraping their media-release
  pages is deliberately out of scope.
