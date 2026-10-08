"use strict";

// Native Messages API for the two saved-material features. No web tools here.
const MODEL = "claude-haiku-5-5";
const LONG_MODEL = MODEL + "/over-100k";

function usageOf(json) {
  const u = json.usage || {};
  const cachedTokens = u.cache_read_input_tokens || 0;
  const cacheWriteTokens = u.cache_creation_input_tokens || 0;
  return {inputTokens: (u.input_tokens || 0) + cachedTokens + cacheWriteTokens,
    outputTokens: u.output_tokens || 0, cachedTokens, cacheWriteTokens};
}

function providerError(status) {
  if (status === 401 || status === 403) return {code: "failed-precondition", message: "Claude refused the server's API key. Check the ANTHROPIC_API_KEY secret and redeploy the function."};
  if (status === 429) return {code: "aborted", message: "Claude is rate-limiting or out of credit. Try again in a few minutes."};
  return {code: status >= 500 ? "unavailable" : "internal", message: "Claude request failed. Try again in a minute."};
}

function failure(code, message) { return Object.assign(new Error(message), {code}); }

async function message({apiKey, body, timeoutMs, onUsage, fetchImpl = fetch}) {
  let response;
  let json;
  try {
    response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {"x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
      body: JSON.stringify(Object.assign({model: MODEL, max_tokens: 8192, output_config: {effort: "low"}}, body)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    json = await response.json();
  } catch (error) {
    throw failure("unavailable", "Claude request failed before receiving a usable response.");
  }
  if (!response.ok) {
    const told = providerError(response.status);
    throw failure(told.code, told.message);
  }
  const usage = usageOf(json);
  await onUsage(usage.inputTokens > 100000 ? LONG_MODEL : MODEL, usage);
  if (json.stop_reason === "refusal") throw failure("failed-precondition", "Claude declined this request. Try rephrasing it.");
  if (json.stop_reason === "max_tokens") throw failure("internal", "Claude's answer was cut short. Try again with a narrower request.");
  return json;
}

function textOf(json) {
  return (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

async function mirror({system, prompt, schema, ...options}) {
  const json = await message({...options, body: {system, messages: [{role: "user", content: prompt}],
    output_config: {effort: "low", format: {type: "json_schema", schema}}}});
  return textOf(json);
}

async function ask({input, tool, maxLookups, lookup, deadline, ...options}) {
  const system = input.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const messages = input.filter((m) => m.role !== "system").map((m) => ({role: m.role, content: m.content}));
  const tools = [{name: tool.name, description: tool.description, input_schema: tool.parameters}];
  let lookups = 0;
  for (let round = 0; round <= maxLookups; round++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw failure("unavailable", "The saved-record lookup timed out. Try a narrower question.");
    const json = await message({...options, timeoutMs: Math.min(120000, remaining), body: {system, messages, tools,
      tool_choice: round === 0 ? {type: "tool", name: tool.name} : lookups >= maxLookups || round === maxLookups ? {type: "none"} : {type: "auto"}}});
    const calls = (json.content || []).filter((b) => b.type === "tool_use");
    if (!calls.length) {
      if (!lookups) throw failure("internal", "Claude did not look up the saved records. Try again.");
      return {raw: textOf(json), lookups};
    }
    // Replay all blocks, including signed thinking, unmodified in this account.
    messages.push({role: "assistant", content: json.content});
    const results = calls.map((call) => {
      let content;
      if (call.name !== tool.name) content = JSON.stringify({error: "Unknown tool."});
      else if (lookups >= maxLookups) content = JSON.stringify({error: "Lookup limit reached. Answer now from what you have."});
      else { lookups++; content = lookup(call.input); }
      return {type: "tool_result", tool_use_id: call.id, content};
    });
    messages.push({role: "user", content: results});
  }
  throw failure("internal", "Claude did not finish the saved-record answer. Try again.");
}

module.exports = {MODEL, LONG_MODEL, usageOf, providerError, message, textOf, mirror, ask};
