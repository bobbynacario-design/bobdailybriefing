"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {cleanStory, buildDossierPrompt, cleanDossier, keepDossiers, KEEP_DOSSIERS} = require("./story-dossier");

const STORY = {
  headline: "Strata storm claim turns toxic", source: "insuranceNEWS", url: "https://www.insurancenews.com.au/strata?utm=x",
  body: "A storm claim escalated into mould and habitability disputes.", relevance: "Strata insurers are exposed through escalating water claims.",
  section: "insurance", date: "Saturday, September 26, 2026",
};

test("the story is bounded, and one without a real headline is refused", () => {
  const story = cleanStory(Object.assign({}, STORY, {body: "x".repeat(2000), url: "javascript:alert(1)"}));
  assert.equal(story.body.length, 900);
  assert.equal(story.url, "", "only web links");
  assert.equal(cleanStory({headline: "Short"}), null);
  assert.equal(cleanStory(null), null);
});

test("the prompt carries the story and the rules that keep the dossier honest", () => {
  const prompt = buildDossierPrompt(cleanStory(STORY));
  assert.match(prompt, /- Headline: Strata storm claim turns toxic/);
  assert.match(prompt, /- Why it mattered: Strata insurers are exposed/);
  assert.match(prompt, /briefing of Saturday, September 26, 2026/);
  assert.match(prompt, /each found in a source\. Dates are not figures; put them in background\./);
  assert.match(prompt, /Never estimate or round a figure into existence/);
  assert.match(prompt, /exposed: short phrases of six words or fewer, each starting with a capital/);
  assert.match(prompt, /figures about this story itself/);
  assert.match(prompt, /Leave out figures about the wider sector or market/);
  assert.match(prompt, /"summary": "2 sentences, at most 60 words/);
  assert.match(prompt, /client_questions: exactly 3, specific to this story/);
  assert.match(prompt, /each url copied exactly from a web search result/);
  assert.match(prompt, /Never give investment advice/);
  assert.ok(prompt.includes("- would_change: give a date only if a search result states it"), "a due date must come from a source");
  assert.match(prompt, /"bi_angle": "2-3 sentences: the loss mechanism, the covers that could respond/);
  assert.doesNotMatch(buildDossierPrompt(cleanStory({headline: "Only a headline here"})), /- Source:|- Link:|- Summary:/, "absent fields leave no empty lines");
});

test("cleanDossier bounds fields and keeps only sources the search returned", () => {
  const searched = ["https://www.insurancenews.com.au/strata", "https://afca.org.au/decision/123"];
  const dossier = cleanDossier({
    summary: " A claim escalated. ", background: ["One", "", "Two", "Three", "Four", "Five"],
    numbers: [{figure: "A$3.98bn", what: "Declared event costs", source: "ICA"}, {figure: "", what: "dropped"}, {figure: "12%", what: "x", source: "y"}],
    bi_angle: "Contingent BI for tenants.", exposed: ["Strata", "Loss adjusters"],
    client_questions: ["Q1?", "Q2?", "Q3?", "Q4?"], would_change: "AFCA determination next month.",
    sources: [{title: "News", url: "http://insurancenews.com.au/strata/"}, {title: "Made up", url: "https://example.com/not-searched"},
      {title: "Dup", url: "https://www.insurancenews.com.au/strata?ref=2"}, {title: "", url: "https://afca.org.au/decision/123"}],
    extra: "<script>",
  }, searched);
  assert.equal(dossier.summary, "A claim escalated.");
  assert.deepEqual(dossier.background, ["One", "Two", "Three", "Four"]);
  assert.equal(dossier.numbers.length, 2, "a number needs a figure");
  assert.equal(dossier.client_questions.length, 3);
  assert.deepEqual(dossier.sources.map((s) => s.url), ["http://insurancenews.com.au/strata/", "https://afca.org.au/decision/123"], "unsearched and duplicate pages are dropped");
  assert.equal(dossier.sources[1].title, "afca.org.au/decision/123", "a missing title falls back to the address");
  assert.equal(dossier.extra, undefined);
  assert.equal(cleanDossier({summary: " "}, []), null);
  assert.equal(cleanDossier(null, []), null);
  assert.deepEqual(cleanDossier({summary: "S", sources: [{url: "https://a.com/x"}]}, []).sources, [], "no search, no sources");
});

// The first real dossier ended two of its exposed items on "datas…" and "we…".
test("a long field is cut at a word, never mid-word, and short ones are untouched", () => {
  const long = "Health services and hospitals using aggregate datasets to train clinical models without consent from the patients concerned, ".repeat(2);
  const [cut] = cleanDossier({summary: "S", exposed: [long]}, []).exposed;
  assert.ok(cut.length <= 140 && cut.endsWith("…"), cut);
  const kept = cut.slice(0, -1);
  assert.ok(long.startsWith(kept) && long[kept.length] === " ", "ends on a whole word: " + cut);
  assert.equal(cleanDossier({summary: "S", exposed: ["strata insurers"]}, []).exposed[0], "strata insurers");
  const one = "x".repeat(200);
  assert.equal(cleanDossier({summary: "S", exposed: [one]}, []).exposed[0], "x".repeat(139) + "…", "one unbroken word is still cut");
  const change = "The Senate committee report on AI due 30 November 2026 would change this read if it recommends notifiable data breach duties for model providers, ".repeat(4);
  assert.ok(cleanDossier({summary: "S", would_change: change}, []).would_change.length > 400, "room for the full signal");
});

test("the stored map keeps the latest forty", () => {
  let items = {};
  for (let i = 0; i < 45; i++) items = keepDossiers(items, "k" + i, {generatedAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString()});
  assert.equal(Object.keys(items).length, KEEP_DOSSIERS);
  assert.ok(!items.k0 && items.k44, "oldest dropped, newest kept");
});
