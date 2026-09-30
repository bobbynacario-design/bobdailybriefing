'use strict';
// Daybook grounding contract v1: the validator and the import planner.
//
// docs/grounding-roadmap.md, section 5, is the specification. This file is plain
// CommonJS with no dependencies, so BI-Assessor and RiskM8 can COPY it (never
// import it across repos). Keep it that way: the only require is node:crypto,
// and only when no hash function is passed in.
//
// Nothing here trusts what the producer says about trust. The four trust
// attributes (sourceLinked, factVerified, crossChecked, plausible) are computed
// from each record and returned with the verdict; a record that carries them
// itself is refused.
//
// v1 facts are numeric: every fact has a value or a range. A non-numeric change
// (a determination published, a guide updated) is a watch state, not a fact.
//
// Plausibility is the one judgement that depends on who is validating: it uses
// the evaluator's own bounds (Daybook's registry, or a consumer's). So it only
// ever decides one record's eligibility for that evaluator, never whether the
// release is readable. Everything else is the same for every evaluator, and any
// failure there rejects the release, with one exception: vocabulary.
//
// Vocabulary grows. A later contract version may add a unit, kind, basis or
// jurisdiction (H-8 added aud_cents_per_litre). A record whose value there is
// well formed but unknown to this copy of the validator is "unsupported": it is
// not eligible and the import planner skips it, but the release stays readable,
// so a consumer that has not re-copied still imports everything else. The
// producer refuses to publish an unsupported record, so a typo never gets out.

const SCHEMAS = Object.freeze({
  latest: 'daybook-grounding-latest/1',
  manifest: 'daybook-grounding-manifest/1',
  facts: 'daybook-grounding-facts/1',
  watch: 'daybook-grounding-watch/1',
  insights: 'daybook-grounding-insights/1',
});
const FILE_NAMES = Object.freeze({ facts: 'facts.json', watch: 'watch.json', insights: 'insights.json' });

const ENUMS = Object.freeze({
  factKind: ['index', 'rate', 'regulated_fee', 'award_wage', 'regulatory'],
  lifecycle: ['current', 'corrected', 'superseded', 'withdrawn'],
  unitCode: ['pct', 'pct_pa', 'aud_per_hour', 'aud_per_day', 'aud_per_item', 'index_points', 'aud_cents_per_litre'],
  basisCode: ['annual_change', 'index_level', 'policy_rate_target', 'statutory_rate', 'award_min_wage', 'regulated_fee_max', 'market_rate'],
  jurisdiction: ['AU', 'NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT', 'PH'],
  evidenceRole: ['release', 'table', 'cross_check', 'correction'],
  tier: ['primary', 'secondary'],
  captureMethod: ['api', 'csv', 'rss', 'page', 'manual'],
  watchState: ['awaiting_publication', 'published', 'overdue', 'stale', 'blocked', 'withdrawn', 'conflict'],
  insightKind: ['event', 'emerging_risk', 'question', 'idea'],
  stream: ['tp_utility', 'tp_road', 'hv_loi', 'sme_bi', 'risk_review'],
  formula: ['pct_change', 'difference', 'sum', 'ratio_pct'],
  boundKind: ['absolute', 'change'],
  bindingField: ['value', 'range.min', 'range.max'],
});

// Every field a record may carry. Anything else is refused: that is how a
// private field (an account, a note, a client name) or a producer-written trust
// flag is kept out of the public files.
const FIELDS = Object.freeze({
  latest: { allowed: ['schema', 'sequence', 'generatedAt', 'manifest'], required: ['schema', 'sequence', 'generatedAt', 'manifest'] },
  latestManifest: { allowed: ['path', 'sha256'], required: ['path', 'sha256'] },
  manifest: { allowed: ['schema', 'sequence', 'previousSequence', 'generatedAt', 'producerCommit', 'files'], required: ['schema', 'sequence', 'previousSequence', 'generatedAt', 'producerCommit', 'files'] },
  manifestFile: { allowed: ['name', 'sha256', 'schema', 'recordCount'], required: ['name', 'sha256', 'schema', 'recordCount'] },
  file: { allowed: ['schema', 'generatedAt', 'records'], required: ['schema', 'generatedAt', 'records'] },
  fact: {
    allowed: ['recordId', 'seriesId', 'observationKey', 'revision', 'lifecycle', 'supersedes', 'kind', 'title', 'value', 'range',
      'unitCode', 'basisCode', 'scope', 'qualifications', 'valueBindings', 'observationDate', 'publishedAt', 'effectiveFrom',
      'effectiveTo', 'evidence', 'derivation', 'plausibilityOverride', 'captureMethod'],
    required: ['recordId', 'seriesId', 'observationKey', 'revision', 'lifecycle', 'kind', 'title', 'unitCode', 'basisCode',
      'scope', 'observationDate', 'publishedAt', 'evidence', 'captureMethod'],
  },
  scope: { allowed: ['jurisdiction', 'classification', 'period'], required: ['jurisdiction'] },
  period: { allowed: ['from', 'to'], required: ['from'] },
  range: { allowed: ['min', 'max'], required: ['min', 'max'] },
  qualification: { allowed: ['text', 'evidenceId'], required: ['text', 'evidenceId'] },
  binding: { allowed: ['field', 'token', 'evidenceId'], required: ['field', 'token', 'evidenceId'] },
  evidence: {
    allowed: ['evidenceId', 'role', 'url', 'publisher', 'title', 'quote', 'locator', 'asOf', 'tier', 'retrievedAt', 'contentSha256', 'licence'],
    required: ['evidenceId', 'role', 'url', 'publisher', 'title', 'quote', 'locator', 'asOf', 'tier', 'retrievedAt', 'contentSha256', 'licence'],
  },
  locator: { allowed: ['page', 'paragraph', 'table', 'row', 'selector'], required: [] },
  derivation: { allowed: ['formula', 'inputs', 'rounding'], required: ['formula', 'inputs', 'rounding'] },
  override: { allowed: ['reviewer', 'at', 'reason', 'failedBound'], required: ['reviewer', 'at', 'reason', 'failedBound'] },
  failedBound: { allowed: ['kind', 'limit', 'observed'], required: ['kind', 'limit', 'observed'] },
  watch: {
    allowed: ['watchId', 'seriesId', 'state', 'expectedBy', 'stateChangedAt', 'detail', 'evidence'],
    required: ['watchId', 'seriesId', 'state', 'stateChangedAt', 'detail'],
  },
  watchEvidence: { allowed: ['url', 'retrievedAt'], required: ['url', 'retrievedAt'] },
  insight: {
    allowed: ['insightId', 'kind', 'title', 'text', 'aiAssisted', 'sources', 'tags', 'createdAt'],
    required: ['insightId', 'kind', 'title', 'text', 'aiAssisted', 'sources', 'createdAt'],
  },
  insightSource: { allowed: ['url', 'publisher'], required: ['url', 'publisher'] },
  tags: { allowed: ['streams', 'anzsic'], required: [] },
});

