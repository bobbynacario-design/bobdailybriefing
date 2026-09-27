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
//   fetch          automated only:
//                  async ({ fetch, userAgent, now }) => ({ observations: [...], status })
//                  An observation is a fact record without its identity fields
//                  (recordId, revision, lifecycle, supersedes), which the
//                  producer assigns. status is optional:
//                  { state, detail, url, expectedBy }, for example "blocked"
//                  when a source refuses automated readers.
//
// Empty until the pilots: Phase E adds ABS CPI, and Phase F the FY27 traffic-
// controller award (captured by hand, with an automated watch on its pay guide).
module.exports = [];
