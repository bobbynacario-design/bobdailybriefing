'use strict';
// Writes the contract's JSON Schemas (grounding/schema/) and the sample
// releases consumers build their importers against (grounding/fixtures/).
//
//   node grounding/build-contract-files.js           write the files
//   node grounding/build-contract-files.js --check   exit 1 if any file is stale
//
// Everything is deterministic (fixed timestamps, fixed digests), so the
// committed files can be checked against this script in the tests.
//
// FIXTURE DATA IS NOT REAL. Every fixture series is prefixed "fixture_", every
// URL is on example.org, and every publisher says it is not a real source, so
// no consumer allowlist can ever let a fixture into production.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SCHEMAS, ENUMS, FIELDS } = require('./validate');
const { cutRelease, pad6 } = require('./release');

const ROOT = __dirname;
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

// ── JSON Schemas ─────────────────────────────────────────────────────────────
const S = {
  text: { type: 'string', minLength: 1 },
  date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  time: { type: 'string', format: 'date-time' },
  sha: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  url: { type: 'string', pattern: '^https?://' },
  num: { type: 'number' },
  nullable: (schema) => ({ anyOf: [schema, { type: 'null' }] }),
  enumOf: (list) => ({ type: 'string', enum: list }),
  // An open vocabulary (validate.js, header): the values this version knows,
  // and the form a later version's values take.
  vocab: (list) => ({ type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,39}$', examples: list,
    description: 'Known in this contract version: ' + list.join(', ') + '. A validator that does not know a value treats the record as unsupported (not eligible), not the file as invalid.' }),
  obj: (spec, properties) => ({ type: 'object', additionalProperties: false, required: spec.required.slice(), properties }),
};
const DEFS = {
  scope: S.obj(FIELDS.scope, {
    jurisdiction: S.vocab(ENUMS.jurisdiction),
    classification: S.nullable(S.text),
    period: S.nullable(S.obj(FIELDS.period, { from: S.date, to: S.nullable(S.date) })),
  }),
  range: S.obj(FIELDS.range, { min: S.num, max: S.num }),
  qualification: S.obj(FIELDS.qualification, { text: S.text, evidenceId: S.text }),
  binding: S.obj(FIELDS.binding, { field: S.enumOf(ENUMS.bindingField), token: S.text, evidenceId: S.text }),
  locator: Object.assign(S.obj(FIELDS.locator, {
    page: { type: ['string', 'number'] }, paragraph: { type: ['string', 'number'] }, table: S.text, row: S.text, selector: S.text,
  }), { minProperties: 1 }),
  evidence: S.obj(FIELDS.evidence, {
    evidenceId: S.text, role: S.enumOf(ENUMS.evidenceRole), url: S.url, publisher: S.text, title: S.text,
    quote: { type: 'string', minLength: 1, maxLength: 1000 }, locator: { $ref: '#/$defs/locator' }, asOf: S.date,
    tier: S.enumOf(ENUMS.tier), retrievedAt: S.time, contentSha256: S.sha, licence: S.text,
  }),
  derivation: S.obj(FIELDS.derivation, {
    formula: S.enumOf(ENUMS.formula), inputs: { type: 'array', minItems: 2, items: S.text }, rounding: { type: 'string', pattern: '^dp:[0-9]$' },
  }),
  failedBound: S.obj(FIELDS.failedBound, { kind: S.enumOf(ENUMS.boundKind), limit: S.num, observed: S.num }),
  override: S.obj(FIELDS.override, { reviewer: S.text, at: S.time, reason: S.text, failedBound: { $ref: '#/$defs/failedBound' } }),
  fact: S.obj(FIELDS.fact, {
    recordId: S.text, seriesId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_]{2,80}$' }, observationKey: S.text,
    revision: { type: 'integer', minimum: 1 }, lifecycle: S.enumOf(ENUMS.lifecycle), supersedes: S.nullable(S.text),
    kind: S.vocab(ENUMS.factKind), title: S.text, value: S.nullable(S.num), range: S.nullable({ $ref: '#/$defs/range' }),
    unitCode: S.vocab(ENUMS.unitCode), basisCode: S.vocab(ENUMS.basisCode), scope: { $ref: '#/$defs/scope' },
    qualifications: { type: 'array', items: { $ref: '#/$defs/qualification' } },
    valueBindings: { type: 'array', items: { $ref: '#/$defs/binding' } },
    observationDate: S.date, publishedAt: S.date, effectiveFrom: S.nullable(S.date), effectiveTo: S.nullable(S.date),
    evidence: { type: 'array', items: { $ref: '#/$defs/evidence' } },
    derivation: S.nullable({ $ref: '#/$defs/derivation' }), plausibilityOverride: S.nullable({ $ref: '#/$defs/override' }),
    captureMethod: S.enumOf(ENUMS.captureMethod),
  }),
  watchEvidence: S.obj(FIELDS.watchEvidence, { url: S.url, retrievedAt: S.time }),
  watch: S.obj(FIELDS.watch, {
    watchId: S.text, seriesId: { type: 'string', pattern: '^[a-z0-9][a-z0-9_]{2,80}$' }, state: S.enumOf(ENUMS.watchState),
    expectedBy: S.nullable(S.date), stateChangedAt: S.time, detail: S.text, evidence: S.nullable({ $ref: '#/$defs/watchEvidence' }),
  }),
  insightSource: S.obj(FIELDS.insightSource, { url: S.url, publisher: S.text }),
  tags: S.obj(FIELDS.tags, {
    streams: { type: 'array', items: S.enumOf(ENUMS.stream) }, anzsic: { type: 'array', items: { type: 'string', pattern: '^\\d{2,4}$' } },
  }),
  insight: S.obj(FIELDS.insight, {
    insightId: S.text, kind: S.enumOf(ENUMS.insightKind), title: S.text, text: S.text, aiAssisted: { type: 'boolean' },
    sources: { type: 'array', items: { $ref: '#/$defs/insightSource' } }, tags: S.nullable({ $ref: '#/$defs/tags' }), createdAt: S.time,
  }),
  manifestFile: S.obj(FIELDS.manifestFile, { name: S.text, sha256: S.sha, schema: S.text, recordCount: { type: 'integer', minimum: 0 } }),
  latestManifest: S.obj(FIELDS.latestManifest, { path: { type: 'string', pattern: '^releases/\\d{6}/manifest\\.json$' }, sha256: S.sha }),
};
// Which $defs each schema needs, so a schema file carries only what it uses.
const NEEDS = {
  facts: ['fact', 'scope', 'range', 'qualification', 'binding', 'locator', 'evidence', 'derivation', 'override', 'failedBound'],
  watch: ['watch', 'watchEvidence'],
  insights: ['insight', 'insightSource', 'tags'],
  manifest: ['manifestFile'],
  latest: ['latestManifest'],
};
function schemaFile(kind, title, root) {
  const $defs = {};
  NEEDS[kind].forEach((name) => { $defs[name] = DEFS[name]; });
  return Object.assign({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: SCHEMAS[kind], title }, root, { $defs });
}
function recordsFile(kind, def) {
  return schemaFile(kind, 'Daybook grounding ' + kind + ' file (complete snapshot)', S.obj(FIELDS.file, {
    schema: { const: SCHEMAS[kind] }, generatedAt: S.time, records: { type: 'array', items: { $ref: '#/$defs/' + def } },
  }));
}
const SCHEMA_FILES = {
  'facts.schema.json': recordsFile('facts', 'fact'),
  'watch.schema.json': recordsFile('watch', 'watch'),
  'insights.schema.json': recordsFile('insights', 'insight'),
  'manifest.schema.json': schemaFile('manifest', 'Daybook grounding release manifest', S.obj(FIELDS.manifest, {
    schema: { const: SCHEMAS.manifest }, sequence: { type: 'integer', minimum: 1 }, previousSequence: S.nullable({ type: 'integer', minimum: 1 }),
    generatedAt: S.time, producerCommit: S.text, files: { type: 'array', items: { $ref: '#/$defs/manifestFile' } },
  })),
  'latest.schema.json': schemaFile('latest', 'Daybook grounding latest-release pointer', S.obj(FIELDS.latest, {
    schema: { const: SCHEMAS.latest }, sequence: { type: 'integer', minimum: 1 }, generatedAt: S.time, manifest: { $ref: '#/$defs/latestManifest' },
  })),
};

