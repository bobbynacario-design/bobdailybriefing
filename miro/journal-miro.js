// miro/journal-miro.js
//
// PURE resolution journal for the Event-Markets scenario read (Lane 3, hardened
// in Lane C). No I/O (no fetch, no Firestore, no Date) — all I/O stays in
// refresh-miro.js. Same "beat your own benchmark" discipline as radar/journal.js;
// here the benchmark is the market's OWN price.
//
// The panel can't be re-derived from price (it's an LLM), so the journal
// ACCUMULATES: it records each market's haircut prediction ONCE at first sighting
// (no peeking as the price converges) and scores it when the market resolves.
//
// Two feedback signals, because final resolution can be months away:
//   - Brier + log loss of our haircut prob vs the market price (skill > 0 = we
//     beat the price), broken out by price bucket so longshots don't hide in the
//     average;
//   - Closing-line value (CLV): does the price drift TOWARD our read over time?
//     Early feedback long before resolution.
//
//   buildMiroJournal(prior, todaySnapshots, todayPrices, resolutions, config)

function round(v, dp) {
  if (v === null || v === undefined || isNaN(v)) return null;
  var m = Math.pow(10, dp || 0);
  return Math.round(v * m) / m;
}

function mean(arr) {
  if (!arr.length) return null;
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function brier(records, key) {
  if (!records.length) return null;
  var s = 0;
  for (var i = 0; i < records.length; i++) {
    var d = records[i][key] - records[i].outcome;
    s += d * d;
  }
  return s / records.length;
}

// Log loss punishes confident wrong calls much harder than Brier — a check on
// tail overconfidence. Probabilities are clamped away from 0/1 to stay finite.
function logLoss(records, key) {
  if (!records.length) return null;
  var eps = 1e-6, s = 0;
  for (var i = 0; i < records.length; i++) {
    var p = Math.min(1 - eps, Math.max(eps, records[i][key]));
    var y = records[i].outcome;
    s += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }
  return s / records.length;
}

// Calibration: bin predictions by our haircut prob, report mean predicted vs
// realized frequency per non-empty bin.
function calibration(records, bins) {
  var n = bins || 10;
  var buckets = [];
  for (var i = 0; i < n; i++) buckets.push({ lo: i / n, hi: (i + 1) / n, preds: [], outcomes: [] });
  records.forEach(function (r) {
    var idx = Math.min(n - 1, Math.floor(r.predictedProb * n));
    buckets[idx].preds.push(r.predictedProb);
    buckets[idx].outcomes.push(r.outcome);
  });
  return buckets
    .filter(function (b) { return b.preds.length > 0; })
    .map(function (b) {
      return {
        range: Math.round(b.lo * 100) + '-' + Math.round(b.hi * 100) + '%',
        n: b.preds.length,
        meanPredicted: round(mean(b.preds) * 100, 1),
        realizedPct: round(mean(b.outcomes) * 100, 1)
      };
    });
}

// Performance split by the market's PRICE at first sighting. Longshots maximize
// LLM calibration bias, so they must not be blended with coin-flip markets.
var PRICE_BUCKETS = [
  [0, 0.05], [0.05, 0.15], [0.15, 0.35], [0.35, 0.65], [0.65, 0.85], [0.85, 0.95], [0.95, 1.0001]
];
function byPriceBucket(resolved) {
  return PRICE_BUCKETS.map(function (b) {
    var rs = resolved.filter(function (r) { return r.impliedAtFirst >= b[0] && r.impliedAtFirst < b[1]; });
    return {
      range: Math.round(b[0] * 100) + '-' + Math.round(Math.min(1, b[1]) * 100) + '%',
      n: rs.length,
      brierOurs: round(brier(rs, 'predictedProb'), 4),
      brierMarket: round(brier(rs, 'impliedAtFirst'), 4)
    };
  }).filter(function (x) { return x.n > 0; });
}

function buildMiroJournal(prior, todaySnapshots, todayPrices, resolutions, config) {
  var jcfg = (config && config.journal) || { recentCap: 200, calibrationBins: 10 };

  // Clone prior state (or start fresh).
  var open = {};
  if (prior && prior.open) Object.keys(prior.open).forEach(function (k) { open[k] = prior.open[k]; });
  var resolved = (prior && prior.resolved) ? prior.resolved.slice() : [];
  var resolvedSlugs = {};
  resolved.forEach(function (r) { resolvedSlugs[r.slug] = true; });

  // 1) Record each market's prediction ONCE, the first time we have a panel for
  //    it. priceAtFirst is the executable mid we anchored to.
  (todaySnapshots || []).forEach(function (s) {
    if (s.haircutProb == null) return;
    if (open[s.slug] || resolvedSlugs[s.slug]) return;
    var first = (s.mid != null) ? s.mid : s.impliedYes;
    open[s.slug] = {
      firstSeen: s.asOf,
      lastChecked: s.asOf,
      label: s.label,
      theme: s.theme,
      endDate: s.endDate || null,
      impliedAtFirst: round(s.impliedYes, 4),
      priceAtFirst: round(first, 4),
      predictedProb: round(s.haircutProb, 4),
      // WHO made this prediction. A prediction is locked once and scored months
      // later, so a journal spanning a config change would otherwise blend two
      // different forecasters into one Brier score and report it as if it were
      // one. Stamped at lock time; nothing here changes the maths.
      forecaster: {
        model: (config && config.panel && config.panel.model) || null,
        provider: (config && config.panel && config.panel.provider) || null,
        webSearch: !!(config && config.panel && config.panel.webSearch)
      },
      priceTrail: [{ asOf: s.asOf, mid: round(first, 4) }],
      clvTowardPanel: 0
    };
  });

  // 1b) Append today's price to every open trail and recompute closing-line value
  //     (did the price move toward our prediction since first sighting?).
  var priceBySlug = {};
  (todayPrices || []).forEach(function (p) { if (p.mid != null) priceBySlug[p.slug] = p; });
  Object.keys(open).forEach(function (slug) {
    var rec = open[slug];
    var p = priceBySlug[slug];
    if (!p) return;
    rec.priceTrail = rec.priceTrail || [];
    var last = rec.priceTrail[rec.priceTrail.length - 1];
    if (!last || last.asOf !== p.asOf) {
      rec.priceTrail.push({ asOf: p.asOf, mid: round(p.mid, 4) });
      if (rec.priceTrail.length > 60) rec.priceTrail = rec.priceTrail.slice(rec.priceTrail.length - 60);
    }
    rec.lastChecked = p.asOf;
    var first = (rec.priceAtFirst != null) ? rec.priceAtFirst : rec.impliedAtFirst;
    var dir = (rec.predictedProb >= first) ? 1 : -1;   // direction we leaned vs the price
    rec.clvTowardPanel = round((round(p.mid, 4) - first) * dir, 4);
  });

  // 2) Resolve markets that have closed: move open -> resolved, with audit fields.
  var newlyResolved = 0;
  (resolutions || []).forEach(function (r) {
    var rec = open[r.slug];
    if (!rec) return;
    if (resolvedSlugs[r.slug]) return;
    resolved.push({
      slug: r.slug,
      label: rec.label,
      theme: rec.theme,
      firstSeen: rec.firstSeen,
      resolvedDate: r.resolvedDate,
      impliedAtFirst: rec.impliedAtFirst,
      priceAtFirst: rec.priceAtFirst,
      predictedProb: rec.predictedProb,
      outcome: r.outcome,                                   // 1 == YES, 0 == NO
      resolutionSource: r.resolutionSource || '',
      resolutionStatus: r.resolutionStatus || '',
      resolutionMethod: r.method || 'auto-closed-price',
      resolutionConfidence: (r.confidence != null) ? r.confidence : 1,
      finalClvTowardPanel: rec.clvTowardPanel != null ? rec.clvTowardPanel : null
    });
    resolvedSlugs[r.slug] = true;
    delete open[r.slug];
    newlyResolved++;
  });

  if (resolved.length > jcfg.recentCap) resolved = resolved.slice(resolved.length - jcfg.recentCap);

  // 3) Stats. Forecast skill = market's error - ours (positive => we beat price).
  var brierOurs = brier(resolved, 'predictedProb');
  var brierMarket = brier(resolved, 'impliedAtFirst');
  var llOurs = logLoss(resolved, 'predictedProb');
  var llMarket = logLoss(resolved, 'impliedAtFirst');

  var clvs = Object.keys(open)
    .map(function (k) { return open[k].clvTowardPanel; })
    .filter(function (v) { return v != null; });

  var caveats = [];
  if (resolved.length === 0) {
    caveats.push('No markets have resolved yet — the journal is accumulating predictions. Brier/log-loss appear once curated markets settle. Meanwhile, closing-line value tracks whether the price drifts toward our read.');
  } else if (resolved.length < 20) {
    caveats.push('Only ' + resolved.length + ' resolved market(s) — indicative, not statistically significant. Beating the price on a handful of events is luck until the sample grows.');
  }
  caveats.push('Benchmark is the market price at first sighting; skill = error(market) - error(ours), positive means our read beat the price. CLV>0 means the price later moved toward our read. Research only — never a bet, no execution.');

  return {
    journalConfig: { recentCap: jcfg.recentCap, calibrationBins: jcfg.calibrationBins },
    open: open,
    resolved: resolved,
    stats: {
      nOpen: Object.keys(open).length,
      nResolved: resolved.length,
      newlyResolved: newlyResolved,
      brierOurs: round(brierOurs, 4),
      brierMarket: round(brierMarket, 4),
      skill: (brierOurs == null || brierMarket == null) ? null : round(brierMarket - brierOurs, 4),
      logLossOurs: round(llOurs, 4),
      logLossMarket: round(llMarket, 4),
      logLossSkill: (llOurs == null || llMarket == null) ? null : round(llMarket - llOurs, 4),
      meanClvTowardPanel: clvs.length ? round(mean(clvs), 4) : null,
      nClv: clvs.length
    },
    calibration: calibration(resolved, jcfg.calibrationBins),
    byPriceBucket: byPriceBucket(resolved),
    caveats: caveats
  };
}

export { buildMiroJournal };
