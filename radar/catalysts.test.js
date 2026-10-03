// Offline tests for radar/catalysts.js. No network, no API key: the Claude
// client is a fake that replays scripted responses.
//   node radar/catalysts.test.js
import assert from 'assert';
import {
  tagCatalysts, focusNames, collectSources, runCatalystCall, applyCatalysts,
  usageForLedger, SAVE_TOOL
} from './catalysts.js';

var n = 0;
async function t(name, fn) { await fn(); n++; console.log('  PASS  ' + name); }

function sig(o) {
  return Object.assign({
    symbol: 'AAA', theme: 'AI semis', status: 'forming', score: 50, benchmark: 'QQQ',
    relStrength20d: 0, entry: 100, target: 110, stop: 95, why: 'Forming.', early: false
  }, o);
}
// A fake client whose stream() hands back the scripted messages in order and
// records every request it was sent. HANG never answers until aborted.
var HANG = {};
function fakeClient(script) {
  var sent = [];
  return {
    sent: sent,
    beta: { messages: { stream: function (params, options) {
      sent.push(JSON.parse(JSON.stringify(params)));
      var next = script.shift();
      return { finalMessage: async function () {
        if (next === HANG) {
          return new Promise(function (resolve, reject) {
            options.signal.addEventListener('abort', function () { reject(new Error('Request was aborted.')); });
          });
        }
        if (next instanceof Error) throw next;
        return next;
      } };
    } } }
  };
}
function searchResult(urls) {
  return { type: 'web_search_tool_result', tool_use_id: 'srv_1',
    content: urls.map(function (u) { return { type: 'web_search_result', url: u, title: 'T ' + u, page_age: 'Oct 1, 2026' }; }) };
}
function saveBlock(input) { return { type: 'tool_use', id: 'tu_1', name: 'save_catalysts', input: input }; }
function msg(content, stop, usage) {
  return { model: 'claude-opus-5-5', stop_reason: stop, content: content,
    usage: Object.assign({ input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 0 } }, usage || {}) };
}

await t('focusNames: 3 Taker names, then early Wildcards outside them', function () {
  var list = [
    sig({ symbol: 'T1', status: 'confirmed', score: 80 }),
    sig({ symbol: 'T2', status: 'confirmed', score: 75 }),
    sig({ symbol: 'T3', status: 'forming', score: 70, relStrength20d: 10 }),
    sig({ symbol: 'T4', status: 'forming', score: 60, early: true }),   // 4th by Taker rank: free for Wildcard
    sig({ symbol: 'W1', status: 'forming', score: 50, early: true, target: 130 }),
    sig({ symbol: 'W2', status: 'forming', score: 45, early: true }),
    sig({ symbol: 'NO1', status: 'forming', score: 55, early: false }),  // not early
    sig({ symbol: 'NO2', status: 'forming', score: 40, early: true }),   // score below 42
    sig({ symbol: 'NO3', status: 'invalidated', score: 90 })
  ];
  var f = focusNames(list).map(function (s) { return s.symbol; });
  assert.deepEqual(f.slice(0, 3), ['T1', 'T2', 'T3']);
  // Standout (highest upside) first, then the rest by score.
  assert.deepEqual(f.slice(3), ['W1', 'T4', 'W2']);
});

await t('focusNames: an early name below the upside bar is not a Wildcard', function () {
  var list = [
    sig({ symbol: 'A', score: 50, early: true, target: 101 }),   // +1% < 2.5% floor
    sig({ symbol: 'B', score: 50, early: true, target: 120 })
  ];
  assert.deepEqual(focusNames(list).map(function (s) { return s.symbol; }), ['B']);
});

await t('collectSources: search results and citations count, the model\'s own save input does not', function () {
  var seen = collectSources([
    searchResult(['https://a.com/1', 'https://b.com/2']),
    { type: 'text', text: 'x', citations: [{ url: 'https://c.com/3', title: 'C' }] },
    { type: 'server_tool_use', id: 's', name: 'web_search', input: { query: 'https://fake.com/q' } },
    saveBlock({ catalysts: [{ symbol: 'A', sourceUrl: 'https://invented.com/x' }] })
  ], {});
  assert.ok(seen['https://a.com/1'] && seen['https://b.com/2'] && seen['https://c.com/3']);
  assert.equal(seen['https://a.com/1'].age, 'Oct 1, 2026');
  assert.ok(!seen['https://invented.com/x'], 'a URL only the model wrote must not count as seen');
  assert.ok(!seen['https://fake.com/q'], 'the model\'s own query is not a source');
});

