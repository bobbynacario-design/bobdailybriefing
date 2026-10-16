"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const L = require("./health-link");

test("a link code is long, random and kept only as its hash", () => {
  const a = L.newToken(), b = L.newToken();
  assert.match(a, /^dbh_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(L.newToken(() => Buffer.alloc(32)), "dbh_" + "A".repeat(43));
  assert.match(L.tokenHash(a), /^[0-9a-f]{64}$/);
  assert.notEqual(L.tokenHash(a), L.tokenHash(b));
});

test("the Authorization header: with or without Bearer, nothing else", () => {
  const t = L.newToken();
  assert.equal(L.bearer("Bearer " + t), t);
  assert.equal(L.bearer("bearer  " + t + " "), t);
  assert.equal(L.bearer(t), t);
  assert.equal(L.bearer(""), "");
  assert.equal(L.bearer("Bearer abc"), "");
  assert.equal(L.bearer("Basic " + t), "");
});

test("the body: parsed JSON, JSON sent as text, or plain lines", () => {
  assert.deepEqual(L.bodyOf({lines: "x"}), {lines: "x"});
  assert.deepEqual(L.bodyOf(Buffer.from('{"lines":"a"}')), {lines: "a"});
  assert.equal(L.bodyOf("steps|a|b|1|count"), "steps|a|b|1|count");
  assert.equal(L.bodyOf(undefined, Buffer.from("steps|a|b|1|count")), "steps|a|b|1|count");
  assert.equal(L.bodyOf(undefined, undefined), "");
});

test("what the card is told about the link never includes the code", () => {
  const t = L.newToken(), info = L.linkInfo(t, Date.parse("2026-10-16T00:00:00Z"), "pokerhq-a67e4");
  assert.deepEqual(info, {connectedAt: "2026-10-16T00:00:00.000Z", endpoint: "https://asia-southeast1-pokerhq-a67e4.cloudfunctions.net/healthIngest", hint: t.slice(-4)});
  assert.ok(!JSON.stringify(info).includes(t.slice(4, 20)));
});

test("index.js wires the three health functions to the owner and keeps values out of logs", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "index.js"), "utf8");
  ["createHealthLink", "revokeHealthLink", "healthIngest"].forEach((name) => assert.match(src, new RegExp("exports\\." + name + " = on")));
  const block = src.slice(src.indexOf("exports.createHealthLink"), src.indexOf("// ── end health"));
  assert.match(block, /role !== "owner"/);
  const logs = block.match(/logger\.\w+\([^;]*\);/g) || [];
  assert.ok(logs.length >= 1);
  logs.forEach((line) => assert.doesNotMatch(line, /steps|sleep|weight|message|latest|out\.doc|body|token\b/i, line));
});
