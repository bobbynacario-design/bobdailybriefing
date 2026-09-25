import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./daily-boost.js',import.meta.url),'utf8');
function setup() {
  const elements = new Map(), saved = new Map();
  const make = () => ({value:'',textContent:'',children:[],handlers:{},focus(){},setAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;},replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);},append(...children){this.children.push(...children);}});
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
  assert.equal(core.count,42);
  assert.equal(new Set(Array.from({length:core.count},(_,i)=>core.promptFor('2026-09-25',i)[0])).size,42);
  assert.equal(core.promptFor('2026-09-25',core.count)[0],core.promptFor('2026-09-25',0)[0]);
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
