import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./weekly-mirror.js', import.meta.url), 'utf8');

function fixedDate(t) {
  return class extends Date {
    constructor(...args) { super(...(args.length ? args : [t])); }
    static now() { return t; }
  };
}
// A tiny DOM: enough for createElement / textContent / children.
function setup({now = '2026-09-26T04:00:00Z', uid = 'alice', ...extra} = {}) {
  const elements = new Map(), events = {};
  const make = (tag) => ({tag, value:'', textContent:'', className:'', children:[], handlers:{}, hidden:false, disabled:false, open:false,
    addEventListener(name, fn) { this.handlers[name] = fn; }, replaceChildren() { this.children = []; },
    appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); }});
  const element = (id) => { if (!elements.has(id)) elements.set(id, make('div')); return elements.get(id); };
  const context = {Date:fixedDate(Date.parse(now)), Intl, _firebaseUid:uid,
    document:{getElementById:element, createElement:make, createTextNode:(text) => ({textContent:text, children:[]}), addEventListener:(name, fn) => { events[name] = fn; }}, ...extra};
  context.window = context; vm.createContext(context); vm.runInContext(source, context); events.DOMContentLoaded();
  return {context, element:(name) => element('boost-mirror-' + name)};
}
const textOf = (node) => (node.textContent || '') + (node.children || []).map(textOf).join('');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const descendants = node => [node,...(node.children || []).flatMap(descendants)];

test('a slow history load cannot replace a freshly generated read',async()=>{
  let loaded;
  const {context,element}=setup({fbLoadWeeklyMirror:()=>new Promise(resolve=>loaded=resolve),fbGenerateWeeklyMirror:async()=>({mirror:MIRROR})});
  context.renderWeeklyMirror(); element('run').handlers.click(); await tick();
  loaded({}); await tick();
  assert.equal(element('body').hidden,false);
  assert.match(textOf(element('body')),/A week of starting again/);
});
test('generation waits for saving and stops if saving fails',async()=>{
  let saved, calls=0;
  const {context,element}=setup({fbLoadWeeklyMirror:async()=>({}),flushDailyBoost:()=>new Promise(resolve=>saved=resolve),fbGenerateWeeklyMirror:async()=>{calls++;return {mirror:MIRROR};}});
  context.renderWeeklyMirror(); await tick(); element('run').handlers.click();
  assert.match(element('status').textContent,/Saving your latest notes/); assert.equal(calls,0);
  saved(); await tick(); assert.equal(calls,1);
  context.flushDailyBoost=async()=>{throw Error('Notes could not sync');};
  element('run').handlers.click(); await tick(); assert.equal(calls,1); assert.match(element('status').textContent,/Notes could not sync/);
});
test('switching accounts while awaiting a save never generates for the new account',async()=>{
  let saved, calls=0;
  const {context,element}=setup({fbLoadWeeklyMirror:async()=>({}),flushDailyBoost:()=>new Promise(resolve=>saved=resolve),fbGenerateWeeklyMirror:async()=>{calls++;return {mirror:MIRROR};}});
  context.renderWeeklyMirror(); await tick(); element('run').handlers.click();
  context._firebaseUid='bob'; context.renderWeeklyMirror(); context._firebaseUid='alice'; context.renderWeeklyMirror();
  saved(); await tick(); assert.equal(calls,0);
});
test('theme days open exact entries and Try this keeps a review date and provenance',async()=>{
  let opened, created;
  const {context,element}=setup({fbLoadWeeklyMirror:async()=>({'2026-09-26':MIRROR}),openDailyBoostDay:key=>{opened=key;return true;},createDailyBoostExperiment:(...args)=>{created=args;return {ok:true,message:'Saved experiment'};}});
  context.renderWeeklyMirror(); await tick();
  const nodes=descendants(element('body'));
  nodes.find(n=>n.tag==='button' && n.textContent==='Mon').handlers.click();
  assert.equal(opened,'2026-09-21');
  nodes.find(n=>n.tag==='input').value='2026-09-30';
  nodes.find(n=>n.tag==='button' && n.textContent==='Try this').handlers.click();
  assert.equal(created[0],MIRROR.try_next.action); assert.equal(created[1],'2026-09-30'); assert.match(created[2],/2026-09-26/);
  assert.equal(context.WeeklyMirrorView.evidenceDay('2026-09-19',MIRROR),'','never jump outside the recorded week');
});

