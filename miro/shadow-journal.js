// miro/shadow-journal.js — PURE. The model contest behind the Markets panel.
//
// The live journal locks each market once, at its first panel read, so the
// live model's locks are older than any shadow's. A fair contest needs every
// model locked at the same moment on the same facts. So this ledger locks a
// market the first time a read carries shadow reads: the live model's reads,
// each shadow model's, and the price, all from that one read. At resolution
// each model is scored raw and after the card's haircut, beside the price.
//
//   buildShadowJournal(prior, markets, resolutions, asOf, liveModel, hc, readSummary)

function round(v, dp) { if (v == null || isNaN(v)) return null; var m = Math.pow(10, dp || 0); return Math.round(v * m) / m; }
function brier(rows, get) {
  var xs = rows.map(function (r) { var p = get(r); return p == null ? null : Math.pow(p - r.outcome, 2); }).filter(function (v) { return v != null; });
  return xs.length ? round(xs.reduce(function (a, b) { return a + b; }, 0) / xs.length, 4) : null;
}

function buildShadowJournal(prior, markets, resolutions, asOf, liveModel, hc, readSummary) {
  var open = Object.assign({}, prior && prior.open);
  var resolved = (prior && prior.resolved || []).slice();
  var done = {};
  resolved.forEach(function (r) { done[r.slug] = true; });

  (markets || []).forEach(function (m) {
    var pr = m.panelRead;
    if (!pr || !pr.shadow || open[m.slug] || done[m.slug]) return;
    var anchor = m.anchor != null ? m.anchor : (m.mid != null ? m.mid : m.impliedYes);
    var models = {};
    var live = readSummary(pr.reads, anchor, hc);
    if (live) models[pr.model || liveModel] = live;
    Object.keys(pr.shadow).forEach(function (name) {
      var s = readSummary(pr.shadow[name], anchor, hc);
      if (s) models[name] = s;
    });
    if (Object.keys(models).length < 2) return;   // nothing to compare
    open[m.slug] = { slug: m.slug, label: m.label, lockedAt: asOf, readAt: pr.readAt, live: pr.model || liveModel,
      price: round(anchor, 4), models: models };
  });

  var newly = 0;
  (resolutions || []).forEach(function (r) {
    var rec = open[r.slug];
    if (!rec || done[r.slug]) return;
    resolved.push(Object.assign({}, rec, { outcome: r.outcome, resolvedDate: r.resolvedDate }));
    done[r.slug] = true;
    delete open[r.slug];
    newly++;
  });

  // Each model on the markets it read; the price on those same markets.
  var names = {};
  resolved.forEach(function (r) { Object.keys(r.models).forEach(function (k) { names[k] = true; }); });
  var models = Object.keys(names).sort().map(function (name) {
    var rows = resolved.filter(function (r) { return r.models[name]; });
    return { model: name, n: rows.length,
      brierRaw: brier(rows, function (r) { return r.models[name].raw; }),
      brierCut: brier(rows, function (r) { return r.models[name].cut; }),
      brierPrice: brier(rows, function (r) { return r.price; }) };
  });
  var live = (open[Object.keys(open)[0]] || resolved[resolved.length - 1] || {}).live || liveModel;
  return { asOf: asOf, open: open, resolved: resolved,
    stats: { nOpen: Object.keys(open).length, nResolved: resolved.length, newlyResolved: newly, live: live, models: models } };
}

// Which of the markets about to be read the shadow models should read
// (17 Oct 2026). A market joins the contest once, at its first shadow read,
// so a later shadow read of it adds nothing to the contest: only markets not
// yet in it are read, and none once the contest has closed to new markets
// (`until`, a YYYY-MM-DD Manila date; blank = no end). Locked markets are
// still scored, free, as they resolve.
function shadowTargets(markets, journal, asOf, until) {
  if (until && asOf > until) return [];
  var locked = {};
  Object.keys((journal && journal.open) || {}).forEach(function (slug) { locked[slug] = true; });
  ((journal && journal.resolved) || []).forEach(function (r) { if (r && r.slug) locked[r.slug] = true; });
  return (markets || []).filter(function (m) { return m && m.slug && !locked[m.slug]; });
}

export { buildShadowJournal, shadowTargets };
