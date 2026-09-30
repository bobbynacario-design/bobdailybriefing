# Manual captures

A figure published once a year in a PDF or Word guide (an award rate, a gazetted
fee) is captured here by hand, in a reviewed file, rather than parsed
automatically. See docs/grounding-roadmap.md, section 6.

- **One file per series:** `<seriesId>.json`, holding one observation or an
  array of them. The series must first be registered in `grounding/series.js`,
  with its bounds, freshness and source terms.
- **An earlier period can be added later.** A period older than the series'
  latest, never published before, is published as its own current record: it
  supersedes nothing, and the newer record stays as it is. Only a manual capture
  can do this; an automated source's older period is refused.
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
  current edition. Name it after what it is, and check that the capture's
  `contentSha256` is its digest; the series' tests do. Keep the source's
  licence: FWO pay guides are © Fair Work Ombudsman www.fairwork.gov.au,
  CC BY-NC 4.0, and are kept here for non-commercial audit only.
- **A past edition from the Internet Archive.** The FWO serves only the current
  pay guide, so last year's could not be downloaded from it in September 2026.
  It was retrieved from the Internet Archive's capture of the FWO's own download
  URL, in the unmodified `id_` form. The evidence says so, because the contract
  has no field for the route:
  - `url` is the Archive capture, which serves exactly the bytes the SHA-256
    covers and contains the FWO URL;
  - `title` is the guide's own, with "(Internet Archive copy of the FWO
    download, captured <date>)" added;
  - `publisher` stays "Fair Work Ombudsman", which wrote the guide (ClaimBench
    accepts no other), and `licence` is the FWO's attribution.

## Captures

| File | Source | Value |
|---|---|---|
| `vic_atsa_accident_tow_base_fee.json` | Victoria Government Gazette, Special Gazette S257 (22 May 2026), clause 6, page 2. Not kept here: the gazette is not openly licensed (D-H2); its SHA-256 and permanent URL are in the capture | $289.60 per tow, 2026-27, incl GST |
| `vic_atsa_storage_motor_car_daily.json` | Same notice, clauses 9.1 and 9.3, page 3 | $22.20–$32.80 per day, 2026-27, incl GST |
| `fwo_ma000020_cw2_ordinary.json` (FY27) | FWO pay guide MA000020, effective 01/07/2026, published 02/07/2026 (`sources/fwo-ma000020-pay-guide-effective-2026-07-01-G00203138.pdf`), page 71, Weekly hire - full-time and part-time - Civil construction, Level 2 (CW/ECW 2), Hourly pay rate | $30.39/hour, FY2026-27 |
| `fwo_ma000020_cw2_ordinary.json` (FY26) | FWO pay guide MA000020, effective 01/07/2025, published 17/07/2025, from the Internet Archive's capture of 23/11/2025 (`sources/fwo-ma000020-pay-guide-effective-2025-07-01-G00202880.pdf`), page 83, the same table, row and column | $29.01/hour, FY2025-26 |
| `sapn_quoted_labour_field_worker_ordinary.json` | SA Power Networks, Manual 18: Connections & Ancillary Network Services 2026-27 (v1.2, last modified 24 July 2026), Appendix D, Table 3, printed page 30 (PDF page 31), row FW Field Worker, column Ordinary Time, 2026/27 (GST Exclusive). Not kept here: the manual is "All rights reserved" (D-H7-6); its SHA-256 and download URL are in the capture | $198.12/hour, 2026-27, excl GST |
| `sapn_quoted_labour_field_worker_overtime.json` | Same table and row, column Overtime, 2026/27 (GST Exclusive) | $323.05/hour, 2026-27, excl GST |
