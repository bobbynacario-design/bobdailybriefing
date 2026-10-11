"use strict";

// functions/client-note.js
//
// PURE — no I/O. "Draft a note" (11 Oct 2026): from a Go deeper dossier, a
// short email Bob can send an instructing party or a colleague about the
// story, for him to edit and send himself. Nothing is sent from Daybook.
//
// It is written only from the stored dossier and its story: no web search,
// no new facts. Every figure and date in the draft is traced against that
// material (ask-daybook.js untracedFigures); one correction is asked for, and
// anything still untraced is shown to him under the draft. The links come
// from the dossier's checked sources, added by code, never typed by the model.

const {profileBrief} = require("./briefing-prompt-core");
const {untracedFigures, splitRefs} = require("./ask-daybook");

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

// Who a note can be for: the kinds of account he writes to, or a colleague.
const KINDS = ["insurer", "law", "broker", "utility", "road", "telco", "colleague", "other"];
const KEEP_NOTES = 30;

// The request as the app sends it, bounded. Null without a dossier key and a
// recipient.
function cleanNoteRequest(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const key = text(data.key);
  const recipient = data.recipient && typeof data.recipient === "object" ? data.recipient : {};
  const name = clip(recipient.name, 60).replace(/[<>"]/g, "");
  const kind = KINDS.indexOf(recipient.kind) >= 0 ? recipient.kind : "other";
  if (!/^[\w:.|/-]{4,220}$/.test(key) || name.length < 2) return null;
  return {key, recipient: {name, kind}, angle: clip(data.angle, 240)};
}

// What a recipient of each kind cares about, for the "why it matters" line.
const KIND_NOTES = {
  insurer: "an insurer instructing him on claims: recoveries, defence of third-party claims, claim quantum and reserves",
  law: "a law firm acting on claims: quantum evidence, expert issues and what a court would accept",
  broker: "a broker or claims adjuster: their clients' exposure and what to ask insureds",
  utility: "a utility or network owner: their costs, rates and recovery claims",
  road: "a road authority: their asset repair costs and recovery claims",
  telco: "a telco: their network repair costs and recovery claims",
  colleague: "a colleague at his firm: how it bears on the files they work on",
  other: "a business contact: why it bears on their work",
};

// The dossier and its story as the one block of material the note may use.
function noteMaterial(dossier) {
  const d = dossier || {}, story = d.story || {};
  const lines = ["Story: " + clip(story.headline, 300)];
  // The date is his briefing's, not the article's (11 Oct: a note said
  // "reported on 11 October" from it).
  if (story.source) lines.push("Reported by: " + clip(story.source, 120) + " (publication date not given)");
  if (story.date) lines.push("In his briefing of: " + clip(story.date, 60));
  if (d.summary) lines.push("Summary: " + clip(d.summary, 700));
  arr(d.background).forEach((b) => lines.push("Background: " + clip(b, 420)));
  arr(d.numbers).forEach((n) => lines.push("Figure: " + clip(n && n.figure, 40) + (n && n.what ? " — " + clip(n.what, 200) : "") + (n && n.source ? " (" + clip(n.source, 100) + ")" : "")));
  if (d.bi_angle) lines.push("Possible BI and claims angle (a read to raise, not fact): " + clip(d.bi_angle, 900));
  if (arr(d.exposed).length) lines.push("Exposed: " + arr(d.exposed).map((x) => clip(x, 140)).join("; "));
  arr(d.client_questions).forEach((q) => lines.push("Question for a client: " + clip(q, 320)));
  if (d.would_change) lines.push("What would change the read: " + clip(d.would_change, 700));
  return lines.join("\n");
}

const SYSTEM = "You draft short, plain emails for an insurance claims quantum specialist to send to clients and colleagues, " +
  "written only from the material you are given. Return strict JSON only.";

const SCHEMA = {
  type: "object",
  properties: {subject: {type: "string"}, body: {type: "string"}},
  required: ["subject", "body"],
  additionalProperties: false,
};

function buildNotePrompt({dossier, recipient, angle, profile}) {
  const r = recipient || {name: "a colleague", kind: "colleague"};
  return profileBrief(profile).concat([
    "",
    "He wants to send a short email about one news story to " + (r.kind === "colleague" ? "a colleague" : r.name) + ", " + (KIND_NOTES[r.kind] || KIND_NOTES.other) + ".",
    angle ? "HIS ANGLE (his own words; build the note around it): " + angle : "",
    "",
    "THE MATERIAL (his Go deeper dossier on the story; the only facts you may use):",
    noteMaterial(dossier),
    "",
    "Return a single JSON object: {\"subject\": \"...\", \"body\": \"...\"}.",
    "",
    "RULES:",
    "- subject: at most 10 words, specific to the story and to why it matters to them. No \"FYI\" or \"Update\" on its own.",
    "- body: start with \"Hi [Name],\" on its own line (he fills in the name), then at most 130 words in two or three short paragraphs, then \"Kind regards,\" and \"Bob\" on their own lines.",
    "- First paragraph: what happened, attributed to who reported it (\"Insurance Business reported that…\"). Give no publication date: the material only has the date of his briefing. Second: why it may matter for " + (r.kind === "colleague" ? "our files" : "their files") + ", in his own hedged words (\"My read is…\", \"This may…\", \"It could…\"), drawn from the BI and claims angle. End with one question or offer, adapted from the questions for a client where one fits.",
    "- Use only the material. Every figure, date and name must be in it; copy figures exactly, never round, convert or add them up. Leave out a figure rather than guess.",
    "- The BI and claims angle is a possibility to raise, never established fact or the recipient's position. Write it as his read in plain words. Never mention AI, a dossier, an analysis or where the read came from: the email is from Bob.",
    "- No legal advice, no investment advice, no promises about cover or outcomes. Do not name claimants or files.",
    "- Do not include links or a sources line; they are added after your text.",
    "- Plain English, Australian spelling, no emojis, no markdown, no bullet points. Use newline characters between paragraphs.",
  ]).filter((line, i, all) => line !== "" || (all[i - 1] !== "" && i > 0)).join("\n");
}

// The links the email ends with: the story, then up to two of the dossier's
// checked sources, each once.
function noteSources(dossier) {
  const d = dossier || {}, story = d.story || {}, seen = {}, out = [];
  const add = (title, url) => {
    url = text(url);
    if (!/^https?:\/\//i.test(url) || seen[url.toLowerCase()] || out.length >= 3) return;
    seen[url.toLowerCase()] = true;
    out.push({title: clip(title, 160) || url.replace(/^https?:\/\//i, "").slice(0, 80), url: url.slice(0, 600)});
  };
  add([story.source, story.headline].filter(Boolean).join(": "), story.url);
  arr(d.sources).forEach((s) => add(s && s.title, s && s.url));
  return out;
}

// The draft as stored and shown: subject and body bounded, markdown and stray
// links removed, the greeting and sign-off kept on their own lines.
function cleanNote(raw) {
  if (!raw || typeof raw !== "object") return null;
  const subject = clip(text(raw.subject).replace(/^subject:\s*/i, "").replace(/[*_#`]/g, ""), 120);
  const body = splitRefs(text(raw.body)).replace(/\r\n?/g, "\n").replace(/\s*\[[SW]\d+\]/g, "").replace(/[*_#`]/g, "")
    .replace(/https?:\/\/\S+/g, "").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000);
  if (subject.length < 3 || body.length < 40) return null;
  return {subject, body};
}

// Figures and dates in the draft that the material does not state.
function traceNote(note, dossier, extra) {
  const d = dossier || {}, story = d.story || {};
  const registry = {list: [{item: {title: story.headline, detail: d.summary, body: noteMaterial(d), meta: [story.source, story.date].join(" "), saved: ""}}]};
  return untracedFigures([note.subject, note.body].join("\n"), registry, arr(extra));
}

// What else the first real note (11 Oct) got wrong, checked in code: the
// instructions leaking into the email, and the length.
const LEAKS = /\b(AI-assisted|AI-written|AI-generated|dossier|not established fact|the material)\b/i;
// "AI" itself only counts when the story is not about AI.
const AI_WORDS = /\b(AI|A\.I\.|artificial intelligence)\b/i;
function noteWords(body) {
  const lines = text(body).split("\n").map((l) => l.trim()).filter(Boolean);
  const inner = lines.filter((l, i) => !(i === 0 && /^hi\b/i.test(l)) && !/^(kind regards|regards|thanks|cheers),?$/i.test(l) && !(i === lines.length - 1 && /^bob$/i.test(l)));
  return inner.join(" ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
function noteProblems(note, dossier) {
  const problems = [];
  const all = note.subject + "\n" + note.body;
  const leak = all.match(LEAKS) || (dossier && AI_WORDS.test(noteMaterial(dossier)) ? null : all.match(AI_WORDS));
  if (leak) problems.push("It mentions \"" + leak[0] + "\": the email is from Bob, so never mention AI, a dossier, an analysis or the material.");
  const words = noteWords(note.body);
  if (words > 145) problems.push("It is " + words + " words between greeting and sign-off; keep it to 130.");
  return problems;
}
function correctionPrompt(untraced, problems) {
  const lines = [];
  if (arr(untraced).length) lines.push("It gives figures or dates that are not in the material: " + untraced.join(", ") + ". Remove them, or use the material's own figure copied exactly.");
  arr(problems).forEach((p) => lines.push(p));
  return "Fix your draft: " + lines.join(" ") + " Keep everything else. Return the same JSON object.";
}

// The stored map keeps the latest thirty notes, oldest dropped first.
function keepNotes(items, id, note) {
  const next = Object.assign({}, items || {});
  next[id] = note;
  const keys = Object.keys(next).sort((a, b) => String(next[a].generatedAt || "").localeCompare(String(next[b].generatedAt || "")));
  const out = {};
  keys.slice(-KEEP_NOTES).forEach((k) => { out[k] = next[k]; });
  return out;
}

module.exports = {cleanNoteRequest, noteMaterial, buildNotePrompt, noteSources, cleanNote, traceNote, noteProblems, noteWords, correctionPrompt, keepNotes, SYSTEM, SCHEMA, KINDS, KEEP_NOTES};
