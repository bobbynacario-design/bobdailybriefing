import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normNbaGame,
  normNbaStandings,
  buildNbaMomentum,
  addNbaRestSignals,
  normNbaInjuries,
  normNbaPlayerWatch,
  nbaPlayoffRound,
  buildNbaBracket,
  nbaSeasonYear,
  parsePvlSchedule,
  parsePvlRecaps,
  parsePvlStandings,
  parsePvlLeaders,
  buildPvlBracket,
  buildTeamProfiles,
  buildModuleChanges,
  scheduleReadiness,
  buildPvlMomentum,
  classifyTennis,
  buildTennisDraw,
  normTennisEvent,
  tennisTournamentTiming,
  tennisWinProb,
  tennisProjTag,
  enrichTennisDraw,
  buildTennisJournal,
  moduleHasData,
  lanesMissing,
  laneValue,
  setLane,
  shiftDateKey
} from './refresh-sports.js';

function tComp(roundId, roundName, state, players) {
  return {
    id: roundName + '-' + roundId,
    date: '2026-07-10T12:00:00Z',
    round: { id: String(roundId), displayName: roundName },
    status: { type: { state: state, completed: state === 'post' } },
    competitors: players.map(function (p) {
      return {
        athlete: { displayName: p.name },
        winner: !!p.winner,
        seed: p.seed == null ? null : p.seed,
        linescores: (p.sets || []).map(function (s) { return { value: s[0], tiebreak: s[1] == null ? null : s[1] }; })
      };
    })
  };
}
function tEvent(name, comps) {
  return { id: name, name: name, date: '2026-07-01T00:00:00Z', groupings: [{ grouping: { displayName: "Men's Singles" }, competitions: comps }] };
}

var fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'test-fixtures');
function fixture(name) { return readFileSync(join(fixtureDir, name), 'utf8'); }

function event(id, date, state, home, away, homeScore, awayScore) {
  return {
    id: id,
    date: date,
    season: { slug: 'regular-season' },
    status: { type: { state: state } },
    competitions: [{
      venue: { fullName: 'Test Arena' },
      competitors: [
        { id: 'home-' + id, homeAway: 'home', score: homeScore, team: { id: 'home-' + id, displayName: home } },
        { id: 'away-' + id, homeAway: 'away', score: awayScore, team: { id: 'away-' + id, displayName: away } }
      ]
    }]
  };
}

test('normalizes completed and scheduled NBA games without fake zero scores', function () {
  var finalGame = normNbaGame(event('1', '2026-01-01T00:00:00Z', 'post', 'New York Knicks', 'Boston Celtics', '112', '108'));
  assert.equal(finalGame.status, 'FINISHED');
  assert.deepEqual(finalGame.score, { home: 112, away: 108 });

  var scheduled = normNbaGame(event('2', '2026-01-02T00:00:00Z', 'pre', 'Los Angeles Lakers', 'Golden State Warriors', '0', '0'));
  assert.equal(scheduled.status, 'SCHEDULED');
  assert.deepEqual(scheduled.score, { home: null, away: null });
});

