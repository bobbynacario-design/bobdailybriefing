// radar/taker-record.js
//
// The Taker picks' own record (28 Nov 2026). The Money line on Today shows
// Radar's Taker picks, and nothing measured them: the forecast journal scores
// the forecast panel's probabilities, and radar-journal re-scores history. This
// scores every published Taker pick forward, exactly as the forecasts are
// scored (forecast-journal.js): from the first completed close after the day
// the pick was published to ten matched sessions later, against the benchmark
// the pick was judged against. No trading costs. Display only: it never feeds
// the score, the status or the picks.
//
// Stored in briefings-bob/radar-taker-record (no uid, like the other Radar
// docs). One entry per pick, a few hundred bytes each; at two picks a run and
// three runs a week that is well under 100 KB a year.
import { HORIZON, completedThrough, pairedBars, effectiveSample } from './forecast-journal.js';

const RECORD_DOC = 'radar-taker-record';
// The whole list on the same runs (28 Nov 2026): every name that was not
// Invalidated, scored the same way, so the card can say whether picking the
// top names has added anything over the list itself. On replay the average
// listed name (53% beat their benchmark, -0.3 points) had done better than the
// Taker picks (38%, -2.8). About eleven names a run, so entries are kept
// compact and only for two years (well under Firestore's 1 MB a document).
const LIST_DOC = 'radar-list-record';
const LIST_KEEP_DAYS = 730;
const UNAVAILABLE_AFTER_DAYS = 60;
const RECENT = 12;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function pickKey(symbol, dateKey) { return symbol + '|' + dateKey; }

// One Radar run's Taker picks as pending entries. A pick whose benchmark the
// run does not name cannot be scored, so it is left out.
function picksFromRun(doc, dateKey) {
  if (!doc || !DAY.test(String(dateKey || '')) || !doc.picks || !Array.isArray(doc.picks.taker)) return [];
  const signals = Array.isArray(doc.signals) ? doc.signals : [];
  return doc.picks.taker.map((symbol) => {
    const s = signals.find((x) => x && x.symbol === symbol) || {};
    if (!symbol || !s.benchmark) return null;
    return {key: pickKey(symbol, dateKey), symbol, benchmark: s.benchmark, theme: s.theme || null, dateKey,
      generatedAt: doc.generatedAt || dateKey + 'T00:00:00.000Z', score: Number.isFinite(s.score) ? s.score : null, status: 'pending'};
  }).filter(Boolean);
}

// Every listed name on a run that made Taker picks (the same runs the picks
// come from), as compact pending entries.
function listFromRun(doc, dateKey) {
  if (!doc || !DAY.test(String(dateKey || '')) || !doc.picks || !Array.isArray(doc.picks.taker) || !doc.picks.taker.length) return [];
  return (Array.isArray(doc.signals) ? doc.signals : []).filter((s) => s && s.symbol && s.benchmark && s.symbol !== s.benchmark && s.status !== 'invalidated')
    .map((s) => ({key: pickKey(s.symbol, dateKey), symbol: s.symbol, benchmark: s.benchmark, dateKey,
      generatedAt: doc.generatedAt || dateKey + 'T00:00:00.000Z', status: 'pending'}));
}

// Returns a new object; a stored entry is never edited in place. The start is
// a close after the day the pick was published, never one already known then.
function resolvePick(entry, bars, now) {
  if (entry.status !== 'pending') return entry;
  const pairs = pairedBars(bars, entry.symbol, entry.benchmark)
    .filter((b) => b.date > entry.generatedAt.slice(0, 10) && b.date <= completedThrough(now, entry.benchmark));
  if (pairs.length >= HORIZON + 1) {
    const start = pairs[0], end = pairs[HORIZON];
    const excess = (end.asset / start.asset - end.benchmark / start.benchmark) * 100;
    return {...entry, status: 'resolved', result: {start: start.date, end: end.date, excessReturn: Math.round(excess * 100) / 100}};
  }
  // Missing data cannot become a loss or a win.
  if (Date.parse(now) - Date.parse(entry.generatedAt) > UNAVAILABLE_AFTER_DAYS * 86400000) return {...entry, status: 'unavailable'};
  return entry;
}

function takerStats(entries) {
  const resolved = entries.filter((e) => e.status === 'resolved' && e.result);
  const excess = resolved.map((e) => e.result.excessReturn).sort((a, b) => a - b);
  const mean = excess.length ? excess.reduce((a, b) => a + b, 0) / excess.length : null;
  const median = excess.length ? (excess.length % 2 ? excess[(excess.length - 1) / 2] : (excess[excess.length / 2 - 1] + excess[excess.length / 2]) / 2) : null;
  const round = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const days = entries.map((e) => e.dateKey).filter(Boolean).sort();
  return {
    picks: entries.length, resolved: resolved.length,
    pending: entries.filter((e) => e.status === 'pending').length,
    unavailable: entries.filter((e) => e.status === 'unavailable').length,
    beat: resolved.filter((e) => e.result.excessReturn > 0).length,
    meanExcessReturn: round(mean), medianExcessReturn: round(median),
    effectiveSample: effectiveSample(resolved).total,
    since: days[0] || null,
    recent: resolved.slice().sort((a, b) => b.result.end.localeCompare(a.result.end) || a.key.localeCompare(b.key)).slice(0, RECENT)
      .map((e) => ({symbol: e.symbol, dateKey: e.dateKey, benchmark: e.benchmark, excessReturn: e.result.excessReturn}))
  };
}

// prior: the stored record (or null); additions: picksFromRun (or
// listFromRun) entries, from this run and recent ones (a pick already stored
// is kept as first stored). opts.keepDays drops entries from runs older than
// that many days, so a long record cannot outgrow its document.
function measureTakerRecord(prior, additions, bars, now, opts) {
  const current = {...((prior && prior.entries) || {})};
  for (const entry of additions || []) if (entry && entry.key && !current[entry.key]) current[entry.key] = {...entry};
  const keepDays = opts && opts.keepDays;
  const cutoff = keepDays ? new Date(Date.parse(now) - keepDays * 86400000).toISOString().slice(0, 10) : '';
  const entries = Object.values(current).filter((entry) => !cutoff || entry.dateKey >= cutoff).map((entry) => resolvePick(entry, bars, now));
  return {
    version: 1, horizon: HORIZON, generatedAt: now,
    entries: Object.fromEntries(entries.map((e) => [e.key, e])),
    stats: takerStats(entries),
    method: (opts && opts.method) || 'Every published Taker pick, from the first completed close after the day it was published to ten matched sessions later, against the benchmark it was judged against. No trading costs. Effective sample counts non-overlapping ten-session windows per symbol; related symbols still move together.'
  };
}

export { RECORD_DOC, LIST_DOC, LIST_KEEP_DAYS, pickKey, picksFromRun, listFromRun, resolvePick, takerStats, measureTakerRecord };
