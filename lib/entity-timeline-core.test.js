import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('./entity-timeline-core.js', import.meta.url), 'utf8');
const context = {Date, console, Set};
vm.createContext(context);
vm.runInContext(source, context);
const core = context.EntityTimelineCore;

function row(id, sourceName, title, saved, entities, detail = '') {
  const searchText = [sourceName,title,detail,...entities.map(entry => entry.label)].join(' ').toLowerCase();
  return {id,source:sourceName,title,detail,body:'',meta:'',page:'today',ref:id,saved,entities,searchText};
}

const index = [
  row('b1','Briefing','RTX wins defense contract',Date.parse('2026-08-10T00:00:00Z'),[{label:'RTX',type:'asset'}]),
  row('r1','Radar','RTX · RTX Corporation',Date.parse('2026-08-15T00:00:00Z'),[{label:'RTX',type:'asset'},{label:'RTX Corporation',type:'company'}]),
  row('d1','Decisions','RTX',Date.parse('2026-08-12T00:00:00Z'),[{label:'RTX',type:'asset'}]),
  row('s1','Sports','Lakers vs Knicks',Date.parse('2026-08-18T00:00:00Z'),[{label:'Lakers',type:'team'},{label:'Knicks',type:'team'}]),
  row('t1','Research','Defense supply chain review',0,[{label:'insurance',type:'topic'}],'RTX backlog exposure')
];

test('catalog groups only explicit source-supplied entities', () => {
  const catalog = core.catalog(index,{limit:20});
  const rtx = catalog.find(entry => entry.label === 'RTX');
  assert.equal(rtx.records,3);
  assert.deepEqual(Array.from(rtx.sources),['Briefing','Decisions','Radar']);
  assert.equal(catalog.some(entry => entry.label === 'Defense'),false);
});

test('builds newest-first cross-source timeline for an exact entity', () => {
  const timeline = core.build(index,'RTX');
  assert.equal(timeline.total,4);
  assert.deepEqual(Array.from(timeline.entries.map(entry => entry.id)),['r1','d1','b1','t1']);
  assert.deepEqual(Array.from(timeline.sources),['Briefing','Decisions','Radar','Research']);
  assert.equal(timeline.undated,1);
});

test('supports arbitrary multi-token topics without pretending they are catalog entities', () => {
  const timeline = core.build(index,'defense contract');
  assert.equal(timeline.total,1);
  assert.equal(timeline.entries[0].id,'b1');
});

test('filters by source and matches accents consistently', () => {
  const extra = row('p1','Briefing','Señal de seguros',Date.parse('2026-08-16T00:00:00Z'),[{label:'Seguros',type:'topic'}]);
  const timeline = core.build(index.concat(extra),'senal seguros',{source:'Briefing'});
  assert.equal(timeline.total,1);
  assert.equal(timeline.entries[0].id,'p1');
});

test('rejects blank and one-character queries and bounds output', () => {
  assert.equal(core.build(index,'a').total,0);
  const many = Array.from({length:180},(_,position) => row('x'+position,'Briefing','Oil record '+position,position,[{label:'Oil',type:'topic'}]));
  assert.equal(core.build(many,'Oil',{limit:999}).entries.length,150);
});
