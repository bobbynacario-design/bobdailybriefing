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

test('a decision names its parts: no reason recorded, invalidator, outcome, and no "Mistake: none"', () => {
  const index = core.buildIndex({decisions: [
    {id: 'eth', asset: 'ETH', reason: '', invalidator: 'Closes below 2597', outcomeNote: '', mistakeType: 'none', status: 'open', action: 'took', conviction: 4, createdDate: '2026-07-21'},
    {id: 'rtx', asset: 'RTX', reason: 'Defence backlog', invalidator: '', outcomeNote: 'Stopped out', mistakeType: 'timing', status: 'closed', outcome: 'loss', createdDate: '2026-08-01'}]});
  const eth = index.find(item => item.id === 'decision:eth'), rtx = index.find(item => item.id === 'decision:rtx');
  assert.equal(eth.detail, 'No reason recorded'); assert.equal(eth.body, 'Invalidator: Closes below 2597'); assert.equal(eth.meta, '2026-07-21 · took · open · conviction 4/5');
  assert.equal(rtx.detail, 'Defence backlog'); assert.equal(rtx.body, 'Outcome: Stopped out · Mistake: timing');
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

test('reflections are found by the note or by the stories that day was about', () => {
  const index = core.buildIndex({reflections: [
    {day:'2026-09-24', label:'Thu 24 Sep', spark:'Test the “but for” story', theme:'Work craft', note:'Two matters shared the same missing lease schedule.', done:true, stories:['Port strike halts Botany terminal']},
    {day:'2026-09-22', label:'Tue 22 Sep', spark:'Look for the exception', theme:'Perspective', note:'', done:false, stories:['Reinsurers reprice cat layers']}
  ]});
  const lease = core.search(index, 'lease schedule', {now:Date.parse('2026-09-25T00:00:00Z')});
  assert.equal(lease.length, 1);
  assert.equal(lease[0].id, 'reflection:2026-09-24');
  assert.equal(lease[0].source, 'Reflections');
  assert.equal(lease[0].title, 'Thu 24 Sep · Test the “but for” story');
  assert.equal(lease[0].page, 'today');
  assert.equal(lease[0].ref, '2026-09-24');
  assert.equal(lease[0].meta, 'Work craft · small win');
  const story = core.search(index, 'reinsurers', {now:Date.parse('2026-09-25T00:00:00Z')});
  assert.equal(story[0].ref, '2026-09-22');
  assert.match(story[0].excerpt, /Reinsurers reprice cat layers/, 'a day with no note shows the story it was about');
});

// ── Whole-word matching, the personal sources, and Ask Daybook's lookup ──

const personal = {
  briefings: [{key:'2026-09-20',saved:Date.parse('2026-09-20T00:00:00Z'),data:{date:'Sunday, September 20, 2026',sections:{
    insurance:[{headline:'Suncorp lifts hazard allowance',body:'Suncorp raised its natural-hazard budget together with IAG.'}],
    interruptions:[{headline:'Trucking operator back on road after heavy vehicle repairs',body:'A 2.5-month loss of income for the operator.'}],
    markets:[{headline:'Ethereum ETF flows turn positive',body:'ETH rallied on inflows.'}]}}}],
  decisions: [{id:'d-eth',asset:'ETH',reason:'Staking yield and ETF flows',status:'open',createdDate:'2026-07-21',saved:Date.parse('2026-07-21T00:00:00Z')}],
  evidence: {sets:[{id:'set1',name:'QBE recoveries',items:[{key:'k1',id:'briefing:x:insurance:0',source:'Briefing',title:'QBE claims inflation',detail:'Motor severity up.',note:'Ask the broker about the storm excess',capturedAt:'2026-09-21T01:00:00Z'}]}]},
  dossiers: {dk1:{summary:'Allianz small-business BI claims rose after the floods.',bi_angle:'Loss of gross profit measured over 12 months.',story:{headline:'Allianz flood claims',date:'Saturday, September 26, 2026',section:'insurance'},generatedAt:'2026-09-26T02:00:00Z'}},
  meetingBriefs: {m1:{topic:'Suncorp',where_things_stand:'Takeover talk is back.',questions:['What does the bid mean for claims teams?'],generatedAt:'2026-09-28T02:00:00Z'}},
  mirrors: {'2026-09-27':{week_in_a_line:'A week of QBE recoveries.',range:{from:'2026-09-21',to:'2026-09-27'},question:'What would you drop?'}},
  grounding: {facts:[{recordId:'nsw-r4',seriesId:'nsw-labour',title:'Ausgrid R4 field worker hourly rate',display:'$152.30 an hour',jurisdiction:'NSW',observationKey:'FY27',lifecycle:'current',publishedAt:'2026-09-29T00:00:00Z'}],
    watch:[{watchId:'cpi',seriesId:'cpi',title:'CPI (monthly)',state:'awaiting',expectedBy:'2026-10-28T00:00:00Z',detail:'ABS release',stateChangedAt:'2026-09-30T00:00:00Z'}]}
};
const now = Date.parse('2026-09-30T00:00:00Z');

test('words match from their start, so ETH is not found inside "together"', () => {
  const index = core.buildIndex(personal);
  const eth = core.search(index, 'eth', {now});
  assert.deepEqual(Array.from(eth.map(item => item.id)).sort(), ['briefing:2026-09-20:markets:0', 'decision:d-eth']);
  assert.ok(!eth.some(item => /suncorp/i.test(item.title)), 'the Suncorp story says "together", which is not ETH');
  assert.equal(core.search(index, 'ethereum', {now}).length, 1);
  assert.equal(core.search(index, 'claim', {now}).filter(item => item.source === 'Evidence').length, 1, 'a word start still finds "claims"');
  assert.equal(Object.keys(index[0]).includes('words'), false, 'the cached word text is not copied into results or JSON');
});

test('the personal sources are searchable: evidence, dossiers, meeting briefs, weekly reads and your numbers', () => {
  const index = core.buildIndex(personal);
  const bySource = source => index.filter(item => item.source === source);
  const ev = bySource('Evidence')[0];
  assert.equal(ev.id, 'evidence:set1:k1'); assert.equal(ev.page, 'evidence'); assert.equal(ev.ref, 'set1');
  assert.equal(ev.meta, 'Saved to QBE recoveries · Briefing'); assert.equal(ev.body, 'Note: Ask the broker about the storm excess');
  const dossier = bySource('Dossier')[0];
  assert.equal(dossier.title, 'Allianz flood claims'); assert.equal(dossier.ref, 'dk1'); assert.match(dossier.body, /gross profit/);
  assert.equal(bySource('Meeting')[0].title, 'Meeting brief: Suncorp');
  assert.equal(bySource('Weekly read')[0].title, 'Your week, read back · 2026-09-21 to 2026-09-27');
  const numbers = bySource('Numbers');
  assert.deepEqual(Array.from(numbers.map(item => item.id)), ['numbers:nsw-r4', 'numbers-watch:cpi']);
  assert.equal(numbers[0].detail, '$152.30 an hour'); assert.equal(numbers[1].detail, 'awaiting · expected by 2026-10-28');
  assert.equal(core.search(index, 'storm excess', {now})[0].source, 'Evidence', 'his note is found');
});

test('Ask lookup: any term may match, phrases count, and filler words never sink a question', () => {
  const index = core.buildIndex(personal);
  assert.equal(core.search(index, 'Why did I make the ETH call, and was I right?', {now}).length, 0, 'the Search box needs every word');
  const eth = core.searchPlan(index, {terms:['ETH', 'Ethereum'], sources:['Decisions']}, {now});
  assert.deepEqual(Array.from(eth.map(item => item.id)), ['decision:d-eth']);
  const heavy = core.searchPlan(index, {terms:['heavy vehicle', 'loss of income', 'trucking']}, {now});
  assert.equal(heavy[0].id, 'briefing:2026-09-20:interruptions:0');
  assert.deepEqual(Array.from(heavy[0].matched), ['heavy vehicle', 'loss of income', 'trucking']);
  assert.equal(core.searchPlan(index, {terms:['heavy truck']}, {now}).length, 0, 'a phrase must appear as written');
});

test('Ask lookup: sources and a date window narrow it, and more terms rank higher', () => {
  const index = core.buildIndex(personal);
  const suncorp = core.searchPlan(index, {terms:['Suncorp']}, {now});
  assert.deepEqual(Array.from(suncorp.map(item => item.source)).sort(), ['Briefing', 'Meeting']);
  assert.deepEqual(Array.from(core.searchPlan(index, {terms:['Suncorp'], since:'2026-09-25'}, {now}).map(item => item.source)), ['Meeting']);
  assert.deepEqual(Array.from(core.searchPlan(index, {terms:['Suncorp'], until:'2026-09-20'}, {now}).map(item => item.source)), ['Briefing'], 'until covers the whole day');
  const qbe = core.searchPlan(index, {terms:['QBE', 'recoveries']}, {now});
  assert.equal(qbe[0].source, 'Evidence', 'two terms beat one'); assert.equal(qbe[0].matched.length, 2);
  assert.deepEqual(Array.from(core.searchPlan(index, {terms:['', 'a']}, {now})), [], 'no usable terms, no results');
  assert.equal(core.searchPlan(index, {terms:['x1','x2','x3','x4','x5','x6','x7','x8','suncorp']}, {now}).length, 0, 'at most eight terms are used');
  assert.equal(core.searchPlan(index, {terms:['Suncorp'], limit:1}, {now}).length, 1);
});

test('records a caller builds itself are indexed and searchable like any other', () => {
  const index = core.buildIndex({records: [{id: 'profile:other', source: 'Profile', title: 'Your profile: Anything else', detail: 'Keen on AI tools for productivity', page: 'about', ref: 'other'}, {id: '', source: 'Profile', title: 'no id'}]});
  assert.equal(index.length, 1, 'a row without an id is skipped');
  assert.equal(core.search(index, 'ai tools')[0].id, 'profile:other');
  assert.equal(core.searchPlan(index, {terms: ['productivity'], sources: ['Profile']})[0].page, 'about');
});

test('ChatGPT citation markers are stripped from reports, and real words that start "cite" are kept', () => {
  const strip = core.stripCiteMarkers;
  assert.equal(strip('as of June 17. citeturn12view0turn7view4\n\nNext'), 'as of June 17. \n\nNext');
  assert.equal(strip('iturn35image0'), '', 'an image marker (one summary was only this)');
  assert.equal(strip('concepts. fileciteturn0file0 Then'), 'concepts. Then');
  assert.equal(strip('Bare: citeturn31search0turn2view1 and iturn35image0 gone.'), 'Bare: and gone.');
  assert.equal(strip('He cited two cases; the citation stands; it cites AFCA.'), 'He cited two cases; the citation stands; it cites AFCA.', 'the old rule dropped these');
  assert.equal(strip('entity["company","QBE"] rose'), ' rose');
  const index = core.buildIndex({reports: [{id: 'r', title: 'Munger', dek: 'iturn35image0', md: 'Inversion helps. citeturn1view0'}]});
  assert.equal(index[0].detail, ''); assert.equal(index[0].body, 'Inversion helps.');
  assert.equal(core.search(index, 'turn35image0').length, 0, 'a marker is never searchable');
});

// The Radar in Search and Ask (October 2026): a record carries what the card
// shows, names today's picks, and a broad lookup reads the top scores.
const radarDay = Date.parse('2026-10-03T06:00:00Z');
const radarSig = (symbol, o) => Object.assign({symbol, theme: 'AI semis', status: 'forming', score: 60, entry: 100, stop: 95, target: 110, rr: 2,
  why: symbol + ' is holding above its averages.', invalidation: 'The idea is off if ' + symbol + ' closes back below 95.'}, o);
const radarInput = {
  radar: {generatedAt: '2026-10-03T06:00:00Z', picks: {taker: ['SOXX'], wildcard: ['GEV']}, signals: [
    radarSig('AMD', {score: 40}),
    radarSig('SOXX', {score: 88, early: true, accumulation: 2.72, catalyst: 'Chips rose on the jobs report', eventType: 'macro', catalystAsOf: '2026-10-02',
      read: {why: 'Chips rallied after a soft jobs print.', wouldBreak: 'A close below 95.'}}),
    radarSig('GEV', {score: 60, early: true}),
    radarSig('GLD', {score: 30, status: 'invalidated', target: null, rr: 0})
  ]},
  sports: {modules: {nba: {title: 'NBA Momentum Radar', upcoming: [{id: 'g1', home: 'Lakers', away: 'Knicks', utcDate: '2026-10-08T12:00:00Z'}]}}},
  briefings: [{key: '2026-06-17', saved: Date.parse('2026-06-17T00:00:00Z'), data: {date: '17 Jun 2026', sections: {ev: [{headline: 'Lithium-ion fire risk stays on insurer radar', body: 'Battery fires.'}]}}}]
};

test('a Radar record carries the card: reason, catalyst, read, early flag, levels, tripwire and pick', () => {
  const index = core.buildIndex(radarInput);
  const soxx = index.find(item => item.id === 'radar:SOXX');
  assert.equal(soxx.detail, 'SOXX is holding above its averages.', 'the score\'s reason leads');
  assert.equal(soxx.meta, 'Taker pick · forming · early · score 88', 'early is the card chip, in meta');
  assert.equal(soxx.rank, 88);
  for (const part of ['Catalyst (macro, 2026-10-02): Chips rose on the jobs report.', "Why it's moving: Chips rallied after a soft jobs print.",
    'What would break it: A close below 95.', 'Early: forming, with up-day volume 2.7× down-day volume over 20 sessions.',
    'Radar levels: entry 100 · stop 95 · target 110 · upside +10.0% · R:R 2.', 'The idea is off if SOXX closes back below 95.', 'Theme: AI semis.']) {
    assert.ok(soxx.body.includes(part), 'body has: ' + part);
  }
  assert.equal(index.find(item => item.id === 'radar:GEV').meta, 'Wildcard pick · forming · early · score 60');
  assert.equal(index.find(item => item.id === 'radar:AMD').meta, 'forming · score 40', 'no chip, no early, whatever its reason says');
  const gld = index.find(item => item.id === 'radar:GLD');
  assert.ok(gld.body.includes('Radar levels: entry 100 · stop 95.'), 'no target, so no upside or R:R');
  assert.ok(!/Catalyst|Early/.test(gld.body));
  // A doc from before picks existed names its six together.
  const old = core.buildIndex({radar: {catalystRun: {focus: ['SOXX']}, signals: [radarSig('SOXX'), radarSig('AMD')]}});
  assert.equal(old.find(item => item.id === 'radar:SOXX').meta, 'Taker or Wildcard pick · forming · score 60');
  assert.equal(old.find(item => item.id === 'radar:AMD').meta, 'forming · score 60');
});

test('"radar" reads the Radar by score, ahead of the NBA Momentum Radar and an insurer-radar story', () => {
  const index = core.buildIndex(radarInput);
  const now = radarDay;
  assert.deepEqual(Array.from(core.searchPlan(index, {terms: ['radar'], sources: ['Radar']}, {now}).map(item => item.ref)),
    ['SOXX', 'GEV', 'AMD', 'GLD'], 'by score, not alphabetically');
  const open = core.searchPlan(index, {terms: ['radar']}, {now});
  assert.deepEqual(Array.from(open.slice(0, 4).map(item => item.source)), ['Radar', 'Radar', 'Radar', 'Radar'], 'the source name counts like a title hit');
  const picks = core.searchPlan(index, {terms: ['Taker', 'Wildcard', 'radar']}, {now});
  assert.deepEqual(Array.from(picks.slice(0, 2).map(item => item.ref)), ['SOXX', 'GEV']);
  // The Search box still puts a story titled with the word first, then the
  // Radar by score, and the NBA games after them.
  const box = core.search(index, 'radar', {now});
  assert.deepEqual(Array.from(box.map(item => item.source)), ['Briefing', 'Radar', 'Radar', 'Radar', 'Radar', 'Sports']);
  assert.deepEqual(Array.from(box.filter(item => item.source === 'Radar').map(item => item.ref)), ['SOXX', 'GEV', 'AMD', 'GLD']);
});

test('a Radar record says how names in its score band have done before, from the journal', () => {
  const byScoreBucket = {'80-100': {n: 2858, excessWinRate: 55.7, avgExcessReturn: 2.23}, '60-79': {n: 5508, excessWinRate: 42.6, avgExcessReturn: 0.21},
    '40-59': {n: 0, excessWinRate: null, avgExcessReturn: null}, '0-39': {n: 2965, excessWinRate: null, avgExcessReturn: -0.08}};
  const index = core.buildIndex({radar: {signals: [radarSig('A', {score: 80}), radarSig('B', {score: 79.5}), radarSig('C', {score: 45}), radarSig('D', {score: 12})]},
    radarJournal: {byScoreBucket}});
  const body = (ref) => index.find(item => item.ref === ref).body;
  assert.ok(body('A').includes('Score band 80-100 record over 2858 past signals: 55.7% beat their benchmark, average excess +2.23%.'), 'the band starts at 80');
  assert.ok(body('B').includes('Score band 60-79 record over 5508 past signals: 42.6% beat their benchmark, average excess +0.21%.'), 'below 80 is the band under it');
  assert.ok(!body('C').includes('Score band'), 'a band with no signals says nothing');
  assert.ok(body('D').includes('Score band 0-39 record over 2965 past signals: average excess -0.08%.'), 'no win rate, no claim about it');
  assert.ok(!core.buildIndex({radar: {signals: [radarSig('A', {score: 90})]}})[0].body.includes('Score band'), 'no journal, no band line');
});
