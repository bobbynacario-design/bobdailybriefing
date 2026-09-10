"use strict";

// functions/market-facts.js
//
// PURE — no I/O, no clock of its own. The numbers at the top of the briefing,
// turned from model guesses into fetched facts.
//
//   parseYahooChart()  a Yahoo chart response -> {close, prevClose, asOf}
//   parseOpenMeteo()   an open-meteo response -> today's Metro Manila forecast
//   buildFacts()       those, plus the radar-ph snapshot -> prompt lines
//   applyFacts()       overwrite what the model returned with what is true
//
// WHY: the rule these replace read, in full, "Market values should be current
// and realistic." That is an instruction to produce plausible fiction, and the
// briefing was carrying it out faithfully — PSEi, ASX, S&P 500, USD/PHP and the
// Manila forecast were all generated, over a hosted web_search the model was
// free not to call, with no as-of date and no verification of any kind. They sit
// in the ticker at the very top of the page, so a wrong PSEi print is the first
// thing read and it discredits every story underneath it.
//
// Two of the four numbers were already being fetched by this app and thrown
// away: radar/ph-snapshot.js writes the real PSEi close and USD/PHP cross to
// briefings-bob/radar-ph twice a day, with an asOf. The other two indices and
// the forecast are one HTTP call each.
//
// ON OVERWRITING: applyFacts does not check whether the model copied the figures
// correctly and then trust it — it replaces the fields outright, and blanks any
// field it has no verified figure for. This follows verifyGrounding's reasoning
// exactly: a returned URL that was never supplied is worse than no URL because
// it looks citable, and an unverified index level is worse than a blank for the
// same reason. It looks like data. A blank ticker cell reads as "not available",
// which is both true and useful; "8,102.50" reads as Thursday's close.

const WMO = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  66: "Freezing rain", 67: "Heavy freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light rain showers", 81: "Rain showers", 82: "Violent rain showers",
  85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorms", 96: "Thunderstorms with hail", 99: "Severe thunderstorms with hail",
};

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value) {
  const n = num(value);
  return n == null ? null : Math.round(n * 100) / 100;
}

// Index levels read as "8,102.50"; an FX cross at four figures would read as
// "58.42" and must not pick up a separator it never has.
function fmtLevel(value, group) {
  const n = num(value);
  if (n == null) return "";
  const fixed = n.toFixed(2);
  if (!group) return fixed;
  const parts = fixed.split(".");
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + parts[1];
}

// "+0.8% Up" / "-0.3% Down" / "0.0% Flat", matching the shape the ticker's
// mover class already parses out of this string.
function fmtMove(pct, upWord, downWord) {
  const n = num(pct);
  if (n == null) return "";
  const rounded = Math.round(n * 100) / 100;
  const word = rounded > 0 ? (upWord || "Up") : rounded < 0 ? (downWord || "Down") : "Flat";
  const sign = rounded > 0 ? "+" : "";
  return sign + rounded.toFixed(2) + "% " + word;
}

function pctChange(close, prevClose) {
  const a = num(close);
  const b = num(prevClose);
  if (a == null || b == null || b === 0) return null;
  return (a / b - 1) * 100;
}

// Yahoo's chart response. Closes can be null for a half-formed session, so the
// last two NON-NULL closes are what matter, not the last two slots.
function parseYahooChart(json) {
  const result = json && json.chart && json.chart.result && json.chart.result[0];
  if (!result || !Array.isArray(result.timestamp)) return null;
  const quote = (result.indicators && result.indicators.quote &&
    result.indicators.quote[0]) || {};
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const bars = [];
  for (let i = 0; i < result.timestamp.length; i += 1) {
    const close = num(closes[i]);
    if (close == null) continue;
    bars.push({close, date: new Date(result.timestamp[i] * 1000).toISOString().slice(0, 10)});
  }
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  return {
    close: last.close,
    prevClose: prev ? prev.close : null,
    asOf: last.date,
  };
}

function parseOpenMeteo(json) {
  const daily = json && json.daily;
  if (!daily || !Array.isArray(daily.time) || !daily.time.length) return null;
  const max = num(daily.temperature_2m_max && daily.temperature_2m_max[0]);
  const min = num(daily.temperature_2m_min && daily.temperature_2m_min[0]);
  const rain = num(daily.precipitation_probability_max &&
    daily.precipitation_probability_max[0]);
  const code = num(daily.weather_code && daily.weather_code[0]);
  if (max == null && min == null && rain == null) return null;
  return {
    asOf: String(daily.time[0]),
    summary: code == null ? "" : (WMO[code] || ""),
    tempC: (min == null || max == null) ? "" :
      Math.round(min) + "-" + Math.round(max) + "C",
    rainChance: rain == null ? "" : Math.round(rain) + "%",
  };
}

// Pull PSEi and USD/PHP out of the radar-ph snapshot that radar/ph-snapshot.js
// already writes. Its own asOf is the trading date of the last bar, which is
// what belongs on the figure — not the time the document was written.
function parsePhSnapshot(phDoc) {
  const out = {psei: null, usdphp: null};
  if (!phDoc) return out;
  const index = phDoc.index;
  if (index && num(index.close) != null) {
    out.psei = {
      close: round2(index.close),
      changePct: round2(index.dayChangePct),
      asOf: String(index.asOf || phDoc.asOf || ""),
      source: "Yahoo " + (index.symbol || "PSEI.PS"),
    };
  }
  const usdphp = phDoc.fx && phDoc.fx.usdphp;
  if (usdphp && num(usdphp.level) != null) {
    out.usdphp = {
      close: round2(usdphp.level),
      changePct: round2(usdphp.dayChangePct),
      asOf: String(phDoc.asOf || ""),
      source: "Yahoo USDPHP=X",
    };
  }
  return out;
}

