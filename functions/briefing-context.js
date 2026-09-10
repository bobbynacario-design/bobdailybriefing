"use strict";

// functions/briefing-context.js
//
// PURE — no I/O, no clock of its own. Two jobs, both about making the briefing
// know something it currently does not: what Bob is actually exposed to, and
// what it told him to watch yesterday.
//
//   1. buildStandingContext()  his open calls, tracked setups and gated markets
//   2. priorWatch()            yesterday's "one thing to watch", carried forward
//
// WHY (standing context): buildBriefingPrompt() has always described Bob with
// one static line — "a forensic BI consultant who works with Australian
// insurance companies and Philippine consulting firms". That line is identical
// every day, so what comes back is a competent industry newsletter and nothing
// more. Meanwhile the app next door knows his open calls and their invalidation
// lines, which radar setups are confirmed, and which event markets cleared the
// research gate. sharedCommandInputs() has been loading all of it for the
// Command Center since Phase 2; briefing generation simply never asked.
//
// Two failure modes here would cost more than the feature is worth, so the
// prompt rules that ship with this block are as much of the design as the block:
//   - A manufactured link ("this Queensland hail event bears on your open PLTR
//     call") is worse than no link, because it reads exactly like a real one.
//     No-connection is therefore the stated default, not the exception.
//   - A briefing that starts recommending entries, exits or sizes has stopped
//     being a briefing. Nothing in this app generates advice, and this block —
//     the first time the model can see a position at all — must not be where
//     that changes.
//
// WHY (prior watch): `watch` is the highest-value field in the schema and has
// been write-only since it was added. Nothing ever read it back, so it could be
// wrong for a fortnight without anyone noticing. Carrying yesterday's forward
// costs about 60 tokens and converts it from a parting thought into a claim
// that gets marked the next morning.
//
// NOTE ON THE DUPLICATED isTracked: lib/decision-drift.js owns the canonical
// rule for which journal entries are live. This file cannot import it — lib/ is
// ESM and ships separately from the deployed functions bundle, the same reason
// briefing-evidence.js carries its own URL normalizer — so an equivalent lives
// here. If the rule for "open call" changes there, change it here too, or the
// briefing will reason about a set of positions the Decisions tab disagrees with.

// Bounds. The point of this block is a glance at Bob's exposure, not a data
// dump: past roughly this size it stops being context the model can hold
// against every story and becomes a second document competing with the news
// evidence for attention. At ~25 tokens a line the whole block stays well under
// 1k input tokens.
const MAX_DECISIONS = 10;
const MAX_RADAR = 8;
const MAX_MARKETS = 5;
const MAX_FIELD_CHARS = 160;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

// Absent means absent. Number(null) is 0, and a market printed as "0% implied"
// is not a missing price — it is a confident claim that the event will not
// happen, which is the one thing a blank field never said.
function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Bob's typed thesis and invalidation lines land in a line-oriented block, so
// internal newlines have to collapse — one multi-line reason would otherwise
// silently reshape every entry printed after it.
function line(value, limit) {
  const flat = text(value).replace(/\s+/g, " ");
  const max = limit || MAX_FIELD_CHARS;
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

// Live calls only. 'closed' is history, and 'skipped' means he looked and chose
// not to act, so neither is exposure the briefing should reason about.
function isTracked(entry) {
  if (!entry) return false;
  const status = text(entry.status) || "open";
  const action = text(entry.action) || "watched";
  return status !== "closed" && action !== "skipped";
}

function decisionLines(decisions) {
  return arr(decisions)
    .filter(isTracked)
    .sort((a, b) => Number((b && b.saved) || 0) - Number((a && a.saved) || 0))
    .slice(0, MAX_DECISIONS)
    .map((entry) => {
      const asset = line(entry.asset || entry.subject, 40) || "(unnamed)";
      const bits = [asset];
      const direction = text(entry.direction);
      if (direction && direction !== "none") bits.push(direction);
      const action = text(entry.action);
      if (action) bits.push(action);
      const logged = text(entry.createdDate);
      if (logged) bits.push("logged " + logged);
      let out = "- " + bits.join(" / ");
      const reason = line(entry.reason);
      if (reason) out += "\n  thesis: " + reason;
      const invalidator = line(entry.invalidator);
      if (invalidator) out += "\n  wrong if: " + invalidator;
      return out;
    });
}

function radarLines(radar) {
  return arr(radar && radar.signals)
    .filter((signal) => signal &&
      (signal.status === "confirmed" || signal.status === "forming"))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, MAX_RADAR)
    .map((signal) => {
      const why = line(signal.catalyst || signal.why, 120);
      return "- " + line(signal.symbol, 20) + " / " + text(signal.status) +
        (why ? " / " + why : "");
    });
}

// Only GO markets. One the research gate did not clear is not something Bob is
// leaning on, and listing the whole board would drown the calls above it.
function marketLines(markets) {
  return arr(markets && markets.markets)
    .filter((market) => market && text(market.gate).toUpperCase() === "GO")
    .slice(0, MAX_MARKETS)
    .map((market) => {
      const label = line(market.label || market.question || market.slug, 120) ||
        "(unlabelled market)";
      const implied = num(market.impliedYes);
      return "- " + label +
        (implied == null ? "" : " / " + Math.round(implied * 100) + "% implied");
    });
}

// Returns null when Bob has nothing open anywhere. That is a real state — a
// quiet week, or a first run — and an empty "here is your exposure" heading
// followed by nothing is an invitation to fill the silence.
function buildStandingContext(input) {
  const source = input || {};
  const decisions = decisionLines(source.decisions);
  const radar = radarLines(source.radar);
  const markets = marketLines(source.markets);
  if (!decisions.length && !radar.length && !markets.length) return null;

  const parts = [
    "STANDING CONTEXT — Bob's own open state. This is private working state, " +
      "not news, and none of it is a story to report.",
  ];
  if (decisions.length) {
    parts.push("", "OPEN CALLS (his decision journal):", decisions.join("\n"));
  }
  if (radar.length) {
    parts.push("", "RADAR SETUPS (confirmed or forming):", radar.join("\n"));
  }
  if (markets.length) {
    parts.push("", "EVENT MARKETS PAST THE RESEARCH GATE:", markets.join("\n"));
  }

  return {
    block: parts.join("\n"),
    stats: {
      decisions: decisions.length,
      radar: radar.length,
      markets: markets.length,
    },
  };
}

// Pull the previous briefing's watch item forward. `briefings` is a list of
// already-parsed briefing objects tagged with the PHT date they were saved on,
// newest first; the caller does the reading and the JSON parsing.
//
// Same-day docs are skipped deliberately. Regenerating today's briefing must
// not hand the model its own watch line from twenty minutes ago and ask it to
// grade the overnight development — it would be marking its own homework and
// would always find the story unchanged.
function priorWatch(briefings, todayKey) {
  const today = text(todayKey);
  let found = null;
  arr(briefings).some((row) => {
    if (!row || !row.briefing) return false;
    const dateKey = text(row.dateKey);
    if (today && dateKey && dateKey === today) return false;
    const watch = line(row.briefing.watch, 600);
    if (!watch) return false;
    found = {
      text: watch,
      source: line(row.briefing.watch_source, 80),
      dateKey: dateKey,
      dateLabel: line(row.briefing.date, 60),
    };
    return true;
  });
  return found;
}

module.exports = {buildStandingContext, priorWatch, isTracked};
