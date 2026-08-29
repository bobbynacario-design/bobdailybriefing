"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {buildEvidence, verifyGrounding, urlKey} = require("./briefing-evidence");

const NOW = Date.parse("2026-08-29T01:00:00.000Z");

function item(over) {
  return Object.assign({
    title: "A story", url: "https://news.example/a", summary: "Summary.",
    source: "insuranceNEWS.com.au", section: "Daily",
    publishedAt: "2026-08-28T00:00:00.000Z", score: 40, tier: "context",
  }, over || {});
}

function newsDoc(over) {
  return Object.assign({
    date: "2026-08-29",
    generatedAt: "2026-08-29T00:52:53.218Z",
    counts: {feeds: 9, feedsOk: 9, fetched: 204, unique: 102, kept: 40},
    items: [item()],
  }, over || {});
}

// ── buildEvidence ──

test("returns null when there is no news doc at all", () => {
  assert.equal(buildEvidence(null, {now: NOW}), null);
});

test("refuses a doc older than the staleness limit, and says so", () => {
  const out = buildEvidence(newsDoc({generatedAt: "2026-08-20T00:00:00.000Z"}), {now: NOW});
  assert.equal(out.unavailable, "stale");
  assert.equal(out.ageDays, 9);
});

test("a doc a day old is still usable", () => {
  const out = buildEvidence(newsDoc({generatedAt: "2026-08-28T01:00:00.000Z"}), {now: NOW});
  assert.equal(out.unavailable, undefined);
  assert.equal(out.ageDays, 1);
});

test("reports an empty doc rather than producing an empty block", () => {
  const out = buildEvidence(newsDoc({items: []}), {now: NOW});
  assert.equal(out.unavailable, "empty");
});

test("items without a url or without a title cannot be grounded on and are excluded", () => {
  const out = buildEvidence(newsDoc({items: [
    item({url: "", title: "No link"}),
    item({url: "https://news.example/b", title: ""}),
    item({url: "https://news.example/c", title: "Usable"}),
  ]}), {now: NOW});
  assert.equal(out.itemCount, 1);
  assert.equal(out.items[0].title, "Usable");
  assert.equal(out.poolCount, 3, "pool still reports what the day actually held");
});

test("core-tier stories are offered ahead of higher-scoring trade stories", () => {
  const out = buildEvidence(newsDoc({items: [
    item({url: "https://news.example/trade", title: "Trade", tier: "trade", score: 99}),
    item({url: "https://news.example/core", title: "Core", tier: "core", score: 10}),
  ]}), {now: NOW});
  assert.deepEqual(out.items.map((i) => i.title), ["Core", "Trade"]);
});

test("the offer is capped and numbered from one", () => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push(item({url: "https://news.example/" + i}));
  const out = buildEvidence(newsDoc({items: many}), {now: NOW, maxItems: 5});
  assert.equal(out.itemCount, 5);
  assert.equal(out.poolCount, 30);
  assert.equal(out.items[0].n, 1);
  assert.equal(out.items[4].n, 5);
});

test("the block carries the exact headline, publisher and url", () => {
  const out = buildEvidence(newsDoc({items: [item({
    title: "Claims intermediaries under ASIC watch",
    url: "https://www.insurancenews.com.au/regulatory-government/claims-intermediaries",
    source: "insuranceNEWS.com.au",
  })]}), {now: NOW});
  assert.match(out.block, /\[1\] Claims intermediaries under ASIC watch/);
  assert.match(out.block, /publisher: insuranceNEWS\.com\.au/);
  assert.match(out.block, /url: https:\/\/www\.insurancenews\.com\.au\/regulatory-government\/claims-intermediaries/);
});

test("the block names how many feeds were reached, so a degraded day is visible in the prompt", () => {
  const out = buildEvidence(newsDoc({counts: {feeds: 9, feedsOk: 6}}), {now: NOW});
  assert.match(out.block, /fetched from 6 of 9 named trade feeds/);
});

test("publishers are listed once each", () => {
  const out = buildEvidence(newsDoc({items: [
    item({url: "https://a/1", source: "insuranceNEWS.com.au"}),
    item({url: "https://a/2", source: "insuranceNEWS.com.au"}),
    item({url: "https://a/3", source: "Insurance Business AU"}),
  ]}), {now: NOW});
  assert.deepEqual(out.sources, ["insuranceNEWS.com.au", "Insurance Business AU"]);
});

test("an undated item is labelled undated, never given a date", () => {
  const out = buildEvidence(newsDoc({items: [item({publishedAt: null})]}), {now: NOW});
  assert.match(out.block, /published: undated/);
});

