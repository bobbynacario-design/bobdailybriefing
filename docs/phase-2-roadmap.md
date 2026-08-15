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

## Slice 2.3 — Briefing delivery

- Optional morning digest notification when the Morning 5 changes materially.
- Configurable quiet hours and source thresholds.
- Delivery audit trail and one-click mute controls.

## Slice 2.4 — Review loop

- End-of-day review checklist for acted-on items.
- Weekly command-center outcomes and ignored-signal analysis.
- Measure whether prioritization improves review discipline without overstating
  forecasting accuracy.
