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
  assert.deepEqual(Array.from(index.find(item => item.id === 'radar:RTX').entities.map(item => item.label)), ['RTX','RTX Corporation']);
  assert.deepEqual(Array.from(index.find(item => item.id === 'sports:nba:g1').entities.map(item => item.label)), ['Lakers','Knicks']);
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

// ── Insurance news (news/ feed) ──

const newsInput = {
  news: {
    date: '2026-08-29',
    generatedAt: '2026-08-29T00:52:53Z',
    items: [
      {id: 'ib-au:u:pub/a', title: 'Claims intermediaries in disaster areas now under ASIC watch',
       url: 'https://www.insurancebusinessmag.com/au/news/catastrophe/claims-587551.aspx',
       summary: 'ASIC names claims intermediaries a supervisory priority for the first time.',
       source: 'Insurance Business AU', section: 'Australia',
       publishedAt: '2026-08-26T00:00:00Z', tier: 'core', tags: ['catastrophe', 'apra', 'asic']},
      {id: 'in-reg:u:pub/b', title: 'Flood cover gap blows out in highest-risk areas',
       url: 'https://www.insurancenews.com.au/regulatory-government/flood-cover-gap',
       summary: 'Home flood insurance take-up drops to 33% where risk is extreme.',
       source: 'insuranceNEWS.com.au', section: 'Regulatory & Government',
       publishedAt: '2026-08-17T00:00:00Z', tier: 'core', tags: ['flood', 'catastrophe']},
      {id: 'in-reg:u:pub/c', title: 'Undated trade note', url: 'https://www.insurancenews.com.au/x/c',
       summary: 'No timestamp supplied.', source: 'insuranceNEWS.com.au', section: 'Local',
       publishedAt: null, tier: 'context', tags: ['broker']}
    ]
  }
};

test('indexes insurance news as its own source', () => {
  const index = core.buildIndex(newsInput);
  const news = index.filter(item => item.source === 'News');
  assert.equal(news.length, 3);
  assert.equal(news[0].title, 'Claims intermediaries in disaster areas now under ASIC watch');
  assert.equal(news[0].page, 'today');
});

test('a news record is dated by the ARTICLE, not by when the feed was fetched', () => {
  const index = core.buildIndex(newsInput);
  const news = index.filter(item => item.source === 'News');
  assert.equal(news[0].saved, Date.parse('2026-08-26T00:00:00Z'));
  assert.equal(news[1].saved, Date.parse('2026-08-17T00:00:00Z'));
  assert.notEqual(news[0].saved, news[1].saved,
    'articles from one snapshot must not collapse onto a single timestamp');
  assert.notEqual(news[0].saved, Date.parse(newsInput.news.generatedAt));
});

test('an undated article keeps no date rather than inheriting the snapshot time', () => {
  const index = core.buildIndex(newsInput);
  assert.equal(index.find(item => item.title === 'Undated trade note').saved, 0);
});

test('the news record points at the publisher article, not an in-app key', () => {
  const index = core.buildIndex(newsInput);
  assert.equal(index.find(item => item.source === 'News').ref,
    'https://www.insurancebusinessmag.com/au/news/catastrophe/claims-587551.aspx');
});

test('news carries its matched keywords and publisher as entities', () => {
  const index = core.buildIndex(newsInput);
  const entities = index.find(item => item.source === 'News').entities;
  assert.deepEqual(entities.filter(e => e.type === 'topic').map(e => e.label), ['catastrophe', 'apra', 'asic']);
  assert.deepEqual(entities.filter(e => e.type === 'company').map(e => e.label), ['Insurance Business AU']);
});

test('news meta names the publisher, section and publication day', () => {
  const index = core.buildIndex(newsInput);
  assert.equal(index.find(item => item.source === 'News').meta,
    'Insurance Business AU · Australia · 2026-08-26');
  assert.match(index.find(item => item.title === 'Undated trade note').meta, /undated$/);
});

test('news is findable by headline, by summary and by matched keyword', () => {
  const index = core.buildIndex(newsInput);
  const now = Date.parse('2026-08-29T00:00:00Z');
  assert.equal(core.search(index, 'claims intermediaries', {now})[0].source, 'News');
  assert.equal(core.search(index, 'supervisory priority', {now})[0].source, 'News');
  assert.ok(core.search(index, 'flood', {now}).some(item => item.source === 'News'));
});

test('news can be filtered to on its own, and coexists with the other sources', () => {
  const index = core.buildIndex(Object.assign({}, input, newsInput));
  const now = Date.parse('2026-08-29T00:00:00Z');
  const only = core.search(index, 'flood', {now, source: 'News'});
  assert.ok(only.length);
  assert.ok(only.every(item => item.source === 'News'));
  assert.ok(index.some(item => item.source === 'Briefing'), 'other sources still indexed');
  assert.ok(core.search(index, 'claims inflation', {now}).some(item => item.source === 'Briefing'));
});

test('an absent or empty news snapshot indexes nothing and breaks nothing', () => {
  assert.equal(core.buildIndex({news: null}).length, 0);
  assert.equal(core.buildIndex({news: {items: []}}).length, 0);
  assert.ok(core.buildIndex(input).length > 0);
});
