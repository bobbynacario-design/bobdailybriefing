# Daybook grounding contract v1

The contract Daybook publishes to BI-Assessor and RiskM8. The specification is
[`docs/grounding-roadmap.md`](../docs/grounding-roadmap.md), section 5.

| File | What it is |
|---|---|
| `validate.js` | The validator and import planner. Plain CommonJS with no dependencies (it requires only `node:crypto`, and only when you pass no hash function). |
| `fetch-release.js` | The network adapter consumers copy next to `validate.js`: it reads `latest.json` once, verifies every digest, retries only what the raw-file cache can explain, and returns `{input, release}`. No dependencies. |
| `schema/*.schema.json` | JSON Schemas for `latest.json`, `manifest.json`, `facts.json`, `watch.json` and `insights.json`. They are documentation: `validate.js` is what enforces the rules. |
| `fixtures/published-000001/`, `fixtures/published-000002/` | Two sample releases laid out exactly as published: `grounding/latest.json` plus `grounding/releases/<sequence>/`. Release 2 corrects the award rate and replaces August's CPI with September's. |
| `fixtures/bounds.json` | Plausibility bounds for the fixture series. |
| `build-contract-files.js` | Writes the schemas and fixtures. Run `npm run fixtures` after changing either; the tests fail if the committed files are stale. |
| `validate.test.js` | Every rule, including the fixture cases listed in roadmap Phase B. |

## For a consumer (BI-Assessor, RiskM8)

1. **Copy** `validate.js`, `fetch-release.js`, the schemas and the fixtures into
   your repo. Do not import them from this repo. Record the Daybook commit you
   copied from, and never convert their line endings: you check their SHA-256.
2. **Validate:** `validateRelease({latestText, manifestText, fileTexts, directorySequence}, {bounds})`.
   It checks digests before parsing anything and computes the trust attributes
   itself: `sourceLinked`, `factVerified`, `crossChecked` and `plausible`. A file
   that states them is refused.
   - `plausible` uses **your** bounds, so it only decides whether a record is
     eligible for you. It never rejects the release.
   - Each result also carries `overrideVerdict` for a record with a
     `plausibilityOverride`: `cleared`, `unmatched`, `not_needed` or
     `not_evaluated`. An override for a series you have no bounds for is
     `not_evaluated`, and it is still readable.
3. **Plan:** `planImport(lastImported, release, policy, now)` applies the
   idempotency rules:
   - skips an unchanged `facts.json` and every `recordId` imported before;
   - refuses a rollback or a reused sequence;
   - flags records later superseded or withdrawn, once each;
   - when your `policy.mappingVersion` differs from the one your stored state
     was made with, plans the whole release again (even the same release), so
     a record you skipped as not allowlisted imports as soon as you map it.
     Records imported before are still skipped as duplicates.
4. **Map and record:** map `toImport` through **your own** mapping table to
   proposals or candidates. Fill `receipt.imported`, store the receipt, and store
   `nextImportState(last, release, imported, flagged, policy)`. Pass the same
   `policy`, so the state records its mapping version; a state made without it
   keeps the old shortcuts. A re-plan of the same release produces a second
   receipt for that sequence, so name receipts so that it does not overwrite
   the first.
5. **Approve:** nothing is approved automatically. Your existing approval path
   decides.

**Fixture data is not real.** Every fixture series starts with `fixture_`, every
URL is on example.org, and every publisher says it is not a real source. Never
allowlist them outside tests.
