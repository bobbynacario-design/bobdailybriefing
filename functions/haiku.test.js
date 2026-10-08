"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Haiku = require("./haiku");
const Ask = require("./ask-daybook");
const {MIRROR_SCHEMA} = require("./weekly-mirror");

function fixture(replies) {
  const requests = [], billed = [];
  return {requests, billed, apiKey: "test-key", timeoutMs: 1000,
    onUsage: async (model, usage) => billed.push({model, usage}),
    fetchImpl: async (url, options) => {
      requests.push({url, headers: options.headers, body: JSON.parse(options.body)});
      const reply = replies.shift();
      assert.ok(reply, "unexpected extra request");
      return {ok: !reply.status, status: reply.status || 200, json: async () => reply};
    }};
}
const answer = {answer: "Your note says this [S1]. Invented ref [S99].", not_found: "", follow_ups: [], web_sources: []};
const textReply = () => ({stop_reason: "end_turn", content: [{type: "thinking", signature: "signed", thinking: ""}, {type: "text", text: JSON.stringify(answer)}], usage: {input_tokens: 200, output_tokens: 100}});
const callReply = (...calls) => ({stop_reason: "tool_use", content: [{type: "thinking", signature: "signed", thinking: ""}, ...calls], usage: {input_tokens: 100, output_tokens: 50}});
const call = (id) => ({type: "tool_use", id, name: Ask.SEARCH_TOOL.name, input: {terms: ["QBE"]}});
function askOptions(f) {
  return {...f, input: [{role: "system", content: "Use records."}, {role: "user", content: "QBE?"}],
    tool: Ask.SEARCH_TOOL, maxLookups: 2, deadline: Date.now() + 10000, lookup: () => '{"results":[]}'};
}

test("mirror sends native structured output and extracts text after thinking", async () => {
  const f = fixture([textReply()]);
  const raw = await Haiku.mirror({...f, system: "Read notes.", prompt: "My week", schema: MIRROR_SCHEMA});
  assert.deepEqual(JSON.parse(raw), answer);
  const req = f.requests[0];
  assert.equal(req.url, "https://api.anthropic.com/v1/messages");
  assert.equal(req.headers["x-api-key"], "test-key");
  assert.equal(req.body.model, Haiku.MODEL);
  assert.deepEqual(req.body.output_config.format, {type: "json_schema", schema: MIRROR_SCHEMA});
  assert.equal(req.body.output_config.effort, "low");
  assert.equal(req.body.temperature, undefined);
});

test("saved Ask forces retrieval, replays signed blocks, and retains citation checks", async () => {
  const first = callReply(call("lookup1"));
  const f = fixture([first, textReply()]);
  const registry = Ask.newRegistry();
  const result = await Haiku.ask({...askOptions(f), lookup: () => Ask.lookupOutput([
    {id: "note1", source: "Notes", title: "QBE", body: "Your note says this", saved: Date.now()}
  ], registry)});
  assert.equal(result.lookups, 1);
  assert.deepEqual(f.requests[0].body.tool_choice, {type: "tool", name: "search_daybook"});
  assert.deepEqual(f.requests[1].body.messages[1].content, first.content);
  assert.equal(f.requests[1].body.messages[2].content[0].tool_use_id, "lookup1");
  const clean = Ask.cleanAnswer(JSON.parse(result.raw), registry, [], false);
  assert.match(clean.answer, /\[S1\]/);
  assert.doesNotMatch(clean.answer, /S99/);
  assert.equal(f.billed.length, 2);
  assert.deepEqual(f.requests[0].body.tools.map(t => t.name), ["search_daybook"]);
});

test("parallel calls cannot exceed the lookup budget and final turn disables tools", async () => {
  const f = fixture([callReply(call("a"), call("b"), call("c")), textReply()]);
  let executed = 0;
  const result = await Haiku.ask({...askOptions(f), lookup: () => {executed++; return "{}";}});
  assert.equal(executed, 2);
  assert.equal(result.lookups, 2);
  assert.deepEqual(f.requests[1].body.tool_choice, {type: "none"});
  assert.match(f.requests[1].body.messages[2].content[2].content, /limit reached/);
});

test("refusal and truncation are billed but never returned as usable answers", async () => {
  for (const stop_reason of ["refusal", "max_tokens"]) {
    const f = fixture([{...textReply(), stop_reason}]);
    await assert.rejects(Haiku.message({...f, body: {messages: []}}));
    assert.equal(f.billed.length, 1);
  }
});

test("cache reads and writes count toward the 100k threshold on each request", async () => {
  const f = fixture([{...textReply(), usage: {input_tokens: 10000, cache_read_input_tokens: 90000, cache_creation_input_tokens: 1, output_tokens: 100}}]);
  await Haiku.message({...f, body: {messages: []}});
  assert.equal(f.billed[0].model, Haiku.LONG_MODEL);
  assert.deepEqual(f.billed[0].usage, {inputTokens: 100001, outputTokens: 100, cachedTokens: 90000, cacheWriteTokens: 1});
  const short = fixture([{...textReply(), usage: {input_tokens: 100000}}]);
  await Haiku.message({...short, body: {messages: []}});
  assert.equal(short.billed[0].model, Haiku.MODEL);
});

test("provider errors never echo credentials and deadlines prevent another request", async () => {
  const f = fixture([{status: 401, error: {message: "secret test-key"}}]);
  await assert.rejects(Haiku.message({...f, body: {messages: []}}), error => error.code === "failed-precondition" && !error.message.includes("test-key"));
  assert.equal(f.billed.length, 0);
  const expired = fixture([]);
  await assert.rejects(Haiku.ask({...askOptions(expired), deadline: Date.now() - 1}), /timed out/);
  assert.equal(expired.requests.length, 0);
});

test("an answer without retrieval is rejected, and a later failure retains earlier usage", async () => {
  const skipped = fixture([textReply()]);
  await assert.rejects(Haiku.ask(askOptions(skipped)), /did not look up/);
  assert.equal(skipped.billed.length, 1);
  const failed = fixture([callReply(call("first")), {status: 503}]);
  await assert.rejects(Haiku.ask(askOptions(failed)), error => error.code === "unavailable");
  assert.equal(failed.billed.length, 1);
});
