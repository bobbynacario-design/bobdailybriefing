# Phase H: further series, one at a time

The roadmap's order: VIC and NSW tow and storage fees first, then the
Superannuation Guarantee, ATO benchmarks, ATO tax statistics, the RBA cash rate,
PPI/WPI, AER determinations, and diesel prices. Each series ships only after its
feasibility row, source, schedule, freshness, bounds, licence and consumer
mapping are settled.

## H-1: VIC and NSW regulated tow and storage fees → ClaimBench

Status: **decided and built, 2026-09-27.** Bob agreed D-H1 to D-H3 as recommended
(see "Built" at the end). Everything below was read on that date, with Daybook's
own user agent unless stated.

### What ClaimBench holds today (read-only)

| Record | Value | Source | Effective | Review due |
|---|---|---|---|---|
| `bm_rate_accident_tow_vic_au_v1` | $272.80 per tow | VIC gazette S318, 20 June 2025 | 2025-07-01 | **2026-09-30** |
| `bm_rate_vehicle_storage_vic_au_v1` | $20.90–$30.90 per day | same | 2025-07-01 | **2026-09-30** |
| `bm_rate_accident_tow_nsw_au_v1` | $320 per tow | nsw.gov.au, 2026–27 | 2026-07-01 | 2027-07-31 |
| `bm_rate_vehicle_storage_nsw_au_v1` | $18–$34 per day | same | 2026-07-01 | 2027-07-31 |

**The VIC records are for FY26 and are due for review in three days.** Their own
qualification warns against relying on them after June 2026 without a newer
notice. NSW is current.

### VIC: Special Gazette S257, 22 May 2026 (the FY27 instrument)

- **The notice itself:** "specify the varied amounts … for the 2026-27 financial
  year, as determined under section 212H of the Act", commencing 1 July 2026 and
  dated 19 May 2026. Each figure is the FY26 amount × Melbourne CPI 101.79 ÷
  98.11, rounded to 10 cents. **All amounts include GST.**
  - **Towing:** base fee **$289.60** (first 8 km, GVM under 4 t, controlled
    areas), **$4.60/km** beyond that, after-hours surcharge **$98.80**.
  - **Storage per day:** motor car under cover **$32.80**, motor car in a locked
    yard **$22.20**; motorcycle $10.80 / $6.80.
- **How it was found:**
  - `gazette.vic.gov.au` robots.txt is `Allow: /`, and it answers Daybook.
  - Its search for "212H" lists S257, pages 1–3.
  - Transport Victoria's charges page shows the same figures but no date. It sits
    behind a Cloudflare challenge that refuses automated readers (HTTP 403), and
    was read once in a real browser.
- **Found on the way:** S257 says the FY26 amounts it varied were re-determined
  by the Minister in **Special Gazette S151, 20 March 2026**. That puts the FY26
  base at $279.10, $4.40/km, $95.20 after hours, and storage at $31.60 / $21.40.
  - ClaimBench's approved VIC FY26 records hold the older S318 figures ($272.80,
    $20.90–$30.90).
  - S151's own effective date has not been read yet.
  - This finding is for BI-Assessor.
- **Licence:** the gazette states it "is subject to copyright. No part may be
  reproduced by any process except in accordance with the provisions of the
  Copyright Act 1968". There is no open licence.

### NSW: nsw.gov.au "Tow truck fees for light vehicles"

- **Readable automatically:** robots allow it, and it returned HTTP 200 to
  Daybook.
- **What the page says:** "Last updated: 01 July 2026", "These fees are valid for
  the 2026 to 2027 period", and "The listed charges exclude any applicable GST".
- **The figures,** in plain HTML tables:
  - "For any accident towing work **$320**";
  - storage "for each 24 hours or part of 24 hours": **$34** (light motor
    vehicle, Sydney metropolitan area) and **$18** (outside it);
  - per-km charges ($7 and $6), a 20% after-hours surcharge, motorcycles
    ($16 / $9), and salvage.
- **Licence:** CC BY 4.0, attributed "© State of New South Wales. For current
  information go to www.nsw.gov.au".

### Proposed series (matching ClaimBench's four records one to one)

| seriesId | Value | Unit | Capture | Watch | Bounds (min, max, max change) |
|---|---|---|---|---|---|
| `vic_atsa_accident_tow_base_fee` | $289.60 point | `aud_per_item` | manual (gazette PDF) | automated: the gazette search for "212H" | 200, 400, 40 |
| `vic_atsa_storage_motor_car_daily` | $22.20–$32.80 range (locked yard to under cover) | `aud_per_day` | manual | same watch | 10, 60, 8 |
| `nsw_tow_accident_towing_light` | $320 point | `aud_per_item` | **automated page** | the page itself | 200, 500, 60 |
| `nsw_tow_storage_light_daily` | $18–$34 range (regional to Sydney metro) | `aud_per_day` | **automated page** | the page itself | 10, 60, 10 |

