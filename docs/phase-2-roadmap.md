# Phase 2 product roadmap

Phase 2 turns the reliable feeds delivered in Phase 1 into a faster daily
decision workflow. It does not add execution, betting, or unsupported factual
generation.

## Slice 2.1 — Command Center (implemented)

- Cross-feed Morning 5 with source diversity.
- Unified attention queue with Act, Monitor, and System filters.
- Decision-review and feed-health issues outrank ordinary content.
- Followed-team fixtures surface from existing Sports preferences.
- Every item opens its original tab; confidence and urgency remain explicit.
- Deterministic client-side aggregation means no added API cost or schema change.

## Slice 2.2 — Personal priority controls (implemented)

- User-set Low, Normal, or High source weights and quiet sources.
- Pin or dismiss an item for the current PHT day.
- Account-synced preferences in a uid-scoped Firestore document.
- On-demand score composition for every queue item.
- Reliability warnings remain visible and cannot be muted or dismissed.

## Slice 2.3 — Briefing delivery (implemented)

- Optional Firebase web-push notification when the Morning 5 changes materially.
- PHT morning checks that defer inside configurable quiet hours and do not
  repeat an unchanged digest.
- Per-source delivery thresholds applied after personal priority weights;
  reliability failures always remain eligible.
- Authenticated device registration, invalid-token cleanup, test delivery,
  bounded audit history, and one-click mute controls.
- Deterministic server-side reconstruction uses the same Command Center core and
  adds no LLM cost.

## Slice 2.4 — Review loop (implemented)

- Account-synced end-of-day checklist for the Morning 5 and any additional
  queue items explicitly acted on.
- Explicit Acted, Reviewed, and Ignored states; closing a day classifies any
  remaining pending items as ignored rather than silently treating them as done.
- Rolling seven-PHT-day completion, Morning 5 handling, and ignored/pending
  source analysis, backed by a bounded 35-day review history.
- Linked closed decision outcomes are descriptive journal counts only. The UI
  labels workflow measures separately and does not present them as a forecast
  score or evidence of predictive skill.
