// lib/feed-health.js
//
// Shared run-health recorder for the local refresh scripts (radar, ph, miro,
// sports). The only I/O is a merge-write on the single doc
// briefings-bob/feed-health, which the app reads to render its freshness strip.
//
// WHY this exists: on 2026-07-27 the radar had been silently missing roughly one
// day in four for a month — the machine was asleep at 06:00, or the catch-up run
// fired before Wi-Fi was up and died on the first fetch. Nothing surfaced that.
// Diagnosing it needed a 990 KB append-only log plus the Windows power-event log.
// A feed that stops updating must be visible IN THE APP, with its cause.
//
// Shape:
//   { updated, feeds: { <feed>: {
//       lastRunAt,   // the script ran and reached a recorded outcome
//       lastOkAt,    // last run that finished without error (ok OR skipped)
//       status,      // 'ok' | 'skipped' | 'failed'
//       asOf,        // data date the run produced/confirmed
//       durationMs,
//       stage,       // on failure: which step died ('fetch-bars', 'write', ...)
//       message      // short error text, never a stack
//   } } }
//
// Each script merge-writes ONLY its own key, so concurrent runs never clobber
// each other and fields that are not sent (notably lastOkAt on a failed run)
// survive untouched.
//
// A run killed outright — machine asleep, process hard-killed — writes nothing
// at all. That is intentional and is the point: the app treats a stale
// lastRunAt as "this never ran", which is a different failure from "it ran and
// broke". Only handled outcomes are recorded.
//
// Telemetry must NEVER break a feature, so every function here swallows errors.
//
// ESM module — imported by the refresh scripts via `../lib/feed-health.js`.

var HEALTH_DOC = 'feed-health';

// Record one feed's run outcome. No-throw.
//   feed  — 'radar' | 'ph' | 'miro' | 'sports'
//   rec   — { status, asOf, durationMs, stage, message }
async function recordRunHealth(db, feed, rec) {
  try {
    if (!db || !feed) return;
    rec = rec || {};
    var now = new Date().toISOString();
    var status = rec.status || 'ok';
    var entry = {
      lastRunAt: now,
      status: status,
      stage: rec.stage || null,
      message: String(rec.message || '').slice(0, 300)
    };
    // 'skipped' means the run found today's data already written — the feed is
    // healthy, so it counts as OK for freshness purposes.
    if (status !== 'failed') entry.lastOkAt = now;
    if (rec.asOf) entry.asOf = String(rec.asOf);
    if (rec.durationMs != null && isFinite(rec.durationMs)) {
      entry.durationMs = Math.round(rec.durationMs);
    }
    var feeds = {};
    feeds[feed] = entry;
    await db.collection('briefings-bob').doc(HEALTH_DOC)
      .set({ updated: now, feeds: feeds }, { merge: true });
    console.log('feed-health: ' + feed + ' = ' + status +
      (entry.asOf ? ' (asOf ' + entry.asOf + ')' : '') +
      (entry.stage ? ' at ' + entry.stage : ''));
  } catch (e) {
    console.log('recordRunHealth failed (' + (e.message || e) + ') — health not recorded.');
  }
}

// Tiny helper so a script can track which step it is on and report that step
// when it dies. Usage: var stage = makeStage(); stage.set('fetch-bars'); ...
// then on failure pass stage.get() as rec.stage.
function makeStage(initial) {
  var current = initial || 'start';
  return {
    set: function (s) { current = s; return s; },
    get: function () { return current; }
  };
}

export { recordRunHealth, makeStage };
