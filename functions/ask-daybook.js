"use strict";

// functions/ask-daybook.js
//
// PURE — no I/O. "Ask Daybook": Bob asks a question in plain English and the
// answer comes from his own material first. The model does its own lookups in
// his Daybook through one tool, search_daybook (up to three times a question),
// choosing the terms, sources and dates; the server runs each lookup on the
// same search index the app's Search box uses (lib/intelligence-search-core.js,
// synced here). A web search is added only when he ticks it.
//
// Every claim is tied to what a lookup returned ([S1]…) or, with the web on,
// to a page the search returned ([W1]…). Anything else is stripped, so an
// answer can never cite a record he does not have or a link nobody fetched.

const {urlKey} = require("./briefing-evidence");
const BriefingCore = require("./briefing-prompt-core");

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
function webUrl(value) {
  const url = text(value);
  return /^https?:\/\//i.test(url) ? url.slice(0, 600) : "";
}
function isoDay(value) {
  const day = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) ? day : "";
}

const MAX_LOOKUPS = 3;
const LOOKUP_LIMIT = 12;
// How much of a record's text a lookup returns. A story is long, so 450 keeps
// lookups cheap; a Radar name is short and every labelled part of it answers
// some question (the score's reason, catalyst, read, levels, tripwire).
const CLIP_TEXT = 450;
const CLIP_FOR = {Radar: 1200, Calendar: 600, Commitments: 900, Poker: 600, Flights: 600};
// The overviews of his life data are computed across all their records
// (lib/life-records-core.js), so they run long and are returned whole,
// without a matched-word excerpt repeating part of them.
const LIFE_OVERVIEWS = ["calendar:overview", "commitments:overview", "poker:overview", "flights:overview"];
const CLIP_OVERVIEW = 2400;
const MAX_THREAD = 3;
const KEEP_ANSWERS = 20;
// The search index's source names, as the lookup tool offers them.
const ASK_SOURCES = ["Profile", "Activity", "Briefing", "News", "Research", "Decisions", "Reflections", "Evidence", "Dossier", "Meeting",
  "Weekly read", "Numbers", "Radar", "Markets", "Sports", "Calendar", "Commitments", "Poker", "Flights"];
// What he has told Daybook about himself, and what it has picked up from him
// (the About you page). Few records, so a lookup may read them all at once.
const ABOUT_SOURCES = ["Profile", "Activity"];

// The question as typed. Null when too short to be one.
function cleanQuestion(raw) {
  const question = clip(raw, 400);
  return question.length >= 3 ? question : null;
}

// The last three exchanges of the thread, oldest first, so a follow-up such
// as "and Suncorp?" reads in context. Their references are stripped: they
// pointed at an earlier lookup, not this one.
function cleanThread(raw) {
  return arr(raw).filter((turn) => turn && typeof turn === "object" && text(turn.q) && text(turn.a)).slice(-MAX_THREAD)
    .map((turn) => ({q: clip(turn.q, 400), a: clip(text(turn.a).replace(/\s*\[[SW]\d+\]/g, ""), 1200)}));
}

// Whose words each record is. Only his notes, his decision journal and the
// note on a saved item are his own; the AI-written items are marked as such.
const ORIGIN = {
  Profile: "His own profile (his words, from About you)",
  Activity: "What he recorded or tapped in the app (counts and lists, not his words)",
  Reflections: "His own note",
  Decisions: "His decision journal",
  Evidence: "A page he saved to Evidence (any \"Note:\" part is his own words)",
  Dossier: "A dossier he asked for (AI-written)",
  Meeting: "A meeting brief he asked for (AI-written)",
  "Weekly read": "A weekly read of his week (AI-written)",
  Numbers: "A published figure in Your numbers",
  Briefing: "A briefing story he was shown",
  News: "A news item he was shown",
  Research: "A research report in his library",
  Radar: "A Radar signal (the app's daily market scan)",
  Markets: "A Markets scenario read (AI panel)",
  Sports: "A sports feed item",
  Calendar: "An entry on his calendar (his own event, a meeting with one of his accounts, or an all-day entry such as leave or a holiday)",
  Commitments: "His own weekly commitments (his words) and the days he ticked",
  Poker: "A tournament he starred in PokerHQ (★ Playing These: his decision to play)",
  Flights: "A fare he saved on Flights (an airline's advertised sample, not a booking)",
};
// A record whose kind is not its source's: the Radar overview is computed by
// the app across the scan, not one name and not AI-written.
const ORIGIN_BY_ID = {
  "radar:overview": "The Radar's overview of today's scan, computed by the app (not AI-written)",
  "calendar:overview": "An overview of his calendar computed by the app: time off, leave and what is coming up (not AI-written)",
  "commitments:overview": "An overview of his weekly commitments computed by the app, with his focus order (not AI-written)",
  "poker:overview": "An overview of his PokerHQ ★ picks computed by the app: buy-ins, PokerHQ's grades and series abroad (not AI-written)",
  "flights:overview": "An overview of the Flights scout computed by the app: fares for his time off, cheapest cities and poker trips (not AI-written)",
};
function originOf(source, id) {
  return ORIGIN_BY_ID[id] || ORIGIN[source] || "An item from his app (" + source + ")";
}

const SYSTEM = "You answer questions about the user's own saved material, " +
  "which you look up with the search_daybook tool. You never state what a lookup did not return. Return strict JSON only.";

