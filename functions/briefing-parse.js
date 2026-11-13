"use strict";

// Reading the model's JSON reply. The 7 Nov 2026 morning build was lost to one
// reply that was valid except for a comma before a closing brace ("Expected
// double-quoted property name"), and that day had no briefing at all. A reply
// that fails the strict read is read once more with such commas removed; only
// if that fails too does the caller ask the model again.

// Commas that sit directly before } or ], outside strings.
function stripTrailingCommas(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] === undefined ? "" : text[i];
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}

function parseBriefing(raw) {
  const text = String(raw || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return a JSON object");
  }
  const body = text.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch (err) {
    try {
      return JSON.parse(stripTrailingCommas(body));
    } catch (again) {
      throw err;
    }
  }
}

module.exports = {parseBriefing, stripTrailingCommas};
