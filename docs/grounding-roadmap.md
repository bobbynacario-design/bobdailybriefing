# Three-app grounding roadmap: Daybook → BI-Assessor and RiskM8

Status: proposed, 2026-09-27. Owner: Bob. This file is the source of truth for
the integration; each consuming repo records its own slice in its own docs when
its phase starts.

## 1. The three apps and their jobs

| App | Job | Firebase project | Where its knowledge lives today |
|---|---|---|---|
| **Daybook** (this repo) | Watches the world for Bob's work: briefing, news feeds, dossiers, accounts, decisions. The source of **creativity and grounding**. | `pokerhq-a67e4` (hosting on GitHub Pages) | `news/` RSS module, briefing prompt core, Firestore `briefings-bob/*` |
| **BI-Assessor** (`../BI-Assessor/model-neutral-build`) | Actual claim processing: BI, third-party (TP) property damage, UAA. Intake → RFI → QA workbook → report, under APES 215. | `bi-assessor` | **ClaimBench** (`functions/claimbench/`): `sources.js`, `rates.js`, `useful-life.js`, admin refresh with proposals → `config/claimbenchRuntime` |
| **RiskM8** (`../riskm8`) | Broker-facing pre-placement and renewal risk reviews for Australian SMEs (plus a Philippines pilot): risk register, coverage gaps, BI sum insured basis, report. | `riskm8` | `functions/library/provenance.js` SOURCES, `peril-content.js`, `financial-benchmarks.js`, ATO GP bands, industry research queue |

Daybook produces; the other two consume. They never share code or a runtime:
both consumer repos already state "copy patterns, never import code" and plan a
one-way sync.

## 2. Ground rules (every phase must satisfy all of them)

- **G1 One way.** Records flow Daybook → BI-Assessor and Daybook → RiskM8. No
  claim, claimant, client or broker data ever flows into Daybook. Daybook's view
  of Bob's work stays the hand-maintained, aggregate-only work profile.
- **G2 Only fetched public sources ground anything.** A grounding record needs a
  URL, publisher, title, a **verbatim quote that contains every figure it
  carries**, the source's own date (`asOf`, YYYY-MM-DD) and a tier
  (`primary` = the official publisher, `secondary` = a reputable reporter of it).
  This matches ClaimBench `validateCitation` and RiskM8 SOURCES field for field.