- **Everything else goes in qualifications,** in the sources' words: per-km
  charges, after-hours surcharges, motorcycles, and GST (VIC includes it, NSW
  excludes it).
- **No contract change:** the contract has no per-km or per-tow unit, and none is
  added. Adding one would change `validate.js` and force another re-copy.
  `aud_per_item` is "per tow", and the mapping says so.
- **Schedules:**
  - VIC's notice appears in May–June, effective 1 July; the watch checks the
    gazette search daily and stays quiet until a new notice appears.
  - NSW updates on 1 July; the page is read daily.
  - Freshness is 400 days for all four.

## Decisions for Bob

- **D-H1 NSW now or next July.** NSW's FY27 figures equal ClaimBench's approved
  records.
  - **Publish them now (recommended):** Daybook becomes the source, and next July
    is automatic. BI-Assessor's mapping must treat "same value, same dates as the
    approved record" as a receipt skip, not a proposal.
  - **Or watch only:** publish nothing for NSW until the 2027–28 figures appear.
- **D-H2 The VIC licence.** The gazette has no open licence.
  - **Proposed:** publish the figures (facts are not copyright) with short quotes
    of the relevant clauses, for citation. Keep the PDF's SHA-256 and its
    permanent gazette URL, but **not** a copy of the PDF in the repo (unlike the
    FWO guide). The gazette keeps every issue at a stable address.
  - **Alternative:** hold VIC until the terms are checked with the Office of the
    Parliamentary Counsel.
- **D-H3 Download.** May I download S257 (about 520 KB) as Daybook, to take its
  SHA-256 for the VIC capture? It is not kept in the repo.

### Built (H-1)

- **NSW: `grounding/sources/nsw-tow-fees.js`** reads the page daily, with one
  fetcher per series, and fails closed. It checks:
  - the heading;
  - "Last updated";
  - the "valid for the <year> to <year> period. … exclude any applicable GST."
    sentence, which must name one financial year;
  - the named table rows, each a whole-dollar charge, with the outside-Sydney
    storage figure not above metro.

  `publishedAt` is the period start, not "Last updated", so an edit that changes
  nothing else is not a correction. The per-km charges and the 20% after-hours
  surcharge are qualifications, in the page's words.
- **VIC: manual captures** in `grounding/manual/vic_atsa_accident_tow_base_fee.json`
  ($289.60, clause 6) and `vic_atsa_storage_motor_car_daily.json` ($22.20–$32.80,
  clauses 9.1 and 9.3). They carry short quotes, the notice's SHA-256
  (`a9468e36…bdc2`) and its permanent URL, with no copy of the PDF (D-H2).
  `grounding/sources/vic-gazette-towing.js` asks the gazette search for "212H"
  each day:
  - the same newest notice: nothing to say;
  - a newer notice (in any position in the results): **stale**, naming it;
  - no capture: **awaiting publication**;
  - an unreadable results page: **blocked**.
- **Registry:** the four series, with the bounds in the table above and
  freshness 400 days.
- **Tests:**
  - 11 new tests (6 NSW, 5 VIC); 95 grounding tests in total, and the full suite
    passes.
  - Ten deliberate breakages were each caught.
  - One Phase F test was loosened to what it tests (the award beside an
    unchanged CPI), because the registry now holds more series.
- **Live dry run** against release 000003 and every live source: it proposed
  release 000004, with the four fee records new (all fact-verified and
  plausible) and every watch published.

### Live, 2026-09-27

- Dispatch run 36324283364 on 756d26c published **release 000004**, manifest
  `f51f1a439d02d19985ae19ea5c7c0981e2ad5102919b86c328a2b06258efae64`. It holds six
  facts: CPI, the award and the four fees. All are fact-verified and plausible
  under Daybook's bounds, and every watch reads published.
- GitHub's runner read the NSW page and the gazette search: `grounding-ops`
  records both checks with no error. The mirror is at sequence 4.

### Applied in BI-Assessor, 2026-09-28: H-1 done

BI-Assessor's own record is `docs/CLAIMBENCH_DAYBOOK.md`: 39f6f31 (the mapping,
deployed with `deploy:safe`) and 672dd5a (the record). `check:claimbench-daybook`
passes 244; I re-ran it here.
- **The card:** "Check Daybook release" showed exactly the two VIC supersedes,
  and Bob applied both. ClaimBench now reports `bm_rate_accident_tow_vic_au_v2`
  ($289.60 per tow) and `bm_rate_vehicle_storage_vic_au_v2` ($22.20–$32.80 a
  day) for FY27.
- **NSW** matched the approved records and was skipped as identical, so it
  stays on `_v1` (D-H1 as intended).
