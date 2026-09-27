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
