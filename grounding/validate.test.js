'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const V = require('./validate');
const { buildAll, DEFS, FIXTURE_BOUNDS } = require('./build-contract-files');

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const clone = (value) => JSON.parse(JSON.stringify(value));
const FIX = path.join(__dirname, 'fixtures');
const read = (rel) => fs.readFileSync(path.join(FIX, rel), 'utf8');

function publishedRelease(seq) {
  const dir = String(seq).padStart(6, '0');
  const base = 'published-' + dir + '/grounding/';
  return {
    latestText: read(base + 'latest.json'),
    manifestText: read(base + 'releases/' + dir + '/manifest.json'),
    fileTexts: {
      'facts.json': read(base + 'releases/' + dir + '/facts.json'),
      'watch.json': read(base + 'releases/' + dir + '/watch.json'),
      'insights.json': read(base + 'releases/' + dir + '/insights.json'),
    },
    directorySequence: seq,
  };
}
// Build a release from objects, with correct digests, for the release tests.
function makeRelease(seq, facts, watch, insights, tweak) {
  const files = { 'facts.json': json(facts), 'watch.json': json(watch), 'insights.json': json(insights) };
  let manifest = {
    schema: V.SCHEMAS.manifest, sequence: seq, previousSequence: seq === 1 ? null : seq - 1, generatedAt: '2026-10-01T04:15:00Z', producerCommit: 'test',
    files: ['facts', 'watch', 'insights'].map((k) => ({ name: k + '.json', sha256: sha256(files[k + '.json']), schema: V.SCHEMAS[k], recordCount: [facts, watch, insights][['facts', 'watch', 'insights'].indexOf(k)].records.length })),
  };
  let latest = { schema: V.SCHEMAS.latest, sequence: seq, generatedAt: '2026-10-01T04:15:00Z', manifest: { path: 'releases/' + String(seq).padStart(6, '0') + '/manifest.json', sha256: '' } };
  if (tweak) ({ manifest, latest } = tweak({ manifest, latest }) || { manifest, latest });
  const manifestText = json(manifest);
  if (!latest.manifest.sha256) latest.manifest.sha256 = sha256(manifestText);
  return { latestText: json(latest), manifestText, fileTexts: files, directorySequence: seq };
}
const release1Objects = () => {
  const r = publishedRelease(1);
  return { facts: JSON.parse(r.fileTexts['facts.json']), watch: JSON.parse(r.fileTexts['watch.json']), insights: JSON.parse(r.fileTexts['insights.json']) };
};
const factsWith = (mutate) => { const o = release1Objects(); mutate(o.facts.records); return V.validateFactsFile(o.facts, { bounds: FIXTURE_BOUNDS }); };
const byId = (result, id) => result.results.find((r) => r.recordId === id);
const errorsOf = (result) => result.errors.concat(...result.results.map((r) => r.errors)).join('\n');

const CPI = 'fixture_cpi_annual_change@2026-08#r1';
const AWARD = 'fixture_award_cw1_ordinary@2026-07-01#r1';
const STORAGE = 'fixture_vehicle_storage_fee@2026-07-01#r1';
const DERIVED = 'fixture_cpi_annual_change_derived@2026-08#r1';