// ── small checks ─────────────────────────────────────────────────────────────
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= (max || 2000);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isSha256 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
function isIsoDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function isIsoTime(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));
}
function isHttp(v) {
  if (typeof v !== 'string') return false;
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { return false; }
}
function checkShape(obj, spec, where, errors) {
  if (!isObj(obj)) { errors.push(where + ': must be an object'); return false; }
  Object.keys(obj).forEach((key) => { if (spec.allowed.indexOf(key) < 0) errors.push(where + ': field not allowed: ' + key); });
  spec.required.forEach((key) => { if (!(key in obj)) errors.push(where + ': missing ' + key); });
  return true;
}
function checkEnum(value, list, where, errors) {
  if (list.indexOf(value) < 0) errors.push(where + ': must be one of ' + list.join(', '));
}
// For the vocabulary fields (see the header): a well-formed value this version
// does not know is noted as unsupported, not an error. Anything else is an error.
const VOCAB_TOKEN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
function checkVocab(value, list, where, errors, unsupported) {
  if (list.indexOf(value) >= 0) return;
  const field = where.replace(/^facts\[\d+\][^.]*\./, '');
  if (typeof value === 'string' && VOCAB_TOKEN.test(value)) unsupported.push(where + ': ' + field + ' "' + value + '" is not in this contract version');
  else errors.push(where + ': must be one of ' + list.join(', '));
}

// ── numbers ──────────────────────────────────────────────────────────────────
// A minus is the ASCII hyphen or the typographic minus sign (U+2212), which
// statistical releases often print.
const isMinus = (ch) => ch === '-' || ch === '−';
// Where a minus can act as a sign: at the start, after a space, or after an
// opening bracket or separator ("(-0.3)", "rate: -0.3", "Aug,-0.3"). Anywhere
// else it joins two things: "45%-65%" is a range, "Aug-2026" and "2020-21" are
// labels, so the number after it is not negative.
const signContext = (ch) => ch === '' || /\s/.test(ch) || '([{=:;,/'.indexOf(ch) >= 0;

// "1,250.50" -> "1250.5", "3.60" -> "3.6", "-0.30" -> "-0.3". Null for anything
// that is not a plain decimal number, so "1.25k" or "5m" never normalise.
function normaliseNumberText(text) {
  if (typeof text !== 'string') return null;
  const m = /^([-−])?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const whole = m[2].replace(/,/g, '').replace(/^0+(?=\d)/, '');
  const frac = (m[3] || '').replace(/0+$/, '');
  const out = whole + (frac ? '.' + frac : '');
  if (out === '0') return '0';
  return (m[1] ? '-' : '') + out;
}
function canonicalNumber(n) {
  if (!isNum(n)) return null;
  const s = String(n);
  return /e/i.test(s) ? null : normaliseNumberText(s);
}
// Does the token at this position stand alone as a number? It must not touch a
// digit or a letter ("15", "1.25k"), continue a decimal ("1.5"), continue or
// start a digit group ("1,250"), or lose a minus sign that belongs to it.
function standsAloneAt(quote, at, token) {
  const before = at > 0 ? quote[at - 1] : '';
  const beforePrev = at > 1 ? quote[at - 2] : '';
  const end = at + token.length;
  const after = quote[end] || '';
  const signed = isMinus(token[0]);
  const groups = token.replace(/^[-−]/, '').split('.')[0].split(',');
  if (/[0-9A-Za-z]/.test(before)) return false;
  // A signed token's minus must really be a sign: "-65" is not in "45%-65%".
  if (signed && !signContext(before)) return false;
  // A minus sign that belongs to the number ("-0.3") but not to the token. A
  // hyphen joining a range or a label ("45%-65%", "Aug-2026") is not a sign.
  if (!signed && isMinus(before) && signContext(beforePrev)) return false;
  if (before === '.' && /[0-9]/.test(beforePrev)) return false; // the tail of a decimal ("5" in "1.5")
  if (before === ',' && /[0-9]/.test(beforePrev) && /^\d{3}$/.test(groups[0])) {
    // The tail of a digit group ("250" in "1,250"), but only when the digits
    // before the comma could head a group: one to three of them. "2026,139.2"
    // in a data row is two numbers.
    let i = at - 2, run = 0;
    while (i >= 0 && /[0-9]/.test(quote[i])) { run++; i--; }
    if (run <= 3) return false;
  }
  if (/[0-9A-Za-z]/.test(after)) return false; // "15", "1.25k", "5m"
  if (after === '.' && /[0-9]/.test(quote[end + 1] || '')) return false; // "3" in "3.6"
  // The head of a digit group ("1" in "1,250"): a comma, then exactly three digits.
  if (after === ',' && token.indexOf('.') < 0 && /^\d{1,3}$/.test(groups[0]) && /^,\d{3}(?![0-9])/.test(quote.slice(end))) return false;
  return true;
}
function tokenStandsAlone(quote, token) {
  if (typeof quote !== 'string' || typeof token !== 'string' || !token) return false;
  for (let at = quote.indexOf(token); at >= 0; at = quote.indexOf(token, at + 1)) {
    if (standsAloneAt(quote, at, token)) return true;
  }
  return false;
}
// Every stand-alone number in a quote, normalised. Used for cross-checks, where
// a data row may carry several numbers and agreement means one of them matches.
function numbersInQuote(quote) {
  const out = [];
  if (typeof quote !== 'string') return out;
  const re = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(quote))) {
    let token = m[0], at = m.index;
    const before = at > 0 ? quote[at - 1] : '', beforePrev = at > 1 ? quote[at - 2] : '';
    if (isMinus(before) && signContext(beforePrev)) { token = before + token; at -= 1; }
    if (standsAloneAt(quote, at, token)) {
      const n = normaliseNumberText(token);
      if (n !== null) out.push(n);
    }
  }
  return out;
}

