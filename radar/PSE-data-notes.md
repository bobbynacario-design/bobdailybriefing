# PSE data reliability

Price bars dated today are excluded before 15:45 Manila time; future bars are
always excluded. This covers the index, board, radar inputs and non-index watch
rows. Index and stock session dates are displayed separately. Breadth and its
near-high/low lists use only rows from the newest completed stock session;
older rows remain visible with their own dates.

Dividend deadlines use PSE's public annual holiday table at
https://www.pse.com.ph/investing-at-pse/ and dated non-trading announcements.
The annual table omits separately proclaimed Eid dates. The reviewed 2026
supplements are March 20 (PSE announcement archive) and May 27 (circular
CN-2026-0023); their source URLs are stored with the calendar. Renew these
supplements for future years unless both Eid holidays are included in the
annual table. Incomplete feeds, missing calendars and uncovered years suppress
deadline alerts in Markets and the morning push. Ex-dates and other alerts
remain available. There is no weekday-only fallback.

Gross trailing dividend yield is declared common-share cash with ex-dates in
the preceding 365 days divided by that row's completed closing price, before
tax. It includes specials, does not annualize them, and is not a forecast.
Breakdowns preserve explicit regular/special classifications; unstated types
remain unconfirmed. Missing amounts or a truncated history mark the result as
a lower bound. Legacy snapshots show unverified history until refreshed.

The public holiday feed adds three HTTP requests per PSE refresh and no model
calls. Website, morning-push functions and the next PSE refresh must all receive
these changes before the full rollout is visible.