- **S151 (FY26 re-determination):** Bob decided on no correction record.
  ClaimBench resolves rates by today's date, so an FY26 record would never be
  shown. The exposure is per-claim rate snapshots frozen between S151's start
  and the `_v2` apply; an assessor re-checks any such TP claim with a VIC tow or
  storage line. If ClaimBench ever resolves by service date, Daybook captures
  S151 as its own dated observation.

### What the BI-Assessor brief asked (kept for the record)

| Daybook series | ClaimBench record | Action |
|---|---|---|
| `vic_atsa_accident_tow_base_fee` | `bm_rate_accident_tow_vic_au_v1` (FY26 $272.80) | supersede to `_v2`, $289.60, 2026-07-01 to 2027-06-30 |
| `vic_atsa_storage_motor_car_daily` | `bm_rate_vehicle_storage_vic_au_v1` (FY26 $20.90–$30.90) | supersede to `_v2`, $22.20–$32.80 |
| `nsw_tow_accident_towing_light` | `bm_rate_accident_tow_nsw_au_v1` ($320, FY27) | **identical to approved: a receipt skip, not a proposal** (D-H1) |
| `nsw_tow_storage_light_daily` | `bm_rate_vehicle_storage_nsw_au_v1` ($18–$34, FY27) | identical: skip |

Contract values:
- `kind` `regulated_fee`, `basisCode` `regulated_fee_max`.
- **Units:** `aud_per_item` means per tow; `aud_per_day`.
- **Jurisdictions:** `VIC`, `NSW`.
- **Publishers:** exactly `Victoria Government Gazette (Secretary, Department of
  Transport and Planning)` and `NSW Fair Trading`.
- **Evidence:** VIC is GST inclusive and NSW is ex GST; the qualifications say so.

The VIC FY26 records' own figures were re-set by S151 (20 March 2026) to a
$279.10 base, $4.40/km, $95.20 after hours and $31.60 / $21.40 storage.
Reviewing the FY26 records is BI-Assessor's call.

## H-2: the Superannuation Guarantee charge percentage (watch only)

Status: **live, 2026-09-28**, in release 000005 (manifest `133e5977…`; dispatch on c6a5d24).
It is a watch-only release: `facts.json` is byte-identical to release 000004, so
consumers skip it, and GitHub's runner read the Register API with no error.
The roadmap says "Legislated at 12%; watch for
change", for BI-Assessor's wages method.

- **What BI-Assessor holds** (read-only):
  - `public/app/screen1-wages-method1-contract.js` has `SG_RATE_BY_FY`:
    10.5% (FY23), 11% (FY24), 11.5% (FY25), and 12% "from 1 Jul 2025 onwards
    (legislated terminal rate)".
  - The rate is resolved by date of loss, and "No manual override".
  - So a fact would not be consumed. What it needs is to hear when the law
    changes: a watch.
- **Sources:**
  - The ATO refuses automated readers (HTTP 403 from its CDN, even for
    robots.txt).
  - The Federal Register of Legislation allows robots (`Crawl-delay: 10`).
  - Its public API, `api.prod.legislation.gov.au/v1` (no robots file), answers
    Daybook.
  - `versions/find(titleId='C2004A04402',asAtSpecification='Latest')` gives the
    latest compilation of the *Superannuation Guarantee (Administration) Act
    1992*: compilation 78 (C2026C00272), in force from 2026-07-01, registered
    2026-07-08, amended by the *Treasury Laws Amendment (Payday Superannuation)
    Act 2025*.