- **G3 Daybook's AI writing is never grounding.** Briefing text, dossiers, ahas
  and summaries may only produce `idea` records (questions, "what could go
  wrong" prompts). Ideas carry no figures and no tier, and consumers treat them
  as suggestions a person accepts.
- **G4 The consumer decides.** Every record enters a consumer as a candidate. Only
  that app's existing approval path makes it report-eligible: ClaimBench admin
  approval into `config/claimbenchRuntime`, and RiskM8 owner review into its
  source library (which is source code there).
- **G5 Events are context and questions, never scores or values.** RiskM8 has
  already rejected BoM storm and ICA catastrophe counts as scored inputs
  (`docs/location-risk-*-investigation.md`); this roadmap keeps that finding.
- **G6 No coupling.** A published file is the contract. Each consumer copies a
  small validator and importer and follows its own repo rules: three-phase work
  (read-only diagnostic → Bob's approval → apply), a `check:` gate wired into
  `check:deploy-candidate`, no new dependencies, and no `firebase.json` edits.
- **G7 Honest fetching.** Identify as Daybook (the `news/` USER_AGENT), respect
  robots rules and blocks, and never disguise the client. A source that blocks
  automated reading becomes `manual`: Bob enters the figure with its URL and
  quote, and the same validator checks it.
- **G8 Never estimate.** A figure or date not yet published is recorded as
  `not_yet_published`, never guessed. (This matches RiskM8 C4 "unresolved is a
  first-class state" and ClaimBench's pending records.)

## 3. The contract: grounding record v1

Published as one JSON file. `schema` changes only with a new major version, and
both importers must be updated before a breaking change ships.

```json
{
  "schema": "daybook-grounding/1",
  "generatedAt": "<ISO timestamp>",
  "records": [
    {
      "id": "<series>_<asOf>",
      "series": "<stable series key, e.g. rba_cash_rate_target>",
      "kind": "index | rate | ruling | regulatory | event | emerging_risk | idea",
      "status": "published | not_yet_published | conflict",
      "title": "<plain name>",
      "value": "<number, or null>",
      "range": "<{min, max}, or null>",
      "unit": "<e.g. % p.a., AUD per hour, index points>",
      "asOf": "<YYYY-MM-DD from the source>",
      "effectiveFrom": "<YYYY-MM-DD, or null>",
      "jurisdiction": "AU | NSW | VIC | QLD | SA | WA | TAS | NT | ACT | PH",
      "citation": {
        "url": "<official page>",
        "publisher": "<e.g. Reserve Bank of Australia>",
        "title": "<page or release title>",
        "quote": "<verbatim sentence containing the value>",
        "asOf": "<YYYY-MM-DD>",
        "tier": "primary | secondary"
      },
      "crossCheck": { "url": "<data series (API or CSV)>", "value": "<number>" },
      "previous": { "value": "<number>", "asOf": "<YYYY-MM-DD>" },
      "tags": { "streams": ["tp_utility", "tp_road", "hv_loi", "sme_bi", "risk_review"], "anzsic": ["<code>"] },
      "fetch": { "method": "api | csv | rss | page | manual", "sourceId": "<registry key>", "fetchedAt": "<ISO timestamp>" }
    }
  ]
}
```

Rules the validator enforces:

- The value token (or both range tokens) must appear in `citation.quote`,
  exactly as ClaimBench's `validateProposal` checks.
- Prose first, data second. Where a series has both a release page and a data
  file (ABS, RBA), the quote comes from the release sentence and the data file
  fills `crossCheck`. If the two disagree, the record is `conflict` and is not
  published.
- `idea` records have no `value`, `range` or `tier`. `event` records have no
  `value`.
- **No private fields.** The file is public (see D1), so it never carries
  Bob's accounts, notes, decisions or any client name. Stream tags are generic.

Where each field lands:

| Record field | BI-Assessor (ClaimBench) | RiskM8 |
|---|---|---|
| `citation` | `citations[]` of a proposal (the same shape, plus `jurisdiction`) | a SOURCES entry `{url, publisher, title, quote, asOf, tier}` |
| `value`/`range`, `unit` | `record.value`/`range`, `unit`, with `valueType` point or range | a validated fact added to `allowedFacts` for narrative text |
| `series` → consumer key | an importer-owned mapping to `metric`, `basis`, `industryKey` and `bm_*_vN` id | an importer-owned mapping to a SOURCES id or research topic |
| `status: not_yet_published` | keeps the pending record pending and notes "checked" | stays unresolved (C4) |

## 4. Phases

Rough effort is in working days of one focused session. Phases 2 and 3 can run
in parallel once the pack has run cleanly for a week.

### Phase 0: groundwork (Daybook, about 0.5 day; docs and tests only)

1. **Contract files:** `grounding/schema.json` and `grounding/validate.js` (plain JS,
   no dependencies), with tests for each rule above. Consumers copy these files
   rather than importing them.
2. **Source feasibility sweep.** For each candidate series, confirm an official
   route exists that allows automated reading with an honest user agent, and
   mark it `api`, `csv`, `rss`, `page` or `manual`. Candidates (all to verify):
   - ABS Data API: CPI, PPI (output of the construction industries; electricity
     supply), Wage Price Index.
   - RBA cash rate target (statistical table F1 and the Board decision release).
   - Fair Work Commission Annual Wage Review decision, and the FWO pay guide for
     MA000020 (the traffic-controller award floor ClaimBench already uses).
   - Tow and storage fees: VIC Government Gazette, NSW Fair Trading.
   - FWC: the Endeavour Energy workplace determination (a status watch until it
     publishes).
   - AER: electricity distribution determinations (WACC, STPIS parameters).
   - ATO: Superannuation Guarantee rate; Small Business Benchmarks updates; the
     Taxation Statistics release (RiskM8's GP bands are 2020-21).
   - AIP terminal gate prices (diesel), for heavy-vehicle loss of income.
   - Phase 4 sources: court judgment feeds (AustLII or JADE, by court),
     disaster declarations (Disaster Recovery Funding Arrangements activations),
     distributor outage notices, BoM warnings, outbreak.gov.au emerging risks,
     and Philippine Insurance Commission circulars.
3. **Decisions D1–D4** (section 6) agreed with Bob.

Done when: the validator passes its tests, and the sweep table is in this file
with every source marked.

### Phase 1: Daybook numbers watcher and the pack (Daybook, about 2–3 days)

1. **`grounding/` module, built like `news/`:**
   - `config.js`: a series registry (key, publisher, URLs, method, parser,
     jurisdiction, stream tags, cadence).
   - One parser per method.
   - `refresh-grounding.js`: fetch → parse → build records → validate → write.
2. **Where it writes:**
   - Firestore `briefings-bob/grounding-latest` and `grounding-<date>`, for
     Daybook's own UI.
   - The public pack: `grounding/pack.json` on an orphan `grounding-data` branch
     (see D1). This never touches `main`, so Bob's pushes are unaffected.
3. **Schedule:** a new job in `refresh-intelligence.yml`, daily at 04:15 PHT,
   after the news job. Its health goes through `recordRunHealth` as feed
   `grounding`, so a failure becomes a Morning 5 reliability item.
4. **The first series** comes from both apps' waiting lists:
   - For ClaimBench: FY27 traffic-controller award floor (after the FWC Annual
     Wage Review 2026), VIC and NSW tow and storage fees, the Endeavour Energy
     determination (status), and the Superannuation Guarantee rate.
   - For both: CPI, PPI (construction; electricity), WPI, the RBA cash rate, ATO
     Small Business Benchmarks (release status) and Taxation Statistics
     (release status).
5. **Daybook UI (kept light, in line with the density plan):**
   - A **Morning 5 item only when a number changes or publishes**, e.g.
     "Cash rate target changed" with old → new, source and date.
   - A folded **Your numbers** panel on Evidence, next to Your accounts.
   - Usage tracked by the existing counter.
6. **Briefing link (optional, later in the phase):** a "NUMBERS PUBLISHED THIS
   WEEK" block in the briefing prompt, closed-world like the fetched news list,
   so the briefing can cite verified figures and never invent them.
7. **Tests:** a parser fixture per source, validator runs on the built pack, a
   test that no private field can enter the pack, and the existing
   `check:site`.

Done when:
- the pack validates;
- every figure's value appears in its quote;
- a blocked source shows as `manual`, not missing;
- a changed figure raises one Morning 5 item;
- a week of runs has passed with no `conflict`.

### Phase 2: BI-Assessor imports into ClaimBench (a BI-Assessor session, about 1–2 days)

Prerequisite: the APES 215 provider-override gap is fixed first (see section 5).

1. **Diagnostic (read-only):** confirm the ClaimBench registries (METRIC,
   BASIS, INDUSTRY_KEYS), the `rates.js` records and their research queue, the
   `config/claimbenchRuntime` overlay, and where admins pick proposals.
2. **Importer:** `functions/claimbench/daybook-import.js` (with a copied
   `validate.js`) and an admin task `admin_claimbench_import_daybook`, or the
   planned local `scripts/sync-claimbench-sources.js`.
   - It fetches the pack and maps `series` to ClaimBench records through a
     mapping table owned by BI-Assessor.
   - It builds `add` or `supersede` (version + 1) proposals through the existing
     `validateProposal`.
   - Unmapped series are ignored. `not_yet_published` updates the pending
     record's "last checked" note only.
   - It never approves anything by itself.
3. **Review:** proposals appear in the existing ClaimBench refresh review,
   labelled "from Daybook".
4. **Gate:** `check:claimbench-daybook` wired into `check:deploy-candidate` and
   `DEPLOY_GATE.md`. Tests cover a fixture pack → proposals, the quote-token
   rule, supersede version maths, unmapped series, and that no claim data is
   read or sent.
5. **Optional:** compare the ClaimBench deep-research spend in the month before
   and after, since the plain fetches may replace part of it.

Done when: a changed traffic-controller rate appears as a supersede proposal
with a valid citation and becomes report-eligible only after admin approval.

### Phase 3: RiskM8 imports into its sources and BI basis (a RiskM8 session, about 2 days)

Note the uncommitted `CLAUDE.md` and PH roadmap edits and the three stashes in
that repo. Leave them untouched unless Bob says otherwise.

1. **Diagnostic (read-only):** confirm the SOURCES shape, `allowedFacts` and
   `validateNarrativeOutput`, `domain/financial-basis.js`, the industry research
   job, and the owner review path.
2. **Importer:** `scripts/import-daybook-grounding.js` writes a candidate review
   file. Bob accepts entries into `library/provenance.js` through a normal
   reviewed commit, because the grounded library is source code. There are no
   runtime writes.
3. **Escalation note on the BI sum insured:** an optional, dated indexation note
   in the financial basis (e.g. the CPI or PPI change over the last 12 months,
   with source and date). It is added as a validated fact, illustrates rather
   than changes the calculation, and respects C2 (the model never produces
   facts) and C5 (scores are for communication).
4. **Staleness flag:** when the ATO publishes Taxation Statistics newer than
   2020-21, open an industry research task. Nothing is swapped automatically.
5. **PH lane:** Insurance Commission circular watch (status only), for the
   `ph-market-evidence.js` figures tagged "re-confirm".
6. **Gate:** `check:daybook-grounding`, with the same kinds of tests as Phase 2.

Done when: a new CPI release appears as a candidate SOURCES entry with a valid
quote, and after Bob accepts it, the BI section can show the dated note.

### Phase 4: Daybook knowledge watchers (Daybook, about 3–4 days, staged)

- **4a Case-law watch.**
  - Scope: new judgments from feasible court feeds, filtered to the issues Bob
    argues: betterment and like-for-like, overheads and on-costs, loss of use,
    idle fleet and mitigation, credit hire, and quantum expert evidence.
  - Output: a weekly Daybook digest and `ruling` records.
  - The quote must be an exact substring of the fetched judgment text (checked
    in code). Any summary is AI-written and labelled as such.
- **4b "What's about to land on your desk".**
  - Scope: disaster declarations, distributor outages and severe-weather
    warnings.
  - Output: a Today card (what, where, how many customers, all from sources,
    plus one labelled "Expect:" line), and `event` records that are context
    only.
- **4c Emerging risks by industry.** Cited news and regulator items become
  `emerging_risk` records tagged with ANZSIC codes.
- **4d Question bank.** Dossier "questions to ask" and weekly-read prompts
  become `idea` records tagged by stream: RFI ideas for pole and road damage,
  heavy-vehicle loss of income and small-business BI; broker questions for
  RiskM8.

### Phase 5: the consumers take the knowledge records (each repo)

- **BI-Assessor:**
  - `ruling` → a reviewer reference list, never inserted into report prose
    automatically.
  - `event` → a QA note when an incident date falls inside a declared event
    window. This supports Rev 8's "verify incident date within BoM event
    window".
  - AER parameters → a cross-check note beside `extract_stpis_workbook_inputs`.
  - `idea` → suggestions in the RFI planners that the assessor adds by hand.
- **RiskM8:**
  - `ruling` and `regulatory` → provenance candidates (Appendix E "Basis &
    sources").
  - `event` → client questions ("Was the site affected by …?"), never scores.
  - `emerging_risk` → industry research demand and a validated context record
    for the narrative.
  - `idea` → client-question candidates.

### Phase 6: the loop

- **The July cycle.** The FWC wage review, tow fees and the SG rate all change
  on 1 July. Daybook raises a watch list in late June, and each consumer's
  annual update procedure runs off the pack.
- **Quarterly contract review.** Which series were used and approved, which
  never were, and whether the sources still work. Bob reports usage by hand, so
  nothing flows back automatically (G1).
- **Cost check.** ClaimBench deep-research spend against the plain fetches.

## 5. Found while mapping (fix before Phase 2)

- **BI-Assessor provider override (confirmed in code).** `functions/llm-router.js`
  `applyOverride` (line 57) applies the admin override from `config/llm` to every
  task, with no exemption for the tasks `prompts.js` keeps Claude-only under
  APES 215. In `forced` mode, claimant evidence would go to the override provider.
  A separate task was raised to diagnose and fix it. Whether an override is
  active in production was not checked.
- **BI-Assessor storage rules (unverified).** `storage.rules` may cover
  `tp_claims` documents but not `uaa_claims`. Raised in the same task.
- **RiskM8 data residency.** Client data sits in the US (the app already
  discloses APP 8). This integration moves no client data, so it changes
  nothing here.

## 6. Decisions for Bob

- **D1 Transport.**
  - *Recommended:* a public JSON file on an orphan `grounding-data` branch of
    this public repo, read by the consumers' importers. It contains only public
    facts, and nothing touches `main`.
  - *Alternatives:* GitHub Pages (needs a publish run after each refresh), or a
    private channel (needs cross-project credentials).
- **D2 Daybook surface.** *Recommended:* a Morning 5 item on change plus a folded
  panel on Evidence, rather than a new Today card (the density plan holds
  until the 2026-10-11 usage review).
- **D3 First series.** *Recommended:* the Phase 1 list, taken from both apps'
  waiting lists.
- **D4 Who builds the consumer phases.** *Recommended:* a session opened in each
  repo, working from a handover written from this file, under that repo's own
  rules.

## 7. Sequence at a glance

| Step | Where | Depends on | Effort |
|---|---|---|---|
| Fix the APES override gap | BI-Assessor | none | about 0.5 day |
| Phase 0: contract and feasibility | Daybook | D1–D4 | about 0.5 day |
| Phase 1: numbers watcher and pack | Daybook | Phase 0 | 2–3 days |
| A week of clean pack runs | Daybook | Phase 1 | calendar time |
| Phase 2: ClaimBench import | BI-Assessor | the override fix, Phase 1 | 1–2 days |
| Phase 3: RiskM8 import and BI note | RiskM8 | Phase 1 | about 2 days |
| Phase 4: case law, events, emerging risks, questions | Daybook | Phase 1 | 3–4 days, staged |
| Phase 5: consumers take Phase 4 records | both | Phase 4 | 1–2 days each |
| Phase 6: July cycle and quarterly review | all | running | ongoing |
