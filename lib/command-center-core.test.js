import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('./command-center-core.js', import.meta.url), 'utf8');
const context = {Intl, Date, console};
vm.createContext(context);
vm.runInContext(source, context);
const {buildCommandCenter} = context.CommandCenterCore;

test('numbers surface recent changes with explicit trust, not an unchanged snapshot', () => {
  const now = Date.parse('2026-10-03T00:00:00Z');
  const grounding = {schema:'daybook-grounding-mirror/1', facts:[{recordId:'cpi#r2', checks:{factVerified:true,sourceLinked:true,crossChecked:true}}], changes:[
    {id:'cpi#r2',kind:'correction',summary:'CPI: 3.1% → 3.2%',at:'2026-10-02T00:00:00Z',publisher:'Test Bureau',url:'https://example.org/cpi'},
    {id:'watch',kind:'watch',summary:'CPI: blocked',at:'2026-10-02T00:00:00Z',url:'javascript:alert(1)'},
    {id:'old',at:'2026-09-01T00:00:00Z'}, {id:'future',at:'2027-01-01T00:00:00Z'}
  ]};
  const items = buildCommandCenter({grounding},now).items;
  assert.equal(items.length,2);
  const fact = items.find(x=>x.id==='grounding-cpi#r2');
  assert.match(fact.detail,/Fact-verified.*Cross-checked/);
  assert.match(fact.detail,/Consumer approval required/);
  assert.equal(items.find(x=>x.id==='grounding-watch').url,null);
  assert.equal(buildCommandCenter({grounding:{...grounding,changes:[]}},now).items.length,0);
  assert.equal(buildCommandCenter({health:{feeds:{grounding:{status:'failed'}}}},now).items[0].source,'Reliability');
});

test('a run\'s diesel prices fold into one Morning 5 item; other numbers stay one each', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const at = '2026-09-30T20:15:00Z';
  const checks = {factVerified:true,sourceLinked:true,crossChecked:false};
  const city = (key, name, value) => ({recordId:'aip_tgp_diesel_'+key+'@2026-09-25#r1', unitCode:'aud_cents_per_litre', observationKey:'2026-09-25', display:value+' c/L',
    title:'Diesel terminal gate price, '+name+' (AIP average of four wholesalers, incl GST)', checks});
  const facts = [city('sydney','Sydney','271.5'), city('melbourne','Melbourne','269.5'), city('hobart','Hobart','270.4'),
    {recordId:'cpi#r1', unitCode:'pct', checks:{factVerified:true,sourceLinked:true,crossChecked:true}}];
  const changes = facts.map((f) => ({id:f.recordId, kind:'new', summary:f.recordId, at, publisher:'Australian Institute of Petroleum', url:'https://aip.com.au/pricing/terminal-gate-prices/'}));
  const items = buildCommandCenter({grounding:{schema:'daybook-grounding-mirror/1', facts, changes}}, now).items;
  assert.equal(items.length, 2);
  const fold = items.find((x) => /^grounding-fold-/.test(x.id));
  assert.equal(fold.title, 'Diesel terminal gate prices, 25 Sep 2026 (c/L): Sydney 271.5, Melbourne 269.5, Hobart 270.4');
  assert.equal(fold.detail, 'Australian Institute of Petroleum · 2026-09-30 · Fact-verified · Source-linked · Consumer approval required');
  assert.equal(fold.url, 'https://aip.com.au/pricing/terminal-gate-prices/');
  assert.equal(fold.id, 'grounding-fold-aud_cents_per_litre-' + at);
  assert.ok(items.some((x) => x.id === 'grounding-cpi#r1'));
  // A city published on another day says so.
  facts[2] = {...facts[2], observationKey:'2026-09-18'};
  const mixed = buildCommandCenter({grounding:{schema:'daybook-grounding-mirror/1', facts, changes}}, now).items.find((x) => /^grounding-fold-/.test(x.id));
  assert.equal(mixed.title, 'Diesel terminal gate prices (c/L): Sydney 271.5 (25 Sep 2026), Melbourne 269.5 (25 Sep 2026), Hobart 270.4 (18 Sep 2026)');
});

