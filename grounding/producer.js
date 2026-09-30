'use strict';
// The pure half of the Daybook grounding publisher (roadmap Phase D). From the
// previous release and what was observed this run, it builds the next complete
// snapshot, decides whether anything changed, and cuts the release. No I/O, no
// clock (`now` is passed in), no dependencies.
//
// What it decides:
//   - An observation of a new period becomes revision 1. If it is newer than the
//     series' latest live observation, it supersedes that one (FY27 replaces
//     FY26, September's CPI replaces August's). An older period from an
//     automated source is refused: it would rewrite history out of order.
//   - An older period that was never published, from a reviewed manual capture
//     (last year's award rate, captured from an archived guide), is added as
//     its own current record. It supersedes nothing and leaves the newer record
//     as it is, so consumers can import it for its own period.
//   - A changed observation of the same period becomes the next revision,
//     "corrected", superseding the revision it replaces.
//   - An unchanged observation changes nothing. When and how a page was fetched
//     (retrievedAt, contentSha256, asOf, locator, licence) is not content,
//     because dynamic pages differ on every fetch.
//   - An observation that fails validation, or breaches its series' bounds
//     without a recorded override, is NOT published. The series' watch record
//     says why, and the last good figure stays.
//   - A watch record keeps its stateChangedAt, and its whole previous form,
//     while its state, expectedBy, detail and evidence URL are unchanged, so a
//     release is cut only when published content changed.

const V = require('./validate');
const { cutRelease } = require('./release');

const clone = (v) => JSON.parse(JSON.stringify(v));
const isLive = (r) => r.lifecycle === 'current' || r.lifecycle === 'corrected';

function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

// Everything that makes a figure what it is, and nothing about the fetch.
function contentKey(rec) {
  const c = clone(rec);
  ['recordId', 'revision', 'lifecycle', 'supersedes'].forEach((k) => { delete c[k]; });
  (c.evidence || []).forEach((ev) => { ['retrievedAt', 'contentSha256', 'asOf', 'locator', 'licence'].forEach((k) => { delete ev[k]; }); });
  return canonical(c);
}

const FACT_DEFAULTS = {
  supersedes: null, value: null, range: null, qualifications: [], valueBindings: [], effectiveFrom: null, effectiveTo: null,
  derivation: null, plausibilityOverride: null,
};
function asObservation(raw) {
  const o = Object.assign({}, FACT_DEFAULTS, clone(raw));
  ['recordId', 'revision', 'lifecycle', 'supersedes'].forEach((k) => { delete o[k]; });
  return o;
}
function withIdentity(obs, revision, lifecycle, supersedes) {
  const rec = { recordId: obs.seriesId + '@' + obs.observationKey + '#r' + revision, seriesId: obs.seriesId, observationKey: obs.observationKey, revision, lifecycle, supersedes };
  Object.keys(obs).forEach((k) => { if (!(k in rec)) rec[k] = obs[k]; });
  return rec;
}

// ── display ──────────────────────────────────────────────────────────────────
function money(n) { return '$' + n.toFixed(2); }
function plain(n) { return V.canonicalNumber(n) || String(n); }
function formatValue(rec) {
  if (!rec) return '';
  const unit = rec.unitCode;
  const one = (n) => unit === 'pct' ? plain(n) + '%' : unit === 'pct_pa' ? plain(n) + '% p.a.' : unit === 'index_points' || unit === 'aud_cents_per_litre' ? plain(n) : money(n);
  const suffix = unit === 'aud_per_hour' ? '/hour' : unit === 'aud_per_day' ? '/day' : unit === 'aud_per_item' ? ' each' : unit === 'index_points' ? ' index points' : unit === 'aud_cents_per_litre' ? ' c/L' : '';
  if (rec.range) return one(rec.range.min) + '–' + one(rec.range.max) + suffix;
  return rec.value == null ? '' : one(rec.value) + suffix;
}
const WATCH_LABELS = {
  awaiting_publication: 'awaiting publication', published: 'published', overdue: 'overdue', stale: 'stale',
  blocked: 'blocked', withdrawn: 'withdrawn', conflict: 'conflict',
};

