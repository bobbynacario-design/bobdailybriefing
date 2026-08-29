"use strict";

// functions/briefing-evidence.js
//
// PURE — no I/O, no clock of its own. Two jobs:
//   1. buildEvidence()    turn the day's news-<date> doc into a grounding block
//                         for the briefing prompt.
//   2. verifyGrounding()  check what the model sent back actually came from that
//                         block, instead of taking its word for it.
//
// WHY: the briefing's insurance section is generated over a hosted web_search
// tool, so it is non-deterministic and its `source` is a bare publisher name
// with no link behind it. Nothing downstream — Evidence sets, Entity Timelines,
// unified search — can re-open a story it cannot address. Grounding the section
// in the news/ feed fixes both: the stories provably exist, and each carries the
// publisher's own URL.
//
// The verification half exists because a prompt instruction is a request, not a
// guarantee. A model told to copy URLs verbatim will still occasionally produce
// a plausible-looking one that was never in the list, and an unmatched URL is
// strictly worse than no URL — it looks citable. So every returned URL is
// checked against the supplied set; anything unrecognized has its link removed
// and is marked ungrounded rather than being silently trusted or silently
// deleted.
//
// NOTE ON THE DUPLICATED NORMALIZER: news/rank.js has its own URL canonicalizer
// for deduping. This file cannot import it — news/ is ESM and ships separately
// from the deployed functions bundle — so a small equivalent lives here. They
// serve different purposes (dedupe vs match) and are allowed to differ, but if
// one gains a rule about how these publishers form URLs, check the other.

// How many stories to put in front of the model. The briefing asks for 3-5
// insurance stories; 14 gives it room to choose without turning the prompt into
// a reading list. At roughly 70 tokens each this block costs ~1k input tokens —
// against the ~40k/call that hosted search was measured costing on the Markets
// panel, grounding is the cheap option as well as the auditable one.
const MAX_EVIDENCE_ITEMS = 14;

// A news doc older than this is not used. Its own items are already bounded by
// the feed's 10-day window, so a doc a couple of days stale is still true; one
// from last week means the refresh has been failing and the briefing should say
// so rather than quietly present old news as today's.
const MAX_DOC_AGE_DAYS = 3;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

// Match key for a URL: scheme, www, query, fragment and trailing slash removed,
// lowercased. Tracking parameters are the common way a returned URL differs
// from the fetched one without being a different page.
function urlKey(value) {
  const raw = text(value);
  if (!raw) return "";
  return raw
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("#")[0]
    .split("?")[0]
    .replace(/\/+$/, "")
    .toLowerCase();
}

function dayPart(iso) {
  const value = text(iso);
  return value ? value.slice(0, 10) : "";
}

function docAgeDays(newsDoc, nowMs) {
  const stamp = text(newsDoc && newsDoc.generatedAt);
  const ms = stamp ? Date.parse(stamp) : NaN;
  if (!Number.isFinite(ms)) return null;
  return (nowMs - ms) / 86400000;
}

// Rank the doc's items for GROUNDING, which is not the same as ranking them for
// reading. The feed's own score already blends recency and feed priority; here
// the tier does most of the work, because a core-vocabulary story is the kind
// the insurance section is supposed to be about. Ties fall back to the feed's
// score, so the ordering stays consistent with what the Sources view shows.
function groundingRank(item) {
  const tierBonus = {core: 300, context: 150, trade: 40, general: 0};
  return (tierBonus[text(item.tier)] || 0) + Number(item.score || 0);
}

