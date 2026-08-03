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
  parsePbaSchedule,
  parsePbaRecaps,
  parsePbaStandings,
  parsePbaLeaders,
  pbaPlayerMeta,
  pbaTeamIndex,
  pbaTitleCase,
  buildPbaBracket,
  buildTeamProfiles,
  buildModuleChanges,
  scheduleReadiness,
  buildPbaMomentum,
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

test('parses official PBA schedule days, sharing the date heading across games', function () {
  var games = parsePbaSchedule(fixture('pba-schedule.html'), new Date('2026-08-03T00:00:00Z'));
  assert.equal(games.length, 3);
  // Shouted source names are title-cased for the tab.
  assert.equal(games[0].home, 'Titan Ultra Giant Risers');
  assert.equal(games[0].away, 'Macau Giant Pandas');
  assert.equal(games[0].venue, 'Ninoy Aquino Stadium');
  // 05:15 PM PHT on Aug 04 == 09:15Z, i.e. the PHT offset is applied.
  assert.equal(games[0].utcDate, '2026-08-04T09:15:00.000Z');
  assert.deepEqual(games[0].score, { home: null, away: null });
  // The doubleheader's second game has an EMPTY h2 and must inherit the date
  // above it — dropping it silently loses half the schedule.
  assert.equal(games[1].home, 'NLEX Road Warriors');
  assert.equal(games[1].away, 'TNT Tropang 5G');
  assert.equal(games[1].utcDate, '2026-08-04T11:30:00.000Z');
  assert.equal(games[1].venue, 'Ninoy Aquino Stadium');
  // The next dated heading takes over again.
  assert.equal(games[2].utcDate, '2026-08-05T09:15:00.000Z');
  assert.equal(games[2].away, 'Phoenix');
});

test('parses PBA standings across group tables despite the invalid anchor-wrapped rows', function () {
  var standings = parsePbaStandings(fixture('pba-standings.html'));
  assert.equal(standings.length, 3);
  assert.equal(standings[0].team, 'NLEX Road Warriors');
  assert.equal(standings[0].conference, 'GROUP A');
  assert.equal(standings[0].wins, 5);
  assert.equal(standings[0].losses, 0);
  assert.equal(standings[0].pct, 1);
  assert.equal(standings[0].teamId, '6');
  // Position restarts per group, and the second group is picked up too.
  assert.equal(standings[2].conference, 'GROUP B');
  assert.equal(standings[2].position, 1);
  assert.equal(standings[2].team, 'Barangay Ginebra San Miguel');
});

test('resolves PBA recap teams from logo ids, since results markup carries no team text', function () {
  var standings = parsePbaStandings(fixture('pba-standings.html'));
  var schedule = parsePbaSchedule(fixture('pba-schedule.html'), new Date('2026-08-03T00:00:00Z'));
  var index = pbaTeamIndex(standings, schedule);
  var games = parsePbaRecaps(fixture('pba-recap.html'), index, new Date('2026-08-03T00:00:00Z'));
  assert.equal(games.length, 2);
  // teams/4 is in standings (Ginebra); teams/2 is in neither, so it degrades to
  // the game-leaders abbreviation rather than dropping the game.
  assert.equal(games[0].home, 'Barangay Ginebra San Miguel');
  assert.deepEqual(games[0].score, { home: 73, away: 88 });
  assert.equal(games[0].status, 'FINISHED');
  assert.equal(games[0].venue, 'Smart Araneta Coliseum');
  assert.equal(games[1].home, 'NLEX Road Warriors');
  assert.equal(games[1].away, 'San Miguel Beermen');
  // Sorted newest first.
  assert.ok(games[0].utcDate > games[1].utcDate);
});

test('PBA momentum ranks on recent wins and POINT differential, not sets', function () {
  var standings = parsePbaStandings(fixture('pba-standings.html'));
  var schedule = parsePbaSchedule(fixture('pba-schedule.html'), new Date('2026-08-03T00:00:00Z'));
  var games = parsePbaRecaps(fixture('pba-recap.html'), pbaTeamIndex(standings, schedule), new Date('2026-08-03T00:00:00Z'));
  var momentum = buildPbaMomentum(games, standings);
  var nlex = momentum.find(function (r) { return r.team === 'NLEX Road Warriors'; });
  assert.equal(nlex.recentForm, 'W');
  assert.equal(nlex.averagePointDiff, 6);
  assert.equal(nlex.averageSetDiff, undefined);
  var smb = momentum.find(function (r) { return r.team === 'San Miguel Beermen'; });
  assert.equal(smb.recentForm, 'L');
  assert.equal(smb.averagePointDiff, -6);
  assert.ok(nlex.score > smb.score);
});

test('parses the tableless PBA leaders card grid from its data attributes', function () {
  var cats = parsePbaLeaders(fixture('pba-leaders.html'));
  assert.equal(cats.length, 3);

  // Stat name comes from a plain span in the hero card, not a heading.
  assert.equal(cats[0].label, 'Points Per Game');
  assert.equal(cats[0].key, 'points-per-game');
  // pba.ph has the cup name commented out, so there is nothing to attribute to.
  assert.equal(cats[0].conference, '');
  assert.equal(cats[0].leaders.length, 3);
  // data-name carries a trailing space in the live markup.
  assert.equal(cats[0].leaders[0].name, 'George King');
  assert.equal(cats[0].leaders[0].value, '34.8');
  assert.equal(cats[0].leaders[0].team, 'San Miguel Beermen');
  assert.equal(cats[0].leaders[0].position, 'SG');
  assert.equal(cats[0].leaders[2].rank, 3);

  // Each column's bottom-player cards must not bleed into the next category.
  assert.equal(cats[1].label, 'Rebounds Per Game');
  assert.equal(cats[1].leaders.length, 2);
  assert.equal(cats[1].leaders[0].name, "De'Vondre Perry");

  // A hero card with no bottom-player row still yields its leader.
  assert.equal(cats[2].label, 'Blocks Per Game');
  assert.equal(cats[2].leaders.length, 1);
  assert.equal(cats[2].leaders[0].name, 'Shaun Geoffrey Chiu');
  assert.equal(cats[2].leaders[0].value, '2.5');
  assert.equal(cats[2].leaders[0].team, 'Terrafirma Dyip');

  // valueLabel stays empty so the front end's "label value" line reads cleanly.
  assert.equal(cats[0].leaders[0].valueLabel, '');
  assert.deepEqual(parsePbaLeaders('<html><body></body></html>'), []);
});