await t('applyCatalysts: keeps sourced catalysts, drops unsourced ones, resets every signal', function () {
  var list = [sig({ symbol: 'A' }), sig({ symbol: 'B' }), sig({ symbol: 'C', catalyst: 'stale', read: { why: 'old' } })];
  var seen = { 'https://a.com/1': { title: 'Alpha news', age: '' } };
  var stats = applyCatalysts(list, {
    catalysts: [
      { symbol: 'a', catalyst: 'A beat earnings.', eventType: 'earnings', date: '2026-10-01', sourceUrl: 'https://a.com/1' },
      { symbol: 'B', catalyst: 'B did a deal.', eventType: 'partnership', date: 'recent', sourceUrl: 'https://made-up.com/b' }
    ],
    reads: [
      { symbol: 'A', why: 'Earnings beat.', wouldBreak: 'A close under 95.', sourceUrls: ['https://a.com/1', 'https://made-up.com/z'] },
      { symbol: 'B', why: 'Deal.', wouldBreak: 'x', sourceUrls: ['https://made-up.com/b'] }
    ]
  }, seen, [list[0], list[1]]);
  assert.deepEqual(stats, { tagged: 1, unsourced: 1, reads: 1, readsUnsourced: 1 });
  assert.equal(list[0].catalyst, 'A beat earnings.');
  assert.equal(list[0].catalystUrl, 'https://a.com/1');
  assert.equal(list[0].catalystSource, 'Alpha news');
  assert.equal(list[0].catalystAsOf, '2026-10-01');
  assert.deepEqual(list[0].read.sources, [{ url: 'https://a.com/1', title: 'Alpha news' }]);
  assert.equal(list[1].catalyst, '');          // unsourced: dropped
  assert.equal(list[1].read, undefined);       // read with no seen URL: dropped
  assert.equal(list[2].catalyst, '');          // untagged: reset, not left stale
  assert.equal(list[2].eventType, 'none');
  assert.equal(list[2].read, undefined);
});

await t('applyCatalysts: a read for a name outside the focus list is ignored', function () {
  var list = [sig({ symbol: 'A' })];
  var stats = applyCatalysts(list, { catalysts: [], reads: [{ symbol: 'A', why: 'x', wouldBreak: 'y', sourceUrls: ['https://a.com/1'] }] },
    { 'https://a.com/1': { title: '', age: '' } }, []);
  assert.equal(stats.reads, 0);
  assert.equal(list[0].read, undefined);
});

await t('runCatalystCall: resumes pause_turn, then saves; usage sums across turns', async function () {
  var client = fakeClient([
    msg([searchResult(['https://a.com/1'])], 'pause_turn', { server_tool_use: { web_search_requests: 10 }, cache_creation_input_tokens: 500 }),
    msg([searchResult(['https://b.com/2']), saveBlock({ catalysts: [], reads: [] })], 'tool_use',
      { server_tool_use: { web_search_requests: 5 }, cache_read_input_tokens: 800 })
  ]);
  var out = await runCatalystCall(client, { model: 'claude-opus-5-5', effort: 'medium', prompt: 'p' });
  assert.ok(out.saved);
  assert.deepEqual(out.stops, ['pause_turn', 'tool_use']);
  assert.equal(out.usage.calls, 2);
  assert.equal(out.usage.searches, 15);
  assert.equal(out.usage.cacheWrite, 500);
  assert.equal(out.usage.cacheRead, 800);
  assert.ok(out.seen['https://a.com/1'] && out.seen['https://b.com/2']);
  // The paused turn goes back unchanged as the assistant message.
  assert.equal(client.sent[1].messages.length, 2);
  assert.equal(client.sent[1].messages[1].role, 'assistant');
  // Request shape: no forced tool choice (a 400 on this model), strict save tool, fallbacks on.
  var req = client.sent[0];
  assert.equal(req.tool_choice, undefined);
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.output_config.effort, 'medium');
  assert.equal(req.thinking, undefined);
  assert.equal(req.tools[0].type, 'web_search_20260209');
  assert.equal(req.tools[1].strict, true);
});

