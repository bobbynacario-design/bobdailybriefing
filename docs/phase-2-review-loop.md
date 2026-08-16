# Command Center review loop

The review loop adds a small process journal to the existing Command Center. It
uses the already signed-in `briefings-bob/command-prefs-<uid>` document and does
not make model or provider calls.

## Daily flow

The first Command Center load each PHT day captures that day's Morning 5. The
snapshot preserves the item ID, source, title, priority score, and Morning 5
rank. A queue item outside the Morning 5 is added when it is marked **Acted** or
dismissed.

Each tracked item has one explicit handling state:

- `pending` — not yet classified;
- `acted` — Bob took an action prompted by the item;
- `reviewed` — Bob considered it and deliberately took no action; or
- `ignored` — Bob did not review it, or dismissed it from the queue.

Closing the day's review converts every remaining `pending` item to `ignored`.
This prevents an incomplete review from being recorded as complete. Clicking an
active state again returns the item to `pending` and reopens a closed review.

## Rolling metrics

The weekly panel covers today and the previous six PHT dates:

- days closed versus days captured;
- review completion rate;
- percentage of Morning 5 items given a non-pending state;
- ignored and pending counts by source; and
- outcomes of closed Decision Journal entries that were explicitly marked
  `acted` in the Command Center.

Decision outcomes are shown as raw win, loss, scratch, and benchmark counts.
They are descriptive records with potentially small and selected samples. The
app does not call them forecast accuracy, calculate a predictive score, or infer
that prioritization caused an outcome.

## Storage bounds

Review history is normalized to the latest 35 PHT days and at most 20 compact
items per day. This keeps the preference document comfortably bounded. Existing
delivery device tokens and audit state remain server-managed and are not
included in client writes.
