"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {extractResponseText, researchResult} = require("./research-result");

test("extracts output text from response items", () => {
  assert.equal(extractResponseText({output: [
    {content: [{type: "output_text", text: "hello "}]},
    {content: [{type: "text", text: "world"}]},
  ]}), "hello world");
});

test("maps a completed response to a ready report", () => {
  assert.deepEqual(researchResult({status: "completed", output_text: "# Report"}, 123), {
    terminal: true,
    update: {md: "# Report", status: "ready", completedAt: 123},
  });
});

test("maps terminal provider failures to a safe report error", () => {
  assert.deepEqual(researchResult({status: "failed", error: {message: "provider failed"}}, 456), {
    terminal: true,
    update: {status: "error", error: "provider failed", completedAt: 456},
  });
});

test("leaves queued work pending", () => {
  assert.deepEqual(researchResult({status: "in_progress"}, 789), {terminal: false, update: null});
});
