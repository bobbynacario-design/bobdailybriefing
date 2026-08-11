import assert from 'assert';
import { fetchRetry, retryAfterMs } from './http.js';

var tests = 0;
function response(status, retryAfter) {
  return {
    status: status,
    headers: { get: function (name) { return name === 'retry-after' ? retryAfter || null : null; } }
  };
}

assert.equal(retryAfterMs(response(429, '2'), 0), 2000); tests++;
assert.equal(retryAfterMs(response(429, 'Thu, 01 Jan 1970 00:00:10 GMT'), 5000), 5000); tests++;

var calls = 0;
var delays = [];
var eventual = await fetchRetry('https://example.test', {}, 'test', {
  attempts: 3,
  baseDelayMs: 10,
  random: function () { return 0.5; },
  sleep: async function (ms) { delays.push(ms); },
  fetchImpl: async function () { calls++; return response(calls === 1 ? 503 : 200); },
  log: function () {}
});
assert.equal(eventual.status, 200); tests++;
assert.equal(calls, 2); tests++;
assert.deepEqual(delays, [10]); tests++;

calls = 0; delays = [];
var limited = await fetchRetry('https://example.test', {}, 'test', {
  attempts: 2,
  baseDelayMs: 10,
  random: function () { return 0.5; },
  sleep: async function (ms) { delays.push(ms); },
  fetchImpl: async function () { calls++; return response(calls === 1 ? 429 : 200, '3'); },
  log: function () {}
});
assert.equal(limited.status, 200); tests++;
assert.deepEqual(delays, [3000]); tests++;

var failed = false;
try {
  await fetchRetry('https://example.test', {}, 'test', {
    attempts: 2,
    baseDelayMs: 0,
    sleep: async function () {},
    fetchImpl: async function () { throw new Error('offline'); },
    log: function () {}
  });
} catch (error) {
  failed = error.message === 'offline';
}
assert.equal(failed, true); tests++;

console.log('http tests passed: ' + tests);
