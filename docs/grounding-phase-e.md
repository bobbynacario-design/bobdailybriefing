# Phase E: ABS CPI → RiskM8 (feasibility row)

Status: **agreed and built, 2026-09-27.** Bob approved **D-E1** to **D-E4** as proposed.
The contract is [grounding-roadmap.md](grounding-roadmap.md); Phase E starts with the
validator fix in 2a162d7 (roadmap 5.2).

Everything below was read on 2026-09-27 with Daybook's own user agent
(`bobdailybriefing/1.0 (...)`), the way the publisher will read it.

## The series

| Field | Proposed value | Why |
|---|---|---|
| `seriesId` | `abs_cpi_all_groups_annual_change` | The roadmap's own example; stable forever once a consumer maps it |
| Title | CPI, all groups, annual change (Australia) | |
| `kind`, `unitCode`, `basisCode` | `index`, `pct`, `annual_change` | What RiskM8's `bi_price_index` target requires |
| Measure | The **monthly CPI**: All groups CPI, Australia (weighted average of the eight capitals), original, % change from the same month a year earlier | Since the October 2025 reference month, the complete monthly CPI is the ABS headline. Quarterly figures still exist (tables 17–18), but the release sentence quotes the monthly figure |
| `observationKey` | `YYYY-MM`, the reference month (`2026-07`) | |
| `observationDate` | The last day of that month | |
| `scope` | `AU`; period from the first day of the month a year before to the last day of the reference month (`2025-08-01` to `2026-07-31`) | RiskM8 needs `period.to` to print "in the 12 months to July 2026" |
| `publishedAt` | The page's "Released" date | |
| `effectiveFrom`, `effectiveTo` | null | An index, not a rate that takes effect |
| Publisher string | `Australian Bureau of Statistics` | The exact string RiskM8 will allowlist |
| Licence | `CC BY 4.0. Source: Australian Bureau of Statistics, Consumer Price Index, Australia, <Month YYYY>` | ABS material is CC BY 4.0; unchanged figures are attributed "Source: Australian Bureau of Statistics" |

## Where the value comes from

**Release (quote):** `https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/latest-release`
- robots.txt allows it; it returned HTTP 200 (414 KB) for Daybook's agent.
- The Key statistics block (`#key-statistics`) reads, for July 2026:
  "In the 12 months to July 2026:" then "The Consumer Price Index (CPI) rose 3.5%, down from 3.8% in the 12 months to June 2026."
  The quote is those two, as the page shows them; the binding token is `3.5`.
- The page also states the reference period ("July 2026"), the release date
  ("Released 26/08/2026") and the next release ("Next Release 30/09/2026,
  Consumer Price Index, Australia, August 2026").
- The evidence URL is the permanent page for that month (`.../consumer-price-index-australia/jul-2026`,
  HTTP 200), which the latest-release page links to. `latest-release` changes every month.

**Cross-check (data):** ABS Data API, dataflow `ABS,CPI,2.0.0`, key `3.10001.10.50.M`
(measure 3 = % change from previous year; index 10001 = All groups CPI; 10 = original;
50 = Australia; M = monthly).
- `https://data.api.abs.gov.au/rest/data/ABS,CPI,2.0.0/3.10001.10.50.M?startPeriod=<YYYY-MM>`
  with `Accept: application/vnd.sdmx.data+csv` returned HTTP 200, with
  `2026-07,3.5` in its rows, so it agrees with the release.
- **The cross-check quote is the value cell alone** (`3.5`), and the locator carries
  the series key and month. A whole CSV row would also contain 7 (from `2026-07`),
  10, 50 and 25, so a 7% or 10% CPI could agree by accident.
- The Data API is officially **beta**, with no guaranteed availability.

## Parser rules (fail closed)

1. Find `#key-statistics`, its first paragraph "In the 12 months to <Month YYYY>:",
   and its first list item "The Consumer Price Index (CPI) rose <n>%". The month
   must equal the page's Reference period. Anything else is **blocked**, with what
   was seen, and nothing is published.
2. **"fell"** (annual deflation) is blocked too. The quote's token would be
   unsigned, so it can never bind to a negative value; that month would be
   captured by hand.
3. The API row for the same month must carry the same value, or the record is a
   **conflict**.
4. `expectedBy` is the page's own "Next Release" date. The watch turns **overdue**
   only after that date, when the page still shows the old month.

## Decisions (agreed 2026-09-27)

- **D-E1 Measure.** The monthly CPI above. (The alternative is the quarterly CPI,
  which moves only four times a year and is no longer the headline.)
- **D-E2 Cross-check required.** A disagreement is a conflict. **When the beta API
  cannot be reached, hold the figure for that day** (the watch keeps its state,
  and the next run tries again) rather than publishing it without a cross-check.
  Publishing first and adding the cross-check later would create a spurious
  "corrected" revision.
- **D-E3 Timing.** The daily 04:15 PHT run is before the 11:30 AEST (09:30 PHT)
  release, so a new figure is published the morning after the release. A second
  run on release days is possible later if a day matters.
- **D-E4 Bounds and freshness.**
  - **Bounds:** min −3, max 12, maxChange 1.5 percentage points between
    consecutive months. Recent real moves were at most 1.1 (June 1.9 → July 3.0,
    2025).
  - **Freshness:** stale after 50 days, which covers the Christmas gap.
  - **Cadence:** checked on every daily run. The registry says 12 hours: GitHub
    starts scheduled runs hours late, so a 24-hour cadence would skip a day
    whenever one run started earlier than the day before.

## Built

- `grounding/sources/abs-cpi.js` is the parser and fetcher, registered in `grounding/series.js`.
- `grounding/sources/abs-cpi.test.js` has 11 tests against verbatim, trimmed copies of the real July 2026 page and API answer (`grounding/sources/fixtures/`).
- Eight deliberate breakages of the parser were each caught:
  - skipping the API dimension check;
  - skipping the heading-month check;
  - skipping the permanent-address check;
  - publishing a fall;
  - never going overdue;
  - quoting the whole API row;
  - swallowing an API outage;
  - binding the wrong number.
- `producer.js` accepts a fetcher's stated next date `{ expectedBy, url, detail }` without changing the computed state.
- **Live dry run, 2026-09-27**, run locally against the live ABS sources and release 000001: it proposed release 000002.
  - The record is `abs_cpi_all_groups_annual_change@2026-07#r1` = 3.5, fact-verified, cross-checked and plausible.
  - The watch is `published`, with `expectedBy` 2026-09-30 from the ABS page.
  - The release also validates for a consumer that has no bounds for the series.

## Timeline this makes possible

- **July 2026 (3.5%)** can be release 2 as soon as the parser ships.
- **August 2026 is due 30/09/2026**, so the run on 1 October publishes it as a
  new observation. That is Phase G's "one real update cycle", three days out.

## Consumer side (a RiskM8 session, after Daybook publishes)

RiskM8's production mapping is empty on purpose. Phase E adds one entry:
- series `abs_cpi_all_groups_annual_change`;
- target `bi_price_index`;
- publisher `Australian Bureau of Statistics`;
- jurisdiction `AU`;
- RiskM8's own bounds.

Then comes a network import of the real release, and Bob accepts the candidate
into `provenance.js` by a reviewed commit. The BI row then shows the dated note.
