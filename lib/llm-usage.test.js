// Offline tests for lib/llm-usage.js token extraction. No I/O, no network.
//   node lib/llm-usage.test.js
//
// This matters more than it looks: extractUsage never throws, so a shape it does
// not understand records ZERO tokens silently. The cost ledger would look clean
// and be wrong — the failure mode is a wrong number, not an error.
import assert from 'assert';
import { extractUsage, addUsage } from './llm-usage.js';

var n = 0;
function t(name, fn) { fn(); n++; console.log('  PASS  ' + name); }

t('/v1/responses shape (OpenAI)', function () {
  var u = extractUsage({ usage: { input_tokens: 1200, output_tokens: 340 } });
  assert.equal(u.inputTokens, 1200);
  assert.equal(u.outputTokens, 340);
  assert.equal(u.cachedTokens, 0);
});

t('/v1/chat/completions shape (every OpenAI-compatible provider)', function () {
  // Ollama, DeepSeek, Qwen, GLM, OpenRouter all report these names. Before the
  // adapter this returned zeros, which would have under-reported the ledger to
  // nothing without any error surfacing.
  var u = extractUsage({ usage: { prompt_tokens: 890, completion_tokens: 210 } });
  assert.equal(u.inputTokens, 890);
  assert.equal(u.outputTokens, 210);
});

t('cached tokens from either shape', function () {
  var responses = extractUsage({ usage: { input_tokens: 1000, output_tokens: 10, input_tokens_details: { cached_tokens: 400 } } });
  assert.equal(responses.cachedTokens, 400);
  var chat = extractUsage({ usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 256 } } });
  assert.equal(chat.cachedTokens, 256);
});

t('responses field names win when both are present', function () {
  // Some gateways echo both. Prefer the native shape rather than double-counting.
  var u = extractUsage({ usage: { input_tokens: 100, output_tokens: 20, prompt_tokens: 999, completion_tokens: 999 } });
  assert.equal(u.inputTokens, 100);
  assert.equal(u.outputTokens, 20);
});

t('a provider reporting no usage at all yields zeros, not NaN', function () {
  // Local Ollama can omit usage entirely. Zeros are correct there — a local run
  // costs nothing — but NaN would poison every later sum in the ledger.
  var u = extractUsage({ choices: [{ message: { content: '{}' } }] });
  assert.equal(u.inputTokens, 0);
  assert.equal(u.outputTokens, 0);
  assert.ok(!isNaN(u.inputTokens) && !isNaN(u.outputTokens));
});

t('malformed payloads do not throw', function () {
  assert.doesNotThrow(function () {
    extractUsage(null); extractUsage({}); extractUsage({ usage: null });
    extractUsage({ usage: { prompt_tokens: 'abc' } });
  });
  assert.equal(extractUsage({ usage: { prompt_tokens: 'abc' } }).inputTokens, 0);
});

t('addUsage folds N persona calls into one record', function () {
  var a = extractUsage({ usage: { prompt_tokens: 100, completion_tokens: 50 } });
  var b = extractUsage({ usage: { input_tokens: 7, output_tokens: 3 } });
  var s = addUsage(a, b);
  assert.equal(s.inputTokens, 107);
  assert.equal(s.outputTokens, 53);
});

console.log('\n' + n + ' checks passed.');
