// miro/journal-miro.js
//
// PURE resolution journal for the Event-Markets scenario read (Lane 3). No I/O
// (no fetch, no Firestore, no Date) — all I/O stays in refresh-miro.js. Same
// "beat your own benchmark" discipline as radar/journal.js: there the benchmark
// is the asset's index; HERE the benchmark is the market's OWN implied price.
//
// Unlike the radar journal, this one cannot be recomputed from scratch each run
// (the panel is an LLM, not a deterministic function of price), so it ACCUMULATES:
//   - the first time we produce a panel read for a market, we record that
//     prediction ONCE (firstSeen snapshot) — no peeking as the price converges,
//   - when the market resolves, we move it to `resolved` with the actual outcome,
//   - stats compare Brier(our haircut prob) vs Brier(market implied price). We
//     must BEAT THE PRICE to claim any edge — being "directionally right" in a
//     market priced at 0.95 is not skill.
//
//   buildMiroJournal(prior, todaySnapshots, resolutions, config) -> journal body

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

// Calibration: bin predictions by our haircut prob, report mean predicted vs
// realized frequency per non-empty bin. Lets you see over/under-confidence.
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

function buildMiroJournal(prior, todaySnapshots, resolutions, config) {
  var jcfg = (config && config.journal) || { recentCap: 200, calibrationBins: 10 };

  // Clone prior state (or start fresh).
  var open = {};
  if (prior && prior.open) Object.keys(prior.open).forEach(function (k) { open[k] = prior.open[k]; });
  var resolved = (prior && prior.resolved) ? prior.resolved.slice() : [];
  var resolvedSlugs = {};
  resolved.forEach(function (r) { resolvedSlugs[r.slug] = true; });

  // 1) Record each market's prediction ONCE, the first time we have a panel for
  //    it. Later snapshots are ignored so the scored prediction is fixed in time.
  (todaySnapshots || []).forEach(function (s) {
    if (s.haircutProb == null) return;
    if (open[s.slug] || resolvedSlugs[s.slug]) return;
    open[s.slug] = {
      firstSeen: s.asOf,
      label: s.label,
      theme: s.theme,
      endDate: s.endDate || null,
      impliedAtFirst: round(s.impliedYes, 4),
      predictedProb: round(s.haircutProb, 4)
    };
  });

  // 2) Resolve markets that have closed: move open -> resolved with the outcome.
  var newlyResolved = 0;
  (resolutions || []).forEach(function (r) {
    var rec = open[r.slug];
    if (!rec) return;                 // we never had a recorded prediction
    if (resolvedSlugs[r.slug]) return;
    resolved.push({
      slug: r.slug,
      label: rec.label,
      theme: rec.theme,
      firstSeen: rec.firstSeen,
      resolvedDate: r.resolvedDate,
      impliedAtFirst: rec.impliedAtFirst,
      predictedProb: rec.predictedProb,
      outcome: r.outcome      // 1 == YES happened, 0 == NO
    });
    resolvedSlugs[r.slug] = true;
    delete open[r.slug];
    newlyResolved++;
  });

  // Cap persisted resolved history (keep most recent).
  if (resolved.length > jcfg.recentCap) resolved = resolved.slice(resolved.length - jcfg.recentCap);

  // 3) Stats: Brier(ours) vs Brier(market price). skill > 0 => we beat the price.
  var brierOurs = brier(resolved, 'predictedProb');
  var brierMarket = brier(resolved, 'impliedAtFirst');
  var skill = (brierOurs == null || brierMarket == null) ? null : brierMarket - brierOurs;

  var caveats = [];
  if (resolved.length === 0) {
    caveats.push('No markets have resolved yet — the journal is accumulating predictions. Brier scores appear once curated markets settle. Expected, honest state: little or no edge over the market price.');
  } else if (resolved.length < 20) {
    caveats.push('Only ' + resolved.length + ' resolved market(s) — indicative, not statistically significant. Beating the price on a handful of events is luck until the sample grows.');
  }
  caveats.push('Benchmark is the market\'s own implied price at first sighting; "skill" is Brier(market) - Brier(ours). Positive means our read beat the price. Research only — never a bet, no execution.');

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
      skill: round(skill, 4)
    },
    calibration: calibration(resolved, jcfg.calibrationBins),
    caveats: caveats
  };
}

export { buildMiroJournal };
