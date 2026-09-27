# Three-app grounding roadmap: Daybook → BI-Assessor and RiskM8

Status: proposed, revision 2 (2026-09-27). Owner: Bob. This file is the source
of truth for the integration; each consuming repo records its own slice in its
own docs when its phase starts.

Revision 2 replaces the first draft (commit 7d23353) after a review against the
code of all three apps. What changed and why is in section 10.

## 1. The three apps and their jobs

| App | Job | Firebase project | Where its knowledge lives today |
|---|---|---|---|
| **Daybook** (this repo) | Watches the world for Bob's work: briefing, news feeds, dossiers, accounts, decisions. The producer of public facts, watch signals and ideas. | `pokerhq-a67e4` (hosting on GitHub Pages; the repo is public) | `news/` RSS module, briefing prompt core, Firestore `briefings-bob/*` |
| **BI-Assessor** (`../BI-Assessor/model-neutral-build`) | Actual claim processing: BI, third-party (TP) property damage, UAA. Intake → RFI → QA workbook → report, under APES 215. | `bi-assessor` | **ClaimBench** (`functions/claimbench/`): benchmark records (`benchmarks.js`, `rates.js`, `useful-life.js`), sources, and admin proposals approved into `config/claimbenchRuntime` |
| **RiskM8** (`../riskm8`) | Broker-facing pre-placement and renewal risk reviews for Australian SMEs (plus a Philippines pilot): risk register, coverage gaps, BI sum insured basis, report. | `riskm8` | `functions/library/provenance.js` SOURCES, `peril-content.js`, `financial-benchmarks.js`, ATO GP bands (2020-21), industry research queue |

Daybook produces; the other two consume. They never share code or a runtime:
both consumer repos already state "copy patterns, never import code" and plan a
one-way sync.

## 2. Ground rules

- **G1 One way.** Data flows Daybook → BI-Assessor and Daybook → RiskM8. No
  claim, claimant, client or broker data ever flows into Daybook. Daybook's view
  of Bob's work stays the hand-maintained, aggregate-only work profile.
- **G2 Only evidence makes a fact.** A value becomes a fact only when it is bound
  to an exact quote in a fetched public source (section 3). Nothing a model
  writes is ever a fact.
- **G3 Ideas travel separately.** AI-assisted text, events, emerging risks and
  questions go in their own file (the insight feed). They can never be imported
  as evidence.
- **G4 The consumer decides.** Every fact enters a consumer as a candidate. Only
  that app's approval path makes it report-eligible: ClaimBench admin approval,
  and RiskM8 owner review (its source library is source code).
- **G5 Events are context, never scores or values.** RiskM8 has already rejected
  BoM storm and ICA catastrophe counts as scored inputs
  (`docs/location-risk-*-investigation.md`).
- **G6 No coupling.** Published files are the contract. Each consumer copies a
  small validator and importer and follows its own repo rules: three-phase work
  (read-only diagnostic → Bob's approval → apply), a `check:` gate wired into
  `check:deploy-candidate`, no new dependencies, and no `firebase.json` edits.
- **G7 Honest fetching.** Identify as Daybook (the `news/` USER_AGENT), respect
  robots rules, source terms and blocks, and never disguise the client. A source
  that cannot be read automatically is captured by hand under the same
  validator (section 6).
- **G8 Fail closed; never estimate.** An unpublished figure is a watch state, not
  a guess. A conflict between two representations blocks the fact. An expected
  date appears only when the source itself states it.

## 3. Trust vocabulary

"Grounded" is not used on its own. Every surface (Daybook UI, the files, the
consumer importers) uses these four levels, and each implies the ones above it.

| Level | Meaning | Who sets it |
|---|---|---|
| **Source-linked** | The URL was among the pages actually fetched or searched. It says nothing about whether a claim is supported. | Producer |
| **Fact-verified** | A specific value is bound to an exact quote in a specific evidence item, with a bounded number match (section 5.2). | Producer's validator |
| **Cross-checked** | A second, independent representation (a data table or API) gives the same value. | Producer's validator |
| **Approved** | A reviewer accepted it in the consuming app, for a stated use. | Consumer only |

Daybook's existing briefing checks (`functions/briefing-evidence.js`
`verifyGrounding`: "Source matched", "Link verified") are **source-linked**
only. Phase B relabels them so that the UI never suggests more.