await t('runCatalystCall: nudges once when it ends without saving', async function () {
  var client = fakeClient([
    msg([{ type: 'text', text: 'Done.' }], 'end_turn'),
    msg([saveBlock({ catalysts: [], reads: [] })], 'tool_use')
  ]);
  var out = await runCatalystCall(client, { model: 'm', effort: 'medium', prompt: 'p' });
  assert.ok(out.saved);
  var last = client.sent[1].messages[client.sent[1].messages.length - 1];
  assert.equal(last.role, 'user');
  assert.ok(/save_catalysts/.test(last.content));
});

await t('runCatalystCall: never trusts a save cut off at max_tokens, stops on refusal', async function () {
  var cut = await runCatalystCall(fakeClient([msg([saveBlock({ catalysts: [], reads: [] })], 'max_tokens')]),
    { model: 'm', effort: 'medium', prompt: 'p' });
  assert.equal(cut.saved, null);
  var refused = fakeClient([msg([], 'refusal'), msg([saveBlock({})], 'tool_use')]);
  var r = await runCatalystCall(refused, { model: 'm', effort: 'medium', prompt: 'p' });
  assert.equal(r.saved, null);
  assert.equal(refused.sent.length, 1);
});

await t('tagCatalysts: never throws; a failed call leaves clean empty fields and the reason', async function () {
  var list = [sig({ symbol: 'A', catalyst: 'yesterday', catalystUrl: 'https://old.com' })];
  var r = await tagCatalysts({ signals: list, client: fakeClient([new Error('overloaded')]), today: '2026-10-03' });
  assert.ok(/overloaded/.test(r.error));
  assert.equal(list[0].catalyst, '');
  assert.equal(list[0].catalystUrl, '');
  var nokey = await tagCatalysts({ signals: list, today: '2026-10-03' });
  assert.ok(/ANTHROPIC_API_KEY/.test(nokey.error));
});

await t('tagCatalysts: a hung call gives up at the deadline and still records the billed turns', async function () {
  var list = [sig({ symbol: 'A' })];
  var client = fakeClient([
    msg([searchResult(['https://a.com/1'])], 'pause_turn', { server_tool_use: { web_search_requests: 7 } }),
    HANG
  ]);
  var r = await tagCatalysts({ signals: list, client: client, today: '2026-10-03', deadlineMs: 50 });
  assert.equal(r.error, 'no answer within 0 minutes');
  assert.equal(r.usage.calls, 1);
  assert.equal(r.usage.searches, 7);
  assert.equal(list[0].catalyst, '');
});

await t('tagCatalysts: end to end on the fake client', async function () {
  var list = [sig({ symbol: 'A', status: 'confirmed', score: 80 }), sig({ symbol: 'B' })];
  var client = fakeClient([msg([
    searchResult(['https://a.com/1']),
    saveBlock({
      catalysts: [{ symbol: 'A', catalyst: 'A news.', eventType: 'product', date: '2026-10-02', sourceUrl: 'https://a.com/1' }],
      reads: [{ symbol: 'A', why: 'Launch.', wouldBreak: 'A close under 95.', sourceUrls: ['https://a.com/1'] }]
    })
  ], 'tool_use', { server_tool_use: { web_search_requests: 3 } })]);
  var r = await tagCatalysts({ signals: list, client: client, today: '2026-10-03' });
  assert.equal(r.error, '');
  assert.deepEqual(r.focus, ['A']);
  assert.equal(r.stats.tagged, 1);
  assert.equal(r.usage.searches, 3);
  assert.equal(list[0].read.why, 'Launch.');
  assert.ok(/Today is 2026-10-03/.test(client.sent[0].messages[0].content));
});

await t('usageForLedger: folds Claude usage into the ledger shape', function () {
  assert.deepEqual(usageForLedger({ input: 100, output: 50, cacheRead: 300, cacheWrite: 200 }),
    { inputTokens: 600, outputTokens: 50, cachedTokens: 300, cacheWriteTokens: 200 });
});

await t('the save tool schema is strict-compatible', function () {
  function check(schema) {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required.slice().sort(), Object.keys(schema.properties).sort());
      Object.keys(schema.properties).forEach(function (k) { check(schema.properties[k]); });
    }
    if (schema.type === 'array') check(schema.items);
  }
  check(SAVE_TOOL.input_schema);
});

console.log('\n' + n + ' checks passed.');
