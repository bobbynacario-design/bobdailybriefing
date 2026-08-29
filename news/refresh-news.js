// news/refresh-news.js
//
// Runner for the Australian insurance news feed. This is the ONLY file in the
// module that does I/O: it fetches the configured RSS/Atom feeds, hands the
// bodies to the pure parser and ranker, and writes one Firestore doc per day
// plus a `news-latest` pointer. parse.js and rank.js never see any of this.
//
// Run locally on the Windows box:
//   cd news
//   npm install
//   node refresh-news.js --dry-run     inspect without writing
//   node refresh-news.js               write briefings-bob/news-<PHT date>
//
// A run is a no-op if today's news-<PHT date> doc already exists, so a catch-up
// trigger costs nothing after a successful run. Pass --force (or NEWS_FORCE=1)
// to re-run and overwrite the day.
//
// Firestore auth (firebase-admin, Admin SDK — bypasses security rules):
//   place a service-account key at news/serviceAccountKey.json (gitignored),
//   else radar/serviceAccountKey.json is reused (same project), else ADC.
//
// NO API KEY AND NO MODEL CALL. Every source is a public feed and the ranking is
// deterministic arithmetic, so this run adds nothing to the LLM cost ledger.
// That is the point of the module: the briefing's insurance section currently
// costs search tokens for sources it cannot name, and this costs nothing for
// sources it can.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CONFIG } from './config.js';
import { parseFeed } from './parse.js';
import { rankNews } from './rank.js';
import { recordRunHealth, makeStage } from '../lib/feed-health.js';
import { fetchRetry } from '../lib/http.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var __radar = join(__dirname, '..', 'radar');

var PROJECT_ID = 'pokerhq-a67e4';
var COLL = 'briefings-bob';
var FEED_KEY = 'news';

// Publishers can and do reject an unidentified client. Send a real, honest UA
// with a contact path rather than impersonating a browser.
var USER_AGENT = 'bobdailybriefing/1.0 (personal daily briefing; +https://github.com/bobbynacario-design/bobdailybriefing)';

var ARGV = process.argv.slice(2);
var DRY_RUN = ARGV.indexOf('--dry-run') !== -1;
var FORCE = ARGV.indexOf('--force') !== -1 || process.env.NEWS_FORCE === '1';

function nowStamp() {
  var d = new Date();
  var pht = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(d).replace(', ', ' ');
  return pht + ' PHT (' + d.toISOString() + ')';
}

var RUN_STARTED = Date.now();
var STAGE = makeStage('start');
var _db = null;

console.log('\n===== refresh-news run started ' + nowStamp() + ' =====');

// Today's date in Philippine time (PHT, UTC+8), as YYYY-MM-DD — the doc id.
// Mirrors radar and miro so every feed keys off the same local day.
function phtDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function initAdmin() {
  if (_db) return _db; // initializeApp throws if called twice
  var local = join(__dirname, 'serviceAccountKey.json');
  var shared = join(__radar, 'serviceAccountKey.json');
  var keyPath = existsSync(local) ? local : (existsSync(shared) ? shared : null);
  if (keyPath) {
    var sa = JSON.parse(readFileSync(keyPath, 'utf8'));
    initializeApp({ credential: cert(sa), projectId: PROJECT_ID });
    console.log('firebase-admin: using ' + keyPath);
  } else {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    console.log('firebase-admin: using application default credentials');
  }
  _db = getFirestore();
  return _db;
}

// Fetch one feed. Never throws: a dead publisher must not take down the other
// eight, so a failure is captured as a result row and surfaces on the doc as a
// named broken source.
async function fetchOne(feed) {
  var started = Date.now();
  try {
    var response = await fetchRetry(feed.url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8' }
    }, feed.id);
    var httpStatus = response.status;
    if (!response.ok) {
      return { feedId: feed.id, status: 'failed', httpStatus: httpStatus,
        items: [], message: 'HTTP ' + httpStatus, durationMs: Date.now() - started };
    }
    var body = await response.text();
    var parsed = parseFeed(body, { maxSummaryChars: CONFIG.window.maxSummaryChars });
    return {
      feedId: feed.id, status: 'ok', httpStatus: httpStatus,
      dialect: parsed.dialect, items: parsed.items,
      message: '', durationMs: Date.now() - started
    };
  } catch (error) {
    return { feedId: feed.id, status: 'failed', httpStatus: null, items: [],
      message: error && (error.message || String(error)), durationMs: Date.now() - started };
  }
}

