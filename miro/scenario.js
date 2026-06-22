// miro/scenario.js
//
// PURE scenario engine for the Event-Markets "scenario read". No I/O of any kind
// (no fetch, no Firestore, no Date) — everything arrives via arguments. Same
// discipline as radar/scoring.js, so the exact module can run unchanged inside a
// future scheduled Cloud Function.
//
//   aggregatePanel(markets, config) -> markets enriched with panel/edge/gate
//
// `markets` is the array from refresh-miro.js; each entry that has a panel carries
// `panelReads`: an array of independent persona probabilities (0..1) for the YES
// outcome. The personas are deliberately BLIND to the market's own price, so the
// comparison below is between an independent read and the price — not the price
// echoed back to itself.
//
// The pipeline, per market:
//   1. panelProb       = mean of the persona reads
//   2. panelDispersion = population stdev of the reads (how split the panel is)
//   3. haircutProb     = shrink the panel toward 0.5 (a correlated LLM panel is
//                        NOT an independent weather ensemble — its confidence is
//                        partly cosmetic, so we trust it less, more so when the
//                        panel disagrees with itself)
//   4. edge            = |haircutProb - impliedYes| - round-trip cost, with the
//                        side (YES/NO) you'd have to take to capture it
//   5. gate            = GO only if NOT closed, liquid enough, panel not too
//                        split, and edge clears the threshold. Otherwise NO-GO
//                        with the FIRST failed check named — "if even one check
//                        fails, you don't have a trade, you have a story."

function mean(arr) {
  if (!arr.length) return null;
  var s = 0;
  for (var i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function stdev(arr, mu) {
  if (arr.length < 2) return 0;
  var s = 0;
  for (var i = 0; i < arr.length; i++) { var d = arr[i] - mu; s += d * d; }
  return Math.sqrt(s / arr.length); // population stdev
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function round(v, dp) {
  if (v === null || v === undefined || isNaN(v)) return null;
  var m = Math.pow(10, dp || 0);
  return Math.round(v * m) / m;
}

// Keep only finite probabilities in [0,1] — guards against a persona returning
// junk (NaN, >1, negative) without poisoning the mean.
function cleanReads(reads) {
  if (!Array.isArray(reads)) return [];
  return reads.filter(function (p) {
    return typeof p === 'number' && isFinite(p) && p >= 0 && p <= 1;
  });
}

// Shrink the panel toward the MARKET PRICE (the efficient prior), not toward 0.5.
// Near-efficient markets are best estimated by their own price; the panel only
// earns a move off it, and only a FRACTION k of its deviation (k<1) because a
// one-model persona panel shares that model's calibration biases. k falls as
// panel dispersion rises (less agreement -> less trust), floored so a confident,
// tight panel is never fully erased.
//
// Anchoring on the price is also what keeps the longshot personas honest: on a
// 2%-priced market a panel that (correctly) says ~0% must NOT get pulled up to
// 0.5 — that would manufacture fake YES-edge everywhere. Edge then reduces to
// k * (panelProb - price), i.e. you only profit in proportion to a real,
// dispersion-discounted disagreement with the price.
function haircut(panelProb, impliedYes, dispersion, hc) {
  var k = clamp(hc.baseShrink - hc.dispersionPenalty * dispersion, hc.minShrink, hc.baseShrink);
  return { prob: impliedYes + k * (panelProb - impliedYes), k: k };
}

// minReads: a single persona is not a panel. Below this we decline to produce a
// read (panel fields stay null -> the front end shows "implied only").
var MIN_READS = 3;

function aggregateOne(m, config) {
  var hc = config.haircut, fees = config.fees, gate = config.edgeGate;
  var reads = cleanReads(m.panelReads);

  // Not enough independent reads -> no panel for this market (graceful).
  if (reads.length < MIN_READS) {
    return Object.assign({}, m, {
      panelN: reads.length,
      panelProb: null, panelDispersion: null, haircutProb: null, haircutK: null,
      edge: null, edgeSide: null, gate: null, gateReason: null
    });
  }

  var panelProb = mean(reads);
  var dispersion = stdev(reads, panelProb);
  var hcRes = haircut(panelProb, m.impliedYes, dispersion, hc);
  var haircutProb = clamp(hcRes.prob, 0, 1);

  var rawGap = haircutProb - m.impliedYes;          // + => our read is higher than YES price
  var edgeSide = rawGap >= 0 ? 'YES' : 'NO';
  var edge = Math.abs(rawGap) - fees.roundTripCost; // executable edge after spread

  // Gate — first failed check wins the reason.
  var pass = true, reason = null;
  if (m.closed) { pass = false; reason = 'closed'; }
  else if (m.liquidityNum != null && m.liquidityNum < gate.minLiquidityNum) { pass = false; reason = 'thin'; }
  else if (dispersion > gate.maxDispersion) { pass = false; reason = 'panel-split'; }
  else if (edge < gate.minEdge) { pass = false; reason = 'no-edge'; }

  return Object.assign({}, m, {
    panelN: reads.length,
    panelProb: round(panelProb, 4),
    panelDispersion: round(dispersion, 4),
    haircutProb: round(haircutProb, 4),
    haircutK: round(hcRes.k, 3),
    edge: round(edge, 4),
    edgeSide: edgeSide,
    gate: pass ? 'GO' : 'NO-GO',
    gateReason: reason
  });
}

// Enrich every market. Pure: returns a new array, mutates nothing.
function aggregatePanel(markets, config) {
  return (markets || []).map(function (m) { return aggregateOne(m, config); });
}

export { aggregatePanel };
