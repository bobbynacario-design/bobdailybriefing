// sports/combat.js — Boxing & UFC from Polymarket (lane 4).
//
// Polymarket lists most UFC cards and a share of boxing, one event per fight,
// with a moneyline market whose two outcomes are the fighters. Prices are the
// crowd's chances. A finished fight resolves to 1/0 and its pre-fight price is
// gone, so a small journal keeps each fight's last price before it starts:
// results can then say who won as the underdog, and how often favourites won.
// No key; no model calls.

const GAMMA = 'https://gamma-api.polymarket.com/events';
import '../lib/sports-trust-core.js';
const Trust=globalThis.SportsTrust;
const DAY = 86400000;

// Filipino fighters to flag. Editable with COMBAT_FILIPINO (comma list).
export const COMBAT_FILIPINO = ['Manny Pacquiao', 'Jerwin Ancajas', 'John Riel Casimero', 'Marlon Tapales', 'Melvin Jerusalem',
  'Pedro Taduran', 'Vincent Astrolabio', 'Dave Apolinario', 'Christian Araneta', 'Carl Jammes Martin', 'Eumir Marcial',
  'Mark Magsayo', 'Reymart Gaballo', 'Jade Bornea', 'Kenneth Llover', 'Charly Suarez', 'Regie Suganob', 'Jonas Sultan',
  'Joshua Pacio', 'Danny Kingad', 'Jeremy Pacatiw', 'Kevin Belingon', 'Eduard Folayang', 'Lito Adiwang', 'Stephen Loman', 'Rolando Dy'];

function list(v) { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch (e) { return []; } }
function when(v) { const t = Date.parse(String(v || '').replace(' ', 'T').replace(/\+00$/, 'Z')); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim(); }

// "UFC Fight Night: Mike Malott vs. Joaquin Buckley (Welterweight, Main Card)"
export function parseFightTitle(title) {
  const m = String(title || '').match(/^(?:(.+?):\s*)?(.+?\s+vs\.?\s+.+?)(?:\s*\(([^,)]+)(?:,\s*([^)]+))?\))?$/i);
  if (!m) return null;
  return { card: (m[1] || '').trim(), bout: m[2].trim(), weightClass: (m[3] || '').trim(), segment: (m[4] || '').trim() };
}

// The fighters' market: two named outcomes, moneyline when Polymarket says so.
export function fightMarket(event) {
  const named = (event.markets || []).filter(m => { const o = list(m.outcomes); return o.length === 2 && !/^(yes|no)$/i.test(o[0]); });
  return named.find(m => m.sportsMarketType === 'moneyline') || named[0] || null;
}

export function normFight(event, sport, nowMs, filipino) {
  const parsed = parseFightTitle(event && event.title);
  const market = event && fightMarket(event);
  if (!parsed || !market) return null;
  const names = list(market.outcomes), prices = list(market.outcomePrices).map(p=>typeof p==='number' || typeof p==='string' && p.trim()!=='' ? Number(p) : NaN);
  if (names.length !== 2 || prices.length !== 2 || prices.some(p => !Trust.probability(p))) return null;
  const volume = Number(event.volume) || 0, liquidity = Number(event.liquidity) || 0;
  // An empty book sits at 50/50; only a traded or deep market says anything.
  const priced = volume >= 1000 || liquidity >= 1000;
  // Contract expiry is not a verified fight start time.
  const date = when(market.gameStartTime) || when(event.startTime);
  const closed = market.closed === true || event.closed === true;
  const oracleResolved=market.closed===true && market.umaResolutionStatus==='resolved';
  const winnerIdx=oracleResolved && ((prices[0]===1 && prices[1]===0) || (prices[0]===0 && prices[1]===1)) ? prices.indexOf(1) : -1;
  const noWinner=oracleResolved && prices[0]===0.5 && prices[1]===0.5;
  const settlementConfirmed=winnerIdx>=0 || noWinner;
  const preStart=Trust.before(new Date(nowMs).toISOString(),date);
  const flag = new Set((filipino || COMBAT_FILIPINO).map(norm));
  return {
    id: String(event.id), sport, card: parsed.card, bout: parsed.bout, weightClass: parsed.weightClass, segment: parsed.segment,
    date, volume: Math.round(volume), liquidity: Math.round(liquidity), priced,
    fighters: names.map((name, i) => ({ name, pct: priced && !closed && preStart ? Math.round(prices[i] * 100) : null })),
    filipino: names.some(n => flag.has(norm(n))),
    status:winnerIdx>=0 ? 'finished' : noWinner ? 'void' : closed || (date && !preStart) ? 'awaiting result' : date ? 'upcoming' : 'start unconfirmed',
    winner: winnerIdx >= 0 ? names[winnerIdx] : null,
    settlementConfirmed,void:noWinner,marketId:String(market.id || ''),
    url: event.slug ? 'https://polymarket.com/event/' + event.slug : null
  };
}