test('a run\'s network labour rates fold into one item: the latest year per series, earlier years counted', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const checks = {factVerified:true,sourceLinked:true,crossChecked:false};
  const rate = (seriesId, publisher, title, fy, value, url) => ({recordId:seriesId+'@'+fy+'-07-01#r1', seriesId, unitCode:'aud_per_hour', basisCode:'regulated_fee_max', kind:'regulated_fee',
    observationKey:fy+'-07-01', effectiveFrom:fy+'-07-01', effectiveTo:(Number(fy)+1)+'-06-30', display:'$'+value+'/hour', title, publisher, url, checks});
  const nswAt = '2026-09-30T07:08:06Z', sapnAt = '2026-09-30T04:18:52Z';
  const nsw = [
    ['ausgrid_quoted_labour_field_worker_ordinary','Ausgrid','Ausgrid Field worker R4 labour rate, business hours (quoted services, excl GST)','204.17','213.50','https://example.org/ausgrid'],
    ['endeavour_quoted_labour_field_worker_outdoor_after_hours','Endeavour Energy','Endeavour Energy outdoor Field Worker R4 labour rate, after hours (quoted services, excl GST)','357.31','373.64','https://example.org/endeavour'],
    ['endeavour_quoted_labour_field_worker_outdoor_ordinary','Endeavour Energy','Endeavour Energy outdoor Field Worker R4 labour rate, business hours (quoted services, excl GST)','204.17','213.50','https://example.org/endeavour'],
    ['essential_quoted_labour_field_worker_ordinary','Essential Energy','Essential Energy Field Worker R4 labour rate, normal time (quoted services, excl GST)','203.67','212.98','https://example.org/essential'],
    ['essential_quoted_labour_field_worker_overtime','Essential Energy','Essential Energy Field Worker R4 labour rate, overtime (quoted services, excl GST)','278.69','291.43','https://example.org/essential'],
  ].flatMap(([id,pub,title,fy26,fy27,url]) => [rate(id,pub,title,'2026',fy27,url), rate(id,pub,title,'2025',fy26,url)]);
  const sapn = [
    rate('sapn_quoted_labour_field_worker_ordinary','SA Power Networks','SA Power Networks Field Worker labour rate, ordinary time (quoted services, excl GST)','2026','198.12','https://example.org/sapn'),
    rate('sapn_quoted_labour_field_worker_overtime','SA Power Networks','SA Power Networks Field Worker labour rate, overtime (quoted services, excl GST)','2026','323.05','https://example.org/sapn'),
  ];
  // The award is an hourly figure too, but a minimum wage, not a network rate: it stays on its own.
  const award = {recordId:'fwo_ma000020_cw2_ordinary@2026-07-01#r1', seriesId:'fwo_ma000020_cw2_ordinary', unitCode:'aud_per_hour', basisCode:'award_min_wage', kind:'award_wage',
    title:'Building and Construction award, CW/ECW 2 (civil, weekly hire), ordinary hourly rate', display:'$30.39/hour', checks};
  const facts = nsw.concat(sapn, [award]);
  const changes = nsw.map((f) => ({id:f.recordId, kind:f.observationKey < '2026' ? 'earlier' : 'new', summary:f.recordId, at:nswAt, publisher:f.publisher, url:f.url}))
    .concat(sapn.map((f) => ({id:f.recordId, kind:'new', summary:f.recordId, at:sapnAt, publisher:f.publisher, url:f.url})),
      [{id:award.recordId, kind:'new', summary:'Award: $30.39/hour', at:sapnAt, publisher:'Fair Work Ombudsman'}]);
  const items = buildCommandCenter({grounding:{schema:'daybook-grounding-mirror/1', facts, changes}}, now).items.filter((x) => x.source === 'Numbers');
  assert.equal(items.length, 3, 'twelve rate changes become two items; the award stays one');
  const nswItem = items.find((x) => x.id === 'grounding-fold-labour_rates-' + nswAt);
  assert.equal(nswItem.title, 'Network labour rates, FY2026-27 (per hour, excl GST): Ausgrid $213.50, Endeavour Energy outdoor after hours $373.64, Endeavour Energy outdoor $213.50, Essential Energy $212.98, Essential Energy overtime $291.43; and 5 earlier periods');
  assert.equal(nswItem.detail, 'Ausgrid, Endeavour Energy, Essential Energy · 2026-09-30 · Fact-verified · Source-linked · Consumer approval required');
  assert.equal(nswItem.url, null, 'several sources: the item opens Evidence, not one of them');
  const sapnItem = items.find((x) => x.id === 'grounding-fold-labour_rates-' + sapnAt);
  assert.equal(sapnItem.title, 'Network labour rates, FY2026-27 (per hour, excl GST): SA Power Networks $198.12, SA Power Networks overtime $323.05');
  assert.equal(sapnItem.url, 'https://example.org/sapn');
  assert.ok(items.some((x) => x.id === 'grounding-' + award.recordId && x.title === 'Award: $30.39/hour'));
});

