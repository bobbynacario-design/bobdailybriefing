# Phase D: publishing and consumer handovers

Updated 2026-09-27. This records the implementation in Daybook; the contract is
[grounding-roadmap.md](grounding-roadmap.md). No real pilot values are included.
Daybook's side is live and checked (see "Live result" below); Phase D waits on
a Functions redeploy and the two consumer follow-ups.

## Implemented in Daybook

- `grounding/producer.js`: complete snapshots, revisions, blocked/conflict watches,
  freshness, change notices and validator-computed trust for the UI mirror.
- `grounding/release.js`: numbered releases and SHA-256 manifests. Unchanged
  files retain their exact bytes and original `generatedAt`, so a watch-only
  release does not force consumers to reprocess facts.
- `grounding/publisher/publish.js`: validates the prior release, loads reviewed
  manual captures, checks only due automated sources and refuses to overwrite
  release directories. Operational check times remain outside public releases.
- `.github/workflows/refresh-intelligence.yml`: daily 04:15 PHT scheduler and
  manual `feed=grounding` dispatch. A serialized job creates/checks out the orphan
  `grounding-data` branch, writes a release, pushes it, then mirrors it. A failed
  push cannot advance the Firestore mirror. A later run recovers change notices
  if a push succeeded but the mirror write failed.
- `briefings-bob/grounding-latest`: current figures with computed trust, watch
  states and up to 30 days of changes. `grounding-ops` stores per-series check
  times. `feed-health` records the grounding run; unresolved source errors stay
  failed even on a day when the source is not due.
- Evidence has a folded **Your numbers** panel with source, observation and
  publication dates, effective date, trust and watch status. Missing releases
  and load errors have separate messages. New facts and state changes enter
  Morning 5/Attention Queue for seven days using stable event IDs, and enter
  the server's normal opt-in notification selection. Superseded fact notices
  drop out. Feed failures enter the reliability queue.
- `grounding/fetch-release.js`: dependency-free reference adapter for copying
  into consumers. It pins one pointer, verifies exact response bytes, rejects
  unexpected paths/file names, verifies the complete release and retries a
  cache lag three times, 30 seconds apart. It returns `{input, release}`;
  existing consumer importers still perform their own validation and planning.

## Verification and first publication

Run `npm test` for the app, publisher, fixtures and build checks, and
`npm --prefix grounding run fixtures:check` to confirm fixture stability.
Publisher tests use temporary directories and mocked Firestore/fetch; no live
writes are required. The empty registry is intentional until E and F.

Local verification on 2026-09-27: `npm test` passed all 511 tests plus app smoke
and site build checks; `npm run check:functions` passed; all 16 contract files
passed `fixtures:check`; the no-Firestore dry run proposed an empty release 1.

Local inspection, without writing files or Firestore:

```powershell
node grounding/publisher/publish.js --data-dir gdata --dry-run --no-firestore
```

After the reviewed changes reach main, dispatch **Refresh intelligence** with
`feed=grounding`. Confirm:

1. `grounding-data` has no main history and holds
   `grounding/latest.json` and `grounding/releases/000001/`.
2. The release passes `fetchRelease`; each digest matches. An empty first
   release is expected before pilots.
3. Firestore mirror sequence and digest match that release, and grounding
   health is recorded. A second unchanged dispatch creates no release.
4. Evidence loads the empty state; a real pilot later supplies figures and
   Morning 5 changes. Frontend publication and the updated Firebase Functions
   deployment are both needed for browser/server notification parity.

### Live result, 2026-09-27

Daybook's side is published and checked. Commits on main: 28a808d (publisher,
workflow and adapter), 3258147 (Evidence panel and Morning 5), b2a00c8 (panel
fold). Each check above was run against the live systems:

1. `grounding-data` is an orphan branch (no merge base with main). Its one
   commit, ecda0e1 "Grounding release 000001", holds `.gitattributes`,
   `README.md`, `grounding/latest.json` and `grounding/releases/000001/`.