async function fetchAll(feeds) {
  var results = [];
  for (var i = 0; i < feeds.length; i++) {
    var feed = feeds[i];
    var result = await fetchOne(feed);
    var detail = result.status === 'ok'
      ? (result.items.length + ' items (' + result.dialect + ')')
      : ('FAILED — ' + result.message);
    console.log('  ' + pad(feed.id, 15) + ' ' + detail);
    results.push(result);
  }
  return results;
}

function pad(value, width) {
  var text = String(value);
  while (text.length < width) text += ' ';
  return text;
}

async function alreadyWritten(db, dateKey) {
  var snap = await db.collection(COLL).doc('news-' + dateKey).get();
  return snap.exists;
}

async function writeDoc(db, dateKey, doc) {
  // No `uid` field: the front end reads briefings-bob docs that carry no uid
  // (rule: !('uid' in resource.data)). Admin SDK writes bypass rules anyway.
  var batch = db.batch();
  batch.set(db.collection(COLL).doc('news-' + dateKey), doc);
  batch.set(db.collection(COLL).doc('news-latest'), { value: dateKey });
  await batch.commit();
}

async function main() {
  var dateKey = phtDateKey();

  STAGE.set('init');
  var db = DRY_RUN ? null : initAdmin();

  if (db && !FORCE) {
    STAGE.set('check-existing');
    if (await alreadyWritten(db, dateKey)) {
      console.log('news-' + dateKey + ' already exists — nothing to do (use --force to overwrite).');
      await recordRunHealth(db, FEED_KEY, {
        status: 'skipped', asOf: dateKey, durationMs: Date.now() - RUN_STARTED
      });
      return;
    }
  }

  STAGE.set('fetch-feeds');
  console.log('Fetching ' + CONFIG.feeds.length + ' feeds...');
  var results = await fetchAll(CONFIG.feeds);

  STAGE.set('rank');
  var doc = rankNews(results, CONFIG, { dateKey: dateKey, now: Date.now() });

  // Every feed failing is a network or environment fault, not a quiet news day.
  // Writing an empty doc over a good one would erase yesterday's readable feed,
  // so refuse and let feed-health record the failure.
  if (doc.counts.feedsOk === 0) {
    throw new Error('all ' + doc.counts.feeds + ' feeds failed — refusing to write an empty day');
  }

  console.log('\n===== news-' + dateKey + ' =====');
  console.log('  feeds ok=' + doc.counts.feedsOk + '/' + doc.counts.feeds +
    '  fetched=' + doc.counts.fetched +
    '  unique=' + doc.counts.unique +
    '  kept=' + doc.counts.kept +
    '  undated=' + doc.counts.undated);
  doc.items.slice(0, 10).forEach(function (item, index) {
    console.log('  ' + pad(index + 1 + '.', 4) + pad(item.score, 7) + pad(item.tier, 9) +
      pad((item.ageDays == null ? 'undated' : item.ageDays + 'd'), 9) + item.title);
  });
  doc.warnings.forEach(function (warning) { console.log('  warning: ' + warning); });

  if (DRY_RUN) {
    console.log('\n--dry-run: NOT writing news-' + dateKey + ' / news-latest.');
    return;
  }

  STAGE.set('write');
  await writeDoc(db, dateKey, doc);
  console.log('\nWrote briefings-bob/news-' + dateKey + ' and news-latest = ' + dateKey + '.');

  await recordRunHealth(db, FEED_KEY, {
    status: 'ok', asOf: dateKey, durationMs: Date.now() - RUN_STARTED
  });
}

main().then(function () {
  console.log('===== refresh-news run finished ' + nowStamp() + ' =====\n');
  process.exit(0);
}).catch(async function (e) {
  console.error('\nrefresh-news failed:', e.message || e);
  if (_db && !DRY_RUN) {
    await recordRunHealth(_db, FEED_KEY, {
      status: 'failed', stage: STAGE.get(),
      durationMs: Date.now() - RUN_STARTED, message: e.message || String(e)
    });
  }
  process.exit(1);
});