function quoteFact(quote, source) {
  if (!quote || num(quote.close) == null) return null;
  return {
    close: round2(quote.close),
    changePct: round2(pctChange(quote.close, quote.prevClose)),
    asOf: String(quote.asOf || ""),
    source,
  };
}

function provenance(fact) {
  const bits = [];
  if (fact.asOf) bits.push("as of " + fact.asOf);
  if (fact.source) bits.push(fact.source);
  return bits.length ? " (" + bits.join(", ") + ")" : "";
}

// Build the display strings and the prompt lines in one pass, so the figure the
// model is shown and the figure written into the briefing cannot diverge.
//
// input: {ph, asx, sp500, weather} — ph is the radar-ph document, asx and sp500
// are parseYahooChart results, weather is a parseOpenMeteo result. Any may be
// null; each missing piece costs only its own fields.
function buildFacts(input) {
  const source = input || {};
  const ph = parsePhSnapshot(source.ph);
  const facts = {
    psei: ph.psei,
    usdphp: ph.usdphp,
    asx: quoteFact(source.asx, "Yahoo ^AXJO"),
    sp500: quoteFact(source.sp500, "Yahoo ^GSPC"),
  };

  const values = {};
  const lines = [];
  const missing = [];

  // The as-of and source ride along inside the value string. AppReliability
  // .metric() splits a trailing parenthetical off for the ticker's "As of /
  // details" disclosure, so this puts the provenance one click from the number
  // without any change to the ticker itself.
  function place(key, fact, label, group, upWord, downWord, moveKey) {
    if (!fact) {
      missing.push(label);
      values[key] = "";
      values[moveKey] = "";
      return;
    }
    values[key] = fmtLevel(fact.close, group) + provenance(fact);
    values[moveKey] = fmtMove(fact.changePct, upWord, downWord);
    lines.push("- " + label + ": " + fmtLevel(fact.close, group) +
      (values[moveKey] ? ", " + values[moveKey] : "") + provenance(fact));
  }

  place("psei", facts.psei, "PSEi", true, "Up", "Down", "psei_move");
  place("asx", facts.asx, "ASX 200", true, "Up", "Down", "asx_move");
  place("sp500", facts.sp500, "S&P 500", true, "Up", "Down", "sp500_move");
  // A rising USD/PHP is a WEAKER peso. Naming the direction in peso terms is the
  // whole point of the field; "+0.18% Up" would be true of the cross and
  // backwards about the currency Bob cares about.
  place("usdphp", facts.usdphp, "USD/PHP", false, "Peso weaker", "Peso stronger", "usdphp_move");

  const weather = source.weather || null;
  if (weather) {
    values.weather = {
      summary: weather.summary || "",
      temp_c: weather.tempC || "",
      rain_chance: weather.rainChance || "",
      asOf: weather.asOf || "",
    };
    lines.push("- Metro Manila forecast: " +
      [weather.summary, weather.tempC, weather.rainChance ? weather.rainChance + " chance of rain" : ""]
        .filter(Boolean).join(", ") +
      (weather.asOf ? " (for " + weather.asOf + ", open-meteo.com)" : ""));
  } else {
    missing.push("Metro Manila forecast");
  }

  return {values, lines, missing, available: lines.length};
}

// Replace the model's figures with the fetched ones and report what changed.
// Fields with no verified figure are BLANKED rather than left as returned — see
// the header note; an unverified number in a ticker is not a smaller problem
// than a missing one, it is a larger one.
//
// Prose the model owns (peso driver, weather impact, weather location) is never
// touched.
function applyFacts(briefing, facts) {
  const out = briefing && typeof briefing === "object" ? briefing : {};
  if (!facts || !facts.values) {
    return {briefing: out, stats: {applied: 0, blanked: 0, corrected: 0, fields: []}};
  }
  const values = facts.values;
  const stats = {applied: 0, blanked: 0, corrected: 0, fields: []};

  function set(target, key, value) {
    const had = String(target[key] == null ? "" : target[key]).trim();
    target[key] = value;
    if (value) {
      stats.applied += 1;
      // Compare on the leading figure only: the model was never asked to
      // reproduce the parenthetical provenance we append here.
      if (had && had.split(" (")[0] !== value.split(" (")[0]) {
        stats.corrected += 1;
        stats.fields.push(key);
      }
    } else if (had) {
      stats.blanked += 1;
      stats.fields.push(key);
    }
  }

  const markets = out.markets && typeof out.markets === "object" ? out.markets : {};
  ["psei", "psei_move", "asx", "asx_move", "sp500", "sp500_move"].forEach((key) => {
    if (values[key] != null) set(markets, key, values[key]);
  });
  out.markets = markets;

  const peso = out.peso && typeof out.peso === "object" ? out.peso : {};
  ["usdphp", "usdphp_move"].forEach((key) => {
    if (values[key] != null) set(peso, key, values[key]);
  });
  out.peso = peso;

  if (values.weather) {
    const weather = out.weather && typeof out.weather === "object" ? out.weather : {};
    set(weather, "summary", values.weather.summary);
    set(weather, "temp_c", values.weather.temp_c);
    set(weather, "rain_chance", values.weather.rain_chance);
    if (!String(weather.location || "").trim()) weather.location = "Metro Manila";
    out.weather = weather;
  }

  return {briefing: out, stats};
}

module.exports = {
  parseYahooChart, parseOpenMeteo, parsePhSnapshot,
  buildFacts, applyFacts, fmtLevel, fmtMove, pctChange,
};
