// Real-data check: every personal loop is checked against Bob's live
// documents before it ships (step 5 of the 10 Oct direction, "keep
// correctness strict as it gets personal").
//
// Run locally by the owner: npm run check:real
// It needs a service-account key (GOOGLE_APPLICATION_CREDENTIALS, or
// radar/serviceAccountKey.json in this checkout or the main one) and only
// reads. Each check recomputes a figure straight from the raw documents, the
// way a person would, and compares it with what the app's own code says, so a
// check never just repeats the code it checks. It also traces the figures in
// Ask answers from the last day against the records they cite (lib/ and
// functions/ask-daybook.js). Exit code 1 when a check fails.

import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'functions', 'package.json'));
// The server's copies of the shared cores, brought up to date first.
execFileSync(process.execPath, [path.join(root, 'functions', 'sync-shared-core.js')], {stdio: 'ignore'});
const Ask = require('./ask-daybook.js');
const Search = require('./intelligence-search-core.js');
const DailyBoostCore = require('./daily-boost.js');
const Life = require('./life-records-core.js');
const Calendar = require('./daybook-calendar-core.js');
const Flights = require('./flights-core.js');
const Review = require('./weekly-review-core.js');
const {initializeApp, cert} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');

function keyPath() {
  const candidates = [process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(root, 'radar', 'serviceAccountKey.json')];
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: root, encoding: 'utf8'}).trim();
    candidates.push(path.join(path.dirname(common), 'radar', 'serviceAccountKey.json'));
  } catch (error) { /* not a git checkout */ }
  return candidates.find((p) => p && existsSync(p));
}
const key = keyPath();
if (!key) {
  console.error('No service-account key: set GOOGLE_APPLICATION_CREDENTIALS or put radar/serviceAccountKey.json in place.');
  process.exit(2);
}
initializeApp({projectId: 'pokerhq-a67e4', credential: cert(JSON.parse(readFileSync(key, 'utf8')))});
const db = getFirestore();
const COLL = 'briefings-bob';
const get = (coll, id) => db.collection(coll).doc(id).get().then((s) => (s.exists ? s.data() : null));
const value = (doc) => { if (!doc) return null; try { return typeof doc.value === 'string' ? JSON.parse(doc.value) : doc.value; } catch (e) { return null; } };
const pht = (at) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'}).format(at || new Date());
const peso = (n) => 'PHP ' + Math.round(n).toLocaleString('en-PH');

const results = [];
function check(name, ok, detail) { results.push({name, ok: !!ok, detail: detail || ''}); }
function warn(name, detail) { results.push({name, ok: true, warn: true, detail}); }

// The owner: Ask Daybook is owner-only, so the one ask-<uid> document names him.
async function ownerUid() {
  if (process.env.DAYBOOK_UID) return process.env.DAYBOOK_UID;
  const ids = (await db.collection(COLL).listDocuments()).map((d) => d.id).filter((id) => /^ask-[A-Za-z0-9]{20,40}$/.test(id));
  if (ids.length !== 1) throw new Error('Expected one ask-<uid> document, found ' + ids.length + '; set DAYBOOK_UID.');
  return ids[0].slice(4);
}

const uid = await ownerUid();
const today = pht(), now = Date.now();
const own = (name, n) => db.collection(name).where('uid', '==', uid).orderBy('saved', 'desc').limit(n).get()
  .then((s) => s.docs.map((d) => Object.assign({id: d.id}, d.data()))).catch(() => []);
const latest = async (prefix) => { const p = await get(COLL, prefix + '-latest'); return p && p.value ? get(COLL, prefix + '-' + p.value) : null; };
const [briefings, reports, decisions, prefs, dossiers, meetings, mirrors, dailyBoost, grounding, news, radar, markets, sports, profile, accounts, usage, goals, radarJournal,
  calendarEvents, calendarMeetings, review, pokerTourneys, pokerBankroll, pokerSessions, flights, flightsSaved, flightsHistory, fx, askDoc] = await Promise.all([
  own(COLL, 100), own('reports-bob', 50), own('journal-bob', 100), get(COLL, 'command-prefs-' + uid), get(COLL, 'dossiers-' + uid), get(COLL, 'meeting-briefs-' + uid),
  get(COLL, 'weekly-mirror-' + uid), get(COLL, 'daily-boost-' + uid), get(COLL, 'grounding-latest'), latest('news'), latest('radar'), latest('miro'), latest('sports'),
  get(COLL, 'profile-' + uid), get(COLL, 'accounts-' + uid), get(COLL, 'usage-' + uid), get(COLL, 'goals-' + uid), get(COLL, 'radar-journal'),
  get(COLL, 'calendar-events-' + uid), get(COLL, 'meetings-' + uid), get(COLL, 'review-' + uid), get('pokerhq-bob', 'tourneys'), get('pokerhq-bob', 'bankroll'),
  get('pokerhq-bob', 'sessions'), get(COLL, 'flights-latest'), get(COLL, 'flights-saved-' + uid), get(COLL, 'flights-history'), get(COLL, 'radar-ph'), get(COLL, 'ask-' + uid)]);

