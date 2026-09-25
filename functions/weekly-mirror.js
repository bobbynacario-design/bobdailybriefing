"use strict";

// functions/weekly-mirror.js
//
// PURE — no I/O, no clock of its own. Builds the "Your week, read back" prompt
// from what Bob recorded in the app over the last seven days, and checks what
// comes back before it is stored.
//
// WHY: the app has always talked in one direction. The briefing tells Bob about
// the world; Daily Boost, the story buttons and the decision journal record what
// he does. Nothing ever read that record back to him, so the patterns in it —
// what he keeps returning to, what he says he wants against what he actually
// did — stayed invisible. His own note put it plainly: "help me understand
// myself better and lead me to something I have not done".
//
// Three things would make this worse than nothing, and the prompt rules are
// written against them:
//   - Invention. A mirror that describes a feeling or an event Bob never
//     recorded is a horoscope. Every observation has to point at something he
//     wrote or did, by day, and a quiet week is reported as a quiet week.
//   - Therapy-speak and flattery. No diagnosis, no clinical words, no "great
//     job". Candid, specific and kind is the register.
//   - Trade advice. The decision journal is here for how he decides, never for
//     what to buy or sell — the same line the briefing holds.

const MIRROR_DAYS = 7;
const NOTE_CHARS = 700;
const TEXT_CHARS = 200;
const LIST_MAX = 5;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const THEME_LABELS = {Reset: "Rest & reset", Craft: "Work craft", Review: "Weekly look-back"};
const INTENTIONS = {motivation: "Motivation", clarity: "Clarity", curiosity: "Curiosity", calm: "Calm", challenge: "A challenge"};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function text(value) {
  return String(value == null ? "" : value).trim();
}