// ── fixtures ─────────────────────────────────────────────────────────────────
const LICENCE = 'Fixture only: not a real source, not licensed for any use';
const PUBLISHER = 'Fixture Statistics Bureau (not a real source)';
const WAGE_PUBLISHER = 'Fixture Wage Office (not a real source)';
function evidence(id, role, page, quote, extra) {
  return Object.assign({
    evidenceId: id, role, url: 'https://example.org/fixture/' + page, publisher: PUBLISHER, title: 'Fixture page ' + page,
    quote, locator: { paragraph: 1 }, asOf: '2026-09-30', tier: 'primary', retrievedAt: '2026-10-01T04:15:00Z',
    contentSha256: sha256('fixture body: ' + page), licence: LICENCE,
  }, extra || {});
}
function fact(fields) {
  return Object.assign({
    supersedes: null, value: null, range: null, qualifications: [], valueBindings: [], effectiveFrom: null, effectiveTo: null,
    derivation: null, plausibilityOverride: null,
  }, fields, { recordId: fields.seriesId + '@' + fields.observationKey + '#r' + fields.revision });
}

const cpiAug = fact({
  seriesId: 'fixture_cpi_annual_change', observationKey: '2026-08', revision: 1, lifecycle: 'current', kind: 'index',
  title: 'Fixture CPI, annual change', value: 3.1, unitCode: 'pct', basisCode: 'annual_change',
  scope: { jurisdiction: 'AU', classification: 'All groups, weighted average of the eight capitals', period: { from: '2025-09-01', to: '2026-08-31' } },
  valueBindings: [{ field: 'value', token: '3.1', evidenceId: 'release' }],
  observationDate: '2026-08-31', publishedAt: '2026-09-30',
  evidence: [
    evidence('release', 'release', 'cpi-release', 'FIXTURE: The monthly CPI indicator rose 3.1% in the 12 months to August 2026.'),
    evidence('table', 'cross_check', 'cpi-table.csv', 'Aug-2026,139.2,3.1', { locator: { table: 'fixture-cpi', row: 'Aug-2026' } }),
  ],
  captureMethod: 'api',
});
const indexAug = fact({
  seriesId: 'fixture_cpi_index_level', observationKey: '2026-08', revision: 1, lifecycle: 'current', kind: 'index',
  title: 'Fixture CPI, index level', value: 139.2, unitCode: 'index_points', basisCode: 'index_level',
  scope: { jurisdiction: 'AU', classification: null, period: { from: '2026-08-01', to: '2026-08-31' } },
  valueBindings: [{ field: 'value', token: '139.2', evidenceId: 'table' }],
  observationDate: '2026-08-31', publishedAt: '2026-09-30',
  evidence: [evidence('table', 'table', 'cpi-table.csv', 'Aug-2026,139.2,3.1', { locator: { table: 'fixture-cpi', row: 'Aug-2026' } })],
  captureMethod: 'csv',
});
const indexAugLastYear = fact({
  seriesId: 'fixture_cpi_index_level', observationKey: '2025-08', revision: 1, lifecycle: 'current', kind: 'index',
  title: 'Fixture CPI, index level', value: 135, unitCode: 'index_points', basisCode: 'index_level',
  scope: { jurisdiction: 'AU', classification: null, period: { from: '2025-08-01', to: '2025-08-31' } },
  valueBindings: [{ field: 'value', token: '135.0', evidenceId: 'table' }],
  observationDate: '2025-08-31', publishedAt: '2025-09-24',
  evidence: [evidence('table', 'table', 'cpi-table.csv', 'Aug-2025,135.0,2.9', { locator: { table: 'fixture-cpi', row: 'Aug-2025' } })],
  captureMethod: 'csv',
});
const derivedChange = fact({
  seriesId: 'fixture_cpi_annual_change_derived', observationKey: '2026-08', revision: 1, lifecycle: 'current', kind: 'index',
  title: 'Fixture CPI, annual change derived from index levels', value: 3.1, unitCode: 'pct', basisCode: 'annual_change',
  scope: { jurisdiction: 'AU', classification: null, period: { from: '2025-08-01', to: '2026-08-31' } },
  observationDate: '2026-08-31', publishedAt: '2026-09-30', evidence: [],
  derivation: { formula: 'pct_change', inputs: [indexAug.recordId, indexAugLastYear.recordId], rounding: 'dp:1' },
  captureMethod: 'csv',
});
const awardR1 = fact({
  seriesId: 'fixture_award_cw1_ordinary', observationKey: '2026-07-01', revision: 1, lifecycle: 'current', kind: 'award_wage',
  title: 'Fixture award, CW1 ordinary hourly rate', value: 31.15, unitCode: 'aud_per_hour', basisCode: 'award_min_wage',
  scope: { jurisdiction: 'AU', classification: 'CW1, ordinary hours', period: { from: '2026-07-01', to: '2027-06-30' } },
  qualifications: [{ text: 'Minimum hourly rate for full-time and part-time employees, ordinary hours.', evidenceId: 'guide' }],
  valueBindings: [{ field: 'value', token: '31.15', evidenceId: 'guide' }],
  observationDate: '2026-07-01', publishedAt: '2026-06-20', effectiveFrom: '2026-07-01', effectiveTo: '2027-06-30',
  evidence: [evidence('guide', 'release', 'pay-guide.pdf', 'FIXTURE pay guide, Level CW1: ordinary hourly rate $31.15', {
    publisher: WAGE_PUBLISHER, locator: { page: 7, table: 'Adult employees' }, asOf: '2026-06-20',
  })],
  captureMethod: 'manual',
});
const storageRange = fact({
  seriesId: 'fixture_vehicle_storage_fee', observationKey: '2026-07-01', revision: 1, lifecycle: 'current', kind: 'regulated_fee',
  title: 'Fixture vehicle storage fee, per day', range: { min: 18.5, max: 34 }, unitCode: 'aud_per_day', basisCode: 'regulated_fee_max',
  scope: { jurisdiction: 'NSW', classification: 'Accident-damaged vehicle storage', period: { from: '2026-07-01', to: null } },
  valueBindings: [
    { field: 'range.min', token: '18.50', evidenceId: 'notice' },
    { field: 'range.max', token: '34.00', evidenceId: 'notice' },
  ],
  observationDate: '2026-07-01', publishedAt: '2026-06-25', effectiveFrom: '2026-07-01',
  evidence: [evidence('notice', 'release', 'storage-fees', 'FIXTURE: maximum storage fees range from $18.50 to $34.00 per day, depending on the vehicle.')],
  captureMethod: 'manual',
});

