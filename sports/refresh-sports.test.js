import { buildNbaProjections } from './nba-projections.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  laneHealth,
  monthKeysBetween,
  mergeNbaEventPages,
  normNbaGame,
  normNbaStandings,
  buildNbaMomentum,
  addNbaRestSignals,
  normNbaInjuries,
  normNbaPlayerWatch,
  nbaPlayoffRound,
  buildNbaBracket,
  nbaSeasonYear,
  buildNbaJournal,
  buildTeamProfiles,
  buildModuleChanges,
  scheduleReadiness,
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
  mergeConcurrentSportsDoc,
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

// 16 Sep 2026: ESPN's NBA scoreboard began answering every date range with 400
// "Failed to get events endpoint.", so the window is read month by month.
// 16 Sep - 6 Oct 2026: NBA failed every run and kept its old snapshot, while the
// one 'sports' health record said ok.
test('each scheduled lane a run asked for gets its own health record; a kept snapshot is a failure', function () {
  var doc = { modules: {
    nba: { refreshStatus: 'fallback', refreshError: 'ESPN NBA 400: {"code":400,"message":"Failed to get events endpoint."}', providerNote: 'Showing the last good NBA snapshot' },
    tennis: { refreshStatus: 'error', setupNote: 'Tennis fetch failed: fetch failed' }
  } };
  var all = laneHealth(doc, function () { return true; });
  assert.deepEqual(all.map(function (r) { return r.feed + '=' + r.status; }), ['sports-nba=failed', 'sports-tennis=failed'], 'the paused World Cup lane has no record');
  assert.equal(all[0].message, 'ESPN NBA 400: {"code":400,"message":"Failed to get events endpoint."}');
  assert.equal(all[0].stage, 'fetch (kept last good data)');
  assert.equal(all[1].message, 'Tennis fetch failed: fetch failed'); assert.equal(all[1].stage, 'fetch');
  var ok = laneHealth({ modules: { tennis: { refreshStatus: 'ok' } } }, function (key) { return key === 'tennis'; })[0];
  assert.equal(ok.status, 'ok'); assert.equal(ok.stage, null); assert.equal(ok.message, '');
  var nbaOnly = laneHealth(doc, function (key) { return key === 'nba'; });
  assert.deepEqual(nbaOnly.map(function (r) { return r.feed; }), ['sports-nba'], 'a lane the run did not ask for keeps its own record');
  assert.equal(laneHealth({ modules: {} }, function (key) { return key === 'tennis'; })[0].status, 'failed', 'a missing lane is not ok');
});

test('reads the NBA window as calendar months and keeps each game inside it once', function () {
  var start = new Date('2026-08-22T03:00:00Z');
  var end = new Date('2026-11-05T03:00:00Z');
  assert.deepEqual(monthKeysBetween(start, end), ['202608', '202609', '202610', '202611']);
  assert.deepEqual(monthKeysBetween(new Date('2026-12-20T00:00:00Z'), new Date('2027-01-10T00:00:00Z')), ['202612', '202701'], 'across a year end');
  assert.deepEqual(monthKeysBetween(new Date('2026-10-06T00:00:00Z'), new Date('2026-10-06T00:00:00Z')), ['202610']);
  var oct = { events: [{ id: '1', date: '2026-10-03T23:00Z' }, { id: '2', date: '2026-11-01T00:30Z' }] };
  var nov = { events: [{ id: '2', date: '2026-11-01T00:30Z' }, { id: '3', date: '2026-11-05T23:30Z' }, { id: '4', date: '2026-11-06T00:00Z' }] };
  var aug = { events: [{ id: '0', date: '2026-08-21T23:59Z' }, { id: '5', date: '2026-08-22T00:00Z' }] };
  var ids = mergeNbaEventPages([aug, null, oct, nov], start, end).map(function (e) { return e.id; });
  assert.deepEqual(ids, ['5', '1', '2', '3'], 'a game in two month pages counts once; the end day is included; outside the window is dropped');
  assert.deepEqual(mergeNbaEventPages([{ events: [{ id: '', date: '2026-10-01T00:00Z' }, { id: '9', date: 'not a date' }] }], start, end), []);
});

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

