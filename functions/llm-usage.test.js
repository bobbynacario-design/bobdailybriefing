"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {extractUsage, webSearchCount, recordUsage, recordSearches} = require("./llm-usage");

// recordUsage against an in-memory stand-in for the one Firestore doc it writes.
function fakeDb() {
  const store = {data: null};
  return {
    store,
    collection: () => ({doc: () => ({})}),
    runTransaction: async (fn) => {
      await fn({
        get: async () => ({exists: !!store.data, data: () => JSON.parse(JSON.stringify(store.data))}),
        set: (ref, d) => {
          store.data = d;
        },
      });
    },
  };
}

// The shape of a gpt-5.5 response with the web_search tool: two searches, a
// page the model opened and a find inside it, then the answer.
const RESPONSE = {
  usage: {input_tokens: 78000, output_tokens: 7000, input_tokens_details: {cached_tokens: 12000}},
  output: [
    {type: "reasoning", summary: []},
    {type: "web_search_call", status: "completed", action: {type: "search", query: "NGCP yellow alert", sources: []}},
    {type: "web_search_call", status: "completed", action: {type: "open_page", url: "https://example.com/a"}},
    {type: "web_search_call", status: "completed", action: {type: "find_in_page", url: "https://example.com/a", pattern: "MW"}},
    {type: "web_search_call", status: "completed", action: {type: "search", queries: ["QBE Australia storm claims"]}},
    {type: "web_search_call", status: "completed"},
    {type: "message", content: [{type: "output_text", text: "{}"}]},
  ],
};

test("only search actions count as billed web searches", () => {
  assert.equal(webSearchCount(RESPONSE), 3, "two searches plus one item in the older shape with no action");
  assert.equal(webSearchCount({output: [{type: "message"}]}), 0);
  assert.equal(webSearchCount({}), 0);
  assert.equal(webSearchCount(null), 0);
});

test("usage reads the Responses API block, cached tokens as a subset of input", () => {
  assert.deepEqual(extractUsage(RESPONSE), {inputTokens: 78000, outputTokens: 7000, cachedTokens: 12000});
  assert.deepEqual(extractUsage({}), {inputTokens: 0, outputTokens: 0, cachedTokens: 0});
});

test("a feature's searches are their own per-use line, kept out of byDay", async () => {
  const db = fakeDb();
  await recordUsage(db, "briefing", "gpt-5.5", extractUsage(RESPONSE), "2026-10-08");
  await recordSearches(db, "briefing", webSearchCount(RESPONSE), "2026-10-08");
  await recordSearches(db, "briefing", 4, "2026-10-08");
  const d = db.store.data;
  assert.deepEqual(
    (({calls, inputTokens, outputTokens, cachedTokens}) => ({calls, inputTokens, outputTokens, cachedTokens}))(d.entries["briefing|gpt-5.5"]),
    {calls: 1, inputTokens: 78000, outputTokens: 7000, cachedTokens: 12000});
  const searches = d.entries["briefing-search|web-search"];
  assert.equal(searches.feature, "briefing-search");
  assert.equal(searches.model, "web-search");
  assert.equal(searches.calls, 7, "3 + 4 searches");
  assert.equal(searches.inputTokens, 0);
  // Searches are not API calls, so the day's call count is the one briefing call.
  assert.deepEqual(d.byDay["2026-10-08"], {calls: 1, inputTokens: 78000, outputTokens: 7000});
});

test("no searches writes nothing, a null usage is still a no-op, and calls can be folded", async () => {
  const db = fakeDb();
  await recordSearches(db, "story-dossier", 0, "2026-10-08");
  await recordUsage(db, "x", "y", null, "2026-10-08");
  assert.equal(db.store.data, null);
  await recordUsage(db, "miro-panel", "gpt-5.5", {inputTokens: 10, outputTokens: 2}, "2026-10-08", 5);
  assert.equal(db.store.data.entries["miro-panel|gpt-5.5"].calls, 5);
  assert.equal(db.store.data.byDay["2026-10-08"].calls, 5);
});

test("a ledger failure never reaches the feature", async () => {
  const broken = {collection: () => ({doc: () => ({})}), runTransaction: async () => {
    throw new Error("unavailable");
  }};
  await assert.doesNotReject(recordSearches(broken, "briefing", 3, "2026-10-08"));
});

// Every OpenAI call that offers the web_search tool records its searches, so the
// $10-per-1,000 fee reaches the Help-tab cost table.
test("every web-searching feature records its searches", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "index.js"), "utf8");
  ["\"briefing\"", "\"story-dossier\"", "usageFeature || \"meeting-brief\"", "\"ask-daybook\"", "\"deep-research\""].forEach((feature) => {
    assert.ok(source.includes("recordSearches(db, " + feature + ", "), feature + " records its web searches");
  });
  const offered = (source.match(/type: "web_search"/g) || []).length;
  const recorded = (source.match(/recordSearches\(db, /g) || []).length;
  assert.equal(offered, recorded, "one recordSearches per call site that offers web_search");
});