// Release 2: the award is corrected, and September's CPI replaces August's.
const awardR1Superseded = Object.assign({}, awardR1, { lifecycle: 'superseded' });
const awardR2 = fact(Object.assign({}, awardR1, {
  revision: 2, lifecycle: 'corrected', supersedes: awardR1.recordId, value: 31.25,
  valueBindings: [{ field: 'value', token: '31.25', evidenceId: 'guide' }],
  evidence: [
    evidence('guide', 'release', 'pay-guide-v2.pdf', 'FIXTURE pay guide (updated), Level CW1: ordinary hourly rate $31.25', {
      publisher: WAGE_PUBLISHER, locator: { page: 7, table: 'Adult employees' }, asOf: '2026-09-15',
    }),
    evidence('note', 'correction', 'pay-guide-note', 'FIXTURE: this guide replaces the version of 20 June, which misstated the CW1 rate.', {
      publisher: WAGE_PUBLISHER, asOf: '2026-09-15',
    }),
  ],
}));
const cpiAugSuperseded = Object.assign({}, cpiAug, { lifecycle: 'superseded' });
const cpiSep = fact(Object.assign({}, cpiAug, {
  observationKey: '2026-09', supersedes: cpiAug.recordId, value: 2.9,
  scope: Object.assign({}, cpiAug.scope, { period: { from: '2025-10-01', to: '2026-09-30' } }),
  valueBindings: [{ field: 'value', token: '2.9', evidenceId: 'release' }],
  observationDate: '2026-09-30', publishedAt: '2026-10-28',
  evidence: [
    evidence('release', 'release', 'cpi-release-sep', 'FIXTURE: The monthly CPI indicator rose 2.9% in the 12 months to September 2026.', { asOf: '2026-10-28' }),
    evidence('table', 'cross_check', 'cpi-table-sep.csv', 'Sep-2026,139.6,2.9', { locator: { table: 'fixture-cpi', row: 'Sep-2026' }, asOf: '2026-10-28' }),
  ],
}));