const SEARCH_TOOL = {
  type: "function",
  name: "search_daybook",
  description: "Look up Bob's own Daybook: his profile and what the app has picked up from him (Profile, Activity), his briefings, " +
    "news he was shown, research reports, decisions, notes, saved evidence, dossiers, meeting briefs, weekly reads, Your numbers, " +
    "the Radar, Markets and Sports feeds, and his life data: his calendar (events, leave, holidays), weekly commitments, PokerHQ ★ picks and Flights. Any term may match; a term may be a phrase. Returns the best matches, newest first among equals.",
  parameters: {
    type: "object",
    properties: {
      terms: {type: "array", items: {type: "string"}, description: "1 to 8 words or short phrases to find, including names, tickers, other names and synonyms (e.g. [\"ETH\", \"Ethereum\"]). Leave it empty only with sources Profile and/or Activity, to read all of them."},
      sources: {type: "array", items: {type: "string", enum: ASK_SOURCES}, description: "Optional: only these kinds of record."},
      since: {type: "string", description: "Optional: earliest date, YYYY-MM-DD."},
      until: {type: "string", description: "Optional: latest date, YYYY-MM-DD."},
    },
    required: ["terms"],
    additionalProperties: false,
  },
};

// Interpret only explicit format requests; never infer a personality from text.
function requestIntent(question) {
  const q = text(question).toLowerCase();
  const numbers = {one: 1, single: 1, two: 2, three: 3, four: 4, five: 5};
  const count = (match) => match ? numbers[match[1]] || Number(match[1]) : null;
  const sentences = count(q.match(/\b(1|2|3|4|5|one|single|two|three|four|five)\s+sentences?\b/));
  const bullets = count(q.match(/\b(1|2|3|4|5|one|single|two|three|four|five)\s+bullet(?:s|\s+points?)?\b/));
  const words = q.match(/\b(under|fewer than|less than|at most|no more than|up to|within|in)\s+(\d{1,3})\s+words?\b/);
  const brief = /\b(briefly|concise|concisely|short answer|keep it short|just the answer)\b/.test(q);
  const personal = /\b(describe|summarise|summarize|sum up)\s+me\b|\bwho am i\b|\bdescribe my (?:work|role|career|job)\b/.test(q);
  const beyondWork = personal && /\b(beyond|outside|apart from|other than|not just)\s+(?:my\s+)?work\b/.test(q);
  const workOnly = personal && !beyondWork && /\b(my (?:work|role|career|job)|professionally|professional (?:bio|description))\b/.test(q);
  const maxWords = words ? Math.min(170, Math.max(1, Number(words[2]) - (/under|fewer|less/.test(words[1]) ? 1 : 0))) : sentences === 1 ? 30 : brief ? 70 : 170;
  return {sentences, bullets, maxWords, scope: beyondWork ? "beyond-work" : workOnly ? "work" : personal ? "person" : "records",
    suppressFollowups: !!(sentences || bullets || brief || personal || /\bno follow[- ]?ups?\b/.test(q))};
}

function intentInstructions(intent) {
  const lines = ["Answer the user's actual request; its scope and explicit format take precedence over general answer templates."];
  lines.push("Before drafting, choose the central answer and the smallest set of returned facts needed to support it. Lead with that answer; do not narrate the search, repeat the question, or summarise every retrieved record.");
  lines.push("Make each added detail earn its place: include it only if it changes the answer, resolves an ambiguity, or supplies an essential qualification. Prefer one clear main point with necessary support to a compressed inventory. Stop when the question is answered; the word limit is a ceiling, not a target.");
  lines.push("For a question about one attribute (such as a date, amount, reason, threshold or invalidator), answer that attribute and any necessary caveat; omit unrelated fields from the same record. Preserve the distinction between a stated aim and something already achieved.");
  lines.push("Before returning JSON, check each clause against the question. Delete clauses that merely repeat other fields from a retrieved record: a record's reason, status or action does not belong in an answer asking only for its invalidator unless it changes that invalidator. Do not fill spare words with record metadata.");
  lines.push("Keep the specific names, dates, amounts, changes, invalidators and uncertainty that the question depends on. Do not lose a material caveat to sound punchier, or replace a precise answer with a vague slogan. A comparison should lead with the meaningful difference; explain a cause only when the records support it.");
  lines.push("For a numerical comparison, lead with the absolute change or percentage change when it can be calculated directly from comparable recorded figures. Label it as a calculation and cite the inputs; retain the before/after figures when helpful. Do not calculate across different units or scopes, and do not invent a reason for the change.");
  if (intent.sentences) lines.push("The answer field must contain exactly " + intent.sentences + " sentence(s); do not append an explanation.");
  if (intent.bullets) lines.push("The answer field must contain exactly " + intent.bullets + " bullet lines, each starting '- ', separated by newline characters; no introduction or conclusion.");
  lines.push("Use at most " + intent.maxWords + " words in the answer field, excluding citation refs; select the essential facts instead of squeezing in every record.");
  if (intent.scope === "person") lines.push("This is a description of the person, not an inventory of clients or claim types: consider his work, stated interests, values and goals together, but include only defining details supported by his profile. For a short description, choose his core role and at most one defining aim or interest; omit client names, subtypes of files and overlapping geographical detail unless explicitly requested or essential. Do not invent traits or equate app activity with personality.");
  if (intent.scope === "person" && intent.sentences === 1) lines.push("Aim for a natural role-plus-aim sentence of about 20 to 25 words. Drop routine geography and lists of organisations when they crowd that central point, unless the user asks for them.");
  if (intent.scope === "work") lines.push("Describe his professional role from his profile; leave out unrelated interests and a detailed inventory of files unless requested.");
  if (intent.scope === "beyond-work") lines.push("Focus on his explicitly stated interests, values and goals outside work. Do not substitute his job description; if that personal evidence is missing, say so.");
  if (intent.suppressFollowups) lines.push("Set follow_ups to []; the user asked for a finished, focused answer.");
  else lines.push("Suggest a follow-up only when it directly advances this question using the evidence returned; otherwise set follow_ups to [].");
  return lines.join("\n");
}