// One line of Bob's own words, flattened and bounded, in quotes.
function quote(value, limit) {
  const flat = text(value).replace(/\s+/g, " ");
  const max = limit || TEXT_CHARS;
  return "\"" + (flat.length > max ? flat.slice(0, max - 1) + "…" : flat) + "\"";
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function shiftDay(dayKey, days) {
  return new Date(Date.parse(dayKey + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

function dayLabel(dayKey) {
  const date = new Date(dayKey + "T00:00:00Z");
  return WEEKDAYS[date.getUTCDay()] + " " + date.getUTCDate() + " " + MONTHS[date.getUTCMonth()];
}

// The seven PHT days ending today, oldest first.
function mirrorWindow(todayKey) {
  const days = [];
  for (let i = MIRROR_DAYS - 1; i >= 0; i--) days.push(shiftDay(todayKey, -i));
  return {from: days[0], to: todayKey, days};
}

function storyList(list, limit) {
  return arr(list).filter((item) => item && text(item.headline)).slice(0, limit || LIST_MAX)
    .map((item) => quote(item.headline, 140) + (text(item.source) ? " (" + text(item.source).slice(0, 60) + ")" : ""));
}

// "Note this" on a briefing card starts a line `On “Headline” (Source): ` in the
// day's note. A line left at that is a story he noted without comment — not his
// words, and not a note — so it is told apart from what he actually wrote.
const STUB = /^On “(.+)”(?: \(([^()]*)\))?:\s*(.*)$/;
function splitNote(note) {
  const own = [], comments = [], bare = [];
  text(note).split(/\n+/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const match = trimmed.match(STUB);
    if (!match) own.push(trimmed);
    else if (match[3].trim()) comments.push({headline: match[1], source: match[2] || "", text: match[3].trim()});
    else bare.push({headline: match[1], source: match[2] || ""});
  });
  return {own: own.join(" "), comments, bare};
}

// What one day looked like. Returns null for a day with nothing recorded.
// `today` marks the day the read is taken on, which is not over yet.
function dayBlock(key, entry, core, today) {
  if (!entry) return null;
  const lines = [];
  const note = splitNote(entry.note);
  const opened = arr(entry.opened).filter((item) => item && text(item.headline));
  const votes = arr(entry.feedback).filter((item) => item && text(item.headline) && (item.vote === 1 || item.vote === -1));
  const reminders = arr(entry.reminders).filter((item) => item && text(item.metric));
  // A story he commented on is listed with his comment, not again here.
  const seen = {};
  note.comments.forEach((item) => { seen[text(item.headline).toLowerCase()] = true; });
  const noted = arr(entry.stories).concat(note.bare).filter((item) => {
    const id = text(item && item.headline).toLowerCase();
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  });
  const wrote = note.own || note.comments.length;
  const active = wrote || entry.done || noted.length || opened.length || votes.length ||
    reminders.length || text(entry.trialPlan) || text(entry.trialOutcome);
  if (!active) return null;

  const title = core && typeof core.sparkTitle === "function" ? core.sparkTitle(entry.spark) : "";
  const theme = core && core.themes ? core.themes[entry.spark] : "";
  const how = entry.picked === "library" ? "picked from the library" : entry.picked === "swap" ? "swapped to it" :
    entry.picked === "intention" ? "chosen for " + (INTENTIONS[entry.intention] || "an intention") : "";
  let head = dayLabel(key) + (today ? " (" + today + ")" : "");
  if (title) head += " — spark " + quote(title, 80) + (theme ? " (" + (THEME_LABELS[theme] || theme) + ")" : "");
  head += entry.done ? "; quest done (" + (entry.energy === "stretch" ? "10-minute" : "2-minute") + ")" : today ? "; quest not done yet" : "; quest not done";
  if (how) head += "; " + how;
  else if (entry.intention && INTENTIONS[entry.intention]) head += "; intention: " + INTENTIONS[entry.intention];
  lines.push(head);
  if (note.own) lines.push("  Note: " + quote(note.own, NOTE_CHARS));
  note.comments.slice(0, LIST_MAX).forEach((item) => {
    lines.push("  On the story " + quote(item.headline, 140) + " he wrote: " + quote(item.text, 400));
  });
  if (text(entry.trialPlan)) {
    lines.push("  Experiment planned: " + quote(entry.trialPlan) + (entry.trialDone ? " — marked done" : today ? " — not done yet" : ""));
  }
  if (text(entry.trialOutcome)) lines.push("  Experiment outcome: " + quote(entry.trialOutcome, 400));
  if (noted.length) lines.push("  Stories he noted without comment: " + storyList(noted).join("; "));
  if (opened.length) lines.push("  Opened " + opened.length + " briefing " + (opened.length === 1 ? "story" : "stories") + ": " + storyList(opened).join("; "));
  const more = votes.filter((item) => item.vote === 1), less = votes.filter((item) => item.vote === -1);
  const section = (item) => text(item.section) ? " [" + text(item.section).slice(0, 20) + "]" : "";
  if (more.length) lines.push("  Wanted more like: " + more.slice(0, LIST_MAX).map((item) => quote(item.headline, 140) + section(item)).join("; "));
  if (less.length) lines.push("  Wanted less like: " + less.slice(0, LIST_MAX).map((item) => quote(item.headline, 140) + section(item)).join("; "));
  if (reminders.length) {
    lines.push("  Set reminders to check: " + reminders.slice(0, LIST_MAX).map((item) => quote(item.metric, 140) + (DAY.test(text(item.due)) ? " (due " + item.due + ")" : "")).join("; "));
  }
  return {
    lines,
    stats: {note: wrote ? 1 : 0, done: entry.done ? 1 : 0, opened: opened.length, votes: votes.length, noted: noted.length + note.comments.length},
  };
}

// "8:05 AM" in Manila, for saying how far into today the read was taken.
function manilaTime(now) {
  if (!Number.isFinite(now)) return "";
  return new Intl.DateTimeFormat("en-US", {timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit"}).format(new Date(now));
}

// A journal entry as a line about process: what, which way, how sure, and the
// reasoning. Prices and sizes are left out on purpose — they add nothing to how
// he decided and would invite the model to talk about the trade.
function decisionLine(entry, verb, dayKey) {
  const bits = [text(entry.asset || entry.subject).slice(0, 40) || "(unnamed)"];
  ["direction", "action", "conviction"].forEach((field) => {
    const value = text(entry[field]);
    if (value && value !== "none") bits.push(field === "conviction" ? "conviction " + value : value);
  });
  let out = "- " + verb + " " + dayLabel(dayKey) + ": " + bits.join(" / ");
  if (text(entry.reason)) out += " — thesis: " + quote(entry.reason, 160);
  else out += " — no thesis written";
  if (text(entry.invalidator)) out += " — wrong if: " + quote(entry.invalidator, 120);
  else if (verb === "Logged") out += " — no invalidation line";
  if (verb === "Closed") {
    if (text(entry.outcome)) out += " — outcome: " + text(entry.outcome).slice(0, 30);
    if (text(entry.outcomeNote)) out += " — his review: " + quote(entry.outcomeNote, 160);
  }
  return out;
}

function decisionBlock(decisions, win) {
  const inWeek = (day) => DAY.test(day) && day >= win.from && day <= win.to;
  const logged = [], closed = [];
  let open = 0;
  arr(decisions).forEach((entry) => {
    if (!entry) return;
    const status = text(entry.status) || "open";
    if (status !== "closed" && text(entry.action) !== "skipped") open++;
    if (inWeek(text(entry.createdDate))) logged.push(decisionLine(entry, "Logged", text(entry.createdDate)));
    if (status === "closed" && inWeek(text(entry.closedDate))) closed.push(decisionLine(entry, "Closed", text(entry.closedDate)));
  });
  return {lines: logged.slice(0, 8).concat(closed.slice(0, 8)), logged: logged.length, closed: closed.length, open};
}

// The most recent mirror from before today, so the new one can follow up on
// the question and the try it left. A regenerated mirror today must not follow
// up on itself from an hour ago.
function previousMirror(mirrors, todayKey) {
  const keys = Object.keys(mirrors || {}).filter((key) => DAY.test(key) && key < todayKey).sort();
  if (!keys.length) return null;
  const last = mirrors[keys[keys.length - 1]] || {};
  const question = text(last.question), tryNext = last.try_next && text(last.try_next.action);
  return question || tryNext ? {weekKey: keys[keys.length - 1], question, tryNext} : null;
}

// Everything the model is told about the week, or null when there is nothing to
// read back (no model call is made for an empty week). `now` (ms) says how far
// into today the read is taken: today is still going, so an unfinished quest on
// it is not a miss — the first real read held a 6:45 AM "not done" against him.
function buildMirrorInput({entries, decisions, mirrors, todayKey, core, now}) {
  if (!DAY.test(text(todayKey))) return null;
  const win = mirrorWindow(todayKey);
  const records = core && typeof core.clean === "function" ? core.clean(entries && typeof entries === "object" ? entries : {}) : (entries || {});
  const stats = {days: 0, notes: 0, done: 0, opened: 0, votes: 0, noted: 0, decisions: 0};
  const at = manilaTime(now);
  const todayNote = "today, still in progress" + (at ? " — read at " + at + " Manila" : "");
  const dayLines = [];
  win.days.forEach((key) => {
    const today = key === todayKey ? todayNote : "";
    const block = dayBlock(key, records[key], core, today);
    if (!block) { dayLines.push(dayLabel(key) + (today ? " (" + today + ") — nothing recorded yet" : " — nothing recorded")); return; }
    stats.days++;
    stats.notes += block.stats.note; stats.done += block.stats.done; stats.opened += block.stats.opened;
    stats.votes += block.stats.votes; stats.noted += block.stats.noted;
    dayLines.push(...block.lines);
  });
  const journal = decisionBlock(decisions, win);
  stats.decisions = journal.logged + journal.closed;
  if (!stats.days && !stats.decisions) return null;

  const parts = [
    "THE WEEK — " + dayLabel(win.from) + " to " + dayLabel(win.to) + ", one line per day (Manila dates):",
    dayLines.join("\n"),
  ];
  if (journal.lines.length) {
    parts.push("", "DECISIONS (his journal, this week):", journal.lines.join("\n"));
  }
  parts.push("", "Open calls in his journal overall: " + journal.open + ".");
  const previous = previousMirror(mirrors, todayKey);
  if (previous) {
    parts.push("", "LAST MIRROR (" + dayLabel(previous.weekKey) + "):");
    if (previous.question) parts.push("- The question it left him: " + quote(previous.question, 240));
    if (previous.tryNext) parts.push("- The thing it suggested trying: " + quote(previous.tryNext, 240));
  }
  return {text: parts.join("\n"), stats, window: win, previous: previous ? previous.weekKey : null};
}

const SYSTEM = "You read back a person's week to them from what they recorded in a private app. " +
  "You are candid, specific and kind — a sharp friend, not a therapist and not a cheerleader. Return strict JSON only.";

function buildMirrorPrompt(input) {
  return [
    "Bob is a forensic business-interruption consultant who works with Australian insurers and Philippine consulting firms.",
    "Below is everything he recorded in his daily app over the last seven days: the daily spark and quest, the note he wrote,",
    "the briefing stories he noted, opened and voted on, reminders he set, experiments, and decisions from his journal.",
    "Read it back to him so he understands himself a little better and finds one thing worth doing that he has not done.",
    "",
    "RULES:",
    "- Evidence only. Every observation must point at something in the record below, by day (\"On Thursday you wrote…\").",
    "  Quote his own words briefly where they carry the point. Never invent a feeling, event, person or fact he did not record.",
    "- A day marked \"nothing recorded\" means nothing was recorded, not that nothing happened. Gaps are worth naming only as a pattern.",
    "- The last day is today and is still in progress when this is read. An unfinished quest or experiment on it is not a miss,",
    "  and nothing recorded yet today is not a gap. Never use today's unfinished items as evidence in any field.",
    "- \"Note\" lines are his own words. \"On the story … he wrote\" lines are his comments on a briefing story. Stories he noted",
    "  without comment show interest only — do not read feelings or intentions into them.",
    "- If the week is thin (fewer than three days with a note, or no notes at all), say so plainly in week_in_a_line, keep every",
    "  field short, leave fields empty rather than stretching, and set confidence to \"thin\".",
    "- themes: things that came up on two or more different days, each with the days it appeared — not a summary of each day.",
    "  If nothing recurs (always the case when only one day has anything recorded), return at most one theme: what stood out,",
    "  with its one day.",
    "- energy: only where his own words say it (\"loved\", \"dreading\", \"tired of\") or an explicit choice shows it (picking the",
    "  10-minute quest, choosing an intention). Never infer either list from something not done or a day not recorded.",
    "  Empty lists are the expected answer in most weeks.",
    "- said_vs_did: where what he said he wants (notes, intentions, experiments planned) and what he did (quests, experiments done,",
    "  what he read) line up or part ways. Specific and fair, never moralising. Empty if the record does not show either side.",
    "- reading: what his noting, opening and voting say about where his attention goes. Empty if he did none.",
    "- decisions: how he decided, never what to trade — e.g. whether a thesis and an invalidation line were written, or how a close",
    "  was reviewed. Never recommend buying, selling, holding, exiting, sizing or hedging, and give no market view. Empty if none.",
    "- last_week: if a LAST MIRROR block is given, say honestly whether anything this week answers its question or shows the",
    "  suggested try happening. Empty if there is no LAST MIRROR block.",
    "- try_next: ONE small, concrete thing for the coming week that the record suggests he has not done yet — under 30 minutes,",
    "  tied to something he wrote, not a habit programme. why says which note or pattern it comes from.",
    "- question: ONE open question specific to this week that he could sit with. \"What do you want?\" is too generic.",
    "- No diagnosis or clinical words, no flattery, no generic self-help, no emojis. Plain English, short sentences, \"you\" not \"Bob\".",
    "  Never mention the app, the record, data or JSON — talk about his week.",
    "- Each string at most 60 words; week_in_a_line at most 25.",
    "",
    input.text,
  ].join("\n");
}

// Strict structured output: every key required, nothing extra.
const MIRROR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["week_in_a_line", "themes", "energy", "said_vs_did", "reading", "decisions", "last_week", "try_next", "question", "confidence"],
  properties: {
    week_in_a_line: {type: "string"},
    themes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["title", "detail", "days"],
        properties: {title: {type: "string"}, detail: {type: "string"}, days: {type: "array", items: {type: "string"}}},
      },
    },
    energy: {
      type: "object", additionalProperties: false, required: ["gave", "drained"],
      properties: {gave: {type: "array", items: {type: "string"}}, drained: {type: "array", items: {type: "string"}}},
    },
    said_vs_did: {type: "string"},
    reading: {type: "string"},
    decisions: {type: "string"},
    last_week: {type: "string"},
    try_next: {
      type: "object", additionalProperties: false, required: ["action", "why"],
      properties: {action: {type: "string"}, why: {type: "string"}},
    },
    question: {type: "string"},
    confidence: {type: "string", enum: ["thin", "fair", "rich"]},
  },
};

function clip(value, max) {
  const flat = text(value).replace(/\s+/g, " ");
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

// What is stored and shown: known fields only, bounded, the right types. Null
// when the two fields the mirror exists for are missing.
function cleanMirror(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {
    week_in_a_line: clip(raw.week_in_a_line, 240),
    themes: arr(raw.themes).filter((item) => item && text(item.title)).slice(0, 3).map((item) => ({
      title: clip(item.title, 80), detail: clip(item.detail, 500), days: arr(item.days).map((day) => clip(day, 20)).filter(Boolean).slice(0, 7),
    })),
    energy: {
      gave: arr(raw.energy && raw.energy.gave).map((item) => clip(item, 200)).filter(Boolean).slice(0, 3),
      drained: arr(raw.energy && raw.energy.drained).map((item) => clip(item, 200)).filter(Boolean).slice(0, 3),
    },
    said_vs_did: clip(raw.said_vs_did, 600),
    reading: clip(raw.reading, 600),
    decisions: clip(raw.decisions, 600),
    last_week: clip(raw.last_week, 600),
    try_next: {action: clip(raw.try_next && raw.try_next.action, 300), why: clip(raw.try_next && raw.try_next.why, 400)},
    question: clip(raw.question, 300),
    confidence: ["thin", "fair", "rich"].includes(raw.confidence) ? raw.confidence : "fair",
  };
  return out.week_in_a_line && out.question ? out : null;
}

// The stored map keeps the latest twelve reads, newest last.
const KEEP_MIRRORS = 12;
function keepRecent(mirrors, key, mirror) {
  const next = Object.assign({}, mirrors || {});
  next[key] = mirror;
  const keys = Object.keys(next).filter((k) => DAY.test(k)).sort();
  const out = {};
  keys.slice(-KEEP_MIRRORS).forEach((k) => { out[k] = next[k]; });
  return out;
}

module.exports = {
  buildMirrorInput, buildMirrorPrompt, cleanMirror, keepRecent, mirrorWindow, previousMirror,
  MIRROR_SCHEMA, SYSTEM, KEEP_MIRRORS,
};