const watchPublished = {
  watchId: 'fixture_award_cw1_ordinary@2026-07-01', seriesId: 'fixture_award_cw1_ordinary', state: 'published', expectedBy: null,
  stateChangedAt: '2026-06-20T22:00:00Z', detail: 'Fixture pay guide for 2026-27 found.',
  evidence: { url: 'https://example.org/fixture/pay-guides', retrievedAt: '2026-06-20T22:00:00Z' },
};
const watchAwaiting = {
  watchId: 'fixture_benchmarks_release@2027', seriesId: 'fixture_benchmarks_release', state: 'awaiting_publication',
  expectedBy: '2027-03-31', stateChangedAt: '2026-10-01T04:15:00Z',
  detail: 'The fixture publisher states its next benchmarks update is due by 31 March 2027.',
  evidence: { url: 'https://example.org/fixture/benchmarks-schedule', retrievedAt: '2026-10-01T04:15:00Z' },
};
const insightQuestion = {
  insightId: 'fixture-question-1', kind: 'question', title: 'Fixture RFI idea',
  text: 'Ask whether the traffic-control invoice separates crew hours from equipment hire.', aiAssisted: true,
  sources: [{ url: 'https://example.org/fixture/story', publisher: PUBLISHER }],
  tags: { streams: ['tp_road'], anzsic: [] }, createdAt: '2026-10-01T04:15:00Z',
};