// ── derivations ──────────────────────────────────────────────────────────────
function roundTo(value, rounding) {
  const m = /^dp:(\d)$/.exec(String(rounding || ''));
  if (!m) return null;
  return Number(value.toFixed(Number(m[1])));
}
function applyFormula(formula, inputs) {
  const v = inputs.map((r) => r.value);
  if (formula === 'pct_change' && v.length === 2 && v[1] !== 0) return (v[0] / v[1] - 1) * 100;
  if (formula === 'difference' && v.length === 2) return v[0] - v[1];
  if (formula === 'ratio_pct' && v.length === 2 && v[1] !== 0) return (v[0] / v[1]) * 100;
  if (formula === 'sum' && v.length >= 2) return v.reduce((a, b) => a + b, 0);
  return null;
}

// ── fact records ─────────────────────────────────────────────────────────────
// Structural checks on one fact, without the rest of the snapshot. Vocabulary
// this version does not know goes to `unsupported` (when given), not errors.
function checkFactShape(rec, where, unsupported) {
  const errors = [];
  unsupported = unsupported || [];
  if (!checkShape(rec, FIELDS.fact, where, errors)) return errors;
  if (!/^[a-z0-9][a-z0-9_]{2,80}$/.test(String(rec.seriesId))) errors.push(where + ': seriesId must be lower_snake_case');
  if (!isText(rec.observationKey, 40) || /[@#\s]/.test(rec.observationKey)) errors.push(where + ': observationKey is invalid');
  if (!Number.isInteger(rec.revision) || rec.revision < 1) errors.push(where + ': revision must be an integer from 1');
  if (rec.recordId !== rec.seriesId + '@' + rec.observationKey + '#r' + rec.revision) errors.push(where + ': recordId must be <seriesId>@<observationKey>#r<revision>');
  checkEnum(rec.lifecycle, ENUMS.lifecycle, where + '.lifecycle', errors);
  checkVocab(rec.kind, ENUMS.factKind, where + '.kind', errors, unsupported);
  checkVocab(rec.unitCode, ENUMS.unitCode, where + '.unitCode', errors, unsupported);
  checkVocab(rec.basisCode, ENUMS.basisCode, where + '.basisCode', errors, unsupported);
  checkEnum(rec.captureMethod, ENUMS.captureMethod, where + '.captureMethod', errors);
  if (!isText(rec.title, 240)) errors.push(where + ': title is required');
  if (rec.supersedes != null && typeof rec.supersedes !== 'string') errors.push(where + ': supersedes must be a recordId or null');

  const hasValue = rec.value != null, hasRange = rec.range != null;
  if (hasValue === hasRange) errors.push(where + ': exactly one of value or range is required');
  if (hasValue && !isNum(rec.value)) errors.push(where + ': value must be a finite number');
  if (hasValue && canonicalNumber(rec.value) === null) errors.push(where + ': value cannot be written without an exponent');
  if (hasRange && checkShape(rec.range, FIELDS.range, where + '.range', errors)) {
    if (!isNum(rec.range.min) || !isNum(rec.range.max) || rec.range.min > rec.range.max) errors.push(where + ': range needs finite min <= max');
  }

  if (checkShape(rec.scope, FIELDS.scope, where + '.scope', errors)) {
    checkVocab(rec.scope.jurisdiction, ENUMS.jurisdiction, where + '.scope.jurisdiction', errors, unsupported);
    if (rec.scope.classification != null && !isText(rec.scope.classification, 160)) errors.push(where + ': scope.classification must be text or null');
    if (rec.scope.period != null && checkShape(rec.scope.period, FIELDS.period, where + '.scope.period', errors)) {
      if (!isIsoDate(rec.scope.period.from)) errors.push(where + ': scope.period.from must be YYYY-MM-DD');
      if (rec.scope.period.to != null && !isIsoDate(rec.scope.period.to)) errors.push(where + ': scope.period.to must be YYYY-MM-DD or null');
    }
  }
  ['observationDate', 'publishedAt'].forEach((k) => { if (!isIsoDate(rec[k])) errors.push(where + ': ' + k + ' must be YYYY-MM-DD'); });
  ['effectiveFrom', 'effectiveTo'].forEach((k) => { if (rec[k] != null && !isIsoDate(rec[k])) errors.push(where + ': ' + k + ' must be YYYY-MM-DD or null'); });
  if (isIsoDate(rec.effectiveFrom) && isIsoDate(rec.effectiveTo) && rec.effectiveTo < rec.effectiveFrom) errors.push(where + ': effectiveTo is before effectiveFrom');

  const evidence = Array.isArray(rec.evidence) ? rec.evidence : [];
  if (!Array.isArray(rec.evidence)) errors.push(where + ': evidence must be an array');
  const ids = {};
  evidence.forEach((ev, i) => {
    const at = where + '.evidence[' + i + ']';
    if (!checkShape(ev, FIELDS.evidence, at, errors)) return;
    if (!isText(ev.evidenceId, 60)) errors.push(at + ': evidenceId is required');
    else if (ids[ev.evidenceId]) errors.push(at + ': duplicate evidenceId ' + ev.evidenceId);
    ids[ev.evidenceId] = ev;
    checkEnum(ev.role, ENUMS.evidenceRole, at + '.role', errors);
    checkEnum(ev.tier, ENUMS.tier, at + '.tier', errors);
    if (!isHttp(ev.url)) errors.push(at + ': url must be http(s)');
    if (!isText(ev.publisher, 160) || !isText(ev.title, 240)) errors.push(at + ': publisher and title are required');
    if (!isText(ev.quote, 1000)) errors.push(at + ': quote is required (at most 1000 characters)');
    if (!isIsoDate(ev.asOf)) errors.push(at + ': asOf must be YYYY-MM-DD');
    if (!isIsoTime(ev.retrievedAt)) errors.push(at + ': retrievedAt must be an ISO timestamp');
    if (!isSha256(ev.contentSha256)) errors.push(at + ': contentSha256 must be 64 lowercase hex characters');
    if (!isText(ev.licence, 300)) errors.push(at + ': licence is required');
    if (checkShape(ev.locator, FIELDS.locator, at + '.locator', errors)) {
      const keys = Object.keys(ev.locator).filter((k) => ev.locator[k] != null && String(ev.locator[k]).trim());
      if (!keys.length) errors.push(at + ': locator needs at least one of page, paragraph, table, row, selector');
    }
  });

  (Array.isArray(rec.qualifications) ? rec.qualifications : rec.qualifications == null ? [] : (errors.push(where + ': qualifications must be an array'), []))
    .forEach((q, i) => {
      const at = where + '.qualifications[' + i + ']';
      if (!checkShape(q, FIELDS.qualification, at, errors)) return;
      if (!isText(q.text, 500)) errors.push(at + ': text is required');
      if (!ids[q.evidenceId]) errors.push(at + ': evidenceId ' + q.evidenceId + ' is not in this record');
    });

  if (rec.valueBindings != null && !Array.isArray(rec.valueBindings)) errors.push(where + ': valueBindings must be an array');
  (Array.isArray(rec.valueBindings) ? rec.valueBindings : []).forEach((b, i) => {
    const at = where + '.valueBindings[' + i + ']';
    if (!checkShape(b, FIELDS.binding, at, errors)) return;
    checkEnum(b.field, ENUMS.bindingField, at + '.field', errors);
    if (!isText(b.token, 40)) errors.push(at + ': token is required');
  });

  if (rec.derivation != null && checkShape(rec.derivation, FIELDS.derivation, where + '.derivation', errors)) {
    checkEnum(rec.derivation.formula, ENUMS.formula, where + '.derivation.formula', errors);
    if (!Array.isArray(rec.derivation.inputs) || rec.derivation.inputs.length < 2) errors.push(where + ': derivation.inputs needs at least two recordIds');
    if (roundTo(1, rec.derivation.rounding) === null) errors.push(where + ': derivation.rounding must be dp:<0-9>');
    if (hasRange) errors.push(where + ': a derived fact carries a value, not a range');
    if (Array.isArray(rec.valueBindings) && rec.valueBindings.length) errors.push(where + ': a derived fact is verified through its inputs, not quote bindings');
  }
  if (rec.plausibilityOverride != null && checkShape(rec.plausibilityOverride, FIELDS.override, where + '.plausibilityOverride', errors)) {
    const o = rec.plausibilityOverride;
    if (!isText(o.reviewer, 40) || !isText(o.reason, 500)) errors.push(where + ': plausibilityOverride needs a reviewer and a reason');
    if (!isIsoTime(o.at)) errors.push(where + ': plausibilityOverride.at must be an ISO timestamp');
    if (checkShape(o.failedBound, FIELDS.failedBound, where + '.plausibilityOverride.failedBound', errors)) {
      checkEnum(o.failedBound.kind, ENUMS.boundKind, where + '.plausibilityOverride.failedBound.kind', errors);
      if (!isNum(o.failedBound.limit) || !isNum(o.failedBound.observed)) errors.push(where + ': failedBound needs numeric limit and observed');
    }
  }
  return errors;
}

// The published values a record must bind: "value", or both range ends.
function boundFields(rec) {
  if (rec.value != null) return [['value', rec.value]];
  if (rec.range != null) return [['range.min', rec.range.min], ['range.max', rec.range.max]];
  return [];
}

// Quote bindings: every published value is tied to a stand-alone token in the
// quote of a release or table evidence item, and the token means that value.
function checkBindings(rec, where) {
  const errors = [];
  const byId = {};
  (rec.evidence || []).forEach((ev) => { if (isObj(ev)) byId[ev.evidenceId] = ev; });
  const bindings = Array.isArray(rec.valueBindings) ? rec.valueBindings : [];
  if (rec.derivation != null) return errors; // checked in checkFactShape
  boundFields(rec).forEach(([field, value]) => {
    const mine = bindings.filter((b) => isObj(b) && b.field === field);
    if (!mine.length) { errors.push(where + ': ' + field + ' has no value binding'); return; }
    mine.forEach((b) => {
      const ev = byId[b.evidenceId];
      if (!ev) { errors.push(where + ': binding for ' + field + ' names unknown evidence ' + b.evidenceId); return; }
      if (ev.role !== 'release' && ev.role !== 'table') errors.push(where + ': binding for ' + field + ' must point at release or table evidence');
      if (normaliseNumberText(b.token) === null) { errors.push(where + ': token "' + b.token + '" is not a plain number'); return; }
      if (normaliseNumberText(b.token) !== canonicalNumber(value)) errors.push(where + ': token "' + b.token + '" does not mean ' + field + ' ' + value);
      if (!tokenStandsAlone(ev.quote, b.token)) errors.push(where + ': token "' + b.token + '" does not stand alone in the quote of ' + b.evidenceId);
    });
  });
  bindings.forEach((b) => {
    if (isObj(b) && !boundFields(rec).some(([f]) => f === b.field)) errors.push(where + ': binding for ' + b.field + ' has no matching value');
  });
  return errors;
}

// A cross_check item agrees when its quote carries the same value(s).
function crossCheckVerdict(rec) {
  const checks = (rec.evidence || []).filter((ev) => isObj(ev) && ev.role === 'cross_check');
  if (!checks.length) return { present: false, agrees: false };
  const wanted = boundFields(rec).map(([, v]) => canonicalNumber(v));
  const agrees = checks.every((ev) => {
    const found = numbersInQuote(ev.quote);
    return wanted.every((w) => found.indexOf(w) >= 0);
  });
  return { present: true, agrees };
}

function sourceLinkedEvidence(rec) {
  const ev = Array.isArray(rec.evidence) ? rec.evidence : [];
  return ev.length > 0 && ev.every((e) => isObj(e) && isHttp(e.url) && isIsoTime(e.retrievedAt) && isSha256(e.contentSha256));
}

// Plausibility against the consumer's (or producer's) bounds for the series:
// { min, max, maxChange }. Null when no bounds are known.
function plausibilityVerdict(rec, bounds, previous) {
  if (!bounds) return { evaluated: false, breaches: [] };
  const breaches = [];
  boundFields(rec).forEach(([, v]) => {
    if (isNum(bounds.min) && v < bounds.min) breaches.push({ kind: 'absolute', limit: bounds.min, observed: v });
    if (isNum(bounds.max) && v > bounds.max) breaches.push({ kind: 'absolute', limit: bounds.max, observed: v });
  });
  if (previous && isNum(bounds.maxChange) && isNum(rec.value) && isNum(previous.value)) {
    const change = Math.abs(rec.value - previous.value);
    if (change > bounds.maxChange) breaches.push({ kind: 'change', limit: bounds.maxChange, observed: Number(change.toFixed(10)) });
  }
  return { evaluated: true, breaches };
}

function sameBound(a, b) {
  return isObj(a) && isObj(b) && a.kind === b.kind && a.limit === b.limit && a.observed === b.observed;
}

// Validate a facts file: every record, then the relations between them.
//   opts.bounds: { [seriesId]: { min, max, maxChange } }
// Returns { ok, errors, results: [{ recordId, record, ok, errors, unsupported, checks, eligible, historical, overrideVerdict }] }.
// unsupported lists vocabulary this version does not know (see the header): such a
// record is never eligible, and it does not make the file invalid.
//
// overrideVerdict says what these bounds make of a record's plausibilityOverride
// (null when it has none):
//   'cleared'        a bound was breached and the override records exactly it
//   'unmatched'      a bound was breached that the override does not record:
//                    plausible is false, so the record is not eligible
//   'not_needed'     nothing breached these bounds (plausible is true)
//   'not_evaluated'  no bounds are known for the series (plausible is null)
// None of these is an error. A consumer's bounds may differ from Daybook's, or
// be absent for a series it does not use, and facts.json keeps history, so an
// error here would make every later release unreadable to that consumer. The
// producer refuses to publish a new override that is not 'cleared' under its
// own bounds (grounding/producer.js).
function validateFactsFile(file, opts) {
  opts = opts || {};
  const errors = [];
  if (!checkShape(file, FIELDS.file, 'facts', errors)) return { ok: false, errors, results: [] };
  if (file.schema !== SCHEMAS.facts) errors.push('facts: schema must be ' + SCHEMAS.facts);
  if (!isIsoTime(file.generatedAt)) errors.push('facts: generatedAt must be an ISO timestamp');
  if (!Array.isArray(file.records)) { errors.push('facts: records must be an array'); return { ok: false, errors, results: [] }; }

  const byId = {};
  const results = file.records.map((rec, i) => {
    const where = 'facts[' + i + ']' + (isObj(rec) && rec.recordId ? ' ' + rec.recordId : '');
    const unsupported = [];
    const shapeErrors = checkFactShape(rec, where, unsupported);
    const result = { recordId: isObj(rec) ? rec.recordId : null, record: rec, where, errors: shapeErrors, unsupported };
    if (isObj(rec) && typeof rec.recordId === 'string') {
      if (byId[rec.recordId]) errors.push('facts: duplicate recordId ' + rec.recordId);
      byId[rec.recordId] = result;
    }
    return result;
  });

  // One live revision per observation.
  const live = {};
  results.forEach((r) => {
    const rec = r.record;
    if (!isObj(rec) || (rec.lifecycle !== 'current' && rec.lifecycle !== 'corrected')) return;
    const key = rec.seriesId + '@' + rec.observationKey;
    if (live[key]) errors.push('facts: more than one current revision of ' + key);
    live[key] = true;
  });

  const verifying = {};
  function verified(r) {
    // Fact-verified: quote-bound (published) or input-bound (derived).
    if (r.factVerified !== undefined) return r.factVerified;
    if (verifying[r.recordId]) return false; // a derivation cycle
    verifying[r.recordId] = true;
    const rec = r.record;
    let ok = r.errors.length === 0;
    if (ok && rec.derivation) {
      const inputs = rec.derivation.inputs.map((id) => byId[id]);
      if (inputs.some((x) => !x)) { r.errors.push(r.where + ': derivation input is not in this snapshot'); ok = false; }
      else if (inputs.some((x) => x.record.value == null)) { r.errors.push(r.where + ': derivation inputs must carry values, not ranges'); ok = false; }
      else if (!inputs.every(verified)) { r.errors.push(r.where + ': derivation inputs must be fact-verified'); ok = false; }
      else {
        const raw = applyFormula(rec.derivation.formula, inputs.map((x) => x.record));
        const expected = raw === null ? null : roundTo(raw, rec.derivation.rounding);
        if (expected === null || expected !== rec.value) { r.errors.push(r.where + ': derived value ' + rec.value + ' does not equal ' + rec.derivation.formula + ' of its inputs (' + expected + ')'); ok = false; }
      }
    } else if (ok) {
      const bindingErrors = checkBindings(rec, r.where);
      if (bindingErrors.length) { r.errors.push(...bindingErrors); ok = false; }
      if (!(rec.evidence || []).some((ev) => ev.role === 'release' || ev.role === 'table')) { r.errors.push(r.where + ': needs release or table evidence'); ok = false; }
    }
    r.factVerified = ok;
    return ok;
  }

  results.forEach((r) => {
    const rec = r.record;
    if (!isObj(rec) || r.errors.length) {
      r.checks = { sourceLinked: false, factVerified: false, crossChecked: false, plausible: null };
      r.overrideVerdict = null;
      return;
    }
    // Supersession: same series; a correction is the next revision of the same
    // observation and the record it replaces must be marked superseded.
    let previousObservation = null;
    if (rec.supersedes != null) {
      const prior = byId[rec.supersedes];
      if (!prior) r.errors.push(r.where + ': supersedes ' + rec.supersedes + ', which is not in this snapshot');
      else if (!isObj(prior.record) || prior.record.seriesId !== rec.seriesId) r.errors.push(r.where + ': supersedes a record of another series');
      else {
        if (prior.record.lifecycle !== 'superseded') r.errors.push(r.where + ': the record it supersedes must be marked superseded');
        if (prior.record.observationKey === rec.observationKey) {
          if (prior.record.revision !== rec.revision - 1) r.errors.push(r.where + ': a correction must supersede the previous revision');
          if (rec.lifecycle === 'current') r.errors.push(r.where + ': a new revision of the same observation is "corrected", not "current"');
        } else {
          previousObservation = prior.record;
        }
      }
    } else if (rec.revision > 1) {
      r.errors.push(r.where + ': revision ' + rec.revision + ' must name the revision it supersedes');
    }
    if (rec.lifecycle === 'corrected' && (rec.revision < 2 || rec.supersedes == null)) r.errors.push(r.where + ': "corrected" needs revision 2 or more and supersedes');

    const factVerified = r.errors.length === 0 && verified(r);
    const cross = rec.derivation ? { present: false, agrees: false } : crossCheckVerdict(rec);
    if (cross.present && !cross.agrees) r.errors.push(r.where + ': cross-check conflict: the cross_check evidence does not carry the same value');

    const plaus = plausibilityVerdict(rec, (opts.bounds || {})[rec.seriesId], previousObservation);
    let plausible = plaus.evaluated ? plaus.breaches.length === 0 : null;
    r.overrideVerdict = null;
    if (rec.plausibilityOverride) {
      if (!plaus.evaluated) r.overrideVerdict = 'not_evaluated';
      else if (!plaus.breaches.length) r.overrideVerdict = 'not_needed';
      else if (plaus.breaches.every((b) => sameBound(b, rec.plausibilityOverride.failedBound))) { r.overrideVerdict = 'cleared'; plausible = true; }
      else r.overrideVerdict = 'unmatched';
    }
    r.checks = {
      sourceLinked: rec.derivation
        ? rec.derivation.inputs.every((id) => byId[id] && isObj(byId[id].record) && sourceLinkedEvidence(byId[id].record))
        : sourceLinkedEvidence(rec),
      factVerified: factVerified && r.errors.length === 0,
      crossChecked: cross.present && cross.agrees,
      plausible,
    };
  });

  results.forEach((r) => {
    r.ok = r.errors.length === 0;
    const rec = r.record;
    r.historical = isObj(rec) && (rec.lifecycle === 'superseded' || rec.lifecycle === 'withdrawn');
    r.eligible = r.ok && !r.unsupported.length && !r.historical && r.checks.factVerified && r.checks.plausible !== false;
    delete r.factVerified;
  });
  const recordErrors = results.reduce((n, r) => n + r.errors.length, 0);
  return { ok: errors.length === 0 && recordErrors === 0, errors, results };
}

// ── watch and insight records ────────────────────────────────────────────────
function validateWatchFile(file) {
  const errors = [];
  if (!checkShape(file, FIELDS.file, 'watch', errors)) return { ok: false, errors, results: [] };
  if (file.schema !== SCHEMAS.watch) errors.push('watch: schema must be ' + SCHEMAS.watch);
  if (!isIsoTime(file.generatedAt)) errors.push('watch: generatedAt must be an ISO timestamp');
  const records = Array.isArray(file.records) ? file.records : (errors.push('watch: records must be an array'), []);
  const seen = {};
  const results = records.map((rec, i) => {
    const where = 'watch[' + i + ']';
    const e = [];
    if (checkShape(rec, FIELDS.watch, where, e)) {
      if (!/^[a-z0-9][a-z0-9_]{2,80}$/.test(String(rec.seriesId))) e.push(where + ': seriesId must be lower_snake_case');
      if (typeof rec.watchId !== 'string' || rec.watchId.indexOf(rec.seriesId + '@') !== 0 || rec.watchId.length <= rec.seriesId.length + 1) e.push(where + ': watchId must be <seriesId>@<observationKey>');
      else if (seen[rec.watchId]) e.push(where + ': duplicate watchId ' + rec.watchId);
      seen[rec.watchId] = true;
      checkEnum(rec.state, ENUMS.watchState, where + '.state', e);
      if (!isIsoTime(rec.stateChangedAt)) e.push(where + ': stateChangedAt must be an ISO timestamp');
      if (!isText(rec.detail, 500)) e.push(where + ': detail is required');
      if (rec.evidence != null && checkShape(rec.evidence, FIELDS.watchEvidence, where + '.evidence', e)) {
        if (!isHttp(rec.evidence.url)) e.push(where + ': evidence.url must be http(s)');
        if (!isIsoTime(rec.evidence.retrievedAt)) e.push(where + ': evidence.retrievedAt must be an ISO timestamp');
      }
      // An expected date only when a source states it: it needs the page it came from.
      if (rec.expectedBy != null) {
        if (!isIsoDate(rec.expectedBy)) e.push(where + ': expectedBy must be YYYY-MM-DD or null');
        if (rec.evidence == null) e.push(where + ': expectedBy needs the evidence page that states it');
      }
      if (rec.state === 'overdue' && rec.expectedBy == null) e.push(where + ': "overdue" needs a stated expectedBy');
    }
    return { watchId: isObj(rec) ? rec.watchId : null, record: rec, ok: e.length === 0, errors: e };
  });
  return { ok: errors.length === 0 && results.every((r) => r.ok), errors, results };
}

function validateInsightsFile(file) {
  const errors = [];
  if (!checkShape(file, FIELDS.file, 'insights', errors)) return { ok: false, errors, results: [] };
  if (file.schema !== SCHEMAS.insights) errors.push('insights: schema must be ' + SCHEMAS.insights);
  if (!isIsoTime(file.generatedAt)) errors.push('insights: generatedAt must be an ISO timestamp');
  const records = Array.isArray(file.records) ? file.records : (errors.push('insights: records must be an array'), []);
  const seen = {};
  const results = records.map((rec, i) => {
    const where = 'insights[' + i + ']';
    const e = [];
    if (checkShape(rec, FIELDS.insight, where, e)) {
      if (!isText(rec.insightId, 80)) e.push(where + ': insightId is required');
      else if (seen[rec.insightId]) e.push(where + ': duplicate insightId ' + rec.insightId);
      seen[rec.insightId] = true;
      checkEnum(rec.kind, ENUMS.insightKind, where + '.kind', e);
      if (!isText(rec.title, 240) || !isText(rec.text, 2000)) e.push(where + ': title and text are required');
      if (typeof rec.aiAssisted !== 'boolean') e.push(where + ': aiAssisted must be true or false');
      if (!isIsoTime(rec.createdAt)) e.push(where + ': createdAt must be an ISO timestamp');
      (Array.isArray(rec.sources) ? rec.sources : (e.push(where + ': sources must be an array'), [])).forEach((s, j) => {
        const at = where + '.sources[' + j + ']';
        if (checkShape(s, FIELDS.insightSource, at, e)) {
          if (!isHttp(s.url)) e.push(at + ': url must be http(s)');
          if (!isText(s.publisher, 160)) e.push(at + ': publisher is required');
        }
      });
      if (rec.tags != null && checkShape(rec.tags, FIELDS.tags, where + '.tags', e)) {
        (rec.tags.streams || []).forEach((s) => checkEnum(s, ENUMS.stream, where + '.tags.streams', e));
        (rec.tags.anzsic || []).forEach((c) => { if (!/^\d{2,4}$/.test(String(c))) e.push(where + ': tags.anzsic codes are 2-4 digits'); });
      }
    }
    return { insightId: isObj(rec) ? rec.insightId : null, record: rec, ok: e.length === 0, errors: e };
  });
  return { ok: errors.length === 0 && results.every((r) => r.ok), errors, results };
}

// ── releases ─────────────────────────────────────────────────────────────────
function defaultSha256(text) {
  return require('crypto').createHash('sha256').update(text, 'utf8').digest('hex');
}
function parseJson(text, where, errors) {
  if (typeof text !== 'string') { errors.push(where + ': missing'); return null; }
  try { return JSON.parse(text); } catch (e) { errors.push(where + ': not valid JSON'); return null; }
}
const pad6 = (n) => String(n).padStart(6, '0');

// Check a whole release, digests first: nothing is parsed before its digest
// matches. Digests are over each file's UTF-8 text exactly as published.
//   input: { latestText, manifestText, fileTexts: { 'facts.json', 'watch.json', 'insights.json' }, directorySequence }
//   opts:  { sha256(text) -> hex, bounds }
function validateRelease(input, opts) {
  opts = opts || {};
  const sha256 = opts.sha256 || defaultSha256;
  const errors = [];
  const out = { ok: false, errors, sequence: null, manifestSha256: null, fileSha256: {}, facts: null, watch: null, insights: null };
  const latest = parseJson(input && input.latestText, 'latest.json', errors);
  if (!latest || !checkShape(latest, FIELDS.latest, 'latest.json', errors)) return out;
  if (latest.schema !== SCHEMAS.latest) errors.push('latest.json: schema must be ' + SCHEMAS.latest);
  if (!Number.isInteger(latest.sequence) || latest.sequence < 1) { errors.push('latest.json: sequence must be an integer from 1'); return out; }
  if (!isIsoTime(latest.generatedAt)) errors.push('latest.json: generatedAt must be an ISO timestamp');
  if (!checkShape(latest.manifest, FIELDS.latestManifest, 'latest.json.manifest', errors)) return out;
  if (latest.manifest.path !== 'releases/' + pad6(latest.sequence) + '/manifest.json') errors.push('latest.json: manifest.path must be releases/' + pad6(latest.sequence) + '/manifest.json');
  if (!isSha256(latest.manifest.sha256)) { errors.push('latest.json: manifest.sha256 is invalid'); return out; }
  if (input.directorySequence != null && input.directorySequence !== latest.sequence) errors.push('release directory ' + pad6(input.directorySequence) + ' does not match sequence ' + latest.sequence);

  if (typeof input.manifestText !== 'string') { errors.push('manifest.json: missing'); return out; }
  const manifestSha = sha256(input.manifestText);
  if (manifestSha !== latest.manifest.sha256) { errors.push('manifest.json: digest mismatch'); return out; }
  const manifest = parseJson(input.manifestText, 'manifest.json', errors);
  if (!manifest || !checkShape(manifest, FIELDS.manifest, 'manifest.json', errors)) return out;
  if (manifest.schema !== SCHEMAS.manifest) errors.push('manifest.json: schema must be ' + SCHEMAS.manifest);
  if (manifest.sequence !== latest.sequence) errors.push('manifest.json: sequence ' + manifest.sequence + ' does not match latest.json ' + latest.sequence);
  const expectedPrev = latest.sequence === 1 ? null : latest.sequence - 1;
  if (manifest.previousSequence !== expectedPrev) errors.push('manifest.json: previousSequence must be ' + expectedPrev);
  if (!isIsoTime(manifest.generatedAt)) errors.push('manifest.json: generatedAt must be an ISO timestamp');
  if (!isText(manifest.producerCommit, 64)) errors.push('manifest.json: producerCommit is required');
  const files = Array.isArray(manifest.files) ? manifest.files : (errors.push('manifest.json: files must be an array'), []);
  const byName = {};
  files.forEach((f, i) => {
    if (checkShape(f, FIELDS.manifestFile, 'manifest.json.files[' + i + ']', errors)) {
      if (byName[f.name]) errors.push('manifest.json: ' + f.name + ' listed twice');
      byName[f.name] = f;
    }
  });
  Object.keys(FILE_NAMES).forEach((kind) => {
    const name = FILE_NAMES[kind];
    const f = byName[name];
    if (!f) { errors.push('manifest.json: ' + name + ' is not listed'); return; }
    if (f.schema !== SCHEMAS[kind]) errors.push('manifest.json: ' + name + ' schema must be ' + SCHEMAS[kind]);
    const text = input.fileTexts && input.fileTexts[name];
    if (typeof text !== 'string') { errors.push(name + ': missing'); return; }
    const digest = sha256(text);
    if (digest !== f.sha256) { errors.push(name + ': digest mismatch'); return; }
    out.fileSha256[kind] = digest;
    const parsed = parseJson(text, name, errors);
    if (!parsed) return;
    if (Array.isArray(parsed.records) && parsed.records.length !== f.recordCount) errors.push(name + ': recordCount ' + f.recordCount + ' does not match ' + parsed.records.length + ' records');
    if (kind === 'facts') out.facts = validateFactsFile(parsed, { bounds: opts.bounds });
    if (kind === 'watch') out.watch = validateWatchFile(parsed);
    if (kind === 'insights') out.insights = validateInsightsFile(parsed);
  });
  Object.keys(byName).forEach((name) => { if (Object.values(FILE_NAMES).indexOf(name) < 0) errors.push('manifest.json: unexpected file ' + name); });

  out.sequence = latest.sequence;
  out.manifestSha256 = manifestSha;
  ['facts', 'watch', 'insights'].forEach((kind) => {
    if (out[kind] && !out[kind].ok) errors.push(FILE_NAMES[kind] + ': ' + (out[kind].errors.concat(...out[kind].results.map((r) => r.errors))).slice(0, 5).join('; '));
  });
  out.ok = errors.length === 0 && !!out.facts && !!out.watch && !!out.insights;
  return out;
}

// ── consumer import planning ─────────────────────────────────────────────────
// The idempotency rules of roadmap 5.1, once, for every consumer.
//   lastImported: null, or { sequence, manifestSha256, factsSha256, recordIds: [], flagged: [], mappingVersion? }
//   release:      the result of validateRelease
//   policy:       { allow: { series: [], publishers: [], units: [], jurisdictions: [] }, refuseDerived, mappingVersion }
// Returns { action: 'import' | 'noop' | 'reject', reason, toImport, skips, flags, receipt }.
// The consumer maps toImport to proposals or candidates, fills receipt.imported
// with the IDs it created, and stores nextImportState(...) for the next run.
//
// The two "unchanged" shortcuts (the same release again; a release whose
// facts.json is unchanged) only hold while the consumer's own mapping is
// unchanged too. A record skipped because it was not allowlisted must be
// reconsidered once the mapping allows it, without waiting for new facts. So
// when the state records the mappingVersion it was made with and the policy's
// differs, the release is planned in full; records imported before are still
// skipped as duplicates. A state without a recorded mappingVersion (made by a
// four-argument nextImportState) keeps the old shortcuts.
function planImport(lastImported, release, policy, now) {
  policy = policy || {};
  const allow = policy.allow || {};
  const plan = { action: 'reject', reason: '', toImport: [], skips: [], flags: [], receipt: null };
  plan.receipt = {
    releaseSequence: release ? release.sequence : null,
    manifestSha256: release ? release.manifestSha256 : null,
    factsSha256: release && release.fileSha256 ? release.fileSha256.facts || null : null,
    mappingVersion: policy.mappingVersion || null,
    importedAt: now || new Date().toISOString(),
    imported: [],
    skips: plan.skips,
    flags: plan.flags,
  };
  if (!release || !release.ok) { plan.reason = 'release failed validation'; return plan; }
  const last = lastImported || null;
  const mapping = policy.mappingVersion || null;
  const mappingChanged = !!last && last.mappingVersion !== undefined && (last.mappingVersion || null) !== mapping;
  if (last) {
    if (release.sequence < last.sequence) { plan.reason = 'rollback: release ' + release.sequence + ' is older than the last imported ' + last.sequence; return plan; }
    if (release.sequence === last.sequence) {
      if (release.manifestSha256 !== last.manifestSha256) { plan.reason = 'sequence ' + release.sequence + ' was reused with a different manifest digest'; return plan; }
      if (!mappingChanged) { plan.action = 'noop'; plan.reason = 'release ' + release.sequence + ' already imported'; return plan; }
    }
    if (!mappingChanged && release.fileSha256.facts === last.factsSha256) {
      plan.action = 'import';
      plan.reason = 'facts.json unchanged since release ' + last.sequence;
      plan.skips.push({ recordId: null, reason: 'facts unchanged' });
      return plan;
    }
  }
  const seen = new Set(last && last.recordIds || []);
  const flagged = new Set(last && last.flagged || []);
  const listed = (list, value) => Array.isArray(list) && list.indexOf(value) >= 0;
  release.facts.results.forEach((r) => {
    const rec = r.record;
    if (seen.has(rec.recordId)) {
      // Imported before. If it has since been superseded or withdrawn, flag it
      // once so the consumer can close or mark its candidate.
      if (r.historical && !flagged.has(rec.recordId)) plan.flags.push({ recordId: rec.recordId, lifecycle: rec.lifecycle });
      else plan.skips.push({ recordId: rec.recordId, reason: 'duplicate' });
      return;
    }
    if (r.historical) { plan.skips.push({ recordId: rec.recordId, reason: 'historical (' + rec.lifecycle + ')' }); return; }
    if (r.unsupported.length) {
      const what = r.unsupported.map((u) => u.replace(/^.*?: /, '').replace(/ is not in this contract version$/, ''));
      plan.skips.push({ recordId: rec.recordId, reason: 'vocabulary this contract version does not know: ' + what.join('; ') });
      return;
    }
    if (!r.eligible) {
      plan.skips.push({ recordId: rec.recordId, reason: r.checks.plausible !== false ? 'not fact-verified'
        : r.overrideVerdict === 'unmatched' ? 'plausibility breach (its override records a different bound)' : 'plausibility breach' });
      return;
    }
    if (rec.derivation && policy.refuseDerived) { plan.skips.push({ recordId: rec.recordId, reason: 'derived records refused by policy' }); return; }
    if (!listed(allow.series, rec.seriesId)) { plan.skips.push({ recordId: rec.recordId, reason: 'series not allowlisted' }); return; }
    if (!listed(allow.units, rec.unitCode)) { plan.skips.push({ recordId: rec.recordId, reason: 'unit not allowlisted' }); return; }
    if (!listed(allow.jurisdictions, rec.scope.jurisdiction)) { plan.skips.push({ recordId: rec.recordId, reason: 'jurisdiction not allowlisted' }); return; }
    const publishers = (rec.evidence || []).map((ev) => ev.publisher);
    if (publishers.some((p) => !listed(allow.publishers, p))) { plan.skips.push({ recordId: rec.recordId, reason: 'publisher not allowlisted' }); return; }
    plan.toImport.push(rec);
  });
  plan.action = 'import';
  plan.reason = (mappingChanged ? 'mapping changed (' + (last.mappingVersion || 'none') + ' → ' + (mapping || 'none') + '), so the whole release was planned: ' : '') +
    plan.toImport.length + ' to import, ' + plan.skips.length + ' skipped, ' + plan.flags.length + ' flagged';
  return plan;
}

// The state to store after an import. Only records actually imported (and
// flags actually raised) are remembered, so a record skipped today for an
// allowlist reason can still import once the consumer allows it. Pass the same
// policy given to planImport: the state then records its mappingVersion, and a
// later change of mapping re-plans instead of taking the "unchanged" shortcuts.
function nextImportState(lastImported, release, importedRecordIds, flaggedRecordIds, policy) {
  const last = lastImported || { recordIds: [], flagged: [] };
  const state = {
    sequence: release.sequence,
    manifestSha256: release.manifestSha256,
    factsSha256: release.fileSha256.facts,
    recordIds: Array.from(new Set((last.recordIds || []).concat(importedRecordIds || []))),
    flagged: Array.from(new Set((last.flagged || []).concat(flaggedRecordIds || []))),
  };
  if (policy) state.mappingVersion = policy.mappingVersion || null;
  return state;
}

module.exports = {
  SCHEMAS, FILE_NAMES, ENUMS, FIELDS,
  normaliseNumberText, canonicalNumber, tokenStandsAlone, numbersInQuote,
  validateFactsFile, validateWatchFile, validateInsightsFile, validateRelease,
  planImport, nextImportState,
};
