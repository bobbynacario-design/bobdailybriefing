# Unified intelligence search

Unified search is a browser-built retrieval index over data already available to
the signed-in app. Open it with the navigation **Search** button, `Ctrl+K`, or
`Cmd+K`.

## Coverage

The index is loaded only on first use in a signed-in session and includes:

- up to 100 archived daily briefings, indexed story by story;
- up to 50 research reports, including stored Markdown or HTML text;
- up to 100 Decision Journal entries;
- the latest Radar signals and Markets snapshot; and
- current Sports fixtures plus rising, watch, and fading teams.

Results require every meaningful query token to match. Exact and prefix title
matches rank first, followed by title, summary, and body matches with a small
recency tie-breaker. Diacritics do not prevent a match.

## Privacy and cost

Firestore still supplies the account-owned records under the existing rules.
After loading, the search query and ranking stay in the browser. Search makes no
OpenAI call and creates no search-history document. The index and cached report
feed are cleared from memory on sign-out.

## Navigation

Use Up/Down to select a result, Enter to open it, and Escape to close. Briefing
results load the archived briefing; research results open the report reader;
other results switch to their authoritative source tab.
