# Sports forecast and digest checks

App-only Pages releases export the latest shared Sports document before building.
Missing pointers or invalid feeds fail the release instead of replacing current
data with the older committed public snapshot. This reads existing data without
running another forecast or changing the refresh schedule.

NBA and tennis journal entries require SCHEDULED status, a known start time
strictly after the observation, and valid probabilities. Tennis projections
are removed for live, started and undated matches. Opponents must still match
the saved forecast before scoring. Legacy tennis observations missing a start
time remain in the journal; a returned fixture can verify their timing later.
Unverified records are excluded from headline accuracy, with exclusion counts
shown. Failed journal reads/writes retain the previous lane instead of silently
resetting its forecast history.

NBA bookmaker observations stop at the scheduled tip time independently of
provider status. Each saved quote has its observation time; legacy quotes with
no verifiable timestamp are excluded from the matched Brier comparison. The
UI calls this the last observed pre-tip quote, never a verified closing line.
The model's original prediction remains fixed.

Combat uses market gameStartTime or event startTime. Contract expiry is not a
fight start. Chances cannot first be recorded or overwritten at/after start.
Winners require a closed market, UMA status resolved and exact 1/0 outcome
prices. Closed/proposed/disputed/99% outcomes remain pending. Confirmed 50/50
settlements appear as no-winner outcomes and are not scored; that settlement
alone does not establish whether the bout was drawn or cancelled. Previously
stored winners lacking confirmed settlement remain archived but are excluded
from results and accuracy until verified by a new source observation.

The digest dates each source using lastSuccessfulAt, falling back to generatedAt.
Retained, failed, expired, unknown or future-dated lanes supply no current
probabilities or model/bookmaker differences. A tennis LIVE label additionally
requires a successful check within 15 minutes. Older in-play snapshots are
grouped under last reported activity, with their checked time and saved score.
These twice-daily feeds do not supply continuous live coverage.

NBA probability buckets display Moderate/Strong lean, including legacy edge
tags. Model/bookmaker differences are labelled uncalibrated, with scored counts.
Fewer than 50 matched games show too few outcomes to assess reliability; larger
samples are still described as recorded comparisons rather than proof of an
edge. No extra model calls or refresh schedules are introduced.

Primary settlement reference: https://docs.polymarket.com/concepts/resolution
