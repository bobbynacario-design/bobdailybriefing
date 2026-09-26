import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('./evidence-sets-core.js', import.meta.url), 'utf8');
const context = {Date, console};
vm.createContext(context);
vm.runInContext(source, context);
const core = context.EvidenceSetsCore;

const now = '2026-08-16T01:00:00Z';
const item = {id:'radar-RTX',source:'Radar',title:'RTX forming setup',detail:'Defense backlog',meta:'forming · score 88',page:'radar',ref:'RTX'};
test('saved aha preserves its condition and source links beyond the story preview limit',()=>{
  const detail='Insight '.repeat(100)+'Wrong if: demand reverses. Source: https://example.com/report';
  const state=core.createSet({},'Insights',now,'insights').state;
  const saved=core.addItem(state,'insights',{id:'briefing:2026-09-26:aha',source:'Briefing',title:'An insight',detail},now).state;
  assert.match(core.researchNote(saved,'insights'),/Wrong if: demand reverses\. Source: https:\/\/example.com\/report/);
});

test('working questions survive evidence edits and export assessment separately from sources', () => {
  let state = core.createSet({},'Restoration review',now,'question-1').state;
  state = core.updateQuestion(state,'question-1',{prompt:'What extends restoration?',assessment:'My view\nStill provisional',gaps:'Request repair records',deadline:'2026-10-01'},now).state;
  state = core.addItem(state,'question-1',item,now).state;
  state = core.updateNote(state,'question-1',state.sets[0].items[0].key,'Check original',now).state;
  assert.equal(core.normalize(state).sets[0].question.assessment,'My view\nStill provisional');
  const note = core.researchNote(state,'question-1');
  assert.match(note,/## My assessment\nMy view\nStill provisional/);
  assert.match(note,/## Saved evidence snapshots/);
  assert.match(note,/Source: Radar/);
  assert.match(note,/My note: Check original/);
  assert.equal(core.updateQuestion(state,'question-1',{prompt:''},now).changed,false);
  assert.equal(core.researchNote(state,'missing'),'');
});

test('legacy sets stay valid and question fields are bounded', () => {
  const state = core.createSet({},'Legacy',now,'legacy').state;
  assert.equal(state.sets[0].question,undefined);
  const updated = core.updateQuestion(state,'legacy',{prompt:'Q',status:'unexpected',assessment:'x'.repeat(5000),reviewedAt:now},now).state;
  assert.equal(updated.sets[0].question.status,'active');
  assert.equal(updated.sets[0].question.assessment.length,4000);
  assert.equal(updated.sets[0].question.reviewedAt,now.replace('00Z','00.000Z'));
});

test('creates, renames, and deletes named evidence sets', () => {
  let result = core.createSet({}, 'Claims watch', now, 'set-1');
  assert.equal(result.changed, true);
  assert.equal(result.state.sets[0].name, 'Claims watch');
  result = core.renameSet(result.state, 'set-1', 'Claims evidence', '2026-08-16T02:00:00Z');
  assert.equal(result.state.sets[0].name, 'Claims evidence');
  result = core.deleteSet(result.state, 'set-1');
  assert.equal(result.state.sets.length, 0);
});

test('adds a provenance snapshot once and preserves its user note', () => {
  let state = core.createSet({}, 'Defense', now, 'set-1').state;
  let result = core.addItem(state, 'set-1', item, now);
  assert.equal(result.state.sets[0].items.length, 1);
  assert.equal(result.state.sets[0].items[0].key, 'radar:radar-rtx');
  assert.ok(result.state.sets[0].items[0].capturedAt);
  result = core.addItem(result.state, 'set-1', item, now);
  assert.equal(result.changed, false);
  assert.match(result.error, /already/);
  result = core.updateNote(result.state, 'set-1', 'radar:radar-rtx', 'Check against insurer exposure.', now);
  assert.equal(result.state.sets[0].items[0].note, 'Check against insurer exposure.');
});

test('removes an item without disturbing the containing set', () => {
  let state = core.createSet({}, 'Defense', now, 'set-1').state;
  state = core.addItem(state, 'set-1', item, now).state;
  const result = core.removeItem(state, 'set-1', 'radar:radar-rtx', now);
  assert.equal(result.state.sets.length, 1);
  assert.equal(result.state.sets[0].items.length, 0);
});

test('normalization enforces bounded sets, items, names, and notes', () => {
  const raw = {sets:[]};
  for (let s = 0; s < 15; s++) {
    raw.sets.push({id:'set-'+s,name:'N'.repeat(100),updatedAt:new Date(Date.UTC(2026,0,s+1)).toISOString(),items:Array.from({length:35},(_,i)=>({...item,id:'item-'+i,note:'x'.repeat(600)}))});
  }
  const normalized = core.normalize(raw);
  assert.equal(normalized.sets.length, 12);
  assert.equal(normalized.sets[0].items.length, 30);
  assert.equal(normalized.sets[0].name.length, 80);
  assert.equal(normalized.sets[0].items[0].note.length, 500);
});

test('rejects duplicate set names case-insensitively', () => {
  const state = core.createSet({}, 'Claims watch', now, 'set-1').state;
  const result = core.createSet(state, 'claims WATCH', now, 'set-2');
  assert.equal(result.changed, false);
  assert.match(result.error, /already exists/);
});

test('a saved story keeps its web link, and the research note prints it', () => {
  const story = {id:'briefing:Friday--September-25--2026:interruptions:0',source:'Briefing',title:'Port strike halts Botany terminal',detail:'Importers with stock-in-transit cover exposed.',meta:'Friday, September 25, 2026 · Interruptions',page:'today',ref:'Friday--September-25--2026',url:'https://lloydslist.com/port'};
  let state = core.createSet({},'Botany claims',now,'set-1').state;
  state = core.addItem(state,'set-1',{...item,url:'javascript:alert(1)'},now).state;
  state = core.addItem(state,'set-1',story,now).state;
  const saved = core.normalize(state).sets[0].items, byId = id => saved.find(entry => entry.id === id);
  assert.equal(byId(story.id).url,'https://lloydslist.com/port');
  assert.equal(byId('radar-RTX').url,'','only web links are kept');
  assert.match(core.researchNote(state,'set-1'),/### \[1\] Port strike halts Botany terminal\n[^\n]*\nSource: Briefing · Friday, September 25, 2026 · Interruptions\nLink: https:\/\/lloydslist\.com\/port\nCaptured:/);
});

test('a saved dossier keeps its line breaks; an ordinary story is one line',()=>{
  const state=core.createSet({},'Dossiers',now,'dossiers').state;
  const detail='Dossier · Strata\n- Rain in March.\n\n- Mould   followed.\r\nQ1. Who owns the delay?';
  const saved=core.addItem(state,'dossiers',{id:'briefing:2026-09-26:insurance:0:dossier',source:'Briefing',title:'Dossier: Strata',detail},now).state;
  assert.equal(saved.sets[0].items[0].detail,'Dossier · Strata\n- Rain in March.\n- Mould followed.\nQ1. Who owns the delay?','blank lines dropped, spaces tidied, breaks kept');
  const story=core.addItem(state,'dossiers',{id:'briefing:2026-09-26:insurance:0',source:'Briefing',title:'Story',detail},now).state;
  assert.ok(!story.sets[0].items[0].detail.includes('\n'));
  assert.ok(core.researchNote(saved,'dossiers').includes('- Rain in March.\n- Mould followed.'),'the research note keeps the structure');
});

test('a saved dossier keeps its longer text, like an aha',()=>{
  const detail='Dossier '.repeat(100)+'Q3. Who owns the drying delay? Source: https://example.com/strata';
  const state=core.createSet({},'Dossiers',now,'dossiers').state;
  const saved=core.addItem(state,'dossiers',{id:'briefing:2026-09-26:insurance:0:dossier',source:'Briefing',title:'Dossier: Strata',detail},now).state;
  assert.ok(core.researchNote(saved,'dossiers').includes('Q3. Who owns the drying delay? Source: https://example.com/strata'));
  const story=core.addItem(state,'dossiers',{id:'briefing:2026-09-26:insurance:0',source:'Briefing',title:'Story',detail},now).state;
  assert.ok(!core.researchNote(story,'dossiers').includes('Q3. Who owns'),'an ordinary story keeps the short limit');
});
