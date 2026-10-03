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
const {profileBrief} = BriefingCore;

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
const CLIP_FOR = {Radar: 1200};
const MAX_THREAD = 3;
const KEEP_ANSWERS = 20;
// The search index's source names, as the lookup tool offers them.
const ASK_SOURCES = ["Profile", "Activity", "Briefing", "News", "Research", "Decisions", "Reflections", "Evidence", "Dossier", "Meeting",
  "Weekly read", "Numbers", "Radar", "Markets", "Sports"];
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
};
function originOf(source) {
  return ORIGIN[source] || "An item from his app (" + source + ")";
}

const SYSTEM = "You answer questions about an insurance and business-interruption consultant's own saved material, " +
  "which you look up with the search_daybook tool. You never state what a lookup did not return. Return strict JSON only.";

const SEARCH_TOOL = {
  type: "function",
  name: "search_daybook",
  description: "Look up Bob's own Daybook: his profile and what the app has picked up from him (Profile, Activity), his briefings, " +
    "news he was shown, research reports, decisions, notes, saved evidence, dossiers, meeting briefs, weekly reads, Your numbers, " +
    "and the Radar, Markets and Sports feeds. Any term may match; a term may be a phrase. Returns the best matches, newest first among equals.",
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

// The user message: who he is, his accounts, the rules, and the question.
// His profile (About you; profileBrief in briefing-prompt-core.js) opens the
// prompt in place of the line this file used to carry.
function buildAskPrompt({question, today, accounts, web, profile}) {
  const lines = profileBrief(profile).concat(["Today is " + today + " (Manila)."]);
  const named = arr(accounts).filter((a) => a && text(a.name)).slice(0, 40);
  if (named.length) {
    lines.push("", "HIS ACCOUNTS (name | other names), useful as lookup terms:");
    named.forEach((a) => lines.push("- " + clip(a.name, 60) + (arr(a.aliases).length ? " | " + arr(a.aliases).slice(0, 5).map((x) => clip(x, 40)).join(", ") : "")));
  }
  lines.push(
    "",
    "HOW TO ANSWER:",
    "- Look up his Daybook with search_daybook before answering, at least once and at most " + MAX_LOOKUPS + " times. Choose terms that would appear in the records: names, tickers, other names, synonyms. Narrow by sources or dates when the question implies it (\"since August\" is since the 1st of August this year).",
    "- A question about Bob himself (who he is, what he cares about, his habits, his work, his goals): look up sources Profile and Activity first, with terms empty to read them all, and answer from them. Never cite a briefing story, news item or report as evidence of who he is.",
    "- A question about the Radar (the app's daily market scan: a name's score, status, reason, catalyst, levels or tripwire, or today's Taker and Wildcard picks): look up sources Radar; the term \"radar\" reads today's names, highest score first, and \"Taker\" or \"Wildcard\" finds those picks. A name is early only when its meta says early. The Radar holds today's scan only, so it cannot say how a name has changed; say so if asked. Its levels are the scan's own, never a recommendation.",
    "- Each lookup result has a ref (S1, S2…) and a kind that says whose words it is:",
    "  - His profile, his own note, his decision journal, and the \"Note:\" part of a saved page are his words: \"you noted…\", \"you decided…\", \"you describe yourself as…\" is right.",
    "  - Activity is what he did in the app (votes, open calls, what he opens): describe it as what he did, never as what he said.",
    "  - A dossier, meeting brief or weekly read is AI-written for him; a saved page or report is something he kept: never present these as his view.",
    "  - A briefing story or news item he was shown: at most \"your 25 Sep briefing said…\". Being shown something is not interest.",
    web
      ? "- You may also search the web for what is new. Cite each web fact with [W1], [W2]… matching web_sources, copying each url exactly from a search result."
      : "- Do not use the web: answer only from what the lookups return.",
    "- Put the ref after each claim it supports, e.g. \"QBE lifted its cat allowance [S3].\" Never cite a ref a lookup did not return.",
    "- If the lookups find nothing useful, say so plainly in one sentence and leave answer short; never fill the gap from memory.",
    "- Dates and figures only as the records state them. Say who reported something when it matters.",
    "- Never give investment advice: no buying, selling, holding or sizing anything. For a question about one of his calls, give what he recorded (reason, invalidator, status, outcome, Called it?) and what the records say since.",
    "- Write to him as \"you\", in plain English with Australian spelling, no markdown, no emojis. At most 170 words.",
    "",
    "Return a single JSON object with exactly these keys:",
    "{",
    '  "answer": "the answer, with refs after the claims",',
    '  "not_found": "one short line on what his Daybook has nothing on, or an empty string",',
    '  "follow_ups": ["up to 2 short questions he might ask next"],',
    '  "web_sources": [{"title": "", "url": ""}]',
    "}",
    "",
    "QUESTION: " + question,
  );
  return lines.join("\n");
}

// The Responses API input: the system line, the thread as earlier turns, then
// this question.
function buildAskInput({question, thread, today, accounts, web, profile}) {
  const input = [{role: "system", content: SYSTEM}];
  cleanThread(thread).forEach((turn) => {
    input.push({role: "user", content: turn.q});
    input.push({role: "assistant", content: turn.a});
  });
  input.push({role: "user", content: buildAskPrompt({question, today, accounts, web, profile})});
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
    const parts = [item.detail, item.excerpt, item.body].map(text).filter(Boolean).filter((part, i, all) => all.indexOf(part) === i);
    return {ref: refFor(registry, item), kind: originOf(item.source), date: dayOf(item.saved), title: clip(item.title, 200),
      text: clip(parts.join(" — "), CLIP_FOR[item.source] || CLIP_TEXT), meta: clip(item.meta, 100)};
  });
  return JSON.stringify(results.length ? {results} : {results: [], note: "Nothing in his Daybook matched these terms."});
}

// What is stored and shown: known fields, bounded; refs kept only when a
// lookup returned them, web links only when the search returned the page.
function cleanAnswer(raw, registry, searched, web) {
  if (!raw || typeof raw !== "object") return null;
  let answer = clip(raw.answer, 1600);
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
  return {
    answer,
    // When no lookup found anything, say so even if the model did not.
    not_found: clip(raw.not_found, 240) || (registry.list.length ? "" : web ? "Nothing in your Daybook matched; this answer is from the web." : "Nothing in your Daybook matched this."),
    follow_ups: arr(raw.follow_ups).map((q) => clip(q, 160)).filter(Boolean).slice(0, 2),
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
function askIndexInput(docs, core) {
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
    records: aboutRecords(docs, docs.todayKey),
    news: docs.news,
    radar: docs.radar,
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
  cleanQuestion, cleanThread, originOf, buildAskPrompt, buildAskInput, cleanPlan, newRegistry, lookupOutput, cleanAnswer,
  askIndexInput, aboutRecords, lookupRecords, runLookups, providerError, keepAnswers, SYSTEM, ABOUT_SOURCES, SEARCH_TOOL, ASK_SOURCES, MAX_LOOKUPS, LOOKUP_LIMIT, MAX_THREAD, KEEP_ANSWERS,
};