// ── facts ────────────────────────────────────────────────────────────────────
// Apply one observation to the working snapshot. Returns { unchanged }, { skip },
// or { facts, change }.
function applyObservation(working, obs) {
  const same = working.filter((r) => r.seriesId === obs.seriesId && r.observationKey === obs.observationKey);
  if (same.length) {
    const latest = same.reduce((a, b) => (a.revision > b.revision ? a : b));
    if (contentKey(latest) === contentKey(obs)) return { unchanged: true };
    if (latest.lifecycle === 'withdrawn') return { skip: 'withdrawn by its publisher; restoring it is a manual decision' };
    const revision = latest.revision + 1;
    // A live observation is corrected in place; a historical one (a later period
    // has since replaced it) keeps its corrected revision as history.
    const next = withIdentity(obs, revision, isLive(latest) ? 'corrected' : 'superseded', latest.recordId);
    const facts = working.map((r) => (r === latest ? Object.assign({}, r, { lifecycle: 'superseded' }) : r)).concat([next]);
    return { facts, change: { kind: 'correction', record: next, prior: latest } };
  }
  const live = working.filter((r) => r.seriesId === obs.seriesId && isLive(r))
    .sort((a, b) => (a.observationKey < b.observationKey ? 1 : -1));
  const latestLive = live[0] || null;
  if (latestLive && obs.observationKey < latestLive.observationKey) {
    if (obs.captureMethod !== 'manual') return { skip: 'older than the latest observation (' + latestLive.observationKey + ')' };
    const earlier = withIdentity(obs, 1, 'current', null);
    return { facts: working.concat([earlier]), change: { kind: 'earlier', record: earlier, prior: latestLive } };
  }
  const next = withIdentity(obs, 1, 'current', latestLive ? latestLive.recordId : null);
  const facts = working.map((r) => (r === latestLive ? Object.assign({}, r, { lifecycle: 'superseded' }) : r)).concat([next]);
  return { facts, change: { kind: latestLive ? 'update' : 'new', record: next, prior: latestLive } };
}

function factsFile(records, now) { return { schema: V.SCHEMAS.facts, generatedAt: now, records }; }
function stripWhere(message) { return String(message).replace(/^facts\[\d+\]( \S+)?: /, ''); }
function firstEvidenceUrl(rec) {
  const ev = (rec.evidence || []).find((e) => e.role === 'release' || e.role === 'table') || (rec.evidence || [])[0];
  return ev ? ev.url : null;
}
function firstPublisher(rec) {
  const ev = (rec.evidence || []).find((e) => e.role === 'release' || e.role === 'table') || (rec.evidence || [])[0];
  return ev ? ev.publisher : null;
}

// ── watch ────────────────────────────────────────────────────────────────────
function daysBetween(fromDate, nowIso) {
  return Math.floor((Date.parse(nowIso) - Date.parse(fromDate + 'T00:00:00Z')) / 86400000);
}
function watchFor(series, facts, issue, status, now) {
  const live = facts.filter((r) => r.seriesId === series.seriesId && isLive(r)).sort((a, b) => (a.observationKey < b.observationKey ? 1 : -1))[0];
  let state, detail, url = null, expectedBy = null;
  if (issue) {
    state = issue.state; detail = issue.detail; url = issue.url || (live ? firstEvidenceUrl(live) : null);
  } else if (status && status.state && !status.keep) {
    // What a fetcher reported about the source itself (for example a page that
    // refuses automated readers, or a publication schedule it states).
    state = status.state; detail = status.detail; url = status.url || null;
    if (status.expectedBy && status.url) expectedBy = status.expectedBy;
  } else if (live) {
    const shown = formatValue(live) + ' (' + live.observationKey + '), published ' + live.publishedAt;
    if (series.freshnessDays && daysBetween(live.publishedAt, now) > series.freshnessDays) {
      state = 'stale'; detail = 'Latest ' + shown + ', more than ' + series.freshnessDays + ' days ago.';
    } else {
      state = 'published'; detail = 'Latest: ' + shown + '.';
    }
    url = firstEvidenceUrl(live);
  } else {
    state = 'awaiting_publication'; detail = 'No figure captured yet.';
  }
  // A fetcher may add the date the source itself gives for its next
  // publication (G8) without changing the state: { expectedBy, url, detail }.
  // The watch then points at the page that states it.
  if (!issue && status && !status.state && !status.keep && status.expectedBy && status.url) {
    expectedBy = status.expectedBy; url = status.url;
    if (status.detail) detail = detail + ' ' + status.detail;
  }
  return { state, detail, url, expectedBy };
}

