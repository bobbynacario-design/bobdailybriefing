// radar/retag-briefings.js
//
// Back-fills `market_category` / `market_subject` on the ph + markets stories of
// every stored briefing, using a LOCAL model (Ollama) so the pass costs nothing
// and no briefing content leaves the machine.
//
// WHY: index.html's phStoryCat prefers a model tag and falls back to a keyword
// heuristic. A survey found 601 ph/markets stories across 81 briefings and ZERO
// tags — the PSE tab has always run on the fallback. This fills them in.
//
// SAFETY. This rewrites documents the user owns, so:
//   - DRY-RUN IS THE DEFAULT. Nothing is written without --write.
//   - Every original `data` string is saved to a local backup file BEFORE the
//     first write, so a bad pass is reversible.
//   - Only market_category / market_subject / market_category_src are added.
//     The briefing JSON is otherwise re-serialised unchanged, and the doc's
//     `uid` and `saved` fields are never touched.
//   - Already-tagged stories are skipped, so re-running is idempotent (--force
//     re-tags them anyway).
//
//   cd radar
//   node retag-briefings.js                 # dry run, reports only
//   node retag-briefings.js --limit 3       # try a few docs first
//   node retag-briefings.js --write         # actually write
//
// Env: RETAG_BASE_URL (default http://localhost:11434/v1), RETAG_MODEL
// (default qwen2.5:7b).

import admin from 'firebase-admin';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPrompt, resolveTags, agreementStats, heuristicCategory } from '../lib/story-tagger.js';

var HERE = dirname(fileURLToPath(import.meta.url));
var ROOT = join(HERE, '..');   // repo root
var COLL = 'briefings-bob';
var SECTIONS = ['ph', 'markets'];

var ARGV = process.argv.slice(2);
var WRITE = ARGV.includes('--write');
var FORCE = ARGV.includes('--force');
var SHOW = ARGV.includes('--show');
var LIMIT = (function () {
  var i = ARGV.indexOf('--limit');
  return i !== -1 && ARGV[i + 1] ? parseInt(ARGV[i + 1], 10) : null;
})();

var BASE_URL = (process.env.RETAG_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, '');
var MODEL = process.env.RETAG_MODEL || 'qwen2.5:7b';
var BACKUP = join(HERE, 'retag-backup.json');

// ── helpers ───────────────────────────────────────────────────────────────

// Strip ``` fences and take the first JSON object. Small local models fence their
// output even when told not to.
function parseLooseJson(raw) {
  var s = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  var a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('no JSON object in model output');
  return JSON.parse(s.slice(a, b + 1));
}

async function askModel(prompt) {
  var res = await fetch(BASE_URL + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You classify news items. Return strict JSON only.' },
        { role: 'user', content: prompt }
      ],
      stream: false,
      response_format: { type: 'json_object' }
    })
  });
  var text = await res.text();
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + text.slice(0, 200));
  var json = JSON.parse(text);
  var msg = (json.choices || [])[0] && json.choices[0].message;
  var content = msg && (msg.content || msg.reasoning_content) || '';
  var usage = json.usage || {};
  return { answers: parseLooseJson(content),
           inTok: usage.prompt_tokens || 0, outTok: usage.completion_tokens || 0 };
}

function initFirestore() {
  var candidates = [join(HERE, 'serviceAccountKey.json'), join(ROOT, 'miro', 'serviceAccountKey.json')];
  for (var i = 0; i < candidates.length; i++) {
    if (existsSync(candidates[i])) {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(candidates[i], 'utf8'))) });
      console.log('firebase-admin: using ' + candidates[i]);
      return admin.firestore();
    }
  }
  throw new Error('no serviceAccountKey.json found in radar/ or miro/');
}