// buildNbaMomentum keys off FINISHED games, so out of season a standings team
// can have no momentum row at all. Every profile field is null-guarded for that
// except margin, which shipped `undefined` straight into the Firestore write and
// took the whole sports document down with it - all four lanes, not just NBA.
test('a standings team with no momentum row still writes a Firestore-safe profile', function () {
  var profiles = buildTeamProfiles('nba', [
    { team:'Played FC', position:1, wins:1, losses:0, pct:1 },
    { team:'Idle FC', position:2, wins:0, losses:0, pct:0 }
  ], [
    { team:'Played FC', score:70, label:'WATCH', recentForm:'W', averagePointDiff:4.5 }
  ], [], []);
  var idle = profiles.find(function (row) { return row.team === 'Idle FC'; });
  assert.equal(idle.margin, null);
  assert.equal(idle.momentumScore, null);
  profiles.forEach(function (profile) {
    assert.deepEqual(Object.keys(profile).filter(function (key) { return profile[key] === undefined; }), [],
      profile.team + ' carries an undefined field, which Firestore rejects');
  });
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
  var changes = buildModuleChanges('nba', current, previous);
  assert.equal(changes.since, '2026-07-20T00:00:00Z');
  assert.deepEqual(changes.items.map(function (item) { return item.type; }), ['result', 'fixture', 'standing', 'momentum']);
  assert.match(changes.items[2].detail, /#2 to #1/);

  var repeated = buildModuleChanges('nba', {
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
    { completedAt:'2026-07-18T00:00:00Z', modules:{ nba:{ refreshStatus:'ok' } } },
    { completedAt:'2026-07-18T05:00:00Z', modules:{ nba:{ refreshStatus:'ok' } } },
    { completedAt:'2026-07-19T00:00:00Z', modules:{ nba:{ refreshStatus:'fallback' } } },
    { completedAt:'2026-07-20T00:00:00Z', modules:{ nba:{ refreshStatus:'ok' } } }
  ];
  var blocked = scheduleReadiness(history, 'nba', 3);
  assert.equal(blocked.ready, false);
  assert.equal(blocked.successfulDays.length, 2);
  var ready = scheduleReadiness(history.concat([
    { completedAt:'2026-07-21T00:00:00Z', modules:{ nba:{ refreshStatus:'ok' } } }
  ]), 'nba', 3);
  assert.equal(ready.ready, true);
});

// ── Lane preservation (the 2026-08-01 tennis-only clobber) ───────────────────
function laneDoc() {
  return {
    worldCup: { matches: [{ id: 1, status: 'FINISHED' }] },
    modules: {
      nba: { matches: [{ id: 'a' }], standings: [{ team: 'BOS' }] },
      tennis: { tiers: { slam: { current: { name: 'US Open' } }, masters: {}, tour500: {} } }
    }
  };
}

test('moduleHasData recognises real lane data and rejects empty scaffolding', function () {
  var d = laneDoc();
  ['nba', 'tennis', 'worldcup'].forEach(function (k) {
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
  assert.deepEqual(lanesMissing(onlyTennis, wantsTennis), ['nba', 'worldcup']);
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
  assert.deepEqual(lanesMissing(target, function (k) { return k === 'tennis'; }), []);
});

test('concurrent module writes preserve lanes committed by another runner', function () {
  var current = laneDoc();
  current.modules.tennis = { tiers: { slam: { current: { name: 'New tennis snapshot' } }, masters: {}, tour500: {} } };
  current.modules.pba = { standings: [{ team: 'Barangay Ginebra San Miguel' }], upcoming: [] };
  var incoming = laneDoc();
  incoming.generatedAt = '2026-08-11T01:00:00Z';
  incoming.modules.nba = { matches: [{ id: 'new-nba' }], standings: [] };
  incoming.modules.tennis = { tiers: { slam: { current: { name: 'stale carried tennis' } }, masters: {}, tour500: {} } };

  var merged = mergeConcurrentSportsDoc(incoming, current, ['nba']);
  assert.equal(merged.modules.nba.matches[0].id, 'new-nba');
  assert.equal(merged.modules.tennis.tiers.slam.current.name, 'New tennis snapshot');
  assert.equal(merged.modules.pba, undefined, 'the removed PBA lane is not carried forward from an older doc');
  assert.equal(merged.worldCup.matches.length, 1);
  assert.deepEqual(merged.sports.sort(), ['nba', 'tennis', 'worldcup']);
});

test('shiftDateKey walks back across month boundaries', function () {
  assert.equal(shiftDateKey('2026-08-01', -1), '2026-07-31');
  assert.equal(shiftDateKey('2026-08-03', -21), '2026-07-13');
  assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');
});

function nbaProjectionFixture() {
  const matches = Array.from({length:5}, (_,i) => ({id:'r'+i, home:'Home', away:'Away', status:'FINISHED', stage:'regular-season', utcDate:'2026-10-0'+(i+1)+'T12:00:00Z', score:{home:110,away:90}}));
  matches.push({id:'next',home:'Home',away:'Away',status:'SCHEDULED',stage:'regular-season',utcDate:'2026-10-10T12:00:00Z'});
  const momentum = [{team:'Home',score:85,recentGames:5},{team:'Away',score:25,recentGames:5}];
  return {matches,momentum,now:new Date('2026-10-09T00:00:00Z')};
}
test('NBA estimates require recent form on both sides and skip preseason, live and started games', () => {
  const {matches,momentum,now} = nbaProjectionFixture();
  const next=matches.at(-1);
  const model=buildNbaProjections(matches,momentum,now);
  assert.equal(model.projected,1);
  assert.equal(next.projection.favorite,'Home');
  assert.equal(next.projection.probs.home + next.projection.probs.away,1);
  assert.ok(next.projection.probs.home <= .85);
  assert.equal(next.projection.tag,'Moderate edge','a sub-75% estimate is not labelled a strong edge');
  assert.ok(matches.slice(0,-1).every(m=>!m.projection));
  for(const [field,value] of [['stage','pre-season'],['status','IN_PLAY'],['status','POSTPONED'],['utcDate','2026-10-08T12:00:00Z']]) {
    const changed={...next,[field]:value};buildNbaProjections([...matches.slice(0,-1),changed],momentum,now);assert.equal(changed.projection,undefined);
  }
  buildNbaProjections(matches,momentum.slice(0,1),now);assert.equal(next.projection,undefined);
  buildNbaProjections(matches,momentum.map(r=>({...r,recentGames:2})),now);assert.equal(next.projection,undefined);
  buildNbaProjections(matches,momentum,new Date('2026-12-01'));assert.equal(next.projection,undefined);
});
test('NBA home/rest adjustment is modest and favors the rested side', () => {
  const {matches,momentum,now}=nbaProjectionFixture();const next=matches.at(-1);
  momentum.forEach(r=>r.score=50);
  buildNbaProjections(matches,momentum,now);const rested=next.projection.probs.home;
  assert.equal(next.projection.tag,'Toss-up');
  next.rest={home:{backToBack:true}};
  buildNbaProjections(matches,momentum,now);assert.ok(next.projection.probs.home < rested);
});
test('NBA journal freezes pre-tip estimates and scores only previously locked games without mutating prior state', () => {
  const {matches,momentum,now}=nbaProjectionFixture();buildNbaProjections(matches,momentum,now);
  const first=buildNbaJournal(null,matches,now.toISOString());
  assert.equal(first.stats.pending,1);assert.equal(first.stats.resolved,0);
  const original=JSON.stringify(first);
  const next={...matches.at(-1),projection:{...matches.at(-1).projection,probs:{home:.51,away:.49}}};
  const again=buildNbaJournal(first,[next],'2026-10-09T12:00:00Z');
  assert.equal(again.preds.next.pHome,first.preds.next.pHome);
  const done={...next,status:'FINISHED',score:{home:120,away:95}};
  const result=buildNbaJournal(first,[done],'2026-10-11T00:00:00Z');
  assert.equal(result.stats.resolved,1);assert.equal(result.stats.accuracy,100);
  assert.equal(JSON.stringify(first),original);
  assert.equal(buildNbaJournal(null,[done],'2026-10-11T00:00:00Z').stats.resolved,0);
  assert.equal(buildNbaJournal(null,[next],'2026-10-10T13:00:00Z').stats.pending,0);
});
