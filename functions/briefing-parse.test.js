"use strict";

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {parseBriefing, stripTrailingCommas} = require("./briefing-parse");

test("a clean reply is read as it is, with any prose around it ignored", () => {
  assert.deepEqual(parseBriefing("Here you go:\n{\"date\":\"x\",\"sections\":{}}\nDone."), {date: "x", sections: {}});
});

test("a comma before a closing brace or bracket no longer loses the briefing (7 Nov 2026)", () => {
  const reply = "{\n  \"sections\": {\"insurance\": [{\"headline\": \"A\",},\n  ],\n  },\n}";
  assert.deepEqual(parseBriefing(reply), {sections: {insurance: [{headline: "A"}]}});
});

test("text inside a story is never touched", () => {
  const reply = "{\"headline\":\"Costs up, }, ] and \\\"quotes\\\", ]\",\"n\":[1,2,],}";
  assert.deepEqual(parseBriefing(reply), {headline: "Costs up, }, ] and \"quotes\", ]", n: [1, 2]});
  assert.equal(stripTrailingCommas("{\"a\":\"x, }\"}"), "{\"a\":\"x, }\"}");
});

test("a reply that is broken some other way still fails, with the first error", () => {
  assert.throws(() => parseBriefing("{\"a\": tru}"), SyntaxError);
  assert.throws(() => parseBriefing("no json here"), /did not return a JSON object/);
});
