# Phase 3 product roadmap

Phase 3 turns the app's growing archive into a reusable intelligence library.
Retrieval remains deterministic by default: source records stay authoritative,
and no model call is made merely to find or open existing material.

## Slice 3.1 — Unified intelligence search (implemented)

- `Ctrl+K` / `Cmd+K` command palette available from every signed-in page.
- Lazy, session-local index over up to 100 archived briefings, 50 research
  reports, 100 decisions, and the current Radar, Markets, and Sports snapshots.
- Multi-token, accent-insensitive ranking across titles, summaries, body text,
  tags, statuses, teams, and symbols.
- Keyboard selection and direct routing back to the original briefing, report,
  or source tab.
- Search terms are processed in the browser, add no LLM cost, and are cleared
  with the in-memory index on sign-out.

## Slice 3.2 — Saved evidence sets (implemented)

- Save Search results and Command Center items into named, account-synced sets.
- Preserve source identity, compact source text, capture date, route, and a
  bounded personal note for every item.
- Dedicated Evidence workspace supports create, rename, remove, delete, note,
  and reopen-source workflows.
- Storage is capped at 12 sets and 30 items per set inside the existing
  authenticated preferences document, requiring no new rules or backend.

## Slice 3.3 — Entity timelines (implemented)

- Build a newest-first timeline for any typed company, asset, event, team, or
  topic from the existing six-source local index.
- Offer quick picks only from structured entity fields already supplied by the
  source, including assets, companies, market events, report tags, and teams.
- Filter matching records by source, reopen every authoritative source, or save
  an entry into an Evidence set.
- Clearly label undated records and archive gaps; no continuity, causality, or
  missing events are inferred.

## Slice 3.4 — Evidence-pack export

- Export a selected evidence set or entity timeline as a concise review pack.
- Separate quoted source material, user notes, and computed metadata.
- Keep model-assisted synthesis optional, cost-visible, and explicitly labeled.
