# Saved evidence sets

Evidence sets turn useful Search results and Command Center priorities into
small, named working collections without separating them from their source.

## Saving evidence

- In unified Search, choose **+ Evidence** beside a result.
- In Command Center, choose **Save** on a Morning 5 or queue item.
- Pick an existing set or create a named set directly from the picker.

The saved record is a compact snapshot containing the item ID, source, title,
short detail, source metadata, original page/reference, and PHT capture time.
Saving the same source item twice to one set is rejected.

## Evidence workspace

The **Evidence** tab shows set and item totals, represented sources, and note
coverage. A set can be renamed, deleted, or populated from Search. Each item can
carry a 500-character user note and can reopen its authoritative source. Removal
and set deletion require confirmation in the app.

Briefing results retain the archive document key and are loaded on demand if
that briefing is outside the current History page. Research results similarly
reload the account report feed before opening when needed.

## Storage and isolation

Evidence lives under `evidenceSets` in the signed-in user's existing
`briefings-bob/command-prefs-<uid>` document. Dedicated merge writes do not
overwrite Command Center priorities, review history, delivery settings, or
server-managed delivery tokens.

The structure is normalized to at most 12 sets, 30 items per set, an 80-character
set name, compact source fields, and a 500-character note. Evidence state is
cleared from memory on sign-out.
