'use strict';
// ATO Small Business Benchmarks: a REVIEWED-YEAR REMINDER, watch only
// (docs/grounding-phase-h.md, H-3; Bob's decision D-H3-1, option A).
//
// Both consumers cite the ATO's benchmark pages by hand: RiskM8 43 industries,
// BI-Assessor's ClaimBench 16 of them. The ATO releases a new benchmark year
// each March. Daybook cannot read either official source automatically:
// ato.gov.au refuses automated readers (HTTP 403), and data.gov.au's robots.txt
// disallows every agent. So this reads nothing. It records the benchmark year a
// person last reviewed, and turns stale once that release is more than a year
// old, which is when the next year is normally out:
//   - within STALE_AFTER_DAYS of the reviewed release: "published";
//   - after it: "stale", asking for the check and a new review.
// No expected date is published (G8): the ATO does not state one.

const SERIES_ID = 'ato_small_business_benchmarks_year';
const TITLE = 'ATO Small Business Benchmarks: the benchmark year last reviewed';
const PUBLISHER = 'Australian Taxation Office';
const BENCHMARKS_URL = 'https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/small-business-benchmarks';
const DATASET_URL = 'https://data.gov.au/data/dataset/small-business-benchmarks';
const LICENCE = 'CC BY 2.5 AU (the ATO\'s Small Business Benchmarks dataset on data.gov.au). Only the benchmark year and its release date are published.';
// The ATO released 2021-22 on 2024-03-13, 2022-23 on 2025-03-16 and 2023-24 on
// 2026-03-15. A year and two weeks leaves room for a mid-March release.
const STALE_AFTER_DAYS = 380;

// The last benchmark year a person checked, from the dataset's own history.
// When the reminder turns stale: see whether the next year is out, re-check the
// industries both apps cite, then record the new review here (one commit).
const REVIEWED = Object.freeze({
  benchmarkYear: '2023-24',
  releasedOn: '2026-03-15',
  reviewedOn: '2026-09-28',
});

const daysSince = (isoDate, nowIso) => Math.floor((Date.parse(nowIso) - Date.parse(isoDate + 'T00:00:00Z')) / 86400000);

// The registry's fetch: ({ now }) -> { observations: [], status }. It makes no
// request: ctx.fetch is never called.
async function watchSbb(ctx) {
  const age = daysSince(REVIEWED.releasedOn, ctx.now);
  if (!(age >= 0)) throw new Error('the reviewed release date ' + REVIEWED.releasedOn + ' is after now');
  if (age <= STALE_AFTER_DAYS) {
    return { observations: [], status: { state: 'published', url: BENCHMARKS_URL,
      detail: 'Reviewed ' + REVIEWED.reviewedOn + ': the ' + REVIEWED.benchmarkYear + ' benchmarks, released by the ATO on ' + REVIEWED.releasedOn +
        '. A reminder, not a watch: the ATO and data.gov.au refuse automated readers, so Daybook turns this stale a year after the release.' } };
  }
  return { observations: [], status: { state: 'stale', url: BENCHMARKS_URL,
    detail: 'The benchmark review is over a year old: ' + REVIEWED.benchmarkYear + ', released ' + REVIEWED.releasedOn +
      '. The ATO has released each new year in March since 2024. Check whether a newer year is out, re-check the industries RiskM8 and BI-Assessor cite, and record the review in grounding/sources/ato-sbb.js.' } };
}

module.exports = { SERIES_ID, TITLE, PUBLISHER, BENCHMARKS_URL, DATASET_URL, LICENCE, STALE_AFTER_DAYS, REVIEWED, watchSbb };
