// radar/refresh-ph.js
//
// Standalone PH-snapshot refresh. The full radar runs at 06:00 PHT — BEFORE the
// PSE opens (09:30) — so its snapshot is yesterday's close. This lightweight
// runner re-builds ONLY the PH snapshot after the close (~16:00 PHT) so the PSE
// tab shows today's actual close, without re-fetching the (closed) US markets or
// paying for the OpenAI catalyst call.
//
// Run:  cd radar ; node refresh-ph.js
// Secrets: reuses radar/.env + radar/serviceAccountKey.json (same as the radar).

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CONFIG } from './config.js';
import { buildPhSnapshot, writePhSnapshot } from './ph-snapshot.js';

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

function initAdmin() {
  var keyPath = join(__dirname, 'serviceAccountKey.json');
  if (existsSync(keyPath)) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), projectId: PROJECT_ID });
    console.log('firebase-admin: using radar/serviceAccountKey.json');
  } else {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    console.log('firebase-admin: using application default credentials');
  }
  return getFirestore();
}

async function main() {
  var ph = await buildPhSnapshot(CONFIG);
  var phDoc = Object.assign({ generatedAt: new Date().toISOString(), asOf: ph.index.asOf }, ph);

  console.log('\n===== briefings-bob/radar-ph =====');
  console.log('  PSEi ' + ph.index.close + ' ' + ph.index.currency + ' (' + ph.index.asOf + ')' +
    '  day ' + ph.index.dayChangePct + '%  1m ' + ph.index.ret1m + '%  YTD ' + ph.index.retYtd + '%' +
    '  RSI ' + ph.index.rsi14 + '  vs SMA200 ' + (ph.index.aboveSma200 ? 'above' : 'below'));
  if (ph.fx && ph.fx.usdphp) console.log('  USD/PHP ' + ph.fx.usdphp.level + ' (1m ' + ph.fx.usdphp.ret1m + '%)');
  console.log('  proxies: ' + ph.proxies.length);

  var db = initAdmin();
  var wrote = await writePhSnapshot(db, COLL, phDoc);
  console.log(wrote
    ? '\nWrote briefings-bob/radar-ph (after-close refresh).'
    : '\nSkipped briefings-bob/radar-ph write — stored snapshot is newer.');
}

main().then(function () { process.exit(0); }).catch(function (e) {
  console.error('\nrefresh-ph failed:', e.message || e);
  process.exit(1);
});
