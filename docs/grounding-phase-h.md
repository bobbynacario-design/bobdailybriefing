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

Status: **built, 2026-09-28.** The roadmap says "Legislated at 12%; watch for
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