// A model sometimes writes refs together, "[S12, S8]" or "[S1; S2]". Each is
// split into its own brackets so it is checked, kept and listed like any other
// (11 Oct: two answers lost their refs this way).
function splitRefs(value) {
  return String(value == null ? "" : value).replace(/\[\s*([SW]\d+(?:\s*(?:[,;&]|and)\s*[SW]\d+)+)\s*\]/g,
    (match, list) => list.split(/\s*(?:[,;&]|and)\s*/).map((ref) => "[" + ref.trim() + "]").join(" "));
}
function answerText(value) {
  // Keep requested bullet lines intact. All HTML is still escaped by the app.
  return splitRefs(text(value)).replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").slice(0, 1600).trim();
}

function sentenceCount(value) {
  const plain = text(value).replace(/\[[SW]\d+\]/g, "").trim();
  return Array.from(new Intl.Segmenter("en-AU", {granularity: "sentence"}).segment(plain)).filter((part) => /[\p{L}\p{N}]/u.test(part.segment)).length;
}

// Strict correctness: every figure and date an answer gives must be one the
// records the lookups returned state (or the question, today's date or the
// thread), unless the answer says, in that sentence, that it calculated it.
// 11 Oct: an answer gave "Sat 31 Oct" for picks that end on Thu 29 Oct; the
// records never said 31 Oct. Figures are amounts, percentages, decimals and
// any number from 10 up; dates are a day and month ("31 Oct", "October 31",
// "2026-10-31"). Small counts and words ("ten") are left alone: they appear
// everywhere and a check on them would prove nothing.
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
// Each pattern gives the dates it names; a range in one month ("21 to Thu
// 24 Dec", "21–24 Dec") names both ends.
const DATE_PATTERNS = [
  [new RegExp("\\b(\\d{4})-(\\d{2})-(\\d{2})\\b", "g"), (m) => [dateKey(m[3], MONTH_NAMES[Number(m[2]) - 1])]],
  [new RegExp("\\b(\\d{1,2})\\s*(?:–|—|-|to|and)\\s*(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+" + MONTH + "\\b\\.?", "gi"),
    (m) => [dateKey(m[1], m[3]), dateKey(m[2], m[3])]],
  [new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+" + MONTH + "\\b\\.?", "gi"), (m) => [dateKey(m[1], m[2])]],
  [new RegExp("\\b" + MONTH + "\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*[:\\d])", "gi"), (m) => [dateKey(m[2], m[1])]],
];
function dateKey(day, month) {
  const d = Number(day), mon = String(month || "").slice(0, 3).toLowerCase();
  return d >= 1 && d <= 31 && MONTH_NAMES.indexOf(mon) >= 0 ? d + " " + mon : "";
}
const AMOUNT = /(?:(PHP|USD|AUD|NZD|A\$|US\$|\$|₱|€|£)\s?)?(\d(?:[\d,]*\d)?(?:\.\d+)?)(\s?%)?/g;
function numberKey(value) {
  const n = Math.abs(Number(String(value).replace(/,/g, "")));
  return Number.isFinite(n) ? String(n) : "";
}
// The dates and numbers a text states, as comparable keys. Dates are taken
// out first so "31 Oct" is a date, not the number 31 (though the day also
// counts as a number the text states).
function figureKeys(value) {
  let rest = String(value == null ? "" : value).replace(/\[[SW]\d+\]/g, " ");
  const dates = new Set(), numbers = new Set();
  DATE_PATTERNS.forEach(([pattern, key]) => {
    rest = rest.replace(pattern, (...m) => {
      key(m).filter(Boolean).forEach((k) => { dates.add(k); numbers.add(k.split(" ")[0]); });
      return " ";
    });
  });
  for (const m of rest.matchAll(AMOUNT)) { const k = numberKey(m[2]); if (k) numbers.add(k); }
  return {dates, numbers};
}
// The figures in an answer that no returned record (or the question, today or
// the thread) states, as written, at most six. A sentence that says it
// calculated its figures keeps its numbers; its dates are still checked.
function untracedFigures(answer, registry, extra) {
  const evidence = arr(registry && registry.list).map((entry) => {
    const item = entry.item || {};
    return [item.title, item.detail, item.body, item.meta, dayOf(item.saved)].join(" ");
  }).concat(arr(extra)).join(" \n ");
  const known = figureKeys(evidence);
  const out = [];
  const segments = Array.from(new Intl.Segmenter("en-AU", {granularity: "sentence"}).segment(String(answer || ""))).map((s) => s.segment);
  segments.forEach((sentence) => {
    let rest = sentence.replace(/\[[SW]\d+\]/g, " ");
    DATE_PATTERNS.forEach(([pattern, key]) => {
      rest = rest.replace(pattern, (...m) => { if (key(m).some((k) => k && !known.dates.has(k))) out.push(m[0].trim()); return " "; });
    });
    if (/\bcalculat/i.test(sentence)) return;
    for (const m of rest.matchAll(AMOUNT)) {
      const k = numberKey(m[2]), n = Number(k);
      const figure = !!m[1] || !!m[3] || /\./.test(m[2]) || n >= 10;
      if (k && figure && !known.numbers.has(k)) out.push(m[0].trim());
    }
  });
  return out.filter((f, i) => out.indexOf(f) === i).slice(0, 6);
}
const FIGURE_PROBLEM = "These figures are not in the records the lookups returned: ";

function reviewAnswer(raw, {question, registry, searched, web, extra}) {
  const intent = requestIntent(question);
  let parsed;
  try { parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch (error) { parsed = null; }
  if (parsed && typeof parsed.answer === "string") parsed.answer = splitRefs(parsed.answer);
  const clean = cleanAnswer(parsed, registry, searched, web, question, extra);
  const problems = [];
  if (!clean || typeof parsed.answer !== "string") problems.push("Return a usable answer in the requested JSON object.");
  else {
    const answer = clean.answer;
    if (parsed.answer.length > 1600) problems.push("Keep answer within 1600 characters without truncating its meaning.");
    if (intent.sentences && sentenceCount(answer) !== intent.sentences) problems.push("Use exactly " + intent.sentences + " sentence(s) in answer.");
    if (intent.bullets) {
      const lines = answer.split("\n").filter((line) => line.trim());
      if (lines.length !== intent.bullets || !lines.every((line) => /^[-•]\s+\S/.test(line))) problems.push("Use exactly " + intent.bullets + " bullet lines and no surrounding prose.");
    }
    const words = answer.replace(/\[[SW]\d+\]/g, "").trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
    if (words > intent.maxWords) problems.push("Keep answer within " + intent.maxWords + " words.");
    const known = new Set(clean.sources.concat(clean.web_sources).map((source) => source.ref));
    if (Array.from(parsed.answer.matchAll(/\[([SW]\d+)\]/g)).some((match) => !known.has(match[1]))) problems.push("Cite only refs returned by the lookups or verified web search; remove unsupported claims, not just their refs.");
    if (registry.list.length && !clean.sources.length && !clean.web_sources.length && !text(parsed.not_found)) problems.push("Support the answer with the relevant returned refs, or explain that the records do not answer it.");
    if (arr(clean.unverified).length) problems.push(FIGURE_PROBLEM + clean.unverified.join(", ") + ". Remove each one or replace it with the figure a record states. If one is your own calculation from returned figures, keep it and put the word \"calculated\" in that sentence (e.g. \"PHP 12,500 for the ten, calculated from their buy-ins\").");
  }
  return {raw: clean ? JSON.stringify({answer: clean.answer, not_found: clean.not_found, follow_ups: clean.follow_ups,
    web_sources: arr(parsed.web_sources)}) : raw, problems,
    correction: "Revise your previous answer once, using only evidence already returned in this conversation. Do not call tools or add facts from memory.\n" +
      "User request: " + question + "\n" + intentInstructions(intent) + "\nFix these issues:\n- " + problems.join("\n- ") +
      "\nReturn only JSON with answer, not_found, follow_ups and web_sources. Preserve the correct source refs and relevant meaning; do not simply cut off the answer."};
}

async function refineAnswer({raw, revise, ...context}) {
  let review = reviewAnswer(raw, context);
  if (!review.problems.length) return review.raw;
  // One correction at most, with the same evidence and no extra retrieval.
  review = reviewAnswer(await revise(review.correction), context);
  // A figure still untraced after the correction does not sink the answer:
  // cleanAnswer lists it as unverified and the app shows it under the answer.
  if (review.problems.some((p) => !p.startsWith(FIGURE_PROBLEM))) throw Object.assign(new Error("The answer did not meet your requested format. Try again."), {code: "internal"});
  return review.raw;
}

// Profile evidence comes through search_daybook with source refs. Account aliases
// below help choose lookup terms, but are not evidence for the answer.
function buildAskPrompt({question, today, accounts, web}) {
  const lines = ["Today is " + today + " (Manila)."];
  const named = arr(accounts).filter((a) => a && text(a.name)).slice(0, 40);
  if (named.length) {
    lines.push("", "HIS ACCOUNTS (name | other names), useful as lookup terms only; cite returned records for any facts:");
    named.forEach((a) => lines.push("- " + clip(a.name, 60) + (arr(a.aliases).length ? " | " + arr(a.aliases).slice(0, 5).map((x) => clip(x, 40)).join(", ") : "")));
  }
  lines.push(
    "",
    "HOW TO ANSWER:",
    intentInstructions(requestIntent(question)),
    "- Look up his Daybook with search_daybook before answering, at least once and at most " + MAX_LOOKUPS + " times. Choose terms that would appear in the records: names, tickers, other names, synonyms. Narrow by sources or dates when the question implies it (\"since August\" is since the 1st of August this year).",
    "- A question about Bob himself (who he is, what he cares about, his habits, his work, his goals): look up sources Profile and Activity first, with terms empty to read them all, and answer from them. Never cite a briefing story, news item or report as evidence of who he is.",
    "- A question about the Radar (the app's daily market scan: a name's score, status, reason, catalyst, levels or tripwire, or today's Taker and Wildcard picks): look up sources Radar; the term \"radar\" reads today's names, highest score first, and \"Taker\" or \"Wildcard\" finds those picks. Its \"Radar overview\" record is computed across the whole scan: the picks with their scores, grouped by score band with each band's record, volume, early flags, themes and status counts. A name is early only when its meta says early. The Radar holds today's scan only, so it cannot say how a name has changed; say so if asked. Its levels are the scan's own, never a recommendation.",
    "- A question about one Radar name: open with its score, status and pick (from meta). State as a caveat what its record shows against it: volume below its 20-day norm (under 1×), and a score band with no clear edge (under 50% beat their benchmark, or average excess between -0.25 and +0.25 points, the card's own noise line). Give the band's record as how names in that band have done before, never as a forecast.",
    "- A question about today's picks, several Radar names or the Radar as a whole: build the answer from the Radar overview record and cite it. Give the picks grouped by score band as it groups them, with each band's record, and say plainly which group has no clear edge; then how many are on volume below their norm, and the themes. Name each pick once, with its score. Say once what all share (e.g. \"all six are early\"); never repeat status words such as forming or early for each name, and never open each name with its own status.",
    "- A question about his time, plans or week (leave, holidays, what is coming up, his commitments, poker plans, trips, fares): look up sources Calendar, Commitments, Poker and Flights as fits, with the term \"overview\" plus the question's own words. Each has an overview record computed by the app across all its records: his time off (leave joined with weekends and holidays) and what is coming up; this week's commitments with the days ticked, last week's results and his focus order; his ★ PokerHQ picks with buy-ins, PokerHQ's grades and series abroad; and the Flights scout's fares that fit his time off, cheapest cities and poker trips. Build the answer from the overview and cite it; dated questions (\"in December\") can also narrow by dates.",
    "- His calendar in Daybook holds his own Daybook events, meetings matched to his accounts and all-day entries from his linked calendars, not every appointment: never call a day free or say he has nothing on; say what is listed.",
    "- Commitments are his own words; a tick is a day he marked doing something toward one. Never infer progress beyond the ticks and the results he marked. For \"what should I focus on\", follow his focus order as the overview states it (money, then work, then health, then poker): give his commitments, then the overview's ideas from his records, each with where it comes from, and say plainly that a starter idea is only a starter. A date range, a count or a first or last date must be one the records state; never round to a month's start or end.",
    "- PokerHQ: a ★ (Playing These) is his decision to play; a grade (target, stretch, skip) is only PokerHQ's check of a buy-in against his bankroll rule, not a decision. Daybook never sees his bankroll amount; never state or guess it, and give no advice on stakes beyond PokerHQ's own grade.",
    "- Flights fares are airlines' advertised samples on the airlines' own dates, checked on the scout's date: \"the scout saw Taipei from ≈ PHP … on …\", never that a seat is available at that price. Exact dates are searched with the Google Flights links on Flights.",
    "- Each lookup result has a ref (S1, S2…) and a kind that says whose words it is:",
    "  - His profile, his own note, his decision journal, and the \"Note:\" part of a saved page are his words: \"you noted…\", \"you decided…\", \"you describe yourself as…\" is right.",
    "  - Activity is what he did in the app (votes, open calls, what he opens): describe it as what he did, never as what he said.",
    "  - His commitments and his calendar entries are his own plans: \"you committed to…\", \"your calendar has…\". A ★ in PokerHQ is his choice to play; a saved fare is one he kept, not a booking.",
    "  - A dossier, meeting brief or weekly read is AI-written for him; a saved page or report is something he kept: never present these as his view.",
    "  - A briefing story or news item he was shown: at most \"your 25 Sep briefing said…\". Being shown something is not interest.",
    "  - A Radar record is the app's scan. Its \"Score reason\", score, status, early flag, levels and score-band record are computed from prices and volume: \"the scan scores it…\". Its catalyst and its \"Why it's moving\" / \"What would break it\" read are AI-written from news it found: \"the Radar's read says…\", never plain fact.",
    web
      ? "- You may also search the web for what is new. Cite each web fact with [W1], [W2]… matching web_sources, copying each url exactly from a search result."
      : "- Do not use the web: answer only from what the lookups return.",
    "- Put the ref after each claim it supports, e.g. \"QBE lifted its cat allowance [S3].\" Each ref goes in its own brackets: [S1] [S2], never [S1, S2]. Never cite a ref a lookup did not return.",
    "- If the lookups find nothing useful, say so plainly in one sentence and leave answer short; never fill the gap from memory.",
    "- Dates and reported figures only as the records state them. Simple differences or percentages calculated from comparable recorded figures must be labelled as calculations and cite their inputs. Say who reported something when it matters.",
    "- Do not turn a list of interests or values into a ranking, personality trait or claim about priorities unless he explicitly recorded that comparison. Keep descriptions proportional to what his own words support.",
    "- Never give investment advice: no buying, selling, holding or sizing anything. For a question about one of his calls, give what he recorded (reason, invalidator, status, outcome, Called it?) and what the records say since.",
    "- Write to him as \"you\", in plain English with Australian spelling, no emojis or markdown except simple bullet lines when requested. Check the requested scope, sentence/bullet count, word limit and refs before returning JSON.",
    "",
    "Return a single JSON object with exactly these keys:",
    "{",
    '  "answer": "the answer, with refs after the claims",',
    '  "not_found": "one short line on what his Daybook has nothing on, or an empty string",',
    '  "follow_ups": ["up to 2 short questions he might ask next, never one this answer already covers"],',
    '  "web_sources": [{"title": "", "url": ""}]',
    "}",
    "",
    "QUESTION: " + question,
  );
  return lines.join("\n");
}

// The Responses API input: the system line, the thread as earlier turns, then
// this question.
function buildAskInput({question, thread, today, accounts, web}) {
  const input = [{role: "system", content: SYSTEM}];
  cleanThread(thread).forEach((turn) => {
    input.push({role: "user", content: turn.q});
    input.push({role: "assistant", content: turn.a});
  });
  input.push({role: "user", content: buildAskPrompt({question, today, accounts, web})});
  return input;
}

// A lookup's arguments as the model sent them, bounded and checked.
function cleanPlan(raw) {
  let args = raw;
  if (typeof raw === "string") {
    try { args = JSON.parse(raw); } catch (error) { args = {}; }
  }
  args = args && typeof args === "object" ? args : {};
  return {
    terms: arr(args.terms).map((term) => clip(term, 60)).filter(Boolean).slice(0, 8),
    sources: arr(args.sources).map(text).filter((source) => ASK_SOURCES.indexOf(source) >= 0),
    since: isoDay(args.since),
    until: isoDay(args.until),
    limit: LOOKUP_LIMIT,
  };
}

// Refs are handed out in the order records are first returned, across all the
// lookups for one question, so the same record keeps the same ref.
function newRegistry() {
  return {byId: {}, list: []};
}
function refFor(registry, item) {
  if (!registry.byId[item.id]) {
    const ref = "S" + (registry.list.length + 1);
    registry.byId[item.id] = ref;
    registry.list.push({ref, item});
  }
  return registry.byId[item.id];
}
function dayOf(saved) {
  return saved ? new Date(saved).toISOString().slice(0, 10) : "";
}

// What a lookup returns to the model: compact records with their ref and whose
// words they are.
function lookupOutput(hits, registry) {
  const results = arr(hits).map((item) => {
    const overview = LIFE_OVERVIEWS.indexOf(item.id) >= 0;
    const parts = [item.detail, overview ? "" : item.excerpt, item.body].map(text).filter(Boolean).filter((part, i, all) => all.indexOf(part) === i);
    return {ref: refFor(registry, item), kind: originOf(item.source, item.id), date: dayOf(item.saved), title: clip(item.title, 200),
      text: clip(parts.join(" — "), overview ? CLIP_OVERVIEW : CLIP_FOR[item.source] || CLIP_TEXT), meta: clip(item.meta, 100)};
  });
  return JSON.stringify(results.length ? {results} : {results: [], note: "Nothing in his Daybook matched these terms."});
}

// What is stored and shown: known fields, bounded; refs kept only when a
// lookup returned them, web links only when the search returned the page.
function cleanAnswer(raw, registry, searched, web, question, extra) {
  if (!raw || typeof raw !== "object") return null;
  let answer = answerText(raw.answer);
  if (!answer) return null;
  const allowed = {};
  arr(searched).forEach((url) => { const key = urlKey(url); if (key) allowed[key] = true; });
  const webSources = web ? arr(raw.web_sources).slice(0, 6).map((item) => {
    const url = webUrl(item && item.url);
    return url && allowed[urlKey(url)] ? {title: clip(item && item.title, 160) || url.replace(/^https?:\/\//i, "").slice(0, 80), url} : null;
  }) : [];
  const known = {};
  registry.list.forEach((entry) => { known[entry.ref] = entry; });
  const used = [];
  answer = answer.replace(/\s*\[([SW])(\d+)\]/g, (match, kind, n) => {
    if (kind === "S" && known["S" + n]) { if (used.indexOf("S" + n) < 0) used.push("S" + n); return match; }
    if (kind === "W" && webSources[Number(n) - 1]) return match;
    return "";
  });
  const sources = used.map((ref) => {
    const item = known[ref].item;
    return {ref, source: item.source, title: clip(item.title, 200), date: dayOf(item.saved), id: clip(item.id, 220),
      page: clip(item.page, 40), appRef: clip(item.ref, 220), meta: clip(item.meta, 100)};
  });
  // Web answers draw on pages whose text the server never sees, so only an
  // answer from his own records is traced.
  const unverified = web ? [] : untracedFigures(answer, registry, [question].concat(arr(extra)));
  return {
    answer,
    ...(unverified.length ? {unverified} : {}),
    // When no lookup found anything, say so even if the model did not.
    not_found: clip(raw.not_found, 240) || (registry.list.length ? "" : web ? "Nothing in your Daybook matched; this answer is from the web." : "Nothing in your Daybook matched this."),
    follow_ups: requestIntent(question).suppressFollowups ? [] : arr(raw.follow_ups).map((q) => clip(q, 160)).filter(Boolean).slice(0, 2),
    sources,
    web_sources: webSources.map((item, i) => (item ? Object.assign({ref: "W" + (i + 1)}, item) : null)).filter(Boolean),
    looked_up: registry.list.length,
  };
}

// His profile boxes and what Daybook has picked up from him, as index rows
// (the About you page, in a form a lookup can return and an answer can cite).
// Only what he wrote or did; nothing inferred.
const PAGE_NAMES = {today: "Today", command: "Command", evidence: "Evidence", timeline: "Timeline", history: "History", trends: "Trends",
  research: "Research", radar: "Radar", journal: "Journal", pse: "PSE", miro: "Markets", sports: "Sports", help: "Help", decisions: "Decisions", about: "About you"};
function aboutRecords(docs, todayKey) {
  docs = docs || {};
  const out = [];
  const profileDoc = docs.profile || null, profile = BriefingCore.cleanProfile(profileDoc && profileDoc.profile);
  const savedOn = profileDoc && profileDoc.updatedAt ? text(profileDoc.updatedAt).slice(0, 10) : "";
  BriefingCore.PROFILE_FIELDS.forEach((field) => {
    const value = profile[field.key];
    if (!value) return;
    out.push({id: "profile:" + field.key, source: "Profile", title: "Your profile: " + field.label, detail: clip(value, 420), body: value,
      meta: savedOn ? "About you, saved " + savedOn : "About you, the starting profile", page: "about", ref: field.key, saved: profileDoc && profileDoc.updatedAt, entities: []});
  });
  const at = todayKey ? todayKey + "T00:00:00Z" : "";
  const votes = BriefingCore.readerVotes((docs.dailyBoost && docs.dailyBoost.entries) || {}, todayKey);
  const tally = (list) => {
    const counts = {};
    list.forEach((v) => { if (v.section) counts[v.section] = (counts[v.section] || 0) + 1; });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b)).map((k) => k + " " + counts[k]).join(", ");
  };
  if (votes.up.length || votes.down.length) {
    out.push({id: "activity:votes", source: "Activity", title: "Your story votes (last 30 days)",
      detail: [votes.up.length + " more like this" + (tally(votes.up) ? " (" + tally(votes.up) + ")" : ""), votes.down.length ? votes.down.length + " less like this" + (tally(votes.down) ? " (" + tally(votes.down) + ")" : "") : ""].filter(Boolean).join("; "),
      body: votes.up.map((v) => "More: " + v.headline).concat(votes.down.map((v) => "Less: " + v.headline)).join(" · "),
      meta: "Votes on briefing stories", page: "about", ref: "votes", saved: at, entities: []});
  }
  const calls = arr(docs.decisions).filter((d) => d && (text(d.status) || "open") !== "closed" && (text(d.action) || "watched") !== "skipped");
  if (calls.length) {
    out.push({id: "activity:calls", source: "Activity", title: "Your open calls",
      detail: calls.slice(0, 10).map((d) => text(d.asset || d.subject) + " (" + [text(d.action), text(d.createdDate), d.conviction ? "conviction " + d.conviction + "/5" : "", text(d.reason) ? "" : "no reason recorded"].filter(Boolean).join(", ") + ")").join("; "),
      meta: "Decision journal", page: "about", ref: "calls", saved: at, entities: []});
  }
  const accounts = arr(docs.accounts && docs.accounts.accounts).map((a) => text(a && a.name)).filter(Boolean);
  if (accounts.length) {
    out.push({id: "activity:accounts", source: "Activity", title: "Your accounts", detail: accounts.length + " accounts: " + accounts.join(", "),
      meta: "His own list (Evidence, Your accounts)", page: "about", ref: "accounts", saved: at, entities: []});
  }
  const goals = arr(docs.goals && docs.goals.goals).filter((g) => g && !g.archived && text(g.text)).slice(0, 3);
  if (goals.length) {
    out.push({id: "activity:goals", source: "Activity", title: "Your goals", detail: goals.map((g) => text(g.text) + (text(g.nextMove) ? " (next: " + text(g.nextMove) + ")" : "")).join("; "),
      meta: "Your goals on Today", page: "about", ref: "goals", saved: at, entities: []});
  }
  const weights = (docs.prefs && docs.prefs.sourceWeights) || {}, quiet = arr(docs.prefs && docs.prefs.quietSources);
  const changed = Object.keys(weights).filter((k) => weights[k] !== 1).sort().map((k) => k + ": " + (weights[k] < 1 ? "Low" : "High")).concat(quiet.map((k) => k + ": quiet"));
  if (changed.length) {
    out.push({id: "activity:priorities", source: "Activity", title: "Your Morning 5 priorities", detail: changed.join(", ") + "; every other source Normal",
      meta: "Command settings", page: "about", ref: "priorities", saved: at, entities: []});
  }
  // What he opens most over the last 14 days: pages, and Your numbers.
  const days = (docs.usage && docs.usage.days) || {}, totals = {};
  const since = todayKey ? new Date(Date.parse(todayKey + "T00:00:00Z") - 13 * 86400000).toISOString().slice(0, 10) : "";
  Object.keys(days).filter((d) => !since || (d >= since && d <= todayKey)).forEach((d) => Object.keys(days[d] || {}).forEach((key) => {
    const name = key === "open_grounding-panel" ? "Your numbers" : /^page_/.test(key) ? PAGE_NAMES[key.slice(5)] : key === "fn_runaskdaybook" ? "Ask Daybook" : "";
    if (name) totals[name] = (totals[name] || 0) + (Number(days[d][key]) || 0);
  }));
  const used = Object.keys(totals).filter((k) => totals[k] > 0).sort((a, b) => totals[b] - totals[a] || a.localeCompare(b)).slice(0, 8);
  if (used.length) {
    out.push({id: "activity:usage", source: "Activity", title: "What you open most (last 14 days)", detail: used.map((k) => k + " " + totals[k]).join(" · "),
      meta: "Usage counts", page: "about", ref: "usage", saved: at, entities: []});
  }
  return out;
}

// His calendar, weekly commitments, PokerHQ ★ picks and Flights as index rows,
// with their computed overviews (lib/life-records-core.js, synced here).
// life = {core, calendar, flights, review}: the shared modules, passed in so
// this file stays pure. The PokerHQ bankroll only feeds PokerHQ's own grade.
// The last weekly read's one suggestion, for the week's ideas.
function latestTryNext(doc) {
  const mirrors = (doc && doc.mirrors) || {};
  const last = mirrors[Object.keys(mirrors).sort().pop()];
  return last && last.try_next && typeof last.try_next.action === "string" ? last.try_next.action : "";
}
function lifeRecords(docs, life) {
  if (!life || !life.core || typeof life.core.records !== "function") return [];
  const value = (doc) => {
    if (!doc) return null;
    try { return typeof doc.value === "string" ? JSON.parse(doc.value) : doc.value; } catch (error) { return null; }
  };
  const bankroll = value(docs.pokerBankroll);
  const tourneys = value(docs.pokerTourneys);
  return life.core.records({
    today: docs.todayKey,
    now: docs.now,
    calendar: {manual: arr(docs.calendarEvents && docs.calendarEvents.items), meetings: docs.calendarMeetings || null},
    review: docs.review || null,
    extra: {decisions: arr(docs.decisions), evidenceSets: arr(docs.prefs && docs.prefs.evidenceSets && docs.prefs.evidenceSets.sets),
      goals: arr(docs.goals && docs.goals.goals), tryNext: latestTryNext(docs.mirrors)},
    poker: Array.isArray(tourneys) ? {tourneys, sessions: arr(value(docs.pokerSessions)),
      bankroll: bankroll && Number(bankroll.amount) > 0 ? {amount: Number(bankroll.amount), rule: Number(bankroll.rule) || 5} : null} : null,
    flights: docs.flights ? {latest: docs.flights, saved: (docs.flightsSaved && docs.flightsSaved.savedOffers) || {}, history: docs.flightsHistory || null, fx: docs.fx || null} : null,
  }, {calendar: life.calendar, flights: life.flights, review: life.review});
}

// One lookup. With no terms, it reads every Profile and Activity record (they
// are few, and a question about him has no words to match); otherwise the
// usual planned search.
function lookupRecords(index, plan, searchCore, now) {
  if (!arr(plan.terms).length) {
    const sources = arr(plan.sources);
    if (!sources.length || !sources.every((source) => ABOUT_SOURCES.indexOf(source) >= 0)) return [];
    return arr(index).filter((item) => sources.indexOf(item.source) >= 0).slice(0, plan.limit || LOOKUP_LIMIT);
  }
  return searchCore.searchPlan(index, plan, {now});
}

// The search index's input, from the documents the server read for him. The
// reflections mirror the app's (daily-boost.js dailyBoostSearchEntries).
function askIndexInput(docs, core, life) {
  docs = docs || {};
  const briefings = [];
  arr(docs.briefings).forEach((doc) => {
    try { briefings.push({key: doc.id, saved: doc.saved, data: typeof doc.data === "string" ? JSON.parse(doc.data) : doc.data}); } catch (error) {}
  });
  let reflections = [];
  if (core && typeof core.clean === "function" && docs.dailyBoost && docs.dailyBoost.entries) {
    const records = core.clean(docs.dailyBoost.entries);
    reflections = Object.keys(records).sort().map((day) => {
      const entry = records[day] || {};
      const stories = arr(entry.stories).map((story) => story && story.headline).filter(Boolean).concat(entry.ref ? [entry.ref] : []);
      if (!text(entry.note) && !stories.length) return null;
      return {day, label: day, spark: core.sparkTitle ? core.sparkTitle(entry.spark) : "", theme: "", note: text(entry.note), done: !!entry.done, stories};
    }).filter(Boolean);
  }
  return {
    briefings,
    reports: arr(docs.reports),
    decisions: arr(docs.decisions),
    reflections,
    evidence: docs.prefs && docs.prefs.evidenceSets,
    dossiers: docs.dossiers && docs.dossiers.items,
    meetingBriefs: docs.meetings && docs.meetings.items,
    mirrors: docs.mirrors && docs.mirrors.mirrors,
    grounding: docs.grounding,
    records: aboutRecords(docs, docs.todayKey).concat(lifeRecords(docs, life)),
    news: docs.news,
    radar: docs.radar,
    radarJournal: docs.radarJournal,
    markets: docs.markets,
    sports: docs.sports,
  };
}

// The lookup loop. `call(body)` sends one Responses request (the Function adds
// the model, tools and key) and `lookup(plan)` runs one search, returning the
// tool output; tests pass fakes for both. Each round answers every lookup the
// model asked for; after the last one allowed, the next request forbids tools,
// so the model has to answer.
async function runLookups({firstBody, call, lookup}) {
  let json = await call(firstBody);
  let lookups = 0;
  for (let round = 0; round <= MAX_LOOKUPS; round++) {
    const calls = arr(json && json.output).filter((item) => item && item.type === "function_call");
    if (!calls.length) break;
    const input = calls.map((item) => {
      let output;
      if (item.name !== SEARCH_TOOL.name) {
        output = JSON.stringify({error: "Unknown tool."});
      } else if (lookups >= MAX_LOOKUPS) {
        output = JSON.stringify({error: "Lookup limit reached. Answer now from what you have."});
      } else {
        lookups++;
        output = lookup(cleanPlan(item.arguments));
      }
      return {type: "function_call_output", call_id: item.call_id, output};
    });
    const last = lookups >= MAX_LOOKUPS || round === MAX_LOOKUPS;
    json = await call({previous_response_id: json.id, input, tool_choice: last ? "none" : "auto"});
  }
  return {json, lookups};
}

// What the app is told when OpenAI refuses a request. A refused key is a
// server setting, not something to retry, and OpenAI's own message echoes a
// fragment of the key, so it is never passed on (1 Oct: the OPENAI_API_KEY
// secret's newest version held another provider's key).
function providerError(status, message) {
  if (status === 401 || status === 403) {
    return {code: "failed-precondition", message: "OpenAI refused the server's API key. Put the right key in the OPENAI_API_KEY secret, then redeploy askDaybook."};
  }
  // Not resource-exhausted: the app reads that as his own twenty-a-day limit.
  if (status === 429) return {code: "aborted", message: "OpenAI is rate-limiting or out of credit. Try again in a few minutes."};
  return {code: "internal", message: clip(String(message || "OpenAI request failed.").replace(/sk-[A-Za-z0-9_*-]+/g, "[key]"), 300)};
}

// The stored map keeps the latest twenty answers, oldest dropped first.
function keepAnswers(items, id, answer) {
  const next = Object.assign({}, items || {});
  next[id] = answer;
  const keys = Object.keys(next).sort((a, b) => String(next[a].generatedAt || "").localeCompare(String(next[b].generatedAt || "")));
  const out = {};
  keys.slice(-KEEP_ANSWERS).forEach((k) => { out[k] = next[k]; });
  return out;
}

module.exports = {
  requestIntent, intentInstructions, sentenceCount, reviewAnswer, refineAnswer,
  cleanQuestion, cleanThread, originOf, buildAskPrompt, buildAskInput, cleanPlan, newRegistry, lookupOutput, cleanAnswer,
  askIndexInput, aboutRecords, lifeRecords, splitRefs, untracedFigures, figureKeys, lookupRecords, runLookups, providerError, keepAnswers, SYSTEM, ABOUT_SOURCES, SEARCH_TOOL, ASK_SOURCES, MAX_LOOKUPS, LOOKUP_LIMIT, MAX_THREAD, KEEP_ANSWERS,
};