test('high relevance alone does not imply verified evidence', () => {
  const result = buildCommandCenter({briefing:{sections:{insurance:[{headline:'Unverified',relevance_level:'high'}]}}});
  assert.equal(result.items[0].confidence,'low');
  assert.equal(result.items[0].urgency,'monitor');
});

test('builds a source-diverse Morning 5 in priority order', () => {
  const now = Date.parse('2026-08-12T01:00:00Z');
  const result = buildCommandCenter({
    today: '2026-08-12',
    briefing: {sections: {global: [{headline: 'Claims disruption', relevance_level: 'high'}]}},
    radar: {signals: [{symbol: 'NVDA', status: 'confirmed', score: 88}]},
    markets: {markets: [{slug: 'rates', label: 'Rate cut', priceChange: 0.04, attentionScore: 70}]},
    decisions: [{id: 'd1', asset: 'GLD', action: 'took', status: 'open', createdDate: '2026-08-10'}],
    sports: {modules: {nba: {title: 'NBA', watchlist: [{team: 'Lakers'}], upcoming: [{id: 'g1', home: 'Lakers', away: 'Knicks', utcDate: '2026-08-12T12:00:00Z'}]}}}
  }, now);
  assert.equal(result.morningFive.length, 5);
  assert.equal(new Set(result.morningFive.map(item => item.source)).size, 5);
  assert.equal(result.morningFive[0].source, 'Decisions');
});

test('raises failed or stale feed health above content', () => {
  const now = Date.parse('2026-08-12T01:00:00Z');
  const result = buildCommandCenter({health: {feeds: {
    radar: {status: 'failed', lastOkAt: '2026-08-11T00:00:00Z', message: 'provider timeout'},
    sports: {status: 'ok', lastOkAt: '2026-08-09T00:00:00Z'}
  }}}, now);
  assert.equal(Array.from(result.items, item => item.id).join(','), 'health-radar,health-sports');
  assert.equal(result.items[0].score, 100);
  assert.match(result.items[0].detail, /provider timeout/);
});

test('keeps low-relevance briefing noise out of the queue', () => {
  const result = buildCommandCenter({briefing: {sections: {global: [
    {headline: 'Relevant', relevance_level: 'medium'},
    {headline: 'Noise', relevance_level: 'low'}
  ]}}}, Date.now());
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'Relevant');
});

test('applies source weights and explains the resulting score', () => {
  const result = buildCommandCenter({
    today: '2026-08-12',
    radar: {signals: [{symbol: 'NVDA', status: 'confirmed', score: 80}]},
    preferences: {sourceWeights: {Radar: 0.5}}
  }, Date.parse('2026-08-12T01:00:00Z'));
  assert.equal(result.items[0].preferenceWeight, 0.5);
  assert.equal(result.items[0].score, Math.round(result.items[0].baseScore * 0.5));
  assert.ok(Array.from(result.items[0].scoreBreakdown).some(line => /Source weight/.test(line)));
});

test('quiet sources hide ordinary items while pins override quiet and sort first', () => {
  const result = buildCommandCenter({
    today: '2026-08-12',
    briefing: {sections: {global: [{headline: 'Pinned brief', relevance_level: 'high'}]}},
    radar: {signals: [{symbol: 'NVDA', status: 'confirmed', score: 99}]},
    preferences: {
      quietSources: ['Briefing', 'Radar'],
      daily: {date: '2026-08-12', pinned: ['briefing-global-0'], dismissed: []}
    }
  }, Date.parse('2026-08-12T01:00:00Z'));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'briefing-global-0');
  assert.equal(result.items[0].pinned, true);
  assert.equal(result.items[0].score, 110);
  assert.equal(result.counts.hidden, 1);
});