## 4. Three products

| Product | File | Holds | Importable as evidence? |
|---|---|---|---|
| **Facts registry** | `facts.json` | Fact-verified numeric, rate, fee, wage and regulatory observations, with revisions | **Yes**, as candidates for consumer approval |
| **Watch-state feed** | `watch.json` | Per series: awaiting publication, published, overdue, stale, blocked, withdrawn, conflict | No. It drives Daybook alerts and consumer reminders |
| **Insight suggestions** | `insights.json` | Events, emerging risks, questions, AI-assisted ideas; source-linked at most | No. Consumers may show these as suggestions |

## 5. The contract

### 5.1 Releases (immutable)

```
grounding/                              (on the orphan branch grounding-data)
  latest.json
  releases/
    000001/
      manifest.json
      facts.json
      watch.json
      insights.json
    000002/
      ...
```

- **`latest.json`:** `{schema, sequence, generatedAt, manifest: {path, sha256}}`.
- **`manifest.json`:**
  `{schema, sequence, previousSequence, generatedAt, producerCommit, files: [{name, sha256, schema, recordCount}]}`.
- **A release directory is never rewritten.** A correction ships as a new
  release carrying a new revision of the record. A release is cut only when some
  content changed.
- **Consumers must:**
  - verify the manifest digest from `latest.json`, then each file's digest,
    before parsing anything;
  - reject a sequence lower than the last one imported (the same digest again is
    a no-op);
  - allowlist the series, publishers, units and jurisdictions they accept;
  - write an **import receipt**: release sequence, manifest and file digests,
    the consumer's mapping version, the proposal or candidate IDs created, and
    every skipped record with its reason.

### 5.2 Fact record

```json
{
  "recordId": "<seriesId>@<observationKey>#r<revision>",
  "seriesId": "<stable key, e.g. abs_cpi_all_groups_annual_change>",
  "observationKey": "<period or effective date, e.g. 2026-08 or 2026-07-01>",
  "revision": 1,
  "lifecycle": "current | corrected | superseded | withdrawn",
  "supersedes": "<recordId or null>",
  "kind": "index | rate | regulated_fee | award_wage | regulatory",
  "title": "<plain name>",
  "value": "<number, or null when range is used>",
  "range": "<{min, max}, or null>",
  "unitCode": "pct | pct_pa | aud_per_hour | aud_per_day | aud_per_item | index_points",
  "basisCode": "annual_change | policy_rate_target | award_min_wage | regulated_fee_max | market_rate",
  "scope": {
    "jurisdiction": "AU | NSW | VIC | QLD | SA | WA | TAS | NT | ACT | PH",
    "classification": "<source-stated, e.g. CW1 ordinary hours; or null>",
    "period": { "from": "<YYYY-MM-DD>", "to": "<YYYY-MM-DD or null>" }
  },
  "qualifications": [ { "text": "<applicability the source states>", "evidenceId": "<id>" } ],
  "observationDate": "<YYYY-MM-DD>",
  "publishedAt": "<YYYY-MM-DD>",
  "effectiveFrom": "<YYYY-MM-DD or null>",
  "effectiveTo": "<YYYY-MM-DD or null>",
  "evidence": [
    {
      "evidenceId": "<id>",
      "role": "release | table | cross_check | correction",
      "url": "<source page or file>",
      "publisher": "<e.g. Australian Bureau of Statistics>",
      "title": "<page, release or file title>",
      "quote": "<verbatim text>",
      "valueToken": "<the exact token in the quote that states the value>",
      "locator": { "page": "<n>", "paragraph": "<n>", "table": "<id>", "row": "<key>", "selector": "<css>" },
      "asOf": "<YYYY-MM-DD>",
      "tier": "primary | secondary",
      "retrievedAt": "<ISO timestamp>",
      "contentSha256": "<digest of the fetched body>",
      "licence": "<terms or attribution string from the series registry>"
    }
  ],
  "derivation": null,
  "captureMethod": "api | csv | rss | page | manual",
  "checks": { "sourceLinked": true, "factVerified": true, "crossChecked": false, "plausible": true }
}
```

