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

## Slice 3.2 — Saved evidence sets

- Save search results and Command Center items into named evidence sets.
- Preserve source identity, capture date, and a short user note.
- Reopen the original record; never copy a claim without provenance.

## Slice 3.3 — Entity timelines

- Group existing briefing, research, decision, and signal records by selected
  company, asset, event, team, or topic.
- Show dated source entries and changes without inventing missing continuity.

## Slice 3.4 — Evidence-pack export

- Export a selected evidence set or entity timeline as a concise review pack.
- Separate quoted source material, user notes, and computed metadata.
- Keep model-assisted synthesis optional, cost-visible, and explicitly labeled.
