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
// Phase F adds the FY27 traffic-controller award (captured by hand, with an
// automated watch on its pay guide).
const absCpi = require('./sources/abs-cpi');

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
];
