"use strict";

// Deploys run as `firebase deploy --only functions:…` from the repo root, which
// never triggers npm's own "predeploy" script. The firebase.json hook is what
// keeps the shared cores in this folder from reaching production stale.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("every functions deploy syncs the shared cores first", () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "firebase.json"), "utf8"));
  const fns = [].concat(config.functions || []).find((entry) => entry.codebase === "bobdailybriefing");
  assert.ok(fns, "the bobdailybriefing codebase is configured");
  assert.deepEqual(fns.predeploy, ["npm --prefix functions run sync:shared-core"]);
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
  assert.equal(pkg.scripts["sync:shared-core"], "node sync-shared-core.js");
});
