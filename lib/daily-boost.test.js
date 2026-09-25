import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./daily-boost.js',import.meta.url),'utf8');
// A fixed, movable clock (default Fri 25 Sep 2026, noon PHT) so Sunday-only
// behaviour never depends on the day the suite runs.
function fixedDate(clock) {
  return class extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.t])); }
    static now() { return clock.t; }
  };
}
function setup({now = '2026-09-25T04:00:00Z', ...extra} = {}) {
  const elements = new Map(), saved = new Map(), timers = new Map(), clock = {t:Date.parse(now)};
  let timerId = 0;
  const make = () => ({value:'',textContent:'',children:[],handlers:{},focus(){},select(){},setAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;},replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);},append(...children){this.children.push(...children);}});
  const element = id => {
    if (!elements.has(id)) elements.set(id,make());
    return elements.get(id);
  };
  const events = {};
  const context = {Date:fixedDate(clock),_firebaseUid:'alice',setInterval(){},addEventListener:(name,fn)=>events['window:'+name]=fn,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},document:{hidden:false,getElementById:element,addEventListener:(name,fn)=>events[name]=fn,createElement:make},...extra};
  context.window=context; vm.createContext(context); vm.runInContext(source,context); events.DOMContentLoaded();
  const runTimers = () => { const pending=[...timers.values()]; timers.clear(); pending.forEach(fn=>fn()); };
  return {context,saved,events,runTimers,clock,element:name=>element('boost-'+name)};
}
test('daily prompts use PHT midnight and rotate across the expanded library',()=>{
  const {context}=setup(), core=context.DailyBoostCore;
  assert.equal(core.dateKey(new Date('2026-09-25T15:59:59Z')),'2026-09-25');
  assert.equal(core.dateKey(new Date('2026-09-25T16:00:00Z')),'2026-09-26');
  assert.equal(core.count,51);
  assert.equal(core.order.length,50,'the look-back is not in the rotation');
  assert.equal(new Set(Array.from({length:50},(_,i)=>core.promptFor('2026-09-25',i)[0])).size,50);
  assert.equal(core.promptFor('2026-09-25',50)[0],core.promptFor('2026-09-25',0)[0]);
});
test('rotation covers every regular spark, Sundays look back, and no theme repeats on consecutive days',()=>{
  const {context}=setup(), core=context.DailyBoostCore, order=[...core.order], days=[];
  assert.equal(new Set(order).size,order.length);
  assert.ok(!order.includes(core.review));
  order.forEach((spark,i)=>assert.notEqual(core.themes[spark],core.themes[order[(i+1)%order.length]]));
  for (let i=0;i<120;i++) days.push(new Date(Date.UTC(2026,8,25+i)).toISOString().slice(0,10));
  const sparks=days.map(day=>core.sparkFor(day,{}));
  days.forEach((day,i)=>assert.equal(sparks[i]===core.review,new Date(day+'T00:00:00Z').getUTCDay()===0,day));
  sparks.slice(1).forEach((spark,i)=>assert.notEqual(core.themes[spark],core.themes[sparks[i]],days[i+1]));
});
test('today and swaps skip sparks used in the last two weeks, and swaps change theme',()=>{
  const {context,saved,element}=setup(), core=context.DailyBoostCore, today=core.dateKey();
  const next=core.sparkFor(today,{}), recent=new Date(Date.parse(today+'T00:00:00Z')-3*86400000).toISOString().slice(0,10);
  const old=new Date(Date.parse(today+'T00:00:00Z')-20*86400000).toISOString().slice(0,10);
  assert.notEqual(core.sparkFor(today,{[recent]:{spark:next}}),next);
  assert.equal(core.sparkFor(today,{[old]:{spark:next}}),next);
  const after=core.nextSpark(next,{},today), skip=core.nextSpark(next,{[recent]:{spark:after}},today);
  assert.notEqual(core.themes[after],core.themes[next]);
  assert.notEqual(skip,after); assert.notEqual(skip,next);
  saved.set('bob-daily-boost:carol',JSON.stringify({[recent]:{spark:next,note:'Seen it',done:true}}));
  context._firebaseUid='carol'; context.renderDailyBoost();
  const shown=element('title').textContent;
  assert.notEqual(shown,element('library-list').children[next].children[0].textContent);
  element('swap').handlers.click();
  assert.notEqual(element('title').textContent,shown);
});
test('done or tucked days collapse to a strip on return, and reopen on request',()=>{
  const {context,saved,element}=setup(), compact=()=>/is-compact/.test(element('panel').className);
  assert.equal(compact(),false);
  element('note').value='Asked why the form has nine fields\nsecond line'; element('note').handlers.input();
  element('done').handlers.click();
  assert.equal(compact(),false,'stays open right after marking done so the note is at hand');
  context.renderDailyBoost();
  assert.equal(compact(),true);
  assert.match(element('compact-kicker').textContent,/small win/);
  assert.equal(element('compact-note').textContent,'“Asked why the form has nine fields”');
  element('open').handlers.click(); assert.equal(compact(),false);
  element('done').handlers.click(); context.renderDailyBoost(); assert.equal(compact(),false);
  element('tuck').handlers.click(); assert.equal(compact(),true);
  assert.match(element('compact-kicker').textContent,/tucked away/);
  context._firebaseUid='bob'; context.renderDailyBoost(); assert.equal(compact(),false);
  context._firebaseUid='alice'; context.renderDailyBoost(); assert.equal(compact(),true);
  assert.equal(JSON.parse(saved.get('bob-daily-boost:alice'))[context.DailyBoostCore.dateKey()].tucked,true);
});
test('the week row counts small wins without a streak, and old days stay out of it',()=>{
  const {context,saved,element}=setup(), today=context.DailyBoostCore.dateKey();
  const old=new Date(Date.parse(today+'T00:00:00Z')-9*86400000).toISOString().slice(0,10);
  saved.set('bob-daily-boost:carol',JSON.stringify({[old]:{spark:0,done:true,note:''}}));
  context._firebaseUid='carol'; context.renderDailyBoost();
  assert.equal(element('week').children.length,7);
  assert.match(element('week-label').textContent,/fresh week/);
  assert.equal(element('week').children.filter(dot=>/is-today/.test(dot.className)).length,1);
  element('done').handlers.click();
  assert.equal(element('week-label').textContent,'1 small win this week');
  assert.match(element('date').textContent,/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2} · /);
  context.renderDailyBoost(); assert.match(element('compact-kicker').textContent,/1 this week$/);
});
test('copy exports every reflection as text, with a manual fallback',async()=>{
  const {context,element}=setup();
  element('copy').handlers.click(); assert.match(element('copy-status').textContent,/Nothing to copy/);
  element('note').value='Two things clicked'; element('note').handlers.input(); element('done').handlers.click();
  element('copy').handlers.click();
  assert.equal(element('export').hidden,false);
  assert.match(element('export').value,/Two things clicked/);
  assert.match(element('export').value,/· done/);
  let copied=''; context.navigator={clipboard:{writeText:text=>{copied=text;return Promise.resolve();}}};
  element('copy').handlers.click(); await new Promise(resolve=>setImmediate(resolve));
  assert.match(copied,new RegExp(element('title').textContent));
  assert.equal(element('export').hidden,true);
  assert.equal(element('copy-status').textContent,'Copied 1 entry. Paste it anywhere you keep notes.');
});
test('work craft sparks are filterable by their label and show it on the card',()=>{
  const {element}=setup();
  element('theme').value='Craft'; element('theme').handlers.change();
  assert.equal(element('library-list').children.length,8);
  assert.match(element('library-summary').textContent,/Browse all 51 sparks/);
  element('theme').value=''; element('search').value='work craft'; element('search').handlers.input();
  assert.equal(element('library-list').children.length,8);
  element('search').value='but for'; element('search').handlers.input();
  const card=element('library-list').children[0];
  assert.equal(card.children[2].textContent,'Choose · Work craft');
  card.children[2].handlers.click();
  assert.equal(element('title').textContent,'Test the “but for” story');
  assert.match(element('date').textContent,/ · Work craft$/);
});
const tick = () => new Promise(resolve => setImmediate(resolve));
const copy = value => JSON.parse(JSON.stringify(value));
function fakeAccount(entries = {}) {
  const cloud = {entries:copy(entries), saves:[], loads:0, fail:false};
  cloud.fbLoadDailyBoost = async () => { cloud.loads++; return copy(cloud.entries); };
  cloud.fbSaveDailyBoost = async (uid, days, stale) => {
    if (cloud.fail) throw Error('offline');
    cloud.saves.push({uid, days:copy(days), stale:[...stale]});
    Object.assign(cloud.entries, copy(days)); stale.forEach(key => delete cloud.entries[key]);
  };
  return cloud;
}
const shift = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0,10);
test('merge keeps the newest edit per day and the fuller entry when neither is stamped',()=>{
  const {context}=setup(), merge=context.DailyBoostCore.merge;
  const result=merge(
    {'2026-09-20':{spark:1,note:'desktop, newer',updatedAt:200},'2026-09-21':{spark:2,note:'long legacy note on this device'},'2026-09-22':{spark:3,note:''},'2026-09-23':{spark:4,note:'only here'}},
    {'2026-09-20':{spark:1,note:'phone, older',updatedAt:100},'2026-09-21':{spark:2,note:'short'},'2026-09-22':{spark:5,note:'phone wins',updatedAt:50},'bad':{}}
  );
  assert.equal(result.records['2026-09-20'].note,'desktop, newer');
  assert.equal(result.records['2026-09-21'].note,'long legacy note on this device');
  assert.equal(result.records['2026-09-22'].note,'phone wins');
  assert.deepEqual([...result.upload].sort(),['2026-09-20','2026-09-21','2026-09-23']);
  assert.deepEqual([...result.stale],['bad']);
  const many={}; for (let i=0;i<92;i++) many[shift('2026-01-01',i)]={spark:0,note:'n'};
  const trimmed=merge({},many);
  assert.equal(Object.keys(trimmed.records).length,90);
  assert.deepEqual([...trimmed.stale],['2026-01-01','2026-01-02']);
  assert.equal(merge({'2026-09-24':{spark:0,note:''}},{}).upload.length,0,'an untouched day is not uploaded');
});
test('signing in merges the account copy, uploads device-only days, then writes only edited days',async()=>{
  const today='2026-09-25', yesterday=shift(today,-1);
  const cloud=fakeAccount({[today]:{spark:45,note:'From my phone',updatedAt:1000},bad:{spark:1}});
  const {element,runTimers}=setup({fbLoadDailyBoost:(...a)=>cloud.fbLoadDailyBoost(...a),fbSaveDailyBoost:(...a)=>cloud.fbSaveDailyBoost(...a),localStorage:{getItem:()=>JSON.stringify({[yesterday]:{spark:3,note:'Desktop only',done:true}}),setItem:()=>{}}});
  await tick(); await tick();
  assert.equal(cloud.loads,1);
  assert.equal(element('note').value,'From my phone');
  assert.equal(element('title').textContent,element('library-list').children[45].children[0].textContent);
  assert.equal(cloud.saves.length,1);
  assert.deepEqual(Object.keys(cloud.saves[0].days),[yesterday]);
  assert.deepEqual(cloud.saves[0].stale,['bad']);
  assert.match(element('status').textContent,/Synced across your devices/);
  element('note').value='From my phone, finished on desktop'; element('note').handlers.input();
  assert.match(element('status').textContent,/syncing/);
  runTimers(); await tick();
  assert.equal(cloud.saves.length,2);
  assert.deepEqual(Object.keys(cloud.saves[1].days),[today]);
  assert.equal(cloud.entries[today].note,'From my phone, finished on desktop');
  assert.ok(cloud.entries[today].updatedAt>1000);
});
test('a failed write keeps the day queued and retries with the next edit',async()=>{
  const cloud=fakeAccount();
  const {element,runTimers}=setup({fbLoadDailyBoost:(...a)=>cloud.fbLoadDailyBoost(...a),fbSaveDailyBoost:(...a)=>cloud.fbSaveDailyBoost(...a)});
  await tick();
  cloud.fail=true;
  element('note').value='Written on a train'; element('note').handlers.input(); runTimers(); await tick();
  assert.match(element('status').textContent,/out of reach for now/);
  cloud.fail=false;
  element('done').handlers.click(); runTimers(); await tick();
  const today=Object.keys(cloud.entries)[0];
  assert.equal(cloud.entries[today].note,'Written on a train');
  assert.equal(cloud.entries[today].done,true);
  assert.match(element('status').textContent,/Synced/);
});
test('leaving the page sends a pending edit at once, and an account switch mid-load is ignored',async()=>{
  const cloud=fakeAccount();
  let release;
  const slow={fbLoadDailyBoost:uid=>uid==='alice'?cloud.fbLoadDailyBoost(uid):new Promise(resolve=>{release=()=>resolve({[context.DailyBoostCore.dateKey()]:{spark:2,note:'Bob private note',updatedAt:Date.now()+1e9}});}),fbSaveDailyBoost:(...a)=>cloud.fbSaveDailyBoost(...a)};
  const {context,events,element}=setup(slow);
  await tick();
  element('note').value='Before lunch'; element('note').handlers.input();
  context.document.hidden=true; events.visibilitychange(); await tick();
  assert.equal(cloud.saves.length,1,'flushed without waiting for the timer');
  context.document.hidden=false;
  context._firebaseUid='bob'; context.renderDailyBoost();
  context._firebaseUid='alice'; context.renderDailyBoost();
  release(); await tick();
  assert.equal(element('note').value,'Before lunch');
});
test('Sunday looks back on the week, carries one note forward, and next week shows it',()=>{
  const week={
    '2026-09-21':{spark:3,note:'Asked why the claim form has nine fields',done:true},
    '2026-09-23':{spark:9,done:true,note:''},
    '2026-09-24':{spark:45,note:'Two matters shared the same missing lease',done:true},
    '2026-09-13':{spark:1,note:'Older than the week',done:true}
  };
  const {context,clock,saved,element}=setup({now:'2026-09-27T01:00:00Z'}), core=context.DailyBoostCore;
  saved.set('bob-daily-boost:carol',JSON.stringify(week));
  context._firebaseUid='carol'; context.renderDailyBoost();
  assert.equal(element('title').textContent,'Look back on your week');
  assert.match(element('date').textContent,/^Sun 27 Sep · Weekly look-back$/);
  assert.equal(element('lookback').hidden,false);
  const cards=element('lookback-list').children;
  assert.deepEqual(cards.map(card=>card.children[0].textContent.split(' · ')[0]),['Mon 21 Sep','Wed 23 Sep','Thu 24 Sep']);
  assert.equal(cards[1].children.length,2,'a small win without a note has nothing to carry');
  assert.match(element('lookback-count').textContent,/^3 days with a note or small win since Mon 21 Sep/);
  assert.equal(element('note').placeholder,'Next week I want to carry…');
  assert.equal(element('carried').hidden,true);
  cards[2].children[2].handlers.click();
  assert.equal(element('lookback-list').children[2].children[2].textContent,'✓ Carrying forward');
  assert.equal(JSON.parse(saved.get('bob-daily-boost:carol'))['2026-09-27'].carry,'2026-09-24');
  clock.t=Date.parse('2026-09-28T01:00:00Z'); context.renderDailyBoost();
  assert.notEqual(element('title').textContent,'Look back on your week');
  assert.equal(element('lookback').hidden,true);
  assert.equal(element('carried').hidden,false);
  assert.equal(element('carried').textContent,'Carrying forward from Thu 24 Sep: “Two matters shared the same missing lease”');
  assert.equal(element('note').placeholder,'Today I noticed…');
  clock.t=Date.parse('2026-10-03T01:00:00Z'); context.renderDailyBoost();
  assert.equal(element('carried').hidden,false,'still riding along on Saturday');
  clock.t=Date.parse('2026-10-04T01:00:00Z'); context.renderDailyBoost();
  assert.equal(element('title').textContent,'Look back on your week');
  assert.equal(element('carried').hidden,true,'a new look-back replaces it');
  assert.match(core.clean({'2026-09-27':{spark:core.review,carry:'next week'}})['2026-09-27'].carry,/^$/);
});
test('swapping away from the look-back resumes the rotation, and it can be picked from the library',()=>{
  const {context,clock,element}=setup({now:'2026-09-27T01:00:00Z'}), core=context.DailyBoostCore;
  element('swap').handlers.click();
  const swapped=element('title').textContent;
  assert.notEqual(swapped,'Look back on your week');
  assert.equal(core.nextSpark(core.review,{},'2026-09-27'),core.order[Math.floor(Date.parse('2026-09-27T00:00:00Z')/86400000)%core.order.length]);
  clock.t=Date.parse('2026-09-28T01:00:00Z'); context.renderDailyBoost();
  element('theme').value='Review'; element('theme').handlers.change();
  assert.equal(element('library-list').children.length,1);
  const card=element('library-list').children[0];
  assert.equal(card.children[2].textContent,'Choose · Weekly look-back');
  card.children[2].handlers.click();
  assert.equal(element('title').textContent,'Look back on your week');
  assert.equal(element('lookback').hidden,false);
});
test('legacy reflections retain the original 14-spark mapping',()=>{
  const {context}=setup();
  const migrated=context.DailyBoostCore.clean({'2026-09-25':{offset:0,note:'Original note',done:true}});
  assert.equal(migrated['2026-09-25'].spark,1);
  assert.equal(migrated['2026-09-25'].note,'Original note');
  assert.equal(context.DailyBoostCore.clean(migrated)['2026-09-25'].spark,1);
});
test('theme and search narrow the chooser, selection persists and completed quests stay fixed',()=>{
  const {context,element}=setup();
  element('theme').value='Creativity'; element('theme').handlers.change();
  assert.equal(element('library-list').children.length,6);
  element('search').value='imperfect'; element('search').handlers.input();
  assert.equal(element('library-list').children.length,1);
  element('note').value='Keep my note'; element('note').handlers.input();
  element('library-list').children[0].children[2].handlers.click();
  assert.equal(element('title').textContent,'Make three imperfect versions');
  context._firebaseUid='bob'; context.renderDailyBoost(); context._firebaseUid='alice'; context.renderDailyBoost();
  assert.equal(element('title').textContent,'Make three imperfect versions');
  assert.equal(element('note').value,'Keep my note');
  element('done').handlers.click(); element('swap').handlers.click();
  assert.equal(element('title').textContent,'Make three imperfect versions');
  element('search').value='no matching spark'; element('search').handlers.input();
  assert.match(element('library-list').textContent,/No sparks match/);
});
test('reflection and completion survive returning to an account without leaking to another',()=>{
  const {context,saved,element}=setup();
  element('note').value='A useful idea'; element('note').handlers.input();
  element('done').handlers.click();
  context._firebaseUid='bob'; context.renderDailyBoost();
  assert.equal(element('note').value,''); assert.equal(element('done').textContent,'I did it');
  context._firebaseUid='alice'; context.renderDailyBoost();
  assert.equal(element('note').value,'A useful idea'); assert.match(element('done').textContent,/Undo/);
  assert.equal(saved.size,1);
  element('done').handlers.click(); assert.equal(element('done').textContent,'I did it');
});
test('storage failure preserves the draft and reports that it was not saved',()=>{
  const {context,element}=setup();
  context.localStorage.setItem=()=>{throw Error('Quota');};
  element('note').value='Keep me'; element('note').handlers.input(); context.renderDailyBoost();
  assert.equal(element('note').value,'Keep me'); assert.match(element('status').textContent,/Could not save/);
});
test('stored values are bounded and malformed entries are discarded',()=>{
  const {context}=setup();
  const result=context.DailyBoostCore.clean({'bad':{},'2026-09-25':{energy:'invalid',offset:-8,done:'true',note:'x'.repeat(1300)}});
  assert.equal(Object.keys(result).length,1);
  assert.equal(result['2026-09-25'].note.length,1200);
  assert.equal(result['2026-09-25'].done,false);
  assert.equal(result['2026-09-25'].energy,'gentle');
});
