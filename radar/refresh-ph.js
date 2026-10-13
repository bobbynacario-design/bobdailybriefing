// radar/refresh-ph.js
//
// The PSE tab's only writer (briefings-bob/radar-ph). GitHub Actions runs it at
// 16:30 PHT on weekdays, after the 15:30 PSE close (refresh-intelligence.yml,
// feed "pse"). It used to run on the laptop as well as inside the 06:00 radar;
// the radar step was removed on 13 Oct 2026 when the stock rows moved to PSE Edge.
//
// Run:  cd radar ; node refresh-ph.js
// Secrets: Firestore only — radar/serviceAccountKey.json locally, application
// default credentials on GitHub. No model calls.

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CONFIG } from './config.js';
import { buildPhSnapshot, writePhSnapshot, loadPhSnapshot, phtToday } from './ph-snapshot.js';
import { refreshWatchlists } from './pse-watch.js';
import { fetchEvents, applyEvents, fetchDirectory } from './pse-events.js';
import { buildPseRadar } from './pse-radar.js';
import { recordRunHealth, makeStage } from '../lib/feed-health.js';

var __dirname = dirname(fileURLToPath(import.meta.url));

(function loadDotEnv() {
  try {
    var p = join(__dirname, '.env');
    if (!existsSync(p)) return;
    readFileSync(p, 'utf8').split(/\r?\n/).forEach(function (line) {
      if (/^\s*(#|$)/.test(line)) return;
      var m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    });
  } catch (e) { console.warn('.env load failed:', e.message); }
})();

var PROJECT_ID = 'pokerhq-a67e4';
var COLL = 'briefings-bob';

var _db = null;
var STAGE = makeStage('start');
var RUN_STARTED = Date.now();
// --dry-run: read the stored doc and build the new one, but write nothing.
var DRY_RUN = process.argv.indexOf('--dry-run') !== -1;

function initAdmin() {
  if (_db) return _db; // initializeApp throws if called twice
  var keyPath = join(__dirname, 'serviceAccountKey.json');
  if (existsSync(keyPath)) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), projectId: PROJECT_ID });
    console.log('firebase-admin: using radar/serviceAccountKey.json');
  } else {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    console.log('firebase-admin: using application default credentials');
  }
  _db = getFirestore();
  return _db;
}

