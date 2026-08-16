import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('./intelligence-search-core.js', import.meta.url), 'utf8');
const context = {Date, console};
vm.createContext(context);
vm.runInContext(source, context);
const core = context.IntelligenceSearchCore;

const input = {
  briefings: [{key:'2026-08-15',saved:Date.parse('2026-08-15T00:00:00Z'),data:{date:'15 Aug 2026',sections:{insurance:[{headline:'Claims inflation rises',body:'Motor repair severity increased across Australia.',relevance:'Reserve review required'}]}}}],
  reports: [{id:'r1',title:'Typhoon business interruption',dek:'Exposure review',tags:['insurance'],md:'Supply-chain losses in the Visayas.',saved:Date.parse('2026-08-10T00:00:00Z')}],
  decisions: [{id:'d1',asset:'NVDA',reason:'AI infrastructure momentum',status:'open',createdDate:'2026-08-14',saved:Date.parse('2026-08-14T00:00:00Z')}],
  radar: {signals:[{symbol:'RTX',name:'RTX Corporation',status:'forming',score:88,catalyst:'Defense backlog'}]},
  markets: {markets:[{slug:'rates',label:'US recession by end-2026',summary:'Rate path changed',impliedYes:.08}]},
  sports: {modules:{nba:{title:'NBA',upcoming:[{id:'g1',home:'Lakers',away:'Knicks',utcDate:'2026-08-18T12:00:00Z'}],risingTeams:[{team:'Lakers',label:'RISING',note:'Five straight wins'}]}}}
};

test('builds searchable records across every supported app source', () => {
  const index = core.buildIndex(input);
  assert.deepEqual(Array.from(new Set(index.map(item => item.source))).sort(), ['Briefing','Decisions','Markets','Radar','Research','Sports']);
  assert.equal(index.filter(item => item.source === 'Sports').length, 2);
});

test('requires every query token and searches story bodies', () => {
  const results = core.search(core.buildIndex(input), 'motor Australia', {now:Date.parse('2026-08-16T00:00:00Z')});
  assert.equal(results.length, 1);
  assert.equal(results[0].source, 'Briefing');
});

test('title matches outrank body-only matches', () => {
  const index = core.buildIndex(input);
  const results = core.search(index.concat([{id:'extra',source:'Other',title:'Other',detail:'',body:'NVDA background note',meta:'',page:'today',ref:'',saved:0,searchText:'other nvda background note'}]), 'NVDA', {now:Date.parse('2026-08-16T00:00:00Z')});
  assert.equal(results[0].id, 'decision:d1');
});

test('supports source filtering and accent-insensitive matching', () => {
  const index = core.buildIndex(input).concat([{id:'ph',source:'Briefing',title:'Philippine peso',detail:'Señal macro',body:'',meta:'',page:'today',ref:'x',saved:0,searchText:core.normalized('Philippine peso Señal macro')}]);
  const results = core.search(index, 'senal', {source:'Briefing'});
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'ph');
});

test('returns no results for empty or one-character queries', () => {
  const index = core.buildIndex(input);
  assert.deepEqual(Array.from(core.search(index, '')), []);
  assert.deepEqual(Array.from(core.search(index, 'a')), []);
});
