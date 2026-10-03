"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Ask = require("./ask-daybook");
const Core = require("./intelligence-search-core");

const now = Date.parse("2026-10-01T02:00:00Z");
const docs = {
  briefings: [{id: "Sunday--September-20--2026", saved: Date.parse("2026-09-20T00:00:00Z"), data: JSON.stringify({date: "Sunday, September 20, 2026", sections: {
    insurance: [{headline: "Suncorp lifts hazard allowance", body: "Suncorp raised its natural-hazard budget together with IAG."}],
    markets: [{headline: "Ethereum ETF flows turn positive", body: "ETH rallied on inflows."}]}})},
  {id: "broken", saved: 1, data: "{not json"}],
  decisions: [{id: "d-eth", asset: "ETH", reason: "Staking yield and ETF flows", invalidator: "ETF outflows for a month", status: "open", action: "took", createdDate: "2026-07-21", saved: Date.parse("2026-07-21T00:00:00Z")}],
  prefs: {evidenceSets: {sets: [{id: "set1", name: "Crypto", items: [{key: "k1", source: "Briefing", title: "ETH staking yields compress", detail: "Yields fell.", note: "Revisit in October", capturedAt: "2026-09-21T01:00:00Z"}]}]}},
  dailyBoost: {entries: {"2026-09-24": {spark: 3, note: "Two matters shared the same missing lease schedule.", done: true, stories: [{headline: "Port strike halts exports"}]}, "2026-09-23": {spark: 1, note: ""}}},
  grounding: {facts: [{recordId: "r4", seriesId: "nsw", title: "Ausgrid Field worker R4 labour rate", display: "$152.30 an hour", jurisdiction: "NSW", publishedAt: "2026-09-29T00:00:00Z"}]},
};
const boostCore = {clean: (entries) => entries, sparkTitle: (i) => "Spark " + i};

test("questions and threads are bounded, and old refs are stripped from the thread", () => {
  assert.equal(Ask.cleanQuestion("  hi "), null);
  assert.equal(Ask.cleanQuestion("What about QBE?"), "What about QBE?");
  assert.ok(Ask.cleanQuestion("x".repeat(900)).length <= 400);
  const thread = Ask.cleanThread([{q: "one", a: "a1 [S1]"}, {q: "two", a: "a2"}, {q: "", a: "skip"}, {q: "three", a: "QBE lifted it [S2] [W1]."}, {q: "four", a: "a4"}]);
  assert.deepEqual(thread.map((t) => t.q), ["two", "three", "four"], "the last three exchanges");
  assert.equal(thread[1].a, "QBE lifted it.");
});

test("a lookup plan is parsed and bounded: terms, known sources, real dates", () => {
  const plan = Ask.cleanPlan(JSON.stringify({terms: ["ETH", "Ethereum", "", "x".repeat(90), "a", "b", "c", "d", "e", "f"], sources: ["Decisions", "Twitter"], since: "2026-08-01", until: "soon"}));
  assert.equal(plan.terms.length, 8); assert.equal(plan.terms[0], "ETH"); assert.ok(plan.terms[2].length <= 60);
  assert.deepEqual(plan.sources, ["Decisions"]);
  assert.equal(plan.since, "2026-08-01"); assert.equal(plan.until, "");
  assert.equal(plan.limit, Ask.LOOKUP_LIMIT);
  assert.deepEqual(Ask.cleanPlan("{bad json").terms, []);
});

test("the server's index matches the app's: briefings, decisions, evidence, notes and numbers", () => {
  const index = Core.buildIndex(Ask.askIndexInput(docs, boostCore));
  const sources = [...new Set(index.map((item) => item.source))].sort();
  assert.deepEqual(sources, ["Activity", "Briefing", "Decisions", "Evidence", "Numbers", "Profile", "Reflections"], "About you rides along as Profile and Activity");
  assert.equal(index.filter((item) => item.source === "Reflections").length, 1, "a day with no note or story is left out");
  assert.equal(index.find((item) => item.source === "Reflections").title, "2026-09-24 · Spark 3");
  const eth = Core.searchPlan(index, Ask.cleanPlan({terms: ["ETH", "Ethereum"], sources: ["Decisions"]}), {now});
  assert.deepEqual(eth.map((item) => item.id), ["decision:d-eth"]);
  assert.deepEqual(Ask.askIndexInput({}, null).briefings, []);
});