async function main() {
  STAGE.set('load-previous');
  var db = initAdmin();
  var prev = await loadPhSnapshot(db, COLL);

  STAGE.set('build-snapshot');
  var bars = {};
  var ph = await buildPhSnapshot(CONFIG, prev, bars);

  // The PSE radar (pse-radar.js): the US scoring and journal over these bars.
  // Non-fatal; written below, only with a written snapshot.
  STAGE.set('pse-radar');
  var pse = null, pseFailed = '';
  try {
    pse = buildPseRadar(bars, CONFIG);
    var top = pse.radar.signals.slice(0, 5).map(function (s) { return s.symbol + ' ' + s.score + ' ' + s.status; });
    var j = pse.journal;
    console.log('  PSE radar: ' + pse.radar.signals.length + ' scored, PSE30 ' + (pse.radar.regime.pse30AboveSma20 ? 'above' : 'below') +
      ' its 20-day; top ' + top.join(', ') + '. Journal: ' + (j.counts ? j.counts.raw + ' picks over ' + j.counts.uniqueDates + ' days' : 'n/a'));
  } catch (e) {
    pseFailed = e.message || String(e);
    console.log('  PSE radar failed: ' + pseFailed);
  }

  // Dividends, company news and IPOs (pse-events.js). Non-fatal: each source
  // that fails is named in events.failed and its section is left null.
  STAGE.set('events');
  var events = null;
  try {
    events = await fetchEvents(phtToday());
    ph.events = applyEvents(ph.board, events, ph.breadth.asOf || ph.asOf, phtToday());
  } catch (e) {
    console.log('  events failed: ' + (e.message || e));
    ph.events = { dividends: null, news: null, ipos: null, failed: ['all'], checkedAt: new Date().toISOString() };
  }
  var phDoc = Object.assign({ generatedAt: new Date().toISOString() }, ph);

  console.log('\n===== briefings-bob/radar-ph =====');
  var ix = ph.index;
  if (ix) console.log('  PSEi ' + ix.close + ' ' + ix.currency + ' (' + ix.asOf + ')  day ' + ix.dayChangePct + '%' +
    '  history ' + ix.historyDays + ' days  1m ' + ix.ret1m + '%  vs SMA200 ' + (ix.aboveSma200 == null ? 'n/a' : ix.aboveSma200 ? 'above' : 'below'));
  if (ph.fx && ph.fx.usdphp) console.log('  USD/PHP ' + ph.fx.usdphp.level + ' (1m ' + ph.fx.usdphp.ret1m + '%)');
  var br = ph.breadth;
  console.log('  PSEi stocks: ' + ph.board.length + ' of ' + CONFIG.ph.board.stocks.length + ' (asOf ' + br.asOf + ')' +
    (ph.boardFailed.length ? '  missing ' + ph.boardFailed.join(',') : '') +
    (br.staleSymbols.length ? '  older close ' + br.staleSymbols.join(',') : ''));
  console.log('  breadth: ' + br.above200 + '/' + br.with200 + ' above 200-day, ' + br.above50 + '/' + br.with50 + ' above 50-day, ' +
    br.advancers + ' up / ' + br.decliners + ' down / ' + br.unchanged + ' flat, mood ' + br.mood);
  console.log('  near 52-week low: ' + (br.nearLow.join(', ') || 'none') + '  |  near high: ' + (br.nearHigh.join(', ') || 'none'));
  var ev = ph.events;
  console.log('  events: ' + (ev.dividends ? ev.dividends.length + ' ex-date(s) in 45 days' : 'dividends n/a') + ', ' +
    (ev.news ? ev.news.length + ' filing(s) in 14 days' : 'news n/a') + ', ' + (ev.ipos ? ev.ipos.length + ' IPO(s)' : 'IPOs n/a') +
    ', ' + ph.board.filter(function (s) { return s.yield12m != null; }).length + ' stocks with a 12-month yield' +
    (ev.failed.length ? '  failed: ' + ev.failed.join(', ') : ''));

  if (DRY_RUN) {
    if (process.env.PSE_RADAR_DRY_OUT && pse) writeFileSync(process.env.PSE_RADAR_DRY_OUT, JSON.stringify(pse));
    if (process.env.PH_DRY_RUN_OUT) writeFileSync(process.env.PH_DRY_RUN_OUT, JSON.stringify(phDoc));
    var dryWatch = await watchlists(db, ph, true, events);
    await directory(db, true);
    console.log('\n--dry-run: NOT writing briefings-bob/radar-ph' + (dryWatch ? ' or the ' + dryWatch.lists + ' watchlist(s)' : '') + '.');
    return;
  }

  STAGE.set('write');
  var wrote = await writePhSnapshot(db, COLL, phDoc);
  console.log(wrote
    ? '\nWrote briefings-bob/radar-ph (after-close refresh).'
    : '\nSkipped briefings-bob/radar-ph write — stored snapshot is newer.');

  // Watchlists only follow a written snapshot: a stale run must not turn old
  // prices into today's alerts.
  var watch = wrote ? await watchlists(db, ph, false, events) : null;
  var dirFailed = await directory(db, false);

  // pse-radar (today's scores) and pse-radar-journal (the walk-back evidence).
  if (wrote && pse) {
    STAGE.set('pse-radar-write');
    try {
      var at = new Date().toISOString();
      await db.collection(COLL).doc('pse-radar').set(Object.assign({ generatedAt: at }, pse.radar));
      await db.collection(COLL).doc('pse-radar-journal').set(Object.assign({ generatedAt: at, asOf: pse.radar.asOf }, pse.journal));
      console.log('Wrote briefings-bob/pse-radar and pse-radar-journal.');
    } catch (e) {
      pseFailed = 'write: ' + (e.message || e);
      console.log('  PSE radar write failed: ' + pseFailed);
    }
  }

  await recordRunHealth(db, 'ph', {
    status: wrote ? 'ok' : 'skipped',
    asOf: ph.asOf,
    durationMs: Date.now() - RUN_STARTED,
    message: !wrote ? 'stored snapshot is newer'
      : [ph.boardFailed.length ? 'PSE Edge missing ' + ph.boardFailed.join(', ') : '',
        watch && watch.failed ? 'watchlists failed: ' + watch.failed : '',
        pseFailed ? 'PSE radar failed: ' + pseFailed : '',
        dirFailed ? 'directory failed: ' + dirFailed : ''].filter(Boolean).join('; ')
  });
}

// The list of every listed company for the watchlist box's suggestions
// (briefings-bob/pse-directory, no uid). Refreshed when over 6 days old, or
// with PSE_DIRECTORY_FORCE=1. Non-fatal: returns the failure, if any.
async function directory(db, dryRun) {
  STAGE.set('directory');
  try {
    var ref = db.collection(COLL).doc('pse-directory');
    var cur = await ref.get();
    var at = cur.exists ? cur.data().updatedAt : null;
    if (at && Date.now() - Date.parse(at) < 6 * 86400000 && !process.env.PSE_DIRECTORY_FORCE) {
      console.log('  directory: fresh (' + String(at).slice(0, 10) + ')');
      return '';
    }
    var list = await fetchDirectory();
    if (!dryRun) await ref.set({ updatedAt: new Date().toISOString(), count: list.length, companies: list });
    console.log('  directory: ' + list.length + ' companies' + (dryRun ? ' — not written' : ' — written'));
    return '';
  } catch (e) {
    console.log('  directory failed: ' + (e.message || e));
    return e.message || String(e);
  }
}

// Non-fatal: the board is already written. Counts only in the log (public repo).
async function watchlists(db, ph, dryRun, events) {
  STAGE.set('watchlists');
  try {
    var w = await refreshWatchlists(db, COLL, ph, phtToday(), { dryRun: dryRun, verbose: dryRun && !process.env.CI, events: events });
    console.log('  watchlists: ' + w.lists + ' list(s), ' + w.extra + ' stock(s) beyond the PSEi 30 (' + w.fetched + ' fetched, ' +
      w.missing + ' not found), ' + w.alerts + ' alert(s)' + (dryRun ? ' — not written' : ' — written'));
    return w;
  } catch (e) {
    console.log('  watchlists failed: ' + (e.message || e));
    return { failed: e.message || String(e) };
  }
}

main().then(function () { process.exit(0); }).catch(async function (e) {
  console.error('\nrefresh-ph failed:', e.message || e);
  if (_db) {
    await recordRunHealth(_db, 'ph', {
      status: 'failed', stage: STAGE.get(),
      durationMs: Date.now() - RUN_STARTED, message: e.message || String(e)
    });
  }
  process.exit(1);
});
