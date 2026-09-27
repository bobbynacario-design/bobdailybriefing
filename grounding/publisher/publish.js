'use strict';
// Daybook grounding publisher (docs/grounding-roadmap.md, Phase D). This is the
// only part of grounding/ that does I/O; the decisions are in ../producer.js.
//
//   node grounding/publisher/publish.js --data-dir <checkout of grounding-data> [--dry-run] [--no-firestore]
//
// Each run:
//   1. Reads the previous release from the data directory and checks it with the
//      same validator the consumers run. A previous release that fails is a hard
//      stop: nothing is built on a release nobody could trust.
//   2. Loads the manual captures (grounding/manual/*.json) and runs the automated
//      series that are due (grounding/series.js), identifying as Daybook.
//   3. Builds the next snapshot. Only if published content changed does it write
//      the new release directory, and then latest.json last, so latest.json never
//      points at a half-written release. An existing release directory is never
//      overwritten.
//   4. Mirrors the latest release to Firestore (briefings-bob/grounding-latest)
//      for Daybook's panel and Morning 5, keeps per-series check times in
//      briefings-bob/grounding-ops (operational data never goes into a release),
//      and records run health as feed "grounding".
//
// It never commits or pushes. The workflow does that, and only to the orphan
// grounding-data branch.

const fs = require('fs');
const path = require('path');
const V = require('../validate');
const { produce, buildMirror, formatValue } = require('../producer');

const GROUNDING = path.join(__dirname, '..');
const PROJECT_ID = 'pokerhq-a67e4';
const COLL = 'briefings-bob';
const FEED_KEY = 'grounding';
const REPO = process.env.GITHUB_REPOSITORY || 'bobbynacario-design/bobdailybriefing';
const RELEASE_URL = 'https://raw.githubusercontent.com/' + REPO + '/grounding-data/grounding/latest.json';
// The same honest identity as the news feed: a real name and a contact path,
// never a browser disguise.
const USER_AGENT = 'bobdailybriefing/1.0 (personal daily briefing; +https://github.com/bobbynacario-design/bobdailybriefing)';

const DATA_BRANCH_README = '# grounding-data\n\nPublished by Daybook\'s grounding job (see docs/grounding-roadmap.md on main).\n' +
  'Each release under grounding/releases/<sequence>/ is immutable; grounding/latest.json names the newest one and its SHA-256.\n' +
  'Consumers verify every digest before parsing. Do not edit this branch by hand.\n';

function readText(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null; }

// The previous release, validated, or null when none has been published yet.
function readPrevious(dataDir, bounds) {
  const base = path.join(dataDir, 'grounding');
  const latestText = readText(path.join(base, 'latest.json'));
  if (latestText == null) return null;
  let latest;
  try { latest = JSON.parse(latestText); } catch (e) { throw Object.assign(new Error('previous latest.json is not valid JSON'), { stage: 'read-previous' }); }
  const manifestPath = latest && latest.manifest && latest.manifest.path;
  // Read nothing outside the release layout, whatever latest.json says.
  if (!/^releases\/\d{6}\/manifest\.json$/.test(String(manifestPath))) throw Object.assign(new Error('previous latest.json names an unexpected manifest path'), { stage: 'read-previous' });
  const dir = path.join(base, path.dirname(manifestPath));
  const input = {
    latestText,
    manifestText: readText(path.join(base, manifestPath)),
    fileTexts: { 'facts.json': readText(path.join(dir, 'facts.json')), 'watch.json': readText(path.join(dir, 'watch.json')), 'insights.json': readText(path.join(dir, 'insights.json')) },
    directorySequence: Number(path.basename(dir)),
  };
  const verdict = V.validateRelease(input, { bounds });
  if (!verdict.ok) throw Object.assign(new Error('previous release failed validation: ' + verdict.errors.slice(0, 3).join('; ')), { stage: 'read-previous' });
  return {
    sequence: verdict.sequence, manifestSha256: verdict.manifestSha256,
    generatedAt: JSON.parse(input.manifestText).generatedAt,
    fileTexts: input.fileTexts,
    facts: verdict.facts.results.map((r) => r.record), watch: verdict.watch.results.map((r) => r.record), insights: verdict.insights.results.map((r) => r.record),
  };
}