- **Reviewed (in a real browser, reading the compilation's text):**
  - section 17A, "When an individual superannuation guarantee amount arises",
    subsection (2): **"charge percentage means 12."** It is a flat
    definition; Payday Super replaced the old year-by-year table.
  - From 1 July 2026, SG arises on each payment of **qualifying earnings** (the
    "QE day"), not quarterly on ordinary time earnings.
  - BI-Assessor's 12% stands; the base has changed, which is for BI-Assessor to
    weigh in its wages method.
- **Built:** `grounding/sources/sg-legislation.js`, registered as
  `cth_sg_charge_percentage` with `capture: 'watch'`. It never publishes a fact.
  - **The reviewed compilation** (`REVIEWED` in the module) reads as
    **published**, with the finding.
  - **A newer compilation,** including one registered ahead of its start date,
    turns it **stale**, naming it and its amending Acts. That reaches the
    Morning 5.
  - **An unreadable answer** is **blocked**.
  - **To clear a stale:** read section 17A of the new compilation, update
    BI-Assessor if the rate changed, and record the new review in `REVIEWED`.
  - **Detail length:** capped at 500 characters. A long list of amending Acts
    becomes a count; a test found the first version could exceed the cap.
- **Licence:** the compilation states none. Only compilation details and the
  five-word definition are published, for citation.
- **Tests and checks:**
  - 6 new tests; 101 grounding tests in total, and the full suite passes.
  - Four deliberate breakages were each caught.
  - A live dry run proposed a watch-only release (facts unchanged), with the
    SG watch published.

## H-3: ATO Small Business Benchmarks (a reviewed-year reminder)

Status: **live, 2026-09-28**, in release 000006 (dispatch on 30d50e3). It is a
watch-only release: `facts.json` is byte-identical to release 000005. Bob chose
option A (D-H3-1). The roadmap says: "watch, both
consumers, annual, method-dependent".

- **What the consumers hold** (read-only):
  - Both cite individual ATO "in detail" benchmark pages
    (`ato.gov.au/…/small-business-benchmarks/in-detail/<industry>`), captured by
    hand. The quotes are cost-of-sales ranges by turnover band, mostly as at
    2026-03-16.
  - **RiskM8** cites **43 industries** (`library/provenance.js`,
    `anzsic-gp-benchmarks.js`, the industry modules).
  - **BI-Assessor's ClaimBench** cites **16**, all among the 43
    (`claimbench/sources.js`, `benchmarks.js`).
- **The release pattern:** the ATO's own dataset on data.gov.au ("Small
  Business Benchmarks", CC BY 2.5 AU, one XLSX per year) shows a new year each
  March:
  - 2021–22 on 2024-03-13;
  - 2022–23 on 2025-03-16;
  - **2023–24 on 2026-03-15**, which is what the consumers' 2026-03-16 citations
    reflect.
- **Access:**
  - **ato.gov.au refuses Daybook** (HTTP 403 from its CDN, even for robots.txt).
  - **data.gov.au's robots.txt is `User-agent: *` / `Disallow: /`.** It
    forbids every automated agent, its API included.
  - One catalogue search was made there during this review. None is made
    automatically.
  - So under G7 neither can be read automatically, and the benchmarks cannot be
    watched the way CPI or the SG Act are.

### Options (D-H3-1)

- **A. A reviewed-year watch (recommended).**
  - Daybook records the benchmark year last reviewed: 2023–24, released
    2026-03-15, read once here.
  - The watch reads **published** until a year after that release, then turns
    **stale**. Its detail says that the ATO has released each new year in March
    since 2024, that the 43 cited industries in the two apps should be checked,
    and that the review should then be recorded.
  - No site is read automatically, and no expected date is published (G8):
    "stale" means only that the review is over a year old.
  - Watch only, like SG: no figures.
- **B. Ask for access.** Ask the ATO or data.gov.au whether a daily
  metadata check would be acceptable. That is slow and uncertain; A can run
  meanwhile.
- **C. Skip it.** Leave the benchmarks to the consumers' own annual review.

### Built (H-3)

- **`grounding/sources/ato-sbb.js`,** registered as
  `ato_small_business_benchmarks_year` (`capture: 'watch'`; never a fact).
  - `REVIEWED` = the 2023-24 benchmarks, released 2026-03-15, reviewed
    2026-09-28.
  - It makes **no request**; a test fails if it ever calls fetch.
  - It reads **published** until 380 days after the release (2027-03-30),
    then **stale**. That leaves room for a mid-March release, and the stale
    state reaches the Morning 5.
  - Its detail says it is a reminder, not a watch. It publishes no expected
    date (G8).
  - **To clear it:** check whether the next year is out, re-check the
    industries both apps cite, and record the new review in `REVIEWED`.
- **Tests and checks:**
  - 5 tests; 106 grounding tests in total.
  - Three deliberate breakages were each caught: never going stale, going
    stale a day early, and reading a site.
  - A live dry run proposed a watch-only release (facts unchanged), with the
    reminder published.

## H-4: ATO Taxation Statistics (a reviewed-edition reminder)

Status: **live, 2026-09-28**, in release 000007 (dispatch on bd9fb9a). It is a
watch-only release: `facts.json` is byte-identical to release 000006. It uses the
same approach Bob chose for H-3.

- **What RiskM8 holds** (read-only):
  - `library/anzsic-gp-benchmarks.js` holds **261 ANZSIC gross-profit rates**,
    seeded 2026-07-14 from *Taxation Statistics 2020-21*'s company financial
    ratios (Table 1C: fine industry by business status; "Gross profit ratio";
    all; total; average ratio).
  - `library/gp-turnover-bands.json` (built by `scripts/build-gp-turnover-bands.js`)
    holds the same table's income-range bands (Table 2C).
  - The module says to regenerate from a newer release rather than hand-edit.
  - BI-Assessor does not use this release.
- **What the ATO publishes** (read in a real browser; ato.gov.au refuses
  automated readers, and data.gov.au's robots.txt disallows every agent):
  - *Taxation statistics 2022-23* was published 2025-06-27, and **2023-24 on
    2026-06-17**.
  - 2023-24's "Industry benchmarks" (last updated 17 June 2026) produce
    company ratios "for each of the following 3 levels of industry: broad
    industry, fine industry, business industry code".
  - Some tables are split by business status and others by business income
    ranges, each with the number of entities, the average ratio and the median
    ratio.
  - They include "Gross profit ratio = (Total business income − Cost of sales)
    ÷ Total business income".
  - This is the same product RiskM8's 2020-21 tables came from. **RiskM8 is
    three editions behind.**
- **Built:** `grounding/sources/ato-taxstats.js`, registered as
  `ato_taxation_statistics_edition` (`capture: 'watch'`; never a fact; it
  makes no request).
  - `REVIEWED` = edition 2023-24, released 2026-06-17, with the finding above.
  - It reads **published** until 380 days after the release (2027-07-02), then
    **stale**. It publishes no expected date (G8).
  - **To clear it:** check the next edition, tell RiskM8, and update `REVIEWED`.
- **Tests:** 4 tests; 110 grounding tests in total. Three deliberate breakages
  were each caught.
- **For RiskM8 now:** regenerating its two tables from the 2023-24 industry
  benchmarks is its own owner-run step (a separate session).

## H-5: the RBA cash rate target (automated, Daybook only)

Status: **live, 2026-09-29**, in release 000009 (see "Live" at the end). Bob
agreed D-H5-1 to D-H5-4 as recommended, and approved publishing. Everything below was read on
that date with Daybook's own user agent. The
roadmap row says: automated; Daybook only, until a consumer needs it
(ClaimBench has no interest metric).

- **Contract:** nothing to change. `kind: 'rate'`, `unitCode: 'pct_pa'` and
  `basisCode: 'policy_rate_target'` are already in the contract. `validate.js`
  keeps its SHA-256, so neither consumer re-copies anything. Neither consumer
  maps the series: both skip it as not allowlisted.
- **Access:** rba.gov.au answers Daybook (HTTP 200) on every page used here.
  `robots.txt` disallows only `/assets/`, `/search/`, `/s/`, the image library
  and two single pages.

### Sources

| Page | What it gives | Seen 2026-09-29 |
|---|---|---|
| `/statistics/cash-rate/` ("Cash Rate Target \| RBA") | Table "Interest Rate Decisions": Effective Date, Change (% points), Cash rate target (%), and links to each decision's Statement and Minutes. It lists every decision, holds included (Change 0.00) | Top row: **12 Aug 2026, 0.00, 4.35**, Statement `mr-26-19` |
| `/media-releases/2026/mr-26-19.html` | "Statement by the Monetary Policy Board: Monetary Policy Decision". `datePublished` `2026-08-11T14:30+10:00`. First paragraph: "At its meeting today, the Board decided to leave the cash rate target unchanged at 4.35 per cent." | |
| `/schedules-events/board-meeting-schedules.html` | Monetary Policy Board meetings for 2026 and 2027. The decision comes on the second day, at 2:30 pm AEST | **Next: 28–29 September 2026, so a decision is due today.** Then 2–3 November and 7–8 December |
| `/statistics/tables/csv/f1-data.csv` (F1, daily) | `FIRMMCRTD` "Cash Rate Target on date": 4.35 on 12-Aug-2026, and 4.35 with a change of 0.25 on 06-May-2026 | Latest full row is 28-Sep-2026; a date's row arrives a day or more later. **F1.1 is monthly averages, so it is unusable as a cross-check** |

The statement's wording, across a hold, a rise and a cut (mr-26-19, mr-26-12,
mr-25-22), is one pattern: "the Board decided to **leave** the cash rate
target **unchanged at** 4.35 per cent" / "to **increase** … **by 25 basis
points to** 4.35 per cent" / "to **lower** … by 25 basis points to 3.60 per
cent".

### Proposed design

- **Series** `rba_cash_rate_target`, "RBA cash rate target", publisher "Reserve
  Bank of Australia", jurisdiction AU, `capture: 'page'`, streams `sme_bi` and
  `risk_review`.
- **One observation per Board decision (D-H5-1).**
  - The observation key and `effectiveFrom` are the table's Effective Date.
    `effectiveTo` is null. `publishedAt` is the statement's date.
  - A hold is a new observation at the same value, so the Morning 5 reads
    "4.35% p.a. → 4.35% p.a. (2026-08-12 → 2026-09-30)".
- **Evidence (D-H5-2).**
  - The `release` evidence is the **statement's decision sentence**, which the
    value is bound to.
  - The `cross_check` evidence is the **cash-rate table's value cell** for the
    same row. The table links to that statement, so the parser follows the
    link from the top row.
  - Both are available the same afternoon, so a decision publishes at the next
    morning run (06:15 AEST).
  - F1 is not used: it lags a day or more, and it carries ASX and FENICS
    columns (Third Party Material).
- **Fails closed** (blocked, with what it saw) on anything unrecognised:
  - different table headers;
  - a top row without a Statement link;
  - a statement that isn't a Monetary Policy Board decision, or whose sentence
    doesn't match the pattern;
  - a statement figure that differs from the table (a conflict);
  - a verb or basis-point change that disagrees with the table's Change;
  - a statement dated on or after the effective date.
  - A failed statement fetch holds the figure for the day, as for the CPI.
- **Watch and expected date (G8).**
  - `expectedBy` is the decision day of the next scheduled meeting after the
    latest statement.
  - If the Sydney date passes it while the page still shows the older
    decision, the series is **overdue**.
  - A schedule the parser can't read means no expected date; it does not block
    the figure.
  - Freshness: 75 days. The longest scheduled gap is December to February,
    about 63 days.
- **Bounds (D-H5-3):**
  - min 0, max 10. Since 1996 the target has been 0.10 to 7.25.
  - maxChange 1.0. The largest single move since 1990 was −1.00 in October
    2008.
  - A breach is held for a reviewed override, as for every series.
- **Licence (D-H5-4).** The statements are RBA Material under CC BY 4.0. The
  cash rate target itself is **RBA Financial Data** (copyright notice, section
  5). That is not the administered "Cash Rate", which is the interbank
  overnight rate. It may be used personally or commercially if:
  - it is attributed ("Source: Reserve Bank of Australia [year]");
  - no RBA endorsement is implied;
  - it is not commercially exploited improperly.

  The licence string says so in under 300 characters.
- **Fixtures:** verbatim fragments of the cash-rate page, the three statements
  and the schedule, with a source and licence header, as for the ABS. No F1
  data is kept.
- **Help (in its own lane):** the "Your numbers" card still names only the
  CPI. One sentence adds the cash rate. It is an index.html change, so the
  cache version is bumped and the push deploys it.

### Decisions for Bob

- **D-H5-1 Observation model.** (a) One per Board decision, holds included, as
  the RBA's own table does (recommended). (b) One per change only; a hold then
  only refreshes the watch's detail, and freshness can't be used.
- **D-H5-2 Evidence.** The statement as `release` and the table cell as
  `cross_check` (recommended; same day). Or F1 as the cross-check, which
  publishes a day or two after each decision and carries third-party columns.
- **D-H5-3 Bounds.** 0 to 10, max change 1.0 (recommended).
- **D-H5-4 Licence and fixtures.** Accept the RBA Financial Data terms with
  attribution, and keep verbatim excerpts as test fixtures (recommended).

**Timing.** Published before 2:30 pm AEST today, the first fact is the 12 August
decision. The 06:15 AEST run on 30 September then publishes today's decision
as the series' first update: a live end-to-end cycle.

### Built (H-5)

- **`grounding/sources/rba-cash-rate.js`**, registered as `rba_cash_rate_target`
  (`capture: 'page'`, freshness 75 days, bounds 0 to 10 with max change 1,
  cadence 12 hours). Each run it reads the cash-rate page's top row, follows its
  Statement link, and reads the meeting schedule.
  - The value is bound to the statement's decision sentence. Only that
    sentence is quoted, so a long first paragraph cannot exceed the quote cap.
    The table's value cell is the cross-check.
  - `publishedAt` is the statement's `datePublished`. Some statements give a
    date with no time (`2026-05-05`), and both forms are read.
  - Found while building: a parser that took the first `<time>` or the first
    table row would have misread the full pages. It reads the `rss-mr-date`
    element and the schedule's table body.
- **Fixtures:** verbatim fragments of the cash-rate page (three rows), the
  August 2026 hold, the May 2026 rise, the August 2025 cut and the 2026–2027
  schedule. Each parses exactly as the full page does.
- **Tests:** 9 new; 121 grounding tests in total.
  - Eight deliberate breakages were each caught: no statement–table check,
    overdue on the decision day, the value taken from the table, no page-title
    check, the schedule's first meeting day, the current decision as the
    "next", no headline check, and a statement dated on the effective day.
- **Live dry run** over release 000008 with every real source: it proposed
  release 000009 with exactly one change, `rba_cash_rate_target@2026-08-12#r1`
  = 4.35 (source-linked, fact-verified, cross-checked, plausible). The watch
  reads published, with the next decision expected on 2026-09-29. Every other
  series was unchanged.

### Live, 2026-09-29

- **Published:** dispatch run 36500384227 on b9d34ae (23:54 UTC on the 28th)
  published **release 000009**, manifest
  `405cdf58bbbc32b66cd4fd92e83bff7a1c1633abc1bc34b773c923abf49f805f`.
- **What changed:** compared with 000008, it adds only
  `rba_cash_rate_target@2026-08-12#r1` = 4.35. No record is altered, and the
  only watch record that changed is the new series' own.
- **GitHub's runner can read rba.gov.au:** the page, the statement and the
  schedule all answered.
- **`fetchRelease` against the live URL:** ok. The fact is source-linked,
  fact-verified, cross-checked and plausible. The watch reads published, with
  `expectedBy` 2026-09-29.
- **The Firestore mirror** is at sequence 9, with the same manifest. The
  Morning 5 change reads "RBA cash rate target: 4.35% p.a. (2026-08-12)".
- **Help** (f6b322d, cache v129): the "Your numbers" card names the cash rate.
  The live site serves both.
- **Next:** the Board decides at 2:30 pm AEST today. The scheduled run at 06:15
  AEST on 30 September should publish it as the series' first update, with
  `expectedBy` moving to 2026-11-03. If the RBA's page has not moved by then,
  the series reads **overdue** instead.

### First update, 2026-09-30

- **Published:** the scheduled grounding run 36646763391 on 79933b4 published
  **release 000011**, manifest
  `a301d30f2ea19a5f03b8325c4bf94fea083efc50288b069dbbfdb1a55a0129c4`. GitHub
  started the 20:15 UTC schedule at 23:44 UTC, about 3½ hours late (09:44 AEST).
- **What changed:** compared with 000010, exactly one record was added and one
  was altered:
  - added `rba_cash_rate_target@2026-09-30#r1` = 4.6, `supersedes` the August
    record. The statement is mr-26-27 (29 September 2026): "the Board decided
    to increase the cash rate target by 25 basis points to 4.60 per cent." The
    table row is 30 Sep 2026, 4.60.
  - `rba_cash_rate_target@2026-08-12#r1`: lifecycle current → superseded,
    nothing else.
  - The only watch record that changed is the series' own: published,
    `expectedBy` 2026-11-03.
- **The mirror** is at sequence 11, with the same manifest.
- This is the series' first real update cycle, and the first one for any
  automated series after Phase G's rehearsal.

## H-6: wages (WPI) and construction prices (PPI), for labour and materials

Status: **live, 2026-09-29**, in release 000010 (see "Live" at the end). Bob
agreed D-H6-1 to D-H6-4 as recommended (the three WPI series; PPI deferred), and
approved publishing. Everything below was read on that date with Daybook's own user agent.
The roadmap row says: "PPI (construction; electricity), WPI — automated —
RiskM8 — after CPI proves the ABS path". CPI has proved it.

- **Who would use it.** Neither consumer can take these today.
  - RiskM8 has one Daybook target, `bi_price_index`: the CPI note on the BI row,
    which is context only.
  - ClaimBench has no index metric (roadmap, "Known registry gap").
  - So, like the cash rate, these would be Daybook-only until a consumer maps
    them.
  - The fit with Bob's files is direct. About half are third-party damage to
    poles and road assets, where labour rates (~46%) and materials are
    recurring quantum issues. First-party BI runs on wages.
- **Contract:** nothing to change. `kind: 'index'`, `unitCode: 'pct'`,
  `basisCode: 'annual_change'` (and `index_points` / `index_level`) exist.

### What the ABS offers (Data API dataflows WPI 1.2.0 and PPI 1.1.3)

| | WPI (Wage Price Index) | PPI (Producer Price Indexes by Industry) |
|---|---|---|
| Release page | "Wage Price Index, Australia, June 2026". Key statistics: "The WPI rose 3.2% over the twelve months to the June quarter 2026." Tables: "All sector WPI, quarterly and annual movement (%), seasonally adjusted" and "Annual and quarterly movement - industries" (Construction 3.3, Electricity, gas, water and waste services 3.6) | "Producer Price Indexes, Australia, June 2026". Key statistics give only final demand and building. Road and bridge (+4.5%) and heavy and civil (+2.3%) appear in commentary prose as **quarterly** moves. **The construction index numbers are not on the page** |
| Data API | Percentage changes: key `3.THRPEB.7.<industry>.<tsest>.AUS.Q` (3 = change from the same quarter a year earlier). June 2026: all industries SA 3.2; Construction 3.3; Electricity etc. 3.6. They agree with the page | **Index numbers only** (measure 1). 3101 Road and bridge 154.9 (Mar 148.2), 3109 other heavy and civil 149.2, 31 heavy and civil 150.3. No percentage change is published, so an annual change would be derived, and consumers refuse derived figures |
| Next release | 18/11/2026 (September quarter) | 30/10/2026 (September quarter) |
| History (annual, since 1998) | 0.8 to 6.5 across the three; largest quarter-to-quarter move 2.1 (electricity, 2007) | from 1997 (road and bridge) |

- **"PPI electricity"** as the roadmap wrote it is the price of electricity
  supply, not the cost of repairing the network. The wage of utility workers
  (WPI, Electricity, gas, water and waste services) is closer to Bob's quantum
  questions.

### Proposed design (the CPI pattern)

- **Three WPI series,** each the annual change in total hourly rates of pay
  excluding bonuses, all sectors, Australia, quarterly:
  - all industries, seasonally adjusted (the headline);
  - Construction, original;
  - Electricity, gas, water and waste services, original.
- **Evidence:** the value is quoted from the release page's table; the
  cross-check is the Data API's value cell. The expected date comes from the
  page's own "Next Release", and the series is overdue if that passes.
  Anything unrecognised fails closed.
- **Bounds:** min −2, max 10, max change 2.5. One observation per quarter.
- **Licence:** ABS, CC BY 4.0, as for the CPI.
- **PPI deferred.** It would be index numbers quoted from the Data API alone,
  with no second form to cross-check. An annual change would be a derived
  figure. Worth doing when a consumer wants cost escalation by index ratio.

### Decisions for Bob

- **D-H6-1 Scope.**
  - (a) The three WPI series now; PPI deferred (recommended).
  - (b) The same, plus PPI road-and-bridge and heavy-civil index numbers
    (API-only, not cross-checked).
  - (c) Only the headline WPI.
- **D-H6-2 Industries.** Construction, and Electricity, gas, water and waste
  services, next to the headline (recommended); or others.
- **D-H6-3 Bounds.** Min −2, max 10, max change 2.5 (recommended).
- **D-H6-4 Licence and fixtures.** ABS CC BY 4.0, with verbatim page fragments
  as test data (recommended), as for the CPI.

### Built (H-6)

- **`grounding/sources/abs-wpi.js`**, registered as three series (capture
  `page`, freshness 110 days, bounds −2 to 10 with max change 2.5, cadence 12
  hours). The observation key is the ABS quarter (`2026-Q2`):
  - `abs_wpi_all_industries_annual_change`: the headline table ("All sector
    WPI, quarterly and annual movement (%), seasonally adjusted"), the row
    for the release's quarter (`Jun-26`), column "Annual (%)"; API
    `3.THRPEB.7.TOT.20.AUS.Q`.
  - `abs_wpi_construction_annual_change` and
    `abs_wpi_electricity_gas_water_waste_annual_change`: the industries
    table, column "Annual change (%)"; API `3.THRPEB.7.E.10` / `.D.10`. They
    carry the page's own note, "Index series is original, total hourly rates of
    pay excluding bonuses.", as a qualification.
- **One page read and one API read per run** serve all three (the Data API
  takes `TOT+E+D` and `10+20` in one key).
- **Fails closed:**
  - a title, period or permanent address that disagrees;
  - a headline table whose last row is not the release's quarter;
  - changed columns;
  - a missing table or industry row;
  - the "original" note gone.

  An API that disagrees is a conflict for that series; an API that is down or
  lagging holds all three for the day. Overdue comes from the page's "Next
  Release": not on the release day itself (the ABS publishes at 11:30), but
  from the next morning.
- **Found on the way:** the industries table is in original terms. Its "All
  industries" row gives 0.6 for the quarter, where the seasonally adjusted
  headline gives 0.8, so each series is cross-checked against the matching
  estimate.
- **Tests:** 8 new; 129 grounding tests in total.
  - Six deliberate breakages were caught: no "original" check, the headline
    row not tied to the quarter, the quarterly figure taken as annual, the
    wrong estimate in the cross-check, one read per series, and overdue on the
    release day.
  - The last one got through the first version of the tests, and a case was
    added.
- **Live dry run** over release 000009 with every real source: it proposed
  release 000010 with the three WPI figures (3.2, 3.3 and 3.6 for 2026-Q2;
  source-linked, fact-verified, cross-checked, plausible; next expected
  2026-11-18).
  - It also carried the RBA's decision of the same afternoon, **4.35 → 4.6
    (effective 2026-09-30)**, read by H-5's parser as its first live update.
    The watch now expects 2026-11-03.

### Live, 2026-09-29

- **Published:** dispatch run 36541828449 on dbee07f (08:18 UTC) published
  **release 000010**, manifest
  `196557796008aa3f49f319689a2d1e2f6aa7f50d7836dfc34f9faceeb8e8f5b7`.
- **What changed:** compared with 000009, it adds exactly the three WPI
  records (3.2, 3.3 and 3.6 for 2026-Q2). No record is altered. `fetchRelease`
  against the live URL: ok. All three are source-linked, fact-verified,
  cross-checked, plausible and eligible. GitHub's runner read the ABS page and
  the Data API.
- **The mirror** is at sequence 10, with the same manifest.
- **Help** (6c02585, cache v132): the Your numbers card names the WPI.
  Quarters now read "Jun qtr 2026". The live site serves both.
- **The RBA's decision was not in this release, correctly.** The cash rate is
  checked every 12 hours, and it was last checked at 23:54 UTC for release
  000009, only 8½ hours earlier (`grounding-ops`). The dry run had no ops
  record, so it checked everything. The scheduled run at 20:15 UTC (06:15 AEST
  on 30 September) is due to publish it: 4.35 → 4.6 from 2026-09-30,
  expecting 2026-11-03 next.
