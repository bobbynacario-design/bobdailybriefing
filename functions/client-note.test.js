"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Note = require("./client-note");

const dossier = {
  story: {headline: "AER lifts Ausgrid labour rates for 2026-27", source: "AER", url: "https://www.aer.gov.au/news/ausgrid-2026", section: "insurance", date: "Thursday, September 24, 2026"},
  summary: "The AER approved Ausgrid's revised labour rates, with field worker rates rising 4.2% from 1 July.",
  background: ["The determination follows Ausgrid's 2024 proposal.", "Contractor rates were reviewed separately."],
  numbers: [{figure: "4.2%", what: "rise in field worker labour rates", source: "AER"}, {figure: "$152.30", what: "R4 field worker hourly rate", source: "AER"}],
  bi_angle: "Recovery claims for pole strikes in NSW may now cite the higher rates; insurers defending them could test whether invoices apply the right period.",
  exposed: ["Motor insurers defending pole strikes"],
  client_questions: ["Which open Ausgrid recovery files use rates from before 1 July?"],
  would_change: "A merits review application; no date is set.",
  sources: [{title: "AER determination", url: "https://www.aer.gov.au/determination"}, {title: "AER news", url: "https://www.aer.gov.au/news/ausgrid-2026"}, {title: "Energy News", url: "https://energynews.com.au/x"}, {title: "Fourth", url: "https://example.com/4"}],
};

test("a request needs a dossier key and a recipient, bounded and with a known kind", () => {
  assert.deepEqual(Note.cleanNoteRequest({key: "briefing|aer-lifts", recipient: {name: "QBE", kind: "insurer"}, angle: " ask about open files "}),
    {key: "briefing|aer-lifts", recipient: {name: "QBE", kind: "insurer"}, angle: "ask about open files"});
  assert.equal(Note.cleanNoteRequest({key: "briefing|x", recipient: {name: "QBE", kind: "spy"}}).recipient.kind, "other");
  assert.equal(Note.cleanNoteRequest({key: "briefing|x", recipient: {name: "<QBE>"}}).recipient.name, "QBE", "no angle brackets or quotes");
  assert.equal(Note.cleanNoteRequest({key: "bad key with spaces", recipient: {name: "QBE"}}), null);
  assert.equal(Note.cleanNoteRequest({key: "briefing|x", recipient: {name: ""}}), null);
  assert.equal(Note.cleanNoteRequest({key: "briefing|x", recipient: {name: "QBE"}, angle: "x".repeat(400)}).angle.length <= 240, true);
});

test("the prompt carries the material, the recipient's concerns, his angle and the strict rules", () => {
  const prompt = Note.buildNotePrompt({dossier, recipient: {name: "QBE", kind: "insurer"}, angle: "ask whether their open files use the old rates", profile: null});
  assert.match(prompt, /send a short email about one news story to QBE, an insurer instructing him on claims/);
  assert.match(prompt, /HIS ANGLE \(his own words; build the note around it\): ask whether their open files use the old rates/);
  assert.match(prompt, /Figure: 4\.2% — rise in field worker labour rates \(AER\)/);
  assert.match(prompt, /Possible BI and claims angle \(a read to raise, not fact\): Recovery claims/);
  assert.match(prompt, /Reported by: AER \(publication date not given\)\nIn his briefing of: Thursday, September 24, 2026/);
  assert.ok(prompt.includes("Give no publication date: the material only has the date of his briefing."));
  assert.ok(prompt.includes("Never mention AI, a dossier, an analysis or where the read came from: the email is from Bob."));
  assert.ok(!/AI-written/.test(prompt), "nothing in the prompt for the model to repeat");
  assert.ok(prompt.includes("copy figures exactly, never round, convert or add them up"));
  assert.ok(prompt.includes("Do not include links or a sources line"));
  assert.ok(prompt.includes('start with "Hi [Name],"'));
  assert.ok(!/\n\n\n/.test(prompt), "no runs of blank lines");
  const colleague = Note.buildNotePrompt({dossier, recipient: {name: "A colleague", kind: "colleague"}, angle: "", profile: null});
  assert.match(colleague, /to a colleague, a colleague at his firm/);
  assert.ok(!colleague.includes("HIS ANGLE"));
});