test('normalizes NBA standings by conference and seed', function () {
  var rows = normNbaStandings({ children: [{
    abbreviation: 'West',
    standings: { entries: [{
      team: { displayName: 'San Antonio Spurs', abbreviation: 'SA' },
      stats: [
        { name: 'playoffSeed', value: 2 },
        { name: 'wins', value: 62 },
        { name: 'losses', value: 20 },
        { name: 'winPercent', value: 0.756 }
      ]
    }] }
  }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].conference, 'West');
  assert.equal(rows[0].position, 2);
  assert.equal(rows[0].wins, 62);
});

test('ranks a winning NBA team above a losing team', function () {
  var games = [
    normNbaGame(event('1', '2026-01-01T00:00:00Z', 'post', 'Knicks', 'Celtics', '120', '100')),
    normNbaGame(event('2', '2026-01-02T00:00:00Z', 'post', 'Knicks', 'Celtics', '110', '105'))
  ];
  var momentum = buildNbaMomentum(games, [
    { team: 'Knicks', pct: 0.65 },
    { team: 'Celtics', pct: 0.60 }
  ]);
  assert.equal(momentum[0].team, 'Knicks');
  assert.equal(momentum[0].recentForm, 'WW');
  assert.equal(momentum[1].recentForm, 'LL');
});

test('uses ESPN ending-year season labels', function () {
  assert.equal(nbaSeasonYear(new Date('2026-07-18T00:00:00Z')), 2026);
  assert.equal(nbaSeasonYear(new Date('2026-10-01T00:00:00Z')), 2027);
});

test('adds NBA rest and back-to-back signals from the schedule', function () {
  var games = [
    normNbaGame(event('1', '2026-01-01T01:00:00Z', 'post', 'Knicks', 'Celtics', '110', '100')),
    normNbaGame(event('2', '2026-01-02T01:00:00Z', 'pre', 'Knicks', 'Warriors', '0', '0')),
    normNbaGame(event('3', '2026-01-04T01:00:00Z', 'pre', 'Knicks', 'Spurs', '0', '0'))
  ];
  var enriched = addNbaRestSignals(games);
  assert.equal(enriched[1].rest.home.days, 0);
  assert.equal(enriched[1].rest.home.backToBack, true);
  assert.equal(enriched[2].rest.home.days, 1);
  assert.equal(enriched[2].rest.home.backToBack, false);
});

test('normalizes ESPN NBA availability and recent game leaders', function () {
  var injuries = normNbaInjuries({ injuries: [{
    displayName: 'New York Knicks',
    injuries: [{ status: 'Day-To-Day', date: '2026-07-18T00:00:00Z', shortComment: 'Ankle soreness.', athlete: { displayName: 'Test Player' } }]
  }] });
  assert.equal(injuries[0].team, 'New York Knicks');
  assert.equal(injuries[0].status, 'Day-To-Day');

  var game = event('4', '2026-06-14T00:30:00Z', 'post', 'San Antonio Spurs', 'New York Knicks', '90', '94');
  game.competitions[0].competitors[0].leaders = [{
    name: 'rating', displayName: 'Rating',
    leaders: [{ displayValue: '19 PTS, 14 REB, 5 BLK', athlete: { displayName: 'Victor Wembanyama' } }]
  }];
  var watch = normNbaPlayerWatch([game]);
  assert.equal(watch[0].player, 'Victor Wembanyama');
  assert.equal(watch[0].line, '19 PTS, 14 REB, 5 BLK');
});

test('normalizes ESPN playoff rounds and builds current series bracket rows', function () {
  assert.equal(nbaPlayoffRound('West Semifinals - Game 4').key, 'west-semifinals');
  var playoff = event('5', '2026-05-15T00:00:00Z', 'post', 'New York Knicks', 'Boston Celtics', '112', '105');
  playoff.season.slug = 'post-season';
  playoff.competitions[0].notes = [{ headline:'East Finals - Game 6' }];
  playoff.competitions[0].series = {
    summary:'NY wins series 4-2', completed:true,
    competitors:[{ id:'home-5', wins:4 }, { id:'away-5', wins:2 }]
  };
  var match = normNbaGame(playoff);
  var bracket = buildNbaBracket([match]);
  assert.equal(match.round, 'east-finals');
  assert.equal(match.series.homeWins, 4);
  assert.equal(bracket.rounds[0].series[0].summary, 'NY wins series 4-2');
  assert.equal(bracket.rounds[0].series[0].completed, true);
});

test('parses official PVL schedule cards with shared date and venue headings', function () {
  var html = fixture('pvl-schedule.html');
  var games = parsePvlSchedule(html, new Date('2026-07-18T00:00:00Z'));
  assert.equal(games.length, 2);
  assert.equal(games[0].home, 'Nxled Chameleons');
  assert.equal(games[0].away, 'Capital1 Solar Spikers');
  assert.equal(games[0].venue, 'Vigan City, Ilocos Sur');
  assert.equal(games[1].utcDate, '2026-07-25T10:30:00.000Z');
  assert.deepEqual(games[1].score, { home: null, away: null });
});

test('parses PVL recaps and standings into momentum-ready rows', function () {
  var recap = fixture('pvl-recap-standings.html');
  var standingsHtml = recap;
  var games = parsePvlRecaps(recap, new Date('2026-07-18T00:00:00Z'));
  var standings = parsePvlStandings(standingsHtml);
  var momentum = buildPvlMomentum(games, standings);
  assert.equal(games.length, 1);
  assert.deepEqual(games[0].score, { home: 3, away: 1 });
  assert.equal(standings.length, 2);
  assert.equal(standings[0].points, 6);
  assert.equal(momentum[0].team, 'ZUS Coffee Thunderbelles');
  assert.equal(momentum[0].recentForm, 'W');
});

test('parses official PVL leader tables with conference metadata', function () {
  var parsed = parsePvlLeaders(fixture('pvl-leaders.html'), 'scorers');
  assert.equal(parsed.conference, '2026 All Filipino Conference');
  assert.equal(parsed.label, 'Scorer');
  assert.equal(parsed.leaders[0].name, 'BELEN, MHICAELA');
  assert.equal(parsed.leaders[0].valueLabel, 'Total');
  assert.equal(parsed.leaders[0].value, '49');
});

test('builds PVL postseason rounds and team detail profiles only from official match fields', function () {
  var matches = [{
    id:'pvl-final', utcDate:'2026-08-30T10:00:00Z', status:'SCHEDULED', stage:'Semifinals',
    home:'Creamline Cool Smashers', away:'ZUS Coffee Thunderbelles', score:{home:null,away:null}
  }];
  var bracket = buildPvlBracket(matches);
  assert.equal(bracket.active, true);
  assert.equal(bracket.rounds[0].label, 'Semifinals');
  var profiles = buildTeamProfiles('pvl', [
    { team:'Creamline Cool Smashers', position:1, wins:3, losses:0, points:9, setRatio:4 }
  ], [
    { team:'Creamline Cool Smashers', score:88, label:'RISING', recentForm:'WWW', averageSetDiff:2 }
  ], matches, []);
  assert.equal(profiles[0].momentumScore, 88);
  assert.equal(profiles[0].next.away, 'ZUS Coffee Thunderbelles');
});

test('builds a concise refresh delta from results, fixtures and standings movement', function () {
  var previous = {
    lastSuccessfulAt:'2026-07-20T00:00:00Z',
    matches:[
      { id:'done-later', status:'SCHEDULED' },
      { id:'known-next', status:'SCHEDULED' }
    ],
    standings:[{ team:'Creamline', position:2, wins:1, losses:0, points:3 }],
    momentum:[{ team:'Creamline', score:55, label:'WATCH', recentForm:'W' }]
  };
  var current = {
    lastSuccessfulAt:'2026-07-22T00:00:00Z',
    recent:[{ id:'done-later', utcDate:'2026-07-21T10:00:00Z', status:'FINISHED', stage:'Match-Up', home:'Creamline', away:'Akari', score:{ home:3, away:1 } }],
    upcoming:[{ id:'new-next', utcDate:'2026-07-25T10:00:00Z', status:'SCHEDULED', home:'Creamline', away:'PLDT', venue:'Test Arena' }],
    standings:[{ team:'Creamline', position:1, wins:2, losses:0, points:6 }],
    momentum:[{ team:'Creamline', score:74, label:'RISING', recentForm:'WW' }]
  };
  var changes = buildModuleChanges('pvl', current, previous);
  assert.equal(changes.since, '2026-07-20T00:00:00Z');
  assert.deepEqual(changes.items.map(function (item) { return item.type; }), ['result', 'fixture', 'standing', 'momentum']);
  assert.match(changes.items[2].detail, /#2 to #1/);

  var repeated = buildModuleChanges('pvl', {
    lastSuccessfulAt:'2026-07-22T04:00:00Z', recent:[], upcoming:[], standings:[], momentum:[]
  }, {
    lastSuccessfulAt:'2026-07-22T00:00:00Z', matches:[], standings:[], momentum:[],
    changes:changes
  });
  assert.equal(repeated.items.length, 4);
  assert.equal(repeated.since, '2026-07-20T00:00:00Z');
});

test('classifies tennis events into slam / masters1000 / other', function () {
  assert.equal(classifyTennis('Wimbledon').tier, 'slam');
  assert.equal(classifyTennis('Wimbledon').surface, 'Grass');
  assert.equal(classifyTennis('US Open').tier, 'slam');
  assert.equal(classifyTennis("Internazionali BNL d'Italia").tier, 'masters1000');
  assert.equal(classifyTennis("Internazionali BNL d'Italia").surface, 'Clay');
  // WTA-125 whose name shares the "internazionali" word must NOT be a Masters
  assert.equal(classifyTennis('Internazionali Femminili di Brescia').tier, 'other');
  // 500-level events land in the tour500 tier; a 250 stays 'other'
  assert.equal(classifyTennis('Mubadala DC Open').tier, 'tour500');
  assert.equal(classifyTennis('Mifel Tennis Open by Telcel Oppo').tier, 'other');
});

test('tennis draw reads the main-draw Final champion and drops qualifying rounds', function () {
  var comps = [
    tComp(7, 'Final', 'post', [
      { name: 'Jannik Sinner', winner: true, sets: [[6], [6], [6]] },
      { name: 'Alexander Zverev', winner: false, sets: [[3], [4], [4]] }
    ]),
    tComp(6, 'Semifinal', 'post', [
      { name: 'Jannik Sinner', winner: true, sets: [[6], [6]] },
      { name: 'Novak Djokovic', winner: false, sets: [[4], [4]] }
    ]),
    // qualifying carries a HIGHER round id than the Final — must not be read as the title
    tComp(14, 'Qualifying Final', 'post', [
      { name: 'Some Qualifier', winner: true, sets: [[6], [6]] },
      { name: 'Other Qualifier', winner: false, sets: [[3], [3]] }
    ])
  ];
  var draw = buildTennisDraw(comps);
  assert.equal(draw.champion, 'Jannik Sinner');
  assert.equal(draw.runnerUp, 'Alexander Zverev');
  assert.equal(draw.finalStatus, 'FINISHED');
  var names = draw.rounds.map(function (r) { return r.name; });
  assert.ok(names.indexOf('Qualifying Final') < 0, 'qualifying round dropped');
  assert.ok(names.indexOf('Final') >= 0);
});

test('tennis timing: only-scheduled is upcoming, a finished final is completed', function () {
  var upcoming = normTennisEvent(tEvent('US Open', [
    tComp(7, 'Final', 'pre', [{ name: 'A' }, { name: 'B' }]),
    tComp(6, 'Semifinal', 'pre', [{ name: 'C' }, { name: 'D' }])
  ]));
  assert.equal(tennisTournamentTiming(upcoming).status, 'upcoming');
  var done = normTennisEvent(tEvent('Wimbledon', [
    tComp(7, 'Final', 'post', [
      { name: 'A', winner: true, sets: [[6], [6]] },
      { name: 'B', winner: false, sets: [[4], [4]] }
    ])
  ]));
  assert.equal(tennisTournamentTiming(done).status, 'completed');
});

test('tennis win-probability model favours ranking points, is symmetric, and is capped', function () {
  assert.equal(tennisWinProb(3000, 3000), 0.5);
  var fav = tennisWinProb(8000, 2000);
  assert.ok(fav > 0.5 && fav <= 0.85);
  assert.ok(Math.abs(tennisWinProb(8000, 2000) + tennisWinProb(2000, 8000) - 1) < 1e-9);
  assert.equal(tennisWinProb(15000, 200), 0.85); // extreme gap capped, never 99%
  assert.equal(tennisWinProb(0, 500), null);      // unranked → no projection
  assert.equal(tennisProjTag(0), 'Toss-up');
  assert.equal(tennisProjTag(0.30), 'Strong');
});

test('enrichTennisDraw sets ranks and projects only unfinished matches', function () {
  var map = { 'Jannik Sinner': { rank: 1, points: 13000 }, 'Novak Djokovic': { rank: 5, points: 3800 } };
  var draw = { rounds: [{ id: 6, name: 'Semifinal', matches: [
    { id: 'sf1', status: 'SCHEDULED', players: [{ name: 'Jannik Sinner' }, { name: 'Novak Djokovic' }] },
    { id: 'sf2', status: 'FINISHED', players: [{ name: 'Jannik Sinner', winner: true }, { name: 'Novak Djokovic', winner: false }] }
  ] }] };
  enrichTennisDraw(draw, map);
  var sched = draw.rounds[0].matches[0], fin = draw.rounds[0].matches[1];
  assert.equal(sched.players[0].rank, 1);
  assert.ok(sched.proj && sched.proj.favorite === 'Jannik Sinner' && sched.proj.favPct > 50);
  assert.equal(fin.proj, undefined); // a finished result is never projected
});

test('tennis projection journal locks a scheduled pick and scores it when finished', function () {
  var sched = [{ id: 'x1', tournament: 'DC Open', tier: 'tour500', tour: 'women', round: 'Round 2', status: 'SCHEDULED',
    players: [{ name: 'Jessica Pegula' }, { name: 'Diana Shnaider' }],
    proj: { a: 0.70, favorite: 'Jessica Pegula', favPct: 70, tag: 'Moderate' } }];
  var j1 = buildTennisJournal(null, sched, '2026-07-30T00:00:00Z');
  assert.equal(j1.stats.resolved, 0);
  assert.equal(j1.stats.pending, 1);
  assert.equal(j1.preds['x1'].resolved, false);

  var finished = [{ id: 'x1', tournament: 'DC Open', tier: 'tour500', tour: 'women', round: 'Round 2', status: 'FINISHED',
    players: [{ name: 'Jessica Pegula', winner: true }, { name: 'Diana Shnaider', winner: false }] }];
  var j2 = buildTennisJournal(j1, finished, '2026-07-31T00:00:00Z');
  assert.equal(j2.stats.resolved, 1);
  assert.equal(j2.stats.accuracy, 100);
  assert.ok(Math.abs(j2.preds['x1'].brier - 0.09) < 1e-9); // (0.70 − 1)^2

  // a finished match that was never locked while scheduled is ignored — no hindsight
  var j3 = buildTennisJournal(null, finished, '2026-07-31T00:00:00Z');
  assert.equal(j3.stats.resolved, 0);
});

test('scheduler readiness requires successful refreshes on three distinct PHT days', function () {
  var history = [
    { completedAt:'2026-07-18T00:00:00Z', modules:{ pvl:{ refreshStatus:'ok' } } },
    { completedAt:'2026-07-18T05:00:00Z', modules:{ pvl:{ refreshStatus:'ok' } } },
    { completedAt:'2026-07-19T00:00:00Z', modules:{ pvl:{ refreshStatus:'fallback' } } },
    { completedAt:'2026-07-20T00:00:00Z', modules:{ pvl:{ refreshStatus:'ok' } } }
  ];
  var blocked = scheduleReadiness(history, 'pvl', 3);
  assert.equal(blocked.ready, false);
  assert.equal(blocked.successfulDays.length, 2);
  var ready = scheduleReadiness(history.concat([
    { completedAt:'2026-07-21T00:00:00Z', modules:{ pvl:{ refreshStatus:'ok' } } }
  ]), 'pvl', 3);
  assert.equal(ready.ready, true);
});

// ── Lane preservation (the 2026-08-01 tennis-only clobber) ───────────────────
function laneDoc() {
  return {
    worldCup: { matches: [{ id: 1, status: 'FINISHED' }] },
    modules: {
      nba: { matches: [{ id: 'a' }], standings: [{ team: 'BOS' }] },
      pvl: { standings: [{ team: 'Creamline' }], upcoming: [] },
      tennis: { tiers: { slam: { current: { name: 'US Open' } }, masters: {}, tour500: {} } }
    }
  };
}

test('moduleHasData recognises real lane data and rejects empty scaffolding', function () {
  var d = laneDoc();
  ['nba', 'pvl', 'tennis', 'worldcup'].forEach(function (k) {
    assert.equal(moduleHasData(k, laneValue(d, k)), true, k + ' should count as populated');
  });
  assert.equal(moduleHasData('nba', { matches: [], standings: [], upcoming: [] }), false);
  assert.equal(moduleHasData('worldcup', { matches: [] }), false);
  assert.equal(moduleHasData('tennis', { tiers: { slam: {}, masters: {}, tour500: {} } }), false);
  assert.equal(moduleHasData('nba', null), false);
});

test('lanesMissing flags every lane a module-scoped run would erase', function () {
  var onlyTennis = { modules: { tennis: laneDoc().modules.tennis } };
  var wantsTennis = function (k) { return k === 'tennis'; };
  assert.deepEqual(lanesMissing(onlyTennis, wantsTennis), ['nba', 'pvl', 'worldcup']);
  // Lanes carried forward from the previous doc are not missing.
  assert.deepEqual(lanesMissing(laneDoc(), wantsTennis), []);
  // A lane this run is responsible for is never reported (its own fallback owns it).
  assert.deepEqual(lanesMissing({ modules: {} }, function () { return true; }), []);
});

test('setLane restores into the right slot for modules and the legacy worldCup key', function () {
  var target = { modules: {} };
  var source = laneDoc();
  setLane(target, 'nba', laneValue(source, 'nba'));
  setLane(target, 'worldcup', laneValue(source, 'worldcup'));
  assert.equal(target.modules.nba.matches.length, 1);
  assert.equal(target.worldCup.matches.length, 1);
  assert.deepEqual(lanesMissing(target, function (k) { return k === 'pvl' || k === 'tennis'; }), []);
});

test('shiftDateKey walks back across month boundaries', function () {
  assert.equal(shiftDateKey('2026-08-01', -1), '2026-07-31');
  assert.equal(shiftDateKey('2026-08-03', -21), '2026-07-13');
  assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');
});
