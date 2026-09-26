"use strict";

// functions/story-dossier.js
//
// PURE — no I/O. "Go deeper" on one briefing story: the prompt for a short
// working dossier (what happened, how it came about, the figures, the BI and
// claims angle, who is exposed, three questions for a client, and what would
// change the read), and the checks on what comes back before it is stored.
//
// A briefing card is two or three sentences, which is right for a morning scan
// and too thin for a client conversation. The dossier is the next layer, on
// demand, for the one story Bob wants to take further. Like the briefing it is
// built from a web search, and like the briefing's links its sources are kept
// only when they are pages the search actually returned.

const {urlKey} = require("./briefing-evidence");

function text(value) {
  return String(value == null ? "" : value).trim();
}

function clip(value, max) {
  const flat = text(value).replace(/\s+/g, " ");
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1), space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "") + "…";
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

// The story as the app sends it, bounded. Null without a usable headline.
function cleanStory(raw) {
  const story = raw && typeof raw === "object" ? raw : {};
  const headline = clip(story.headline, 300);
  if (headline.length < 8) return null;
  return {
    headline,
    source: clip(story.source, 120),
    url: /^https?:\/\//i.test(text(story.url)) ? text(story.url).slice(0, 600) : "",
    body: clip(story.body, 900),
    relevance: clip(story.relevance, 600),
    section: clip(story.section, 30),
    date: clip(story.date, 60),
  };
}

const SYSTEM = "You prepare short, factual working dossiers on news stories for an insurance and business-interruption " +
  "consultant. You search the web to check what you say. Return strict JSON only.";

function buildDossierPrompt(story) {
  return [
    "Bob is a forensic business-interruption (BI) consultant who works with Australian insurers and Philippine consulting firms.",
    "He wants to go deeper on one story from his briefing" + (story.date ? " of " + story.date : "") + ". Search the web to check it and find what surrounds it.",
    "",
    "THE STORY (as his briefing gave it):",
    "- Headline: " + story.headline,
    story.source ? "- Source: " + story.source : "",
    story.url ? "- Link: " + story.url : "",
    story.section ? "- Briefing section: " + story.section : "",
    story.body ? "- Summary: " + story.body : "",
    story.relevance ? "- Why it mattered: " + story.relevance : "",
    "",
    "Return a single JSON object with exactly these keys:",
    "{",
    '  "summary": "2 sentences, at most 60 words: what happened, as reported",',
    '  "background": ["2 to 4 short points: how this came about, the context a reader needs"],',
    '  "numbers": [{"figure": "A$3.98bn", "what": "what the figure measures", "source": "who reported it"}],',
    '  "bi_angle": "2-3 sentences: the loss mechanism, the covers that could respond (BI, contingent BI, supply chain, cyber, property...), and what would trigger them",',
    '  "exposed": ["up to 5 short phrases, six words or fewer each: classes of insured, industries or places exposed"],',
    '  "client_questions": ["exactly 3 questions"],',
    '  "would_change": "one checkable signal that would change this read: what it is, who publishes it, and when it is next due",',
    '  "sources": [{"title": "", "url": ""}]',
    "}",
    "",
    "RULES:",
    "- Report, then reason. Keep what was reported apart from your inference, and mark inference as such (\"which suggests\", \"likely\").",
    "- numbers: at most 5 figures about this story itself (amounts, counts, rates, durations), each found in a source. Dates are not figures; put them in background.",
    "  Leave out figures about the wider sector or market that happen to appear in the same articles. Fewer numbers that bear on the story beat five that do not.",
    "  Never estimate or round a figure into existence. An empty list is fine.",
    "- exposed: short phrases of six words or fewer, each starting with a capital (\"Strata insurers\", \"Cold-chain operators in Cebu\"), not sentences.",
    "- client_questions: exactly 3, specific to this story and useful this week, the kind Bob would put to an insured, a broker or an insurer. Not generic (\"what is your exposure?\").",
    "- sources: at most 6 pages you actually used, each url copied exactly from a web search result. Never type a url from memory.",
    "- If something is not known yet, say so in plain words rather than filling the gap.",
    "- Never give investment advice: no buying, selling, holding or sizing anything.",
    "- Plain English, Australian spelling, no emojis, no markdown inside the strings.",
  ].filter((line) => line !== "").join("\n");
}

// What is stored and shown: known fields, bounded, and sources kept only when
// the search returned that page. Null when there is no summary to show.
function cleanDossier(raw, searched) {
  if (!raw || typeof raw !== "object") return null;
  const summary = clip(raw.summary, 700);
  if (!summary) return null;
  const allowed = {};
  arr(searched).forEach((url) => { const key = urlKey(url); if (key) allowed[key] = true; });
  const seen = {};
  const sources = arr(raw.sources).map((item) => ({title: clip(item && item.title, 160), url: text(item && item.url)}))
    .filter((item) => {
      const key = urlKey(item.url);
      if (!/^https?:\/\//i.test(item.url) || !key || !allowed[key] || seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, 6).map((item) => ({title: item.title || item.url.replace(/^https?:\/\//i, "").slice(0, 80), url: item.url.slice(0, 600)}));
  return {
    summary,
    background: arr(raw.background).map((item) => clip(item, 420)).filter(Boolean).slice(0, 4),
    numbers: arr(raw.numbers).filter((item) => item && text(item.figure)).slice(0, 5)
      .map((item) => ({figure: clip(item.figure, 40), what: clip(item.what, 200), source: clip(item.source, 100)})),
    bi_angle: clip(raw.bi_angle, 900),
    exposed: arr(raw.exposed).map((item) => clip(item, 140)).filter(Boolean).slice(0, 5),
    client_questions: arr(raw.client_questions).map((item) => clip(item, 320)).filter(Boolean).slice(0, 3),
    would_change: clip(raw.would_change, 700),
    sources,
  };
}

// The stored map keeps the latest forty dossiers, oldest dropped first.
const KEEP_DOSSIERS = 40;
function keepDossiers(items, key, dossier) {
  const next = Object.assign({}, items || {});
  next[key] = dossier;
  const keys = Object.keys(next).sort((a, b) => String(next[a].generatedAt || "").localeCompare(String(next[b].generatedAt || "")));
  const out = {};
  keys.slice(-KEEP_DOSSIERS).forEach((k) => { out[k] = next[k]; });
  return out;
}

module.exports = {cleanStory, buildDossierPrompt, cleanDossier, keepDossiers, SYSTEM, KEEP_DOSSIERS};