const MIRROR = {
  weekKey:'2026-09-26', range:{from:'2026-09-20', to:'2026-09-26'}, model:'gpt-5.5', generatedAt:'2026-09-26T11:12:00Z', followedUp:'2026-09-19',
  stats:{days:5, notes:4, done:3, opened:12, votes:0, noted:1, decisions:1},
  week_in_a_line:'A week of starting again, and meaning it.',
  themes:[{title:'Consistency', detail:'You wrote about it on Monday and Friday.', days:['Mon', 'Fri']}],
  energy:{gave:['Finishing the 10-minute quest'], drained:[]},
  said_vs_did:'You planned to call a former client and did not yet.', reading:'', decisions:'You wrote a thesis and a line for PLTR.', last_week:'',
  try_next:{action:'Call one former client before Wednesday', why:'Friday’s experiment'}, question:'What would consistent look like on your busiest day?', confidence:'fair',
};

// ── helpers ──

test('coverage names only what the week had, and errors read as next steps', () => {
  const {context} = setup(), view = context.WeeklyMirrorView;
  assert.equal(view.dayLabel('2026-09-26'), 'Sat 26 Sep');
  assert.equal(view.coverage(MIRROR), 'Week to Sat 26 Sep · 5 days of 7 with something recorded · 4 notes · 3 quests done · 12 stories opened · 1 decision');
  assert.equal(view.coverage({weekKey:'2026-09-26', stats:{days:1, notes:1}}), 'Week to Sat 26 Sep · 1 day of 7 with something recorded · 1 note');
  assert.match(view.errorText({code:'functions/resource-exhausted'}), /three reads today/);
  assert.match(view.errorText({code:'functions/internal', message:'internal'}), /needs a functions deploy/);
  assert.match(view.errorText({code:'functions/unauthenticated'}), /Sign in/);
  assert.equal(view.errorText({code:'functions/internal', message:'The read-back came back unusable. Try again in a minute.'}), 'The read-back came back unusable. Try again in a minute.');
});

// ── loading and showing ──

test('stored reads load for the account and the latest is shown in full', async () => {
  const older = Object.assign({}, MIRROR, {weekKey:'2026-09-19', week_in_a_line:'An older week.', followedUp:null});
  const {context, element} = setup({fbLoadWeeklyMirror:async (uid) => (uid === 'alice' ? {'2026-09-19':older, '2026-09-26':MIRROR} : {})});
  context.renderWeeklyMirror(); await tick();
  assert.equal(element('summary').textContent, 'Your week, read back · last read Sat 26 Sep');
  assert.equal(element('run').textContent, 'Read it again', 'already read today');
  assert.equal(element('week').hidden, false);
  assert.deepEqual(element('week').children.map((o) => o.value), ['2026-09-26', '2026-09-19'], 'newest first');
  const body = element('body'), all = textOf(body);
  assert.equal(body.hidden, false);
  assert.match(all, /A week of starting again, and meaning it\./);
  assert.match(all, /What kept coming up.*Consistency — You wrote about it on Monday and Friday\. \(Mon, Fri\)/s);
  assert.match(all, /Gave you energy.*Finishing the 10-minute quest/s);
  assert.doesNotMatch(all, /Took energy/, 'an empty list is left out');
  assert.doesNotMatch(all, /Where your attention went/, 'an empty paragraph is left out');
  assert.match(all, /How you decided.*PLTR/s);
  assert.match(all, /Try this week · something new.*Call one former client before Wednesday.*Friday’s experiment/s);
  assert.match(all, /What would consistent look like on your busiest day\?/);
  assert.match(all, /follows up the read from Sat 19 Sep/);
  assert.doesNotMatch(all, /tentative/);
  element('week').value = '2026-09-19'; element('week').handlers.change();
  assert.match(textOf(element('body')), /An older week\./);
});

test('a thin week says the read is tentative', async () => {
  const {context, element} = setup({fbLoadWeeklyMirror:async () => ({'2026-09-26':Object.assign({}, MIRROR, {confidence:'thin'})})});
  context.renderWeeklyMirror(); await tick();
  assert.match(textOf(element('body')), /A light week of notes, so this read is tentative/);
  assert.match(textOf(element('body')), /What kept coming up/, 'a theme across two days is a pattern');
});
test('themes seen on one day each are labelled what stood out', async () => {
  const single = Object.assign({}, MIRROR, {themes:[{title:'Self-understanding', detail:'Your Saturday note.', days:['Sat 26 Sep']}]});
  const {context, element} = setup({fbLoadWeeklyMirror:async () => ({'2026-09-26':single})});
  context.renderWeeklyMirror(); await tick();
  assert.match(textOf(element('body')), /What stood out/);
  assert.doesNotMatch(textOf(element('body')), /What kept coming up/);
});

