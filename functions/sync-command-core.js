"use strict";

const fs = require("node:fs");
const path = require("node:path");

const source = path.resolve(__dirname, "..", "lib", "command-center-core.js");
const target = path.resolve(__dirname, "command-center-core.js");
const content = fs.readFileSync(source, "utf8");
fs.writeFileSync(target, content);
console.log("synced shared Command Center core into Functions source");