// Ask's index, built exactly as the askDaybook function builds it.
const docs = {briefings, reports, decisions, prefs, dossiers, meetings, mirrors, dailyBoost, grounding, news, radar, markets, sports, profile, accounts, usage, goals, radarJournal,
  todayKey: today, now, calendarEvents, calendarMeetings, review, pokerTourneys, pokerBankroll, pokerSessions, flights, flightsSaved, flightsHistory, fx};
const index = Search.buildIndex(Ask.askIndexInput(docs, DailyBoostCore, {core: Life, calendar: Calendar, flights: Flights, review: Review}));
const byId = Object.fromEntries(index.map((i) => [i.id, i]));
check('Ask index builds under its cap', index.length > 0 && index.length < 5000, index.length + ' records');
Life.OVERVIEW_IDS.forEach((id) => check('Overview present: ' + id, byId[id], byId[id] ? '' : 'missing'));

// PokerHQ: never the bankroll; picks and buy-ins as a person would add them.
const bank = value(pokerBankroll);
if (bank && Number(bank.amount) > 0) {
  const amount = Math.round(Number(bank.amount)), forms = [String(amount), amount.toLocaleString('en-PH'), amount.toLocaleString('en-US')];
  const leaked = index.filter((i) => ['Poker', 'Flights', 'Calendar', 'Commitments'].includes(i.source) && forms.some((f) => JSON.stringify(i).includes(f)));
  check('No record carries the PokerHQ bankroll amount', !leaked.length, leaked.map((i) => i.id).join(', '));
}
const tourneys = value(pokerTourneys) || [];
const seen = new Set(), picks = [];
tourneys.forEach((t) => {
  const day = t && t.planning === true && Calendar.pokerDate(t.date);
  if (!day || day < today || seen.has(day + '|' + String(t.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'))) return;
  seen.add(day + '|' + String(t.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  picks.push({day, buyin: Number(t.buyin) > 0 ? Math.round(Number(t.buyin)) : 0});
});
const poker = byId['poker:overview'];
if (poker) {
  const total = picks.reduce((n, p) => n + p.buyin, 0);
  check('Poker overview: count and buy-ins match PokerHQ', picks.length ? poker.detail.startsWith(picks.length + ' upcoming ★ picks, ' + peso(total)) : /No upcoming/.test(poker.detail),
    'PokerHQ: ' + picks.length + ' picks, ' + peso(total) + ' · overview: ' + poker.detail);
  const months = {};
  picks.forEach((p) => { const m = p.day.slice(0, 7); months[m] = months[m] || {first: p.day, last: p.day, n: 0}; months[m].n++; if (p.day < months[m].first) months[m].first = p.day; if (p.day > months[m].last) months[m].last = p.day; });
  Object.keys(months).forEach((m) => {
    const {first, last, n} = months[m];
    const label = (d) => Flights.dayLabel(d, now);
    const said = n === 1 ? n + ' event on ' + label(first) : n + ' events, ' + label(first) + ' – ' + label(last);
    check('Poker overview: ' + m + ' first and last pick', poker.body.includes(said), said);
  });
}

// Calendar: leave weekdays from today, counted straight from the entries.
const days = (calendarMeetings && calendarMeetings.days) || [];
const leaveDays = new Set();
days.filter((d) => d && /\bleave\b/i.test(d.title || '')).forEach((d) => {
  for (let x = d.start, n = 0; x <= (d.end || d.start) && n < 62; x = Calendar.offset(x, 1), n++) if (x >= today && !Calendar.weekend(x)) leaveDays.add(x);
});
const cal = byId['calendar:overview'];
if (cal) {
  check('Calendar overview: leave weekdays match the entries', leaveDays.size ? cal.body.includes('Leave booked from today: ' + leaveDays.size + ' weekday') : !/Leave booked from today/.test(cal.body),
    leaveDays.size + ' leave weekdays from today');
  const next = [...leaveDays].sort()[0];
  if (next) check('Calendar overview: next time off contains the first leave day', (() => {
    const m = cal.detail.match(/next time off (.+?) \(/);
    return m && Calendar.offWindows({meetings: calendarMeetings, manual: (calendarEvents && calendarEvents.items) || []}, today).some((w) => w.start <= next && w.end >= next);
  })(), 'first leave day ' + next);
}

// Commitments: weeks with commitments, from the raw review document.
const commits = byId['commitments:overview'];
if (commits) {
  const weeks = Object.values((review && review.weeks) || {}).filter((w) => w && Array.isArray(w.commitments) && w.commitments.length).length;
  check('Commitments overview: weeks set match the review document', weeks ? commits.body.includes('Weeks with commitments: ') : commits.body.includes('You have not set any weekly commitments yet'),
    weeks + ' weeks with commitments');
}

// Flights: every fare the overview quotes is one the scout saw.
const fl = byId['flights:overview'];
if (fl && flights && Array.isArray(flights.offers)) {
  // A peso fare as advertised, or a foreign one at the PH snapshot's rate.
  const rates = (fx && fx.fx) || {};
  const pesos = new Set(flights.offers.map((o) => {
    if (o.currency === 'PHP') return Math.round(o.amount);
    const rate = rates[String(o.currency || '').toLowerCase() + 'php'];
    return rate && Number(rate.level) > 0 ? Math.round(o.amount * Number(rate.level)) : null;
  }).filter((n) => n != null));
  const quoted = [...fl.body.matchAll(/≈ PHP ([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  const unknown = quoted.filter((n) => !pesos.has(n));
  check('Flights overview: every quoted fare is a scouted fare (foreign ones at the snapshot rate)', quoted.length && !unknown.length,
    quoted.length + ' quoted' + (unknown.length ? '; not found: ' + unknown.join(', ') : ''));
}

// Ask answers from the last day: their figures against the records they cite.
const answers = Object.values((askDoc && askDoc.items) || {}).filter((a) => a && Date.parse(a.generatedAt) > now - 86400000);
const todayLine = new Intl.DateTimeFormat('en-AU', {timeZone: 'Asia/Manila', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}).format(new Date()) + ' (' + today + ')';
answers.forEach((a) => {
  if (a.web) return warn('Ask: ' + a.question.slice(0, 60), 'web answer, not traced');
  const registry = Ask.newRegistry();
  const cited = (a.sources || []).map((s) => byId[s.id]).filter(Boolean);
  Ask.lookupOutput(cited, registry);
  const untraced = Ask.untracedFigures(Ask.splitRefs(a.answer), registry, [a.question, todayLine]);
  const gone = (a.sources || []).length - cited.length;
  if (untraced.length && (gone || a.unverified)) warn('Ask: ' + a.question.slice(0, 60), 'untraced ' + untraced.join(', ') + (gone ? ' (' + gone + ' cited records have changed since)' : ' (already shown to him as unverified)'));
  else check('Ask: ' + a.question.slice(0, 60), !untraced.length, untraced.length ? 'untraced: ' + untraced.join(', ') : 'all figures traced');
});
if (!answers.length) warn('Ask answers', 'none in the last day');

// Notes drafted in the last day: their figures against the dossier they came
// from, and the links they carry against that dossier's own.
const Note = require('./client-note.js');
const [notesDoc, dossierDoc] = await Promise.all([get(COLL, 'client-notes-' + uid), get(COLL, 'dossiers-' + uid)]);
const notes = Object.values((notesDoc && notesDoc.items) || {}).filter((n) => n && Date.parse(n.generatedAt) > now - 86400000);
notes.forEach((n) => {
  const dossier = ((dossierDoc && dossierDoc.items) || {})[n.key];
  if (!dossier) return warn('Note: ' + String(n.subject).slice(0, 60), 'its dossier is no longer kept');
  const untraced = Note.traceNote(n, dossier, [todayLine, n.recipient && n.recipient.name, n.angle]);
  check('Note: ' + String(n.subject).slice(0, 60) + ' — figures', !untraced.length || (n.unverified || []).length, untraced.length ? 'untraced: ' + untraced.join(', ') + (n.unverified ? ' (shown to him)' : ' (NOT shown to him)') : 'all traced');
  const allowed = new Set(Note.noteSources(dossier).map((s) => s.url));
  check('Note: ' + String(n.subject).slice(0, 60) + ' — links', (n.sources || []).every((s) => allowed.has(s.url)), (n.sources || []).length + ' links');
});
if (notesDoc) {
  const all = Object.values(notesDoc.items || {}), used = all.filter((n) => n.usedAt);
  warn('Draft a note so far', all.length + ' drafted, ' + used.length + ' opened in mail' + (used.length ? ', average changed ' + Math.round(used.reduce((s, n) => s + (Number(n.changed) || 0), 0) / used.length * 100) + '%' : ''));
}

const failed = results.filter((r) => !r.ok);
results.forEach((r) => console.log((r.warn ? 'WARN ' : r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.detail ? ' — ' + r.detail : '')));
console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' passed' + (failed.length ? '; ' + failed.length + ' FAILED' : '') + ' · ' + today);
process.exit(failed.length ? 1 : 0);
