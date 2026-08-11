"use strict";

function extractResponseText(responseJson) {
  if (typeof responseJson.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }
  const chunks = [];
  (responseJson.output || []).forEach((item) => {
    (item.content || []).forEach((content) => {
      if ((content.type === "output_text" || content.type === "text") && content.text) {
        chunks.push(content.text);
      }
    });
  });
  return chunks.join("").trim();
}

function researchResult(responseJson, now) {
  const json = responseJson || {};
  const status = json.status;
  const completedAt = now == null ? Date.now() : now;
  if (status === "completed") {
    const md = extractResponseText(json);
    if (md) return {terminal: true, update: {md, status: "ready", completedAt}};
    return {
      terminal: true,
      update: {status: "error", error: "Completed with empty output.", completedAt},
    };
  }
  if (["failed", "cancelled", "incomplete", "expired"].includes(status)) {
    const message = (json.error && json.error.message) || ("Job " + status + ".");
    return {terminal: true, update: {status: "error", error: message, completedAt}};
  }
  return {terminal: false, update: null};
}

module.exports = {extractResponseText, researchResult};