test("lookup results carry a stable ref and say whose words each record is", () => {
  const index = Core.buildIndex(Ask.askIndexInput(docs, boostCore));
  const registry = Ask.newRegistry();
  const first = JSON.parse(Ask.lookupOutput(Core.searchPlan(index, {terms: ["ETH"]}, {now}), registry));
  const refs = first.results.map((r) => r.ref);
  assert.deepEqual(refs, refs.map((_, i) => "S" + (i + 1)));
  const decision = first.results.find((r) => r.title === "ETH");
  assert.equal(decision.kind, "His decision journal"); assert.equal(decision.date, "2026-07-21");
  assert.match(decision.text, /Staking yield and ETF flows/); assert.match(decision.text, /ETF outflows for a month/, "the invalidator comes with it");
  const evidence = first.results.find((r) => r.title === "ETH staking yields compress");
  assert.match(evidence.kind, /saved to Evidence/); assert.match(evidence.text, /Note: Revisit in October/);
  const again = JSON.parse(Ask.lookupOutput(Core.searchPlan(index, {terms: ["staking"]}, {now}), registry));
  assert.equal(again.results.find((r) => r.title === "ETH").ref, decision.ref, "the same record keeps its ref");
  assert.deepEqual(JSON.parse(Ask.lookupOutput([], registry)), {results: [], note: "Nothing in his Daybook matched these terms."});
});

