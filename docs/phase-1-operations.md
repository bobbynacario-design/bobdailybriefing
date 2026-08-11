# Phase 1 operations handoff

Phase 1 moves refresh execution away from a sleeping laptop, makes multi-document
writes atomic, and uses verified OpenAI webhooks as the primary deep-research
completion path. Local scripts remain available for dry runs and recovery.

## Repository checks

```powershell
npm run install:all
npm test
npm run audit
```

The root test command covers shared libraries, Cloud Function result handling,
Radar, Markets, Sports, and static application smoke checks. CI runs the same
commands on pushes and pull requests.

## Required GitHub configuration

Add these Actions secrets:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `APCA_API_KEY_ID`
- `APCA_API_SECRET_KEY`
- `OPENAI_API_KEY`
- `FOOTBALL_DATA_TOKEN` (only needed for the archived World Cup lane)

Optional Actions variables configure watchlists:

- `SPORTS_FOLLOW_TEAMS`
- `NBA_FOLLOW_TEAMS`
- `NBA_FOLLOW_PLAYERS`
- `PBA_FOLLOW_TEAMS`

The service account should have only the Firestore permissions required by the
refresh documents. Do not use a project-owner key.

Enable GitHub Pages with **GitHub Actions** as its source before enabling the
scheduled sports workflow. The workflow publishes an artifact and no longer
commits `sports-public.json` refreshes directly to `main`.

## OpenAI webhook activation

1. Set the Firebase secrets `OPENAI_API_KEY` and `OPENAI_WEBHOOK_SECRET`.
2. Deploy the complete `bobdailybriefing` functions codebase with
   `npm --prefix functions run deploy`.
3. In the OpenAI project webhook settings, add the deployed `openaiWebhook` URL.
4. Subscribe to response completion and terminal response events.
5. Send a dashboard test event and confirm an `openai-webhook-events` document
   reaches `processed` or `ignored`.

The HTTP endpoint validates the signature against the raw request body, stores a
deduplicated queue item keyed by `webhook-id`, and returns quickly. A retryable
Firestore trigger retrieves and finalizes the report. `pollDeepResearchReports`
runs every 15 minutes solely to recover missed events or interrupted processing.

## Production cutover

1. Run each workflow manually and verify `feed-health` plus its latest pointer.
2. Confirm the public sports page was deployed from the Pages artifact.
3. Disable the matching Windows scheduled tasks only after two successful cloud
   runs for each feed.
4. Retain local scripts for explicit recovery; local Sports publishing now
   requires `-PublishLegacy` and should normally remain off.

## Rollback

- Re-enable the Windows tasks if a managed workflow is unhealthy.
- The webhook and recovery poller can coexist safely because report finalization
  is transactional and only changes reports still in `generating` state.
- Reverting Pages to branch publishing restores the old static deployment, but
  also restores generated-data commits and is not recommended long term.
