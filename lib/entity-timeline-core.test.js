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

// ── Insurance news (news/ feed) ──
//
// These run the REAL search-core index through the timeline, rather than
// hand-built rows: the two cores share one index, and the thing worth proving is
// that news records survive that trip intact — above all their chronology.

// buildIndex creates its array inside the search core's vm realm, so a
// structurally identical literal here is not reference-equal to it. Array.from
// brings the values back into this realm; without it deepEqual reports "same
// structure but not reference-equal" and the test looks broken when it is not.
const searchSource = readFileSync(new URL('./intelligence-search-core.js', import.meta.url), 'utf8');
const searchContext = {Date, console};
vm.createContext(searchContext);
vm.runInContext(searchSource, searchContext);

// One snapshot, four articles published on four different days.
const newsIndex = searchContext.IntelligenceSearchCore.buildIndex({
  news: {
    date: '2026-08-29', generatedAt: '2026-08-29T00:52:53Z',
    items: [
      {id: 'n1', title: 'APRA quarterly data shows profits nearly wiped', url: 'https://pub/n1',
       summary: 'Sub-catastrophe events fell below reinsurance attachment points.',
       source: 'Insurance Business AU', section: 'Australia',
       publishedAt: '2026-08-27T00:00:00Z', tags: ['apra', 'reinsurance', 'catastrophe']},
      {id: 'n2', title: 'Flood cover gap blows out in highest-risk areas', url: 'https://pub/n2',
       summary: 'Cyclone pool research on take-up.', source: 'insuranceNEWS.com.au',
       section: 'Regulatory & Government', publishedAt: '2026-08-17T00:00:00Z',
       tags: ['flood', 'catastrophe']},
      {id: 'n3', title: 'APRA consults on prudential levy', url: 'https://pub/n3',
       summary: 'Insurers told they will pay a levy.', source: 'insuranceNEWS.com.au',
       section: 'Regulatory & Government', publishedAt: '2026-08-10T00:00:00Z',
       tags: ['apra', 'prudential']},
      {id: 'n4', title: 'Undated broker note', url: 'https://pub/n4', summary: 'No timestamp.',
       source: 'insuranceNEWS.com.au', section: 'Local', publishedAt: null, tags: ['apra']}
    ]
  }
});

test('a timeline on a matched keyword gathers the news records carrying it', () => {
  const result = core.build(newsIndex, 'apra');
  assert.equal(result.total, 3);
  assert.deepEqual(Array.from(result.sources), ['News']);
  assert.ok(result.entries.every(entry => entry.source === 'News'));
});

test('news orders by article publication date, not by the fetch that collected them', () => {
  const result = core.build(newsIndex, 'apra');
  assert.deepEqual(Array.from(result.entries, entry => entry.title), [
    'APRA quarterly data shows profits nearly wiped',
    'APRA consults on prudential levy',
    'Undated broker note'
  ]);
  assert.equal(result.firstSeen, Date.parse('2026-08-10T00:00:00Z'));
  assert.equal(result.lastSeen, Date.parse('2026-08-27T00:00:00Z'));
});

test('an undated article is counted as undated rather than dated to the snapshot', () => {
  const result = core.build(newsIndex, 'apra');
  assert.equal(result.undated, 1);
});

test('the catalog offers the feed keywords and publishers as quick picks', () => {
  const picks = core.catalog(newsIndex, {limit: 20});
  const apra = picks.find(entry => entry.key === 'apra');
  assert.equal(apra.records, 3);
  assert.deepEqual(Array.from(apra.sources), ['News']);
  assert.equal(apra.type, 'topic');
  assert.equal(picks.find(entry => entry.key === 'insurancenews.com.au').type, 'company');
});

test('a topic spanning news and the rest of the archive reports both sources', () => {
  const merged = newsIndex.concat([
    row('b9','Briefing','Catastrophe reserving review',Date.parse('2026-08-20T00:00:00Z'),
      [{label:'catastrophe',type:'topic'}])
  ]);
  const result = core.build(merged, 'catastrophe');
  assert.deepEqual(Array.from(result.sources), ['Briefing', 'News']);
  assert.equal(result.entries[0].title, 'APRA quarterly data shows profits nearly wiped');
  assert.equal(result.entries[1].title, 'Catastrophe reserving review');
});

test('a news timeline entry still points at the publisher article', () => {
  const result = core.build(newsIndex, 'flood');
  assert.equal(result.entries[0].ref, 'https://pub/n2');
});
