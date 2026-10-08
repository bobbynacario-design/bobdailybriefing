// Transparent form heuristic, not a calibrated betting model. No AI API calls.
const MODEL_VERSION = 'nba-form-v1';
const DAY = 86400000;
export function buildNbaProjections(matches, momentum, now = new Date()) {
  const byTeam = new Map((momentum || []).map(row => [row.team, row]));
  const latest = new Map();
  for (const game of matches || []) {
    if (game.status !== 'FINISHED' || game.stage === 'pre-season') continue;
    for (const team of [game.home, game.away]) latest.set(team, Math.max(latest.get(team) || 0, Date.parse(game.utcDate) || 0));
  }
  let projected = 0;
  for (const game of matches || []) {
    delete game.projection;
    // Do not create fresh predictions for live games, postponed games, or preseason.
    if (!Number.isFinite(Date.parse(game.utcDate)) || game.status !== 'SCHEDULED' || !['regular-season', 'post-season', 'play-in-season'].includes(game.stage) || Date.parse(game.utcDate) <= Number(now)) continue;
    const home = byTeam.get(game.home), away = byTeam.get(game.away);
    const usable = (row, team) => row && row.recentGames >= 3 && Number.isFinite(row.score) && latest.get(team) && Number(now) >= latest.get(team) && Number(now) - latest.get(team) <= 45 * DAY;
    if (!usable(home, game.home) || !usable(away, game.away)) continue;
    const power = row => 50 + (row.score - 50) * Math.min(1, row.recentGames / 5);
    const homePower = power(home), awayPower = power(away);
    const rest = game.rest || {};
    const restAdjustment = (rest.home?.backToBack ? -4 : 0) + (rest.away?.backToBack ? 4 : 0);
    const gap = homePower - awayPower + 3 + restAdjustment;
    const pHome = Math.max(0.15, Math.min(0.85, 1 / (1 + Math.exp(-0.017 * gap))));
    const favoriteProbability = Math.max(pHome, 1 - pHome);
    game.projection = { modelVersion: MODEL_VERSION, favorite: favoriteProbability < 0.55 ? null : gap > 0 ? game.home : game.away,
      tag: favoriteProbability < 0.55 ? 'Toss-up' : favoriteProbability < 0.65 ? 'Watch only' : favoriteProbability < 0.75 ? 'Moderate edge' : 'Strong edge',
      gap: Math.round(gap * 10) / 10, homePower, awayPower,
      probs: { home: Math.round(pHome * 1000) / 1000, draw: 0, away: Math.round((1 - pHome) * 1000) / 1000 } };
    projected++;
  }
  return { modelVersion: MODEL_VERSION, projected,
    note: 'Estimated form probabilities, not calibrated forecasts. Uses recent wins and margins, standings, a small home advantage and back-to-back adjustment. Requires three recent games for both teams within 45 days; skips preseason. Injuries and confirmed lineups are not included.' + (projected ? '' : ' No eligible estimates yet; waiting for regular-season fixtures and sufficient recent form.') };
}
