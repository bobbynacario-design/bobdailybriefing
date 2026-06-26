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

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
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
  if (db) {
    try {
      var latSnap0 = await db.collection(COLL).doc('sports-latest').get();
      var prevKey0 = latSnap0.exists ? (latSnap0.data() || {}).value : null;
      if (prevKey0) {
        var prevSnap0 = await db.collection(COLL).doc('sports-' + prevKey0).get();
        var prevMatches0 = prevSnap0.exists ? (((prevSnap0.data() || {}).worldCup || {}).matches || []) : [];
        prevFinished = extractFinished(prevMatches0);
        console.log('No-regress baseline: ' + Object.keys(prevFinished).length + ' finished match(es) from sports-' + prevKey0 + '.');
      }
    } catch (e) { console.warn('prev-doc read for no-regress failed:', e.message || e); }
  }

  var doc, isFallback = false;
  if (!FOOTBALL_DATA_TOKEN) {
    doc = setupDoc('No football-data.org token configured.');
    isFallback = true;
  } else {
    try {
      var worldCup = await fetchWorldCup(prevFinished);
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
      isFallback = true;
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
  if (!isFallback) {
    try {
      var pubPath = join(__dirname, '..', 'sports-public.json');
      var publicDoc = doc;
      var miro = await loadPublicMiroSports(db);
      if (miro) publicDoc = Object.assign({}, doc, { miro: miro });
      writeFileSync(pubPath, JSON.stringify(publicDoc));
      console.log('Wrote ' + pubPath + ' (public mirror).');
    } catch (e) { console.warn('public mirror write failed:', e.message || e); }
  }
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

export { mergeNoRegress, extractFinished, normMatch };