test("a draft is cleaned: no markdown, links or refs; greeting and sign-off on their own lines", () => {
  const note = Note.cleanNote({subject: "Subject: **AER lifts Ausgrid rates**", body: "Hi [Name],\n\nThe AER reported on 24 Sep that rates rose 4.2% [S1]. See https://x.com/a\n\n\n\nThis may matter.\nKind regards,\nBob"});
  assert.equal(note.subject, "AER lifts Ausgrid rates");
  assert.equal(note.body, "Hi [Name],\n\nThe AER reported on 24 Sep that rates rose 4.2%. See\n\nThis may matter.\nKind regards,\nBob");
  assert.equal(Note.cleanNote({subject: "Hi", body: "short"}), null);
  assert.equal(Note.cleanNote(null), null);
});

test("every figure and date in a draft is traced to the dossier; an invented one is caught", () => {
  const ok = {subject: "Ausgrid field rates up 4.2%", body: "Hi [Name],\nThe AER reported on 24 Sep that the R4 rate is $152.30, from 1 July.\nKind regards,\nBob"};
  assert.deepEqual(Note.traceNote(ok, dossier, []), []);
  const bad = {subject: "Ausgrid rates up 4.5%", body: "Hi [Name],\nThe AER said rates rise from 1 August, worth $2.1m to QBE.\nKind regards,\nBob"};
  assert.deepEqual(Note.traceNote(bad, dossier, []), ["4.5%", "1 August", "$2.1"]);
  assert.match(Note.correctionPrompt(["4.5%"], []), /not in the material: 4\.5%\. Remove them/);
});

test("the email's links are the story's, then the dossier's checked sources, three at most and each once", () => {
  assert.deepEqual(Note.noteSources(dossier).map((s) => s.url), ["https://www.aer.gov.au/news/ausgrid-2026", "https://www.aer.gov.au/determination", "https://energynews.com.au/x"]);
  assert.equal(Note.noteSources(dossier)[0].title, "AER: AER lifts Ausgrid labour rates for 2026-27");
  assert.deepEqual(Note.noteSources({story: {url: "javascript:alert(1)"}, sources: []}), []);
});

test("the stored map keeps the latest thirty notes", () => {
  let items = {};
  for (let i = 0; i < 35; i++) items = Note.keepNotes(items, "n" + i, {generatedAt: "2026-10-" + String(10 + Math.floor(i / 10)).padStart(2, "0") + "T00:00:" + String(i % 60).padStart(2, "0") + "Z"});
  assert.equal(Object.keys(items).length, 30);
  assert.ok(!items.n0 && items.n34);
});

test("the first real note's faults are caught in code: the instructions showing through, and length", () => {
  const leaky = {subject: "Midwife PI exemption ends", body: "Hi [Name],\n\nMy read, which is an AI-assisted analysis and not established fact, is that BI will not respond.\n\nKind regards,\nBob"};
  assert.match(Note.noteProblems(leaky, dossier)[0], /It mentions "AI-assisted"/);
  const plainAi = {subject: "New rules", body: "Hi [Name],\n\nMy read is that AI tools will speed up claims triage.\n\nKind regards,\nBob"};
  assert.match(Note.noteProblems(plainAi, dossier)[0], /It mentions "AI"/, "AI, when the story is not about AI");
  const aiStory = Object.assign({}, dossier, {summary: "Insurers adopt AI triage for claims."});
  assert.deepEqual(Note.noteProblems(plainAi, aiStory), [], "a story about AI may say AI");
  const long = {subject: "Long", body: "Hi [Name],\n\n" + "word ".repeat(150) + "\n\nKind regards,\nBob"};
  assert.deepEqual(Note.noteProblems(long, dossier), ["It is 150 words between greeting and sign-off; keep it to 130."]);
  assert.equal(Note.noteWords("Hi [Name],\n\nOne two three.\n\nKind regards,\nBob"), 3, "greeting and sign-off are not counted");
  assert.equal(Note.correctionPrompt(["4.5%"], ["It is 150 words between greeting and sign-off; keep it to 130."]),
    "Fix your draft: It gives figures or dates that are not in the material: 4.5%. Remove them, or use the material's own figure copied exactly. It is 150 words between greeting and sign-off; keep it to 130. Keep everything else. Return the same JSON object.");
});
