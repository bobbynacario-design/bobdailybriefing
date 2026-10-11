// Daily check: one read-only pass over everything that can quietly go wrong,
// for the "Daybook daily check" scheduled Claude task (11 Oct audit, step 1).
//
// Run locally by the owner: npm run check:daily
//   -- --out <dir>   also save the report there and say which problems are new
//                    since the last saved report (the task notifies only on new)
//   -- --usage [N]   add tap counts for the last N days (default 14), split into
//                    quiet days and build days by the commits made that day
//   -- --no-audit    skip the npm audit gate (it takes about a minute)
//
// It needs the same service-account key as check:real and only reads: the
// database, GitHub run results, the npm audit gate and this laptop's own
// scheduled refresh tasks. Each problem is ALERT (fix it) or WARN (look at it).
// It always exits 0; the last line says the status.

import {existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'functions', 'package.json'));
const args = process.argv.slice(2);
const flag = (name) => args.indexOf(name);
const outDir = flag('--out') >= 0 ? args[flag('--out') + 1] : null;
const usageDays = flag('--usage') >= 0 ? (Number(args[flag('--usage') + 1]) || 14) : 0;
const runAudit = flag('--no-audit') < 0;

const lines = [], problems = [];
const say = (text) => lines.push(text);
const alert = (key, text) => { problems.push({key, level: 'ALERT', text}); say('ALERT ' + text); };
const warn = (key, text) => { problems.push({key, level: 'WARN', text}); say('WARN  ' + text); };
const info = (text) => say('      ' + text);
const section = (title) => say('\n== ' + title + ' ==');

