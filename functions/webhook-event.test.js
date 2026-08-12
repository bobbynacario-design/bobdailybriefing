"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {MISSING_REPORT_GRACE_MS, missingReportAction} = require("./webhook-event");

test("retries briefly when the report document may still be racing the webhook", () => {
  const now = 1_000_000;
  assert.equal(missingReportAction(now - MISSING_REPORT_GRACE_MS + 1, now), "retry");
});

test("ignores untracked responses after the lookup grace period", () => {
  const now = 1_000_000;
  assert.equal(missingReportAction(now - MISSING_REPORT_GRACE_MS, now), "ignore");
  assert.equal(missingReportAction(undefined, now), "ignore");
});
