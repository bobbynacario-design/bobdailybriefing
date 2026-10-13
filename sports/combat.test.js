import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFightTitle, fightMarket, normFight, buildCombatJournal, buildCombatView } from './combat.js';

const NOW = Date.parse('2026-10-13T06:00:00Z');
test('combat timing, settlement and legacy audits stay conservative',()=>{
  const f=normFight(ev('timing','A vs. B',['A','B'],['0.6','0.4']),'boxing',NOW);
  const pre=buildCombatJournal(null,[f],'2026-10-17T20:59:59Z');
  assert.equal(buildCombatJournal(null,[f],'2026-10-17T21:00:00Z').fights.timing,undefined);
  const post=buildCombatJournal(pre,[{...f,fighters:[{name:'A',pct:99},{name:'B',pct:1}]}],'2026-10-17T21:00:01Z');
  assert.deepEqual(post.fights.timing.pct,[60,40]);
  assert.equal(normFight(ev('live','A vs. B',['A','B'],['0.99','0.01']),'boxing',Date.parse('2026-10-17T22:00:00Z')).status,'awaiting result');
  for(const [oracle,prices] of [['disputed',['1','0']],['proposed',['1','0']],['',['1','0']],['resolved',['0.99','0.01']]]){
    const e=ev('x','A vs. B',['A','B'],prices,{closed:true});e.markets[1].umaResolutionStatus=oracle;
    const pending=normFight(e,'boxing',NOW);assert.equal(pending.winner,null);assert.equal(pending.status,'awaiting result');
  }
  const noWinner=normFight(ev('void','A vs. B',['A','B'],['0.5','0.5'],{closed:true}),'boxing',NOW);
  const j=buildCombatJournal(null,[noWinner],'2026-10-20T00:00:00Z');assert.equal(j.stats.scored,0);assert.equal(j.stats.noWinner,1);
  const prior={fights:{legacy:{id:'legacy',winner:'A',winnerPct:60,pct:[60,40],names:['A','B'],date:'2026-10-17T21:00:00Z'},
    late:{id:'late',pct:[99,1],names:['A','B'],date:'2026-10-17T21:00:00Z',seenAt:'2026-10-17T22:00:00Z'}}};
  const original=JSON.stringify(prior),done=normFight(ev('late','A vs. B',['A','B'],['1','0'],{closed:true}),'boxing',NOW);
  const checked=buildCombatJournal(prior,[done],'2026-10-20T00:00:00Z');assert.equal(checked.stats.scored,0);assert.equal(checked.stats.unverifiedResults,1);assert.equal(checked.stats.timingExcluded,1);assert.equal(JSON.stringify(prior),original);
  const unknown=ev('unknown','A vs. B',['A','B'],['0.6','0.4']);delete unknown.markets[1].gameStartTime;unknown.endDate='2026-10-30T00:00:00Z';
  assert.equal(normFight(unknown,'boxing',NOW).date,null);
  const missing=ev('missing','A vs. B',['A','B'],['1',null],{closed:true});assert.equal(normFight(missing,'boxing',NOW),null);
});
function ev(id, title, names, prices, extra = {}) {
  return Object.assign({ id, title, slug: 'slug-' + id, volume: 5000, liquidity: 20000,
    markets: [{ outcomes: '["Yes","No"]', outcomePrices: '["0.4","0.6"]', sportsMarketType: 'ufc_go_the_distance' },
      { outcomes: JSON.stringify(names), outcomePrices: JSON.stringify(prices), sportsMarketType: 'moneyline', gameStartTime: '2026-10-17 21:00:00+00', closed: extra.closed || false,umaResolutionStatus:extra.closed ? 'resolved' : '' }] }, extra);
}

test('fight titles split into card, bout, weight class and card segment', () => {
  assert.deepEqual(parseFightTitle('UFC Fight Night: Mike Malott vs. Joaquin Buckley (Welterweight, Main Card)'),
    { card: 'UFC Fight Night', bout: 'Mike Malott vs. Joaquin Buckley', weightClass: 'Welterweight', segment: 'Main Card' });
  assert.deepEqual(parseFightTitle('Daniel Dubois vs. Fabio Wardley'), { card: '', bout: 'Daniel Dubois vs. Fabio Wardley', weightClass: '', segment: '' });
  assert.equal(parseFightTitle('Will Jake Paul run for office?'), null);
});