// ── produce ──────────────────────────────────────────────────────────────────
// input: {
//   previous:     null | { sequence, facts, watch, insights }    (a validated release)
//   registry:     [{ seriesId, title, freshnessDays, bounds }]
//   observations: [fact-shaped observations; identity fields are assigned here]
//   seriesStatus: { [seriesId]: { state, detail, url, expectedBy } | { keep: true } | { expectedBy, url, detail } }
//                 (optional, from fetchers; keep = the fetch failed transiently;
//                 the last form adds a stated next date to the computed state)
//   insights:     [] | undefined (undefined keeps the previous insights)
//   now:          ISO timestamp
//   producerCommit
// }
function produce(input) {
  const now = input.now;
  if (!now || Number.isNaN(Date.parse(now))) throw new Error('produce needs an ISO timestamp for now');
  const previous = input.previous || null;
  const registry = input.registry || [];
  const byId = {};
  registry.forEach((s) => { byId[s.seriesId] = s; });
  const bounds = {};
  registry.forEach((s) => { if (s.bounds) bounds[s.seriesId] = s.bounds; });

  let working = previous ? clone(previous.facts) : [];
  const changes = [], skipped = [], issues = {};
  const observations = (input.observations || []).map(asObservation)
    .sort((a, b) => (a.seriesId !== b.seriesId ? (a.seriesId < b.seriesId ? -1 : 1)
      : a.observationKey === b.observationKey ? 0 : (a.observationKey < b.observationKey ? -1 : 1)));

  observations.forEach((obs) => {
    if (!byId[obs.seriesId]) { skipped.push({ seriesId: obs.seriesId, observationKey: obs.observationKey, reason: 'series not registered in grounding/series.js' }); return; }
    const step = applyObservation(working, obs);
    if (step.unchanged) return;
    if (step.skip) { skipped.push({ seriesId: obs.seriesId, observationKey: obs.observationKey, reason: step.skip }); return; }
    // Validate the whole snapshot with the new record in it, and keep the
    // change only if the new record is valid and plausible.
    const check = V.validateFactsFile(factsFile(step.facts, now), { bounds });
    const mine = check.results.find((r) => r.recordId === step.change.record.recordId);
    const fileErrors = check.errors;
    // Vocabulary the validator does not know is readable for a consumer, but
    // Daybook never publishes it: it would be a typo, or a contract change made
    // in the wrong order.
    if (fileErrors.length || !mine || !mine.ok || mine.unsupported.length) {
      const errors = fileErrors.concat(mine ? mine.errors.concat(mine.unsupported) : []);
      const conflict = errors.some((e) => /cross-check conflict/.test(e));
      issues[obs.seriesId] = {
        state: conflict ? 'conflict' : 'blocked',
        detail: (conflict ? 'The data table disagrees with the release: ' : 'Not published: ') + stripWhere(errors[0] || 'the record failed validation') + '.',
        url: firstEvidenceUrl(obs),
      };
      skipped.push({ seriesId: obs.seriesId, observationKey: obs.observationKey, reason: errors[0] || 'invalid' });
      return;
    }
    // The validator only reports what Daybook's bounds make of an override; a
    // consumer's differ, so it cannot refuse one. Daybook stays strict about its
    // own, but only for the record it is about to publish: history is never
    // re-judged, so changing a series' bounds later cannot stop the publisher.
    const ov = mine.overrideVerdict;
    if (ov === 'not_evaluated' || ov === 'not_needed') {
      issues[obs.seriesId] = {
        state: 'blocked',
        detail: 'Not published: ' + formatValue(step.change.record) + ' (' + obs.observationKey + ') carries a plausibilityOverride, but ' +
          (ov === 'not_evaluated' ? 'the series has no bounds in grounding/series.js to check it against'
            : 'it is inside this series\' bounds, so there is nothing to clear; remove the override') + '.',
        url: firstEvidenceUrl(obs),
      };
      skipped.push({ seriesId: obs.seriesId, observationKey: obs.observationKey, reason: 'plausibilityOverride ' + (ov === 'not_evaluated' ? 'without series bounds' : 'not needed') });
      return;
    }
    if (mine.checks.plausible === false) {
      const b = bounds[obs.seriesId];
      issues[obs.seriesId] = {
        state: 'blocked',
        detail: 'Not published: ' + formatValue(step.change.record) + ' (' + obs.observationKey + ') is outside this series\' plausibility bounds' +
          (b ? ' (' + [b.min != null ? 'min ' + b.min : '', b.max != null ? 'max ' + b.max : '', b.maxChange != null ? 'max change ' + b.maxChange : ''].filter(Boolean).join(', ') + ')' : '') +
          (ov === 'unmatched' ? ', and its plausibilityOverride records a different bound. Record the bound that failed to publish it.'
            : '. Check it against the source and record a plausibilityOverride to publish it.'),
        url: firstEvidenceUrl(obs),
      };
      skipped.push({ seriesId: obs.seriesId, observationKey: obs.observationKey, reason: 'plausibility breach' });
      return;
    }
    working = step.facts;
    const rec = step.change.record, prior = step.change.prior;
    const summary = step.change.kind === 'new' ? rec.title + ': ' + formatValue(rec) + ' (' + rec.observationKey + ')'
      : step.change.kind === 'update' ? rec.title + ': ' + formatValue(prior) + ' → ' + formatValue(rec) + ' (' + prior.observationKey + ' → ' + rec.observationKey + ')'
        : step.change.kind === 'earlier' ? rec.title + ': ' + formatValue(rec) + ' (' + rec.observationKey + '), an earlier period; the latest is still ' + formatValue(prior) + ' (' + prior.observationKey + ')'
        : rec.title + ' corrected: ' + formatValue(prior) + ' → ' + formatValue(rec) + ' (' + rec.observationKey + ')';
    changes.push({ id: rec.recordId, kind: step.change.kind, seriesId: rec.seriesId, title: rec.title, summary, at: now, url: firstEvidenceUrl(rec), publisher: firstPublisher(rec) });
  });

  const final = V.validateFactsFile(factsFile(working, now), { bounds });
  if (!final.ok) throw new Error('producer built an invalid snapshot: ' + final.errors.concat(...final.results.map((r) => r.errors)).slice(0, 3).join('; '));
  const unknown = final.results.filter((r) => r.unsupported.length);
  if (unknown.length) throw new Error('producer built a snapshot with vocabulary this contract version does not know: ' + unknown[0].unsupported[0]);

  // Watch: one record per registered series.
  const prevWatch = {};
  (previous ? previous.watch : []).forEach((w) => { prevWatch[w.watchId] = w; });
  const status = input.seriesStatus || {};
  const watch = registry.map((series) => {
    const w = watchFor(series, working, issues[series.seriesId], status[series.seriesId], now);
    const watchId = series.seriesId + '@series';
    const prior = prevWatch[watchId];
    // A fetch that failed for a moment says nothing new about the series: keep
    // what the last release said rather than flip the state back and forth.
    if (prior && status[series.seriesId] && status[series.seriesId].keep && !issues[series.seriesId] &&
      !(prior.state === 'published' && w.state === 'stale')) return prior;
    const priorUrl = prior && prior.evidence ? prior.evidence.url : null;
    if (prior && prior.state === w.state && prior.detail === w.detail && (prior.expectedBy || null) === w.expectedBy && priorUrl === w.url) return prior;
    const rec = { watchId, seriesId: series.seriesId, state: w.state, expectedBy: w.expectedBy, stateChangedAt: now, detail: w.detail, evidence: w.url ? { url: w.url, retrievedAt: now } : null };
    if (!prior || prior.state !== w.state) {
      // Worth an alert: a problem, or a figure going stale. "published" arrives
      // with its fact change; "awaiting" is the starting state.
      if ((prior || ['stale', 'overdue', 'blocked', 'conflict', 'withdrawn'].indexOf(w.state) >= 0) &&
        !(w.state === 'published' && changes.some((c) => c.seriesId === series.seriesId && c.kind !== 'watch'))) {
        changes.push({ id: watchId + ':' + w.state + ':' + now, kind: 'watch', seriesId: series.seriesId, title: series.title, summary: series.title + ': ' + (prior ? WATCH_LABELS[prior.state] + ' → ' : '') + WATCH_LABELS[w.state] + '. ' + w.detail, at: now, url: w.url, publisher: null });
      }
    }
    return rec;
  });
  const watchCheck = V.validateWatchFile({ schema: V.SCHEMAS.watch, generatedAt: now, records: watch });
  if (!watchCheck.ok) throw new Error('producer built an invalid watch file: ' + watchCheck.results.map((r) => r.errors.join('; ')).filter(Boolean).join(' | '));

  const insights = input.insights !== undefined ? input.insights : (previous ? previous.insights : []);
  const snapshot = { facts: working, watch, insights };
  const changed = !previous || canonical(snapshot) !== canonical({ facts: previous.facts, watch: previous.watch, insights: previous.insights });

  let release = null;
  if (changed) {
    const sequence = previous ? previous.sequence + 1 : 1;
    release = cutRelease(sequence, snapshot, { generatedAt: now, producerCommit: input.producerCommit || 'unknown', previousFileTexts: previous && previous.fileTexts });
    // The release must pass the same validator the consumers run.
    const dir = release.dir;
    const verdict = V.validateRelease({
      latestText: release.files['latest.json'],
      manifestText: release.files[dir + '/manifest.json'],
      fileTexts: { 'facts.json': release.files[dir + '/facts.json'], 'watch.json': release.files[dir + '/watch.json'], 'insights.json': release.files[dir + '/insights.json'] },
      directorySequence: sequence,
    }, { bounds });
    if (!verdict.ok) throw new Error('producer cut an invalid release: ' + verdict.errors.slice(0, 3).join('; '));
  }
  return { changed, release, snapshot, changes, skipped, validation: final };
}

