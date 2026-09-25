import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./daily-boost.js',import.meta.url),'utf8');
function setup() {
  const elements = new Map(), saved = new Map();
  const make = () => ({value:'',textContent:'',children:[],handlers:{},focus(){},select(){},setAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;},replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);},append(...children){this.children.push(...children);}});
  const element = id => {
    if (!elements.has(id)) elements.set(id,make());
    return elements.get(id);
  };
  const events = {};
  const context = {_firebaseUid:'alice',setInterval(){},localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},document:{getElementById:element,addEventListener:(name,fn)=>events[name]=fn,createElement:make}};
  context.window=context; vm.createContext(context); vm.runInContext(source,context); events.DOMContentLoaded();
  return {context,saved,element:name=>element('boost-'+name)};
}
test('daily prompts use PHT midnight and rotate across the expanded library',()=>{
  const {context}=setup(), core=context.DailyBoostCore;
  assert.equal(core.dateKey(new Date('2026-09-25T15:59:59Z')),'2026-09-25');
  assert.equal(core.dateKey(new Date('2026-09-25T16:00:00Z')),'2026-09-26');
  assert.equal(core.count,50);
  assert.equal(new Set(Array.from({length:core.count},(_,i)=>core.promptFor('2026-09-25',i)[0])).size,50);
  assert.equal(core.promptFor('2026-09-25',core.count)[0],core.promptFor('2026-09-25',0)[0]);
});
test('rotation covers every spark once and never repeats a theme on consecutive days',()=>{
  const {context}=setup(), core=context.DailyBoostCore, days=[];
  for (let i=0;i<=core.count;i++) days.push(new Date(Date.UTC(2026,8,25+i)).toISOString().slice(0,10));
  const sparks=days.map(day=>core.sparkFor(day,{}));
  assert.equal(new Set(sparks.slice(0,core.count)).size,core.count);
  assert.equal(sparks[core.count],sparks[0]);
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
  assert.match(element('library-summary').textContent,/Browse all 50 sparks/);
  element('theme').value=''; element('search').value='work craft'; element('search').handlers.input();
  assert.equal(element('library-list').children.length,8);
  element('search').value='but for'; element('search').handlers.input();
  const card=element('library-list').children[0];
  assert.equal(card.children[2].textContent,'Choose · Work craft');
  card.children[2].handlers.click();
  assert.equal(element('title').textContent,'Test the “but for” story');
  assert.match(element('date').textContent,/ · Work craft$/);
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