// ── the committed files cannot drift ─────────────────────────────────────────
test('schemas and fixtures are exactly what the build script writes', () => {
  const files = buildAll();
  Object.keys(files).forEach((rel) => {
    assert.equal(fs.readFileSync(path.join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n'), files[rel], 'stale: grounding/' + rel + ' (run npm --prefix grounding run fixtures)');
  });
});
test('each schema lists exactly the fields the validator allows and requires', () => {
  const pairs = { fact: 'fact', scope: 'scope', range: 'range', qualification: 'qualification', binding: 'binding', locator: 'locator', evidence: 'evidence',
    derivation: 'derivation', override: 'override', failedBound: 'failedBound', watch: 'watch', watchEvidence: 'watchEvidence', insight: 'insight',
    insightSource: 'insightSource', tags: 'tags', manifestFile: 'manifestFile', latestManifest: 'latestManifest' };
  Object.keys(pairs).forEach((def) => {
    assert.deepEqual(Object.keys(DEFS[def].properties).sort(), V.FIELDS[pairs[def]].allowed.slice().sort(), def + ' properties');
    assert.deepEqual(DEFS[def].required.slice().sort(), V.FIELDS[pairs[def]].required.slice().sort(), def + ' required');
    assert.equal(DEFS[def].additionalProperties, false, def + ' refuses unknown fields');
  });
});

// ── bounded number matching ──────────────────────────────────────────────────
test('numbers normalise only when they are plain decimals', () => {
  assert.equal(V.normaliseNumberText('1,250.50'), '1250.5');
  assert.equal(V.normaliseNumberText('3.60'), '3.6');
  assert.equal(V.normaliseNumberText('-0.30'), '-0.3');
  assert.equal(V.normaliseNumberText('0.0'), '0');
  assert.equal(V.normaliseNumberText('1.25k'), null);
  assert.equal(V.normaliseNumberText('12,34'), null, 'a malformed group is not a number');
  assert.equal(V.canonicalNumber(34), '34');
  assert.equal(V.canonicalNumber(1e-7), null, 'no exponent forms');
});
test('a token must stand alone in the quote', () => {
  assert.equal(V.tokenStandsAlone('rose 15% over the year', '5'), false, '5 never matches inside 15');
  assert.equal(V.tokenStandsAlone('rose 5% over the year', '5'), true);
  assert.equal(V.tokenStandsAlone('costs $1,250 each', '1,250'), true);
  assert.equal(V.tokenStandsAlone('costs $1,250 each', '1250'), false, '1250 is not written in the quote');
  assert.equal(V.tokenStandsAlone('costs $1,250 each', '250'), false, 'the tail of a digit group');
  assert.equal(V.tokenStandsAlone('costs $1,250 each', '1'), false, 'the head of a digit group');
  assert.equal(V.tokenStandsAlone('budget of 1.25k', '1.25'), false, 'shorthand never matches');
  assert.equal(V.tokenStandsAlone('rate 3.6 per cent', '3'), false);
  assert.equal(V.tokenStandsAlone('rate 3.6 per cent', '6'), false);
  assert.equal(V.tokenStandsAlone('rate 3.6.', '3.6'), true, 'a full stop ends the sentence');
  assert.equal(V.tokenStandsAlone('fell -0.3% in the month', '-0.3'), true);
  assert.equal(V.tokenStandsAlone('fell -0.3% in the month', '0.3'), false, 'the token dropped its minus sign');
  assert.deepEqual(V.numbersInQuote('Aug-2026,139.2,3.1'), ['2026', '139.2', '3.1'], 'a data row is several numbers');
  assert.deepEqual(V.numbersInQuote('fell -0.3%, then 1,250'), ['-0.3', '1250']);
});

// ── the sample releases ──────────────────────────────────────────────────────
test('release 1 is valid, and the trust attributes are computed, not declared', () => {
  const r = V.validateRelease(publishedRelease(1), { bounds: FIXTURE_BOUNDS });
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.sequence, 1);
  assert.deepEqual(byId(r.facts, CPI).checks, { sourceLinked: true, factVerified: true, crossChecked: true, plausible: true });
  assert.deepEqual(byId(r.facts, AWARD).checks, { sourceLinked: true, factVerified: true, crossChecked: false, plausible: true },
    'a manual award guide is fact-verified without a cross-check');
  assert.equal(byId(r.facts, STORAGE).checks.factVerified, true, 'both ends of the range are bound');
  assert.equal(byId(r.facts, STORAGE).checks.plausible, null, 'no bounds known: not evaluated');
  assert.equal(byId(r.facts, DERIVED).checks.factVerified, true, 'verified through its inputs and formula');
  assert.equal(byId(r.facts, DERIVED).checks.sourceLinked, true);
  r.facts.results.forEach((x) => assert.equal(x.eligible, true, x.recordId));
  assert.equal(r.watch.ok, true); assert.equal(r.insights.ok, true);
});
test('release 2 corrects the award and replaces August CPI; the old records are history', () => {
  const r = V.validateRelease(publishedRelease(2), { bounds: FIXTURE_BOUNDS });
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(byId(r.facts, AWARD).historical, true); assert.equal(byId(r.facts, AWARD).eligible, false);
  assert.equal(byId(r.facts, 'fixture_award_cw1_ordinary@2026-07-01#r2').eligible, true);
  assert.equal(byId(r.facts, CPI).eligible, false);
  assert.equal(byId(r.facts, 'fixture_cpi_annual_change@2026-09#r1').eligible, true);
});

// ── facts that must fail ─────────────────────────────────────────────────────
test('a value bound to 5 inside 15 fails', () => {
  const r = factsWith((recs) => {
    const cpi = recs.find((x) => x.recordId === CPI);
    cpi.value = 5; cpi.valueBindings[0].token = '5';
    cpi.evidence[0].quote = 'FIXTURE: prices rose 15% in the year.'; cpi.evidence.splice(1, 1);
  });
  assert.match(errorsOf(r), /token "5" does not stand alone/);
  assert.equal(byId(r, CPI).eligible, false);
});
test('1250 does not bind to a quote that says 1,250, but 1,250 does', () => {
  const bad = factsWith((recs) => { const a = recs.find((x) => x.recordId === AWARD); a.value = 1250; a.valueBindings[0].token = '1250'; a.evidence[0].quote = 'FIXTURE: fee $1,250 per call-out'; });
  assert.match(errorsOf(bad), /token "1250" does not stand alone/);
  const good = factsWith((recs) => { const a = recs.find((x) => x.recordId === AWARD); a.value = 1250; a.valueBindings[0].token = '1,250'; a.evidence[0].quote = 'FIXTURE: fee $1,250 per call-out'; });
  assert.equal(byId(good, AWARD).checks.factVerified, true);
});
test('a token that means a different value fails', () => {
  const r = factsWith((recs) => { recs.find((x) => x.recordId === AWARD).value = 31.5; });
  assert.match(errorsOf(r), /token "31.15" does not mean value 31.5/);
});
test('a range needs a binding for each end', () => {
  const r = factsWith((recs) => { recs.find((x) => x.recordId === STORAGE).valueBindings.pop(); });
  assert.match(errorsOf(r), /range.max has no value binding/);
});
test('a cross-check that disagrees is a conflict', () => {
  const r = factsWith((recs) => { recs.find((x) => x.recordId === CPI).evidence[1].quote = 'Aug-2026,139.2,3.4'; });
  assert.match(errorsOf(r), /cross-check conflict/);
  assert.equal(byId(r, CPI).ok, false);
});
test('a derived value must equal its formula, and carries no quote bindings', () => {
  const wrong = factsWith((recs) => { recs.find((x) => x.recordId === DERIVED).value = 3.2; });
  assert.match(errorsOf(wrong), /derived value 3.2 does not equal pct_change of its inputs \(3.1\)/);
  const bound = factsWith((recs) => { recs.find((x) => x.recordId === DERIVED).valueBindings = [{ field: 'value', token: '3.1', evidenceId: 'x' }]; });
  assert.match(errorsOf(bound), /verified through its inputs, not quote bindings/);
  const missing = factsWith((recs) => { recs.splice(recs.findIndex((x) => x.recordId === 'fixture_cpi_index_level@2025-08#r1'), 1); });
  assert.match(errorsOf(missing), /derivation input is not in this snapshot/);
});
test('a plausibility breach blocks the record unless a matching override is recorded', () => {
  const breach = (recs) => {
    const cpi = recs.find((x) => x.recordId === CPI);
    cpi.value = 25; cpi.valueBindings[0].token = '25';
    cpi.evidence[0].quote = 'FIXTURE: The monthly CPI indicator rose 25% in the 12 months to August 2026.';
    cpi.evidence.splice(1, 1);
    return cpi;
  };
  const blocked = factsWith(breach);
  assert.equal(byId(blocked, CPI).checks.plausible, false);
  assert.equal(byId(blocked, CPI).eligible, false);
  const cleared = factsWith((recs) => {
    breach(recs).plausibilityOverride = { reviewer: 'BN', at: '2026-10-01T05:00:00Z', reason: 'Checked against the release: a fixture spike.', failedBound: { kind: 'absolute', limit: 15, observed: 25 } };
  });
  assert.equal(byId(cleared, CPI).checks.plausible, true);
  assert.equal(byId(cleared, CPI).eligible, true);
  const wrongBound = factsWith((recs) => {
    breach(recs).plausibilityOverride = { reviewer: 'BN', at: '2026-10-01T05:00:00Z', reason: 'x', failedBound: { kind: 'absolute', limit: 20, observed: 25 } };
  });
  assert.match(errorsOf(wrongBound), /does not record the bound that failed/);
  const needless = factsWith((recs) => {
    recs.find((x) => x.recordId === CPI).plausibilityOverride = { reviewer: 'BN', at: '2026-10-01T05:00:00Z', reason: 'x', failedBound: { kind: 'absolute', limit: 15, observed: 3.1 } };
  });
  assert.match(errorsOf(needless), /nothing breached/);
});
test('corrections must supersede the previous revision, which becomes history', () => {
  const r2 = (recs, patch) => {
    const r1 = recs.find((x) => x.recordId === AWARD);
    r1.lifecycle = 'superseded';
    const next = Object.assign(clone(r1), { revision: 2, recordId: 'fixture_award_cw1_ordinary@2026-07-01#r2', lifecycle: 'corrected', supersedes: AWARD }, patch);
    recs.push(next);
  };
  assert.equal(factsWith((recs) => r2(recs, {})).ok, true);
  assert.match(errorsOf(factsWith((recs) => r2(recs, { lifecycle: 'current' }))), /is "corrected", not "current"/);
  assert.match(errorsOf(factsWith((recs) => r2(recs, { supersedes: null }))), /must name the revision it supersedes/);
  const notMarked = factsWith((recs) => { r2(recs, {}); recs.find((x) => x.recordId === AWARD).lifecycle = 'current'; });
  assert.match(errorsOf(notMarked), /must be marked superseded/);
  assert.match(errorsOf(notMarked), /more than one current revision/);
});
test('private fields, producer-written trust flags and insights cannot enter the facts file', () => {
  assert.match(errorsOf(factsWith((recs) => { recs[0].account = 'QBE'; })), /field not allowed: account/);
  assert.match(errorsOf(factsWith((recs) => { recs[0].evidence[0].clientName = 'x'; })), /field not allowed: clientName/);
  assert.match(errorsOf(factsWith((recs) => { recs[0].checks = { factVerified: true }; })), /field not allowed: checks/);
  const withInsight = factsWith((recs) => { recs.push(clone(release1Objects().insights.records[0])); });
  assert.match(errorsOf(withInsight), /field not allowed: insightId/);
  assert.equal(withInsight.ok, false);
});

// ── watch and insights ───────────────────────────────────────────────────────
test('an expected date needs the page that states it, and overdue needs a date', () => {
  const o = release1Objects();
  const w = o.watch;
  w.records[1].evidence = null;
  assert.match(V.validateWatchFile(w).results[1].errors.join('\n'), /expectedBy needs the evidence page that states it/);
  const o2 = release1Objects();
  o2.watch.records[0].state = 'overdue';
  assert.match(V.validateWatchFile(o2.watch).results[0].errors.join('\n'), /"overdue" needs a stated expectedBy/);
  const o3 = release1Objects();
  o3.watch.records[0].lastCheckedAt = '2026-10-01T04:15:00Z';
  assert.match(V.validateWatchFile(o3.watch).results[0].errors.join('\n'), /field not allowed: lastCheckedAt/, 'check times stay out of the release');
});
test('insights carry no values or evidence', () => {
  const o = release1Objects();
  o.insights.records[0].value = 3.1;
  assert.match(V.validateInsightsFile(o.insights).results[0].errors.join('\n'), /field not allowed: value/);
});

// ── releases ─────────────────────────────────────────────────────────────────
test('a release is refused on any digest mismatch, before anything is parsed', () => {
  const r = publishedRelease(1);
  r.fileTexts['facts.json'] = r.fileTexts['facts.json'].replace('3.1%', '3.2%');
  const out = V.validateRelease(r);
  assert.equal(out.ok, false); assert.match(out.errors.join('\n'), /facts.json: digest mismatch/);
  assert.equal(out.facts, null, 'a file that fails its digest is never parsed');
  const m = publishedRelease(1);
  m.manifestText = m.manifestText.replace('"fixture"', '"tampered"');
  assert.match(V.validateRelease(m).errors.join('\n'), /manifest.json: digest mismatch/);
});
test('sequences must agree across latest.json, the manifest and the directory', () => {
  const o = release1Objects();
  const wrongDir = makeRelease(3, o.facts, o.watch, o.insights); wrongDir.directorySequence = 4;
  assert.match(V.validateRelease(wrongDir).errors.join('\n'), /release directory 000004 does not match sequence 3/);
  const wrongPrev = makeRelease(3, o.facts, o.watch, o.insights, (x) => { x.manifest.previousSequence = 1; return x; });
  assert.match(V.validateRelease(wrongPrev).errors.join('\n'), /previousSequence must be 2/);
  const wrongSeq = makeRelease(3, o.facts, o.watch, o.insights, (x) => { x.manifest.sequence = 2; return x; });
  assert.match(V.validateRelease(wrongSeq).errors.join('\n'), /sequence 2 does not match latest.json 3/);
  assert.equal(V.validateRelease(makeRelease(3, o.facts, o.watch, o.insights), { bounds: FIXTURE_BOUNDS }).ok, true);
});
test('one invalid record fails the whole release', () => {
  const o = release1Objects();
  o.facts.records[0].account = 'QBE';
  const out = V.validateRelease(makeRelease(1, o.facts, o.watch, o.insights));
  assert.equal(out.ok, false); assert.match(out.errors.join('\n'), /field not allowed: account/);
});

// ── import planning ──────────────────────────────────────────────────────────
const POLICY = {
  mappingVersion: 'test-1',
  allow: {
    series: ['fixture_cpi_annual_change', 'fixture_award_cw1_ordinary', 'fixture_vehicle_storage_fee', 'fixture_cpi_annual_change_derived', 'fixture_cpi_index_level'],
    publishers: ['Fixture Statistics Bureau (not a real source)', 'Fixture Wage Office (not a real source)'],
    units: ['pct', 'aud_per_hour', 'aud_per_day', 'index_points'],
    jurisdictions: ['AU', 'NSW'],
  },
};
const validated = (seq) => V.validateRelease(publishedRelease(seq), { bounds: FIXTURE_BOUNDS });
const NOW = '2026-10-01T06:00:00Z';

test('a first import takes every eligible, allowlisted record and writes a receipt', () => {
  const plan = V.planImport(null, validated(1), POLICY, NOW);
  assert.equal(plan.action, 'import');
  assert.equal(plan.toImport.length, 6);
  assert.equal(plan.receipt.releaseSequence, 1);
  assert.match(plan.receipt.manifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(plan.receipt.mappingVersion, 'test-1');
  assert.equal(plan.receipt.importedAt, NOW);
});
test('policy can refuse derived records and anything not allowlisted', () => {
  const plan = V.planImport(null, validated(1), Object.assign({}, POLICY, { refuseDerived: true, allow: Object.assign({}, POLICY.allow, { jurisdictions: ['AU'] }) }), NOW);
  const reasons = Object.fromEntries(plan.skips.map((s) => [s.recordId, s.reason]));
  assert.equal(reasons[DERIVED], 'derived records refused by policy');
  assert.equal(reasons[STORAGE], 'jurisdiction not allowlisted');
  assert.equal(plan.toImport.length, 4);
});
test('the same release again is a no-op; a reused sequence or an older release is refused', () => {
  const r1 = validated(1);
  const first = V.planImport(null, r1, POLICY, NOW);
  const state = V.nextImportState(null, r1, first.toImport.map((x) => x.recordId), []);
  assert.equal(V.planImport(state, r1, POLICY, NOW).action, 'noop');
  const reused = Object.assign({}, r1, { manifestSha256: 'f'.repeat(64) });
  const plan = V.planImport(state, reused, POLICY, NOW);
  assert.equal(plan.action, 'reject'); assert.match(plan.reason, /reused with a different manifest digest/);
  const newer = V.nextImportState(state, validated(2), [], []);
  const back = V.planImport(newer, r1, POLICY, NOW);
  assert.equal(back.action, 'reject'); assert.match(back.reason, /rollback/);
});
test('release 2 imports only what is new, flags what it replaced, and never recreates a proposal', () => {
  const r1 = validated(1);
  const first = V.planImport(null, r1, POLICY, NOW);
  const state = V.nextImportState(null, r1, first.toImport.map((x) => x.recordId), []);
  const plan = V.planImport(state, validated(2), POLICY, NOW);
  assert.deepEqual(plan.toImport.map((x) => x.recordId).sort(), ['fixture_award_cw1_ordinary@2026-07-01#r2', 'fixture_cpi_annual_change@2026-09#r1']);
  assert.deepEqual(plan.flags.map((f) => f.recordId).sort(), [AWARD, CPI]);
  assert.ok(plan.skips.filter((s) => s.reason === 'duplicate').length >= 3, 'unchanged records are receipt skips');
  const after = V.nextImportState(state, validated(2), plan.toImport.map((x) => x.recordId), plan.flags.map((f) => f.recordId));
  const again = V.planImport(Object.assign({}, after, { sequence: 2 }), Object.assign({}, validated(2), { sequence: 3, manifestSha256: 'e'.repeat(64), fileSha256: { facts: 'd'.repeat(64) } }), POLICY, NOW);
  assert.equal(again.toImport.length, 0, 'nothing is imported twice');
  assert.equal(again.flags.length, 0, 'a record is flagged once');
});
test('a release caused only by a watch or insight change skips facts entirely', () => {
  const o = release1Objects();
  const r1 = V.validateRelease(makeRelease(1, o.facts, o.watch, o.insights), { bounds: FIXTURE_BOUNDS });
  const state = V.nextImportState(null, r1, [], []);
  o.watch.records[0].detail = 'Fixture pay guide re-checked; unchanged.';
  const r2 = V.validateRelease(makeRelease(2, o.facts, o.watch, o.insights), { bounds: FIXTURE_BOUNDS });
  const plan = V.planImport(state, r2, POLICY, NOW);
  assert.equal(plan.action, 'import'); assert.equal(plan.toImport.length, 0);
  assert.deepEqual(plan.skips, [{ recordId: null, reason: 'facts unchanged' }]);
});
test('an invalid release is refused outright', () => {
  const r = publishedRelease(1);
  r.fileTexts['facts.json'] = r.fileTexts['facts.json'].replace('3.1%', '3.2%');
  const plan = V.planImport(null, V.validateRelease(r), POLICY, NOW);
  assert.equal(plan.action, 'reject'); assert.match(plan.reason, /failed validation/);
});
