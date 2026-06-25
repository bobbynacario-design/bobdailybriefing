// sports/refresh-sports.js
//
// Local runner for the Daily Briefer Sports tab. First lane: FIFA World Cup.
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

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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
var FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || '';
var FOLLOW_TEAMS = (process.env.SPORTS_FOLLOW_TEAMS || '')
  .split(',')
  .map(function (s) { return s.trim().toLowerCase(); })
  .filter(Boolean);
var ARGV = process.argv.slice(2);
var DRY_RUN = ARGV.indexOf('--dry-run') !== -1;

function phtDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function phtToday() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
}

function num(v) {
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

function sportsProjectionPower(t) {
  if (!t) return null;
  var score = Number(t.score || 0);
  var ppm = t.pointsPerMatch == null ? 1 : Number(t.pointsPerMatch);
  var gdTrend = Number(t.goalDiffTrend || 0);
  var attack = t.attackRate == null ? 1 : Number(t.attackRate);
  var defense = t.defenseRate == null ? 1 : Number(t.defenseRate);
  var form = clamp((ppm / 3) * 100, 0, 100);
  var gd = clamp(50 + gdTrend * 8, 0, 100);
  var attackScore = clamp(attack * 30, 0, 100);
  var defenseScore = clamp(100 - defense * 30, 0, 100);
  return Math.round(score * 0.46 + form * 0.22 + gd * 0.16 + attackScore * 0.09 + defenseScore * 0.07);
}

function projectionFromMomentum(m, momentumMap) {
  if (!m || !m.home || !m.away || !momentumMap) return null;
  var home = momentumMap[teamKey(m.home)];
  var away = momentumMap[teamKey(m.away)];
  if (!home && !away) return null;
  var hp = sportsProjectionPower(home);
  var ap = sportsProjectionPower(away);
  if (hp == null && ap == null) return null;
  if (hp == null) hp = 48;
  if (ap == null) ap = 48;
  var gap = hp - ap;
  var abs = Math.abs(gap);
  var favorite = abs < 4 ? null : (gap > 0 ? m.home : m.away);
  var tag = abs < 4 ? 'Toss-up' : (abs < 12 ? 'Lean' : (abs < 22 ? 'Moderate edge' : 'Strong edge'));
  return {
    favorite: favorite,
    tag: tag,
    gap: gap,
    homePower: hp,
    awayPower: ap
  };
}

function matchWinner(m) {
  if (!m.score || m.score.home == null || m.score.away == null) return null;
  if (m.score.home > m.score.away) return m.home;
  if (m.score.away > m.score.home) return m.away;
  return 'Draw';
}

function buildProjectionJournal(matches) {
  var finished = matches.filter(function (m) {
    return String(m.status || '').toUpperCase() === 'FINISHED'
      && m.score && m.score.home != null && m.score.away != null;
  }).sort(function (a, b) {
    return String(a.utcDate).localeCompare(String(b.utcDate));
  });
  var rows = [];
  var projected = 0, aligned = 0, missed = 0, tossUps = 0, tossUpDraws = 0;
  finished.forEach(function (m, idx) {
    var prior = finished.slice(0, idx);
    if (!prior.length) return;
    var momentum = buildTeamMomentum(prior, []);
    var byTeam = {};
    momentum.forEach(function (t) { byTeam[teamKey(t.team)] = t; });
    var p = projectionFromMomentum(m, byTeam);
    var actual = matchWinner(m);
    if (!p || !actual) return;
    var didAlign = false;
    if (!p.favorite) {
      tossUps++;
      didAlign = actual === 'Draw';
      if (didAlign) tossUpDraws++;
    } else {
      projected++;
      didAlign = p.favorite === actual;
      if (didAlign) aligned++;
      else missed++;
    }
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
  return {
    evaluated: evaluated,
    projected: projected,
    aligned: aligned,
    missed: missed,
    tossUps: tossUps,
    tossUpDraws: tossUpDraws,
    accuracy: projected ? round2(aligned / projected) : null,
    coverage: evaluated ? round2(projected / evaluated) : null,
    note: 'Point-in-time audit: each completed match is projected using only matches before kickoff.',
    recent: rows.slice(-8).reverse()
  };
}

async function fetchWorldCup() {
  var query = '?season=2026';
  var matchesJson = await footballData('/competitions/WC/matches' + query);
  var standingsJson = null;
  var scorersJson = null;
  try { standingsJson = await footballData('/competitions/WC/standings' + query); }
  catch (e) { console.warn('Standings skipped:', e.message); }
  try { scorersJson = await footballData('/competitions/WC/scorers' + query + '&limit=20'); }
  catch (e) { console.warn('Scorers skipped:', e.message); }

  var matches = (matchesJson.matches || []).map(normMatch).sort(function (a, b) {
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
  var standings = [];
  (standingsJson && standingsJson.standings || []).forEach(function (g) {
    (g.table || []).forEach(function (row) {
      standings.push(normStanding(Object.assign({ group: g.group || '' }, row)));
    });
  });
  var scorers = (scorersJson && scorersJson.scorers || []).map(normScorer);
  var momentum = buildTeamMomentum(matches, standings);
  var projectionJournal = buildProjectionJournal(matches);

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
    sports: ['worldcup'],
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
      momentum: [],
      projectionJournal: {
        evaluated: 0,
        projected: 0,
        aligned: 0,
        missed: 0,
        tossUps: 0,
        tossUpDraws: 0,
        accuracy: null,
        coverage: null,
        note: 'Point-in-time audit starts after completed matches exist.',
        recent: []
      },
      risingTeams: [],
      watchTeams: [],
      fadingTeams: []
    }
  };
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

async function main() {
  var dateKey = phtDateKey();
  var doc;
  if (!FOOTBALL_DATA_TOKEN) {
    doc = setupDoc('No football-data.org token configured.');
  } else {
    try {
      var worldCup = await fetchWorldCup();
      doc = {
        generatedAt: new Date().toISOString(),
        asOf: dateKey,
        title: 'Sports briefing',
        sports: ['worldcup'],
        worldCup: worldCup
      };
    } catch (e) {
      console.warn('World Cup fetch failed:', e.message || e);
      doc = setupDoc('World Cup fetch failed: ' + (e.message || e));
    }
  }

  console.log('\n===== briefings-bob/sports-' + dateKey + ' =====');
  console.log(JSON.stringify(doc, null, 2));

  if (DRY_RUN) {
    console.log('\n--dry-run: NOT writing sports-' + dateKey + ' / sports-latest.');
    return;
  }
  var db = initAdmin();
  await writeDoc(db, dateKey, doc);
  console.log('\nWrote briefings-bob/sports-' + dateKey + ' and sports-latest = ' + dateKey + '.');
}

main().then(function () {
  process.exit(0);
}).catch(function (e) {
  console.error('\nrefresh-sports failed:', e.message || e);
  process.exit(1);
});