// What Daybook's own UI reads (Firestore briefings-bob/grounding-latest). Live
// figures only, each with the trust attributes the validator computed, plus the
// watch states and the recent changes (kept 30 days, at most 40).
// opts.titles maps seriesId to its registry title, so a watch row reads as a
// plain name rather than its key.
function buildMirror(result, opts) {
  opts = opts || {};
  const now = opts.now;
  const titles = opts.titles || {};
  const snapshot = result.snapshot;
  const checks = {};
  (result.validation ? result.validation.results : []).forEach((r) => { checks[r.recordId] = r.checks; });
  const cutoff = Date.parse(now) - 30 * 86400000;
  const recent = (opts.previousChanges || []).concat(result.changes)
    .filter((c) => c && Date.parse(c.at) >= cutoff)
    .reduce((list, c) => (list.some((x) => x.id === c.id) ? list : list.concat([c])), [])
    .sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? 1 : -1))
    .slice(0, 40);
  return {
    schema: 'daybook-grounding-mirror/1',
    sequence: opts.sequence,
    manifestSha256: opts.manifestSha256 || null,
    releaseUrl: opts.releaseUrl || null,
    updatedAt: now,
    facts: snapshot.facts.filter(isLive).map((r) => ({
      recordId: r.recordId, seriesId: r.seriesId, title: r.title, kind: r.kind, observationKey: r.observationKey, lifecycle: r.lifecycle,
      display: formatValue(r), value: r.value, range: r.range, unitCode: r.unitCode, basisCode: r.basisCode,
      jurisdiction: r.scope.jurisdiction, classification: r.scope.classification || null,
      publishedAt: r.publishedAt, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
      captureMethod: r.captureMethod, url: firstEvidenceUrl(r), publisher: firstPublisher(r),
      checks: checks[r.recordId] || null,
    })),
    watch: snapshot.watch.map((w) => ({ watchId: w.watchId, seriesId: w.seriesId, title: titles[w.seriesId] || w.seriesId, state: w.state, expectedBy: w.expectedBy || null, stateChangedAt: w.stateChangedAt, detail: w.detail, url: w.evidence ? w.evidence.url : null })),
    changes: recent,
  };
}

module.exports = { produce, buildMirror, formatValue, contentKey, canonical, WATCH_LABELS };