const pht = (at) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'}).format(at ? new Date(at) : new Date());
const phtTime = (at) => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(at));
const hoursAgo = (at) => (Date.now() - Date.parse(at)) / 3600000;
const today = pht();
const phtHour = Number(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Manila', hour: '2-digit', hour12: false}).format(new Date()));
const weekday = new Date(today + 'T12:00:00Z').getUTCDay(); // 0 = Sunday, in Manila
const marketDay = weekday >= 1 && weekday <= 5;
const run = (cmd, cmdArgs, opts) => spawnSync(cmd, cmdArgs, Object.assign({cwd: root, encoding: 'utf8', timeout: 240000}, opts || {}));
// npm is a .cmd on Windows, which only starts through a shell.
const runNpm = (script) => spawnSync('npm run ' + script, {cwd: root, encoding: 'utf8', timeout: 240000, shell: true});

// 1. The strict real-data check (its own script, so it stays the one source).
section('Correctness (check:real)');
{
  const r = run(process.execPath, [path.join(root, 'scripts', 'check-real-data.mjs')]);
  const out = String(r.stdout || '') + String(r.stderr || '');
  if (r.status === 2 || !/passed/.test(out)) alert('real:run', 'check:real did not run: ' + out.trim().split('\n').slice(-2).join(' / '));
  out.split('\n').filter((l) => l.startsWith('FAIL ')).forEach((l) => alert('real:' + l.slice(5).split(' — ')[0], l.slice(5)));
  const summary = out.split('\n').find((l) => /\d+ of \d+ passed/.test(l));
  if (summary) info(summary.trim());
}

const keyFile = [process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(root, 'radar', 'serviceAccountKey.json')].find((p) => p && existsSync(p));
if (!keyFile) {
  alert('key', 'No service-account key, so nothing in the database was checked.');
  finish();
}
const {initializeApp, cert} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
initializeApp({projectId: 'pokerhq-a67e4', credential: cert(JSON.parse(readFileSync(keyFile, 'utf8')))});
const db = getFirestore();
const COLL = 'briefings-bob';
const get = (id, coll) => db.collection(coll || COLL).doc(id).get().then((s) => (s.exists ? s.data() : null));
const unwrap = (doc) => { if (!doc) return null; if (typeof doc.value === 'string') { try { return JSON.parse(doc.value); } catch (e) { return null; } } return doc; };
const latest = async (prefix) => { const p = await get(prefix + '-latest'); return p && p.value ? {date: p.value, doc: unwrap(await get(prefix + '-' + p.value))} : null; };
const uid = process.env.DAYBOOK_UID || (await db.collection(COLL).listDocuments()).map((d) => d.id).filter((id) => /^ask-[A-Za-z0-9]{20,40}$/.test(id)).map((id) => id.slice(4))[0];

// 2. Feeds, from the run-health record every refresh writes.
section('Feeds');
// sports-pba: its laptop task was disabled on 8 Oct and PBA left Morning 5 on
// 9 Oct. Take it off this list if PBA comes back.
const RETIRED = ['sports-pba'];
const health = (await get('feed-health')) || {feeds: {}};
Object.entries(health.feeds || {}).sort().forEach(([name, f]) => {
  const since = f.lastOkAt ? phtTime(f.lastOkAt) : 'never';
  if (RETIRED.includes(name)) return info(name + ': retired (' + (f.status || '?') + ', last ok ' + since + ')');
  if (f.status === 'failed') return alert('feed:' + name, name + ' failing, last good ' + since + ': ' + (f.message || f.stage || 'no message'));
  const maxHours = name === 'radar' ? (marketDay ? 30 : 80) : name === 'grounding' ? 30 : 36;
  if (f.lastOkAt && hoursAgo(f.lastOkAt) > maxHours) return alert('feed:' + name + ':stale', name + ' has not run cleanly since ' + since);
  info(name + ': ' + (f.status || '?') + ', as of ' + (f.asOf || '?') + (f.message ? ' (' + String(f.message).slice(0, 70) + ')' : ''));
});

// 3. Radar: the 06:00 laptop task writes first and has no Claude key, and the
// GitHub run then skips because the day is already written (found 11 Oct).
section('Radar');
{
  const r = await latest('radar');
  if (!r || !r.doc) alert('radar:missing', 'No Radar document found.');
  else {
    const c = r.doc.catalystRun || {}, f = r.doc.forecastRun || {};
    const signals = r.doc.signals || [];
    info('radar-' + r.date + ' written ' + phtTime(r.doc.generatedAt) + ', prices as of ' + r.doc.asOf + ', ' + signals.length + ' names');
    info('Taker ' + ((r.doc.picks || {}).taker || []).join(', ') + ' · Wildcard ' + ((r.doc.picks || {}).wildcard || []).join(', '));
    const level = marketDay ? alert : warn;
    if (marketDay && r.date !== today && phtHour >= 10) alert('radar:not-today', 'No Radar for today (' + today + ') by ' + phtHour + ':00; latest is ' + r.date + '.');
    if (c.error || !c.reads) level('radar:reads', 'Radar ' + r.date + ' has no catalyst reads (' + (c.error || '0 reads') + ').');
    else info('Catalyst reads: ' + c.reads + ' by ' + c.model + (c.readsUnsourced ? ', ' + c.readsUnsourced + ' unsourced' : ''));
    if (f.status !== 'ok') level('radar:forecast', 'Radar ' + r.date + ' forecast panel ' + (f.status || 'missing') + (f.error ? ': ' + f.error : '') + '.');
    else info('Forecasts: ' + signals.filter((s) => s.forecast).length + ' of ' + (f.selected || []).length + ' selected');
    const noAsOf = signals.filter((s) => !s.dataAsOf).length;
    if (noAsOf) warn('radar:dataAsOf', noAsOf + ' Radar names have no dataAsOf.');
  }
}

// 4. Markets: the GitHub run rewrites the day, so a keyless early copy is only
// a problem if it is still there mid-morning.
section('Markets');
{
  const m = await latest('miro');
  const move = m && m.doc && (m.doc.moveRun || (m.doc.briefing || {}).moveRun);
  if (!m || !m.doc) warn('miro:missing', 'No Markets document found.');
  else if (!move) info('miro-' + m.date + ': no explanation record');
  else if (move.status !== 'ok' && m.date === today && phtHour >= 10) warn('miro:explanations', 'Markets ' + m.date + ' explanations ' + move.status + (move.error ? ': ' + move.error : '') + '.');
  else info('miro-' + m.date + ': explanations ' + move.status + (move.stats ? ' (' + move.stats.explained + '/' + move.stats.selected + ')' : ''));
}

// 5. Phone push: did it go out, and what did it lead with?
section('Push');
{
  const prefs = (await get('command-prefs-' + uid)) || {};
  const state = prefs.deliveryState || {}, audit = Array.isArray(state.audit) ? state.audit : [];
  const sent = audit.filter((a) => a.type === 'sent');
  const day = sent.filter((a) => hoursAgo(a.at) <= 24);
  if (!(prefs.delivery || {}).enabled) info('Push is switched off.');
  else if (!day.length) warn('push:none', 'No push sent in the last 24 hours' + (sent[0] ? ' (last ' + phtTime(sent[0].at) + ')' : '') + '.');
  day.filter((a) => a.failureCount).forEach((a) => alert('push:failed', 'Push at ' + phtTime(a.at) + ' failed on ' + a.failureCount + ' device(s).'));
  day.forEach((a) => {
    info(phtTime(a.at) + (a.kind ? ' (' + a.kind + ')' : '') + ': ' + a.itemCount + ' items, led by "' + a.lead + '"');
    // The full text, recorded since the 11 Oct push fix (bd0a742).
    if (a.body) String(a.title + '\n' + a.body).split('\n').forEach((line) => info('    | ' + line));
  });
  if (day.filter((a) => a.kind === 'morning').length > 1) warn('push:two-mornings', 'More than one morning push in a day.');
  if (day.some((a) => /^Reliability:/.test(a.lead || ''))) warn('push:reliability-lead', 'A push led with a reliability notice; those belong on Help, not first on your phone.');
  const recent = sent.slice(0, 8), counts = {};
  recent.forEach((a) => { const k = a.lead || ''; (counts[k] = counts[k] || new Set()).add(pht(a.at)); });
  Object.entries(counts).filter(([lead, days]) => days.size >= 3 && lead && !/^Reliability:/.test(lead))
    .forEach(([lead, days]) => warn('push:stale:' + lead, 'Push led with "' + lead + '" on ' + days.size + ' different days.'));
  if (state.tokenUpdatedAt && hoursAgo(state.tokenUpdatedAt) > 24 * 45) warn('push:token', 'Phone push token last refreshed ' + phtTime(state.tokenUpdatedAt) + '.');
  // Taps, counted by the app as push_open (from 11 Oct, v212).
  const usage = (await get('usage-' + uid)) || {days: {}};
  const week = Object.keys(usage.days || {}).filter((d) => d >= pht(Date.now() - 6 * 86400000));
  const taps = week.reduce((n, d) => n + (Number(usage.days[d].push_open) || 0), 0);
  const sentWeek = sent.filter((a) => hoursAgo(a.at) <= 24 * 7).length;
  info('Last 7 days: ' + sentWeek + ' push(es) sent, ' + taps + ' opened from a push');
}

// 6. GitHub: CI, publish and feed workflows over the last day.
section('GitHub runs');
{
  const r = run('gh', ['run', 'list', '--limit', '50', '--json', 'workflowName,conclusion,createdAt,status,databaseId']);
  let runs = null;
  try { runs = JSON.parse(r.stdout); } catch (e) { warn('gh:run', 'Could not read GitHub runs: ' + String(r.stderr || e.message).trim().slice(0, 120)); }
  if (runs) {
    const dayRuns = runs.filter((x) => hoursAgo(x.createdAt) <= 26);
    dayRuns.filter((x) => x.conclusion === 'failure').forEach((x) => alert('gh:' + x.workflowName, x.workflowName + ' failed at ' + phtTime(x.createdAt) + ' (run ' + x.databaseId + ').'));
    const tally = {};
    dayRuns.forEach((x) => { const k = x.workflowName + ' ' + (x.conclusion || x.status); tally[k] = (tally[k] || 0) + 1; });
    Object.entries(tally).forEach(([k, n]) => info(n + ' × ' + k));
  }
}

// 7. The npm audit gate: a new advisory blocks the next Pages publish even when
// no code changed (6 Oct).
section('Audit gate');
if (!runAudit) info('skipped (--no-audit)');
else {
  const r = runNpm('audit');
  if (r.status === 0) info('npm audit: clean at high and above');
  else alert('audit', 'npm audit fails at high or above, so the next publish would be blocked: ' + String(r.stdout || '').split('\n').filter((l) => /high|critical|Severity|fix available/i.test(l)).slice(0, 3).join(' / '));
}

// 8. This laptop's scheduled refreshes (Task Scheduler).
section('Laptop refresh tasks');
if (process.platform === 'win32') {
  const ps = "Get-ScheduledTask -TaskName 'BobDailyBriefing-*' | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; [pscustomobject]@{n=$_.TaskName; s=[string]$_.State; last=$i.LastRunTime.ToString('o'); r=$i.LastTaskResult; next=if ($i.NextRunTime) { $i.NextRunTime.ToString('o') } else { '' }} } | ConvertTo-Json -Compress";
  const r = run('powershell.exe', ['-NoProfile', '-Command', ps]);
  let tasks = [];
  try { tasks = [].concat(JSON.parse(r.stdout || '[]')); } catch (e) { warn('local:read', 'Could not read the laptop tasks.'); }
  tasks.forEach((t) => {
    const name = t.n.replace('BobDailyBriefing-', '');
    if (t.s === 'Disabled') return info(name + ': disabled');
    if (t.r !== 0 && t.r !== 267011) return warn('local:' + name, name + ' last run ' + phtTime(t.last) + ' ended with code ' + t.r + '.');
    info(name + ': ok, last ' + phtTime(t.last) + (t.next ? ', next ' + phtTime(t.next) : ''));
  });
}

// 9. The personal loops: is anything being used? (Information, never a problem.)
section('Your loops');
{
  const [review, goals, mirror, notes, ask, boost] = await Promise.all(['review', 'goals', 'weekly-mirror', 'client-notes', 'ask', 'daily-boost'].map((p) => get(p + '-' + uid)));
  const weeks = Object.entries((review && review.weeks) || {}).sort();
  const set = weeks.filter(([, w]) => (w.commitments || []).length);
  info('Weekly review: ' + (set.length ? set.length + ' week(s) with commitments; latest ' + set[set.length - 1][0] + ': ' + set[set.length - 1][1].commitments.map((c) => (c.ticks || []).length + ' ticks').join(', ') : 'no commitments set yet'));
  info('Goals: ' + (goals ? Object.keys(goals).filter((k) => !['uid', 'kind', 'updatedAt'].includes(k)).join(', ') || 'empty' : 'never set'));
  const mirrors = Object.keys((mirror && mirror.mirrors) || {}).sort();
  info('Weekly read: ' + (mirrors.length ? mirrors.length + ', latest ' + mirrors[mirrors.length - 1] : 'never run'));
  const decisions = await db.collection('journal-bob').where('uid', '==', uid).get().then((s) => s.docs.map((d) => d.data())).catch(() => []);
  const lastDecision = decisions.map((d) => d.createdDate || '').sort().pop();
  info('Decisions: ' + decisions.length + ' logged' + (lastDecision ? ', latest ' + String(lastDecision).slice(0, 10) : ''));
  const noteItems = Object.values((notes && notes.items) || {});
  const used = noteItems.filter((n) => n.usedAt), rated = noteItems.filter((n) => n.rating);
  info('Draft a note: ' + noteItems.length + ' drafted, ' + used.length + ' sent to mail, ' + rated.length + ' rated' + (rated.length ? ' (' + rated.map((n) => n.rating).join(', ') + ')' : ''));
  const asks = Object.values((ask && ask.items) || {}).filter((a) => a.generatedAt && hoursAgo(a.generatedAt) <= 24 * 7);
  info('Ask: ' + asks.length + ' question(s) in the last 7 days');
  const boostDays = Object.entries((boost && boost.entries) || {}).filter(([d]) => d >= pht(Date.now() - 14 * 86400000));
  info('Daily Boost: done on ' + boostDays.filter(([, e]) => e.done).length + ' of the last ' + boostDays.length + ' days with an entry');
  const brief = await db.collection(COLL).where('uid', '==', uid).orderBy('saved', 'desc').limit(1).get().then((s) => s.docs[0] && s.docs[0].data()).catch(() => null);
  if (brief) { const at = Number(brief.saved) < 1e12 ? Number(brief.saved) * 1000 : Number(brief.saved); info('Briefing: latest ' + phtTime(at) + (pht(at) === today ? ' (today)' : ' (not yet today)')); }
}

// 10. Optional: what got used, with build days kept apart. Days with many
// commits are mostly Bob trying out new features, not everyday use.
if (usageDays) {
  section('Usage, last ' + usageDays + ' days');
  const usage = (await get('usage-' + uid)) || {days: {}};
  const since = pht(Date.now() - (usageDays - 1) * 86400000);
  const log = run('git', ['log', '--since=' + since + 'T00:00:00+08:00', '--format=%cI', 'origin/main']);
  const commits = {};
  String(log.stdout || '').split('\n').filter(Boolean).forEach((iso) => { const d = pht(iso); commits[d] = (commits[d] || 0) + 1; });
  const days = Object.keys(usage.days || {}).filter((d) => d >= since).sort();
  const quiet = days.filter((d) => (commits[d] || 0) <= 4), build = days.filter((d) => (commits[d] || 0) > 4);
  info('Days with taps: ' + days.length + ' (quiet ' + quiet.length + ': ' + quiet.join(' ') + '; build ' + build.length + ')');
  const pages = {};
  quiet.forEach((d) => Object.entries(usage.days[d]).forEach(([k, n]) => { if (!/^page_|^fn_generatewithopenai$|^fn_runaskdaybook$|^card_deeper$|^dossier_note$|^checkin_|^push_open$|^today_ask/.test(k)) return; pages[k] = pages[k] || {taps: 0, days: 0}; pages[k].taps += n; pages[k].days += 1; }));
  Object.entries(pages).sort((a, b) => b[1].days - a[1].days || b[1].taps - a[1].taps)
    .forEach(([k, v]) => info(k.padEnd(26) + ' on ' + v.days + ' of ' + quiet.length + ' quiet days, ' + v.taps + ' taps'));
}

finish();

function finish() {
  const alerts = problems.filter((p) => p.level === 'ALERT'), warns = problems.filter((p) => p.level === 'WARN');
  let fresh = problems;
  if (outDir) {
    mkdirSync(outDir, {recursive: true});
    const lastFile = path.join(outDir, 'last.json');
    let before = [];
    try { before = JSON.parse(readFileSync(lastFile, 'utf8')).problems.map((p) => p.key); } catch (e) { /* first run */ }
    fresh = problems.filter((p) => !before.includes(p.key));
  }
  const head = ['Daybook daily check · ' + phtTime(Date.now()) + ' PHT'];
  if (fresh.length && fresh !== problems) head.push('NEW since the last report:', ...fresh.map((p) => '  ' + p.level + ' ' + p.text));
  const status = 'STATUS: ' + (problems.length ? alerts.length + ' alert(s), ' + warns.length + ' warning(s)' + (outDir ? ', ' + fresh.length + ' new' : '') : 'OK, nothing needs you');
  const text = head.concat(lines, ['', status]).join('\n');
  console.log(text);
  if (outDir) {
    writeFileSync(path.join(outDir, today + '.txt'), text + '\n');
    writeFileSync(path.join(outDir, 'last.json'), JSON.stringify({at: new Date().toISOString(), problems}, null, 1));
    readdirSync(outDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.txt$/.test(f)).sort().slice(0, -30).forEach((f) => unlinkSync(path.join(outDir, f)));
  }
  process.exit(0);
}