test('the moneyline gives chances only when the market is real; Filipino fighters are flagged', () => {
  const f = normFight(ev('1', 'Jerwin Ancajas vs. Someone', ['Jerwin Ancajas', 'Someone'], ['0.62', '0.38']), 'boxing', NOW);
  assert.deepEqual(f.fighters, [{ name: 'Jerwin Ancajas', pct: 62 }, { name: 'Someone', pct: 38 }]);
  assert.equal(f.filipino, true); assert.equal(f.status, 'upcoming'); assert.equal(f.date, '2026-10-17T21:00:00.000Z');
  assert.equal(f.url, 'https://polymarket.com/event/slug-1');
  const empty = normFight(ev('2', 'A vs. B', ['A', 'B'], ['0.5', '0.5'], { volume: 5, liquidity: 1 }), 'boxing', NOW);
  assert.equal(empty.priced, false); assert.equal(empty.fighters[0].pct, null);
  const past = normFight(Object.assign(ev('3', 'A vs. B', ['A', 'B'], ['0.5', '0.5']), {}), 'boxing', Date.parse('2026-10-19T00:00:00Z'));
  assert.equal(past.status, 'awaiting result');
  assert.equal(fightMarket({ markets: [{ outcomes: '["Yes","No"]' }] }), null);
});

test('the journal keeps the last pre-fight chance, then scores the winner; late-seen results stay unscored', () => {
  const up = normFight(ev('9', 'UFC 333: Dvalishvili vs. Yan (Bantamweight, Main Card)', ['Dvalishvili', 'Yan'], ['0.39', '0.61']), 'ufc', NOW);
  const j1 = buildCombatJournal(null, [up], '2026-10-13T06:00:00Z');
  const up2 = normFight(ev('9', 'UFC 333: Dvalishvili vs. Yan (Bantamweight, Main Card)', ['Dvalishvili', 'Yan'], ['0.35', '0.65']), 'ufc', NOW);
  const j2 = buildCombatJournal(j1, [up2], '2026-10-14T06:00:00Z');
  assert.deepEqual(j2.fights['9'].pct, [35, 65]);
  const done = normFight(ev('9', 'UFC 333: Dvalishvili vs. Yan (Bantamweight, Main Card)', ['Dvalishvili', 'Yan'], ['1', '0'], { closed: true }), 'ufc', NOW);
  const late = normFight(ev('10', 'X vs. Y', ['X', 'Y'], ['0', '1'], { closed: true }), 'boxing', NOW);
  const j3 = buildCombatJournal(j2, [done, late], '2026-10-25T06:00:00Z');
  assert.equal(j3.fights['9'].winnerPct, 35);
  assert.deepEqual(j3.stats.recent.map(r => [r.winner, r.winnerPct, r.loser]), [['Dvalishvili', 35, 'Yan'], ['Y', null, 'X']]);
  assert.equal(j3.stats.scored, 1); assert.equal(j3.stats.favouritesWon, 0); assert.equal(j3.stats.brier, 0.4225);
  assert.deepEqual(buildCombatJournal(j3, [done], '2026-10-26T00:00:00Z').fights['9'].winnerPct, 35);
});

test('the view groups UFC by card with the main card first and keeps three weeks of boxing', () => {
  const a = normFight(ev('a', 'UFC 333: A vs. B (Bantamweight, Prelims)', ['A', 'B'], ['0.5', '0.5'], { volume: 90000 }), 'ufc', NOW);
  const b = normFight(ev('b', 'UFC 333: C vs. D (Featherweight, Main Card)', ['C', 'D'], ['0.5', '0.5'], { volume: 10 }), 'ufc', NOW);
  const far = Object.assign(normFight(ev('c', 'E vs. F', ['E', 'F'], ['0.5', '0.5']), 'boxing', NOW), { date: '2026-12-25T00:00:00Z' });
  const v = buildCombatView([a, b, far], NOW);
  assert.equal(v.cards.length, 1); assert.deepEqual(v.cards[0].fights.map(f => f.id), ['b', 'a']);
  assert.equal(v.boxing.length, 0);
});
