import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normNbaGame,
  normNbaStandings,
  buildNbaMomentum,
  nbaSeasonYear,
  parsePvlSchedule,
  parsePvlRecaps,
  parsePvlStandings,
  buildPvlMomentum
} from './refresh-sports.js';

function event(id, date, state, home, away, homeScore, awayScore) {
  return {
    id: id,
    date: date,
    season: { slug: 'regular-season' },
    status: { type: { state: state } },
    competitions: [{
      venue: { fullName: 'Test Arena' },
      competitors: [
        { homeAway: 'home', score: homeScore, team: { displayName: home } },
        { homeAway: 'away', score: awayScore, team: { displayName: away } }
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

test('parses official PVL schedule cards with shared date and venue headings', function () {
  var html = '<div class="row schedule-grid">' +
    '<div class="col-12">Sat Jul 25 | Vigan City, Ilocos Sur</div>' +
    '<div class="col-md-6"><div class="match-card"><div class="match-card-teams"><h3>NXL</h3><h3>CAP</h3></div><div class="match-card-time">04:00 PM</div><div class="match-card-time">Match-Up</div></div></div>' +
    '<div class="col-md-6"><div class="match-card"><div class="match-card-teams"><h3>HSH</h3><h3>CMF</h3></div><div class="match-card-time">06:30 PM</div><div class="match-card-time">Match-Up</div></div></div>' +
    '</div>';
  var games = parsePvlSchedule(html, new Date('2026-07-18T00:00:00Z'));
  assert.equal(games.length, 2);
  assert.equal(games[0].home, 'Nxled Chameleons');
  assert.equal(games[0].away, 'Capital1 Solar Spikers');
  assert.equal(games[0].venue, 'Vigan City, Ilocos Sur');
  assert.equal(games[1].utcDate, '2026-07-25T10:30:00.000Z');
  assert.deepEqual(games[1].score, { home: null, away: null });
});

test('parses PVL recaps and standings into momentum-ready rows', function () {
  var recap = '<div class="match-card"><div class="match-card-teams"><h3>ZUS</h3><div class="match-card-score">3</div><div class="match-card-score">1</div><h3>AKA</h3></div><div class="match-card-date">Wed Jul 08</div><div class="match-card-date">Match-Up</div><div class="match-card-time">04:00 PM</div></div>';
  var standingsHtml = '<table><tr><th>Rank</th><th>Team</th></tr><tr><th>1</th><td>ZUS COFFEE THUNDERBELLES</td><td>2</td><td>0</td><td>6</td><td>2</td><td>6</td><td>1</td><td>6.000</td><td>176</td><td>136</td><td>1.294</td></tr><tr><th>2</th><td>AKARI CHARGERS</td><td>0</td><td>1</td><td>0</td><td>1</td><td>1</td><td>3</td><td>0.333</td><td>79</td><td>101</td><td>0.782</td></tr></table>';
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
