// Shared resilient fetch helper for unattended feed refreshes.
// Adds per-attempt deadlines, retry jitter, and Retry-After support while
// preserving the final HTTP response so callers can report provider details.

function retryAfterMs(response, nowMs) {
  if (!response || !response.headers || typeof response.headers.get !== 'function') return 0;
  var value = response.headers.get('retry-after');
  if (!value) return 0;
  var seconds = Number(value);
  if (isFinite(seconds) && seconds >= 0) return seconds * 1000;
  var when = Date.parse(value);
  return isFinite(when) ? Math.max(0, when - (nowMs || Date.now())) : 0;
}

function requestOptions(opts, timeoutMs) {
  var out = Object.assign({}, opts || {});
  var timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (out.signal && typeof AbortSignal.any === 'function') {
    out.signal = AbortSignal.any([out.signal, timeoutSignal]);
  } else if (!out.signal) {
    out.signal = timeoutSignal;
  }
  return out;
}

async function fetchRetry(url, opts, label, config) {
  config = config || {};
  var attempts = Math.max(1, Number(config.attempts || process.env.FEED_HTTP_ATTEMPTS || 4));
  var timeoutMs = Math.max(1000, Number(config.timeoutMs || process.env.FEED_HTTP_TIMEOUT_MS || 20000));
  var baseDelayMs = Math.max(0, Number(config.baseDelayMs == null ? 1000 : config.baseDelayMs));
  var maxDelayMs = Math.max(baseDelayMs, Number(config.maxDelayMs || 15000));
  var fetchImpl = config.fetchImpl || globalThis.fetch;
  var sleep = config.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  var random = config.random || Math.random;
  var log = config.log || function (message) { console.log(message); };
  var lastErr;

  for (var i = 0; i < attempts; i++) {
    try {
      var response = await fetchImpl(url, requestOptions(opts, timeoutMs));
      var retryable = response.status === 429 || response.status >= 500;
      if (!retryable || i === attempts - 1) return response;
      lastErr = new Error((label || 'fetch') + ' HTTP ' + response.status);
      if (response.body && typeof response.body.cancel === 'function') {
        try { await response.body.cancel(); } catch (cancelError) { /* best effort */ }
      }
      var retryDelay = retryAfterMs(response);
      var backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, i));
      var delay = Math.max(retryDelay, Math.round(backoff * (0.75 + random() * 0.5)));
      log('  ' + (label || 'fetch') + ' HTTP ' + response.status + ', retry ' + (i + 1) + '/' + (attempts - 1) + ' in ' + delay + 'ms');
      await sleep(delay);
    } catch (error) {
      lastErr = error;
      if (i === attempts - 1) break;
      var code = (error && error.cause && error.cause.code) || (error && error.name) || (error && error.message) || 'network error';
      var networkBackoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, i));
      var networkDelay = Math.round(networkBackoff * (0.75 + random() * 0.5));
      log('  ' + (label || 'fetch') + ' transient error (' + code + '), retry ' + (i + 1) + '/' + (attempts - 1) + ' in ' + networkDelay + 'ms');
      await sleep(networkDelay);
    }
  }
  throw lastErr || new Error((label || 'fetch') + ' failed');
}

export { fetchRetry, retryAfterMs };