// Collect the stories needing a tag, remembering exactly where each came from so
// the tag can be written back to the right object.
// Returns { excluded, included }. INCLUSION is decided by the heuristic alone —
// the same rule the front end applies today — so this pass can never start
// hiding a story the app currently shows. Only `included` goes to the model, and
// only to be grouped specific-vs-macro.
function collectItems(parsed) {
  var excluded = [], included = [];
  SECTIONS.forEach(function (sec) {
    var arr = parsed && parsed.sections && parsed.sections[sec];
    if (!Array.isArray(arr)) return;
    arr.forEach(function (story, idx) {
      if (!story || typeof story !== 'object') return;
      if (story.market_category && !FORCE) return;   // idempotent
      var rec = { section: sec, index: idx, story: story };
      if (heuristicCategory(story, sec) === 'none') excluded.push(rec); else included.push(rec);
    });
  });
  return { excluded: excluded, included: included };
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('retag-briefings — model ' + MODEL + ' @ ' + BASE_URL);
  console.log(WRITE ? 'MODE: WRITE (documents will be modified)' : 'MODE: dry run (no writes; pass --write to apply)');

  var db = initFirestore();
  var snap = await db.collection(COLL).get();

  var docs = [];
  snap.forEach(function (d) {
    var v = d.data();
    if (!v || typeof v.data !== 'string') return;   // feature docs (radar-*, miro-*) have no `data`
    var parsed;
    try { parsed = JSON.parse(v.data); } catch (e) { console.log('  skip ' + d.id + ' — unparseable JSON'); return; }
    if (!parsed || !parsed.sections) return;
    docs.push({ id: d.id, raw: v.data, parsed: parsed });
  });
  docs.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  if (LIMIT) docs = docs.slice(0, LIMIT);

  console.log('briefings to consider: ' + docs.length);

  var backup = {};
  var totals = { docs: 0, items: 0, model: 0, heuristic: 0, agreed: 0, inTok: 0, outTok: 0,
                 cats: { specific: 0, macro: 0, none: 0 }, failedDocs: 0, written: 0 };
  var started = Date.now();

  for (var i = 0; i < docs.length; i++) {
    var doc = docs[i];
    var split = collectItems(doc.parsed);
    var items = split.included;
    if (!items.length && !split.excluded.length) { console.log('  ' + doc.id + ': nothing to tag'); continue; }

    // Stories the heuristic excludes are written as 'none' WITHOUT consulting the
    // model — that decision is not the model's to make (see lib/story-tagger.js).
    var tags = [];
    if (items.length) {
      try {
        var r = await askModel(buildPrompt(items));
        totals.inTok += r.inTok; totals.outTok += r.outTok;
        tags = resolveTags(items, r.answers);
      } catch (e) {
        // A failed call is not fatal: every item degrades to the heuristic the
        // app already uses, so the pass never leaves a doc worse than it started.
        totals.failedDocs++;
        console.log('  ' + doc.id + ': model call failed (' + (e.message || e) + ') — using heuristic');
        tags = items.map(function (it) {
          return { category: heuristicCategory(it.story, it.section), subject: '', source: 'heuristic' };
        });
      }
    }
    split.excluded.forEach(function (it) {
      items.push(it);
      tags.push({ category: 'none', subject: '', source: 'heuristic' });
    });

    var st = agreementStats(items, tags);
    totals.docs++; totals.items += st.n; totals.model += st.fromModel;
    totals.heuristic += st.fromHeuristic; totals.agreed += st.agreed;

    // Apply onto the parsed object in place.
    items.forEach(function (it, k) {
      var t = tags[k];
      var target = doc.parsed.sections[it.section][it.index];
      target.market_category = t.category;
      target.market_subject = t.subject;
      target.market_category_src = t.source;   // auditable: model vs heuristic
      totals.cats[t.category] = (totals.cats[t.category] || 0) + 1;
    });

    console.log('  ' + doc.id + ': ' + st.n + ' tagged (' + st.fromModel + ' model / ' +
      st.fromHeuristic + ' heuristic) · agrees with old heuristic ' + st.agreementPct + '%');

    // --show prints every call next to the heuristic's, because "eyeball it
    // before writing" is not advice anyone can act on without seeing the rows.
    if (SHOW) {
      items.forEach(function (it, k) {
        var t = tags[k], h = heuristicCategory(it.story, it.section);
        console.log('      ' + (t.category === h ? ' ' : '≠') + ' [' + it.section + '] ' +
          (t.category + ' ').padEnd(9) + (t.subject ? '(' + t.subject + ') ' : '') +
          'was:' + h.padEnd(8) + ' — ' + String(it.story.headline || '').slice(0, 78));
      });
    }

    if (WRITE) {
      backup[doc.id] = doc.raw;
      // Backup is flushed BEFORE the first write, and kept current after each,
      // so an interrupted run still leaves every touched doc recoverable.
      writeFileSync(BACKUP, JSON.stringify(backup, null, 2), 'utf8');
      await db.collection(COLL).doc(doc.id).set({ data: JSON.stringify(doc.parsed) }, { merge: true });
      totals.written++;
    }
  }

  var secs = Math.round((Date.now() - started) / 1000);
  console.log('\n===== summary =====');
  console.log('  briefings processed : ' + totals.docs);
  console.log('  stories tagged      : ' + totals.items +
    '  (model ' + totals.model + ' / heuristic fallback ' + totals.heuristic + ')');
  console.log('  categories          : specific ' + totals.cats.specific +
    ' · macro ' + totals.cats.macro + ' · none ' + totals.cats.none);
  console.log('  agrees with old FE heuristic: ' +
    (totals.items ? Math.round((totals.agreed / totals.items) * 1000) / 10 : 0) + '%' +
    '  (disagreement is expected — the heuristic is crude; eyeball before writing)');
  console.log('  failed model calls  : ' + totals.failedDocs + ' doc(s)');
  console.log('  tokens              : in ' + totals.inTok + ' / out ' + totals.outTok + '  ($0 — local)');
  console.log('  elapsed             : ' + secs + 's');
  if (WRITE) console.log('  WROTE ' + totals.written + ' doc(s); originals backed up to ' + BACKUP);
  else console.log('  dry run — nothing written. Re-run with --write to apply.');
  process.exit(0);
}

main().catch(function (e) { console.error('retag-briefings failed:', e); process.exit(1); });
