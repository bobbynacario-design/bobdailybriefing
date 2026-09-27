# Daybook grounding contract v1

The contract Daybook publishes to BI-Assessor and RiskM8. The specification is
[`docs/grounding-roadmap.md`](../docs/grounding-roadmap.md), section 5.

| File | What it is |
|---|---|
| `validate.js` | The validator and import planner. Plain CommonJS with no dependencies (it requires only `node:crypto`, and only when you pass no hash function). |
| `schema/*.schema.json` | JSON Schemas for `latest.json`, `manifest.json`, `facts.json`, `watch.json` and `insights.json`. They are documentation: `validate.js` is what enforces the rules. |
| `fixtures/published-000001/`, `fixtures/published-000002/` | Two sample releases laid out exactly as published: `grounding/latest.json` plus `grounding/releases/<sequence>/`. Release 2 corrects the award rate and replaces August's CPI with September's. |
| `fixtures/bounds.json` | Plausibility bounds for the fixture series. |
| `build-contract-files.js` | Writes the schemas and fixtures. Run `npm run fixtures` after changing either; the tests fail if the committed files are stale. |
| `validate.test.js` | Every rule, including the fixture cases listed in roadmap Phase B. |

## For a consumer (BI-Assessor, RiskM8)

1. **Copy** `validate.js`, the schemas and the fixtures into your repo. Do not
   import them from this repo. Record the Daybook commit you copied from.
2. **Validate:** `validateRelease({latestText, manifestText, fileTexts, directorySequence}, {bounds})`.
   It checks digests before parsing anything and computes the trust attributes
   itself: `sourceLinked`, `factVerified`, `crossChecked` and `plausible`. A file
   that states them is refused.
3. **Plan:** `planImport(lastImported, release, policy, now)` applies the
   idempotency rules:
   - skips an unchanged `facts.json` and every `recordId` imported before;
   - refuses a rollback or a reused sequence;
   - flags records later superseded or withdrawn, once each.
4. **Map and record:** map `toImport` through **your own** mapping table to
   proposals or candidates. Fill `receipt.imported`, store the receipt, and store
   `nextImportState(...)`.
5. **Approve:** nothing is approved automatically. Your existing approval path
   decides.

**Fixture data is not real.** Every fixture series starts with `fixture_`, every
URL is on example.org, and every publisher says it is not a real source. Never
allowlist them outside tests.