test('today dismissals remove matching items but expire on a new date', () => {
  const input = {
    today: '2026-08-12',
    radar: {signals: [{symbol: 'NVDA', status: 'confirmed', score: 90}]},
    preferences: {daily: {date: '2026-08-12', pinned: [], dismissed: ['radar-NVDA']}}
  };
  assert.equal(buildCommandCenter(input, Date.parse('2026-08-12T01:00:00Z')).items.length, 0);
  input.today = '2026-08-13';
  assert.equal(buildCommandCenter(input, Date.parse('2026-08-13T01:00:00Z')).items.length, 1);
});

// ── Insurance news (news/ feed) ──

const NEWS_NOW = Date.parse('2026-08-29T01:00:00Z');

function newsInput(over) {
  return Object.assign({
    today: '2026-08-29',
    news: {
      date: '2026-08-29',
      generatedAt: '2026-08-29T00:52:53Z',
      items: [
        {id: 'a', title: 'Supply chain cyber cover gap', url: 'https://pub/a', source: 'Insurance Business AU', tier: 'core', score: 50, ageDays: 1.7},
        {id: 'b', title: 'Code feedback published', url: 'https://pub/b', source: 'insuranceNEWS.com.au', tier: 'context', score: 41, ageDays: 0.8},
        {id: 'c', title: 'Broker network expands', url: 'https://pub/c', source: 'insuranceNEWS.com.au', tier: 'trade', score: 30, ageDays: 2}
      ]
    }
  }, over || {});
}

test('surfaces insurance news as monitor items carrying the publisher url', () => {
  const result = buildCommandCenter(newsInput(), NEWS_NOW);
  const news = result.items.filter(item => item.source === 'News');
  assert.equal(news.length, 2, 'core and context only');
  assert.equal(news[0].title, 'Supply chain cyber cover gap');
  assert.equal(news[0].url, 'https://pub/a');
  assert.equal(news[0].page, 'today');
  assert.match(news[0].basis, /^Core insurance story from Insurance Business AU/);
  assert.match(news[0].detail, /1\.7d old/);
});

test('news never claims act, so it cannot outrank real act items', () => {
  const result = buildCommandCenter(newsInput(), NEWS_NOW);
  const news = result.items.filter(item => item.source === 'News');
  assert.ok(news.length);
  assert.ok(news.every(item => item.urgency === 'monitor'));
});

test('trade and general tier stories stay out of the attention queue', () => {
  const result = buildCommandCenter(newsInput(), NEWS_NOW);
  const titles = result.items.filter(item => item.source === 'News').map(item => item.title);
  assert.ok(!titles.includes('Broker network expands'));
});

test('at most three news items reach the queue', () => {
  const many = [];
  for (let i = 0; i < 9; i++) {
    many.push({id: 'n' + i, title: 'Story ' + i, url: 'https://pub/' + i, source: 'insuranceNEWS.com.au', tier: 'core', score: 50 - i, ageDays: 1});
  }
  const result = buildCommandCenter(newsInput({news: {generatedAt: '2026-08-29T00:52:53Z', items: many}}), NEWS_NOW);
  assert.equal(result.items.filter(item => item.source === 'News').length, 3);
});

test('a stale news snapshot contributes nothing rather than replaying old headlines', () => {
  const result = buildCommandCenter(
    newsInput({news: {generatedAt: '2026-08-26T00:00:00Z', items: newsInput().news.items}}), NEWS_NOW);
  assert.equal(result.items.filter(item => item.source === 'News').length, 0);
});

test('a snapshot with no timestamp is not treated as current', () => {
  const result = buildCommandCenter(newsInput({news: {items: newsInput().news.items}}), NEWS_NOW);
  assert.equal(result.items.filter(item => item.source === 'News').length, 0);
});

test('news counts toward Morning 5 source diversity', () => {
  const result = buildCommandCenter(newsInput({
    radar: {signals: [{symbol: 'NVDA', status: 'confirmed', score: 88}]},
    decisions: [{id: 'd1', asset: 'GLD', action: 'took', status: 'open', createdDate: '2026-08-27'}]
  }), NEWS_NOW);
  assert.ok(result.morningFive.some(item => item.source === 'News'));
  assert.ok(result.counts.sources >= 3);
});