// Keeps each fight's last priced chance before it starts, then scores it.
export function buildCombatJournal(prior, fights, nowIso) {
  const rows = Object.assign({}, prior && prior.fights);
  for (const f of fights) {
    const old = rows[f.id] ? Object.assign({}, rows[f.id]) : null;
    if (f.status === 'upcoming' && Trust.before(nowIso,f.date) && !(old && old.winner) && f.priced && f.fighters[0].pct != null) {
      rows[f.id] = Object.assign(old || {}, { id: f.id, sport: f.sport, bout: f.bout, card: f.card, date: f.date,
        names: f.fighters.map(x => x.name), pct: f.fighters.map(x => x.pct), seenAt: nowIso,marketId:f.marketId || '' });
    } else if (f.settlementConfirmed && (f.status==='finished' || f.status==='void')) {
      // Seen only after it ended: the result stands, its pre-fight chance is unknown.
      const base = old || { id: f.id, sport: f.sport, bout: f.bout, card: f.card, date: f.date, names: f.fighters.map(x => x.name), pct: null };
      const i = base.names.indexOf(f.winner);
      const preFightVerified=Trust.before(base.seenAt,base.date) && Trust.before(base.seenAt,f.date) &&
        base.names.length===f.fighters.length && f.fighters.every(x=>base.names.includes(x.name)) && (!base.marketId || base.marketId===f.marketId);
      rows[f.id] = Object.assign(base, { winner: f.winner, winnerPct: !f.void && preFightVerified && base.pct && i >= 0 ? base.pct[i] : null,
        settlementConfirmed:true,preFightVerified,void:!!f.void,resolvedAt:base.resolvedAt || nowIso });
    } else if(old && f.status==='awaiting result') {
      rows[f.id]=Object.assign(old,{settlementConfirmed:false});
    }
  }
  const all = Object.values(rows);
  const scored = all.filter(r => r.settlementConfirmed && r.preFightVerified && r.winner && !r.void && r.winnerPct != null && r.pct && r.pct[0] !== r.pct[1]);
  const favWon = scored.filter(r => r.winnerPct > 50).length;
  const brier = scored.length ? scored.reduce((a, r) => a + Math.pow(1 - r.winnerPct / 100, 2), 0) / scored.length : null;
  const recent = all.filter(r => r.settlementConfirmed && (r.winner || r.void)).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12)
    .map(r => ({ id: r.id, sport: r.sport, bout: r.bout, card: r.card, date: r.date, winner: r.winner, winnerPct: r.winnerPct,
      loser: r.names.find(n => n !== r.winner) || '',void:!!r.void,settlementConfirmed:true }));
  // Bound the stored doc: open fights plus the 400 newest results.
  const keep = {};
  all.filter(r => !r.winner && !r.void).forEach(r => { keep[r.id] = r; });
  all.filter(r => r.winner || r.void).sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt))).slice(0, 400).forEach(r => { keep[r.id] = r; });
  return { fights: keep, updatedAt: nowIso,
    stats: { scored: scored.length, favouritesWon: favWon, brier: brier == null ? null : Math.round(brier * 1e4) / 1e4, recent,
      unverifiedResults:all.filter(r=>r.winner && !r.settlementConfirmed).length,
      timingExcluded:all.filter(r=>r.settlementConfirmed && r.winner && !r.preFightVerified).length,
      noWinner:all.filter(r=>r.settlementConfirmed && r.void).length } };
}

// Upcoming fights in the next 3 weeks plus ones awaiting a result; UFC grouped
// by card. Most-traded first within a card, so the headline bout leads.
export function buildCombatView(fights, nowMs) {
  const soon = fights.filter(f => !['finished','void'].includes(f.status) && f.date && Date.parse(f.date) < nowMs + 21 * DAY && Date.parse(f.date) > nowMs - 3 * DAY);
  const byCard = {};
  for (const f of soon.filter(f => f.sport === 'ufc')) {
    const key = (f.card || 'UFC') + '|' + String(f.date).slice(0, 10);
    (byCard[key] = byCard[key] || { name: f.card || 'UFC', date: f.date, fights: [] }).fights.push(f);
  }
  const cards = Object.values(byCard).map(c => {
    // Main card before prelims, then the most traded.
    c.fights.sort((a, b) => Number(/prelim/i.test(a.segment)) - Number(/prelim/i.test(b.segment)) || b.volume - a.volume);
    c.date = c.fights.map(f => f.date).sort()[0];
    return c;
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const boxing = soon.filter(f => f.sport === 'boxing').sort((a, b) => String(a.date).localeCompare(String(b.date)) || b.volume - a.volume);
  return { cards, boxing };
}

async function gamma(fetchImpl, query) {
  const res = await fetchImpl(GAMMA + '?' + query, { headers: { accept: 'application/json', 'user-agent': 'BobDailyBriefing/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('Polymarket ' + res.status);
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

export async function fetchCombatFights(fetchImpl = fetch, now = new Date()) {
  const since = new Date(now.getTime() - 10 * DAY).toISOString();
  const filipino = process.env.COMBAT_FILIPINO ? process.env.COMBAT_FILIPINO.split(',').map(s => s.trim()).filter(Boolean) : COMBAT_FILIPINO;
  const pages = await Promise.all([
    ['boxing', 'tag_slug=boxing&closed=false&limit=200'], ['ufc', 'tag_slug=ufc&closed=false&limit=200'],
    ['boxing', 'tag_slug=boxing&closed=true&limit=200&end_date_min=' + since], ['ufc', 'tag_slug=ufc&closed=true&limit=200&end_date_min=' + since]
  ].map(([sport, q]) => gamma(fetchImpl, q).then(events => events.map(e => normFight(e, sport, now.getTime(), filipino)).filter(Boolean))));
  const seen = new Set(), fights = [];
  for (const f of pages.flat()) if (!seen.has(f.id)) { seen.add(f.id); fights.push(f); }
  return fights;
}