test('with no reads yet the panel offers the first one and shows nothing else', async () => {
  const {context, element} = setup({fbLoadWeeklyMirror:async () => ({})});
  context.renderWeeklyMirror(); await tick();
  assert.equal(element('summary').textContent, 'Your week, read back');
  assert.equal(element('run').textContent, 'Read my week back');
  assert.equal(element('body').hidden, true);
  assert.equal(element('week').hidden, true);
  assert.equal(element('panel').open, false, 'not a Sunday: it stays closed');
});

test('Sundays open it once, and then it stays as left', async () => {
  const {context, element} = setup({now:'2026-09-27T04:00:00Z', fbLoadWeeklyMirror:async () => ({})});
  context.renderWeeklyMirror(); await tick();
  assert.equal(element('panel').open, true);
  element('panel').open = false; context.renderWeeklyMirror();
  assert.equal(element('panel').open, false);
});

// ── asking for a read ──

test('a read runs once at a time, then shows and opens', async () => {
  let release, calls = 0;
  const {context, element} = setup({fbLoadWeeklyMirror:async () => ({}), fbGenerateWeeklyMirror:() => { calls++; return new Promise((resolve) => { release = resolve; }); }});
  context.renderWeeklyMirror(); await tick();
  element('run').handlers.click();
  assert.equal(element('run').disabled, true);
  assert.equal(element('run').textContent, 'Reading your week…');
  assert.match(element('status').textContent, /about half a minute\. Your notes go to OpenAI for this read only\./);
  element('run').handlers.click();
  assert.equal(calls, 1, 'a second tap while reading does nothing');
  release({mirror:MIRROR}); await tick();
  assert.equal(element('run').disabled, false);
  assert.equal(element('run').textContent, 'Read it again');
  assert.equal(element('panel').open, true);
  assert.match(textOf(element('body')), /A week of starting again/);
  assert.equal(element('status').textContent, '');
});

test('an empty week and a failed read both say what to do next', async () => {
  let answer;
  const {context, element} = setup({fbLoadWeeklyMirror:async () => ({}), fbGenerateWeeklyMirror:() => answer()});
  context.renderWeeklyMirror(); await tick();
  answer = async () => ({mirror:null, reason:'empty'});
  element('run').handlers.click(); await tick();
  assert.match(element('status').textContent, /Nothing recorded in the last seven days yet/);
  answer = async () => { const error = new Error('limit'); error.code = 'functions/resource-exhausted'; throw error; };
  element('run').handlers.click(); await tick();
  assert.match(element('status').textContent, /three reads today/);
  assert.equal(element('run').disabled, false);
});

test('signed out it cannot run, and another account never sees the reads', async () => {
  const {context, element} = setup({uid:null, fbLoadWeeklyMirror:async (uid) => (uid === 'alice' ? {'2026-09-26':MIRROR} : {}), fbGenerateWeeklyMirror:async () => ({mirror:MIRROR})});
  context.renderWeeklyMirror(); await tick();
  assert.equal(element('run').disabled, true);
  context._firebaseUid = 'alice'; context.renderWeeklyMirror(); await tick();
  assert.equal(element('body').hidden, false);
  context._firebaseUid = 'bob'; context.renderWeeklyMirror();
  assert.equal(element('body').hidden, true, 'cleared at once on switch');
  await tick();
  assert.equal(element('body').hidden, true);
});
test('Start here learns when today has a read, and is told to refresh',async()=>{
  let refreshed=0;
  const {context}=setup({fbLoadWeeklyMirror:async()=>({'2026-09-26':MIRROR}),refreshDailyBoost:()=>{refreshed++;}});
  assert.equal(context.weeklyMirrorReadOn('2026-09-26'),false,'not before the reads load');
  context.renderWeeklyMirror(); await tick();
  assert.equal(context.weeklyMirrorReadOn('2026-09-26'),true);
  assert.equal(context.weeklyMirrorReadOn('2026-09-19'),false);
  assert.ok(refreshed>=1);
  context._firebaseUid='bob';
  assert.equal(context.weeklyMirrorReadOn('2026-09-26'),false,'never another account’s read');
});
