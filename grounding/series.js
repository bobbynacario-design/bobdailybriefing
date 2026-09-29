'use strict';
// The series Daybook watches and publishes (docs/grounding-roadmap.md,
// sections 6 and 8). Each entry ships only after its feasibility row is done:
// an official source that allows automated reading (or manual capture), its
// terms and attribution, its schedule, freshness and bounds.
//
//   seriesId       lower_snake_case; stable forever, because consumers map it
//   title          plain name, as Daybook shows it
//   capture        'manual' (a reviewed file in grounding/manual/), 'api' | 'csv' | 'rss' | 'page',
//                  or 'watch' (a watch state only; the series never publishes a fact)
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
const nswTow = require('./sources/nsw-tow-fees');
const vicTow = require('./sources/vic-gazette-towing');
const sg = require('./sources/sg-legislation');
const sbb = require('./sources/ato-sbb');
const taxStats = require('./sources/ato-taxstats');
const rbaCash = require('./sources/rba-cash-rate');
const absWpi = require('./sources/abs-wpi');

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
  // Phase H, H-1 (docs/grounding-phase-h.md), for ClaimBench: NSW regulated
  // light-vehicle tow and storage fees, read from the NSW Government page each
  // day (Bob's D-H1: publish now). Ex GST, which the qualifications say.
  {
    seriesId: nswTow.TOW.seriesId,
    title: nswTow.TOW.title,
    capture: 'page',
    publisher: nswTow.PUBLISHER,
    urls: { page: nswTow.PAGE_URL },
    licence: nswTow.LICENCE,
    streams: ['tp_road', 'tp_utility'],
    // An annual schedule (1 July); the page states no next date.
    freshnessDays: 400,
    bounds: { min: 200, max: 500, maxChange: 60 },
    cadenceHours: 12,
    fetch: nswTow.fetchTow,
  },
  {
    seriesId: nswTow.STORAGE.seriesId,
    title: nswTow.STORAGE.title,
    capture: 'page',
    publisher: nswTow.PUBLISHER,
    urls: { page: nswTow.PAGE_URL },
    licence: nswTow.LICENCE,
    streams: ['tp_road', 'tp_utility'],
    freshnessDays: 400,
    // A range (outside to inside Sydney metro): each end is checked against
    // min and max; max change applies to point values only.
    bounds: { min: 10, max: 60, maxChange: 10 },
    cadenceHours: 12,
    fetch: nswTow.fetchStorage,
  },
  // Phase H, H-1, for ClaimBench: VIC regulated accident towing and storage
  // fees, captured by hand from the section 212H gazette notice (for 2026-27,
  // Special Gazette S257) with an automated watch on the gazette's search.
  // GST inclusive. The gazette is not openly licensed: short quotes only, no
  // copy of the notice kept (Bob's D-H2).
  {
    seriesId: vicTow.TOW.seriesId,
    title: vicTow.TOW.title,
    capture: 'manual',
    publisher: vicTow.PUBLISHER,
    urls: { search: vicTow.SEARCH_URL, notice2026: 'https://www.gazette.vic.gov.au/gazette/Gazettes2026/GG2026S257.pdf' },
    licence: vicTow.licenceFor('https://www.gazette.vic.gov.au/gazette/Gazettes2026/GG2026S257.pdf'),
    streams: ['tp_road', 'tp_utility'],
    // The notice appears each May or June, effective 1 July.
    freshnessDays: 400,
    bounds: { min: 200, max: 400, maxChange: 40 },
    cadenceHours: 12,
    fetch: vicTow.watchTow,
  },
  {
    seriesId: vicTow.STORAGE.seriesId,
    title: vicTow.STORAGE.title,
    capture: 'manual',
    publisher: vicTow.PUBLISHER,
    urls: { search: vicTow.SEARCH_URL, notice2026: 'https://www.gazette.vic.gov.au/gazette/Gazettes2026/GG2026S257.pdf' },
    licence: vicTow.licenceFor('https://www.gazette.vic.gov.au/gazette/Gazettes2026/GG2026S257.pdf'),
    streams: ['tp_road', 'tp_utility'],
    freshnessDays: 400,
    bounds: { min: 10, max: 60, maxChange: 8 },
    cadenceHours: 12,
    fetch: vicTow.watchStorage,
  },
  // Phase H, H-2: the Superannuation Guarantee charge percentage, watch only
  // (roadmap: "Legislated at 12%; watch for change"). BI-Assessor's wages
  // method holds the rate in code; this tells Bob when the Act changes. It
  // reads the Federal Register's API: the ATO refuses automated readers.
  {
    seriesId: sg.SERIES_ID,
    title: sg.TITLE,
    capture: 'watch',
    publisher: sg.PUBLISHER,
    urls: { api: sg.API_URL, text: sg.TEXT_URL },
    licence: sg.LICENCE,
    streams: ['sme_bi'],
    cadenceHours: 12,
    fetch: sg.watchSg,
  },
  // Phase H, H-3: the ATO Small Business Benchmarks, a reviewed-year reminder
  // (Bob's D-H3-1, option A). Neither the ATO nor data.gov.au allows
  // automated reading, so it reads nothing and turns stale a year after the
  // reviewed release, when both apps' 43 cited industries need checking.
  {
    seriesId: sbb.SERIES_ID,
    title: sbb.TITLE,
    capture: 'watch',
    publisher: sbb.PUBLISHER,
    urls: { benchmarks: sbb.BENCHMARKS_URL, dataset: sbb.DATASET_URL },
    licence: sbb.LICENCE,
    streams: ['sme_bi', 'risk_review'],
    cadenceHours: 12,
    fetch: sbb.watchSbb,
  },
  // Phase H, H-4: ATO Taxation Statistics, a reviewed-edition reminder like
  // H-3. RiskM8's GP table and turnover bands come from the 2020-21 edition's
  // company industry benchmarks; each June edition has the same layout.
  {
    seriesId: taxStats.SERIES_ID,
    title: taxStats.TITLE,
    capture: 'watch',
    publisher: taxStats.PUBLISHER,
    urls: { editions: taxStats.EDITIONS_URL },
    licence: taxStats.LICENCE,
    streams: ['risk_review', 'sme_bi'],
    cadenceHours: 12,
    fetch: taxStats.watchTaxStats,
  },
  // Phase H, H-5: the RBA cash rate target (D-H5-1 to D-H5-4), for Daybook
  // only until a consumer maps it (ClaimBench has no interest metric). One
  // observation per Monetary Policy Board decision, holds included.
  {
    seriesId: rbaCash.SERIES_ID,
    title: rbaCash.TITLE,
    capture: 'page',
    publisher: rbaCash.PUBLISHER,
    urls: { table: rbaCash.CASH_RATE_URL, schedule: rbaCash.SCHEDULE_URL },
    licence: rbaCash.licence('[year]'),
    streams: ['sme_bi', 'risk_review'],
    // Eight scheduled decisions a year; the longest gap (December to February)
    // is about 63 days. Overdue comes from the RBA's own schedule, not this.
    freshnessDays: 75,
    // Since 1996 the target has been 0.10 to 7.25; the largest single move
    // since 1990 was -1.00 (October 2008).
    bounds: { min: 0, max: 10, maxChange: 1 },
    cadenceHours: 12,
    fetch: rbaCash.fetchCashRate,
  },
  // Phase H, H-6: the ABS Wage Price Index, annual change (D-H6-1 to D-H6-4),
  // for Daybook only until a consumer maps it. Three series from one quarterly
  // release: the headline (seasonally adjusted), and Construction and
  // Electricity, gas, water and waste services (original), for labour-rate
  // questions. The page and the Data API are read once per run for all three.
].concat(absWpi.SERIES.map((s) => ({
  seriesId: s.seriesId,
  title: s.title,
  capture: 'page',
  publisher: absWpi.PUBLISHER,
  urls: { release: absWpi.LATEST_URL, crossCheck: absWpi.API_BASE },
  licence: absWpi.licence('<quarter>'),
  streams: s.industry === 'TOT' ? ['sme_bi', 'risk_review'] : s.industry === 'E' ? ['tp_road', 'tp_utility'] : ['tp_utility'],
  // Quarterly. Overdue comes from the ABS's own "Next Release" date; this only
  // catches a series that has stopped altogether.
  freshnessDays: 110,
  // Since 1998 the three have run from 0.8 to 6.5; the largest move between
  // quarters was 2.1 points (Electricity etc., 2007).
  bounds: { min: -2, max: 10, maxChange: 2.5 },
  cadenceHours: 12,
  fetch: absWpi.fetchFor(s),
})));
