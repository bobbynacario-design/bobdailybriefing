'use strict';
// Copy alongside validate.js in each consumer; never import another repo's code.
// Returns the raw input expected by the existing fixture importers. Their own
// mappings and planImport remain responsible for eligibility and receipts.
const crypto = require('node:crypto');
const { validateRelease } = require('./validate');
const digest = (body) => crypto.createHash('sha256').update(body).digest('hex');
const DEFAULT_LATEST = 'https://raw.githubusercontent.com/bobbynacario-design/bobdailybriefing/grounding-data/grounding/latest.json';

async function fetchRelease(opts = {}) {
  const latestUrl = new URL(opts.latestUrl || DEFAULT_LATEST);
  if (latestUrl.protocol !== 'https:') throw new Error('release URL must use HTTPS');
  const fetcher = opts.fetch || fetch;
  const pause = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  async function read(url) {
    const response = await fetcher(String(url), { signal: AbortSignal.timeout(20000), redirect: 'error', headers: { 'user-agent': opts.userAgent || 'Daybook-grounding-consumer/1.0', 'cache-control': 'no-cache' } });
    if (!response.ok) throw new Error('release fetch returned HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 10 * 1024 * 1024) throw new Error('release file exceeds 10 MiB');
    return bytes;
  }
  // Pin the pointer for the whole attempt: never combine two releases.
  const latestText = (await read(latestUrl)).toString('utf8');
  const latest = JSON.parse(latestText);
  if (!Number.isSafeInteger(latest.sequence) || latest.sequence < 1 ||
    !latest.manifest || latest.manifest.path !== 'releases/' + String(latest.sequence).padStart(6, '0') + '/manifest.json' ||
    !/^[a-f0-9]{64}$/.test(latest.manifest.sha256)) throw new Error('invalid latest release pointer');
  const manifestUrl = new URL(latest.manifest.path, latestUrl);
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const manifestBytes = await read(manifestUrl);
      if (digest(manifestBytes) !== latest.manifest.sha256) throw new Error('manifest digest mismatch');
      const manifestText = manifestBytes.toString('utf8');
      const manifest = JSON.parse(manifestText);
      const names = ['facts.json', 'watch.json', 'insights.json'];
      if (!Array.isArray(manifest.files) || manifest.files.length !== 3 ||
        names.some((name) => manifest.files.filter((f) => f.name === name && /^[a-f0-9]{64}$/.test(f.sha256)).length !== 1)) throw new Error('invalid release file list');
      const fileTexts = {};
      for (const name of names) {
        const bytes = await read(new URL(name, manifestUrl));
        if (digest(bytes) !== manifest.files.find((f) => f.name === name).sha256) throw new Error(name + ': digest mismatch');
        fileTexts[name] = bytes.toString('utf8');
      }
      const input = { latestText, manifestText, fileTexts, directorySequence: latest.sequence };
      const release = validateRelease(input, { bounds: opts.bounds });
      if (!release.ok) throw new Error('invalid release: ' + release.errors.join('; '));
      return { input, release };
    } catch (e) {
      error = e;
      if (attempt < 2) await pause(30000);
    }
  }
  throw error;
}
module.exports = { fetchRelease, DEFAULT_LATEST };