2. `fetchRelease()` against the default raw URL returned `ok`, sequence 1,
   manifest SHA-256 `597014c54bc028941c1d8ee00f1e0be39270ba5684d40cf2704459ae349f2871`,
   `producerCommit` 3258147, three files with 0 records each. `planImport(null, …)`
   planned nothing and skipped nothing.
3. `briefings-bob/grounding-latest` read back with sequence 1 and the same
   manifest digest; `feed-health.grounding` is `ok`, "released 000001". The
   second dispatch (run 36301105372) logged "unchanged at 000001", skipped the
   push step, and the branch still has one commit. `grounding-ops` is not
   written yet: no automated series exists to check.
4. Signed in, the local preview read the live mirror: Evidence shows
   "Release 1 / No figures captured yet", and Command says "All sources
   loaded" with a **Numbers** freshness pill.

**The mirror doc must exist.** The shared read rule tests `resource.data`,
which is null for a missing doc, so before release 1 was mirrored the panel
read was refused (`permission-denied`) and showed "could not load". It exists
now; if it is ever deleted, the next grounding run writes it again.

**Still to do for Phase D:**
- Bob redeploys the two Functions that build the Morning 5 push, so the
  server's selection includes Numbers the way the page does:
  `deliverMorningFive` and `testBriefingDelivery`.
- The two consumer follow-ups below, each in its own repo session. Copy
  `grounding/fetch-release.js` from Daybook commit **28a808d**; its SHA-256 is
  `a01354b546c4e83e9c2bbe09c84feb119f465f15baab6a78431c8a4a216a4c8b` (pinned to
  LF). `validate.js` is unchanged since 105d3c8
  (`b639edfe768566291329968d001b2d659b1996a3e26d695c7baf66e5a1778668`), and both
  consumers' copies still match it.

## BI-Assessor handover — separate repo session

Read that repo's instructions and `docs/CLAIMBENCH_DAYBOOK.md`. Keep the existing
three-phase diagnostic/review/apply workflow. The diagnostic should propose:

1. Copy `fetch-release.js` alongside
   `functions/claimbench/daybook/validate.js`; record the Daybook commit and
   digest of the copied adapter. No cross-repo runtime imports or dependencies.
2. Add an explicit owner/admin network entry point that calls `fetchRelease`
   then passes its `input` to `importDaybookRelease(input, options)` in
   `functions/claimbench/daybook-import.js`. Use BI-Assessor's existing mappings,
   bounds, last import state and existing records. Never approve automatically.
3. Persist proposals, receipt and next import state together through the
   existing approval workflow; a fetch/validation failure must not advance state.
4. Extend `check:claimbench-daybook` with mocked network success, cache lag,
   persistent corruption, rollback, same-sequence changed digest, unchanged
   facts, duplicate record IDs and retry after interrupted processing. Retain
   all fixture checks and the gate in `check:deploy-candidate`.
5. The mapping remains empty until an approved pilot mapping. Do not add CPI
   to ClaimBench implicitly: its index-metric decision belongs to this repo.

## RiskM8 handover — separate repo session

Read that repo's instructions and `docs/daybook-grounding-import.md`. Preserve
its unrelated CLAUDE/PH-roadmap changes and stashes. The diagnostic should propose:

1. Copy `fetch-release.js` into
   `functions/scripts/lib/daybook-grounding/` beside `validate.js` and record
   copy provenance in `COPIED_FROM.json`.
2. Extend `functions/scripts/import-daybook-grounding.js` with an explicit
   network-source option. Feed the adapter's `input` through the same importer
   used by the local fixture path. Keep receipt/state persistence and candidate
   review output unchanged; do not write accepted SOURCES automatically.
3. Extend `check:daybook-grounding` with the same network and idempotency cases
   listed above. Keep source-linked insights out of `allowedFacts` and scoring.
4. The CPI mapping and dated BI note are Phase E, after the real-source
   feasibility review. Network transport alone must not enable a pilot series.

Phase D closes only after both repo follow-ups pass their gates and the live
producer release and mirror have been checked.
