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
  const context = {Date:fixedDate(clock),_firebaseUid:'alice',setInterval(){},addEventListener:(name,fn)=>events['window:'+name]=fn,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},document:{hidden:false,querySelector:()=>null,getElementById:element,addEventListener:(name,fn)=>events[name]=fn,createElement:make},...extra};
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
test('flush waits for a pending save and includes edits made while it was in flight',async()=>{
  const cloud=fakeAccount(), saves=[]; let finish;
  const {context,element}=setup({fbLoadDailyBoost:(...args)=>cloud.fbLoadDailyBoost(...args),fbSaveDailyBoost:(uid,entries)=>{saves.push(copy(entries));return new Promise(resolve=>finish=()=>resolve(entries));}});
  await tick();
  element('note').value='First draft'; element('note').handlers.input();
  const flushed=context.flushDailyBoost(); await tick(); assert.equal(saves.length,1);
  element('note').value='Final draft'; element('note').handlers.input();
  finish(); await tick(); assert.equal(saves.length,2); finish(); await flushed;
  assert.equal(saves[1]['2026-09-25'].note,'Final draft');
});
test('flush fails closed when the account save fails',async()=>{
  const cloud=fakeAccount();
  const {context,element}=setup({fbLoadDailyBoost:(...args)=>cloud.fbLoadDailyBoost(...args),fbSaveDailyBoost:(...args)=>cloud.fbSaveDailyBoost(...args)});
  await tick(); cloud.fail=true;
  element('note').value='Keep this draft'; element('note').handlers.input();
  await assert.rejects(context.flushDailyBoost(),/could not sync/);
  assert.equal(element('note').value,'Keep this draft');
});
test('suggested experiments preserve provenance and refuse to overwrite existing work',()=>{
  const {context,saved,element}=setup();
  assert.equal(context.createDailyBoostExperiment('Check a premise','2026-02-30','Source').ok,false);
  assert.equal(context.createDailyBoostExperiment('Check a premise','2026-09-26','Wrong if: evidence changes. Source: https://example.com').ok,true);
  assert.equal(context.createDailyBoostExperiment('Another action','2026-09-27','Other').ok,false);
  const entry=JSON.parse(saved.get('bob-daily-boost:alice'))['2026-09-25'];
  assert.equal(entry.trialPlan,'Check a premise'); assert.match(entry.trialSource,/https:\/\/example.com/);
  element('note').value='x'.repeat(1199); element('note').handlers.input();
  assert.equal(context.noteDailyBoostInsight('New aha'),false); assert.equal(element('note').value.length,1199);
});
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
test('two devices merge independent edits atomically and preserve conflicting notes',async()=>{
  const day='2026-09-25';
  let remote={};
  const a=setup(), core=a.context.DailyBoostCore;
  const cloud={fbLoadDailyBoost:async()=>copy(remote),fbSaveDailyBoost:async(uid,entries)=>{remote=copy(core.merge(entries,remote).records);return copy(remote);}};
  const laptop=setup(cloud), phone=setup(cloud);
  await tick(); await tick();
  laptop.element('note').value='A new idea from my laptop'; laptop.element('note').handlers.input();
  phone.context.toggleBriefingReminder({headline:'Release',metric:'Due 25 Sep',url:'https://example.com/release'});
  laptop.runTimers(); await tick(); phone.runTimers(); await tick();
  assert.equal(remote[day].note,'A new idea from my laptop');
  assert.equal(remote[day].reminders[0].due,day);
  assert.equal(phone.element('note').value,'A new idea from my laptop');
  laptop.clock.t+=2000; phone.clock.t+=3000;
  laptop.element('note').value='Laptop divergent edit'; laptop.element('note').handlers.input();
  phone.element('note').value='Phone divergent edit'; phone.element('note').handlers.input();
  laptop.runTimers(); await tick(); phone.runTimers(); await tick();
  assert.equal(remote[day].note,'Phone divergent edit');
  assert.ok(remote[day].noteVersions.some(v=>v.text==='Laptop divergent edit'));
  assert.equal(phone.element('conflicts-wrap').hidden,false);
});
test('a cancelled reminder stays cancelled when an older device copy returns',()=>{
  const {context}=setup(), core=context.DailyBoostCore, day='2026-09-25';
  const reminder={headline:'Release',metric:'Check',due:day,url:'https://example.com/release'};
  const older={[day]:{spark:1,updatedAt:100,reminders:[reminder]}};
  const newer={[day]:{spark:1,updatedAt:200,reminders:[],listClocks:{reminders:{'u:example.com/release|Check':200}}}};
  assert.equal(core.merge(older,newer).records[day].reminders.length,0);
});
test('intention selects a fitting spark, favourites filter and survive sign-in changes',()=>{
  const {context,element}=setup();
  element('intention').value='calm'; element('intention').handlers.change();
  assert.match(element('date').textContent,/Rest & reset/);
  const title=element('title').textContent;
  element('favourite').handlers.click(); element('favourites-only').checked=true; element('favourites-only').handlers.change();
  assert.equal(element('library-list').children.length,1);
  assert.equal(element('library-list').children[0].children[0].textContent,title);
  context._firebaseUid='bob'; context.renderDailyBoost(); assert.equal(element('library-list').children.length,0);
  context._firebaseUid='alice'; context.renderDailyBoost(); assert.equal(element('library-list').children.length,1);
  element('favourite').handlers.click(); assert.equal(element('library-list').children.length,0);
});
test('an experiment comes back due, retains its outcome, and can be reopened',()=>{
  const {context,element,clock}=setup();
  element('trial-plan').value='Try a shorter opening paragraph'; element('trial-due').value='2026-09-27'; element('trial-save').handlers.click();
  assert.equal(element('experiments-panel').hidden,false);
  clock.t=Date.parse('2026-09-27T04:00:00Z'); context.renderDailyBoost();
  let row=element('experiments').children[0]; assert.match(row.children[1].textContent,/Ready to revisit/);
  const outcome=row.children[2].children[0]; outcome.value='The reader found the main point faster.'; outcome.handlers.input(); row.children[4].handlers.click();
  row=element('experiments').children[0]; assert.match(row.children[1].textContent,/Reviewed/);
  context._firebaseUid='bob'; context.renderDailyBoost(); assert.equal(element('experiments-panel').hidden,true);
  context._firebaseUid='alice'; context.renderDailyBoost(); row=element('experiments').children[0];
  assert.equal(row.children[2].children[0].value,'The reader found the main point faster.');
  row.children[4].handlers.click(); assert.match(element('experiments').children[0].children[1].textContent,/Ready to revisit/);
});
test('merge keeps the newest edit per day and the fuller entry when neither is stamped',()=>{
  const {context}=setup(), merge=context.DailyBoostCore.merge;
  const result=merge(
    {'2026-09-20':{spark:1,note:'desktop, newer',updatedAt:200},'2026-09-21':{spark:2,note:'long legacy note on this device'},'2026-09-22':{spark:3,note:''},'2026-09-23':{spark:4,note:'only here'}},
    {'2026-09-20':{spark:1,note:'phone, older',updatedAt:100},'2026-09-21':{spark:2,note:'short'},'2026-09-22':{spark:5,note:'phone wins',updatedAt:50},'bad':{}}
  );
  assert.equal(result.records['2026-09-20'].note,'desktop, newer');
  assert.equal(result.records['2026-09-21'].note,'long legacy note on this device');
  assert.equal(result.records['2026-09-22'].note,'phone wins');
  assert.deepEqual([...result.upload].sort(),['2026-09-20','2026-09-21','2026-09-22','2026-09-23']);
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
  assert.deepEqual(Object.keys(cloud.saves[0].days).sort(),[yesterday,today],'legacy days gain per-field sync metadata');
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
function linkedDay(spark = 11) {
  const {context}=setup(), core=context.DailyBoostCore;
  for (let i=0;i<400;i++) { const day=shift('2026-09-25',i); if (core.sparkFor(day,{})===spark) return day; }
  throw Error('no linked day in range');
}
test('the briefing-linked spark names the top story, jumps to it, and keeps it once started',()=>{
  const day=linkedDay(), jumps=[];
  let story={headline:'Insurer lifts BI reserves after flood',source:'Insurance News',isToday:true,dateLabel:'today'};
  const {context,saved,element}=setup({now:day+'T04:00:00Z',dailyBoostBriefingItem:()=>story,highlightSourceTitle:(title,page)=>{jumps.push([title,page]);return true;}});
  assert.equal(element('title').textContent,'Turn a headline into a question');
  assert.equal(element('quest').textContent,'From today’s briefing: “Insurer lifts BI reserves after flood”. Write: “What would I need to know before acting on this?”');
  assert.equal(element('briefing-jump').hidden,false);
  element('briefing-jump').handlers.click();
  assert.deepEqual(jumps,[['Insurer lifts BI reserves after flood','today']]);
  element('stretch').handlers.click();
  assert.equal(element('quest').textContent,'From today’s briefing: “Insurer lifts BI reserves after flood” (Insurance News). Open the original source and separate what it establishes from what you are inferring.');
  assert.equal(JSON.parse(saved.get('bob-daily-boost:alice'))[day].ref,'Insurer lifts BI reserves after flood');
  story={headline:'A later story',source:'Wire',isToday:true}; context.refreshDailyBoost();
  assert.match(element('quest').textContent,/“Insurer lifts BI reserves after flood” \(Insurance News\)/);
  element('gentle').handlers.click();
  assert.match(element('quest').textContent,/^The briefing story you started with: “Insurer lifts/);
  assert.equal(element('briefing-jump').hidden,true,'the stored story is not in the briefing now shown');
  element('done').handlers.click(); element('copy').handlers.click();
  assert.match(element('export').value,/Briefing story: Insurer lifts BI reserves after flood/);
});
test('without a briefing the quest stays generic, an older briefing is labelled, and a refresh keeps the card open',()=>{
  const day=linkedDay();
  let story=null;
  const {context,saved,element}=setup({now:day+'T04:00:00Z',dailyBoostBriefingItem:()=>story});
  assert.match(element('quest').textContent,/^Open today’s briefing below/);
  assert.equal(element('briefing-jump').hidden,true);
  story={headline:'Reinsurers reprice cat layers',source:'Artemis',isToday:false,dateLabel:'Thursday, 24 September 2026'};
  context.refreshDailyBoost();
  assert.equal(element('quest').textContent,'From the briefing below (Thursday, 24 September 2026): “Reinsurers reprice cat layers”. Write: “What would I need to know before acting on this?”');
  element('done').handlers.click(); context.refreshDailyBoost();
  assert.equal(/is-compact/.test(element('panel').className),false,'a briefing refresh does not collapse the card you are using');
  element('done').handlers.click(); story=null; element('swap').handlers.click();
  assert.notEqual(element('title').textContent,'Turn a headline into a question');
  assert.equal(JSON.parse(saved.get('bob-daily-boost:alice'))[day].ref,'','switching away drops the story');
  assert.equal(context.DailyBoostCore.clean({[day]:{spark:1,ref:'x'.repeat(400)}})[day].ref.length,300);
});
test('evidence sparks pair their own quest with the story, and claims sparks prefer the insurance sections',()=>{
  const asked=[];
  let briefingLoaded=true;
  const top={headline:'AI chip export curbs widen',source:'Reuters',isToday:true};
  const claims={headline:'Port strike halts Botany terminal',source:'Lloyd’s List',isToday:true};
  const {context,saved,element}=setup({dailyBoostBriefingItem:prefer=>{asked.push([...prefer]);return briefingLoaded?(prefer.includes('insurance')?claims:top):null;}});
  const choose=query=>{element('search').value=query;element('search').handlers.input();element('library-list').children[0].children[2].handlers.click();};
  const saw=()=>JSON.parse(saved.get('bob-daily-boost:alice'))[context.DailyBoostCore.dateKey()].ref;
  choose('look for the exception');
  assert.equal(element('quest').textContent,'From today’s briefing: “AI chip export curbs widen”. Write one situation where its main claim would not hold for the people you work with.');
  assert.equal(element('briefing-jump').hidden,false);
  assert.equal(saw(),'AI chip export curbs widen');
  choose('but for');
  assert.equal(element('quest').textContent,'From today’s briefing: “Port strike halts Botany terminal”. Write in one sentence what most likely would have happened without the event.');
  assert.equal(saw(),'Port strike halts Botany terminal','a new linked spark takes a fresh story');
  assert.deepEqual(asked.at(-1),['insurance','interruptions']);
  element('stretch').handlers.click();
  assert.equal(element('quest').textContent,'From today’s briefing: “Port strike halts Botany terminal” (Lloyd’s List). Write two alternative “but for” scenarios and the evidence that would favour each. Name the one the story quietly assumes.');
  choose('keep one good moment');
  assert.equal(element('quest').textContent,'Describe what made that moment possible. Make a little room for something similar this week.','an unlinked spark ignores the briefing');
  assert.equal(element('briefing-jump').hidden,true);
  assert.equal(saw(),'');
  briefingLoaded=false; choose('find the missing voice');
  assert.match(element('quest').textContent,/^Read a first-person account/,'no briefing: the spark keeps its own words');
  assert.deepEqual([...context.DailyBoostCore.linked].sort((a,b)=>a-b),[3,8,10,11,17,18,21,43,45,48]);
});
test('Note this opens today’s reflection on the story and keeps it with the day',()=>{
  const jumps=[];
  const {context,saved,element}=setup({highlightSourceTitle:title=>{jumps.push(title);return true;}});
  const day=()=>JSON.parse(saved.get('bob-daily-boost:alice'))[context.DailyBoostCore.dateKey()];
  element('done').handlers.click(); context.renderDailyBoost();
  assert.match(element('panel').className,/is-compact/);
  const port={headline:'Port strike halts Botany terminal',source:'Lloyd’s List',url:'https://lloydslist.com/port'};
  assert.equal(context.noteBriefingStory(port),true);
  assert.doesNotMatch(element('panel').className,/is-compact/,'a collapsed card opens so the note is visible');
  assert.equal(element('note').value,'On “Port strike halts Botany terminal” (Lloyd’s List): ');
  assert.deepEqual(day().stories,[port]);
  assert.equal(element('noted').hidden,false);
  const chip=element('noted').children[0];
  assert.equal(chip.children[0].textContent,'↓ Port strike halts Botany terminal');
  assert.equal(chip.children[1].href,'https://lloydslist.com/port');
  chip.children[0].handlers.click(); assert.deepEqual(jumps,['Port strike halts Botany terminal']);
  element('note').value+='three weeks of stock stuck'; element('note').handlers.input();
  context.noteBriefingStory(port);
  assert.equal(day().stories.length,1,'noting the same story twice keeps one entry');
  assert.equal(element('note').value,'On “Port strike halts Botany terminal” (Lloyd’s List): three weeks of stock stuck','and does not repeat the lead');
  context.noteBriefingStory({headline:'Reinsurers reprice cat layers',source:'',url:'javascript:alert(1)'});
  assert.equal(element('note').value,'On “Port strike halts Botany terminal” (Lloyd’s List): three weeks of stock stuck\n\nOn “Reinsurers reprice cat layers”: ');
  assert.equal(day().stories[1].url,'','only web links are kept');
  assert.equal(element('noted').children[1].children.length,2,'no ↗ without a link');
  for (let i=0;i<6;i++) context.noteBriefingStory({headline:'Story '+i,url:'https://x.example/'+i});
  assert.equal(day().stories.length,6); assert.equal(day().stories[0].headline,'Story 0');
  element('noted').children[0].children[2].handlers.click();
  assert.equal(day().stories.length,5); assert.equal(day().stories[0].headline,'Story 1');
  element('copy').handlers.click();
  assert.match(element('export').value,/Noted story: Story 5 — https:\/\/x\.example\/5/);
  context._firebaseUid=null;
  assert.equal(context.noteBriefingStory(port),false,'signed out: nothing to keep it in');
});
test('opening a source marks the story for a week, without counting as a small win',()=>{
  let ticks=0;
  const {context,clock,saved,element}=setup({applyOpenedTicks:()=>{ticks++;}});
  const port={headline:'Port strike halts Botany terminal',source:'Lloyd’s List',url:'https://www.lloydslist.com/port/'};
  assert.equal(context.dailyBoostWasOpened(port),false);
  const before=ticks;
  assert.equal(context.markBriefingStoryOpened(port),true);
  assert.ok(ticks>before,'cards are re-ticked after the record changes');
  context.markBriefingStoryOpened({...port,url:'https://lloydslist.com/port?utm=x'});
  const today=JSON.parse(saved.get('bob-daily-boost:alice'))[context.DailyBoostCore.dateKey()];
  assert.equal(today.opened.length,1,'the same page, however its link is written, is kept once');
  assert.equal(element('week-label').textContent,'A fresh week. Any day can be the first.','reading is not a small win');
  assert.equal(context.dailyBoostWasOpened({headline:'x',url:'http://lloydslist.com/port'}),true);
  assert.equal(context.markBriefingStoryOpened({headline:'No link',url:''}),false,'only a real link can be opened');
  clock.t+=6*86400000; context.renderDailyBoost();
  assert.equal(context.dailyBoostWasOpened(port),true,'still ticked six days later');
  clock.t+=86400000; context.renderDailyBoost();
  assert.equal(context.dailyBoostWasOpened(port),false,'gone after a week');
});
test('opened stories age out after two weeks, including on the account copy',()=>{
  const {context}=setup(), core=context.DailyBoostCore;
  const link={headline:'H',source:'S',url:'https://x.example/h'};
  const kept=core.clean({'2026-09-01':{spark:1,opened:[link]},'2026-09-11':{spark:1,opened:[link]},'2026-09-25':{spark:1,opened:[link,{headline:'bad',url:'ftp://x'}]}});
  assert.equal(kept['2026-09-01'].opened.length,0);
  assert.equal(kept['2026-09-11'].opened.length,1);
  assert.equal(kept['2026-09-25'].opened.length,1);
  const merged=core.merge(kept,{'2026-09-01':{spark:1,opened:[link]}});
  assert.ok(merged.upload.includes('2026-09-01'),'an aged-out list on the account is rewritten');
  const many=core.clean({'2026-09-25':{spark:1,opened:Array.from({length:25},(_,i)=>({headline:'S'+i,url:'https://x.example/'+i}))}});
  assert.equal(many['2026-09-25'].opened.length,20);
});
test('the look-back lists the week’s stories once each, with what you did and a way to write about it',()=>{
  const week={
    '2026-09-22':{spark:3,note:'Belief did not hold',done:true,opened:[{headline:'Port strike halts Botany terminal',source:'Lloyd’s List',url:'https://lloydslist.com/port'}]},
    '2026-09-24':{spark:45,ref:'Port strike halts Botany terminal',refSource:'Lloyd’s List',refUrl:'https://lloydslist.com/port',stories:[{headline:'Reinsurers reprice cat layers',source:'Artemis',url:''}]},
    '2026-09-12':{spark:1,opened:[{headline:'Too old',url:'https://x.example/old'}]}
  };
  const {context,saved,element}=setup({now:'2026-09-27T01:00:00Z'});
  saved.set('bob-daily-boost:carol',JSON.stringify(week));
  context._firebaseUid='carol'; context.renderDailyBoost();
  assert.equal(element('lookback-stories').hidden,false);
  const rows=element('lookback-story-list').children;
  assert.equal(rows.length,2);
  assert.equal(rows[0].children[0].textContent,'Tue 22 Sep · opened · spark');
  assert.equal(rows[0].children[1].textContent,'Port strike halts Botany terminal (Lloyd’s List) ↗');
  assert.equal(rows[0].children[1].href,'https://lloydslist.com/port');
  assert.equal(rows[1].children[0].textContent,'Thu 24 Sep · noted');
  assert.equal(rows[1].children[1].href,undefined,'no link, no anchor');
  rows[1].children[2].handlers.click();
  assert.equal(element('note').value,'On “Reinsurers reprice cat layers” (Artemis): ');
  assert.equal(JSON.parse(saved.get('bob-daily-boost:carol'))['2026-09-27'].stories[0].headline,'Reinsurers reprice cat layers');
});
test('the why line says how the spark got here and what it is paired with',()=>{
  const plain=setup();
  assert.equal(plain.element('why').textContent,'From today’s rotation');
  plain.element('swap').handlers.click();
  assert.match(plain.element('why').textContent,/^You swapped to this one/);
  plain.element('search').value='keep one good moment'; plain.element('search').handlers.input();
  plain.element('library-list').children[0].children[2].handlers.click();
  assert.equal(plain.element('why').textContent,'You picked this from the library');
  assert.equal(JSON.parse(plain.saved.get('bob-daily-boost:alice'))[plain.context.DailyBoostCore.dateKey()].picked,'library');
  assert.equal(setup({now:'2026-09-27T01:00:00Z'}).element('why').textContent,'Sunday look-back');
  let story={headline:'Port strike',source:'Lloyd’s List',url:'',section:'interruptions',isToday:true};
  const linked=setup({now:linkedDay(45)+'T04:00:00Z',dailyBoostBriefingItem:()=>story});
  assert.equal(linked.element('why').textContent,'From today’s rotation · paired with today’s top interruptions story');
  linked.element('stretch').handlers.click();
  story={headline:'Something newer',source:'Wire',section:'global',isToday:true}; linked.context.refreshDailyBoost();
  assert.equal(linked.element('why').textContent,'From today’s rotation · paired with the briefing story you started with');
  const empty=setup({now:linkedDay(45)+'T04:00:00Z',dailyBoostBriefingItem:()=>null});
  assert.equal(empty.element('why').textContent,'From today’s rotation · pairs with a briefing story once one is loaded');
  assert.equal(plain.context.DailyBoostCore.clean({'2026-09-25':{spark:1,picked:'hack'}})['2026-09-25'].picked,'');
});
test('quick keys work on Today and stay out of the way everywhere else',()=>{
  const {context,events,element}=setup(), compact=()=>/is-compact/.test(element('panel').className);
  const page=context.document.getElementById('page-today'); page.className='page active';
  let focused=0; element('note').focus=()=>{focused++;};
  const press=(key,extra={})=>{let prevented=false; events.keydown({key,target:{tagName:'BODY'},preventDefault(){prevented=true;},...extra}); return prevented;};
  assert.equal(press('d'),true); assert.match(element('done').textContent,/Undo/);
  assert.equal(press('D'),true); assert.equal(element('done').textContent,'I did it','D toggles, whatever the case');
  assert.equal(press('t'),true); assert.equal(compact(),true);
  press('n'); assert.equal(compact(),false,'N opens a tucked card'); assert.equal(focused,1);
  press('t'); assert.equal(compact(),true); press('t'); assert.equal(compact(),false,'T reopens a tucked card');
  const before=element('done').textContent;
  press('d',{target:{tagName:'TEXTAREA'}}); press('d',{target:{tagName:'input'}}); press('d',{target:{tagName:'DIV',isContentEditable:true}});
  press('d',{ctrlKey:true}); press('d',{metaKey:true}); press('d',{altKey:true}); press('d',{repeat:true}); press('d',{isComposing:true});
  assert.equal(element('done').textContent,before,'typing, modifiers, auto-repeat and IME input never trigger');
  context.document.querySelector=()=>({}); press('d'); context.document.querySelector=()=>null;
  page.className='page'; press('d'); page.className='page active';
  assert.equal(element('done').textContent,before,'not behind an overlay, not off Today');
  assert.equal(press('x'),false,'other keys are left alone');
});
test('search sees days with something to find, and opening one shows that day',()=>{
  const {context,saved,element}=setup();
  saved.set('bob-daily-boost:carol',JSON.stringify({
    '2026-08-01':{spark:3,note:'An old lease question',done:true},
    '2026-09-20':{spark:12,note:'',done:true},
    '2026-09-22':{spark:45,note:'',ref:'Port strike halts Botany terminal',stories:[{headline:'Reinsurers reprice cat layers',url:''}]},
    '2026-09-24':{spark:9,note:'Quiet walk helped',done:false}
  }));
  context._firebaseUid='carol'; context.renderDailyBoost();
  const entries=context.dailyBoostSearchEntries();
  assert.deepEqual([...entries.map(entry=>entry.day)],['2026-08-01','2026-09-22','2026-09-24'],'a done day with nothing written has nothing to find');
  assert.deepEqual([...entries[1].stories],['Reinsurers reprice cat layers','Port strike halts Botany terminal']);
  assert.equal(entries[0].label,'Sat 1 Aug'); assert.equal(entries[0].spark,'Look for the exception'); assert.equal(entries[0].theme,'Perspective');
  assert.equal(context.openDailyBoostDay('2026-08-01'),true);
  assert.equal(element('history-panel').open,true);
  const first=element('history').children[0];
  assert.equal(first.className,'is-found');
  assert.match(first.children[0].textContent,/^Sat 1 Aug · Look for the exception/,'an old day is pinned above the recent seven');
  let focused=0; element('note').focus=()=>{focused++;};
  element('note').value='Today’s line'; element('note').handlers.input();
  assert.equal(context.openDailyBoostDay(context.DailyBoostCore.dateKey()),true); assert.equal(focused,1,'today goes straight to the note');
  context._firebaseUid='alice'; context.renderDailyBoost();
  assert.deepEqual([...context.dailyBoostSearchEntries().map(entry=>entry.day)],[],'another account sees none of it');
  context._firebaseUid=null; context.renderDailyBoost();
  assert.deepEqual([...context.dailyBoostSearchEntries()],[]);
});
test('a story is read by opening it, noting it, or marking it read, and a mark can be undone',()=>{
  const {context,clock,saved,element}=setup(), core=context.DailyBoostCore;
  const state=story=>context.dailyBoostReadState(story);
  const wire={headline:'Unlinked wire story',source:'Wire',url:''};
  const port={headline:'Port strike halts Botany terminal',source:'Lloyd’s List',url:'https://lloydslist.com/port'};
  assert.equal(state(wire),'');
  assert.equal(context.markBriefingStoryRead(wire),true); assert.equal(state(wire),'read','a story with no link can still be read');
  const day0=context.DailyBoostCore.dateKey();
  assert.deepEqual({...JSON.parse(saved.get('bob-daily-boost:alice'))[day0].opened[0]},{headline:'Unlinked wire story',source:'Wire',url:'',how:'read'});
  assert.equal(element('week-label').textContent,'A fresh week. Any day can be the first.','reading is not a small win');
  clock.t+=2*86400000; context.renderDailyBoost();
  assert.equal(state(wire),'read','still read two days on');
  context.markBriefingStoryRead(wire); assert.equal(state(wire),'','undo clears the mark from the earlier day');
  assert.equal(JSON.parse(saved.get('bob-daily-boost:alice'))[day0].opened.length,0);
  context.markBriefingStoryRead(port); assert.equal(state(port),'read');
  context.markBriefingStoryOpened(port); assert.equal(state(port),'opened','opening upgrades a read mark');
  const today=JSON.parse(saved.get('bob-daily-boost:alice'))[context.DailyBoostCore.dateKey()];
  assert.equal(today.opened.length,1); assert.equal(today.opened[0].how,'open');
  context.markBriefingStoryRead(port); assert.equal(state(port),'opened','a story you opened stays read');
  context.noteBriefingStory({headline:'Reinsurers reprice cat layers',url:''});
  assert.equal(state({headline:'Reinsurers reprice cat layers',url:''}),'noted');
  const kept=core.clean({'2026-09-25':{spark:1,opened:[{headline:'A',url:'',how:'read'},{headline:'B',url:''},{headline:'C',url:'https://x.example/c'}]}})['2026-09-25'].opened;
  assert.deepEqual([...kept.map(o=>o.headline+':'+o.how)],['A:read','C:open'],'an opened story needs its link; a read mark does not');
});
test('a date named in a watch metric becomes the due day; anything else falls back',()=>{
  const {context}=setup(), parse=context.DailyBoostCore.parseDue, t='2026-09-25';
  assert.equal(parse('APRA quarterly claims data, due 12 Oct',t),'2026-10-12');
  assert.equal(parse('Fair Work hearing on October 2',t),'2026-10-02');
  assert.equal(parse('Budget papers 2026-10-06',t),'2026-10-06');
  assert.equal(parse('Filing due 3rd November 2026',t),'2026-11-03');
  assert.equal(parse('due 1 January',t),'2027-01-01','a month already passed this year means next year');
  assert.equal(parse('Top 12 markets to watch',t),'','month names are whole words');
  assert.equal(parse('Report due 30 Feb',t),'');
  assert.equal(parse('Bogus 2026-13-01',t),'','an impossible date is ignored, not thrown');
  assert.equal(parse('Due 25 Sep',t),t,'today must not be postponed');
  assert.equal(parse('Quarterly data',t),'');
});
test('reminders are set from a card, come due on Today, and can be checked, noted, snoozed or cancelled',()=>{
  const {context,clock,saved,element}=setup(), toggle=context.toggleBriefingReminder;
  const apra={headline:'Insurer lifts BI reserves',source:'insuranceNEWS',url:'https://insurancenews.com.au/x',metric:'APRA quarterly claims data, due 2 Oct',horizon:'weeks'};
  const port={headline:'Port strike halts Botany terminal',source:'Lloyd’s List',url:'',metric:'Fair Work hearing list',horizon:'days'};
  assert.equal(toggle({headline:'No metric',metric:''}),false,'nothing to check, nothing to set');
  assert.equal(toggle(apra).due,'2026-10-02','the named date wins');
  assert.equal(toggle(port).due,'2026-09-28','days → three days out');
  assert.equal(context.dailyBoostReminderFor(apra).label,'Fri 2 Oct');
  assert.equal(element('reminders').hidden,false);
  assert.equal(element('reminders-title').textContent,'⏰ Coming up to check');
  assert.equal(element('reminder-list').children.length,0);
  assert.equal(element('reminder-upcoming').children.length,2);
  assert.match(element('reminders-sub').textContent,/^Nothing due today\. Next: Fair Work hearing list, in 3 days · Mon 28 Sep$/);
  clock.t=Date.parse('2026-09-28T01:00:00Z'); context.renderDailyBoost();
  assert.equal(element('reminders-title').textContent,'⏰ To check today (1)');
  const row=element('reminder-list').children[0];
  assert.equal(row.children[0].children[0].textContent,'Fair Work hearing list');
  assert.equal(row.children[0].children[1].textContent,'due today');
  assert.equal(element('reminder-upcoming-title').textContent,'1 more coming up');
  row.children[2].children[2].handlers.click();
  assert.equal(element('reminder-list').children.length,0,'snoozed a week');
  assert.equal(context.dailyBoostReminderFor(port).due,'2026-10-05');
  clock.t=Date.parse('2026-10-06T01:00:00Z'); context.renderDailyBoost();
  assert.equal(element('reminders-title').textContent,'⏰ To check today (2)');
  const first=element('reminder-list').children[0];
  assert.equal(first.children[0].children[1].textContent,'4 days overdue');
  assert.equal(first.className,'watch-reminder is-overdue');
  first.children[2].children[1].handlers.click();
  assert.ok(context.dailyBoostReminderFor(apra),'opening the finding does not complete the check');
  const editor=first.children[3], finding=editor.children[0].children[0];
  editor.children[1].handlers.click();
  assert.ok(context.dailyBoostReminderFor(apra),'an empty finding cannot complete the check');
  finding.value='The new data confirms the change'; finding.handlers.input();
  editor.children[1].handlers.click();
  assert.equal(context.dailyBoostReminderFor(apra),null,'saving a finding marks it checked');
  element('reminder-list').children[0].children[2].children[0].handlers.click();
  assert.equal(element('reminders').hidden,true,'nothing left to check');
  const stored=JSON.parse(saved.get('bob-daily-boost:alice'))['2026-09-25'].reminders;
  assert.deepEqual(stored.map(r=>[r.metric.slice(0,4),r.done,r.doneOn]),[['APRA',true,'2026-10-06'],['Fair',true,'2026-10-06']]);
  toggle(apra); assert.ok(context.dailyBoostReminderFor(apra),'a checked story can be set again');
  toggle(apra); assert.equal(context.dailyBoostReminderFor(apra),null,'and cancelled');
  element('copy').handlers.click();
  assert.match(element('export').value,/Reminder: APRA quarterly claims data, due 2 Oct — due Fri 2 Oct \(checked Tue 6 Oct\)/);
  const clean=context.DailyBoostCore.clean({'2026-09-25':{spark:1,reminders:[{metric:'x',due:'soon'},{metric:'',due:'2026-10-01'},{metric:'ok',due:'2026-10-01',url:'javascript:1'}]}})['2026-09-25'].reminders;
  assert.equal(clean.length,1); assert.equal(clean[0].url,'');
});
function sharedAccount() {
  const acct={remote:{}, core:null, held:[]};
  acct.fb=(hold=false)=>({fbLoadDailyBoost:async()=>copy(acct.remote),fbSaveDailyBoost:(uid,entries)=>{
    const run=()=>{acct.remote=copy(acct.core.merge(copy(entries),acct.remote).records);return copy(acct.remote);};
    return hold?new Promise(resolve=>acct.held.push(()=>resolve(run()))):Promise.resolve(run());
  }});
  return acct;
}
const versionCount=records=>Object.values(records).reduce((n,entry)=>n+(entry.noteVersions||[]).length,0);
test('one device typing in bursts between syncs never records a conflict with itself',async()=>{
  const acct=sharedAccount(), dev=setup(acct.fb()); acct.core=dev.context.DailyBoostCore; await tick(); await tick();
  const note=dev.element('note');
  for (let i=0;i<12;i++) {
    note.value+='word'+i+' '; note.handlers.input(); dev.clock.t+=700;
    if (i%3===2) { dev.runTimers(); await tick(); await tick(); }
    if (i%4===3) { dev.clock.t+=61000; dev.context.renderDailyBoost(); await tick(); await tick(); }
  }
  dev.runTimers(); await tick(); await tick();
  assert.equal(versionCount(acct.remote),0);
  assert.equal(dev.element('conflicts-wrap').hidden,true);
  assert.match(acct.remote['2026-09-25'].note,/word11 $/);
});
test('two devices taking turns fast-forward instead of conflicting',async()=>{
  const acct=sharedAccount(), phone=setup(acct.fb()); acct.core=phone.context.DailyBoostCore; const laptop=setup(acct.fb());
  await tick(); await tick();
  const turn=async(dev,text)=>{ dev.clock.t+=120000; dev.context.renderDailyBoost(); await tick(); await tick(); dev.element('note').value=text; dev.element('note').handlers.input(); dev.runTimers(); await tick(); await tick(); };
  await turn(phone,'Thought on the train'); await turn(laptop,'Thought on the train, expanded at my desk'); await turn(phone,'Plus one from lunch'); await turn(laptop,'Final');
  assert.equal(versionCount(acct.remote),0);
  assert.equal(acct.remote['2026-09-25'].note,'Final');
});
test('typing while a save is in flight builds on it once it confirms',async()=>{
  const acct=sharedAccount(), dev=setup(acct.fb(true)); acct.core=dev.context.DailyBoostCore; await tick(); await tick();
  const note=dev.element('note');
  note.value='First line'; note.handlers.input(); dev.clock.t+=700; dev.runTimers();
  note.value='First line, then more'; note.handlers.input(); dev.clock.t+=700;
  acct.held.shift()(); await tick(); await tick();
  dev.runTimers(); await tick(); if (acct.held.length) acct.held.shift()(); await tick(); await tick();
  assert.equal(versionCount(acct.remote),0);
  assert.equal(acct.remote['2026-09-25'].note,'First line, then more');
});
test('recovered versions are capped, expire after two weeks, and dismissals stick across devices',()=>{
  const {context}=setup(), core=context.DailyBoostCore;
  const many=Array.from({length:6},(_,i)=>({text:'Version '+i,at:100+i}));
  const kept=core.clean({'2026-09-10':{spark:1,note:'old',noteVersions:many},'2026-09-25':{spark:1,note:'now',noteVersions:many}});
  assert.deepEqual([...kept['2026-09-25'].noteVersions.map(v=>v.text)],['Version 3','Version 4','Version 5'],'three per day, newest kept');
  assert.equal(kept['2026-09-10'].noteVersions.length,0,'gone after two weeks');
  const phone={'2026-09-25':{spark:1,note:'now',updatedAt:10,noteVersions:[{text:'Laptop wording',at:5}]}};
  const laptop={'2026-09-25':{spark:1,note:'now',updatedAt:20,noteVersions:[],versionsDismissed:['5:14']}};
  assert.equal(core.merge(phone,laptop).records['2026-09-25'].noteVersions.length,0,'dismissed on one device, not revived by the other');
});
test('a recovered version can be swapped in or dismissed from the panel',()=>{
  const {context,saved,element}=setup(), day=context.DailyBoostCore.dateKey();
  saved.set('bob-daily-boost:carol',JSON.stringify({[day]:{spark:1,note:'Phone wording',updatedAt:20,noteVersions:[{text:'Laptop wording',at:5},{text:'Tablet wording',at:6}]}}));
  context._firebaseUid='carol'; context.renderDailyBoost();
  assert.equal(element('conflicts-wrap').hidden,false);
  const first=element('conflicts').children.find(card=>card.children[1].textContent==='Laptop wording');
  first.children[2].children[0].handlers.click();
  assert.equal(element('note').value,'Laptop wording');
  const now=JSON.parse(saved.get('bob-daily-boost:carol'))[day];
  assert.deepEqual(now.noteVersions.map(v=>v.text).sort(),['Phone wording','Tablet wording'],'the replaced note is kept as a version');
  element('conflicts').children.forEach(card=>card.children[2].children[1].handlers.click());
  assert.equal(element('conflicts-wrap').hidden,true);
  assert.equal(JSON.parse(saved.get('bob-daily-boost:carol'))[day].note,'Laptop wording');
});
const dayAfter=(start,n)=>new Date(Date.parse(start+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function daysFrom(start,count,make){const out={};for(let i=0;i<count;i++)out[dayAfter(start,i)]=make(i);return out;}
test('days leaving the 90-day window are archived by year, slimmed, and empty ones skipped',()=>{
  const {context}=setup(), core=context.DailyBoostCore;
  const before=daysFrom('2025-12-30',93,i=>({spark:1,note:i===1?'':'Note '+i,done:i!==1,updatedAt:1,opened:[{headline:'x',url:'https://x.example/'+i}],fieldClocks:{note:1},stories:i===0?[{headline:'Kept story',url:'https://s.example'}]:[]}));
  const kept=core.merge(before,{}).records, retired=core.retire(before,kept);
  assert.equal(Object.keys(kept).length,90);
  assert.deepEqual(Object.keys(retired).sort(),['2025','2026']);
  assert.deepEqual(Object.keys(retired['2025']),['2025-12-30'],'the empty day is not archived');
  assert.deepEqual(Object.keys(retired['2026']),['2026-01-01']);
  const slim=retired['2025']['2025-12-30'];
  assert.equal(slim.note,'Note 0'); assert.equal(slim.stories[0].headline,'Kept story');
  assert.equal(slim.opened,undefined,'reading history is left out'); assert.equal(slim.fieldClocks,undefined,'so is sync bookkeeping');
  assert.deepEqual({...core.retire({'2026-03-01':{spark:1,note:'recent'}},kept)},{},'a day removed while inside the window is not archived');
});
test('archived days stay searchable, openable and in the copy-out',async()=>{
  const archived={'2025-06-02':{spark:3,note:'Old lease question from June',done:true}};
  let loads=0;
  const {context,element}=setup({fbLoadDailyBoost:async()=>({}),fbSaveDailyBoost:async(uid,entries)=>entries,fbLoadDailyBoostArchive:async()=>{loads++;return archived;}});
  await tick(); await tick(); await tick();
  assert.equal(loads,1,'loaded once after the first sync');
  const found=context.dailyBoostSearchEntries().find(entry=>entry.day==='2025-06-02');
  assert.equal(found.note,'Old lease question from June');
  assert.match(element('history-title').textContent,/· 1 older in your archive$/);
  assert.equal(context.openDailyBoostDay('2025-06-02'),true);
  assert.match(element('history').children[0].children[0].textContent,/^Mon 2 Jun 2025 · Look for the exception · Done$/);
  element('copy').handlers.click();
  assert.match(element('export').value,/Mon 2 Jun 2025 · Look for the exception \(Perspective\) · done\nOld lease question from June/);
  context._firebaseUid='bob'; context.renderDailyBoost();
  assert.equal(context.dailyBoostSearchEntries().length,0,'another account sees none of it');
});
test('a day the local window drops is kept in the archive right away',()=>{
  const {context,saved,element}=setup();
  saved.set('bob-daily-boost:carol',JSON.stringify(daysFrom('2026-06-20',90,i=>({spark:1,note:'Day '+i,updatedAt:1}))));
  context._firebaseUid='carol'; context.renderDailyBoost();
  element('note').value='Today’s note'; element('note').handlers.input();
  assert.equal(Object.keys(JSON.parse(saved.get('bob-daily-boost:carol'))).length,90);
  assert.ok(context.dailyBoostSearchEntries().some(entry=>entry.day==='2026-06-20'&&entry.note==='Day 0'),'the dropped day is still findable');
});
test('more / less like this: the newest vote counts, the same button takes it back, and it syncs but is not archived',()=>{
  const {context,clock,saved}=setup(), core=context.DailyBoostCore;
  const story={headline:'Port strike halts Botany terminal',source:'Lloyd’s List',section:'interruptions',url:'https://lloydslist.com/port'};
  assert.equal(context.dailyBoostVoteFor(story),0);
  assert.equal(context.voteBriefingStory(story,1),1); assert.equal(context.dailyBoostVoteFor(story),1);
  const day0=core.dateKey();
  assert.deepEqual({...JSON.parse(saved.get('bob-daily-boost:alice'))[day0].feedback[0]},{headline:story.headline,source:story.source,section:'interruptions',url:story.url,vote:1});
  clock.t+=3*86400000; context.renderDailyBoost();
  assert.equal(context.dailyBoostVoteFor(story),1,'a vote holds for 30 days');
  assert.equal(context.voteBriefingStory(story,-1),-1,'a newer vote replaces it');
  assert.equal(context.voteBriefingStory(story,-1),0,'the same button again takes it back');
  assert.equal(context.dailyBoostVoteFor(story),0);
  const entries=context.dailyBoostFeedbackEntries();
  assert.deepEqual([...Object.keys(entries)].sort(),[day0,core.dateKey()].sort(),'every voted day goes to the copied prompt');
  assert.deepEqual([...entries[core.dateKey()].feedback.map(f=>f.vote)],[0],'a taken-back vote travels as 0, so the summariser can drop it');
  clock.t+=31*86400000; context.renderDailyBoost();
  assert.equal(context.voteBriefingStory({headline:'No such',vote:1},2),false,'only 1 or -1');
  const merged=core.merge({[day0]:{spark:1,updatedAt:10,feedback:[{headline:'A',vote:1}],listClocks:{feedback:{'h:a':10}}}},{[day0]:{spark:1,updatedAt:20,feedback:[{headline:'B',vote:-1}],listClocks:{feedback:{'h:b':20}}}}).records[day0].feedback;
  assert.deepEqual([...merged.map(f=>f.headline)].sort(),['A','B'],'votes from two devices both keep');
  const before={}; for (let i=0;i<91;i++) before[new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10)]={spark:1,note:'n',updatedAt:1,feedback:[{headline:'X',vote:1}]};
  const archived=Object.values(core.retire(before,core.merge(before,{}).records)['2026'])[0];
  assert.equal(archived.feedback,undefined,'votes are not archived');
  context._firebaseUid=null; context.renderDailyBoost();
  assert.deepEqual({...context.dailyBoostFeedbackEntries()},{},'signed out, there are no votes to copy');
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
// The note saves itself, so the line beside the box has to say so: Saving…,
// then Saved with the time and where, then fade. Done flushes and confirms.
test('the note shows its save state beside the box, and Done sends it now',async()=>{
  const cloud=fakeAccount();
  let blurred=0;
  const {element,runTimers}=setup({fbLoadDailyBoost:(...a)=>cloud.fbLoadDailyBoost(...a),fbSaveDailyBoost:(...a)=>cloud.fbSaveDailyBoost(...a)});
  await tick();
  element('note').blur=()=>{blurred++;};
  assert.equal(element('note-state').textContent,'','nothing to report before an edit');
  element('note').value='A first line'; element('note').handlers.input();
  assert.equal(element('note-state').textContent,'Saving…');
  assert.equal(element('note-done').hidden,false,'Done appears while typing');
  runTimers(); await tick();
  assert.match(element('note-state').textContent,/^✓ Saved \d{1,2}:\d{2}.* · on all your devices$/);
  assert.equal(element('note-state').className,'boost-note-state is-saved');
  runTimers();
  assert.equal(element('note-state').className,'boost-note-state is-saved is-faded','it fades after a few seconds');
  element('done').handlers.click();
  assert.equal(element('note-state').className,'boost-note-state is-saved is-faded','a sync that is not the note keeps it quiet');
  runTimers(); await tick();
  cloud.fail=true; element('done').handlers.click(); runTimers(); await tick(); cloud.fail=false;
  assert.equal(element('note-state').className,'boost-note-state is-saved is-faded','nor does a failed sync of something else');
  const sent=cloud.saves.length;
  element('note').value='A first line, and a second'; element('note').handlers.input();
  assert.equal(element('note-state').textContent,'Saving…','a new edit brings it back');
  assert.equal(element('note-state').className,'boost-note-state');
  element('note-done').handlers.click(); await tick();
  assert.equal(cloud.saves.length,sent+1,'Done sends the pending edit without waiting');
  assert.equal(cloud.saves[sent].days[Object.keys(cloud.saves[sent].days)[0]].note,'A first line, and a second');
  assert.equal(element('note-done').hidden,true); assert.equal(blurred,1,'and closes the keyboard');
  assert.match(element('note-state').textContent,/^✓ Saved/);
  runTimers();
  assert.match(element('note-state').className,/is-faded/);
  element('note-done').handlers.click();
  assert.equal(element('note-state').className,'boost-note-state is-saved','Done with nothing pending shows the confirmation again');
  assert.equal(cloud.saves.length,sent+1,'and saves nothing twice');
  let prevented=false;
  element('note').value='Third'; element('note').handlers.input();
  element('note').handlers.keydown({ctrlKey:true,key:'Enter',preventDefault(){prevented=true;}}); await tick();
  assert.ok(prevented); assert.equal(cloud.saves.length,sent+2,'Ctrl+Enter is Done');
  element('note').handlers.input(); element('note').handlers.blur(); runTimers();
  assert.equal(element('note-done').hidden,true,'leaving the box hides Done');
});
test('the note save state says where it is kept, and warns when the account is out of reach',async()=>{
  const local=setup();
  local.element('note').value='Offline thought'; local.element('note').handlers.input();
  assert.match(local.element('note-state').textContent,/^✓ Saved .* · on this device$/,'no account link: saved on the device at once');
  const cloud=fakeAccount();
  const {element,runTimers}=setup({fbLoadDailyBoost:(...a)=>cloud.fbLoadDailyBoost(...a),fbSaveDailyBoost:(...a)=>cloud.fbSaveDailyBoost(...a)});
  await tick();
  cloud.fail=true;
  element('note').value='On a plane'; element('note').handlers.input(); runTimers(); await tick();
  assert.equal(element('note-state').textContent,'Saved on this device · will reach your account when it is back');
  assert.equal(element('note-state').className,'boost-note-state is-warn');
});
// Today's aha → Check this later lands in ⏰ To check, leaving the experiment
// slot free, and keeps the whole wrong-if condition.
test('an aha check joins To check, not the experiment slot, and is not added twice',()=>{
  const {context,saved,element}=setup(), day='2026-09-25';
  const metric='Check whether: '+'the ADHA incident review attributes the breach to ordinary credential misuse rather than an agent acting alone. '.repeat(2);
  assert.equal(context.addDailyBoostCheck({metric,headline:'Renewals must test agent permissions',source:'Today’s aha · Friday',url:'https://example.com/a',due:'2026-09-24'}).ok,false,'not in the past');
  assert.equal(context.addDailyBoostCheck({metric,headline:'Renewals must test agent permissions',due:'2026-02-30'}).ok,false,'a real date');
  const added=context.addDailyBoostCheck({metric,headline:'Renewals must test agent permissions',source:'Today’s aha · Friday',url:'https://example.com/a',due:'2026-10-02'});
  assert.equal(added.ok,true); assert.match(added.message,/Added to ⏰ To check for Fri 2 Oct/);
  const entry=JSON.parse(saved.get('bob-daily-boost:alice'))[day];
  assert.equal(entry.reminders.length,1);
  assert.equal(entry.reminders[0].metric,metric.trim().replace(/[.\s]+$/,'').slice(0,340),'the long condition is kept, up to 340 characters');
  assert.equal(context.addDailyBoostCheck({metric:'Check whether: margins recover. ',headline:'Stop test',due:'2026-10-02'}).ok,true);
  assert.equal(JSON.parse(saved.get('bob-daily-boost:alice'))[day].reminders[1].metric,'Check whether: margins recover','no closing full stop before ", in 7 days"');
  assert.equal(entry.reminders[0].url,'https://example.com/a');
  assert.equal(entry.trialPlan,'','the day’s experiment slot is untouched');
  assert.match(context.addDailyBoostCheck({metric,headline:'Renewals must test agent permissions',due:'2026-10-05'}).message,/Already in ⏰ To check for Fri 2 Oct/);
  assert.equal(context.createDailyBoostExperiment('My own experiment','2026-10-01','').ok,true,'an experiment can still be saved the same day');
  assert.equal(element('reminders').hidden,false,'the To check panel shows it');
  for (let i=0;i<9;i++) context.addDailyBoostCheck({metric:'m'+i,headline:'h'+i,due:'2026-10-02'});
  assert.match(context.addDailyBoostCheck({metric:'eleventh',headline:'x',due:'2026-10-02'}).message,/ten open checks/);
  element('reminder-upcoming').children[0].children[2].children[0].handlers.click();
  assert.equal(context.addDailyBoostCheck({metric:'eleventh',headline:'x',due:'2026-10-02'}).ok,true,'completed checks free an open slot');
  const checks=JSON.parse(saved.get('bob-daily-boost:alice'))[day].reminders;
  assert.equal(checks.length,11,'the completed check is preserved');
  assert.equal(checks.filter(item=>!item.done).length,10);
});
test('what an experiment was based on is capped at 1,500 characters, stored and cleaned',()=>{
  const {context,saved}=setup(), core=context.DailyBoostCore;
  assert.equal(context.createDailyBoostExperiment('Try the suggestion','2026-10-02','x'.repeat(5000)).ok,true);
  assert.equal(JSON.parse(saved.get('bob-daily-boost:alice'))['2026-09-25'].trialSource.length,1500);
  assert.equal(core.clean({'2026-09-20':{spark:1,trialPlan:'Old',trialSource:'y'.repeat(4000)}})['2026-09-20'].trialSource.length,1500,'an older, longer one is trimmed on load');
});


test('spark feedback stays with its original spark, can be cleared, and survives export and archive',()=>{
  const {context,saved,element}=setup(), core=context.DailyBoostCore, day=core.dateKey();
  element('rate-more').handlers.click();
  element('rate-note').value='Useful before a difficult call'; element('rate-note').handlers.input();
  const original=JSON.parse(saved.get('bob-daily-boost:alice'))[day];
  assert.equal(original.sparkResponse.spark,original.spark);
  assert.equal(original.sparkResponse.value,'more');
  element('swap').handlers.click();
  assert.equal(element('rate-note').hidden,true,'a different spark never inherits the old comment');
  element('copy').handlers.click();
  assert.match(element('export').value,/Useful before a difficult call/);
  const archive=core.cleanArchive({[day]:original});
  assert.equal(archive[day].sparkResponse.note,'Useful before a difficult call');
  element('rate-helpful').handlers.click(); element('rate-helpful').handlers.click();
  assert.equal(JSON.parse(saved.get('bob-daily-boost:alice'))[day].sparkResponse,null);
});

test('positive spark feedback influences future picks without overriding Sunday or recent exclusion',()=>{
  const {context}=setup(), core=context.DailyBoostCore, day='2026-09-26';
  const base=core.sparkFor(day,{}), target=core.order.find(id=>core.themes[id]!==core.themes[base]);
  const saved={'2026-09-22':{spark:target,sparkResponse:{spark:target,value:'more',note:''}}};
  const chosen=core.sparkFor(day,saved);
  assert.equal(core.themes[chosen],core.themes[target]);
  assert.notEqual(chosen,target,'recent exact spark is still excluded');
  assert.equal(core.sparkFor('2026-09-27',saved),core.review);
});

test('experiment outcome and next action survive merges, archive, and export; empty reviews stay open',()=>{
  const {context,saved,element}=setup(), core=context.DailyBoostCore, day=core.dateKey();
  context.createDailyBoostExperiment('Ask a clearer question','2026-10-02','A weekly suggestion');
  let row=element('experiments').children[0];
  row.children[4].handlers.click();
  assert.equal(JSON.parse(saved.get('bob-daily-boost:alice'))[day].trialDone,false);
  const choices=row.children[3];
  choices.children[0].children[0].value='mixed'; choices.children[0].children[0].handlers.change();
  row=element('experiments').children[0];
  row.children[3].children[1].children[0].value='adapt'; row.children[3].children[1].children[0].handlers.change();
  element('experiments').children[0].children[4].handlers.click();
  const entry=JSON.parse(saved.get('bob-daily-boost:alice'))[day];
  assert.equal(entry.trialDone,true); assert.equal(entry.trialResult,'mixed'); assert.equal(entry.trialNext,'adapt');
  assert.equal(core.cleanArchive({[day]:entry})[day].trialNext,'adapt');
  assert.equal(core.merge({[day]:entry},{[day]:{spark:0,note:'',updatedAt:1}}).records[day].trialResult,'mixed');
  element('copy').handlers.click(); assert.match(element('export').value,/Outcome: Mixed/); assert.match(element('export').value,/Next step: Adapt/);
});
// ── Feedback nudges the rotation; it never takes it over ──
function simulate(core, vote) {
  const saved={}, themes=[];
  for (let i=0;i<28;i++) {
    const d=new Date(Date.UTC(2026,8,21+i)).toISOString().slice(0,10);
    const spark=core.sparkFor(d,core.clean(saved)); saved[d]={spark,updatedAt:1};
    if (vote && i===0) saved[d].sparkResponse={spark,value:vote,note:''};
    themes.push(core.themes[spark]);
  }
  return themes;
}
test('one More like this favours its theme for a while without crowding the others out',()=>{
  const {context}=setup(), core=context.DailyBoostCore;
  const plain=simulate(core), nudged=simulate(core,'more'), favoured=nudged[0];
  const count=(list,theme)=>list.filter(t=>t===theme).length;
  assert.ok(count(nudged,favoured)>count(plain,favoured),'it does favour the theme');
  assert.ok(count(nudged,favoured)<=8,'but at most about one day in four ('+count(nudged,favoured)+' of 28)');
  assert.ok(new Set(nudged).size>=8,'and the other themes still come round');
  nudged.forEach((theme,i)=>{ if (i) assert.notEqual(theme,nudged[i-1],'no theme two days running (day '+i+')'); });
});
test('Not today passes over that spark when it comes round',()=>{
  const {context}=setup(), core=context.DailyBoostCore, day='2026-10-20';
  const next=core.sparkFor(day,{});
  const saved={'2026-10-01':{spark:0,sparkResponse:{spark:next,value:'not-today',note:''}}};
  assert.notEqual(core.sparkFor(day,saved),next);
});
test('the why line names the feedback only when it moved the pick',()=>{
  const {context:probe}=setup(), core=probe.DailyBoostCore, day='2026-09-25';
  const base=core.sparkFor(day,{}), target=core.order.find(id=>core.themes[id]!==core.themes[base]);
  const stored={'2026-09-20':{spark:target,updatedAt:1,sparkResponse:{spark:target,value:'more',note:''}}};
  const {element}=setup({localStorage:{getItem:()=>JSON.stringify(stored),setItem:()=>{}}});
  const why=element('why').textContent, expected='Because you asked for more like “'+core.sparkTitle(target)+'” on Sun 20 Sep';
  assert.ok(why.includes(expected),why);
  const {element:plain}=setup();
  assert.doesNotMatch(plain('why').textContent,/Because you/,'no feedback, no claim');
});
test('a finding box stays open through a re-render, and is not rebuilt while typing in it',()=>{
  const {context,element}=setup();
  context.addDailyBoostCheck({metric:'Check whether: margins recover',headline:'Grid',due:context.DailyBoostCore.dateKey()});
  const row=()=>element('reminder-list').children[0];
  const find=(node,text)=>[node,...(node.children||[]).flatMap(child=>find(child,text)||[])].flat().find(n=>n&&n.textContent===text);
  const open=find(row(),'✎ Note what you found'); open.handlers.click();
  const editor=row().children.find(child=>child.className==='boost-reflect');
  assert.equal(editor.hidden,false);
  context.refreshDailyBoost();
  assert.equal(row().children.find(child=>child.className==='boost-reflect').hidden,false,'still open after a rebuild');
  const typing=row(), textarea=row().children.find(child=>child.className==='boost-reflect').children[0].children[0];
  textarea.tagName='TEXTAREA'; context.document.activeElement=textarea; element('reminders').contains=node=>node===textarea;
  context.refreshDailyBoost();
  assert.equal(row(),typing,'the row being typed in is left alone');
});
// ── Start here ──
test('Start here names one next step, in order, and Not now moves on',()=>{
  const {context,element}=setup(), today=context.DailyBoostCore.dateKey();
  assert.equal(element('start').hidden,false);
  assert.match(element('start-kicker').textContent,/today’s spark/);
  assert.equal(element('start-then').textContent,'Then: a line in your note');
  context.addDailyBoostCheck({metric:'Check whether: margins recover',headline:'Grid',due:today});
  context.createDailyBoostExperiment('Walk at lunch',today,'');
  assert.match(element('start-kicker').textContent,/a check is due/,'what will not wait comes first');
  assert.equal(element('start-main').textContent,'Check whether: margins recover');
  assert.equal(element('start-then').textContent,'Then: an experiment review · today’s spark · a line in your note');
  element('start-skip').handlers.click();
  assert.equal(element('start-main').textContent,'Did “Walk at lunch” help?');
  element('start-skip').handlers.click();
  assert.match(element('start-kicker').textContent,/today’s spark/);
  element('done').handlers.click();
  assert.match(element('start-kicker').textContent,/one line/);
  element('note').value='Saw it'; element('note').handlers.input();
  assert.equal(element('start-kicker').textContent,'All done for today ✓','updates as the note is typed');
  assert.match(element('start-main').textContent,/The rest can wait/,'skipped steps are not forgotten');
  assert.equal(element('start-skip').hidden,true);
});
test('on Sundays Start here suggests the weekly read until there is one',()=>{
  let read=false;
  const {context,element}=setup({now:'2026-09-27T04:00:00Z',weeklyMirrorReadOn:()=>read});
  assert.match(element('start-kicker').textContent,/it’s Sunday/);
  read=true; context.refreshDailyBoost();
  assert.match(element('start-kicker').textContent,/today’s spark/);
});
test('Start here takes you to the step it names, and hides when signed out',()=>{
  const {context,element}=setup(); let went='';
  element('title').focus=()=>{went='spark';}; element('note').focus=()=>{went='note';};
  element('start-go').handlers.click(); assert.equal(went,'spark');
  element('done').handlers.click(); element('start-go').handlers.click(); assert.equal(went,'note');
  context.addDailyBoostCheck({metric:'m',headline:'h',due:context.DailyBoostCore.dateKey()});
  element('reminders').scrollIntoView=()=>{went='check';};
  element('start-go').handlers.click(); assert.equal(went,'check');
  context._firebaseUid=null; context.refreshDailyBoost();
  assert.equal(element('start').hidden,true);
});
test('a long check is shortened on the Start here card, with the full text kept as its title',()=>{
  const {context,element}=setup(), long='Check whether: '+'the review attributes the breach to ordinary credential misuse and not an agent '.repeat(3);
  let title=''; element('start-main').setAttribute=(name,value)=>{ if (name==='title') title=value; };
  context.addDailyBoostCheck({metric:long,headline:'h',due:context.DailyBoostCore.dateKey()});
  const shown=element('start-main').textContent;
  assert.ok(shown.length<=120 && shown.endsWith('…'),shown);
  assert.ok(!/\s…$/.test(shown),'cut at a word');
  assert.equal(title,long.trim().replace(/[.\s]+$/,'').slice(0,340));
});
// ── From your past ──
const dayKeyOf = t => new Date(t).toISOString().slice(0,10);
function cadenceDay(from, sunday=false) {
  for (let i=0;i<21;i++) { const key=dayKeyOf(Date.parse(from)+i*86400000), n=Math.floor(Date.parse(key+'T00:00:00Z')/86400000);
    if (n%3===0 && (new Date(key+'T00:00:00Z').getUTCDay()===0)===sunday) return key; }
}
function pastSetup(today, days) {
  const store=new Map([['bob-daily-boost:alice',JSON.stringify(days)]]);
  const env=setup({now:today+'T04:00:00Z',localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)}});
  return Object.assign(env,{store,stored:()=>JSON.parse(store.get('bob-daily-boost:alice'))});
}
const back=(today,n)=>dayKeyOf(Date.parse(today+'T00:00:00Z')-n*86400000);
test('a past note or helpful experiment comes back every third day; stubs and recent notes never do',()=>{
  const today=cadenceDay('2026-09-25'), days={
    [back(today,30)]:{spark:1,note:'Ask for the loss run before the site visit, not after it.',updatedAt:1},
    [back(today,20)]:{spark:2,trialPlan:'Call one former client',trialDue:back(today,17),trialResult:'helped',trialDone:true,updatedAt:1},
    [back(today,5)]:{spark:3,note:'A recent note that is too new to bring back yet.',updatedAt:1},
    [back(today,40)]:{spark:4,note:'On “A story” (Src): ',updatedAt:1},
    [back(today,35)]:{spark:5,note:'My take on “An aha”: ',updatedAt:1}};
  const {context,element,clock,stored}=pastSetup(today,days);
  assert.equal(element('past').hidden,false);
  const first=element('past-text').textContent;
  assert.ok(first==='“Ask for the loss run before the site visit, not after it.”'||first==='Call one former client',first);
  assert.match(element('past-kicker').textContent,/^From your past · \d+ (weeks|days) ago$/);
  assert.match(element('past-sub').textContent,/Still useful\?$/);
  element('past-dismiss').handlers.click();
  assert.equal(element('past-actions').hidden,true); assert.equal(element('past-status').textContent,'It won’t come back.');
  const dismissed=stored()[today].resurfaced; assert.equal(dismissed.action,'dismissed');
  clock.t+=3*86400000; context.renderDailyBoost();
  const next=cadenceDay(dayKeyOf(clock.t));
  if (next===dayKeyOf(clock.t)) {
    assert.equal(element('past').hidden,false,'the next cadence day brings the other one');
    assert.notEqual(element('past-text').textContent,first,'never the dismissed one');
  }
  clock.t+=86400000; context.renderDailyBoost();
  assert.equal(element('past').hidden,true,'not on the days between');
});
test('Use today puts a note in today’s reflection, and an experiment in today’s box unless one exists',()=>{
  const today=cadenceDay('2026-09-25');
  const note=pastSetup(today,{[back(today,21)]:{spark:1,note:'Ask for the loss run before the site visit.',updatedAt:1}});
  note.element('past-use').handlers.click();
  assert.match(note.element('note').value,/^Coming back to “Ask for the loss run before the site visit\.” \(\w{3} \d+ \w{3}\): $/);
  assert.equal(note.stored()[today].resurfaced.action,'used');
  const trialDays={[back(today,10)]:{spark:2,trialPlan:'Call one former client',trialDue:back(today,7),trialNext:'keep',trialDone:true,updatedAt:1}};
  const trial=pastSetup(today,trialDays);
  assert.equal(trial.element('past-use').textContent,'Try it again today');
  assert.match(trial.element('past-sub').textContent,/you wanted to keep doing/);
  trial.element('past-use').handlers.click();
  assert.equal(trial.element('trial-plan').value,'Call one former client');
  assert.equal(trial.element('trial-editor').open,true);
  const busy=pastSetup(today,Object.assign({[today]:{spark:3,trialPlan:'Already today',trialDue:today,updatedAt:1}},trialDays));
  busy.element('past-use').handlers.click();
  assert.match(busy.element('past-status').textContent,/Today already has an experiment/);
  assert.equal(busy.stored()[today].trialPlan,'Already today','the existing plan is kept');
});
test('nothing comes back on the Sunday look-back, and Later rests a discovery for two weeks',()=>{
  const sunday=cadenceDay('2026-09-01',true);
  const sun=pastSetup(sunday,{[back(sunday,30)]:{spark:1,note:'Ask for the loss run before the site visit.',updatedAt:1}});
  assert.equal(sun.element('past').hidden,true);
  const today=cadenceDay('2026-09-25'), ref='note:'+back(today,40);
  const days={[back(today,40)]:{spark:1,note:'Ask for the loss run before the site visit.',updatedAt:1},[back(today,9)]:{spark:2,resurfaced:{ref,action:'later'},updatedAt:1}};
  assert.equal(pastSetup(today,days).element('past').hidden,true,'nine days after Later: still resting');
  days[back(today,15)]=days[back(today,9)]; delete days[back(today,9)];
  assert.equal(pastSetup(today,days).element('past').hidden,false,'fifteen days after Later: back');
});
