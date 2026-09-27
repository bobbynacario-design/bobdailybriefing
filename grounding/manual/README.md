# Manual captures

A figure published once a year in a PDF or Word guide (an award rate, a gazetted
fee) is captured here by hand, in a reviewed file, rather than parsed
automatically. See docs/grounding-roadmap.md, section 6.

- **One file per series:** `<seriesId>.json`, holding one observation or an
  array of them. The series must first be registered in `grounding/series.js`,
  with its bounds, freshness and source terms.
- **An observation is a fact record without its identity fields.** Leave out
  `recordId`, `revision`, `lifecycle` and `supersedes`; the publisher assigns
  them.
- **What each observation needs:**
  - the value (or a range);
  - `valueBindings`, whose token must appear exactly in the quote;
  - the verbatim quote;
  - a locator (page and table);
  - the URL;
  - `contentSha256`: the SHA-256 of the downloaded PDF or Word file;
  - `retrievedAt`: when you downloaded it;
  - `captureMethod: "manual"`.
- **The publisher checks every file** with the same validator the consumers run.
  An invalid or implausible figure is held back, and the series' watch record
  says why.
- **Corrections:** edit the value and quote in place. The publisher sees the
  change, publishes a new revision marked "corrected", and keeps the old one as
  history.
- **Git history is the audit trail.** Commit each capture with the source it
  came from.
- **Keep the source file in `sources/`** when the publisher only serves its
  current edition (the FWO pay guides do: last year's could not be downloaded
  in September 2026). Name it after what it is, and check that the capture's
  `contentSha256` is its digest; the series' tests do. Keep the source's
  licence: FWO pay guides are © Fair Work Ombudsman www.fairwork.gov.au,
  CC BY-NC 4.0, and are kept here for non-commercial audit only.

## Captures

| File | Source | Value |
|---|---|---|
| `fwo_ma000020_cw2_ordinary.json` | FWO pay guide MA000020, effective 01/07/2026, published 02/07/2026 (`sources/fwo-ma000020-pay-guide-effective-2026-07-01-G00203138.pdf`), page 71, Weekly hire - full-time and part-time - Civil construction, Level 2 (CW/ECW 2), Hourly pay rate | $30.39/hour, FY2026-27 |
