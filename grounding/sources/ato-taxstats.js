'use strict';
// ATO Taxation Statistics, the industry benchmarks edition: a REVIEWED-EDITION
// REMINDER, watch only (docs/grounding-phase-h.md, H-4). Same approach Bob
// chose for the small business benchmarks (H-3, D-H3-1 option A).
//
// RiskM8's ungrounded-path gross-profit table (261 ANZSIC classes) and its
// turnover-banded rates come from Taxation Statistics 2020-21's company
// industry benchmarks. The ATO publishes a new edition each June (2022-23 on
// 2025-06-27, 2023-24 on 2026-06-17), with the same layout: company ratios by
// fine industry and business industry code, by business status and business
// income range. ato.gov.au refuses automated readers and data.gov.au's
// robots.txt disallows every agent, so this reads nothing. It records the
// edition a person last reviewed and turns stale once that release is more
// than a year old:
//   - within STALE_AFTER_DAYS of the reviewed release: "published";
//   - after it: "stale", asking for the check and a new review.
// No expected date is published (G8).

const SERIES_ID = 'ato_taxation_statistics_edition';
const TITLE = 'ATO Taxation Statistics: the industry benchmarks edition last reviewed';
const PUBLISHER = 'Australian Taxation Office';
const EDITIONS_URL = 'https://www.ato.gov.au/about-ato/research-and-statistics/in-detail/taxation-statistics';
const LICENCE = 'CC BY 2.5 AU (ATO Taxation Statistics). Only the edition and its release date are published.';
const STALE_AFTER_DAYS = 380;

// The last edition a person checked: its industry benchmarks page, read in a
// browser. When the reminder turns stale: see whether the next edition is out
// and keeps the same company industry benchmarks, tell RiskM8 (it regenerates
// its tables from them), then record the new review here (one commit).
const REVIEWED = Object.freeze({
  edition: '2023-24',
  releasedOn: '2026-06-17',
  reviewedOn: '2026-09-28',
  finding: 'Company industry benchmarks by fine industry and business industry code, by business status and business income range, with average and median ratios; gross profit ratio = (total business income - cost of sales) / total business income.',
});

const daysSince = (isoDate, nowIso) => Math.floor((Date.parse(nowIso) - Date.parse(isoDate + 'T00:00:00Z')) / 86400000);

// The registry's fetch: ({ now }) -> { observations: [], status }. It makes no
// request: ctx.fetch is never called.
async function watchTaxStats(ctx) {
  const age = daysSince(REVIEWED.releasedOn, ctx.now);
  if (!(age >= 0)) throw new Error('the reviewed release date ' + REVIEWED.releasedOn + ' is after now');
  if (age <= STALE_AFTER_DAYS) {
    return { observations: [], status: { state: 'published', url: EDITIONS_URL,
      detail: 'Reviewed ' + REVIEWED.reviewedOn + ': Taxation Statistics ' + REVIEWED.edition + ', released ' + REVIEWED.releasedOn + '. ' + REVIEWED.finding +
        ' A reminder, not a watch: the ATO and data.gov.au refuse automated readers.' } };
  }
  return { observations: [], status: { state: 'stale', url: EDITIONS_URL,
    detail: 'The Taxation Statistics review is over a year old: ' + REVIEWED.edition + ', released ' + REVIEWED.releasedOn +
      '. The ATO has published each edition in June. Check whether a newer one is out with the same company industry benchmarks, tell RiskM8, and record the review in grounding/sources/ato-taxstats.js.' } };
}

module.exports = { SERIES_ID, TITLE, PUBLISHER, EDITIONS_URL, LICENCE, STALE_AFTER_DAYS, REVIEWED, watchTaxStats };
