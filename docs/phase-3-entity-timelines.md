# Entity timelines

Entity Timeline is a read-only, browser-built view over the same account and
current-feed records used by Unified Search. Open **Timeline**, choose a
source-supplied entity, or type any company, asset, event, team, or topic.

## What the timeline shows

- up to 150 matching records, newest first;
- dated groups plus a distinct undated group;
- source counts and per-source filters;
- the original title, compact detail, and source metadata; and
- actions to reopen the authoritative source or save the entry to Evidence.

The quick-pick catalog is deliberately conservative. Labels come only from
structured fields already present in the source record: Decision assets, Radar
symbols and company names, Markets events, Sports teams, Research tags, and any
explicit briefing entities, assets, or tags. Free-form topics still work through
deterministic all-token matching across the local index.

## Accuracy boundary

A timeline is a sequence of stored mentions, not a reconstructed history. It
does not invent records between archive dates, treat silence as evidence, infer
causality, or claim that two similarly worded items describe the same event.
Undated records are labeled rather than assigned an estimated date.

## Privacy and cost

Timeline queries and grouping stay in the browser. The feature uses data the
signed-in account can already load, creates no timeline-history document, and
makes no OpenAI call. Its in-memory query and results are reset with the shared
search index on sign-out or lock.