test('pbaPlayerMeta splits the jersey / position / team string', function () {
  assert.deepEqual(pbaPlayerMeta('#94 / SG / SAN MIGUEL BEERMEN'),
    { jersey: '#94', position: 'SG', team: 'San Miguel Beermen' });
  assert.deepEqual(pbaPlayerMeta('#18 / C / TERRAFIRMA DYIP'),
    { jersey: '#18', position: 'C', team: 'Terrafirma Dyip' });
  assert.deepEqual(pbaPlayerMeta(''), {});
});

test('pbaTitleCase tames the shouted source names but leaves real casing alone', function () {
  assert.equal(pbaTitleCase('NLEX ROAD WARRIORS'), 'NLEX Road Warriors');
  assert.equal(pbaTitleCase('TNT TROPANG 5G'), 'TNT Tropang 5G');
  assert.equal(pbaTitleCase('Barangay Ginebra'), 'Barangay Ginebra');
  // Internal capitals the shouted source destroys.
  assert.equal(pbaTitleCase('CONVERGE FIBERXERS'), 'Converge FiberXers');
  // Ordinals stay lowercase; other digit-led tokens are branding and shout.
  assert.equal(pbaTitleCase('49TH SEASON PBA PHILIPPINE CUP'), '49th Season PBA Philippine Cup');
  assert.equal(pbaTitleCase(''), '');
});

test('builds PBA postseason rounds and team detail profiles only from official match fields', function () {
  var matches = [{
    id:'pba-final', utcDate:'2026-08-30T10:00:00Z', status:'SCHEDULED', stage:'Semifinals',
    home:'Barangay Ginebra San Miguel', away:'TNT Tropang 5G', score:{home:null,away:null}
  }];
  var bracket = buildPbaBracket(matches);
  assert.equal(bracket.active, true);
  assert.equal(bracket.rounds[0].label, 'Semifinals');
  var profiles = buildTeamProfiles('pba', [
    { team:'Barangay Ginebra San Miguel', position:1, wins:3, losses:0, pct:1, streak:'+3' }
  ], [
    { team:'Barangay Ginebra San Miguel', score:88, label:'RISING', recentForm:'WWW', averagePointDiff:7.5 }
  ], matches, []);
  assert.equal(profiles[0].momentumScore, 88);
  assert.equal(profiles[0].margin, 7.5);
  assert.equal(profiles[0].next.away, 'TNT Tropang 5G');
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
  var changes = buildModuleChanges('pba', current, previous);
  assert.equal(changes.since, '2026-07-20T00:00:00Z');
  assert.deepEqual(changes.items.map(function (item) { return item.type; }), ['result', 'fixture', 'standing', 'momentum']);
  assert.match(changes.items[2].detail, /#2 to #1/);

  var repeated = buildModuleChanges('pba', {
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
    { completedAt:'2026-07-18T00:00:00Z', modules:{ pba:{ refreshStatus:'ok' } } },
    { completedAt:'2026-07-18T05:00:00Z', modules:{ pba:{ refreshStatus:'ok' } } },
    { completedAt:'2026-07-19T00:00:00Z', modules:{ pba:{ refreshStatus:'fallback' } } },
    { completedAt:'2026-07-20T00:00:00Z', modules:{ pba:{ refreshStatus:'ok' } } }
  ];
  var blocked = scheduleReadiness(history, 'pba', 3);
  assert.equal(blocked.ready, false);
  assert.equal(blocked.successfulDays.length, 2);
  var ready = scheduleReadiness(history.concat([
    { completedAt:'2026-07-21T00:00:00Z', modules:{ pba:{ refreshStatus:'ok' } } }
  ]), 'pba', 3);
  assert.equal(ready.ready, true);
});

// ── Lane preservation (the 2026-08-01 tennis-only clobber) ───────────────────
function laneDoc() {
  return {
    worldCup: { matches: [{ id: 1, status: 'FINISHED' }] },
    modules: {
      nba: { matches: [{ id: 'a' }], standings: [{ team: 'BOS' }] },
      pba: { standings: [{ team: 'Barangay Ginebra San Miguel' }], upcoming: [] },
      tennis: { tiers: { slam: { current: { name: 'US Open' } }, masters: {}, tour500: {} } }
    }
  };
}

test('moduleHasData recognises real lane data and rejects empty scaffolding', function () {
  var d = laneDoc();
  ['nba', 'pba', 'tennis', 'worldcup'].forEach(function (k) {
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
  assert.deepEqual(lanesMissing(onlyTennis, wantsTennis), ['nba', 'pba', 'worldcup']);
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
  assert.deepEqual(lanesMissing(target, function (k) { return k === 'pba' || k === 'tennis'; }), []);
});

test('shiftDateKey walks back across month boundaries', function () {
  assert.equal(shiftDateKey('2026-08-01', -1), '2026-07-31');
  assert.equal(shiftDateKey('2026-08-03', -21), '2026-07-13');
  assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');
});