test("an answer keeps only refs a lookup returned and links the search returned", () => {
  const index = Core.buildIndex(Ask.askIndexInput(docs, boostCore));
  const registry = Ask.newRegistry();
  Ask.lookupOutput(Core.searchPlan(index, {terms: ["ETH"], sources: ["Decisions"]}, {now}), registry);
  const raw = {answer: "You took ETH on 21 Jul for staking yield [S1]. It rose 4% this week [S9] [W1] [W2].", not_found: "No price since July.",
    follow_ups: ["What would change the call?", "b", "c"],
    web_sources: [{title: "Made up", url: "https://invented.example/x"}, {title: "CoinDesk", url: "https://www.coindesk.com/eth"}]};
  const kept = Ask.cleanAnswer(raw, registry, ["https://coindesk.com/eth"], true);
  assert.equal(kept.answer, "You took ETH on 21 Jul for staking yield [S1]. It rose 4% this week [W2].");
  assert.deepEqual(kept.sources.map((s) => [s.ref, s.source, s.id, s.page]), [["S1", "Decisions", "decision:d-eth", "decisions"]]);
  assert.deepEqual(kept.web_sources, [{ref: "W2", title: "CoinDesk", url: "https://www.coindesk.com/eth"}]);
  assert.equal(kept.follow_ups.length, 2); assert.equal(kept.not_found, "No price since July."); assert.equal(kept.looked_up, 1);
  const offline = Ask.cleanAnswer(raw, registry, ["https://coindesk.com/eth"], false);
  assert.deepEqual(offline.web_sources, [], "no web links when the web was off"); assert.doesNotMatch(offline.answer, /\[W/);
  assert.equal(Ask.cleanAnswer({answer: ""}, registry, [], false), null);
  // 1 Oct: a Suncorp question found nothing in his Daybook and the answer did not say so.
  const empty = Ask.newRegistry();
  assert.equal(Ask.cleanAnswer({answer: "From the web [W1].", web_sources: []}, empty, [], true).not_found, "Nothing in your Daybook matched; this answer is from the web.");
  assert.equal(Ask.cleanAnswer({answer: "Nothing found."}, empty, [], false).not_found, "Nothing in your Daybook matched this.");
  assert.equal(Ask.cleanAnswer({answer: "x", not_found: "No Suncorp items since Monday."}, empty, [], true).not_found, "No Suncorp items since Monday.", "the model's own line wins");
  assert.equal(Ask.cleanAnswer({answer: "x [S1]"}, registry, [], false).not_found, "", "when a lookup found records, nothing is added");
  assert.equal(Ask.cleanAnswer(null, registry, [], false), null);
});

test("the prompt carries his accounts, the rules for whose words, and the web rule", () => {
  const prompt = Ask.buildAskPrompt({question: "What about Suncorp?", today: "Thursday 1 October 2026 (2026-10-01)", accounts: [{name: "Suncorp", aliases: ["AAMI", "GIO"]}], web: false});
  assert.match(prompt, /- Suncorp \| AAMI, GIO/); assert.match(prompt, /QUESTION: What about Suncorp\?$/);
  assert.ok(prompt.startsWith("Bob is a forensic business-interruption and claims-quantum specialist"), "his profile (About you) opens it");
  assert.ok(Ask.buildAskPrompt({question: "q?", today: "t", accounts: [], web: false, profile: {work: "I assess BI claims.", files: "Allianz BI.", matters: "", other: ""}})
    .startsWith("About Bob: I assess BI claims.\nHis files: Allianz BI.\nToday is t (Manila)."), "his edited profile replaces it");
  assert.match(prompt, /Do not use the web/); assert.match(prompt, /never fill the gap from memory/); assert.match(prompt, /Never give investment advice/);
  assert.match(Ask.buildAskPrompt({question: "q?", today: "t", accounts: [], web: true}), /You may also search the web/);
  const input = Ask.buildAskInput({question: "and IAG?", thread: [{q: "What about Suncorp?", a: "It lifted its allowance [S1]."}], today: "t", accounts: [], web: false});
  assert.deepEqual(input.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.equal(input[2].content, "It lifted its allowance.");
  assert.match(input[3].content, /QUESTION: and IAG\?$/);
});

test("the lookup loop answers each lookup, stops at three, and then makes the model answer", async () => {
  const sent = [], looked = [];
  const call = (n) => ({id: "r" + n, output: [{type: "function_call", name: "search_daybook", call_id: "c" + n, arguments: JSON.stringify({terms: ["t" + n]})}]});
  const replies = [call(1), call(2), {id: "r3", output: [
    {type: "function_call", name: "search_daybook", call_id: "c3", arguments: "{\"terms\":[\"t3\"]}"},
    {type: "function_call", name: "search_daybook", call_id: "c4", arguments: "{\"terms\":[\"t4\"]}"},
    {type: "function_call", name: "other_tool", call_id: "c5", arguments: "{}"}]},
  {id: "r4", output: [{type: "message", content: [{type: "output_text", text: "{\"answer\":\"done\"}"}]}]}];
  const {json, lookups} = await Ask.runLookups({
    firstBody: {input: "first", tool_choice: "auto"},
    call: async (body) => { sent.push(body); return replies[sent.length - 1]; },
    lookup: (plan) => { looked.push(plan.terms[0]); return "{\"results\":[]}"; },
  });
  assert.equal(lookups, 3); assert.deepEqual(looked, ["t1", "t2", "t3"], "the fourth lookup is refused");
  assert.equal(json.id, "r4");
  assert.deepEqual(sent.map((b) => b.tool_choice), ["auto", "auto", "auto", "none"], "after the third lookup, tools are off");
  assert.equal(sent[1].previous_response_id, "r1");
  const last = sent[3].input;
  assert.deepEqual(last.map((o) => o.call_id), ["c3", "c4", "c5"]);
  assert.match(last[1].output, /Lookup limit reached/); assert.match(last[2].output, /Unknown tool/);
  const direct = await Ask.runLookups({firstBody: {}, call: async () => ({id: "x", output: []}), lookup: () => { throw new Error("no lookup"); }});
  assert.equal(direct.lookups, 0, "an answer with no lookups ends the loop at once");
});

test("a refused key is reported plainly, and no key fragment ever reaches the app", () => {
  const refused = Ask.providerError(401, "Incorrect API key provided: sk-ant-a*****************Ab12. You can find your API key at https://platform.openai.com/account/api-keys.");
  assert.equal(refused.code, "failed-precondition");
  assert.match(refused.message, /refused the server's API key/); assert.doesNotMatch(refused.message, /sk-/);
  assert.equal(Ask.providerError(429, "Rate limit").code, "aborted", "not resource-exhausted, which the app reads as the daily limit");
  const other = Ask.providerError(500, "Upstream error for key sk-proj-abc123 at gateway");
  assert.equal(other.code, "internal"); assert.equal(other.message, "Upstream error for key [key] at gateway");
});
test("the stored map keeps the latest twenty answers", () => {
  let items = {};
  for (let i = 0; i < 25; i++) items = Ask.keepAnswers(items, "a" + i, {generatedAt: new Date(now + i * 1000).toISOString()});
  assert.equal(Object.keys(items).length, 20); assert.ok(!items.a0 && items.a24);
});

// About you, as records Ask can look up and cite (1 Oct: "describe me in one
// word" cited a court story, because his profile was not a source).
test("About you records: his profile boxes in his words, and only what he recorded or tapped", () => {
  const todayKey = "2026-10-01";
  const records = Ask.aboutRecords({
    profile: {profile: {work: "A forensic BI specialist.", files: "QBE pole strikes", matters: "", lookFor: "", other: "Keen on AI tools"}, updatedAt: "2026-10-01T03:20:14Z"},
    dailyBoost: {entries: {"2026-09-29": {feedback: [{headline: "Trucking operator back", section: "interruptions", vote: 1}, {headline: "Crypto flows", section: "markets", vote: -1}]}}},
    decisions: [{asset: "ETH", action: "took", status: "open", createdDate: "2026-07-21", conviction: 4, reason: ""}, {asset: "RTX", status: "closed"}],
    accounts: {accounts: [{name: "QBE"}, {name: "Allianz"}]},
    prefs: {sourceWeights: {Sports: 0.5, Radar: 1}, quietSources: []},
    usage: {days: {"2026-09-30": {page_today: 30, page_evidence: 11, "open_grounding-panel": 5, card_more: 2}, "2026-09-01": {page_help: 99}}},
    goals: {goals: []},
  }, todayKey);
  const byId = Object.fromEntries(records.map((r) => [r.id, r]));
  assert.deepEqual(records.filter((r) => r.source === "Profile").map((r) => r.id), ["profile:work", "profile:files", "profile:other"], "an emptied box is left out");
  assert.equal(byId["profile:other"].detail, "Keen on AI tools"); assert.equal(byId["profile:other"].meta, "About you, saved 2026-10-01"); assert.equal(byId["profile:other"].page, "about");
  assert.equal(byId["activity:votes"].detail, "1 more like this (interruptions 1); 1 less like this (markets 1)");
  assert.equal(byId["activity:calls"].detail, "ETH (took, 2026-07-21, conviction 4/5, no reason recorded)", "a closed call is not open");
  assert.equal(byId["activity:accounts"].detail, "2 accounts: QBE, Allianz");
  assert.equal(byId["activity:priorities"].detail, "Sports: Low; every other source Normal");
  assert.equal(byId["activity:usage"].detail, "Today 30 · Evidence 11 · Your numbers 5", "the last 14 days, pages and Your numbers only");
  assert.ok(!byId["activity:goals"], "no goals, no record");
  const bare = Ask.aboutRecords({}, todayKey);
  assert.deepEqual(bare.map((r) => r.source), ["Profile", "Profile", "Profile", "Profile"], "with nothing saved: the starting profile only, no activity invented");
  assert.equal(bare[0].meta, "About you, the starting profile");
});
test("a question about him reads all of About you; other lookups still need words", () => {
  const index = Core.buildIndex(Object.assign(Ask.askIndexInput(docs, boostCore), {records: Ask.aboutRecords({decisions: docs.decisions, profile: {profile: {other: "Keen on AI tools"}}}, "2026-10-01")}));
  const about = Ask.lookupRecords(index, Ask.cleanPlan({terms: [], sources: ["Profile", "Activity"]}), Core, now);
  assert.ok(about.length >= 5 && about.every((r) => r.source === "Profile" || r.source === "Activity"));
  assert.deepEqual(Ask.lookupRecords(index, Ask.cleanPlan({terms: [], sources: ["Briefing"]}), Core, now), [], "no words, no briefing lookup");
  assert.deepEqual(Ask.lookupRecords(index, Ask.cleanPlan({terms: []}), Core, now), []);
  assert.equal(Ask.lookupRecords(index, Ask.cleanPlan({terms: ["AI tools"], sources: ["Profile"]}), Core, now)[0].id, "profile:other", "words work too");
  const registry = Ask.newRegistry();
  const out = JSON.parse(Ask.lookupOutput(about, registry));
  assert.ok(out.results.some((r) => r.kind === "His own profile (his words, from About you)"));
  assert.ok(out.results.some((r) => r.kind === "What he recorded or tapped in the app (counts and lists, not his words)"));
  const prompt = Ask.buildAskPrompt({question: "describe me in one word", today: "t", accounts: [], web: false});
  assert.match(prompt, /A question about Bob himself .* look up sources Profile and Activity first, with terms empty to read them all/);
  assert.match(prompt, /Never cite a briefing story, news item or report as evidence of who he is\./);
  assert.ok(Ask.SEARCH_TOOL.parameters.properties.sources.items.enum.includes("Profile"));
});

test("a Radar lookup returns the whole card, highest score first, and the prompt says how to ask it", () => {
  const long = "x ".repeat(400).trim();
  const signal = (symbol, score, o) => Object.assign({symbol, score, status: "forming", theme: "AI semis", why: symbol + " holds its averages. " + long,
    entry: 100, stop: 95, target: 110, rr: 2, invalidation: "The idea is off if " + symbol + " closes back below 95."}, o);
  const index = Core.buildIndex(Ask.askIndexInput({radar: {generatedAt: "2026-10-01T00:00:00Z", picks: {taker: ["SOXX"], wildcard: []},
    signals: [signal("AMD", 40), signal("SOXX", 88, {read: {why: "Chips rallied.", wouldBreak: "A close below 95."}})]},
  briefings: [{id: "b", saved: now, data: {date: "1 Oct 2026", sections: {ai: [{headline: "Chip story", body: long}]}}}]}, boostCore));
  const out = JSON.parse(Ask.lookupOutput(Core.searchPlan(index, {terms: ["radar"], sources: ["Radar"]}, {now}), Ask.newRegistry())).results;
  assert.deepEqual(out.map((r) => r.title), ["SOXX", "AMD"], "by score");
  assert.equal(out[0].meta, "Taker pick · forming · score 88");
  assert.ok(out[0].text.length > 450 && out[0].text.length <= 1200, "a Radar record gets the longer clip");
  assert.match(out[0].text, /What would break it: A close below 95./);
  const story = JSON.parse(Ask.lookupOutput(Core.searchPlan(index, {terms: ["chip story"]}, {now}), Ask.newRegistry())).results[0];
  assert.ok(story.text.length <= 450, "other records keep the short clip");
  const prompt = Ask.buildAskPrompt({question: "What are today's Taker picks?", today: "t", accounts: [], web: false});
  assert.match(prompt, /A question about the Radar .* look up sources Radar; the term "radar" reads today's names, highest score first/);
  assert.match(prompt, /A name is early only when its meta says early./); assert.match(prompt, /The Radar holds today's scan only/); assert.match(prompt, /never a recommendation/);
});
