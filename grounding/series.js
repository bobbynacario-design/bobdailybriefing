'use strict';
// The series Daybook watches and publishes (docs/grounding-roadmap.md,
// sections 6 and 8). Each entry ships only after its feasibility row is done:
// an official source that allows automated reading (or manual capture), its
// terms and attribution, its schedule, freshness and bounds.
//
//   seriesId       lower_snake_case; stable forever, because consumers map it
//   title          plain name, as Daybook shows it
//   capture        'manual' (a reviewed file in grounding/manual/) or 'api' | 'csv' | 'rss' | 'page'
//   freshnessDays  after this many days without a new figure, the series is "stale"
//   bounds         { min, max, maxChange } plausibility bounds; a breach is held back
//   cadenceHours   how often an automated series is checked (manual files are read every run)
//   publisher, urls, licence, streams   the feasibility row, for the record
//   fetch          automated only:
//                  async ({ fetch, userAgent, now }) => ({ observations: [...], status })
//                  An observation is a fact record without its identity fields
//                  (recordId, revision, lifecycle, supersedes), which the
//                  producer assigns. status is optional:
//                  { state, detail, url, expectedBy }, for example "blocked"
//                  when a source refuses automated readers.
//
const absCpi = require('./sources/abs-cpi');
const fwoPayGuide = require('./sources/fwo-pay-guide');

module.exports = [
  // Phase E pilot, for RiskM8 (docs/grounding-phase-e.md, D-E1 to D-E4).
  {
    seriesId: absCpi.SERIES_ID,
    title: absCpi.TITLE,
    capture: 'page',
    publisher: absCpi.PUBLISHER,
    urls: { release: absCpi.LATEST_URL, crossCheck: absCpi.API_BASE },
    licence: absCpi.LICENCE,
    streams: ['sme_bi', 'risk_review'],
    // Monthly figures; 50 days covers the gap over Christmas. Overdue comes
    // from the ABS's own "Next Release" date, not from this.
    freshnessDays: 50,
    // Recent real moves between consecutive months were at most 1.1 points.
    bounds: { min: -3, max: 12, maxChange: 1.5 },
    // Checked on every daily run. Under 24 hours, so a scheduled run that
    // starts earlier than the day before (GitHub delays them by hours) is
    // not skipped as "not due".
    cadenceHours: 12,
    fetch: absCpi.fetchCpi,
  },
  // Phase F pilot, for BI-Assessor's ClaimBench (docs/grounding-phase-f.md).
  // The award lists "Traffic controller" at CW/ECW 2 (Schedule A, A.2.2); Bob
  // chose the civil construction full-time weekly-hire ordinary rate, the true
  // wage floor. The value is captured by hand from the FWO pay guide
  // (grounding/manual/fwo_ma000020_cw2_ordinary.json, with the guide itself
  // in grounding/manual/sources/); the pay guide is watched automatically.
  {
    seriesId: fwoPayGuide.SERIES_ID,
    title: fwoPayGuide.TITLE,
    capture: 'manual',
    publisher: fwoPayGuide.PUBLISHER,
    urls: { payGuide: fwoPayGuide.PAY_GUIDE_URL, award: 'https://awards.fairwork.gov.au/MA000020.html' },
    licence: fwoPayGuide.LICENCE,
    streams: ['tp_road', 'tp_utility'],
    // An annual figure (1 July to 30 June); the watch turns it stale as soon
    // as the FWO issues a different guide.
    freshnessDays: 400,
    // The same bounds as BI-Assessor's, so the FY27 figure passes both.
    bounds: { min: 25, max: 45, maxChange: 3 },
    cadenceHours: 12,
    fetch: fwoPayGuide.watchPayGuide,
  },
];
