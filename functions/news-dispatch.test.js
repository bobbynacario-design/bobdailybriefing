"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {dispatchRequest, dispatchFeed} = require("./news-dispatch");

test("the request asks GitHub to run the workflow's news job on main", () => {
  const {url, init} = dispatchRequest("ghp_test_token", "news");
  assert.equal(url, "https://api.github.com/repos/bobbynacario-design/bobdailybriefing/actions/workflows/refresh-intelligence.yml/dispatches");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer ghp_test_token");
  assert.equal(init.headers.accept, "application/vnd.github+json");
  assert.deepEqual(JSON.parse(init.body), {ref: "main", inputs: {feed: "news"}});
  assert.throws(() => dispatchRequest("", "news"), /GITHUB_DISPATCH_TOKEN is not set/);
  assert.throws(() => dispatchRequest("t", "everything"), /Unknown feed "everything"/);
});

test("a 204 is accepted; anything else throws with the status, never the token", async () => {
  const calls = [];
  const ok = async (url, init) => { calls.push({url, init}); return {status: 204, text: async () => ""}; };
  assert.deepEqual(await dispatchFeed(ok, "secret-token", "news"), {feed: "news", status: 204});
  assert.equal(calls.length, 1);
  const refused = async () => ({status: 403, text: async () => "{\"message\":\"Resource not accessible by personal access token\"}"});
  await assert.rejects(dispatchFeed(refused, "secret-token", "news"), (error) => {
    assert.match(error.message, /GitHub refused the news dispatch \(HTTP 403\): .*Resource not accessible/);
    assert.doesNotMatch(error.message, /secret-token/);
    return true;
  });
});

test("the feeds it may start are the workflow's own choices", () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, "..", ".github", "workflows", "refresh-intelligence.yml"), "utf8");
  assert.match(workflow, /options: \[radar, markets, news, grounding\]/);
});

test("index.js schedules the news dispatch at 05:30 Manila with its own secret", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "index.js"), "utf8");
  const at = source.indexOf("exports.dispatchMorningNews = onSchedule(");
  assert.ok(at >= 0, "dispatchMorningNews is exported");
  const block = source.slice(at, at + 700);
  assert.match(block, /schedule: "30 5 \* \* \*"/);
  assert.match(block, /timeZone: "Asia\/Manila"/);
  assert.match(block, /secrets: \[GITHUB_DISPATCH_TOKEN\]/);
  assert.match(block, /dispatchFeed\(fetch, GITHUB_DISPATCH_TOKEN\.value\(\), "news"\)/);
});