function loadManual(manualDir) {
  if (!fs.existsSync(manualDir)) return [];
  return fs.readdirSync(manualDir).filter((f) => f.endsWith('.json')).sort().flatMap((f) => {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(manualDir, f), 'utf8')); } catch (e) {
      throw Object.assign(new Error('grounding/manual/' + f + ' is not valid JSON'), { stage: 'load-manual' });
    }
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

async function fetchWithIdentity(url, init) {
  const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(20000) }, init || {}, {
    headers: Object.assign({ 'user-agent': USER_AGENT }, (init && init.headers) || {}),
  }));
  if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status + ' from ' + url), { status: res.status, url });
  return res;
}

// Run the automated series that are due. A refusal (401/403) is reported as
// "blocked"; any other failure keeps the previous watch state for that series.
async function runAutomated(registry, ops, now, fetchImpl) {
  const observations = [], status = {}, checked = {};
  for (const series of registry) {
    if (typeof series.fetch !== 'function') continue;
    const last = ops[series.seriesId] && Date.parse(ops[series.seriesId].lastCheckedAt);
    const every = (series.cadenceHours || 24) * 3600000;
    if (last && Date.parse(now) - last < every) { status[series.seriesId] = { keep: true }; continue; }
    try {
      const out = await series.fetch({ fetch: fetchImpl, userAgent: USER_AGENT, now });
      (out && out.observations || []).forEach((o) => observations.push(o));
      if (out && out.status) status[series.seriesId] = out.status;
      checked[series.seriesId] = { lastCheckedAt: now, lastError: null };
    } catch (e) {
      status[series.seriesId] = e.status === 401 || e.status === 403
        ? { state: 'blocked', detail: 'The source refused Daybook\'s reader (HTTP ' + e.status + '). Capture this series by hand instead.', url: e.url || null }
        : { keep: true };
      checked[series.seriesId] = { lastCheckedAt: now, lastError: String(e.message || e).slice(0, 200) };
    }
  }
  return { observations, status, checked };
}

function writeRelease(dataDir, release) {
  const base = path.join(dataDir, 'grounding');
  const target = path.join(base, release.dir);
  if (fs.existsSync(target)) throw Object.assign(new Error('release directory ' + release.dir + ' already exists; releases are never overwritten'), { stage: 'write' });
  const written = [];
  // Release files first, latest.json last.
  Object.keys(release.files).filter((rel) => rel !== 'latest.json').forEach((rel) => {
    const file = path.join(base, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, release.files[rel]);
    written.push('grounding/' + rel);
  });
  fs.writeFileSync(path.join(base, 'latest.json'), release.files['latest.json']);
  written.push('grounding/latest.json');
  // The branch's own guard rails, written once.
  const attrs = path.join(dataDir, '.gitattributes');
  if (!fs.existsSync(attrs)) { fs.writeFileSync(attrs, '# Digests cover exact bytes: never convert line endings.\n* -text\n'); written.push('.gitattributes'); }
  const readme = path.join(dataDir, 'README.md');
  if (!fs.existsSync(readme)) { fs.writeFileSync(readme, DATA_BRANCH_README); written.push('README.md'); }
  return written;
}

function producerCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 40);
  try { return require('child_process').execSync('git rev-parse HEAD', { cwd: GROUNDING, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return 'local'; }
}

// Firestore, only when asked for. Required lazily so the tests and --no-firestore
// runs need no dependencies.
let _db = null;
function firestore() {
  if (_db) return _db;
  const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const shared = path.join(GROUNDING, '..', 'radar', 'serviceAccountKey.json');
  if (fs.existsSync(shared)) initializeApp({ credential: cert(JSON.parse(fs.readFileSync(shared, 'utf8'))), projectId: PROJECT_ID });
  else initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  _db = getFirestore();
  return _db;
}
async function health(db, rec) {
  const { recordRunHealth } = await import('../../lib/feed-health.js');
  await recordRunHealth(db, FEED_KEY, rec);
}

// opts: { dataDir, dryRun, firestore, now, registry, manualDir, fetchImpl, db }
async function run(opts) {
  const started = Date.now();
  const now = opts.now || new Date().toISOString();
  const registry = opts.registry || require('../series');
  const bounds = {}, titles = {};
  registry.forEach((s) => { if (s.bounds) bounds[s.seriesId] = s.bounds; titles[s.seriesId] = s.title || s.seriesId; });
  const db = opts.firestore ? (opts.db || firestore()) : null;

  if (opts.deferMirror && !opts.pendingFile) throw new Error('deferMirror requires pendingFile outside the data checkout');
  if (opts.pendingFile && (path.resolve(opts.pendingFile) === path.resolve(opts.dataDir) || path.resolve(opts.pendingFile).startsWith(path.resolve(opts.dataDir) + path.sep))) throw new Error('pendingFile must be outside the public data checkout');

  if (opts.mirrorOnly) {
    const pending = JSON.parse(fs.readFileSync(opts.pendingFile, 'utf8'));
    const published = readPrevious(opts.dataDir, bounds);
    if (!published || published.sequence !== pending.mirror.sequence || published.manifestSha256 !== pending.mirror.manifestSha256) throw new Error('pending mirror does not match the published release');
    if (!db || opts.dryRun) throw new Error('mirrorOnly requires Firestore and cannot be a dry run');
    await saveMirror(db, pending);
    return { mirrored: true, sequence: published.sequence };
  }

  const previous = readPrevious(opts.dataDir, bounds);
  let ops = {};
  if (db) {
    const snap = await db.collection(COLL).doc('grounding-ops').get();
    ops = snap.exists ? (snap.data().series || {}) : {};
  }
  const manual = loadManual(opts.manualDir || path.join(GROUNDING, 'manual'));
  const auto = await runAutomated(registry, ops, now, opts.fetchImpl || fetchWithIdentity);
  const result = produce({
    previous, registry, observations: manual.concat(auto.observations), seriesStatus: auto.status, now, producerCommit: producerCommit(),
  });

  let written = [];
  if (result.changed && !opts.dryRun) written = writeRelease(opts.dataDir, result.release);
  const sequence = result.changed ? result.release.sequence : (previous ? previous.sequence : 0);
  const manifestSha256 = result.changed ? result.release.manifestSha256 : (previous ? previous.manifestSha256 : null);

  if (db && !opts.dryRun) {
    const mirrorRef = db.collection(COLL).doc('grounding-latest');
    const prior = await mirrorRef.get();
    // Recover after a successful push followed by a failed Firestore write.
    // The next run is content-identical, but those changes still need surfacing.
    const priorMirror = prior.exists ? prior.data() : {};
    if (!result.changed && previous && priorMirror.sequence !== sequence) {
      for (const rec of result.snapshot.facts.filter((r) => r.lifecycle === 'current' || r.lifecycle === 'corrected')) {
        const old = (priorMirror.facts || []).find((r) => r.seriesId === rec.seriesId);
        if (old && old.recordId === rec.recordId) continue;
        const ev = rec.evidence.find((e) => e.role === 'release') || rec.evidence[0];
        result.changes.push({ id: rec.recordId, kind: old ? 'update' : 'new', seriesId: rec.seriesId, title: rec.title,
          summary: rec.title + ': ' + (old ? old.display + ' → ' : '') + formatValue(rec) + ' (' + rec.observationKey + ')',
          at: previous.generatedAt, url: ev ? ev.url : null, publisher: ev ? ev.publisher : null });
      }
      for (const w of result.snapshot.watch) {
        const old = (priorMirror.watch || []).find((r) => r.watchId === w.watchId);
        if (old && old.state === w.state || !old && w.state === 'awaiting_publication') continue;
        if (w.state === 'published' && result.changes.some((c) => c.seriesId === w.seriesId)) continue;
        result.changes.push({ id: w.watchId + ':' + w.state + ':' + w.stateChangedAt, kind: 'watch', seriesId: w.seriesId, title: titles[w.seriesId] || w.seriesId,
          summary: (titles[w.seriesId] || w.seriesId) + ': ' + (old ? old.state.replace(/_/g, ' ') + ' → ' : '') + w.state.replace(/_/g, ' ') + '. ' + w.detail, at: w.stateChangedAt,
          url: w.evidence ? w.evidence.url : null, publisher: null });
      }
    }
    const mirror = buildMirror(result, { now, sequence, manifestSha256, titles, releaseUrl: RELEASE_URL, previousChanges: prior.exists ? (prior.data().changes || []) : [] });
    const pending = { mirror, checked: auto.checked, now, health: {
      status: 'ok', asOf: 'release ' + String(sequence).padStart(6, '0'), durationMs: Date.now() - started,
      message: (result.changed ? 'released ' : 'unchanged at ') + String(sequence).padStart(6, '0') + '; ' + result.changes.length + ' change(s); ' + result.skipped.length + ' skipped',
    } };
    const latestChecks = Object.assign({}, ops, auto.checked);
    const failures = registry.map((s) => latestChecks[s.seriesId]).filter((c) => c && c.lastError);
    if (failures.length) { pending.health.status = 'failed'; pending.health.message = failures.length + ' source check(s) failed; ' + failures[0].lastError; }
    if (opts.deferMirror) fs.writeFileSync(opts.pendingFile, JSON.stringify(pending));
    else await saveMirror(db, pending);
  }
  return { result, written, sequence, manifestSha256 };
}

async function saveMirror(db, pending) {
  await db.collection(COLL).doc('grounding-latest').set(pending.mirror);
  if (Object.keys(pending.checked).length) await db.collection(COLL).doc('grounding-ops').set({ series: pending.checked, updatedAt: pending.now }, { merge: true });
  await health(db, pending.health);
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const dataDir = argValue(argv, '--data-dir') || path.join(process.cwd(), 'gdata');
  const dryRun = argv.indexOf('--dry-run') >= 0;
  const useFirestore = argv.indexOf('--no-firestore') < 0;
  let db = null;
  try {
    if (useFirestore) db = firestore();
    const out = await run({ dataDir, dryRun, firestore: useFirestore, db,
      deferMirror: argv.includes('--defer-mirror'), mirrorOnly: argv.includes('--mirror-only'), pendingFile: argValue(argv, '--pending-file') });
    if (out.mirrored) { console.log('grounding: mirrored release ' + out.sequence); return; }
    const r = out.result;
    console.log('grounding: ' + (r.changed ? (dryRun ? 'would release ' : 'released ') : 'unchanged at ') + String(out.sequence).padStart(6, '0') +
      '; ' + r.snapshot.facts.length + ' fact record(s), ' + r.snapshot.watch.length + ' watch record(s)');
    r.changes.forEach((c) => console.log('  change: ' + c.summary));
    r.skipped.forEach((s) => console.log('  skipped: ' + s.seriesId + '@' + s.observationKey + ': ' + s.reason));
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'released=' + (r.changed && !dryRun) + '\nsequence=' + String(out.sequence).padStart(6, '0') + '\n');
    }
    process.exit(0);
  } catch (e) {
    console.error('grounding publish failed' + (e.stage ? ' at ' + e.stage : '') + ': ' + (e.message || e));
    if (db && !dryRun) {
      try { await health(db, { status: 'failed', stage: e.stage || 'publish', message: String(e.message || e).slice(0, 300) }); } catch (ignored) { /* health must never mask the error */ }
    }
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { run, readPrevious, loadManual, writeRelease, RELEASE_URL, USER_AGENT };
