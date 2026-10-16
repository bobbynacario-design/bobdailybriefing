"use strict";

// This week's health research (lane 6): up to three recent, well-evidenced
// findings on sleep, activity, nutrition, alcohol, ageing and stress, found
// by a web search on Sunday and shown on Today and in the weekly review.
//
// Nothing about his body goes to the model: no steps, sleep, check-in answers
// or check-up dates. Only his age band (from Health basics, if he gave a
// birth year) and a fixed line about how he lives, so the findings can be
// chosen and explained for him. A source is kept only if the search returned
// it, as with Go deeper. It reports what studies found; it gives no advice
// on treatment, medicines or supplements. Pure: index.js does the call.
const {urlKey} = require("./briefing-evidence");

const TOPICS = ["sleep", "activity", "nutrition", "alcohol", "ageing", "stress"];
const EVIDENCE = ["meta-analysis", "randomised trial", "large cohort", "guideline", "systematic review"];
// What a finding can show: a cohort only a link; a guideline is guidance; a
// trial (or a pooled analysis of trials) can show cause.
const SHOWS = ["association", "cause", "guidance"];
const MAX_ITEMS = 3;
const KEEP_WEEKS = 12;

const SYSTEM = [
  "You find recent health research for one person and explain it plainly.",
  "Use web search. Pick up to three findings published in the last 14 days (30 if the fortnight is thin) on sleep, physical activity, nutrition, alcohol, ageing or stress.",
  "Only these kinds of evidence count: a meta-analysis, a systematic review, a randomised trial, a large cohort study (thousands of people), or a guideline from a national or international health body.",
  "Leave out: animal or cell studies, single small studies, supplement or product promotion, press releases with no study behind them, and anything about a medicine or treatment.",
  "Link the study itself or a reputable report of it (a journal, a university, a health body, a major newspaper). Never invent a link; use only pages your search returned.",
  "Say what was found and how big the effect was in plain words, and say plainly when a study shows a link rather than cause and effect.",
  "Do not give medical advice. A suggestion to try is a small everyday habit, never a test, medicine, supplement or diet.",
  "Reply with JSON only, no prose around it.",
].join("\n");

function text(value, max) {
  const s = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (!max || s.length <= max) return s;
  const cut = s.slice(0, max), space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "") + "…";
}
function ageBand(birthYear, todayKey) {
  const y = Number(birthYear), now = Number(String(todayKey || "").slice(0, 4));
  if (!(y >= 1920 && now - y >= 16)) return "";
  const a = now - y;
  return Math.floor(a / 10) * 10 + "s";
}

function buildResearchPrompt(input) {
  input = input || {};
  const who = (input.ageBand ? "A man in his " + input.ageBand : "An adult") +
    " in Manila who works long desk days writing insurance loss assessments, travels around Asia a few times a year, and plays poker tournaments that often run past midnight.";
  return [
    "Today is " + input.todayKey + ".",
    "WHO IT IS FOR: " + who,
    "Choose findings that would matter to him, and cover different topics where you can.",
    "",
    "Return JSON: {\"items\": [{",
    "  \"topic\": one of " + TOPICS.join(", ") + ",",
    "  \"headline\": the finding in at most 12 words,",
    "  \"finding\": what was found and how big the effect was, at most 60 words,",
    "  \"evidence\": one of " + EVIDENCE.join(", ") + ",",
    "  \"who_studied\": who was studied and how many, at most 20 words,",
    "  \"shows\": association (an observational link), cause (randomised trials, or a pooled analysis of trials, showed it), or guidance (a health body's advice),",
    "  \"source_title\": the page's title,",
    "  \"url\": the page's address, from your search,",
    "  \"published\": YYYY-MM-DD,",
    "  \"for_you\": why it matters for the person above, at most 40 words,",
    "  \"try\": one small everyday thing to try this week, at most 20 words",
    "}], \"note\": one line if fewer than three findings met the bar, else \"\"}",
  ].join("\n");
}

// The model's JSON, kept only where it meets the bar: a known topic and
// evidence type, a source the search returned, a date in the last 45 days.
function cleanResearch(raw, searched, todayKey) {
  const allowed = {};
  (Array.isArray(searched) ? searched : []).forEach((url) => { const key = urlKey(url); if (key) allowed[key] = true; });
  const today = Date.parse(todayKey + "T00:00:00Z");
  const items = (raw && Array.isArray(raw.items) ? raw.items : []).map((item) => {
    if (!item || typeof item !== "object") return null;
    const url = text(item.url, 600), key = urlKey(url);
    if (!/^https?:\/\//i.test(url) || !allowed[key]) return null;
    const topic = TOPICS.indexOf(String(item.topic || "").toLowerCase()) >= 0 ? String(item.topic).toLowerCase() : "";
    const evidence = EVIDENCE.indexOf(String(item.evidence || "").toLowerCase()) >= 0 ? String(item.evidence).toLowerCase() : "";
    const published = /^\d{4}-\d{2}-\d{2}$/.test(item.published || "") ? item.published : "";
    const age = published ? (today - Date.parse(published + "T00:00:00Z")) / 86400000 : null;
    if (!topic || !evidence || !published || age == null || age < -1 || age > 45) return null;
    // The study design caps what it can show, whatever the model said.
    const said = SHOWS.indexOf(String(item.shows || "").toLowerCase()) >= 0 ? String(item.shows).toLowerCase() : "association";
    const shows = evidence === "large cohort" ? "association" : evidence === "guideline" ? "guidance" : said === "guidance" ? "association" : said;
    const out = {topic, evidence, shows, published, url, headline: text(item.headline, 110), finding: text(item.finding, 480),
      whoStudied: text(item.who_studied, 160), sourceTitle: text(item.source_title, 160), forYou: text(item.for_you, 320), try: text(item.try, 160)};
    return out.headline && out.finding ? out : null;
  }).filter(Boolean);
  const seen = {};
  const unique = items.filter((i) => { const k = urlKey(i.url); if (seen[k]) return false; seen[k] = true; return true; }).slice(0, MAX_ITEMS);
  return {items: unique, note: text(raw && raw.note, 240), dropped: Math.max(0, (raw && Array.isArray(raw.items) ? raw.items.length : 0) - unique.length)};
}

// The newest KEEP_WEEKS weeks, keyed by the week's Monday.
function keepWeeks(stored, key, entry) {
  const all = Object.assign({}, stored || {});
  all[key] = entry;
  const out = {};
  Object.keys(all).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-KEEP_WEEKS).forEach((k) => { out[k] = all[k]; });
  return out;
}

module.exports = {TOPICS, EVIDENCE, SHOWS, MAX_ITEMS, KEEP_WEEKS, SYSTEM, ageBand, buildResearchPrompt, cleanResearch, keepWeeks};
