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
    scorers: scorers
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
      scorers: []
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
