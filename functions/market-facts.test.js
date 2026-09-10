"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseYahooChart, parseOpenMeteo, parsePhSnapshot,
  buildFacts, applyFacts, fmtLevel, fmtMove, pctChange,
} = require("./market-facts");

function chart(closes, startSec) {
  const base = startSec || Date.parse("2026-09-08T00:00:00Z") / 1000;
  return {
    chart: {
      result: [{
        timestamp: closes.map((_, i) => base + i * 86400),
        indicators: {quote: [{close: closes}]},
      }],
    },
  };
}

function phDoc(over) {
  return Object.assign({
    asOf: "2026-09-10",
    index: {symbol: "PSEI.PS", asOf: "2026-09-10", close: 6450.234, dayChangePct: 0.81},
    fx: {usdphp: {level: 58.4231, dayChangePct: 0.18}},
  }, over || {});
}

function meteo(over) {
  return {
    daily: Object.assign({
      time: ["2026-09-11"],
      temperature_2m_max: [32.4],
      temperature_2m_min: [26.6],
      precipitation_probability_max: [70],
      weather_code: [95],
    }, over || {}),
  };
}

// ── formatting ──

test("index levels group thousands, FX crosses do not", () => {
  assert.equal(fmtLevel(6450.234, true), "6,450.23");
  assert.equal(fmtLevel(58.4231, false), "58.42");
  assert.equal(fmtLevel(null, true), "");
});

test("moves carry a sign and a direction word", () => {
  assert.equal(fmtMove(0.812), "+0.81% Up");
  assert.equal(fmtMove(-0.3), "-0.30% Down");
  assert.equal(fmtMove(0), "0.00% Flat");
  assert.equal(fmtMove(null), "");
});

// A rising USD/PHP is a weaker peso, not an "up" peso.
test("the peso move is named in peso terms", () => {
  assert.equal(fmtMove(0.18, "Peso weaker", "Peso stronger"), "+0.18% Peso weaker");
  assert.equal(fmtMove(-0.18, "Peso weaker", "Peso stronger"), "-0.18% Peso stronger");
});

test("pctChange guards a zero or missing base", () => {
  assert.equal(Math.round(pctChange(110, 100) * 100) / 100, 10);
  assert.equal(pctChange(110, 0), null);
  assert.equal(pctChange(110, null), null);
});

// ── parseYahooChart ──

test("reads the last close and the one before it", () => {
  const out = parseYahooChart(chart([100, 102]));
  assert.equal(out.close, 102);
  assert.equal(out.prevClose, 100);
  assert.equal(out.asOf, "2026-09-09");
});

// A half-formed session leaves nulls in the array; the last two REAL closes are
// what matter, not the last two slots.
test("skips null closes rather than treating them as bars", () => {
  const out = parseYahooChart(chart([100, null, 102, null]));
  assert.equal(out.close, 102);
  assert.equal(out.prevClose, 100);
});

test("returns null for an empty or malformed chart", () => {
  assert.equal(parseYahooChart(null), null);
  assert.equal(parseYahooChart({}), null);
  assert.equal(parseYahooChart(chart([])), null);
  assert.equal(parseYahooChart(chart([null, null])), null);
});

test("a single bar yields a close with no previous", () => {
  const out = parseYahooChart(chart([100]));
  assert.equal(out.close, 100);
  assert.equal(out.prevClose, null);
});

// ── parseOpenMeteo ──

test("builds a forecast with a mapped condition", () => {
  const out = parseOpenMeteo(meteo());
  assert.equal(out.summary, "Thunderstorms");
  assert.equal(out.tempC, "27-32C");
  assert.equal(out.rainChance, "70%");
  assert.equal(out.asOf, "2026-09-11");
});

test("an unknown weather code leaves the summary empty rather than guessing", () => {
  assert.equal(parseOpenMeteo(meteo({weather_code: [1234]})).summary, "");
});

test("returns null when there is no usable forecast", () => {
  assert.equal(parseOpenMeteo(null), null);
  assert.equal(parseOpenMeteo({daily: {time: []}}), null);
  assert.equal(parseOpenMeteo({daily: {time: ["2026-09-11"], temperature_2m_max: [null],
    temperature_2m_min: [null], precipitation_probability_max: [null]}}), null);
});

// ── parsePhSnapshot ──

test("takes PSEi and USD/PHP out of the radar-ph document", () => {
  const out = parsePhSnapshot(phDoc());
  assert.equal(out.psei.close, 6450.23);
  assert.equal(out.psei.asOf, "2026-09-10");
  assert.equal(out.usdphp.close, 58.42);
});

test("a snapshot missing FX still yields the index", () => {
  const out = parsePhSnapshot(phDoc({fx: {}}));
  assert.ok(out.psei);
  assert.equal(out.usdphp, null);
});

test("survives a missing or empty snapshot", () => {
  assert.deepEqual(parsePhSnapshot(null), {psei: null, usdphp: null});
  assert.deepEqual(parsePhSnapshot({}), {psei: null, usdphp: null});
});

// ── buildFacts ──