Rules the validator enforces:

- **Bounded number match.** `valueToken` must appear in `quote` with no digit,
  decimal point or digit-group comma touching either side (so `5` never matches
  inside `15`, and `1,250` matches `1,250`). The token must also normalise to
  `value`: grouping commas removed, trailing decimal zeros ignored
  (`3.60` = `3.6`), and a stated percent sign agreeing with the unit. A shorthand
  like `1.25k` never matches. Each bound value names its `evidenceId`.
- **Prose first, data second.** A `release` evidence item carries the quote; a
  `cross_check` item (a table or API row) must give the same value, or the
  record is `conflict`: it goes to the watch feed and never into facts.
- **Plausibility bounds** per series (absolute range and maximum change from the
  previous observation). A breach blocks the record until it is reviewed.
- **Derived values** carry
  `derivation: {formula, inputs: [recordIds], rounding}`. A published figure is
  preferred to a derived one; a derived value is never created without these
  fields.
- **Qualifications** come from the source's own words. A consumer may add its
  own qualifications at approval (ClaimBench's wage-floor warnings, for
  example); those stay in the consumer.
- **No private fields.** The files are public, so an allowlist of fields is
  enforced, and a test proves that accounts, notes, decisions and client names
  cannot enter.
- **`captureMethod` is never `ai`.**

### 5.3 Watch record

```json
{
  "watchId": "<seriesId>@<observationKey>",
  "seriesId": "<key>",
  "state": "awaiting_publication | published | overdue | stale | blocked | withdrawn | conflict",
  "expectedBy": "<YYYY-MM-DD only if the source states it, else null>",
  "lastCheckedAt": "<ISO timestamp>",
  "detail": "<what was seen, e.g. pay guide page updated; parser rejected table>",
  "evidence": { "url": "<where the state was observed>", "retrievedAt": "<ISO timestamp>" }
}
```

### 5.4 Insight record

```json
{
  "insightId": "<id>",
  "kind": "event | emerging_risk | question | idea",
  "title": "<short>",
  "text": "<body>",
  "aiAssisted": true,
  "sources": [ { "url": "<source-linked page>", "publisher": "<name>" } ],
  "tags": { "streams": ["tp_utility", "tp_road", "hv_loi", "sme_bi", "risk_review"], "anzsic": ["<code>"] },
  "createdAt": "<ISO timestamp>"
}
```

### 5.5 Where facts land in each consumer

| Fact field | BI-Assessor (ClaimBench proposal) | RiskM8 |
|---|---|---|
| `evidence[]` (release and table roles) | `citations[]` in `validateCitation` shape (`url, publisher, title, quote, asOf, tier, jurisdiction`) | a SOURCES candidate `{url, publisher, title, quote, asOf, tier}`. Its free-text `asOf` accepts an ISO date unchanged |
| `seriesId` + `basisCode` | a **BI-Assessor-owned mapping** to `metric`, `basis`, `industryKey` and the `bm_*_vN` id | a RiskM8-owned mapping to a SOURCES id or research topic |
| `value`/`range`, `unitCode` | `valueType` point or range, `value`/`range`, `unit` (e.g. `aud_per_hour`) | a validated fact added to `allowedFacts` for narrative text |
| `qualifications`, `effectiveFrom`, `effectiveTo` | the draft `qualifications` (the reviewer edits them), `effectiveFrom`, `effectiveTo` | the text of the dated note |
| `reviewDueAt` | set by the mapping rule (e.g. `effectiveTo` + 31 days) | not used |
| `lifecycle: corrected / superseded` | a `supersede` proposal, version + 1 | a replacement candidate |

