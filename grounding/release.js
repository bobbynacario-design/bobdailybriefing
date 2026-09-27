'use strict';
// Cut an immutable release: the three record files, the manifest and
// latest.json, as the exact texts to publish (roadmap section 5.1).
//
// build-contract-files.js uses this for the sample releases and the publisher
// uses it for real ones, so a real release is built byte for byte the way the
// tested fixtures are. No dependencies beyond node:crypto.

const crypto = require('crypto');
const { SCHEMAS } = require('./validate');

const pad6 = (n) => String(n).padStart(6, '0');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// records: { facts: [], watch: [], insights: [] }
// opts:    { generatedAt, producerCommit }
// Returns { sequence, dir, manifestSha256, files: { '<path under grounding/>': text } }.
function cutRelease(sequence, records, opts) {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('sequence must be an integer from 1');
  opts = opts || {};
  const generatedAt = opts.generatedAt;
  const dir = 'releases/' + pad6(sequence);
  const texts = {
    'facts.json': json({ schema: SCHEMAS.facts, generatedAt, records: records.facts || [] }),
    'watch.json': json({ schema: SCHEMAS.watch, generatedAt, records: records.watch || [] }),
    'insights.json': json({ schema: SCHEMAS.insights, generatedAt, records: records.insights || [] }),
  };
  // Preserve exact bytes for unchanged files, including their original date.
  // Consumers can then skip facts when only a watch or insight changed.
  for (const name of Object.keys(texts)) {
    const prior = opts.previousFileTexts && opts.previousFileTexts[name];
    if (prior && JSON.stringify(JSON.parse(prior).records) === JSON.stringify(JSON.parse(texts[name]).records)) texts[name] = prior;
  }
  const manifest = json({
    schema: SCHEMAS.manifest, sequence, previousSequence: sequence === 1 ? null : sequence - 1, generatedAt,
    producerCommit: opts.producerCommit,
    files: [
      { name: 'facts.json', sha256: sha256(texts['facts.json']), schema: SCHEMAS.facts, recordCount: (records.facts || []).length },
      { name: 'watch.json', sha256: sha256(texts['watch.json']), schema: SCHEMAS.watch, recordCount: (records.watch || []).length },
      { name: 'insights.json', sha256: sha256(texts['insights.json']), schema: SCHEMAS.insights, recordCount: (records.insights || []).length },
    ],
  });
  const manifestSha256 = sha256(manifest);
  const latest = json({ schema: SCHEMAS.latest, sequence, generatedAt, manifest: { path: dir + '/manifest.json', sha256: manifestSha256 } });
  const files = { 'latest.json': latest };
  files[dir + '/manifest.json'] = manifest;
  Object.keys(texts).forEach((name) => { files[dir + '/' + name] = texts[name]; });
  return { sequence, dir, manifestSha256, files };
}

module.exports = { cutRelease, pad6, sha256, json };