test("assembles every figure with its as-of and source", () => {
  const facts = buildFacts({
    ph: phDoc(),
    asx: parseYahooChart(chart([8127.0, 8102.5])),
    sp500: parseYahooChart(chart([5860.0, 5890.12])),
    weather: parseOpenMeteo(meteo()),
  });
  assert.deepEqual(facts.missing, []);
  assert.match(facts.values.psei, /^6,450\.23 \(as of 2026-09-10, Yahoo PSEI\.PS\)$/);
  assert.equal(facts.values.psei_move, "+0.81% Up");
  assert.match(facts.values.asx, /^8,102\.50 \(as of 2026-09-09, Yahoo \^AXJO\)$/);
  assert.equal(facts.values.asx_move, "-0.30% Down");
  assert.equal(facts.values.usdphp_move, "+0.18% Peso weaker");
  assert.equal(facts.values.weather.temp_c, "27-32C");
  assert.ok(facts.lines.some((line) => line.includes("Metro Manila forecast")));
});

test("names what is missing instead of quietly dropping it", () => {
  const facts = buildFacts({ph: phDoc(), asx: null, sp500: null, weather: null});
  assert.deepEqual(facts.missing, ["ASX 200", "S&P 500", "Metro Manila forecast"]);
  assert.equal(facts.values.asx, "");
  assert.equal(facts.values.asx_move, "");
  assert.ok(facts.values.psei);
});

test("everything missing produces no lines at all", () => {
  const facts = buildFacts({});
  assert.equal(facts.available, 0);
  assert.equal(facts.lines.length, 0);
  assert.equal(facts.missing.length, 5);
});

// ── applyFacts ──

function modelBriefing() {
  return {
    markets: {psei: "6,000.00", psei_move: "+9.0% Up", asx: "9,999.99", asx_move: "+1% Up",
      sp500: "1.00", sp500_move: "+1% Up"},
    peso: {usdphp: "50.00", usdphp_move: "-5% Peso stronger", driver: "Model prose stays."},
    weather: {location: "Metro Manila", summary: "Sunny", temp_c: "20-21C",
      rain_chance: "0%", impact: "Model impact note stays."},
  };
}

test("replaces the model's figures with the fetched ones", () => {
  const facts = buildFacts({ph: phDoc(), weather: parseOpenMeteo(meteo())});
  const out = applyFacts(modelBriefing(), facts);
  assert.match(out.briefing.markets.psei, /^6,450\.23 /);
  assert.equal(out.briefing.peso.usdphp_move, "+0.18% Peso weaker");
  assert.equal(out.briefing.weather.summary, "Thunderstorms");
  assert.ok(out.stats.corrected >= 4, "expected the invented figures to be counted as corrections");
});

// The whole point: prose is the model's, arithmetic is not.
test("never touches the prose fields", () => {
  const facts = buildFacts({ph: phDoc(), weather: parseOpenMeteo(meteo())});
  const out = applyFacts(modelBriefing(), facts);
  assert.equal(out.briefing.peso.driver, "Model prose stays.");
  assert.equal(out.briefing.weather.impact, "Model impact note stays.");
  assert.equal(out.briefing.weather.location, "Metro Manila");
});

// An unverified number in a ticker looks exactly like a verified one, so a
// figure with no source must not survive.
test("blanks a field it could not verify instead of keeping the guess", () => {
  const facts = buildFacts({ph: phDoc()});
  const out = applyFacts(modelBriefing(), facts);
  assert.equal(out.briefing.markets.asx, "");
  assert.equal(out.briefing.markets.asx_move, "");
  assert.equal(out.briefing.markets.sp500, "");
  assert.ok(out.stats.blanked >= 4);
  assert.ok(out.stats.fields.includes("asx"));
});

test("a matching figure counts as applied but not corrected", () => {
  const facts = buildFacts({ph: phDoc()});
  const briefing = {markets: {psei: "6,450.23"}, peso: {}};
  const out = applyFacts(briefing, facts);
  assert.equal(out.stats.corrected, 0);
  assert.ok(out.stats.applied > 0);
});

test("fills in objects the model omitted entirely", () => {
  const facts = buildFacts({ph: phDoc(), weather: parseOpenMeteo(meteo())});
  const out = applyFacts({}, facts);
  assert.match(out.briefing.markets.psei, /^6,450\.23 /);
  assert.equal(out.briefing.weather.location, "Metro Manila");
  assert.equal(out.stats.corrected, 0);
});

test("with no facts at all the briefing is returned untouched", () => {
  const briefing = modelBriefing();
  const out = applyFacts(briefing, null);
  assert.equal(out.briefing.markets.psei, "6,000.00");
  assert.equal(out.stats.applied, 0);
});

test("survives a null briefing", () => {
  const facts = buildFacts({ph: phDoc()});
  const out = applyFacts(null, facts);
  assert.match(out.briefing.markets.psei, /^6,450\.23 /);
});

// The provenance parenthetical is appended by us, not produced by the model, so
// it must not register as a disagreement.
test("provenance text is not counted as a correction", () => {
  const facts = buildFacts({ph: phDoc()});
  const out = applyFacts({markets: {psei: "6,450.23 (whatever the model wrote)"}, peso: {}}, facts);
  assert.equal(out.stats.corrected, 0);
});