**Known registry gap.** ClaimBench's `METRIC` registry holds cost ratios, GP
rates, useful lives and `rate_aud`. It has no index or interest metric. CPI or
the cash rate cannot enter ClaimBench until BI-Assessor decides to add one; that
is its own decision, recorded in Phase C.

## 6. Capture methods

- **Automated** (`api`, `csv`, `rss`, `page`): for series that publish often and
  in a stable, machine-readable form.
- **Manual** (`manual`): for figures published once a year in PDF or Word guides
  with conditions attached (award rates, gazetted fees). Daybook automates the
  **watch** ("the FY27 pay guide is out"). The value is captured in a reviewed
  file in this repo (`grounding/manual/<seriesId>.json`: value, quote,
  valueToken, locator, URL) and the same validator checks it. Git history is the
  audit trail. There is no UI in v1.

## 7. Threat and licence note (short by design)

| Risk | Control |
|---|---|
| A parser misreads a figure | Bounded match to an exact quote; cross-check; plausibility bounds; fail closed; human approval in the consumer |
| Stale data shown as current | Freshness rule per series; watch states `stale` and `overdue`; `asOf` shown everywhere |
| A source changes format or URL | The parser fails closed; the feed-health alert becomes a Morning 5 reliability item |
| Rollback, partial or corrupt publication | Sequence numbers and digests; consumers reject a lower sequence or a digest mismatch |
| A publisher corrects a figure | New revision, `lifecycle` and `supersedes`; consumers raise a supersede proposal or replacement candidate |
| AI text leaks into evidence | Separate insight file; `captureMethod` never `ai`; facts need a bound quote |
| Private data published | Field allowlist and a test; public files carry public facts only |
| Bob's GitHub account is compromised | Out of scope for digests (they prove integrity, not authorship); human approval and import receipts make any bad import traceable and reversible |
| Licence breach | Each series registry entry records the source's terms and attribution string, checked in the feasibility row before the series ships |

## 8. Phases

Effort is rough, in working days of one focused session. Phases C (each
consumer) run in a session opened in that repo, from a handover written from
this file.

### Phase A: close the BI-Assessor boundary (BI-Assessor, about 0.5 day)

- **The gap:** `functions/llm-router.js` `applyOverride` (line 57) applies the
  admin override from `config/llm` to every task. That includes the tasks
  `prompts.js` keeps Claude-only under APES 215, and in `forced` mode claimant
  evidence would go to the override provider.
- **The fix:** Claude-only tasks ignore a non-Claude override provider, the
  router records that in its journal, and a test plus a `check:` gate cover it.
- **Also:** verify whether `storage.rules` covers `uaa_claims` documents.
- A separate task has already been raised for this. Phase C for BI-Assessor
  waits on it.

### Phase B: contracts, validator and fixtures (Daybook, about 1–1.5 days)

1. `grounding/schema/` holds `facts`, `watch`, `insights` and `manifest`
   schemas (plain JSON Schema).
2. `grounding/validate.js` (plain JS, no dependencies) implements every rule in
   5.2–5.4, plus manifest and digest checks.
3. **`grounding/fixtures/`**, valid and invalid cases:
   - a valid CPI fact with cross-check;
   - a valid manual award-rate fact;
   - `5` inside `15`, and `1,250` against `1250`;
   - a cross-check conflict;
   - a correction (revision 2, supersedes revision 1);
   - a rollback (lower sequence), and a digest mismatch;
   - a private field smuggled into a record;
   - an insight in the facts file;
   - an unstated `expectedBy`.
4. Tests for all of them in `grounding/validate.test.js`, run by `npm test`.
5. Relabel Daybook's briefing source chips to the section 3 vocabulary
   (source-linked). Help text follows.
6. Keep this file's section 7 current.

Done when: every fixture passes or fails for the stated reason, and the chips
say what they actually prove.

### Phase C: consumer importers against fixtures (a session in each repo, about 1 day each; no network)

**BI-Assessor:**
1. Diagnostic: the ClaimBench registries, the pending
   `bm_rate_traffic_controller_award_fy27_au_v1`, the proposal review flow, and
   where the runtime overlay is read.
