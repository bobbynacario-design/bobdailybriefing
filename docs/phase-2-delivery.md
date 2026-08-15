# Phase 2 Morning 5 delivery

Slice 2.3 delivers an optional Morning 5 through Firebase Cloud Messaging
(FCM). The scheduled function rebuilds the queue from Firestore with the same
deterministic Command Center core used by the browser. Delivery adds no LLM or
third-party messaging cost.

## User flow

1. Sign in and open **Command → Personal priority controls**.
2. Select **Enable on this device** and grant the browser notification prompt.
3. Choose PHT quiet hours and minimum delivery scores for each source.
4. Use **Send test** before relying on scheduled delivery.
5. Use **Mute delivery** in the app or the notification action at any time.

Notification permission is requested only from the explicit enable button. A
token is registered by the authenticated `registerBriefingDevice` callable and
stored in the user's `briefings-bob/command-prefs-<uid>` delivery state. The UI
never renders the token.

## Scheduling and deduplication

`deliverMorningFive` checks at 00 and 30 minutes from 06:00 through 11:30 PHT.
This window lets quiet hours delay rather than discard a morning delivery. A
digest is sent only when at least one Morning 5 item clears its source threshold
and the ordered item IDs, urgency, or score bands materially differ from the
last successful delivery. Failed or stale feed-health items remain eligible
regardless of ordinary source thresholds.

The last signature, last successful timestamp, up to five device tokens, and 20
recent sent/test/failed audit records live under the server-managed
`deliveryState` map. Invalid or expired FCM tokens are removed after a send.

## Firebase prerequisites

- Cloud Messaging must be enabled for project `pokerhq-a67e4`.
- A non-default Web Push certificate was generated on 2026-08-16 in **Firebase
  Console → Project settings → Cloud Messaging → Web Push certificates**. Only
  its public VAPID key belongs in the web client; never commit the private key.
- Deploy the complete Functions codebase so `registerBriefingDevice`,
  `testBriefingDelivery`, and `deliverMorningFive` are updated together.

The Firebase JavaScript SDK can fall back to its default VAPID key, but a
project-specific public key is required for consistent Chrome Push Service
support and is the production configuration.

## Verification

```powershell
npm --prefix functions test
npm run check:app
npm test
npm --prefix functions run deploy
```

After Pages and Functions deploy:

1. Hard-refresh the installed app so service-worker cache v40 is active.
2. Enable delivery and send a test while the app is in the background.
3. Confirm the notification opens `#command` and its mute action updates the
   signed-in preference.
4. Confirm a new `test` audit row appears and no raw token is rendered.
5. Inspect the scheduled function logs after the next morning window; unchanged
   signatures should not generate repeat notifications.

## Rollback

- Mute delivery from the app to stop sends while retaining device registration.
- Disable or delete the `deliverMorningFive` scheduled function for a global
  stop. The application remains usable because delivery is optional.
- Revert the Pages build to remove browser registration controls. Existing
  tokens are inert while the delivery preference or scheduler is disabled.
