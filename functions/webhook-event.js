"use strict";

const MISSING_REPORT_GRACE_MS = 2 * 60 * 1000;

function missingReportAction(receivedAt, now = Date.now()) {
  const received = Number(receivedAt);
  if (Number.isFinite(received) && received > 0 && now - received < MISSING_REPORT_GRACE_MS) {
    return "retry";
  }
  return "ignore";
}

module.exports = {MISSING_REPORT_GRACE_MS, missingReportAction};