2. `functions/claimbench/daybook-import.js`, with a copied validator and a
   mapping table:
   - Input: a fixture release.
   - Output: proposal drafts through the existing `validateProposal`, and an
     import receipt.
   - Nothing is approved automatically.
3. Tighten `validateProposal`'s number check to the bounded match. It currently
   uses a plain substring (`evidenceText.includes(token)`).
4. Record the index-metric decision (section 5.5): add one, or keep CPI and
   rates out of ClaimBench.
5. Gate: `check:claimbench-daybook` in `check:deploy-candidate` and
   `DEPLOY_GATE.md`.

**RiskM8** (leave the uncommitted `CLAUDE.md` and PH roadmap edits, and the
three stashes, untouched unless Bob says otherwise):
1. Diagnostic: SOURCES, `allowedFacts` and `validateNarrativeOutput`,
   `domain/financial-basis.js`, and the owner review path.
2. `scripts/import-daybook-grounding.js`:
   - Input: a fixture release.
   - Output: a candidate review file and an import receipt.
   - Accepted entries go into `library/provenance.js` by a normal reviewed
     commit.
3. Render path for the dated CPI note on the BI sum insured, fed as a validated
   fact through `allowedFacts`. It illustrates rather than changes the
   calculation (C2, C5).
4. Gate: `check:daybook-grounding`.

Done when: both importers accept the valid fixtures and reject the invalid ones
with the stated reason, and a receipt names every skip.

### Phase D: release publishing (Daybook, about 1 day)

1. `grounding/` producer module (built like `news/`):
   - a series registry: key, publisher, URLs, method, parser, schedule,
     freshness, bounds, licence, stream tags;
   - `refresh-grounding.js` builds facts, watch and insights, then validates
     them;
   - it cuts a release only when content changed.
2. Publish to the orphan `grounding-data` branch (`latest.json` plus
   `releases/`). `main` is never touched.
3. Mirror the latest release to Firestore (`briefings-bob/grounding-latest`)
   for Daybook's UI. Health goes through `recordRunHealth` as feed `grounding`.
4. **Schedules are per series**, not one daily job. Each registry entry states
   its own cadence, and the job checks only the series that are due.
5. **Daybook surfaces:**
   - a Morning 5 item when a watch state changes or a new fact lands (old → new,
     source, date, trust level);
   - a folded **Your numbers** panel on Evidence.
6. The consumers switch from fixtures to the fetched release, with digest
   verification.

### Phase E: Pilot 1, ABS CPI → RiskM8 (about 1 day)

- **Feasibility row:**
  - which CPI measure is used (monthly or quarterly, all groups, weighted
    average of the eight capitals);
  - the release page to quote from, and the ABS Data API series to cross-check
    against (the API is described as beta, so a mismatch must fail closed);
  - the licence and attribution;
  - the release schedule, freshness rule and bounds.
- **Parser** for the release sentence, and cross-check against the table or
  API.
- **Done when:** a real CPI release appears in RiskM8 as a candidate SOURCES
  entry with an import receipt. After Bob accepts it, the BI section shows the
  dated note.

### Phase F: Pilot 2, FY27 traffic-controller award → ClaimBench (about 0.5–1 day)

- **Watch (automated):** the Fair Work Ombudsman pay guide for the Building and
  Construction General On-site Award (MA000020), the source ClaimBench's FY26
  record uses.
- **Value (manual):** `grounding/manual/fwo_ma000020_cw1_ordinary.json`, with
  the CW1 ordinary hourly rate, the quote, the page locator and the URL,
  validated.
- **Done when:** ClaimBench shows a proposal labelled "from Daybook" that
  resolves the pending FY27 record. It becomes report-eligible only after
  admin approval, and its receipt names the release.

### Phase G: one real update or correction cycle (calendar time plus about 0.5 day)

The next CPI release (a new observation), or a documented correction (a new
revision). Verify that the lifecycle, the consumers' supersede handling and the
receipts trace end to end.

### Phase H: further series, one at a time (about 0.5–1 day each)

