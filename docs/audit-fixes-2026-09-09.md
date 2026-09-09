# Audit fixes — 9 September 2026

Implemented locally; not deployed.

## Reliability and data handling

- Confirmed the deployed Command core URL returns a GitHub Pages 404. The release build now bundles all seven application scripts into the HTML, copies standalone files for offline caching, validates initialization, and emits a content-derived version. Publishing depends on CI and artifact checks.
- Command, Search, and Evidence expose missing-dependency errors. Command and Search bound source loads, label partial failures, and provide refresh actions. Search reloads after five minutes or briefing changes, and reports its archive coverage.
- Missing grounding metadata is visibly marked unknown. Stories distinguish matched and unverified sources. Briefing relevance alone no longer means high confidence or an instruction to act; its quick review action is Reviewed.
- Read-only archive and automatic briefing loads do not write back to Firestore or change saved timestamps.
- Briefing caches are scoped to the Firebase UID and removed on explicit sign-out. The old unowned cache is removed rather than assigned to whichever account signs in next. Failed reads cannot populate another account's search state. Sign-out clears private inputs, reports, evidence, decisions, and visible content; the auth gate makes application surfaces inert.
- Evidence uses a Firestore transaction and a three-way merge to preserve independent edits. Competing edits to the same field stop saving and retain pending work in the session. Export evidence before using Reload evidence to resolve a conflict. Load failure is distinct from an empty account.
- Generation requires a verified configured owner, restricts briefing model selection, and reserves quota transactionally before contacting the provider. Repeated request IDs reuse a completed result or reject an in-flight/failed attempt instead of starting paid work twice. Research report IDs no longer depend on millisecond timestamps.

## UI

- Five navigation groups replace fourteen equal-weight tabs: Home, Explore, Research, Decisions, and More.
- Market values and movement summaries are compact; provenance and full descriptions are available in expandable details. Weather follows the same pattern.
- Import/JSON tooling is collapsed by default. Generate, Copy briefing, Export PDF, and Morning 5 are contextual briefing actions.
- Briefing priorities sort high relevance ahead of medium. The former Actionable reading filter/count is labeled Relevant.
- Source titles are native buttons. Command navigation can identify individual briefing, Radar, Markets, and Decision cards; missing or filtered-out items produce an explicit notice. Archived briefing search/evidence links focus the corresponding story. A return button leads back to Morning 5.
- Search and evidence modals trap keyboard focus and restore it on close. The auth gate also confines focus. Secondary text tokens have stronger contrast; phone layouts avoid the hero watermark overlapping titles and keep card actions in their own grid row.

## Generation configuration

- `GENERATION_OWNER_EMAILS`: comma-separated verified owner emails; defaults to the existing Bob account used by this project.
- `BRIEFING_DAILY_CAP`: defaults to 5 attempts per Manila calendar day.
- `DEEP_RESEARCH_CAP`: defaults to 20 attempts per Manila calendar month. The existing research metadata limit also remains in force.
- `OPENAI_MODEL`: the only enabled briefing model; existing deep-research model configuration is retained.

Reservations intentionally count uncertain or failed attempts: a provider timeout can still incur cost. Failed attempts are recorded, and automatic replay is blocked. The operator can inspect `generation-requests` and `generation-budgets` when reconciling a provider incident. These are server-owned collections; the Admin SDK writes them. The stale reference Firestore rules in this repository were not modified or deployed.

## Verification

- Full `npm test`, including generation concurrency/idempotency, evidence merge conflicts, account-specific cache fallback, late search responses, unknown grounding, source failures/retry, and artifact initialization.
- `npm run check:functions` and `git diff --check`.
- Browser checks using an isolated fixture: populated Command, known Search results, source-story focus, modal focus trap/return, evidence create/save/open, partial feed warnings, phone layout, and sign-out isolation. Firebase writes, paid generation, and notification delivery were not tested against production.
- `npm run audit` passed the configured high-severity threshold. Existing moderate `qs`/`uuid` dependency-chain advisories remain; no forced Firebase downgrade was applied.

To reproduce the visual preview, run `npm run build` then `node scripts/preview-audit.js`. Open `http://127.0.0.1:4173`; append `?partial#command` to simulate a failed Radar load. The fixture does not connect to Firebase or OpenAI.

The later feature ideas from the audit—cross-day event clustering, unified follows, and broader evidence-to-decision automation—remain roadmap work, separate from these fixes.
