(function(root) {
  'use strict';
  // "Can you trust these calls?" (28 Nov 2026, Bob's pick): one plain card on
  // Radar and on Markets that turns their own journals into a verdict, so the
  // Money line's picks come with their track record. Pure: no reads or writes.
  //
  // Sources, all already written by the runs:
  //   Radar doc .takerRecord      every published Taker pick, ten sessions on
  //                               (radar/taker-record.js)
  //   Radar doc .forecastJournal  the forecast panel's probabilities, Brier
  //   radar-journal               the score re-measured on history: rank
  //                               correlation, and excess return by status
  //   miro-journal .stats         settled Markets questions: our read vs the price
  // Each verdict needs a minimum sample, and a small edge is called level, so
  // the card never claims skill the record cannot show.
  var MIN = {taker: 20, list: 50, forecasts: 30, rankingDays: 60, status: 100, markets: 30, marketsHint: 5};

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function pts(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1); }
  function three(v) { return v.toFixed(3); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(iso) { return /^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? Number(iso.slice(8, 10)) + ' ' + MONTHS[Number(iso.slice(5, 7)) - 1] : ''; }

  function takerRow(t) {
    var resolved = t && num(t.resolved), beat = t && num(t.beat), mean = t && num(t.meanExcessReturn);
    if (!t || resolved == null) return null;
    var row = {key: 'taker', label: 'Taker picks'};
    if (resolved < MIN.taker || beat == null || mean == null) {
      return Object.assign(row, {tone: 'wait', verdict: 'Too few scored yet', detail: (resolved || 0) + ' of ' + (num(t.picks) || 0) + ' picks have had their ten sessions; a verdict needs ' + MIN.taker + '.'});
    }
    var rate = beat / resolved;
    var tone = rate >= 0.55 && mean > 0.5 ? 'good' : rate <= 0.45 && mean < -0.5 ? 'bad' : 'flat';
    return Object.assign(row, {tone: tone,
      verdict: tone === 'good' ? 'Ahead of their benchmarks' : tone === 'bad' ? 'Behind their benchmarks' : 'About level with their benchmarks',
      detail: beat + ' of ' + resolved + ' scored picks beat their benchmark over ten sessions; the average pick ' + (mean >= 0 ? 'led' : 'trailed') + ' by ' + Math.abs(mean).toFixed(1) + ' points' +
        (t.since ? ' (since ' + day(t.since) + (num(t.effectiveSample) ? ', about ' + t.effectiveSample + ' independent windows' : '') + ')' : '') + '.'});
  }
  // Picks against the list they were picked from (28 Nov 2026): on the same
  // runs, does picking the top names do better than every name on the list?
  // A verdict needs 20 scored picks and 50 scored list names, and the picks
  // must lead (or trail) on both the share beating their benchmark and the
  // average, by at least half a point on the average.
  function listRow(t, l) {
    var tr = t && num(t.resolved), lr = l && num(l.resolved), tm = t && num(t.meanExcessReturn), lm = l && num(l.meanExcessReturn);
    if (!t || !l || tr == null || lr == null) return null;
    var row = {key: 'list', label: 'Picks vs list'};
    if (tr < MIN.taker || lr < MIN.list || tm == null || lm == null || num(t.beat) == null || num(l.beat) == null) {
      return Object.assign(row, {tone: 'wait', verdict: 'Too few scored yet', detail: (tr || 0) + ' picks and ' + (lr || 0) + ' list names scored; a verdict needs ' + MIN.taker + ' and ' + MIN.list + '.'});
    }
    var tp = Math.round(100 * t.beat / tr), lp = Math.round(100 * l.beat / lr), gap = tm - lm;
    var tone = gap >= 0.5 && tp >= lp ? 'good' : gap <= -0.5 && tp <= lp ? 'bad' : 'flat';
    return Object.assign(row, {tone: tone,
      verdict: tone === 'good' ? 'Picks have done better than the whole list' : tone === 'bad' ? 'Picks have done worse than the whole list' : 'Picks about level with the whole list',
      detail: 'On the same runs, ' + tp + '% of picks beat their benchmark against ' + lp + '% of every listed name; average ' + pts(tm) + ' against ' + pts(lm) + ' points over ten sessions.'});
  }
  function forecastRow(f) {
    var n = f && num(f.resolved), score = f && num(f.panelBrier), coin = f && (num(f.neutralBrier) || 0.25);
    if (!f || n == null) return null;
    var row = {key: 'forecasts', label: 'Forecasts'};
    if (n < MIN.forecasts || score == null) return Object.assign(row, {tone: 'wait', verdict: 'Too few scored yet', detail: (n || 0) + ' forecasts have resolved; a verdict needs ' + MIN.forecasts + '.'});
    var edge = coin - score, tone = edge >= 0.01 ? 'good' : edge <= -0.01 ? 'bad' : 'flat';
    return Object.assign(row, {tone: tone,
      verdict: tone === 'good' ? 'Better than a coin flip' : tone === 'bad' ? 'Worse than a coin flip' : 'No better than a coin flip',
      detail: n + ' scored' + (f.since ? ' since ' + day(f.since) : '') + ': ' + three(score) + ' against ' + three(coin) + ' for always saying 50/50 (lower is better).'});
  }
  function rankingRow(j) {
    var ic = j && j.informationCoefficient, mean = ic && num(ic.meanIC), n = ic && num(ic.nDates);
    if (mean == null || n == null || n < MIN.rankingDays) return null;
    var tone = mean >= 0.03 ? 'good' : mean <= -0.03 ? 'bad' : 'flat';
    return {key: 'ranking', label: 'Score', tone: tone,
      verdict: tone === 'good' ? 'Higher scores have done a little better' : tone === 'bad' ? 'Higher scores have done worse' : 'Higher scores have not done better',
      detail: 'Back-tested on ' + n + ' days: rank correlation ' + mean.toFixed(2) + ' (1 would be perfect). The watchlist was picked knowing how its names turned out, which flatters this.'};
  }
  function statusRow(j) {
    var s = j && j.byStatus, c = s && s.confirmed, i = s && s.invalidated;
    var ce = c && num(c.avgExcessReturn), ie = i && num(i.avgExcessReturn);
    if (ce == null || ie == null || (num(c.n) || 0) < MIN.status || (num(i.n) || 0) < MIN.status) return null;
    var gap = ce - ie, tone = gap >= 1 ? 'good' : gap <= -1 ? 'bad' : 'flat', h = j.journalConfig && num(j.journalConfig.horizonBars);
    return {key: 'status', label: 'Status', tone: tone,
      verdict: tone === 'good' ? 'Confirmed has done better than Invalidated' : tone === 'bad' ? 'Confirmed has done worse than Invalidated' : 'Status has not told them apart',
      detail: 'Back-tested' + (h ? ', ' + h + ' sessions' : '') + ': Confirmed ' + pts(ce) + ' against Invalidated ' + pts(ie) + ' points versus their benchmarks.'};
  }
  function radarCard(radarDoc, journal) {
    var rows = [takerRow(radarDoc && radarDoc.takerRecord), listRow(radarDoc && radarDoc.takerRecord, radarDoc && radarDoc.listRecord), forecastRow(radarDoc && radarDoc.forecastJournal && radarDoc.forecastJournal.stats), rankingRow(journal), statusRow(journal)].filter(Boolean);
    if (!rows.length) return null;
    var tone = function(k) { var r = rows.filter(function(x) { return x.key === k; })[0]; return r ? r.tone : ''; };
    var bottom = tone('taker') === 'bad' && tone('list') === 'bad' ? 'So far the Taker picks have lagged both their benchmarks and the rest of the list: treat them as names to read about, not calls to follow.'
      : tone('taker') === 'bad' ? 'So far the Taker picks have lagged their benchmarks: treat them as names to read about, not calls to follow.'
      : tone('list') === 'bad' ? 'So far picking the top names has done worse than the list as a whole: read the list, not just the picks.'
      : tone('taker') === 'good' || tone('forecasts') === 'good' ? 'Some sign of an edge so far, on a small sample: keep checking it as the record grows.'
      : 'No proven edge yet: treat Radar as a shortlist to read about, not a signal.';
    return {title: 'Can you trust these calls?', rows: rows, bottom: bottom};
  }
  function marketsCard(journal) {
    var s = journal && journal.stats, n = s && num(s.nResolved), ours = s && num(s.brierOurs), market = s && num(s.brierMarket);
    if (n == null) return null;
    var row = {key: 'markets', label: 'Our read'};
    if (n < MIN.markets || ours == null || market == null) {
      var hint = n >= MIN.marketsHint && ours != null && market != null ? ' So far the ' + (market < ours ? 'market price has been closer' : market > ours ? 'our read has been closer' : 'two are level') + ': ' + three(market) + ' for the price against ' + three(ours) + ' for our read (lower is better).' : '';
      row = Object.assign(row, {tone: 'wait', verdict: 'Too few settled yet', detail: n + ' question' + (n === 1 ? ' has' : 's have') + ' settled; a verdict needs ' + MIN.markets + '.' + hint});
    } else {
      var edge = market - ours, tone = edge >= 0.005 ? 'good' : edge <= -0.005 ? 'bad' : 'flat';
      row = Object.assign(row, {tone: tone,
        verdict: tone === 'good' ? 'Has beaten the market price' : tone === 'bad' ? 'The market price has been more accurate' : 'About level with the market price',
        detail: n + ' settled questions: our read ' + three(ours) + ' against ' + three(market) + ' for the price (lower is better).'});
    }
    var bottom = row.tone === 'good' ? 'Our read has had the edge on settled questions so far, on a small sample.'
      : 'Until our read beats the market on more questions, the market price is the better guess.';
    return {title: 'Can you trust these calls?', rows: [row], bottom: bottom};
  }

  root.CallsScoreCore = {MIN: MIN, radarCard: radarCard, marketsCard: marketsCard, takerRow: takerRow, listRow: listRow, forecastRow: forecastRow, rankingRow: rankingRow, statusRow: statusRow};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CallsScoreCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