// Build the grounding payload from a news-<date> doc.
// Returns null when there is nothing trustworthy to ground on; the caller then
// falls back to the ungrounded prompt and records why.
function buildEvidence(newsDoc, options) {
  options = options || {};
  const nowMs = options.now == null ? Date.now() : Number(options.now);
  const limit = options.maxItems || MAX_EVIDENCE_ITEMS;

  if (!newsDoc) return null;

  const age = docAgeDays(newsDoc, nowMs);
  if (age != null && age > MAX_DOC_AGE_DAYS) {
    return {unavailable: "stale", ageDays: Math.round(age * 10) / 10, date: text(newsDoc.date)};
  }

  const usable = arr(newsDoc.items)
    .filter((item) => text(item.title) && text(item.url))
    .slice()
    .sort((a, b) => groundingRank(b) - groundingRank(a))
    .slice(0, limit);

  if (!usable.length) return {unavailable: "empty", date: text(newsDoc.date)};

  const items = usable.map((item, index) => ({
    n: index + 1,
    title: text(item.title),
    url: text(item.url),
    source: text(item.source),
    section: text(item.section),
    publishedAt: text(item.publishedAt) || null,
    summary: text(item.summary),
    tier: text(item.tier),
  }));

  const sources = [];
  items.forEach((item) => {
    if (item.source && sources.indexOf(item.source) < 0) sources.push(item.source);
  });

  const feedsOk = (newsDoc.counts && newsDoc.counts.feedsOk) || 0;
  const feedsTotal = (newsDoc.counts && newsDoc.counts.feeds) || 0;

  const lines = [
    "VERIFIED AUSTRALIAN INSURANCE STORIES FETCHED TODAY",
    "These " + items.length + " stories were fetched from " + feedsOk + " of " + feedsTotal +
      " named trade feeds (" + sources.join(", ") + ") and are real, published articles.",
    "Snapshot " + text(newsDoc.date) + ". Headline, publisher and URL below are exact.",
    "",
  ];
  items.forEach((item) => {
    lines.push("[" + item.n + "] " + item.title);
    lines.push("    publisher: " + item.source +
      " | published: " + (dayPart(item.publishedAt) || "undated") +
      " | url: " + item.url);
    if (item.summary) lines.push("    " + item.summary);
  });

  return {
    date: text(newsDoc.date),
    generatedAt: text(newsDoc.generatedAt),
    ageDays: age == null ? null : Math.round(age * 10) / 10,
    itemCount: items.length,
    poolCount: arr(newsDoc.items).length,
    feedsOk: feedsOk,
    feedsTotal: feedsTotal,
    sources: sources,
    items: items,
    block: lines.join("\n"),
  };
}

// The set of URLs the model was actually shown.
function allowedKeys(evidence) {
  const keys = Object.create(null);
  arr(evidence && evidence.items).forEach((item) => {
    const key = urlKey(item.url);
    if (key) keys[key] = item;
  });
  return keys;
}

// Check the returned briefing against what was supplied.
//
// Non-destructive by design: a story whose URL was not in the list keeps its
// headline and body — it may well be a real story the model knew about — but
// loses the link and is marked `grounded: false`. Only the CLAIM of a citable
// source is withdrawn, never the content. `url` is normalized back to the exact
// string from the evidence list, so a returned URL that differs only by a
// tracking parameter still resolves to the canonical one.
function verifyGrounding(briefing, evidence, sectionNames) {
  const sections = arr(sectionNames).length ? arr(sectionNames) : ["insurance", "interruptions"];
  const keys = allowedKeys(evidence);
  const stats = {grounded: 0, ungrounded: 0, unmatched: 0, bySection: {}};

  if (!briefing || !briefing.sections) return {briefing: briefing, stats: stats};

  sections.forEach((name) => {
    const stories = arr(briefing.sections[name]);
    const perSection = {grounded: 0, ungrounded: 0, unmatched: 0};
    stories.forEach((story) => {
      if (!story || typeof story !== "object") return;
      const claimed = text(story.url);
      if (!claimed) {
        story.grounded = false;
        perSection.ungrounded++;
        return;
      }
      const match = keys[urlKey(claimed)];
      if (match) {
        story.url = match.url; // canonical string, not the model's rendering of it
        story.source = story.source || match.source;
        story.grounded = true;
        perSection.grounded++;
      } else {
        // A URL that was never supplied. Keep the story, remove the citation.
        delete story.url;
        story.grounded = false;
        perSection.ungrounded++;
        perSection.unmatched++;
      }
    });
    stats.bySection[name] = perSection;
    stats.grounded += perSection.grounded;
    stats.ungrounded += perSection.ungrounded;
    stats.unmatched += perSection.unmatched;
  });

  return {briefing: briefing, stats: stats};
}

module.exports = {
  buildEvidence,
  verifyGrounding,
  urlKey,
  MAX_EVIDENCE_ITEMS,
  MAX_DOC_AGE_DAYS,
};
