"use strict";

// The private link an iOS Shortcut uses to send Apple Health readings.
//
// Connect on About you makes one code and shows it once. The server keeps only
// its SHA-256 (as the document id in daybook-health-links, a collection the
// shared rules let no browser read), so a stored hash cannot be used to send.
// Connecting again or Disconnect deletes the old one at once.
//
// The Shortcut sends the code in an Authorization header and the readings in
// the body, never in the address. Pure: index.js does the reads and writes.
const crypto = require("node:crypto");

const LINKS_COLL = "daybook-health-links";
const HEALTH_PREFIX = "health-";
const MAX_BODY = 256 * 1024;
const PREFIX = "dbh_";

function newToken(randomBytes = crypto.randomBytes) {
  return PREFIX + randomBytes(32).toString("base64url");
}
function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}
// "Bearer dbh_…" (or the bare code, if the header was typed without Bearer).
function bearer(header) {
  const value = String(header || "").trim().replace(/^bearer\s+/i, "").trim();
  return /^dbh_[A-Za-z0-9_-]{40,60}$/.test(value) ? value : "";
}
// The body as the Shortcut sent it: JSON ({lines: …}) is already parsed by
// the platform; a text body arrives as a Buffer or string.
function bodyOf(body, rawBody) {
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) return body;
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : typeof body === "string" ? body : rawBody ? rawBody.toString("utf8") : "";
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (_) { /* plain text lines */ }
  return text;
}
function endpointUrl(project) {
  return "https://asia-southeast1-" + (project || "pokerhq-a67e4") + ".cloudfunctions.net/healthIngest";
}
// What the About you card shows about the link; never the code itself.
function linkInfo(token, now, project) {
  return {connectedAt: new Date(now).toISOString(), endpoint: endpointUrl(project), hint: token.slice(-4)};
}

module.exports = {LINKS_COLL, HEALTH_PREFIX, MAX_BODY, newToken, tokenHash, bearer, bodyOf, endpointUrl, linkInfo};