// A sample release, cut by the same function the publisher uses.
function release(sequence, generatedAt, facts, watch, insights) {
  const cut = cutRelease(sequence, { facts, watch, insights }, { generatedAt, producerCommit: 'fixture' });
  const out = {};
  Object.keys(cut.files).forEach((rel) => { out['published-' + pad6(sequence) + '/grounding/' + rel] = cut.files[rel]; });
  return out;
}

// Bounds a consumer or the producer would hold for the fixture series.
const FIXTURE_BOUNDS = {
  fixture_cpi_annual_change: { min: -5, max: 15, maxChange: 2 },
  fixture_award_cw1_ordinary: { min: 20, max: 60, maxChange: 5 },
};

function buildAll() {
  const out = {};
  Object.keys(SCHEMA_FILES).forEach((name) => { out['schema/' + name] = json(SCHEMA_FILES[name]); });
  Object.assign(out, release(1, '2026-10-01T04:15:00Z',
    [cpiAug, indexAug, indexAugLastYear, derivedChange, awardR1, storageRange], [watchPublished, watchAwaiting], [insightQuestion]));
  Object.assign(out, release(2, '2026-10-29T04:15:00Z',
    [cpiAugSuperseded, cpiSep, indexAug, indexAugLastYear, derivedChange, awardR1Superseded, awardR2, storageRange],
    [watchPublished, watchAwaiting], [insightQuestion]));
  out['fixtures/bounds.json'] = json(FIXTURE_BOUNDS);
  // Paths above are relative to grounding/ except the published trees, which live under fixtures/.
  const rooted = {};
  Object.keys(out).forEach((key) => { rooted[key.indexOf('published-') === 0 ? 'fixtures/' + key : key] = out[key]; });
  return rooted;
}

if (require.main === module) {
  const files = buildAll();
  const check = process.argv.indexOf('--check') >= 0;
  const stale = [];
  Object.keys(files).forEach((rel) => {
    const full = path.join(ROOT, rel);
    const current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
    if (current === files[rel]) return;
    if (check) { stale.push(rel); return; }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, files[rel]);
    console.log('wrote grounding/' + rel);
  });
  if (check && stale.length) { console.error('stale contract files: ' + stale.join(', ')); process.exit(1); }
  if (check) console.log('contract files up to date (' + Object.keys(files).length + ')');
}

module.exports = { buildAll, DEFS, SCHEMA_FILES, FIXTURE_BOUNDS };
