"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeDelivery, isQuietTime, selectDeliverable, digestSignature,
  isMaterialChange, notificationCopy,
} = require("./delivery-core");

test("normalizes delivery defaults and clamps source thresholds", () => {
  const value = normalizeDelivery({enabled: true, quietStart: "25:90", sourceThresholds: {Radar: 120, Sports: 65}});
  assert.equal(value.enabled, true);
  assert.equal(value.quietStart, "22:00");
  assert.equal(value.quietEnd, "06:00");
  assert.equal(value.sourceThresholds.Radar, 100);
  assert.equal(value.sourceThresholds.Sports, 65);
  assert.equal(value.sourceThresholds.Briefing, 80);
});

test("quiet hours work across midnight and can be disabled with matching times", () => {
  assert.equal(isQuietTime("23:15", "22:00", "06:00"), true);
  assert.equal(isQuietTime("05:59", "22:00", "06:00"), true);
  assert.equal(isQuietTime("06:00", "22:00", "06:00"), false);
  assert.equal(isQuietTime("12:00", "08:00", "08:00"), false);
});

test("source thresholds filter ordinary items but never suppress reliability", () => {
  const items = [
    {id: "brief", source: "Briefing", score: 79},
    {id: "radar", source: "Radar", score: 91},
    {id: "health", source: "Reliability", score: 86},
  ];
  const selected = selectDeliverable(items, {sourceThresholds: {Briefing: 70, Radar: 95}});
  assert.deepEqual(selected.map((item) => item.id), ["brief", "health"]);
});

test("material change tracks membership, order, urgency, and score bands", () => {
  const initial = [{id: "a", score: 90, urgency: "act"}, {id: "b", score: 80, urgency: "monitor"}];
  const signature = digestSignature(initial);
  assert.equal(isMaterialChange(signature, initial), false);
  assert.equal(isMaterialChange(signature, [{id: "a", score: 96, urgency: "act"}, initial[1]]), true);
  assert.equal(isMaterialChange(signature, [initial[1], initial[0]]), true);
});

test("notification copy leads with the highest ranked source", () => {
  assert.deepEqual(notificationCopy([{source: "Radar", title: "NVDA confirmed"}, {source: "Markets", title: "Rates"}], false), {
    title: "Bob's Morning 5 is ready",
    body: "Radar: NVDA confirmed · +1 more",
  });
});