test('news honours source weights and can be quieted like any other source', () => {
  const weighted = buildCommandCenter(newsInput({
    preferences: {sourceWeights: {News: 0.5}}
  }), NEWS_NOW).items.filter(item => item.source === 'News');
  assert.equal(weighted[0].score, 37, 'base 74 x 0.5');

  const quiet = buildCommandCenter(newsInput({
    preferences: {quietSources: ['News']}
  }), NEWS_NOW).items.filter(item => item.source === 'News');
  assert.equal(quiet.length, 0);
});

test('a failed news refresh is reported as a reliability item that cannot be quieted', () => {
  const result = buildCommandCenter({
    today: '2026-08-29',
    health: {feeds: {news: {status: 'failed', lastOkAt: '2026-08-28T00:00:00Z', message: 'all 9 feeds failed'}}},
    preferences: {quietSources: ['Reliability', 'News']}
  }, NEWS_NOW);
  const health = result.items.filter(item => item.source === 'Reliability');
  assert.equal(health.length, 1);
  assert.equal(health[0].title, 'Insurance news refresh failed');
  assert.equal(health[0].page, 'today');
  assert.equal(health[0].urgency, 'act');
});

test('a news feed that has not run for over 30 hours is reported stale', () => {
  const result = buildCommandCenter({
    today: '2026-08-29',
    health: {feeds: {news: {status: 'ok', lastOkAt: '2026-08-27T00:00:00Z'}}}
  }, NEWS_NOW);
  assert.equal(result.items[0].title, 'Insurance news feed is stale');
});

test('a decision whose review date has come is a review in the Morning 5, with its wrong-if', () => {
  const result = buildCommandCenter({today: '2026-10-03', decisions: [
    {id: 'q1', asset: 'A claims documentation gap', action: 'watched', status: 'open', createdDate: '2026-09-26', reviewDate: '2026-10-03', invalidator: 'The record is produced'},
    {id: 'q2', asset: 'Not yet', action: 'watched', status: 'open', createdDate: '2026-09-26', reviewDate: '2026-10-10'},
    {id: 'q3', asset: 'Closed one', action: 'watched', status: 'closed', createdDate: '2026-09-26', reviewDate: '2026-10-01'}
  ]});
  const due = result.items.filter(item => item.source === 'Decisions');
  assert.deepEqual(Array.from(due, item => item.id), ['decision-q1']);
  assert.equal(due[0].title, 'Review due: A claims documentation gap');
  assert.equal(due[0].detail, 'Wrong if: The record is produced');
  assert.equal(due[0].urgency, 'act'); assert.equal(due[0].basis, 'Review date reached');
});

test('a due experiment is listed only when the app passes it, and opens on Today', () => {
  const experiment = {plan: 'Ask one clearer question', due: '2026-09-24', day: '2026-09-20'};
  const result = buildCommandCenter({today: '2026-09-25', experiment});
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.id, 'experiment-2026-09-20'); assert.equal(item.source, 'Experiments'); assert.equal(item.page, 'today');
  assert.equal(item.title, 'Experiment to review: Ask one clearer question');
  assert.equal(buildCommandCenter({today: '2026-09-25'}).items.length, 0, 'the server passes none, so a push never depends on it');
  assert.equal(buildCommandCenter({today: '2026-09-25', experiment: {plan: ' '}}).items.length, 0);
});

test('a review with a verdict leaves the Morning 5', () => {
  const result = buildCommandCenter({today: '2026-10-03', decisions: [
    {id: 'q1', asset: 'Graded already', action: 'watched', status: 'open', createdDate: '2026-09-26', reviewDate: '2026-10-01', verdict: 'held'}]});
  assert.equal(result.items.length, 0);
});

test('his accounts named in today’s briefing make one Morning 5 line that opens the first story', () => {
  const result = buildCommandCenter({today: '2026-09-27', accountHits: [{name: 'QBE', headlines: ['QBE lifts reserves']}, {name: 'SA Power Networks', headlines: ['SAPN pole charges rise', 'Other']}]});
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.source, 'Accounts'); assert.equal(item.page, 'today');
  assert.equal(item.title, 'Your accounts in today’s briefing: QBE, SA Power Networks');
  assert.equal(item.target, 'QBE lifts reserves');
  assert.equal(buildCommandCenter({today: '2026-09-27', accountHits: [{name: 'QBE', headlines: []}]}).items.length, 0, 'no story, no line');
  assert.equal(buildCommandCenter({today: '2026-09-27'}).items.length, 0, 'the server passes none');
});