Each series needs its own feasibility row, parser or manual file, schedule,
freshness rule, bounds, licence and consumer mapping before it ships.
Candidates, in suggested order:

| Series | Method | Consumer | Note |
|---|---|---|---|
| VIC and NSW tow and storage fees | manual + watch | ClaimBench (records exist, `regulated_fee_max`) | 1 July cycle |
| Superannuation Guarantee rate | watch only | BI-Assessor wages method | Legislated at 12%; watch for change |
| ATO Small Business Benchmarks | watch | both | Annual; method-dependent |
| ATO Taxation Statistics release | watch | RiskM8 | Its GP bands are 2020-21 |
| RBA cash rate target | automated | Daybook; a consumer only once one needs it (interest needs a ClaimBench metric) | |
| PPI (construction; electricity), WPI | automated | RiskM8 | After CPI proves the ABS path |
| AER distribution determinations | manual + watch | BI-Assessor STPIS cross-check | Needs its own design |
| Diesel terminal gate prices | automated | Daybook only for now | Heavy-vehicle LOI context |

### Not scheduled here: separate roadmaps when their time comes

- **Case law.** It needs neutral citations, paragraph locators, jurisdiction and
  court hierarchy, subsequent-history tracking (appeals, overturned decisions)
  and its own review model. It is not a Phase-H series.
- **Events, emerging risks and the question bank.** These come through the
  insight feed only, as context and suggestions under G3 and G5.
- **Automating the July cycle,** once enough manual-plus-watch series exist.

## 9. Decisions for Bob

- **D1 Transport.** *Recommended:* immutable releases on an orphan
  `grounding-data` branch of this public repo.
- **D2 Daybook surface.** *Recommended:* a Morning 5 item on change plus a
  folded Evidence panel, with no new Today card before the 2026-10-11 usage
  review.
- **D3 Pilots.** *Recommended:* CPI → RiskM8, and the FY27 traffic-controller
  award → ClaimBench.
- **D4 Manual capture.** *Recommended:* reviewed JSON files in this repo, with
  no capture UI in v1.
- **D5 Consumer work.** *Recommended:* a session opened in each repo, from a
  handover, under that repo's own rules.

## 10. What changed from the first draft

- **One pack became three files** (facts, watch, insights), so the trust
  boundary is structural and only facts can be imported as evidence.
- **One mutable file became immutable, numbered, digest-checked releases,** with
  a consumer import receipt for every proposal or candidate.
- **The fact record gained** revisions, lifecycle, `evidence[]` with roles and
  locators, content digests, derivations, plausibility bounds and a bounded
  number match. The old `<series>_<asOf>` id collided on corrections, and a plain
  substring let `5` match `15`.
- **"Grounded" was split into four trust levels.** Daybook's existing chips are
  source-linked only.
- **The order is now consumer-first.** Fixture importers come before any live
  fetcher. The review showed the first draft could not produce a valid
  ClaimBench proposal as specified, and that ClaimBench has no metric for
  indices at all.
- **The first series list shrank to two pilots with real consumers,** plus
  per-series schedules.
- **Yearly PDF-published figures are watched automatically and captured by hand**
  under the validator.
- **Case law and events moved to separate, later roadmaps.** The first draft's
  3–4 days for them was not credible.

## 11. Sequence at a glance

| Step | Where | Depends on | Effort |
|---|---|---|---|
| A: boundary fix | BI-Assessor | none | about 0.5 day |
| B: contracts, validator, fixtures, chip wording | Daybook | D1–D5 | 1–1.5 days |
| C: fixture importers | BI-Assessor, RiskM8 | B (and A for BI-Assessor) | about 1 day each |
| D: release publishing and Daybook surfaces | Daybook | B, C | about 1 day |
| E: Pilot 1, CPI → RiskM8 | Daybook, RiskM8 | D | about 1 day |
| F: Pilot 2, FY27 award → ClaimBench | Daybook, BI-Assessor | D | 0.5–1 day |
| G: one update or correction cycle | all | E or F | calendar time plus 0.5 day |
| H: further series, one at a time | per series | G | 0.5–1 day each |