// ── verifyGrounding ──

function evidenceFor(urls) {
  return buildEvidence(newsDoc({
    items: urls.map((u, i) => item({url: u, title: "Story " + i})),
  }), {now: NOW});
}

function briefingWith(stories, section) {
  const sections = {global: [{headline: "G", url: "https://elsewhere/x"}]};
  sections[section || "insurance"] = stories;
  return {sections};
}

test("a supplied url is accepted and marked grounded", () => {
  const evidence = evidenceFor(["https://news.example/real"]);
  const out = verifyGrounding(briefingWith([{headline: "H", url: "https://news.example/real"}]), evidence);
  assert.equal(out.stats.grounded, 1);
  assert.equal(out.stats.unmatched, 0);
  assert.equal(out.briefing.sections.insurance[0].grounded, true);
});

test("a url differing only by tracking params, www or a trailing slash still matches, and is canonicalized", () => {
  const evidence = evidenceFor(["https://www.insurancenews.com.au/a/b"]);
  const out = verifyGrounding(
    briefingWith([{headline: "H", url: "http://insurancenews.com.au/a/b/?utm_source=x#top"}]), evidence);
  assert.equal(out.stats.grounded, 1);
  assert.equal(out.briefing.sections.insurance[0].url, "https://www.insurancenews.com.au/a/b",
    "stored url is the fetched one, not the model's rendering of it");
});

test("a url that was never supplied loses the link but keeps the story", () => {
  const evidence = evidenceFor(["https://news.example/real"]);
  const out = verifyGrounding(
    briefingWith([{headline: "Plausible headline", body: "Body.", url: "https://news.example/invented"}]), evidence);
  const story = out.briefing.sections.insurance[0];
  assert.equal(story.url, undefined, "the citation is withdrawn");
  assert.equal(story.headline, "Plausible headline", "the content is not");
  assert.equal(story.body, "Body.");
  assert.equal(story.grounded, false);
  assert.equal(out.stats.unmatched, 1);
});

test("a story with no url is ungrounded but is not counted as an unmatched citation", () => {
  const evidence = evidenceFor(["https://news.example/real"]);
  const out = verifyGrounding(briefingWith([{headline: "H"}]), evidence);
  assert.equal(out.stats.ungrounded, 1);
  assert.equal(out.stats.unmatched, 0);
});

test("a missing publisher is filled in from the matched story", () => {
  const evidence = evidenceFor(["https://news.example/real"]);
  const out = verifyGrounding(briefingWith([{headline: "H", url: "https://news.example/real"}]), evidence);
  assert.equal(out.briefing.sections.insurance[0].source, "insuranceNEWS.com.au");
});

test("only the named sections are checked; the rest of the briefing is untouched", () => {
  const evidence = evidenceFor(["https://news.example/real"]);
  const out = verifyGrounding(briefingWith([{headline: "H", url: "https://news.example/real"}]), evidence);
  assert.equal(out.briefing.sections.global[0].url, "https://elsewhere/x");
  assert.equal(out.briefing.sections.global[0].grounded, undefined);
});

test("interruptions is checked alongside insurance by default", () => {
  const evidence = evidenceFor(["https://news.example/real"]);
  const out = verifyGrounding(
    briefingWith([{headline: "H", url: "https://news.example/nope"}], "interruptions"), evidence);
  assert.equal(out.stats.bySection.interruptions.unmatched, 1);
  assert.equal(out.stats.bySection.insurance.grounded, 0);
});

test("with no evidence every citation is unmatched rather than trusted by default", () => {
  const out = verifyGrounding(briefingWith([{headline: "H", url: "https://anything/at/all"}]), null);
  assert.equal(out.stats.grounded, 0);
  assert.equal(out.stats.unmatched, 1);
  assert.equal(out.briefing.sections.insurance[0].url, undefined);
});

test("a malformed briefing is returned unchanged instead of throwing", () => {
  assert.doesNotThrow(() => verifyGrounding(null, null));
  assert.doesNotThrow(() => verifyGrounding({}, null));
  assert.doesNotThrow(() => verifyGrounding({sections: {insurance: [null, "x", 7]}}, null));
});

test("urlKey normalizes the ways a url is usually restated", () => {
  const canonical = "insurancenews.com.au/a/b";
  assert.equal(urlKey("https://www.insurancenews.com.au/a/b"), canonical);
  assert.equal(urlKey("HTTP://InsuranceNews.com.au/a/b/"), canonical);
  assert.equal(urlKey("https://insurancenews.com.au/a/b?utm=1#frag"), canonical);
  assert.equal(urlKey(""), "");
  assert.equal(urlKey(null), "");
});
