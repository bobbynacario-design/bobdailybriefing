"use strict";

// Copy the shared browser/server modules from lib/ into this package.
//
// The front end loads lib/*.js with a <script> tag and the deployed functions
// bundle cannot reach outside its own directory, so each shared module needs a
// twin here. Every one is written with a UMD-style tail that assigns both a
// global and module.exports, which is what lets the same file serve both.
//
// Runs on pretest, precheck and predeploy, so a lib/ edit cannot reach
// production as a half-applied change with the server still on the old copy.

const fs = require("node:fs");
const path = require("node:path");

const SHARED = ["command-center-core.js", "briefing-prompt-core.js"];

const libDir = path.resolve(__dirname, "..", "lib");
SHARED.forEach((name) => {
  const source = path.resolve(libDir, name);
  const target = path.resolve(__dirname, name);
  fs.writeFileSync(target, fs.readFileSync(source, "utf8"));
});
console.log("synced shared cores into Functions source: " + SHARED.join(", "));
