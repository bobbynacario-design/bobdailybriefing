// sports/refresh-sports.js
//
// Local runner for the Daily Briefer Sports tab. First lane: FIFA World Cup.
// Current forward lanes: NBA Momentum Radar and PH Local Pulse (PVL).
// It fetches provider data, normalises it into a small UI document, and writes:
//   briefings-bob/sports-YYYY-MM-DD
//   briefings-bob/sports-latest
//
// Run:
//   cd sports
//   npm install
//   set FOOTBALL_DATA_TOKEN=...
//   node refresh-sports.js
//
// Optional:
//   set SPORTS_FOLLOW_TEAMS=Australia,Philippines,England
//   node refresh-sports.js --dry-run
//   node refresh-sports.js --module nba --dry-run

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as cheerio from 'cheerio';

var __dirname = dirname(fileURLToPath(import.meta.url));
var __radar = join(__dirname, '..', 'radar');

(function loadDotEnv() {
  [join(__dirname, '.env'), join(__radar, '.env')].forEach(function (p) {
    try {
      if (!existsSync(p)) return;
      readFileSync(p, 'utf8').split(/\r?\n/).forEach(function (line) {
        if (/^\s*(#|$)/.test(line)) return;
        var m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (!m) return;
        var val = m[2].replace(/^['"]|['"]$/g, '');
        if (process.env[m[1]] === undefined) process.env[m[1]] = val;
      });
      console.log('Loaded ' + p);
    } catch (e) { console.warn('.env load failed (' + p + '):', e.message); }
  });
})();

var PROJECT_ID = 'pokerhq-a67e4';
var COLL = 'briefings-bob';
var FOOTBALL_DATA = 'https://api.football-data.org/v4';
var ESPN_NBA = 'https://site.api.espn.com/apis';
var ESPN_TENNIS = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
var PVL_SITE = 'https://www.pvl.ph';
var FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || '';
var FOLLOW_TEAMS = (process.env.SPORTS_FOLLOW_TEAMS || '')
  .split(',')
  .map(function (s) { return s.trim().toLowerCase(); })
  .filter(Boolean);
var NBA_FOLLOW_TEAMS = (process.env.NBA_FOLLOW_TEAMS || 'Lakers,Warriors,Knicks,Spurs,Mavericks')
  .split(',')
  .map(function (s) { return s.trim(); })
  .filter(Boolean);
var NBA_FOLLOW_PLAYERS = (process.env.NBA_FOLLOW_PLAYERS || '')
  .split(',')
  .map(function (s) { return s.trim(); })
  .filter(Boolean);
var PVL_FOLLOW_TEAMS = (process.env.PVL_FOLLOW_TEAMS || 'Creamline,Choco Mucho,PLDT,ZUS Coffee')
  .split(',')
  .map(function (s) { return s.trim(); })
  .filter(Boolean);
var ARGV = process.argv.slice(2);
var DRY_RUN = ARGV.indexOf('--dry-run') !== -1;
var MODULE_ARG = argValue('--module') || process.env.SPORTS_MODULE || 'all';
var SELECTED_MODULES = MODULE_ARG.split(',')
  .map(function (s) { return s.trim().toLowerCase(); })
  .filter(Boolean);
if (!SELECTED_MODULES.length) SELECTED_MODULES = ['all'];

function argValue(name) {
  var idx = ARGV.indexOf(name);
  if (idx >= 0 && ARGV[idx + 1] && ARGV[idx + 1].indexOf('--') !== 0) return ARGV[idx + 1];
  var prefix = name + '=';
  var hit = ARGV.find(function (a) { return a.indexOf(prefix) === 0; });
  return hit ? hit.slice(prefix.length) : '';
}

function wantsModule(name) {
  return SELECTED_MODULES.indexOf('all') >= 0 || SELECTED_MODULES.indexOf(name) >= 0;
}

function phtDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function phtToday() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
}

function num(v) {
  // Treat null/undefined/'' as "no value" so an UNPLAYED match (football-data
  // sends score.fullTime = {home:null, away:null}) stores null, not 0. Otherwise
  // Number(null) === 0 rendered every scheduled/TIMED match as a fake "0-0".
  // A real played 0-0 still passes through as 0 (Number(0) === 0).
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

async function fetchRetry(url, opts, label) {
  var attempts = 4;
  var lastErr;
  for (var i = 0; i < attempts; i++) {
    try {
      var res = await fetch(url, opts);
      if (res.status !== 429 && res.status < 500) return res;
      lastErr = new Error(label + ' HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
    } catch (e) {
      lastErr = e;
    }
    console.log('  ' + label + ' retry ' + (i + 1) + '/' + (attempts - 1));
    await new Promise(function (r) { setTimeout(r, 1500 * (i + 1)); });
  }
  throw lastErr;
}

async function footballData(path) {
  if (!FOOTBALL_DATA_TOKEN) throw new Error('Missing FOOTBALL_DATA_TOKEN.');
  var url = FOOTBALL_DATA + path;
  var res = await fetchRetry(url, {
    headers: { 'X-Auth-Token': FOOTBALL_DATA_TOKEN, 'accept': 'application/json' }
  }, 'football-data ' + path);
  if (!res.ok) {
    throw new Error('football-data ' + res.status + ': ' + (await res.text()).slice(0, 300));
  }
  return res.json();
}

async function espnNba(path) {
  var url = ESPN_NBA + path;
  var res = await fetchRetry(url, {
    headers: { 'accept': 'application/json', 'user-agent': 'BobDailyBriefing/1.0' }
  }, 'ESPN NBA ' + path);
  if (!res.ok) {
    throw new Error('ESPN NBA ' + res.status + ': ' + (await res.text()).slice(0, 300));
  }
  return res.json();
}

function dateKeyUtc(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function shiftedDate(date, days) {
  var d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function nbaSeasonYear(date) {
  // ESPN labels a season by its ending year. The next season begins appearing
  // in its feed around September, so July/August still belongs to the prior one.
  return date.getUTCMonth() >= 8 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
}

function nbaCompetitor(comp, homeAway) {
  return ((comp && comp.competitors) || []).find(function (c) {
    return c.homeAway === homeAway;
  }) || {};
}

function nbaStatus(event) {
  var state = (((event || {}).status || {}).type || {}).state || '';
  if (state === 'post') return 'FINISHED';
  if (state === 'in') return 'LIVE';
  return 'SCHEDULED';
}

function nbaTeamName(competitor) {
  var team = (competitor && competitor.team) || {};
  return team.displayName || [team.location, team.name].filter(Boolean).join(' ') || team.shortDisplayName || 'TBD';
}

function nbaPlayoffRound(headline) {
  var label = String(headline || '').replace(/\s*-\s*Game\s+\d+.*$/i, '').trim();
  var conference = /^East\b/i.test(label) ? 'East' : (/^West\b/i.test(label) ? 'West' : 'League');
  if (/1st Round/i.test(label)) return { key: conference.toLowerCase() + '-first', label: label, conference: conference, order: conference === 'East' ? 10 : 11 };
  if (/Semifinals/i.test(label)) return { key: conference.toLowerCase() + '-semifinals', label: label, conference: conference, order: conference === 'East' ? 20 : 21 };
  if (/\bFinals\b/i.test(label) && conference !== 'League') return { key: conference.toLowerCase() + '-finals', label: label, conference: conference, order: conference === 'East' ? 30 : 31 };
  if (/NBA Finals/i.test(label)) return { key: 'nba-finals', label: 'NBA Finals', conference: 'League', order: 40 };
  return null;
}

function normNbaGame(event) {
  var comp = ((event && event.competitions) || [])[0] || {};
  var home = nbaCompetitor(comp, 'home');
  var away = nbaCompetitor(comp, 'away');
  var status = nbaStatus(event);
  var hasScore = status === 'FINISHED' || status === 'LIVE';
  var season = (event && event.season) || {};
  var notes = Array.isArray(comp.notes) ? comp.notes : (comp.notes ? [comp.notes] : []);
  var headline = ((notes[0] || {}).headline) || '';
  var round = nbaPlayoffRound(headline);
  var series = comp.series || null;
  var seriesCompetitors = series && series.competitors || [];
  var homeTeamId = String(((home || {}).team || {}).id || home.id || '');
  var awayTeamId = String(((away || {}).team || {}).id || away.id || '');
  function seriesWins(teamId) {
    var row = seriesCompetitors.find(function (item) { return String(item.id || '') === teamId; });
    return row && row.wins != null ? Number(row.wins) : null;
  }
  return {
    id: String((event && event.id) || comp.id || ''),
    utcDate: (event && event.date) || comp.date || '',
    status: status,
    stage: season.slug || ((comp.type || {}).abbreviation || ''),
    group: '',
    home: nbaTeamName(home),
    away: nbaTeamName(away),
    venue: ((comp.venue || {}).fullName) || '',
    score: {
      home: hasScore ? num(home.score) : null,
      away: hasScore ? num(away.score) : null
    },
    round: round ? round.key : '',
    roundLabel: round ? round.label : '',
    roundOrder: round ? round.order : null,
    conference: round ? round.conference : '',
    series: series ? {
      summary: series.summary || '',
      completed: Boolean(series.completed),
      homeWins: seriesWins(homeTeamId),
      awayWins: seriesWins(awayTeamId)
    } : null
  };
}

function statValue(entry, name, fallback) {
  var row = ((entry && entry.stats) || []).find(function (s) { return s.name === name; });
  if (!row || row.value == null || isNaN(Number(row.value))) return fallback;
  return Number(row.value);
}

function normNbaStandings(json) {
  var out = [];
  ((json && json.children) || []).forEach(function (conference) {
    var conferenceName = conference.abbreviation || conference.name || '';
    ((((conference || {}).standings || {}).entries) || []).forEach(function (entry) {
      var team = entry.team || {};
      out.push({
        conference: conferenceName,
        position: statValue(entry, 'playoffSeed', null),
        team: team.displayName || [team.location, team.name].filter(Boolean).join(' ') || team.shortDisplayName || 'TBD',
        abbreviation: team.abbreviation || '',
        wins: statValue(entry, 'wins', 0),
        losses: statValue(entry, 'losses', 0),
        pct: round2(statValue(entry, 'winPercent', 0)),
        streak: (((entry.stats || []).find(function (s) { return s.name === 'streak'; }) || {}).displayValue) || '',
        lastTen: (((entry.stats || []).find(function (s) { return s.name === 'Last Ten Games'; }) || {}).displayValue) || '',
        differential: round2(statValue(entry, 'differential', 0))
      });
    });
  });
  return out.sort(function (a, b) {
    return String(a.conference).localeCompare(String(b.conference)) || (a.position || 99) - (b.position || 99);
  });
}

function nbaGameResult(match, team) {
  if (!match || match.status !== 'FINISHED' || !match.score || match.score.home == null || match.score.away == null) return '';
  var own = match.home === team ? match.score.home : match.score.away;
  var opp = match.home === team ? match.score.away : match.score.home;
  return own > opp ? 'W' : 'L';
}

function nbaPointDiff(match, team) {
  if (!match || !match.score || match.score.home == null || match.score.away == null) return 0;
  return match.home === team ? match.score.home - match.score.away : match.score.away - match.score.home;
}

function buildNbaMomentum(matches, standings) {
  var byTeam = {};
  (matches || []).filter(function (m) { return m.status === 'FINISHED'; }).forEach(function (m) {
    [m.home, m.away].forEach(function (team) {
      if (!team || team === 'TBD') return;
      if (!byTeam[team]) byTeam[team] = [];
      byTeam[team].push(m);
    });
  });
  var standingByTeam = {};
  (standings || []).forEach(function (s) { standingByTeam[s.team] = s; });
  return Object.keys(byTeam).map(function (team) {
    var games = byTeam[team].slice().sort(function (a, b) { return String(a.utcDate).localeCompare(String(b.utcDate)); }).slice(-5);
    var form = games.map(function (m) { return nbaGameResult(m, team); });
    var wins = form.filter(function (r) { return r === 'W'; }).length;
    var diff = games.reduce(function (sum, m) { return sum + nbaPointDiff(m, team); }, 0);
    var averageDiff = games.length ? diff / games.length : 0;
    var standing = standingByTeam[team] || {};
    var seasonPct = standing.pct == null ? 0.5 : standing.pct;
    var score = Math.round(clamp((wins / Math.max(1, games.length)) * 65 + clamp(50 + averageDiff * 2.5, 0, 100) * 0.25 + seasonPct * 100 * 0.10, 0, 100));
    var label = score >= 72 ? 'RISING' : (score >= 58 ? 'WATCH' : (score <= 38 ? 'FADING' : 'STEADY'));
    return {
      team: team,
      score: score,
      label: label,
      recentForm: form.join(''),
      recentGames: games.length,
      recentWins: wins,
      averagePointDiff: round2(averageDiff),
      seasonPct: round2(seasonPct),
      note: label === 'RISING'
        ? 'Recent wins and point differential are both trending positively.'
        : (label === 'FADING'
          ? 'Recent results and scoring margin are below the league momentum line.'
          : 'Recent form is mixed and needs another result for confirmation.')
    };
  }).sort(function (a, b) {
    return b.score - a.score || b.averagePointDiff - a.averagePointDiff;
  });
}

function nbaRestDays(previousDate, gameDate) {
  if (!previousDate || !gameDate) return null;
  var gapHours = (new Date(gameDate).getTime() - new Date(previousDate).getTime()) / 3600000;
  if (!isFinite(gapHours) || gapHours <= 0) return null;
  return Math.max(0, Math.round(gapHours / 24) - 1);
}

function addNbaRestSignals(matches) {
  var ordered = (matches || []).slice().sort(function (a, b) {
    return String(a.utcDate).localeCompare(String(b.utcDate));
  });
  var previousByTeam = {};
  return ordered.map(function (match) {
    var copy = Object.assign({}, match);
    copy.rest = {};
    [['home', match.home], ['away', match.away]].forEach(function (pair) {
      var side = pair[0];
      var team = pair[1];
      var previous = previousByTeam[team] || null;
      var days = nbaRestDays(previous && previous.utcDate, match.utcDate);
      copy.rest[side] = {
        days: days,
        backToBack: days === 0,
        previousGame: previous ? previous.utcDate : ''
      };
      previousByTeam[team] = match;
    });
    return copy;
  });
}

function normNbaInjuries(json) {
  var out = [];
  ((json && json.injuries) || []).forEach(function (teamRow) {
    var team = teamRow.displayName || teamRow.name || '';
    (teamRow.injuries || []).forEach(function (row) {
      var athlete = row.athlete || {};
      out.push({
        team: team,
        player: athlete.displayName || athlete.fullName || '',
        status: row.status || 'Unknown',
        date: row.date || '',
        note: cleanPvlText(row.shortComment || row.longComment || '').slice(0, 240)
      });
    });
  });
  return out.filter(function (row) { return row.team && row.player; }).sort(function (a, b) {
    return String(b.date).localeCompare(String(a.date));
  });
}

function normNbaPlayerWatch(events, followedPlayers) {
  followedPlayers = followedPlayers || [];
  var followedKeys = followedPlayers.map(teamKey);
  var seen = {};
  var out = [];
  (events || []).slice().sort(function (a, b) {
    return String(b.date || '').localeCompare(String(a.date || ''));
  }).forEach(function (event) {
    if (nbaStatus(event) !== 'FINISHED') return;
    var comp = ((event && event.competitions) || [])[0] || {};
    (comp.competitors || []).forEach(function (competitor) {
      var leaders = competitor.leaders || [];
      var category = leaders.find(function (row) { return row.name === 'rating'; }) ||
        leaders.find(function (row) { return row.name === 'points'; });
      var leader = category && (category.leaders || [])[0];
      var athlete = leader && leader.athlete || {};
      var player = athlete.displayName || athlete.fullName || '';
      if (!player || seen[player]) return;
      seen[player] = true;
      out.push({
        player: player,
        team: nbaTeamName(competitor),
        line: leader.displayValue || (leader.value == null ? '' : String(leader.value)),
        category: category.displayName || category.name || 'Game leader',
        date: event.date || comp.date || '',
        pinned: followedKeys.indexOf(teamKey(player)) >= 0
      });
    });
  });
  followedPlayers.forEach(function (player) {
    if (seen[player] || out.some(function (row) { return teamKey(row.player) === teamKey(player); })) return;
    out.push({
      player: player,
      team: '',
      line: 'No recent game-leader line in the current window.',
      category: 'Pinned player',
      date: '',
      pinned: true
    });
  });
  return out.sort(function (a, b) {
    return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.date).localeCompare(String(a.date));
  }).slice(0, 16);
}

function buildNbaBracket(matches) {
  var bySeries = {};
  (matches || []).filter(function (match) { return match.round; }).forEach(function (match) {
    var teams = [match.home, match.away].sort();
    var key = match.round + '|' + teams.join('|');
    if (!bySeries[key] || String(match.utcDate) > String(bySeries[key].utcDate)) bySeries[key] = match;
  });
  var byRound = {};
  Object.keys(bySeries).forEach(function (key) {
    var match = bySeries[key];
    if (!byRound[match.round]) {
      byRound[match.round] = {
        key: match.round,
        label: match.roundLabel || match.round,
        conference: match.conference || '',
        order: match.roundOrder == null ? 99 : match.roundOrder,
        series: []
      };
    }
    byRound[match.round].series.push({
      home: match.home,
      away: match.away,
      homeWins: match.series && match.series.homeWins,
      awayWins: match.series && match.series.awayWins,
      summary: match.series && match.series.summary || '',
      completed: Boolean(match.series && match.series.completed),
      lastGame: match.utcDate
    });
  });
  var rounds = Object.keys(byRound).map(function (key) { return byRound[key]; }).sort(function (a, b) { return a.order - b.order; });
  return { active: rounds.length > 0, rounds: rounds };
}

var PVL_TEAM_NAMES = {
  AKA: 'Akari Chargers',
  CAP: 'Capital1 Solar Spikers',
  CCS: 'Creamline Cool Smashers',
  CMF: 'Choco Mucho Flying Titans',
  CSS: 'Cignal Super Spikers',
  CTC: 'Chery Tiggo Crossovers',
  FFF: 'Farm Fresh Foxies',
  GTH: 'Galeries Tower Highrisers',
  HSH: 'PLDT Home Fiber High Speed Hitters',
  NXL: 'Nxled Chameleons',
  PGA: 'Petro Gazz Angels',
  ZUS: 'ZUS Coffee Thunderbelles'
};
var PVL_LEADER_CATEGORIES = ['scorers', 'spikers', 'blockers', 'servers', 'diggers', 'setters', 'receivers'];

function cleanPvlText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function pvlTeamName(value) {
  var raw = cleanPvlText(value);
  var code = raw.toUpperCase();
  if (PVL_TEAM_NAMES[code]) return PVL_TEAM_NAMES[code];
  var canonical = Object.keys(PVL_TEAM_NAMES).find(function (key) {
    return teamKey(PVL_TEAM_NAMES[key]) === teamKey(raw);
  });
  return canonical ? PVL_TEAM_NAMES[canonical] : raw;
}

function pvlMatchId(utcDate, home, away) {
  return 'pvl-' + utcDate.slice(0, 10) + '-' +
    teamKey(home).replace(/ /g, '-').slice(0, 12).replace(/-+$/, '') + '-' +
    teamKey(away).replace(/ /g, '-').slice(0, 12).replace(/-+$/, '');
}

async function pvlFetch(path) {
  var res = await fetchRetry(PVL_SITE + path, {
    headers: {
      'accept': 'text/html,application/xhtml+xml',
      'user-agent': 'BobDailyBriefing/1.0 (+https://bobbynacario-design.github.io/bobdailybriefing/)'
    }
  }, 'PVL ' + path);
  if (!res.ok) throw new Error('PVL ' + path + ' HTTP ' + res.status);
  return res.text();
}

function pvlDateTime(dateText, timeText, now, preferFuture) {
  var months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  var dm = cleanPvlText(dateText).match(/\b([A-Z][a-z]{2})\s+(\d{1,2})\b/);
  if (!dm || months[dm[1]] == null) return '';
  var tm = cleanPvlText(timeText).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  var hour = tm ? Number(tm[1]) % 12 + (String(tm[3]).toUpperCase() === 'PM' ? 12 : 0) : 12;
  var minute = tm ? Number(tm[2]) : 0;
  now = now || new Date();
  var phtYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric' }).format(now));
  var year = phtYear;
  var ms = Date.UTC(year, months[dm[1]], Number(dm[2]), hour - 8, minute);
  var tolerance = 45 * 86400000;
  if (preferFuture && ms < now.getTime() - tolerance) year++;
  if (!preferFuture && ms > now.getTime() + tolerance) year--;
  return new Date(Date.UTC(year, months[dm[1]], Number(dm[2]), hour - 8, minute)).toISOString();
}

function parsePvlSchedule(html, now) {
  var $ = cheerio.load(html || '');
  var firstCard = $('.match-card').first();
  if (!firstCard.length) return [];
  var container = firstCard.parent().parent();
  var dateText = '';
  var venue = '';
  var out = [];
  container.children().each(function () {
    var child = $(this);
    var card = child.find('.match-card').first();
    if (!card.length) {
      var heading = cleanPvlText(child.text());
      var dateMatch = heading.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Z][a-z]{2}\s+\d{1,2}\b/);
      if (dateMatch) {
        dateText = dateMatch[0];
        venue = cleanPvlText(heading.replace(dateMatch[0], '').replace(/^\s*\|\s*/, ''));
      }
      return;
    }
    var teams = card.find('.match-card-teams h3').map(function () { return cleanPvlText($(this).text()); }).get();
    var times = card.find('.match-card-time').map(function () { return cleanPvlText($(this).text()); }).get();
    var utcDate = pvlDateTime(dateText, times[0], now, true);
    if (teams.length < 2 || !utcDate) return;
    var home = pvlTeamName(teams[0]);
    var away = pvlTeamName(teams[1]);
    out.push({
      id: pvlMatchId(utcDate, home, away),
      utcDate: utcDate,
      status: 'SCHEDULED',
      stage: times[1] || 'PVL',
      group: '',
      home: home,
      away: away,
      venue: venue,
      score: { home: null, away: null }
    });
  });
  return out.sort(function (a, b) { return String(a.utcDate).localeCompare(String(b.utcDate)); });
}

function parsePvlRecaps(html, now) {
  var $ = cheerio.load(html || '');
  var out = [];
  $('.match-card').each(function () {
    var card = $(this);
    var scores = card.find('.match-card-score').map(function () { return num(cleanPvlText($(this).text())); }).get();
    if (scores.length < 2) return;
    var teams = card.find('.match-card-teams h3').map(function () { return cleanPvlText($(this).text()); }).get();
    var dates = card.find('.match-card-date').map(function () { return cleanPvlText($(this).text()); }).get();
    var time = cleanPvlText(card.find('.match-card-time').first().text());
    var utcDate = pvlDateTime(dates[0], time, now, false);
    if (teams.length < 2 || !utcDate) return;
    var home = pvlTeamName(teams[0]);
    var away = pvlTeamName(teams[1]);
    out.push({
      id: pvlMatchId(utcDate, home, away),
      utcDate: utcDate,
      status: 'FINISHED',
      stage: dates[1] || 'PVL',
      group: '',
      home: home,
      away: away,
      venue: '',
      score: { home: scores[0], away: scores[1] }
    });
  });
  return out.sort(function (a, b) { return String(b.utcDate).localeCompare(String(a.utcDate)); });
}

function parsePvlStandings(html) {
  var $ = cheerio.load(html || '');
  var out = [];
  $('table').first().find('tr').each(function () {
    var row = $(this);
    var cells = row.find('td').map(function () { return cleanPvlText($(this).text()); }).get();
    if (cells.length < 11) return;
    out.push({
      position: num(cleanPvlText(row.find('th').first().text())),
      team: pvlTeamName(cells[0]),
      wins: num(cells[1]) || 0,
      losses: num(cells[2]) || 0,
      points: num(cells[3]) || 0,
      playedGames: num(cells[4]) || 0,
      setsWon: num(cells[5]) || 0,
      setsLost: num(cells[6]) || 0,
      setRatio: num(cells[7]) || 0,
      pointsWon: num(cells[8]) || 0,
      pointsLost: num(cells[9]) || 0,
      pointRatio: num(cells[10]) || 0
    });
  });
  return out.sort(function (a, b) { return (a.position || 99) - (b.position || 99); });
}

function parsePvlLeaders(html, category) {
  var $ = cheerio.load(html || '');
  var table = $('#record-table').first();
  var selected = $('select option[selected]').first();
  var conference = cleanPvlText(selected.text());
  var headers = table.find('thead th').map(function () { return cleanPvlText($(this).text()); }).get();
  var rows = [];
  table.find('tbody tr').each(function () {
    var row = $(this);
    var rank = num(cleanPvlText(row.find('th').first().text()));
    var cells = row.find('td').map(function () { return cleanPvlText($(this).text()); }).get();
    if (!rank || cells.length < 2 || !cells[0]) return;
    var metrics = {};
    cells.slice(1).forEach(function (value, idx) {
      metrics[headers[idx + 2] || ('Metric ' + (idx + 1))] = value;
    });
    rows.push({
      rank: rank,
      name: cells[0],
      value: cells[cells.length - 1],
      valueLabel: headers[headers.length - 1] || 'Value',
      metrics: metrics
    });
  });
  return {
    key: category || '',
    label: (category || 'leaders').replace(/s$/, '').replace(/^./, function (c) { return c.toUpperCase(); }),
    conference: conference,
    leaders: rows.slice(0, 10)
  };
}

function buildPvlMomentum(matches, standings) {
  var byTeam = {};
  (standings || []).forEach(function (s) { byTeam[s.team] = []; });
  (matches || []).forEach(function (m) {
    [m.home, m.away].forEach(function (team) {
      if (!byTeam[team]) byTeam[team] = [];
      byTeam[team].push(m);
    });
  });
  var standingByTeam = {};
  (standings || []).forEach(function (s) { standingByTeam[s.team] = s; });
  return Object.keys(byTeam).map(function (team) {
    var games = byTeam[team].slice().sort(function (a, b) { return String(a.utcDate).localeCompare(String(b.utcDate)); }).slice(-5);
    var form = games.map(function (m) {
      var own = m.home === team ? m.score.home : m.score.away;
      var opp = m.home === team ? m.score.away : m.score.home;
      return own > opp ? 'W' : 'L';
    });
    var recentWins = form.filter(function (r) { return r === 'W'; }).length;
    var setDiff = games.reduce(function (sum, m) {
      return sum + (m.home === team ? m.score.home - m.score.away : m.score.away - m.score.home);
    }, 0);
    var averageSetDiff = games.length ? setDiff / games.length : 0;
    var standing = standingByTeam[team] || {};
    var standingGames = (standing.wins || 0) + (standing.losses || 0);
    var standingPct = standingGames ? standing.wins / standingGames : 0.5;
    var recentPct = games.length ? recentWins / games.length : standingPct;
    var score = Math.round(clamp(recentPct * 55 + standingPct * 20 + clamp(50 + averageSetDiff * 18, 0, 100) * 0.25, 0, 100));
    var label = score >= 72 ? 'RISING' : (score >= 58 ? 'WATCH' : (score <= 38 ? 'FADING' : 'STEADY'));
    return {
      team: team,
      score: score,
      label: label,
      recentForm: form.join(''),
      recentGames: games.length,
      recentWins: recentWins,
      averageSetDiff: round2(averageSetDiff),
      averagePointDiff: round2(averageSetDiff),
      standingPct: round2(standingPct),
      note: games.length
        ? 'Momentum blends recent match wins, set differential and the current PVL table.'
        : 'No completed match is present in the current recap window; score is table-based.'
    };
  }).sort(function (a, b) { return b.score - a.score || b.averageSetDiff - a.averageSetDiff; });
}

function pvlPostseasonRound(stage) {
  var value = cleanPvlText(stage);
  if (/quarter/i.test(value)) return { key: 'quarterfinals', label: 'Quarterfinals', order: 10 };
  if (/semi/i.test(value)) return { key: 'semifinals', label: 'Semifinals', order: 20 };
  if (/third|bronze/i.test(value)) return { key: 'third-place', label: 'Third Place', order: 30 };
  if (/final|championship/i.test(value)) return { key: 'finals', label: 'Finals', order: 40 };
  return null;
}

function buildPvlBracket(matches) {
  var rounds = {};
  (matches || []).forEach(function (match) {
    var round = pvlPostseasonRound(match.stage);
    if (!round) return;
    if (!rounds[round.key]) rounds[round.key] = { key:round.key, label:round.label, order:round.order, series:[] };
    rounds[round.key].series.push({
      home: match.home,
      away: match.away,
      homeWins: match.score && match.score.home,
      awayWins: match.score && match.score.away,
      summary: match.status === 'FINISHED' && match.score ? match.score.home + '-' + match.score.away : sportsDateLabel(match.utcDate),
      completed: match.status === 'FINISHED',
      lastGame: match.utcDate
    });
  });
  var out = Object.keys(rounds).map(function (key) { return rounds[key]; }).sort(function (a, b) { return a.order - b.order; });
  return { active: out.length > 0, rounds: out };
}

function sportsDateLabel(value) {
  if (!value) return 'Scheduled';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value)) + ' PHT';
}

function buildTeamProfiles(kind, standings, momentum, matches, injuries) {
  var standingByTeam = {};
  var momentumByTeam = {};
  (standings || []).forEach(function (row) { standingByTeam[row.team] = row; });
  (momentum || []).forEach(function (row) { momentumByTeam[row.team] = row; });
  var teams = Object.keys(standingByTeam);
  Object.keys(momentumByTeam).forEach(function (team) { if (teams.indexOf(team) < 0) teams.push(team); });
  return teams.map(function (team) {
    var teamMatches = (matches || []).filter(function (match) { return match.home === team || match.away === team; });
    var next = teamMatches.filter(function (match) { return match.status !== 'FINISHED'; }).sort(function (a, b) {
      return String(a.utcDate).localeCompare(String(b.utcDate));
    })[0] || null;
    var latest = teamMatches.filter(function (match) { return match.status === 'FINISHED'; }).sort(function (a, b) {
      return String(b.utcDate).localeCompare(String(a.utcDate));
    })[0] || null;
    var standing = standingByTeam[team] || {};
    var form = momentumByTeam[team] || {};
    var teamInjuries = (injuries || []).filter(function (row) { return row.team === team; });
    return {
      team: team,
      kind: kind,
      conference: standing.conference || '',
      position: standing.position == null ? null : standing.position,
      wins: standing.wins == null ? (standing.w || 0) : standing.wins,
      losses: standing.losses == null ? (standing.l || 0) : standing.losses,
      points: standing.points == null ? null : standing.points,
      setRatio: standing.setRatio == null ? null : standing.setRatio,
      pointRatio: standing.pointRatio == null ? null : standing.pointRatio,
      momentumScore: form.score == null ? null : form.score,
      momentumLabel: form.label || '',
      recentForm: form.recentForm || '',
      margin: kind === 'pvl' ? form.averageSetDiff : form.averagePointDiff,
      next: next,
      latest: latest,
      availabilityCount: teamInjuries.length,
      availability: teamInjuries.slice(0, 5)
    };
  }).sort(function (a, b) {
    return String(a.conference).localeCompare(String(b.conference)) || (a.position || 99) - (b.position || 99) || String(a.team).localeCompare(String(b.team));
  });
}

function buildModuleChanges(kind, current, previous) {
  current = current || {};
  previous = previous || null;
  var result = {
    since: previous && (previous.lastSuccessfulAt || previous.generatedAt) || '',
    generatedAt: current.lastSuccessfulAt || current.generatedAt || new Date().toISOString(),
    items: []
  };
  if (!previous) return result;

  var previousMatches = {};
  (previous.matches || []).forEach(function (match) { if (match && match.id) previousMatches[match.id] = match; });
  (current.recent || []).forEach(function (match) {
    var before = match && match.id ? previousMatches[match.id] : null;
    if (!match || !match.id || (before && before.status === 'FINISHED')) return;
    result.items.push({
      type: 'result', importance: 'high', at: match.utcDate || '',
      title: (match.home || 'TBD') + ' ' + match.score.home + '-' + match.score.away + ' ' + (match.away || 'TBD'),
      detail: 'New final result' + (match.stage ? ' / ' + match.stage : '')
    });
  });
  (current.upcoming || []).forEach(function (match) {
    if (!match || !match.id || previousMatches[match.id]) return;
    result.items.push({
      type: 'fixture', importance: 'medium', at: match.utcDate || '',
      title: (match.home || 'TBD') + ' vs ' + (match.away || 'TBD'),
      detail: 'New fixture' + (match.venue ? ' / ' + match.venue : '')
    });
  });

  var previousStandings = {};
  (previous.standings || []).forEach(function (row) { if (row && row.team) previousStandings[row.team] = row; });
  (current.standings || []).forEach(function (row) {
    var before = previousStandings[row.team];
    if (!before) return;
    var positionChanged = row.position != null && before.position != null && row.position !== before.position;
    var recordChanged = row.wins !== before.wins || row.losses !== before.losses || row.points !== before.points;
    if (!positionChanged && !recordChanged) return;
    var detail = [];
    if (positionChanged) detail.push('#' + before.position + ' to #' + row.position);
    if (recordChanged) {
      detail.push(kind === 'pvl'
        ? row.wins + '-' + row.losses + ' / ' + row.points + ' pts'
        : row.wins + '-' + row.losses);
    }
    result.items.push({
      type: 'standing', importance: positionChanged ? 'high' : 'medium', team: row.team,
      title: row.team + (positionChanged ? (row.position < before.position ? ' moved up' : ' moved down') : ' record updated'),
      detail: detail.join(' / ')
    });
  });

  var previousMomentum = {};
  (previous.momentum || []).forEach(function (row) { if (row && row.team) previousMomentum[row.team] = row; });
  (current.momentum || []).forEach(function (row) {
    var before = previousMomentum[row.team];
    if (!before) return;
    var delta = Number(row.score || 0) - Number(before.score || 0);
    if (row.label === before.label && Math.abs(delta) < 8) return;
    result.items.push({
      type: 'momentum', importance: Math.abs(delta) >= 15 ? 'high' : 'medium', team: row.team,
      title: row.team + ' is ' + String(row.label || 'steady').toLowerCase(),
      detail: 'Momentum ' + (delta > 0 ? '+' : '') + delta + ' / form ' + (row.recentForm || '-')
    });
  });

  if (kind === 'nba') {
    var previousAvailability = {};
    (previous.injuries || []).forEach(function (row) {
      if (row && row.player) previousAvailability[teamKey(row.team) + '|' + teamKey(row.player)] = row;
    });
    (current.injuries || []).forEach(function (row) {
      var before = previousAvailability[teamKey(row.team) + '|' + teamKey(row.player)];
      if (before && before.status === row.status && before.note === row.note) return;
      result.items.push({
        type: 'availability', importance: 'medium', team: row.team,
        title: row.player + ' / ' + (row.status || 'Update'),
        detail: row.team + (row.note ? ' / ' + row.note : '')
      });
    });
  }

  var priority = { result: 0, fixture: 1, standing: 2, momentum: 3, availability: 4 };
  result.items.sort(function (a, b) {
    var aPriority = priority[a.type] == null ? 9 : priority[a.type];
    var bPriority = priority[b.type] == null ? 9 : priority[b.type];
    return aPriority - bPriority || String(b.at || '').localeCompare(String(a.at || ''));
  });
  var limits = { result: 4, fixture: 6, standing: 3, momentum: 3, availability: 4 };
  var counts = {};
  result.items = result.items.filter(function (item) {
    counts[item.type] = (counts[item.type] || 0) + 1;
    return counts[item.type] <= (limits[item.type] || 2);
  }).slice(0, 12);
  if (!result.items.length && previous.changes && (previous.changes.items || []).length) {
    var previousChangeDay = phtDateKeyFor(previous.changes.generatedAt || previous.lastSuccessfulAt);
    var currentChangeDay = phtDateKeyFor(result.generatedAt);
    if (previousChangeDay && previousChangeDay === currentChangeDay) {
      result.since = previous.changes.since || result.since;
      result.generatedAt = previous.changes.generatedAt || result.generatedAt;
      result.items = (previous.changes.items || []).filter(function (item) {
        counts[item.type] = (counts[item.type] || 0) + 1;
        return counts[item.type] <= (limits[item.type] || 2);
      }).slice(0, 12);
    }
  }
  return result;
}

function phtDateKeyFor(value) {
  if (!value || isNaN(new Date(value).getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(value));
}

function teamName(t) {
  return (t && (t.shortName || t.name || t.tla)) || 'TBD';
}

function normMatch(m) {
  var score = m.score && m.score.fullTime ? m.score.fullTime : {};
  return {
    id: String(m.id || ''),
    utcDate: m.utcDate || '',
    status: m.status || 'SCHEDULED',
    stage: m.stage || '',
    group: m.group || '',
    home: teamName(m.homeTeam),
    away: teamName(m.awayTeam),
    venue: m.venue || '',
    score: {
      home: num(score.home),
      away: num(score.away)
    }
  };
}

function normStanding(row) {
  return {
    group: row.group || '',
    position: row.position || null,
    team: teamName(row.team),
    playedGames: row.playedGames || 0,
    won: row.won || 0,
    draw: row.draw || 0,
    lost: row.lost || 0,
    points: row.points || 0,
    goalsFor: row.goalsFor || 0,
    goalsAgainst: row.goalsAgainst || 0,
    goalDifference: row.goalDifference || 0
  };
}

function normScorer(row) {
  return {
    player: row.player && row.player.name ? row.player.name : '',
    team: teamName(row.team),
    goals: row.goals || 0,
    assists: row.assists == null ? null : row.assists,
    penalties: row.penalties == null ? null : row.penalties
  };
}

function followedMatch(m) {
  if (!FOLLOW_TEAMS.length) return false;
  var h = String(m.home || '').toLowerCase();
  var a = String(m.away || '').toLowerCase();
  return FOLLOW_TEAMS.some(function (needle) {
    return h.indexOf(needle) !== -1 || a.indexOf(needle) !== -1;
  });
}

function matchTeams(m) {
  return [m.home, m.away].filter(function (t) { return t && t !== 'TBD'; });
}

function matchPoints(m, team) {
  if (!m.score || m.score.home == null || m.score.away == null) return 0;
  var isHome = m.home === team;
  var gf = isHome ? m.score.home : m.score.away;
  var ga = isHome ? m.score.away : m.score.home;
  if (gf > ga) return 3;
  if (gf === ga) return 1;
  return 0;
}

function matchGoalDiff(m, team) {
  if (!m.score || m.score.home == null || m.score.away == null) return 0;
  return m.home === team ? m.score.home - m.score.away : m.score.away - m.score.home;
}

function matchGoalsFor(m, team) {
  if (!m.score || m.score.home == null || m.score.away == null) return 0;
  return m.home === team ? m.score.home : m.score.away;
}

function matchGoalsAgainst(m, team) {
  if (!m.score || m.score.home == null || m.score.away == null) return 0;
  return m.home === team ? m.score.away : m.score.home;
}

function pct(n, d) {
  return d ? Math.round((n / d) * 100) : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function teamKey(s) {
  return String(s || '').toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function ageYears(dob, asOf) {
  if (!dob) return null;
  var d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  return (asOf.getTime() - d.getTime()) / 31557600000;
}

function buildSquadProfiles(teams, asOf) {
  asOf = asOf || new Date();
  return (teams || []).map(function (team) {
    var squad = team.squad || [];
    var positions = { Goalkeeper: 0, Defence: 0, Midfield: 0, Offence: 0, Other: 0 };
    var ages = [];
    squad.forEach(function (p) {
      var pos = p.position && positions[p.position] != null ? p.position : 'Other';
      positions[pos]++;
      var age = ageYears(p.dateOfBirth, asOf);
      if (age != null) ages.push(age);
    });
    var n = squad.length || 0;
    var avgAge = ages.length ? ages.reduce(function (a, b) { return a + b; }, 0) / ages.length : null;
    var prime = ages.filter(function (a) { return a >= 24 && a <= 30; }).length;
    var young = ages.filter(function (a) { return a < 23; }).length;
    var veteran = ages.filter(function (a) { return a >= 32; }).length;
    var depthScore = clamp((n / 26) * 100, 0, 100);
    var balanceScore = (
      clamp((positions.Goalkeeper / 2) * 100, 0, 100) +
      clamp((positions.Defence / 6) * 100, 0, 100) +
      clamp((positions.Midfield / 6) * 100, 0, 100) +
      clamp((positions.Offence / 4) * 100, 0, 100)
    ) / 4;
    var primeScore = n ? (prime / n) * 100 : 0;
    var ageScore = avgAge == null ? 50 : clamp(100 - Math.abs(avgAge - 27.5) * 9, 35, 100);
    var volatilityPenalty = n ? ((young / n) * 10 + (veteran / n) * 8) : 0;
    var score = Math.round(depthScore * 0.20 + balanceScore * 0.25 + primeScore * 0.25 + ageScore * 0.30 - volatilityPenalty);
    score = clamp(score, 0, 100);
    var label = score >= 72 ? 'DEEP' : (score >= 60 ? 'BALANCED' : (score >= 48 ? 'THIN SPOTS' : 'UNPROVEN'));
    return {
      team: teamName(team),
      score: score,
      label: label,
      squadSize: n,
      avgAge: avgAge == null ? null : round2(avgAge),
      primeShare: n ? round2(prime / n) : null,
      youngShare: n ? round2(young / n) : null,
      veteranShare: n ? round2(veteran / n) : null,
      positions: positions,
      note: label === 'DEEP'
        ? 'Deep, balanced squad profile with a strong prime-age core.'
        : (label === 'BALANCED'
          ? 'Squad profile is balanced enough to support the form read.'
          : 'Squad profile has thinner age or position balance, so form needs confirmation.')
    };
  }).sort(function (a, b) {
    return b.score - a.score || b.squadSize - a.squadSize;
  });
}

function buildTeamMomentum(matches, standings) {
  var finished = matches.filter(function (m) {
    return String(m.status || '').toUpperCase() === 'FINISHED'
      && m.score && m.score.home != null && m.score.away != null;
  });
  var standingByTeam = {};
  (standings || []).forEach(function (s) {
    standingByTeam[s.team] = s;
  });

  var opponents = {};
  finished.forEach(function (m) {
    matchTeams(m).forEach(function (team) {
      var opp = m.home === team ? m.away : m.home;
      if (!opponents[team]) opponents[team] = [];
      opponents[team].push(opp);
    });
  });

  var teams = {};
  finished.forEach(function (m) {
    matchTeams(m).forEach(function (team) {
      if (!teams[team]) teams[team] = [];
      teams[team].push(m);
    });
  });

  function opponentQuality(team) {
    var opps = opponents[team] || [];
    if (!opps.length) return 0;
    var avg = opps.reduce(function (sum, opp) {
      var s = standingByTeam[opp];
      return sum + (s && s.playedGames ? (s.points / s.playedGames) : 1);
    }, 0) / opps.length;
    return round2(avg);
  }

  return Object.keys(teams).map(function (team) {
    var all = teams[team].slice().sort(function (a, b) {
      return String(a.utcDate).localeCompare(String(b.utcDate));
    });
    var recent = all.slice(-5);
    var last3 = all.slice(-3);
    var played = all.length;
    var points = all.reduce(function (sum, m) { return sum + matchPoints(m, team); }, 0);
    var recentPoints = recent.reduce(function (sum, m) { return sum + matchPoints(m, team); }, 0);
    var recentMax = recent.length * 3;
    var gf = all.reduce(function (sum, m) { return sum + matchGoalsFor(m, team); }, 0);
    var ga = all.reduce(function (sum, m) { return sum + matchGoalsAgainst(m, team); }, 0);
    var gd = gf - ga;
    var gdTrend = last3.reduce(function (sum, m) { return sum + matchGoalDiff(m, team); }, 0);
    var cleanSheets = all.filter(function (m) { return matchGoalsAgainst(m, team) === 0; }).length;
    var oppQ = opponentQuality(team);
    var attackRate = played ? gf / played : 0;
    var defenseRate = played ? ga / played : 0;
    var formScore = recentMax ? pct(recentPoints, recentMax) : 0;
    var gdScore = clamp(50 + gdTrend * 10, 0, 100);
    var attackScore = clamp(attackRate * 32, 0, 100);
    var defenseScore = clamp(100 - defenseRate * 34, 0, 100);
    var oppScore = clamp(oppQ * 34, 0, 100);
    var score = Math.round(formScore * 0.34 + gdScore * 0.22 + attackScore * 0.18 + defenseScore * 0.16 + oppScore * 0.10);
    var label = score >= 72 ? 'RISING' : (score >= 58 ? 'WATCH' : (score <= 38 ? 'FADING' : 'STEADY'));
    return {
      team: team,
      score: score,
      label: label,
      played: played,
      points: points,
      pointsPerMatch: round2(played ? points / played : 0),
      recentForm: recent.map(function (m) {
        var p = matchPoints(m, team);
        return p === 3 ? 'W' : (p === 1 ? 'D' : 'L');
      }).join(''),
      recentPoints: recentPoints,
      recentMatches: recent.length,
      goalsFor: gf,
      goalsAgainst: ga,
      goalDifference: gd,
      goalDiffTrend: gdTrend,
      attackRate: round2(attackRate),
      defenseRate: round2(defenseRate),
      cleanSheetRate: pct(cleanSheets, played),
      opponentQuality: oppQ,
      note: label === 'RISING'
        ? 'Form, scoring and recent goal difference are moving in the right direction.'
        : (label === 'FADING'
          ? 'Recent results or goal trend are weakening relative to the field.'
          : 'Needs one more positive result to confirm the move.')
    };
  }).sort(function (a, b) {
    return b.score - a.score || b.goalDiffTrend - a.goalDiffTrend || b.pointsPerMatch - a.pointsPerMatch;
  });
}

// World Football Elo (eloratings.net) → 0-100. Elo ~1400-2150 across this field.
function eloScore(elo) {
  if (elo == null) return null;
  return clamp(Math.round((elo - 1400) * 100 / 750), 0, 100);
}
// Projection power. Elo is the strength anchor (the real, slowly-moving team
// rating); momentum form is the secondary nudge. Squad shape was dropped from the
// blend (it scored roster age/balance, not quality — it ranked Sweden #1). Elo-only
// when a team has not played yet (fixes the cold start); momentum-only if Elo is
// unavailable (e.g. fetch failed, or in the point-in-time journal which passes none).
function sportsProjectionPower(t, squad, elo) {
  var es = eloScore(elo);
  var mom = null;
  if (t) {
    var score = Number(t.score || 0);
    var ppm = t.pointsPerMatch == null ? 1 : Number(t.pointsPerMatch);
    var gdTrend = Number(t.goalDiffTrend || 0);
    var attack = t.attackRate == null ? 1 : Number(t.attackRate);
    var defense = t.defenseRate == null ? 1 : Number(t.defenseRate);
    var form = clamp((ppm / 3) * 100, 0, 100);
    var gd = clamp(50 + gdTrend * 8, 0, 100);
    var attackScore = clamp(attack * 30, 0, 100);
    var defenseScore = clamp(100 - defense * 30, 0, 100);
    mom = score * 0.46 + form * 0.22 + gd * 0.16 + attackScore * 0.09 + defenseScore * 0.07;
  }
  if (es == null && mom == null) return null;
  if (es == null) return Math.round(mom);
  if (mom == null) return Math.round(es);
  return Math.round(es * 0.6 + mom * 0.4);
}

// Convert the power gap into win/draw/loss probabilities. Logistic on the gap
// for the win split, plus a draw band that peaks (~27%, football's base rate)
// when teams are even and fades as the gap widens. Neutral-venue tournament, so
// there is deliberately no home-advantage term.
function projectionProbabilities(hp, ap) {
  var diff = hp - ap;
  // k=0.035 keeps a single knockout match realistic: even a ~50-point power gap
  // tops out near ~85% (not 98%). Steeper k looked confident but got punished by
  // log-loss on the inevitable upsets. Draw band ~30pt wide.
  var pHomeCore = 1 / (1 + Math.exp(-0.035 * diff));
  var pDraw = 0.27 * Math.exp(-Math.pow(diff / 30, 2));
  var r3 = function (x) { return Math.round(x * 1000) / 1000; };
  return { home: r3((1 - pDraw) * pHomeCore), draw: r3(pDraw), away: r3((1 - pDraw) * (1 - pHomeCore)) };
}
function projectionFromMomentum(m, momentumMap, squadMap, eloByKey) {
  if (!m || !m.home || !m.away || !momentumMap) return null;
  var home = momentumMap[teamKey(m.home)];
  var away = momentumMap[teamKey(m.away)];
  var homeSquad = squadMap ? squadMap[teamKey(m.home)] : null;
  var awaySquad = squadMap ? squadMap[teamKey(m.away)] : null;
  var homeElo = eloByKey ? eloByKey[teamKey(m.home)] : null;
  var awayElo = eloByKey ? eloByKey[teamKey(m.away)] : null;
  if (!home && !away && !homeSquad && !awaySquad && homeElo == null && awayElo == null) return null;
  var hp = sportsProjectionPower(home, homeSquad, homeElo);
  var ap = sportsProjectionPower(away, awaySquad, awayElo);
  if (hp == null && ap == null) return null;
  if (hp == null) hp = 48;
  if (ap == null) ap = 48;
  var gap = hp - ap;
  var abs = Math.abs(gap);
  var favorite = abs < 4 ? null : (gap > 0 ? m.home : m.away);
  var tag = abs < 4 ? 'Toss-up' : (abs < 12 ? 'Watch only' : (abs < 22 ? 'Moderate edge' : 'Strong edge'));
  return {
    favorite: favorite,
    tag: tag,
    gap: gap,
    homePower: hp,
    awayPower: ap,
    probs: projectionProbabilities(hp, ap),
    homeElo: homeElo == null ? null : homeElo,
    awayElo: awayElo == null ? null : awayElo,
    homeSquad: homeSquad ? homeSquad.score : null,
    awaySquad: awaySquad ? awaySquad.score : null
  };
}

function matchWinner(m) {
  if (!m.score || m.score.home == null || m.score.away == null) return null;
  if (m.score.home > m.score.away) return m.home;
  if (m.score.away > m.score.home) return m.away;
  return 'Draw';
}

function buildProjectionJournal(matches, squadProfiles) {
  var finished = matches.filter(function (m) {
    return String(m.status || '').toUpperCase() === 'FINISHED'
      && m.score && m.score.home != null && m.score.away != null;
  }).sort(function (a, b) {
    return String(a.utcDate).localeCompare(String(b.utcDate));
  });
  var rows = [];
  var projected = 0, aligned = 0, missed = 0, tossUps = 0, tossUpDraws = 0;
  var decisive = 0, decisiveAligned = 0, decisiveMissed = 0, watchOnly = 0, watchOnlyAligned = 0;
  var probRows = [], outcomeCounts = [0, 0, 0];   // for Brier / log-loss vs a base-rate baseline
  var squadMap = {};
  (squadProfiles || []).forEach(function (s) { squadMap[teamKey(s.team)] = s; });
  var byTag = {};
  function bucket(tag) {
    if (!byTag[tag]) byTag[tag] = { tag: tag, evaluated: 0, aligned: 0, misses: 0 };
    return byTag[tag];
  }
  finished.forEach(function (m, idx) {
    var prior = finished.slice(0, idx);
    if (!prior.length) return;
    var momentum = buildTeamMomentum(prior, []);
    var byTeam = {};
    momentum.forEach(function (t) { byTeam[teamKey(t.team)] = t; });
    var p = projectionFromMomentum(m, byTeam, squadMap);
    var actual = matchWinner(m);
    if (!p || !actual) return;
    if (p.probs) {
      var oi = actual === 'Draw' ? 1 : (actual === m.home ? 0 : 2);
      probRows.push({ p: [p.probs.home, p.probs.draw, p.probs.away], oi: oi });
      outcomeCounts[oi]++;
    }
    var didAlign = false;
    var b = bucket(p.tag);
    b.evaluated++;
    if (!p.favorite) {
      tossUps++;
      didAlign = actual === 'Draw';
      if (didAlign) tossUpDraws++;
    } else {
      projected++;
      didAlign = p.favorite === actual;
      if (didAlign) aligned++;
      else missed++;
      if (p.tag === 'Strong edge' || p.tag === 'Moderate edge') {
        decisive++;
        if (didAlign) decisiveAligned++;
        else decisiveMissed++;
      } else {
        watchOnly++;
        if (didAlign) watchOnlyAligned++;
      }
    }
    if (didAlign) b.aligned++;
    else b.misses++;
    rows.push({
      date: m.utcDate,
      home: m.home,
      away: m.away,
      score: String(m.score.home) + '-' + String(m.score.away),
      projected: p.favorite || 'Toss-up',
      result: actual,
      tag: p.tag,
      gap: p.gap,
      aligned: didAlign
    });
  });
  var evaluated = projected + tossUps;
  // Probabilistic scoring: multi-class Brier + log-loss vs a base-rate (climatology)
  // baseline computed from the evaluated set's own outcome frequencies. Beating the
  // baseline means the per-match probabilities add information beyond "average match".
  var nb = probRows.length;
  var brier = null, logLoss = null, baselineBrier = null, baselineLogLoss = null, brierSkill = null;
  if (nb) {
    var base = [outcomeCounts[0] / nb, outcomeCounts[1] / nb, outcomeCounts[2] / nb];
    var bs = 0, ls = 0, bbs = 0, bls = 0;
    probRows.forEach(function (e) {
      for (var i = 0; i < 3; i++) { var y = e.oi === i ? 1 : 0; bs += Math.pow(e.p[i] - y, 2); bbs += Math.pow(base[i] - y, 2); }
      ls += -Math.log(Math.max(1e-9, e.p[e.oi]));
      bls += -Math.log(Math.max(1e-9, base[e.oi]));
    });
    brier = round2(bs / nb); logLoss = round2(ls / nb);
    baselineBrier = round2(bbs / nb); baselineLogLoss = round2(bls / nb);
    brierSkill = bbs > 0 ? round2((bbs - bs) / bbs) : null;
  }
  var accuracyRates = ['Strong edge', 'Moderate edge', 'Watch only', 'Toss-up'].map(function (tag) {
    var b = byTag[tag] || { tag: tag, evaluated: 0, aligned: 0, misses: 0 };
    return {
      tag: tag,
      evaluated: b.evaluated,
      aligned: b.aligned,
      misses: b.misses,
      accuracy: b.evaluated ? round2(b.aligned / b.evaluated) : null,
      metric: tag === 'Toss-up' ? 'draw rate' : 'favorite alignment'
    };
  }).filter(function (r) { return r.evaluated > 0; });
  return {
    evaluated: evaluated,
    projected: projected,
    aligned: aligned,
    missed: missed,
    decisive: decisive,
    decisiveAligned: decisiveAligned,
    decisiveMissed: decisiveMissed,
    watchOnly: watchOnly,
    watchOnlyAligned: watchOnlyAligned,
    tossUps: tossUps,
    tossUpDraws: tossUpDraws,
    accuracy: projected ? round2(aligned / projected) : null,
    decisiveAccuracy: decisive ? round2(decisiveAligned / decisive) : null,
    watchOnlyAccuracy: watchOnly ? round2(watchOnlyAligned / watchOnly) : null,
    coverage: evaluated ? round2(projected / evaluated) : null,
    probScored: nb,
    brier: brier,
    logLoss: logLoss,
    baselineBrier: baselineBrier,
    baselineLogLoss: baselineLogLoss,
    brierSkill: brierSkill,
    accuracyRates: accuracyRates,
    note: 'Point-in-time audit of the FORM model (match form uses only results before kickoff). Live fixture projections additionally blend current World-Football-Elo strength — not shown here because dated Elo snapshots are not freely available, so injecting today\'s Elo would leak hindsight into a backtest of past matches.',
    recent: rows.slice(-8).reverse()
  };
}

// World Cup team name -> eloratings.net 2-letter code. Mostly ISO alpha-2; the
// football exceptions are England (EN) and Scotland (SQ — NOT SC, which is
// Seychelles). Verified against eloratings.net/World.tsv for this 48-team field.
var TEAM_ELO_CODE = {
  'Algeria': 'DZ', 'Argentina': 'AR', 'Australia': 'AU', 'Austria': 'AT', 'Belgium': 'BE',
  'Bosnia-H.': 'BA', 'Brazil': 'BR', 'Canada': 'CA', 'Cape Verde': 'CV', 'Colombia': 'CO',
  'Congo DR': 'CD', 'Croatia': 'HR', 'Curaçao': 'CW', 'Czechia': 'CZ', 'Ecuador': 'EC',
  'Egypt': 'EG', 'England': 'EN', 'France': 'FR', 'Germany': 'DE', 'Ghana': 'GH',
  'Haiti': 'HT', 'Iran': 'IR', 'Iraq': 'IQ', 'Ivory Coast': 'CI', 'Japan': 'JP',
  'Jordan': 'JO', 'Korea Republic': 'KR', 'Mexico': 'MX', 'Morocco': 'MA', 'Netherlands': 'NL',
  'New Zealand': 'NZ', 'Norway': 'NO', 'Panama': 'PA', 'Paraguay': 'PY', 'Portugal': 'PT',
  'Qatar': 'QA', 'Saudi Arabia': 'SA', 'Scotland': 'SQ', 'Senegal': 'SN', 'South Africa': 'ZA',
  'Spain': 'ES', 'Sweden': 'SE', 'Switzerland': 'CH', 'Tunisia': 'TN', 'Turkey': 'TR',
  'USA': 'US', 'Uruguay': 'UY', 'Uzbekistan': 'UZ'
};

// World Football Elo from eloratings.net — a thin SPA over public TSV (no key, no
// rate limit). World.tsv columns: rank | rank | 2-letter code | Elo | … Returns a
// { code: elo } map, or null on failure (projection then falls back to momentum).
async function fetchEloRatings() {
  try {
    var res = await fetchRetry('https://www.eloratings.net/World.tsv', { headers: { 'User-Agent': 'Mozilla/5.0' } }, 'eloratings World.tsv');
    if (!res || !res.ok) { console.warn('Elo fetch HTTP ' + (res && res.status)); return null; }
    var txt = await res.text();
    var map = {};
    txt.split(/\r?\n/).forEach(function (line) {
      var c = line.split('\t');
      if (c.length > 3 && /^[A-Z]{2}$/.test(c[2])) { var e = Number(c[3]); if (!isNaN(e)) map[c[2]] = e; }
    });
    return Object.keys(map).length ? map : null;
  } catch (e) { console.warn('Elo fetch failed:', e.message || e); return null; }
}

// Index a stored match list by id, keeping only the ones that were FINISHED with
// a real score. Used to defend against provider regressions on the next fetch.
function extractFinished(matches) {
  var map = {};
  (matches || []).forEach(function (m) {
    var st = String(m.status || '').toUpperCase();
    if ((st === 'FINISHED' || st === 'AWARDED') && m.score && m.score.home != null && m.score.away != null) {
      map[String(m.id)] = m;
    }
  });
  return map;
}

// No-regress guard. football-data.org intermittently serves a STALE snapshot of
// the matches endpoint where an already-FINISHED match reverts to TIMED/0-0 (or
// drops out entirely). Writing that blindly clobbers a good final result and
// silently removes it from momentum/standings/recent — which is exactly what
// blanked the Ecuador 2-1 Germany result. So: if we hold a previously-FINISHED
// result for a match and the fresh fetch is NOT finished-with-score, keep the
// stored result; and re-add any finished match the fetch dropped. Mirrors the PH
// writePhSnapshot no-regress pattern. Mutates + returns `matches`.
function mergeNoRegress(matches, prevFinished) {
  if (!prevFinished || !Object.keys(prevFinished).length) return matches;
  var present = {};
  matches.forEach(function (m) { present[String(m.id)] = true; });
  var restored = [], readded = [];
  matches.forEach(function (m) {
    var prev = prevFinished[String(m.id)];
    if (!prev) return;
    var st = String(m.status || '').toUpperCase();
    var hasScore = m.score && m.score.home != null && m.score.away != null;
    if (!((st === 'FINISHED' || st === 'AWARDED') && hasScore)) {
      m.status = prev.status;
      m.score = { home: prev.score.home, away: prev.score.away };
      restored.push(prev.home + ' ' + prev.score.home + '-' + prev.score.away + ' ' + prev.away);
    }
  });
  Object.keys(prevFinished).forEach(function (id) {
    if (!present[id]) { matches.push(prevFinished[id]); readded.push(prevFinished[id].home + ' vs ' + prevFinished[id].away); }
  });
  if (restored.length) console.warn('NO-REGRESS: provider reverted ' + restored.length +
    ' already-final match(es); kept stored result: ' + restored.join('; '));
  if (readded.length) console.warn('NO-REGRESS: provider dropped ' + readded.length +
    ' finished match(es); re-added: ' + readded.join('; '));
  return matches;
}

async function fetchWorldCup(prevFinished) {
  var query = '?season=2026';
  var matchesJson = await footballData('/competitions/WC/matches' + query);
  var standingsJson = null;
  var scorersJson = null;
  var teamsJson = null;
  try { standingsJson = await footballData('/competitions/WC/standings' + query); }
  catch (e) { console.warn('Standings skipped:', e.message); }
  try { scorersJson = await footballData('/competitions/WC/scorers' + query + '&limit=20'); }
  catch (e) { console.warn('Scorers skipped:', e.message); }
  try { teamsJson = await footballData('/competitions/WC/teams' + query); }
  catch (e) { console.warn('Teams/squads skipped:', e.message); }

  var matches = (matchesJson.matches || []).map(normMatch);
  matches = mergeNoRegress(matches, prevFinished);   // refuse a stale provider regression
  matches.sort(function (a, b) {
    return String(a.utcDate).localeCompare(String(b.utcDate));
  });
  var now = phtToday().getTime();
  var upcoming = matches.filter(function (m) {
    return String(m.status).toUpperCase() !== 'FINISHED' && new Date(m.utcDate).getTime() >= now - 3 * 3600000;
  }).slice(0, 12);
  var recent = matches.filter(function (m) {
    return String(m.status).toUpperCase() === 'FINISHED';
  }).sort(function (a, b) {
    return String(b.utcDate).localeCompare(String(a.utcDate));
  }).slice(0, 8);
  // Surface provider lag on every run: matches that kicked off >2.5h ago but the
  // feed has not marked FINISHED. These are excluded from momentum/recent until
  // the provider posts the result (free tier has no live feed → results lag).
  var pendingResults = matches.filter(function (m) {
    var st = String(m.status).toUpperCase();
    if (st === 'FINISHED' || st === 'AWARDED' || st === 'IN_PLAY' || st === 'PAUSED' ||
        st === 'CANCELLED' || st === 'POSTPONED' || st === 'SUSPENDED') return false;
    var t = new Date(m.utcDate).getTime();
    return !isNaN(t) && t < now - 2.5 * 3600000;
  });
  if (pendingResults.length) {
    console.warn('NOTE: ' + pendingResults.length + ' match(es) kicked off >2.5h ago but the provider ' +
      'has not posted a result yet (free-tier lag); excluded from momentum until FINISHED:');
    pendingResults.forEach(function (m) {
      console.warn('  - ' + m.home + ' vs ' + m.away + ' (' + m.utcDate + ', status ' + m.status + ')');
    });
  }
  var standings = [];
  (standingsJson && standingsJson.standings || []).forEach(function (g) {
    (g.table || []).forEach(function (row) {
      standings.push(normStanding(Object.assign({ group: g.group || '' }, row)));
    });
  });
  var scorers = (scorersJson && scorersJson.scorers || []).map(normScorer);
  var squadProfiles = buildSquadProfiles((teamsJson && teamsJson.teams) || [], new Date());
  var momentum = buildTeamMomentum(matches, standings);
  var eloRaw = await fetchEloRatings();
  var eloByKey = {};
  if (eloRaw) Object.keys(TEAM_ELO_CODE).forEach(function (name) {
    var c = TEAM_ELO_CODE[name];
    if (eloRaw[c] != null) eloByKey[teamKey(name)] = eloRaw[c];
  });
  // Strength-aware power per team — the SAME 0.6·Elo + 0.4·form blend the fixture
  // projections use. The Market Lens compares this against market-implied shares.
  // Pure form-momentum compresses every team into ~65-89 after the group stage, so
  // a 2-win minnow shows an absurd title share and a single loss barely moves it;
  // anchoring on Elo makes the model share reflect real strength and a loss move it.
  momentum.forEach(function (t) {
    var elo = eloByKey[teamKey(t.team)];
    t.elo = (elo == null ? null : elo);
    t.power = sportsProjectionPower(t, null, elo); // falls back to form-only if Elo missing
  });
  // Journal stays Elo-free: today's Elo already reflects the matches it would be
  // "predicting", so injecting it into the point-in-time backtest would leak
  // hindsight. The audit measures the form model; live fixtures add the Elo prior.
  var projectionJournal = buildProjectionJournal(matches, squadProfiles);
  projectionJournal.eloInformed = Object.keys(eloByKey).length > 0;
  // Attach a stored, Elo-informed projection to each upcoming fixture — the front
  // end just renders it (single source of truth, no client-side recompute). Elo on
  // an UPCOMING match is not lookahead: the match has not been played.
  var momByTeam = {}; momentum.forEach(function (t) { momByTeam[teamKey(t.team)] = t; });
  var sqByTeam = {}; squadProfiles.forEach(function (s) { sqByTeam[teamKey(s.team)] = s; });
  upcoming.forEach(function (m) { m.projection = projectionFromMomentum(m, momByTeam, sqByTeam, eloByKey); });

  return {
    name: matchesJson.competition && matchesJson.competition.name || 'FIFA World Cup',
    season: matchesJson.filters && matchesJson.filters.season ? String(matchesJson.filters.season) : '2026',
    provider: 'football-data.org',
    providerNote: 'World Cup data from football-data.org. Coverage depends on your API plan and competition availability.',
    matches: matches,
    upcoming: upcoming,
    recent: recent,
    watchlist: matches.filter(followedMatch).slice(0, 10),
    standings: standings,
    scorers: scorers,
    squadProfiles: squadProfiles,
    momentum: momentum,
    projectionJournal: projectionJournal,
    risingTeams: momentum.filter(function (t) { return t.label === 'RISING'; }).slice(0, 6),
    watchTeams: momentum.filter(function (t) { return t.label === 'WATCH'; }).slice(0, 6),
    fadingTeams: momentum.filter(function (t) { return t.label === 'FADING'; }).slice(0, 6)
  };
}

function setupDoc(reason) {
  return {
    generatedAt: new Date().toISOString(),
    asOf: phtDateKey(),
    title: 'Sports briefing setup',
    sports: activeSportsList(),
    modules: buildForwardModules(reason),
    worldCup: {
      name: 'FIFA World Cup',
      season: '2026',
      provider: 'football-data.org',
      providerNote: reason + ' Add FOOTBALL_DATA_TOKEN to sports/.env, then run node sports/refresh-sports.js.',
      matches: [],
      upcoming: [],
      recent: [],
      watchlist: [],
      standings: [],
      scorers: [],
      squadProfiles: [],
      momentum: [],
      projectionJournal: {
        evaluated: 0,
        projected: 0,
        aligned: 0,
        missed: 0,
        decisive: 0,
        decisiveAligned: 0,
        decisiveMissed: 0,
        watchOnly: 0,
        watchOnlyAligned: 0,
        tossUps: 0,
        tossUpDraws: 0,
        accuracy: null,
        decisiveAccuracy: null,
        watchOnlyAccuracy: null,
        coverage: null,
        accuracyRates: [],
        note: 'Point-in-time audit starts after completed matches exist.',
        recent: []
      },
      risingTeams: [],
      watchTeams: [],
      fadingTeams: []
    }
  };
}

function activeSportsList() {
  var out = [];
  if (wantsModule('nba')) out.push('nba');
  if (wantsModule('pvl')) out.push('pvl');
  if (wantsModule('tennis')) out.push('tennis');
  if (wantsModule('worldcup')) out.push('worldcup');
  if (!out.length || wantsModule('all')) out = ['nba', 'pvl', 'tennis', 'worldcup'];
  return out;
}

function emptyModule(kind, title, phase, provider, note) {
  var attemptedAt = new Date().toISOString();
  return {
    enabled: true,
    kind: kind,
    title: title,
    phase: phase,
    provider: provider,
    providerNote: note,
    upcoming: [],
    recent: [],
    standings: [],
    momentum: [],
    watchlist: [],
    keyDates: [],
    generatedAt: attemptedAt,
    refreshAttemptedAt: attemptedAt,
    lastSuccessfulAt: '',
    refreshStatus: 'error',
    fallback: false,
    staleAfterHours: kind === 'pvl' ? 36 : 168
  };
}

function buildNbaModule() {
  var m = emptyModule(
    'nba',
    'NBA Momentum Radar',
    'feed unavailable',
    'ESPN basketball feed',
    'NBA data is temporarily unavailable. The refresh job will keep the last good snapshot when one exists.'
  );
  m.watchlist = NBA_FOLLOW_TEAMS.map(function (team) {
    return { team: team, note: 'Pinned for the NBA watchlist.' };
  });
  return m;
}

function nbaModulePhase(now, upcoming) {
  var next = (upcoming || [])[0];
  if (next && next.stage === 'post-season') return 'playoffs';
  if (next && next.stage === 'preseason') return 'preseason';
  if (next) return 'regular season';
  var month = now.getUTCMonth();
  return month >= 5 && month <= 8 ? 'offseason' : 'schedule pending';
}

function nbaWatchlist(standings, momentum) {
  return NBA_FOLLOW_TEAMS.map(function (needle) {
    var key = teamKey(needle);
    var standing = (standings || []).find(function (s) { return teamKey(s.team).indexOf(key) !== -1; });
    var team = standing ? standing.team : needle;
    var form = (momentum || []).find(function (m) { return m.team === team; });
    var details = [];
    if (standing) details.push(standing.wins + '-' + standing.losses + ' ' + standing.conference);
    if (form && form.recentForm) details.push('last ' + form.recentGames + ': ' + form.recentForm);
    return { team: team, note: details.join(' / ') || 'Pinned for the NBA watchlist.' };
  });
}

async function fetchNbaModule() {
  var now = new Date();
  var offseason = now.getUTCMonth() >= 5 && now.getUTCMonth() <= 8;
  var start = dateKeyUtc(shiftedDate(now, offseason ? -150 : -45));
  var end = dateKeyUtc(shiftedDate(now, offseason ? 120 : 30));
  var seasonYear = nbaSeasonYear(now);
  var payloads = await Promise.all([
    espnNba('/site/v2/sports/basketball/nba/scoreboard?dates=' + start + '-' + end + '&limit=1000'),
    espnNba('/v2/sports/basketball/nba/standings?season=' + seasonYear),
    espnNba('/site/v2/sports/basketball/nba/injuries').catch(function (e) {
      console.warn('NBA injuries unavailable:', e.message || e);
      return null;
    })
  ]);
  var events = (payloads[0] && payloads[0].events) || [];
  var standings = normNbaStandings(payloads[1]);
  if (!standings.length && seasonYear > now.getUTCFullYear()) {
    standings = normNbaStandings(await espnNba('/v2/sports/basketball/nba/standings?season=' + (seasonYear - 1)));
    seasonYear--;
  }
  var matches = addNbaRestSignals(events.map(normNbaGame).filter(function (m) { return m.id && m.utcDate; }));
  var upcoming = matches.filter(function (m) { return m.status !== 'FINISHED'; }).slice(0, 20);
  var recent = matches.filter(function (m) { return m.status === 'FINISHED'; }).slice(-20).reverse();
  var momentum = buildNbaMomentum(matches, standings);
  var injuries = normNbaInjuries(payloads[2]).slice(0, 60);
  var playerWatch = normNbaPlayerWatch(events, NBA_FOLLOW_PLAYERS);
  var bracket = buildNbaBracket(matches);
  var teamProfiles = buildTeamProfiles('nba', standings, momentum, matches, injuries);
  var keyDates = [];
  if (upcoming[0]) {
    keyDates.push({
      date: String(upcoming[0].utcDate).slice(0, 10),
      label: 'Next NBA game',
      note: upcoming[0].away + ' at ' + upcoming[0].home
    });
  }
  if (recent[0]) {
    keyDates.push({
      date: String(recent[0].utcDate).slice(0, 10),
      label: 'Latest NBA result',
      note: recent[0].away + ' ' + recent[0].score.away + ', ' + recent[0].home + ' ' + recent[0].score.home
    });
  }
  if (!upcoming.length) {
    keyDates.push({
      date: phtDateKey(),
      label: 'Schedule monitor',
      note: 'No future NBA fixture is published in the current provider window yet.'
    });
  }
  var generatedAt = new Date().toISOString();
  return {
    enabled: true,
    kind: 'nba',
    title: 'NBA Momentum Radar',
    phase: nbaModulePhase(now, upcoming),
    provider: 'ESPN basketball feed',
    providerNote: 'NBA schedule, results, standings, game leaders and availability are refreshed from ESPN\'s public basketball feed. Momentum uses each team\'s latest five completed games in the rolling window.',
    season: String(seasonYear - 1) + '-' + String(seasonYear).slice(-2),
    asOf: phtDateKey(),
    generatedAt: generatedAt,
    refreshAttemptedAt: generatedAt,
    lastSuccessfulAt: generatedAt,
    refreshStatus: 'ok',
    fallback: false,
    staleAfterHours: upcoming.length ? 36 : 168,
    matches: matches,
    upcoming: upcoming,
    recent: recent,
    standings: standings,
    momentum: momentum,
    injuries: injuries,
    availabilityStatus: payloads[2] ? 'ok' : 'unavailable',
    playerWatch: playerWatch,
    followedPlayers: NBA_FOLLOW_PLAYERS,
    bracket: bracket,
    teamProfiles: teamProfiles,
    watchlist: nbaWatchlist(standings, momentum),
    keyDates: keyDates
  };
}

function buildPvlModule() {
  var m = emptyModule(
    'pvl',
    'PH Local Pulse: PVL',
    'feed unavailable',
    'official pvl.ph pages',
    'PVL data is temporarily unavailable. The refresh job will keep the last good snapshot when one exists.'
  );
  m.watchlist = PVL_FOLLOW_TEAMS.map(function (team) {
    return { team: team, note: 'Pinned for PH Local Pulse.' };
  });
  return m;
}

function pvlWatchlist(standings, momentum) {
  return PVL_FOLLOW_TEAMS.map(function (needle) {
    var key = teamKey(needle);
    var standing = (standings || []).find(function (s) { return teamKey(s.team).indexOf(key) !== -1; });
    var team = standing ? standing.team : needle;
    var form = (momentum || []).find(function (m) { return m.team === team; });
    var details = [];
    if (standing) details.push(standing.wins + '-' + standing.losses + ', ' + standing.points + ' pts');
    if (form && form.recentForm) details.push('recent: ' + form.recentForm);
    return { team: team, note: details.join(' / ') || 'Pinned for PH Local Pulse.' };
  });
}

async function fetchPvlModule() {
  var now = new Date();
  var fetched = await Promise.all([
    Promise.all([
      pvlFetch('/schedule'),
      pvlFetch('/'),
      pvlFetch('/standings')
    ]),
    Promise.allSettled(PVL_LEADER_CATEGORIES.map(function (category) {
      return pvlFetch('/leaders/' + category);
    }))
  ]);
  var pages = fetched[0];
  var upcoming = parsePvlSchedule(pages[0], now).filter(function (m) {
    return new Date(m.utcDate).getTime() >= now.getTime() - 21600000;
  }).slice(0, 20);
  var parsedRecent = parsePvlRecaps(pages[1], now);
  var latestRecentMs = parsedRecent.length ? new Date(parsedRecent[0].utcDate).getTime() : 0;
  var recent = parsedRecent.filter(function (m) {
    return !latestRecentMs || latestRecentMs - new Date(m.utcDate).getTime() <= 45 * 86400000;
  }).slice(0, 20);
  var standings = parsePvlStandings(pages[2]);
  if (!upcoming.length && !recent.length) throw new Error('PVL schedule and recap pages returned no matches.');
  if (!standings.length) throw new Error('PVL standings page returned no table rows.');
  var momentum = buildPvlMomentum(recent, standings);
  var leaderCategories = fetched[1].map(function (result, idx) {
    if (result.status !== 'fulfilled') {
      console.warn('PVL ' + PVL_LEADER_CATEGORIES[idx] + ' leaders unavailable:', result.reason && (result.reason.message || result.reason));
      return null;
    }
    return parsePvlLeaders(result.value, PVL_LEADER_CATEGORIES[idx]);
  }).filter(function (category) { return category && category.leaders.length; });
  var playerLeaders = {
    conference: leaderCategories[0] ? leaderCategories[0].conference : '',
    categories: leaderCategories
  };
  var moduleMatches = recent.slice().reverse().concat(upcoming);
  var bracket = buildPvlBracket(moduleMatches);
  var teamProfiles = buildTeamProfiles('pvl', standings, momentum, moduleMatches, []);
  var keyDates = [];
  if (upcoming[0]) {
    keyDates.push({
      date: upcoming[0].utcDate.slice(0, 10),
      label: 'Next PVL match',
      note: upcoming[0].home + ' vs ' + upcoming[0].away + (upcoming[0].venue ? ' / ' + upcoming[0].venue : '')
    });
  }
  if (recent[0]) {
    keyDates.push({
      date: recent[0].utcDate.slice(0, 10),
      label: 'Latest PVL result',
      note: recent[0].home + ' ' + recent[0].score.home + ', ' + recent[0].away + ' ' + recent[0].score.away
    });
  }
  var generatedAt = new Date().toISOString();
  return {
    enabled: true,
    kind: 'pvl',
    title: 'PH Local Pulse: PVL',
    phase: upcoming.length ? 'active schedule' : 'between fixtures',
    provider: 'official pvl.ph pages',
    providerNote: 'PVL fixtures, recaps, standings and player leaders are refreshed from official pvl.ph pages. Momentum blends recent match wins, set differential and the active standings table.',
    asOf: phtDateKey(),
    generatedAt: generatedAt,
    refreshAttemptedAt: generatedAt,
    lastSuccessfulAt: generatedAt,
    refreshStatus: 'ok',
    fallback: false,
    staleAfterHours: 36,
    matches: moduleMatches,
    upcoming: upcoming,
    recent: recent,
    standings: standings,
    momentum: momentum,
    playerLeaders: playerLeaders,
    bracket: bracket,
    teamProfiles: teamProfiles,
    watchlist: pvlWatchlist(standings, momentum),
    keyDates: keyDates
  };
}

// ── Tennis: Grand Slams + Masters 1000 (ATP + WTA), ESPN public feed ──────────
// A Slam is ONE ESPN event carrying every draw (Men's/Women's Singles + doubles);
// each match has round.{id,displayName}, competitor.winner/seed, and per-set
// linescores. The draw reconstructs into a bracket straight from the feed — no
// hardcoded map, same principle as the FIFA knockout bracket. Singles only.
var TENNIS_SLAMS = [
  { token: 'australian open', surface: 'Hard' },
  { token: 'roland garros', surface: 'Clay' },
  { token: 'french open', surface: 'Clay' },
  { token: 'wimbledon', surface: 'Grass' },
  { token: 'us open', surface: 'Hard' }
];
// ESPN names carry sponsors/cities, so match on distinctive tokens. Slams are
// checked first so Roland Garros never falls through to a "paris" Masters token.
var TENNIS_MASTERS = [
  { token: 'indian wells', surface: 'Hard' },
  { token: 'miami open', surface: 'Hard' },
  { token: 'monte-carlo', surface: 'Clay' },
  { token: 'monte carlo', surface: 'Clay' },
  { token: 'madrid', surface: 'Clay' },
  { token: 'internazionali bnl', surface: 'Clay' },
  { token: 'italian open', surface: 'Clay' },
  { token: 'rome', surface: 'Clay' },
  { token: 'canadian open', surface: 'Hard' },
  { token: 'national bank open', surface: 'Hard' },
  { token: 'rogers cup', surface: 'Hard' },
  { token: 'cincinnati', surface: 'Hard' },
  { token: 'western & southern', surface: 'Hard' },
  { token: 'shanghai', surface: 'Hard' },
  { token: 'paris masters', surface: 'Hard (indoor)' },
  { token: 'rolex paris', surface: 'Hard (indoor)' }
];
// ATP/WTA 500s — the tier below Masters 1000. ESPN gives no level field, so this
// is a curated, deliberately CONSERVATIVE token list: only events that are
// unambiguously 500 across both tours are listed. Names that collide with a
// different level on the other tour (e.g. "China Open" = ATP 500 but WTA 1000;
// bare "Stuttgart" = ATP 250 but WTA 500) are matched by a tour-safe token or
// left out rather than risk a mis-tag. Missing a 500 is safer than promoting a
// 250/1000 into this tier. Extend as needed each season.
var TENNIS_500 = [
  { token: 'rotterdam', surface: 'Hard (indoor)' },
  { token: 'rio open', surface: 'Clay' },
  { token: 'acapulco', surface: 'Hard' },
  { token: 'barcelona', surface: 'Clay' },
  { token: 'bmw open', surface: 'Clay' },
  { token: 'queen', surface: 'Grass' },
  { token: 'halle', surface: 'Grass' },
  { token: 'terra wortmann', surface: 'Grass' },
  { token: 'hamburg', surface: 'Clay' },
  { token: 'dc open', surface: 'Hard' },
  { token: 'japan open', surface: 'Hard' },
  { token: 'erste bank', surface: 'Hard (indoor)' },
  { token: 'swiss indoors', surface: 'Hard (indoor)' },
  { token: 'brisbane', surface: 'Hard' },
  { token: 'adelaide', surface: 'Hard' },
  { token: 'porsche', surface: 'Clay (indoor)' },
  { token: 'charleston', surface: 'Clay' },
  { token: 'berlin', surface: 'Grass' },
  { token: 'eastbourne', surface: 'Grass' },
  { token: 'san diego', surface: 'Hard' },
  { token: 'pan pacific', surface: 'Hard' },
  { token: 'toray', surface: 'Hard' },
  { token: 'ningbo', surface: 'Hard' },
  { token: 'abu dhabi', surface: 'Hard' }
];

function classifyTennis(name) {
  var n = String(name || '').toLowerCase();
  for (var i = 0; i < TENNIS_SLAMS.length; i++) {
    if (n.indexOf(TENNIS_SLAMS[i].token) !== -1) return { tier: 'slam', surface: TENNIS_SLAMS[i].surface };
  }
  for (var j = 0; j < TENNIS_MASTERS.length; j++) {
    if (n.indexOf(TENNIS_MASTERS[j].token) !== -1) return { tier: 'masters1000', surface: TENNIS_MASTERS[j].surface };
  }
  for (var k = 0; k < TENNIS_500.length; k++) {
    if (n.indexOf(TENNIS_500[k].token) !== -1) return { tier: 'tour500', surface: TENNIS_500[k].surface };
  }
  return { tier: 'other', surface: '' };
}

async function espnTennis(tour, dates) {
  var url = ESPN_TENNIS + '/' + tour + '/scoreboard?dates=' + dates + '&limit=1000';
  var res = await fetchRetry(url, {
    headers: { 'accept': 'application/json', 'user-agent': 'BobDailyBriefing/1.0' }
  }, 'ESPN tennis ' + tour);
  if (!res.ok) throw new Error('ESPN tennis ' + tour + ' ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return res.json();
}

function tennisMatchStatus(comp) {
  var t = (comp && comp.status && comp.status.type) || {};
  if (t.completed === true || t.state === 'post') return 'FINISHED';
  if (t.state === 'in') return 'LIVE';
  return 'SCHEDULED';
}

function tennisPlayer(competitor) {
  var ath = (competitor && competitor.athlete) || {};
  var name = ath.displayName || ath.shortName || '';
  if (!name) return null; // doubles teams / empty slots carry no athlete — skip
  var sets = (competitor.linescores || []).map(function (ls) {
    return { g: ls.value == null ? null : Math.round(ls.value), tb: ls.tiebreak == null ? null : ls.tiebreak };
  });
  return {
    name: name,
    seed: competitor.seed == null ? null : competitor.seed,
    winner: competitor.winner === true,
    sets: sets
  };
}

function normTennisMatch(comp) {
  var players = (comp.competitors || []).map(tennisPlayer);
  if (players.length !== 2 || !players[0] || !players[1]) return null; // singles only
  var round = comp.round || {};
  return {
    id: comp.id,
    roundId: Number(round.id) || 0,
    round: round.displayName || '',
    status: tennisMatchStatus(comp),
    date: comp.date || comp.startDate || '',
    players: players
  };
}

// Group a singles grouping's matches into rounds, keep the latter stages (bounds
// the Firestore payload — a full 128-draw is ~127 matches per draw), and read the
// champion off the Final.
function buildTennisDraw(comps) {
  // Qualifying rounds live in the same grouping but carry HIGHER round ids than
  // the main Final (e.g. 11/12/14 vs Final=7), so they must be dropped before the
  // bracket/champion is read — otherwise "Qualifying Final" is mistaken for the
  // title match.
  var matches = (comps || []).map(normTennisMatch).filter(Boolean)
    .filter(function (m) { return !/qualif/i.test(m.round); });
  var byRound = {};
  matches.forEach(function (m) {
    if (!byRound[m.roundId]) byRound[m.roundId] = { id: m.roundId, name: m.round, matches: [] };
    byRound[m.roundId].matches.push(m);
  });
  var rounds = Object.keys(byRound).map(function (k) { return byRound[k]; })
    .sort(function (a, b) { return a.id - b.id; });
  var champion = null, runnerUp = null, finalStatus = '';
  var finalRound = rounds.filter(function (r) { return /^final$/i.test(r.name); })[0] || rounds[rounds.length - 1];
  if (finalRound && /final/i.test(finalRound.name) && finalRound.matches.length) {
    var fm = finalRound.matches[0];
    finalStatus = fm.status;
    if (fm.status === 'FINISHED') {
      var w = fm.players.filter(function (p) { return p.winner; })[0];
      var l = fm.players.filter(function (p) { return !p.winner; })[0];
      champion = w ? w.name : null;
      runnerUp = l ? l.name : null;
    }
  }
  return {
    rounds: rounds.slice(-5), // R16 → Final for a slam
    roundsTotal: rounds.length,
    champion: champion,
    runnerUp: runnerUp,
    finalStatus: finalStatus
  };
}

function normTennisEvent(event) {
  var cls = classifyTennis(event && event.name);
  if (cls.tier === 'other') return null; // ignore 250/500-level events
  var groupings = event.groupings || [];
  function drawFor(label) {
    var g = groupings.filter(function (gr) {
      return String((gr.grouping || {}).displayName || '').toLowerCase() === label;
    })[0];
    return g && (g.competitions || []).length ? buildTennisDraw(g.competitions) : null;
  }
  var men = drawFor("men's singles");
  var women = drawFor("women's singles");
  var tour = (men && women) ? 'combined' : (men ? 'ATP' : (women ? 'WTA' : 'combined'));
  return {
    id: event.id,
    name: event.name,
    tier: cls.tier,
    surface: cls.surface,
    tour: tour,
    startDate: event.date || '',
    draws: { men: men, women: women }
  };
}

// Collect classified tournaments across both tours, keyed by event id so a
// combined Slam (both draws in one event) isn't duplicated; merge a WTA-feed
// women's draw into an already-seen event when the id matches.
function collectTennis(atpEvents, wtaEvents) {
  var byId = {}, order = [];
  function add(event) {
    var t = normTennisEvent(event);
    if (!t) return;
    if (byId[t.id]) {
      var ex = byId[t.id];
      if (!ex.draws.men && t.draws.men) ex.draws.men = t.draws.men;
      if (!ex.draws.women && t.draws.women) ex.draws.women = t.draws.women;
      ex.tour = (ex.draws.men && ex.draws.women) ? 'combined' : (ex.draws.men ? 'ATP' : 'WTA');
    } else {
      byId[t.id] = t;
      order.push(t.id);
    }
  }
  (atpEvents || []).forEach(add);
  (wtaEvents || []).forEach(add);
  return order.map(function (id) { return byId[id]; });
}

function tennisTournamentTiming(t) {
  var draws = [t.draws.men, t.draws.women].filter(Boolean);
  var anyLive = false, anyFinal = false, anyScheduled = false, lastDate = '', firstDate = '';
  draws.forEach(function (d) {
    (d.rounds || []).forEach(function (r) {
      r.matches.forEach(function (m) {
        if (m.status === 'LIVE') anyLive = true;
        if (m.status === 'FINISHED') anyFinal = true;
        if (m.status === 'SCHEDULED') anyScheduled = true;
        if (m.date && (!lastDate || m.date > lastDate)) lastDate = m.date;
        if (m.date && (!firstDate || m.date < firstDate)) firstDate = m.date;
      });
    });
  });
  var completed = draws.length > 0 && draws.every(function (d) { return d.finalStatus === 'FINISHED'; });
  var status;
  if (anyLive) status = 'live';                        // a match is in progress
  else if (completed) status = 'completed';            // every draw's final is done
  else if (anyFinal && anyScheduled) status = 'live';  // mid-tournament (some played, some to come)
  else if (anyScheduled && !anyFinal) status = 'upcoming'; // draw posted, nothing played yet
  else if (anyFinal && !anyScheduled) status = 'completed';
  else status = 'upcoming';
  return { status: status, firstDate: firstDate, lastDate: lastDate, completed: completed };
}

function pickTennisTier(tournaments, tier, nowMs) {
  var list = tournaments.filter(function (t) { return t.tier === tier; });
  list.forEach(function (t) {
    var tm = tennisTournamentTiming(t);
    t.lastDate = tm.lastDate || t.startDate;
    t.firstDate = tm.firstDate || t.startDate;
    // No draw posted yet → decide by start date.
    if (!tm.firstDate && t.startDate) {
      t.status = new Date(t.startDate).getTime() > nowMs ? 'upcoming' : tm.status;
    } else {
      t.status = tm.status;
    }
    if (t.status === 'upcoming' && t.startDate) {
      t.countdownDays = Math.max(0, Math.round((new Date(t.startDate).getTime() - nowMs) / 86400000));
    }
  });
  var live = list.filter(function (t) { return t.status === 'live'; });
  var upcoming = list.filter(function (t) { return t.status === 'upcoming'; })
    .sort(function (a, b) { return new Date(a.startDate) - new Date(b.startDate); });
  var completed = list.filter(function (t) { return t.status === 'completed'; })
    .sort(function (a, b) { return new Date(b.lastDate || b.startDate) - new Date(a.lastDate || a.startDate); });
  return {
    current: live[0] || upcoming[0] || null,
    next: upcoming[0] || null,
    recent: completed.slice(0, 2)
  };
}

// ── Projection: per-player win probability from ATP/WTA ranking points ────────
// The tennis analog of the FIFA Elo→logistic model. ESPN publishes current
// rankings with points; we map name→{rank,points} and turn a scheduled match
// into a win probability via a logistic on the LOG-points gap (ranking points
// are roughly log-distributed in skill terms). Capped 15–85% — even lopsided
// tennis matches rarely price beyond that over a single best-of-3/5. A model
// for framing, never advice; only attached to not-yet-finished matches so it is
// never applied with hindsight to a known result.
async function espnTennisRankings(tour) {
  var url = ESPN_TENNIS + '/' + tour + '/rankings';
  var res = await fetchRetry(url, {
    headers: { 'accept': 'application/json', 'user-agent': 'BobDailyBriefing/1.0' }
  }, 'ESPN tennis rankings ' + tour);
  if (!res.ok) throw new Error('ESPN tennis rankings ' + tour + ' ' + res.status);
  return res.json();
}

function tennisRatingMap(json) {
  var map = {};
  var lists = (json && json.rankings) || [];
  // Singles only — skip doubles / race-to-finals lists so their points don't leak in.
  lists.filter(function (l) { return !/doubles|race/i.test(l.name || ''); }).forEach(function (lst) {
    (lst.ranks || []).forEach(function (e) {
      var ath = e.athlete;
      var name = (typeof ath === 'string') ? ath : (ath && ath.displayName);
      if (!name || e.points == null) return;
      if (!map[name] || e.current < map[name].rank) map[name] = { rank: e.current, points: e.points };
    });
  });
  return map;
}

function tennisWinProb(ptsA, ptsB) {
  if (!ptsA || !ptsB) return null;
  var p = 1 / (1 + Math.exp(-0.5 * (Math.log(ptsA) - Math.log(ptsB))));
  return Math.max(0.15, Math.min(0.85, p));
}

function tennisProjTag(edge) {
  var e = Math.abs(edge); // |p − 0.5|
  if (e < 0.06) return 'Toss-up';
  if (e < 0.14) return 'Lean';
  if (e < 0.24) return 'Moderate';
  return 'Strong';
}

function enrichTennisDraw(draw, map) {
  if (!draw || !map) return;
  (draw.rounds || []).forEach(function (r) {
    r.matches.forEach(function (m) {
      (m.players || []).forEach(function (p) {
        var info = map[p.name];
        if (info) { p.rank = info.rank; p.points = info.points; }
      });
      if (m.status === 'FINISHED') return; // never project a known result
      var a = (m.players || [])[0], b = (m.players || [])[1];
      if (!a || !b || !a.points || !b.points) return;
      var pa = tennisWinProb(a.points, b.points);
      if (pa == null) return;
      m.proj = {
        a: Math.round(pa * 1000) / 1000,
        favorite: (pa >= 0.5 ? a.name : b.name),
        favPct: Math.round(Math.max(pa, 1 - pa) * 100),
        tag: tennisProjTag(pa - 0.5)
      };
    });
  });
}

async function fetchTennisModule() {
  var now = new Date();
  var dates = dateKeyUtc(shiftedDate(now, -150)) + '-' + dateKeyUtc(shiftedDate(now, 90));
  var results = await Promise.all([
    espnTennis('atp', dates).catch(function (e) { console.warn('ATP fetch failed:', e.message || e); return null; }),
    espnTennis('wta', dates).catch(function (e) { console.warn('WTA fetch failed:', e.message || e); return null; }),
    espnTennisRankings('atp').catch(function (e) { console.warn('ATP rankings failed:', e.message || e); return null; }),
    espnTennisRankings('wta').catch(function (e) { console.warn('WTA rankings failed:', e.message || e); return null; })
  ]);
  var atp = (results[0] && results[0].events) || [];
  var wta = (results[1] && results[1].events) || [];
  if (!atp.length && !wta.length) throw new Error('ESPN tennis returned no events for ' + dates + '.');
  var tournaments = collectTennis(atp, wta);
  var atpMap = tennisRatingMap(results[2]);
  var wtaMap = tennisRatingMap(results[3]);
  tournaments.forEach(function (t) {
    enrichTennisDraw(t.draws.men, atpMap);
    enrichTennisDraw(t.draws.women, wtaMap);
  });
  var nowMs = now.getTime();
  var slam = pickTennisTier(tournaments, 'slam', nowMs);
  var masters = pickTennisTier(tournaments, 'masters1000', nowMs);
  var tour500 = pickTennisTier(tournaments, 'tour500', nowMs);
  var phase = (slam.current && slam.current.status === 'live') ? 'grand slam live'
    : (masters.current && masters.current.status === 'live') ? 'masters 1000 live'
    : (tour500.current && tour500.current.status === 'live') ? 'atp/wta 500 live'
    : 'between events';
  var generatedAt = new Date().toISOString();
  return {
    enabled: true,
    kind: 'tennis',
    title: 'Tennis — Majors & Masters',
    phase: phase,
    provider: 'ESPN tennis feed',
    providerNote: 'ATP and WTA singles draws for the Grand Slams, Masters 1000 and 500 events, from ESPN\'s public tennis feed. Brackets and scores are reconstructed round-by-round. Scheduled matches carry a win-probability projection derived from current ATP/WTA ranking points (a logistic model capped 15–85%) — framing, not advice.',
    asOf: phtDateKey(),
    generatedAt: generatedAt,
    refreshAttemptedAt: generatedAt,
    lastSuccessfulAt: generatedAt,
    refreshStatus: 'ok',
    fallback: false,
    staleAfterHours: (phase === 'between events') ? 168 : 12,
    tiers: { slam: slam, masters: masters, tour500: tour500 }
  };
}

function buildTennisModule() {
  var m = emptyModule(
    'tennis',
    'Tennis — Majors & Masters',
    'feed unavailable',
    'ESPN tennis feed',
    'Tennis data is temporarily unavailable. The refresh job will keep the last good snapshot when one exists.'
  );
  m.tiers = {
    slam: { current: null, next: null, recent: [] },
    masters: { current: null, next: null, recent: [] },
    tour500: { current: null, next: null, recent: [] }
  };
  return m;
}

function tennisModuleHasData(mod) {
  if (!mod || !mod.tiers) return false;
  return ['slam', 'masters', 'tour500'].some(function (k) {
    var tier = mod.tiers[k] || {};
    return tier.current || (tier.recent && tier.recent.length);
  });
}

// ── Projection journal — forward-accumulating Brier/accuracy scoreboard ───────
// The tennis analog of the miro journal. The projection uses TODAY's rankings,
// so past predictions can't be reconstructed point-in-time without hindsight;
// instead each scheduled-match projection is LOCKED the first time it is seen
// and SCORED once the match finishes. State persists across daily runs in
// briefings-bob/sports-tennis-journal; only compact stats ride in the daily doc.
function collectTennisMatches(mod) {
  var out = {}, order = [];
  var tiers = (mod && mod.tiers) || {};
  ['slam', 'masters', 'tour500'].forEach(function (tk) {
    var tier = tiers[tk] || {};
    var events = [];
    if (tier.current) events.push(tier.current);
    if (tier.next && (!tier.current || tier.next.id !== tier.current.id)) events.push(tier.next);
    (tier.recent || []).forEach(function (e) { events.push(e); });
    events.forEach(function (t) {
      ['men', 'women'].forEach(function (tour) {
        var draw = t.draws && t.draws[tour];
        if (!draw) return;
        (draw.rounds || []).forEach(function (r) {
          r.matches.forEach(function (m) {
            if (!m.id || out[m.id]) return;
            out[m.id] = { id: m.id, tournament: t.name, tier: tk, tour: tour, round: m.round, status: m.status, players: m.players || [], proj: m.proj || null };
            order.push(m.id);
          });
        });
      });
    });
  });
  return order.map(function (id) { return out[id]; });
}

function tennisMatchWinner(players) {
  var w = (players || []).filter(function (p) { return p.winner; })[0];
  return w ? w.name : null;
}

function buildTennisJournal(prior, matches, nowIso) {
  var preds = {};
  var priorPreds = (prior && prior.preds) || {};
  Object.keys(priorPreds).forEach(function (k) { preds[k] = priorPreds[k]; });
  (matches || []).forEach(function (m) {
    var finished = m.status === 'FINISHED';
    if (!preds[m.id] && !finished && m.proj) {
      preds[m.id] = {
        id: m.id, tournament: m.tournament, tier: m.tier, tour: m.tour, round: m.round,
        playerA: (m.players[0] || {}).name, playerB: (m.players[1] || {}).name,
        pA: m.proj.a, favorite: m.proj.favorite, favPct: m.proj.favPct, tag: m.proj.tag,
        firstSeen: nowIso, resolved: false
      };
    }
    if (finished && preds[m.id] && !preds[m.id].resolved) {
      var winner = tennisMatchWinner(m.players);
      if (winner) {
        var pr = preds[m.id];
        var outcomeA = (winner === pr.playerA) ? 1 : 0;
        var pA = Math.max(0.01, Math.min(0.99, pr.pA));
        pr.resolved = true;
        pr.winner = winner;
        pr.correct = (pr.favorite === winner);
        pr.brier = Math.round(Math.pow(pA - outcomeA, 2) * 1e4) / 1e4;
        pr.logLoss = Math.round((-(outcomeA * Math.log(pA) + (1 - outcomeA) * Math.log(1 - pA))) * 1e4) / 1e4;
        pr.resolvedAt = nowIso;
      }
    }
  });
  var all = Object.keys(preds).map(function (k) { return preds[k]; });
  var resolved = all.filter(function (p) { return p.resolved; });
  var decisive = resolved.filter(function (p) { return p.tag === 'Moderate' || p.tag === 'Strong'; });
  function acc(list) { return list.length ? Math.round(list.filter(function (p) { return p.correct; }).length / list.length * 100) : null; }
  function mean(list, f) { return list.length ? list.reduce(function (a, p) { return a + f(p); }, 0) / list.length : null; }
  var brier = mean(resolved, function (p) { return p.brier; });
  var logLoss = mean(resolved, function (p) { return p.logLoss; });
  var byTag = ['Toss-up', 'Lean', 'Moderate', 'Strong'].map(function (tag) {
    var l = resolved.filter(function (p) { return p.tag === tag; });
    return { tag: tag, n: l.length, accuracy: acc(l) };
  }).filter(function (r) { return r.n > 0; });
  var recent = resolved.slice().sort(function (a, b) { return String(b.resolvedAt).localeCompare(String(a.resolvedAt)); }).slice(0, 8)
    .map(function (p) { return { tournament: p.tournament, round: p.round, favorite: p.favorite, favPct: p.favPct, tag: p.tag, winner: p.winner, correct: p.correct }; });
  var stats = {
    resolved: resolved.length,
    pending: all.length - resolved.length,
    accuracy: acc(resolved),
    decisive: decisive.length,
    decisiveAccuracy: acc(decisive),
    brier: brier == null ? null : Math.round(brier * 1e4) / 1e4,
    baselineBrier: 0.25,
    brierSkill: brier == null ? null : Math.round((0.25 - brier) * 1e4) / 1e4,
    logLoss: logLoss == null ? null : Math.round(logLoss * 1e4) / 1e4,
    byTag: byTag,
    recent: recent
  };
  // Bound the persisted doc: keep every unresolved lock + the 500 newest resolved.
  var keep = {};
  all.forEach(function (p) { if (!p.resolved) keep[p.id] = p; });
  resolved.sort(function (a, b) { return String(b.resolvedAt).localeCompare(String(a.resolvedAt)); }).slice(0, 500).forEach(function (p) { keep[p.id] = p; });
  return { preds: keep, stats: stats, updatedAt: nowIso };
}

async function updateTennisJournal(db, module, dryRun) {
  var nowIso = new Date().toISOString();
  var matches = collectTennisMatches(module);
  var prior = null;
  if (db) {
    try {
      var snap = await db.collection(COLL).doc('sports-tennis-journal').get();
      if (snap.exists) prior = snap.data() || null;
    } catch (e) { console.warn('tennis journal read failed:', e.message || e); }
  }
  var journal = buildTennisJournal(prior, matches, nowIso);
  if (db && !dryRun) {
    try { await db.collection(COLL).doc('sports-tennis-journal').set(journal); }
    catch (e) { console.warn('tennis journal write failed:', e.message || e); }
  }
  module.projectionJournal = journal.stats; // compact stats only in the daily doc
  console.log('Tennis journal: ' + journal.stats.resolved + ' scored, ' + journal.stats.pending + ' pending' +
    (journal.stats.accuracy != null ? ', ' + journal.stats.accuracy + '% overall / ' + (journal.stats.decisiveAccuracy == null ? '—' : journal.stats.decisiveAccuracy + '%') + ' decisive' : '') + '.');
  return journal.stats;
}

function buildForwardModules(reason) {
  var modules = {};
  if (wantsModule('nba')) modules.nba = buildNbaModule();
  if (wantsModule('pvl')) modules.pvl = buildPvlModule();
  if (wantsModule('tennis')) modules.tennis = buildTennisModule();
  if (wantsModule('all')) {
    if (!modules.nba) modules.nba = buildNbaModule();
    if (!modules.pvl) modules.pvl = buildPvlModule();
    if (!modules.tennis) modules.tennis = buildTennisModule();
  }
  Object.keys(modules).forEach(function (k) {
    modules[k].setupNote = reason || '';
  });
  return modules;
}

function initAdmin() {
  var keyPaths = [
    join(__dirname, 'serviceAccountKey.json'),
    join(__radar, 'serviceAccountKey.json')
  ];
  var keyPath = keyPaths.find(function (p) { return existsSync(p); });
  if (keyPath) {
    var sa = JSON.parse(readFileSync(keyPath, 'utf8'));
    initializeApp({ credential: cert(sa), projectId: PROJECT_ID });
    console.log('firebase-admin: using ' + keyPath);
  } else {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    console.log('firebase-admin: using application default credentials');
  }
  return getFirestore();
}

async function writeDoc(db, dateKey, doc) {
  await db.collection(COLL).doc('sports-' + dateKey).set(doc);
  await db.collection(COLL).doc('sports-latest').set({ value: dateKey });
}

function scheduleReadiness(history, moduleName, minimumDistinctDays) {
  minimumDistinctDays = minimumDistinctDays || 3;
  var days = {};
  (history || []).forEach(function (run) {
    var status = run && run.modules && run.modules[moduleName];
    if (!status || status.refreshStatus !== 'ok' || !run.completedAt) return;
    var day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(run.completedAt));
    days[day] = true;
  });
  var successfulDays = Object.keys(days).sort();
  return {
    ready: successfulDays.length >= minimumDistinctDays,
    successfulDays: successfulDays,
    requiredDays: minimumDistinctDays,
    remainingDays: Math.max(0, minimumDistinctDays - successfulDays.length)
  };
}

function recordRunHistory(doc) {
  var historyPath = join(__dirname, 'run-history.json');
  var history = [];
  try {
    if (existsSync(historyPath)) history = JSON.parse(readFileSync(historyPath, 'utf8'));
    if (!Array.isArray(history)) history = [];
  } catch (e) {
    console.warn('run history read failed; starting a new local history:', e.message || e);
    history = [];
  }
  var modules = {};
  Object.keys((doc && doc.modules) || {}).forEach(function (key) {
    var mod = doc.modules[key] || {};
    var requested = wantsModule(key);
    modules[key] = {
      refreshStatus: requested ? (mod.refreshStatus || 'unknown') : 'not-requested',
      lastSuccessfulAt: mod.lastSuccessfulAt || mod.generatedAt || '',
      matches: (mod.matches || []).length,
      standings: (mod.standings || []).length
    };
  });
  history.push({
    completedAt: new Date().toISOString(),
    requestedModules: SELECTED_MODULES.slice(),
    modules: modules
  });
  writeFileSync(historyPath, JSON.stringify(history.slice(-90), null, 2));
  Object.keys(modules).forEach(function (key) {
    var readiness = scheduleReadiness(history, key, 3);
    console.log('Schedule gate ' + key + ': ' + readiness.successfulDays.length + '/3 successful PHT days' +
      (readiness.ready ? ' (ready).' : ' (' + readiness.remainingDays + ' remaining).'));
  });
}

async function loadPublicMiroSports(db) {
  try {
    var lat = await db.collection(COLL).doc('miro-latest').get();
    var key = lat.exists ? (lat.data() || {}).value : null;
    if (!key) return null;
    var snap = await db.collection(COLL).doc('miro-' + key).get();
    if (!snap.exists) return null;
    var d = snap.data() || {};
    var markets = (d.markets || []).filter(function (m) {
      return String(m.theme || '').toLowerCase() === 'sports';
    }).map(function (m) {
      return {
        label: m.label || m.question || '',
        question: m.question || m.label || '',
        theme: m.theme || '',
        impliedYes: m.impliedYes == null ? null : m.impliedYes,
        status: m.status || '',
        volumeNum: m.volumeNum == null ? null : m.volumeNum,
        liquidityNum: m.liquidityNum == null ? null : m.liquidityNum
      };
    });
    return {
      asOf: d.asOf || key,
      generatedAt: d.generatedAt || null,
      markets: markets
    };
  } catch (e) {
    console.warn('public miro mirror skipped:', e.message || e);
    return null;
  }
}

async function main() {
  var dateKey = phtDateKey();

  // Init Firestore up front (unless dry-run) so we can read the last-good doc
  // BEFORE fetching — the per-match no-regress guard needs prior FINISHED results.
  var db = null;
  if (!DRY_RUN) {
    try { db = initAdmin(); } catch (e) { console.warn('admin init failed:', e.message || e); }
  }
  var prevFinished = {};
  var prevDocData = null;
  if (db) {
    try {
      var latSnap0 = await db.collection(COLL).doc('sports-latest').get();
      var prevKey0 = latSnap0.exists ? (latSnap0.data() || {}).value : null;
      if (prevKey0) {
        var prevSnap0 = await db.collection(COLL).doc('sports-' + prevKey0).get();
        prevDocData = prevSnap0.exists ? (prevSnap0.data() || {}) : null;
        var prevMatches0 = prevDocData ? (((prevDocData || {}).worldCup || {}).matches || []) : [];
        prevFinished = extractFinished(prevMatches0);
        console.log('No-regress baseline: ' + Object.keys(prevFinished).length + ' finished match(es) from sports-' + prevKey0 + '.');
      }
    } catch (e) { console.warn('prev-doc read for no-regress failed:', e.message || e); }
  }

  var doc = {
    generatedAt: new Date().toISOString(),
    asOf: dateKey,
    title: 'Sports briefing',
    sports: activeSportsList(),
    modules: buildForwardModules('')
  };
  // Module-specific refreshes share one Firestore/public document. Preserve the
  // other forward lane so a scheduled PVL run cannot erase NBA (and vice versa).
  ['nba', 'pvl', 'tennis'].forEach(function (key) {
    if (!wantsModule(key) && prevDocData && prevDocData.modules && prevDocData.modules[key]) {
      doc.modules[key] = prevDocData.modules[key];
    }
  });
  if (!wantsModule('worldcup') && prevDocData && prevDocData.worldCup) {
    doc.worldCup = prevDocData.worldCup;
  }
  if (wantsModule('nba')) {
    try {
      doc.modules.nba = await fetchNbaModule();
      console.log('NBA: loaded ' + doc.modules.nba.matches.length + ' games, ' +
        doc.modules.nba.standings.length + ' standings rows and ' + doc.modules.nba.momentum.length + ' momentum rows.');
    } catch (e) {
      console.warn('NBA fetch failed:', e.message || e);
      var priorNba = prevDocData && prevDocData.modules && prevDocData.modules.nba;
      if (priorNba && ((priorNba.matches || []).length || (priorNba.standings || []).length)) {
        doc.modules.nba = priorNba;
        doc.modules.nba.lastSuccessfulAt = priorNba.lastSuccessfulAt || priorNba.generatedAt || '';
        doc.modules.nba.refreshAttemptedAt = new Date().toISOString();
        doc.modules.nba.refreshStatus = 'fallback';
        doc.modules.nba.fallback = true;
        doc.modules.nba.staleAfterHours = priorNba.staleAfterHours || 168;
        doc.modules.nba.providerNote = 'Showing the last good NBA snapshot because the current refresh failed: ' + (e.message || e);
        console.warn('NBA: retained the last good module snapshot.');
      } else {
        doc.modules.nba = buildNbaModule();
        doc.modules.nba.setupNote = 'NBA fetch failed: ' + (e.message || e);
      }
    }
  }
  if (wantsModule('pvl')) {
    try {
      doc.modules.pvl = await fetchPvlModule();
      console.log('PVL: loaded ' + doc.modules.pvl.upcoming.length + ' upcoming, ' +
        doc.modules.pvl.recent.length + ' recent, ' + doc.modules.pvl.standings.length +
        ' standings rows and ' + doc.modules.pvl.momentum.length + ' momentum rows.');
    } catch (e) {
      console.warn('PVL fetch failed:', e.message || e);
      var priorPvl = prevDocData && prevDocData.modules && prevDocData.modules.pvl;
      if (priorPvl && ((priorPvl.matches || []).length || (priorPvl.standings || []).length)) {
        doc.modules.pvl = priorPvl;
        doc.modules.pvl.lastSuccessfulAt = priorPvl.lastSuccessfulAt || priorPvl.generatedAt || '';
        doc.modules.pvl.refreshAttemptedAt = new Date().toISOString();
        doc.modules.pvl.refreshStatus = 'fallback';
        doc.modules.pvl.fallback = true;
        doc.modules.pvl.staleAfterHours = priorPvl.staleAfterHours || 36;
        doc.modules.pvl.providerNote = 'Showing the last good PVL snapshot because the current refresh failed: ' + (e.message || e);
        console.warn('PVL: retained the last good module snapshot.');
      } else {
        doc.modules.pvl = buildPvlModule();
        doc.modules.pvl.setupNote = 'PVL fetch failed: ' + (e.message || e);
      }
    }
  }
  if (wantsModule('tennis')) {
    try {
      doc.modules.tennis = await fetchTennisModule();
      var ts = doc.modules.tennis.tiers;
      console.log('Tennis: slam current=' + ((ts.slam.current && ts.slam.current.name) || 'none') +
        ', masters current=' + ((ts.masters.current && ts.masters.current.name) || 'none') +
        ', 500 current=' + ((ts.tour500.current && ts.tour500.current.name) || 'none') +
        ', recent slams=' + ts.slam.recent.length + ', recent masters=' + ts.masters.recent.length +
        ', recent 500s=' + ts.tour500.recent.length + '.');
      await updateTennisJournal(db, doc.modules.tennis, DRY_RUN);
    } catch (e) {
      console.warn('Tennis fetch failed:', e.message || e);
      var priorTennis = prevDocData && prevDocData.modules && prevDocData.modules.tennis;
      if (tennisModuleHasData(priorTennis)) {
        doc.modules.tennis = priorTennis;
        doc.modules.tennis.lastSuccessfulAt = priorTennis.lastSuccessfulAt || priorTennis.generatedAt || '';
        doc.modules.tennis.refreshAttemptedAt = new Date().toISOString();
        doc.modules.tennis.refreshStatus = 'fallback';
        doc.modules.tennis.fallback = true;
        doc.modules.tennis.staleAfterHours = priorTennis.staleAfterHours || 168;
        doc.modules.tennis.providerNote = 'Showing the last good tennis snapshot because the current refresh failed: ' + (e.message || e);
        console.warn('Tennis: retained the last good module snapshot.');
      } else {
        doc.modules.tennis = buildTennisModule();
        doc.modules.tennis.setupNote = 'Tennis fetch failed: ' + (e.message || e);
      }
    }
  }
  ['nba', 'pvl'].forEach(function (key) {
    if (!wantsModule(key) || !doc.modules[key]) return;
    var previousModule = prevDocData && prevDocData.modules && prevDocData.modules[key];
    if (doc.modules[key].refreshStatus === 'fallback' && previousModule && previousModule.changes) {
      doc.modules[key].changes = previousModule.changes;
      return;
    }
    doc.modules[key].changes = buildModuleChanges(key, doc.modules[key], previousModule);
  });
  var isFallback = false;
  if (wantsModule('worldcup')) {
    if (!FOOTBALL_DATA_TOKEN) {
      doc.worldCup = setupDoc('No football-data.org token configured.').worldCup;
      isFallback = true;
    } else {
      try {
        doc.worldCup = await fetchWorldCup(prevFinished);
      } catch (e) {
        console.warn('World Cup fetch failed:', e.message || e);
        doc.worldCup = setupDoc('World Cup fetch failed: ' + (e.message || e)).worldCup;
        isFallback = true;
      }
    }
    if (isFallback && prevDocData && prevDocData.worldCup && (prevDocData.worldCup.matches || []).length) {
      doc.worldCup = prevDocData.worldCup;
      isFallback = false;
      console.warn('World Cup: retained the last good module snapshot.');
    }
  }

  console.log('\n===== briefings-bob/sports-' + dateKey + ' =====');
  console.log(JSON.stringify(doc, null, 2));

  if (DRY_RUN) {
    console.log('\n--dry-run: NOT writing sports-' + dateKey + ' / sports-latest.');
    return;
  }
  if (!db) { console.error('No Firestore handle (admin init failed) — cannot write.'); process.exitCode = 1; return; }
  // No-clobber guard: a transient football-data failure must not overwrite a good
  // doc with the empty setup fallback (that blanks the tab). If we only have a
  // fallback and a prior doc with real matches exists, keep the prior one.
  if (isFallback) {
    try {
      var latSnap = await db.collection(COLL).doc('sports-latest').get();
      var prevKey = latSnap.exists ? (latSnap.data() || {}).value : null;
      if (prevKey) {
        var prevSnap = await db.collection(COLL).doc('sports-' + prevKey).get();
        var prevMatches = prevSnap.exists ? (((prevSnap.data() || {}).worldCup || {}).matches || []) : [];
        if (prevMatches.length > 0) {
          console.log('\nFetch failed/empty, but a good prior doc exists (sports-' + prevKey + ', ' +
            prevMatches.length + ' matches) — NOT overwriting with the empty fallback.');
          return;
        }
      }
    } catch (e) { console.warn('last-good check failed (writing fallback anyway):', e.message || e); }
  }
  await writeDoc(db, dateKey, doc);
  console.log('\nWrote briefings-bob/sports-' + dateKey + ' and sports-latest = ' + dateKey + '.');
  // Public mirror for the friction-free shared page (sports.html on GitHub Pages
  // reads this static file — no Firebase, no sign-in). Only on real data, never
  // the empty fallback. The refresh-sports.ps1 wrapper commits/pushes it.
  var hasForwardData = doc.modules && ['nba', 'pvl'].some(function (key) {
    var mod = doc.modules[key];
    return mod && (((mod.matches || []).length > 0) || ((mod.standings || []).length > 0));
  });
  if (!isFallback || hasForwardData) {
    try {
      var pubPath = join(__dirname, '..', 'sports-public.json');
      var publicDoc = doc;
      var miro = await loadPublicMiroSports(db);
      if (miro) publicDoc = Object.assign({}, doc, { miro: miro });
      writeFileSync(pubPath, JSON.stringify(publicDoc));
      console.log('Wrote ' + pubPath + ' (public mirror).');
    } catch (e) { console.warn('public mirror write failed:', e.message || e); }
  }
  try { recordRunHistory(doc); } catch (e) { console.warn('run history write failed:', e.message || e); }
}

// Run only when executed directly (node refresh-sports.js), not when imported by
// a test — so the pure guard helpers below can be unit-tested without network/DB.
var __invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === __invoked) {
  main().then(function () {
    process.exit(0);
  }).catch(function (e) {
    console.error('\nrefresh-sports failed:', e.message || e);
    process.exit(1);
  });
}

export {
  mergeNoRegress,
  extractFinished,
  normMatch,
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
  pickTennisTier,
  tennisRatingMap,
  tennisWinProb,
  tennisProjTag,
  enrichTennisDraw,
  collectTennisMatches,
  buildTennisJournal
};
