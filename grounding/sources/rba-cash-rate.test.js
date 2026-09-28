'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const V = require('../validate');
const { produce } = require('../producer');
const REGISTRY = require('../series');
const rba = require('./rba-cash-rate');

// Verbatim fragments of the real pages (fetched 2026-09-29 with Daybook's user
// agent). Source: Reserve Bank of Australia 2026.
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const PAGE = fixture('rba-cash-rate-2026-09-29.html');
const HOLD = fixture('rba-mr-26-19.html'); // 11 August 2026: unchanged at 4.35
const RISE = fixture('rba-mr-26-12.html'); // 5 May 2026: +25 bp to 4.35
const CUT = fixture('rba-mr-25-22.html'); // 12 August 2025: -25 bp to 3.60
const SCHEDULE = fixture('rba-board-meeting-schedules-2026-09-29.html');
const STATEMENT = (mr) => 'https://www.rba.gov.au/media-releases/20' + mr.slice(3, 5) + '/' + mr + '.html';
const T1 = '2026-09-28T23:45:00Z'; // 09:45 AEST on 29 September, before the 2:30 pm decision
const T2 = '2026-09-29T20:15:00Z'; // the next scheduled run: 06:15 AEST on 30 September

// The page with a new top row, as the RBA adds one after each decision.
function withTopRow(date, change, target, mr) {
  const row = '<tr>\n\t\t\t\t<th scope="row">' + date + '</th>\n\t\t\t\t<td>' + change + '</td>\n\t\t\t\t<td>' + target + '</td>\n\t\t\t\t<td class="links">\n' +
    '\t\t\t\t\t<a aria-label="Media Release: Statement by the Monetary Policy Board" href="/media-releases/20' + mr.slice(3, 5) + '/' + mr + '.html">Statement</a>\n\t\t\t\t</td>\n\t\t\t</tr>\n\t\t\t';
  return PAGE.replace('<!-- year 2026 -->\n\t\t\t', '<!-- year 2026 -->\n\t\t\t' + row).replace('<!-- year 2026 -->\r\n\t\t\t', '<!-- year 2026 -->\r\n\t\t\t' + row);
}
// A statement re-dated and re-worded from the real August one.
function statement(dateIso, dateText, number, sentence) {
  return HOLD.replace('datetime="2026-08-11T14:30+10:00"', 'datetime="' + dateIso + 'T14:30+10:00"').replace('11&nbsp;August 2026', dateText)
    .replace('>2026-19<', '>' + number + '<').replace(/<p>At its meeting today[\s\S]*?<\/p>/, '<p>' + sentence + '</p>');
}
// A mock of the publisher's fetchWithIdentity: throws on HTTP errors, with status.
function source(pages) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const body = pages[url];
    if (typeof body === 'number') throw Object.assign(new Error('HTTP ' + body + ' from ' + url), { status: body, url });
    if (body === undefined) throw Object.assign(new Error('HTTP 404 from ' + url), { status: 404, url });
    return { ok: true, arrayBuffer: async () => Buffer.from(body, 'utf8') };
  };
  return { fetch, calls };
}
const live = (extra) => source(Object.assign({ [rba.CASH_RATE_URL]: PAGE, [STATEMENT('mr-26-19')]: HOLD, [rba.SCHEDULE_URL]: SCHEDULE }, extra || {}));
const series = REGISTRY.find((s) => s.seriesId === rba.SERIES_ID);
function runWith(previous, out, now) {
  return produce({ previous, registry: [series], observations: out.observations, seriesStatus: out.status ? { [rba.SERIES_ID]: out.status } : {}, now, producerCommit: 'test' });
}
function asPrevious(result) {
  const f = result.release.files, d = result.release.dir;
  return { sequence: result.release.sequence, fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] },
    facts: JSON.parse(f[d + '/facts.json']).records, watch: JSON.parse(f[d + '/watch.json']).records, insights: JSON.parse(f[d + '/insights.json']).records };
}

test('the cash rate page, three statements and the schedule read as the RBA publishes them', () => {
  assert.deepEqual(rba.parseCashRatePage(PAGE), { effectiveDate: '2026-08-12', dateText: '12 Aug 2026', changeText: '0.00', targetText: '4.35',
    statementUrl: STATEMENT('mr-26-19'), pageTitle: 'Cash Rate Target | RBA' });
  const hold = rba.parseStatement(HOLD);
  assert.deepEqual([hold.date, hold.dateText, hold.number, hold.verb, hold.basisPoints, hold.targetText], ['2026-08-11', '11 August 2026', '2026-19', 'leave', 0, '4.35']);
  assert.equal(hold.sentence, 'At its meeting today, the Board decided to leave the cash rate target unchanged at 4.35 per cent.');
  // An older statement's datetime carries no time.
  const rise = rba.parseStatement(RISE);
  assert.deepEqual([rise.date, rise.verb, rise.basisPoints, rise.targetText], ['2026-05-05', 'increase', 25, '4.35']);
  const cut = rba.parseStatement(CUT);
  assert.deepEqual([cut.date, cut.verb, cut.basisPoints, cut.targetText], ['2025-08-12', 'lower', 25, '3.60']);
  assert.equal(cut.sentence, 'At its meeting today, the Board decided to lower the cash rate target by 25 basis points to 3.60 per cent.');
  assert.deepEqual(rba.parseSchedule(SCHEDULE), ['2026-02-03', '2026-03-17', '2026-05-05', '2026-06-16', '2026-08-11', '2026-09-29', '2026-11-03', '2026-12-08',
    '2027-02-09', '2027-03-23', '2027-05-04', '2027-06-22', '2027-08-10', '2027-09-28', '2027-11-02', '2027-12-14']);
});

test('the latest decision becomes a fact-verified, cross-checked, plausible record with the next decision day', async () => {
  const src = live();
  const out = await rba.fetchCashRate({ fetch: src.fetch, now: T1 });
  assert.deepEqual(src.calls, [rba.CASH_RATE_URL, STATEMENT('mr-26-19'), rba.SCHEDULE_URL]);
  assert.deepEqual(out.status, { expectedBy: '2026-09-29', url: rba.SCHEDULE_URL, detail: 'Next: a Monetary Policy Board decision, scheduled by the RBA for 2026-09-29.' });
  const o = out.observations[0];
  assert.deepEqual([o.observationKey, o.value, o.unitCode, o.basisCode, o.kind, o.publishedAt, o.effectiveFrom, o.effectiveTo], ['2026-08-12', 4.35, 'pct_pa', 'policy_rate_target', 'rate', '2026-08-11', '2026-08-12', null]);
  assert.deepEqual(o.evidence.map((e) => [e.role, e.url, e.publisher, e.quote]), [
    ['release', STATEMENT('mr-26-19'), 'Reserve Bank of Australia', 'At its meeting today, the Board decided to leave the cash rate target unchanged at 4.35 per cent.'],
    ['cross_check', rba.CASH_RATE_URL, 'Reserve Bank of Australia', '4.35'],
  ]);
  assert.equal(o.evidence[0].title, 'Statement by the Monetary Policy Board: Monetary Policy Decision, 11 August 2026 (Media Release 2026-19)');
  assert.ok(o.evidence.every((e) => e.licence === rba.licence('2026') && e.licence.length <= 300));

  const r = runWith(null, out, T1);
  assert.deepEqual(r.skipped, []);
  const fact = r.snapshot.facts[0];
  assert.equal(fact.recordId, 'rba_cash_rate_target@2026-08-12#r1');
  const checks = r.validation.results[0].checks;
  assert.deepEqual(checks, { sourceLinked: true, factVerified: true, crossChecked: true, plausible: true });
  assert.equal(r.changes[0].summary, 'RBA cash rate target: 4.35% p.a. (2026-08-12)');
  const w = r.snapshot.watch[0];
  assert.deepEqual([w.state, w.expectedBy, w.detail, w.evidence.url], ['published', '2026-09-29',
    'Latest: 4.35% p.a. (2026-08-12), published 2026-08-11. Next: a Monetary Policy Board decision, scheduled by the RBA for 2026-09-29.', rba.SCHEDULE_URL]);
});

test('the next decision is a new observation, a hold included; the same decision read again cuts no release', async () => {
  const first = runWith(null, await rba.fetchCashRate({ fetch: live().fetch, now: T1 }), T1);
  assert.equal(runWith(asPrevious(first), await rba.fetchCashRate({ fetch: live().fetch, now: '2026-09-29T01:00:00Z' }), '2026-09-29T01:00:00Z').changed, false);
  // Today's decision, as the page and a statement would show it at 06:15 the next morning.
  const held = statement('2026-09-29', '29&nbsp;September 2026', '2026-23', 'At its meeting today, the Board decided to leave the cash rate target unchanged at\n\t4.35&nbsp;per&nbsp;cent.');
  const out = await rba.fetchCashRate({ fetch: live({ [rba.CASH_RATE_URL]: withTopRow('30 Sep 2026', '0.00', '4.35', 'mr-26-23'), [STATEMENT('mr-26-23')]: held }).fetch, now: T2 });
  assert.equal(out.status.expectedBy, '2026-11-03');
  const next = runWith(asPrevious(first), out, T2);
  assert.equal(next.release.sequence, 2);
  const byId = Object.fromEntries(next.snapshot.facts.map((f) => [f.recordId, f]));
  assert.equal(byId['rba_cash_rate_target@2026-08-12#r1'].lifecycle, 'superseded');
  assert.equal(byId['rba_cash_rate_target@2026-09-30#r1'].supersedes, 'rba_cash_rate_target@2026-08-12#r1');
  assert.equal(next.changes[0].summary, 'RBA cash rate target: 4.35% p.a. → 4.35% p.a. (2026-08-12 → 2026-09-30)');
});

test('a cut to 3.60 binds to its statement and cross-checks against the table', async () => {
  const page = PAGE.replace(/<tbody>[\s\S]*<\/tbody>/, '<tbody>\n<tr>\n<th scope="row">13 Aug 2025</th>\n<td>-0.25</td>\n<td>3.60</td>\n<td class="links"><a href="/media-releases/2025/mr-25-22.html">Statement</a></td>\n</tr>\n</tbody>');
  const out = await rba.fetchCashRate({ fetch: source({ [rba.CASH_RATE_URL]: page, [STATEMENT('mr-25-22')]: CUT, [rba.SCHEDULE_URL]: SCHEDULE }).fetch, now: '2025-08-13T00:00:00Z' });
  const o = out.observations[0];
  assert.deepEqual([o.observationKey, o.value, o.valueBindings[0].token, o.publishedAt], ['2025-08-13', 3.6, '3.60', '2025-08-12']);
  const r = runWith(null, out, '2025-08-13T00:00:00Z');
  assert.deepEqual(r.validation.results[0].checks, { sourceLinked: true, factVerified: true, crossChecked: true, plausible: true });
  assert.equal(r.changes[0].summary, 'RBA cash rate target: 3.6% p.a. (2025-08-13)');
});

test('once the scheduled decision day has passed and the page has not moved, the series is overdue', async () => {
  const first = runWith(null, await rba.fetchCashRate({ fetch: live().fetch, now: T1 }), T1);
  const out = await rba.fetchCashRate({ fetch: live().fetch, now: T2 });
  assert.deepEqual(out.observations, []);
  assert.deepEqual(out.status, { state: 'overdue', expectedBy: '2026-09-29', url: rba.CASH_RATE_URL,
    detail: 'The RBA scheduled a Monetary Policy Board decision for 2026-09-29; its cash rate page still shows the decision of 2026-08-11.' });
  const late = runWith(asPrevious(first), out, T2);
  assert.equal(late.snapshot.watch[0].state, 'overdue');
  assert.equal(late.snapshot.facts[0].lifecycle, 'current', 'the last figure stays');
});

test('anything unrecognised is blocked and says what it saw; nothing is published', async () => {
  const blockedBy = async (pages, pattern) => {
    const out = await rba.fetchCashRate({ fetch: live(pages).fetch, now: T1 });
    assert.deepEqual(out.observations, []);
    assert.equal(out.status.state, 'blocked');
    assert.match(out.status.detail, pattern);
  };
  await blockedBy({ [rba.CASH_RATE_URL]: PAGE.replace('Cash Rate Target | RBA', 'Page not found | RBA') }, /page title is "Page not found \| RBA"/);
  await blockedBy({ [rba.CASH_RATE_URL]: PAGE.replace('<th scope="col">Effective Date</th>', '<th scope="col">Announced</th>') }, /table's columns are "Announced \| Change/);
  await blockedBy({ [rba.CASH_RATE_URL]: PAGE.replace('>Statement</a>', '>Media release</a>') }, /top row has 0 Statement links/);
  await blockedBy({ [STATEMENT('mr-26-19')]: HOLD.replace('itemprop="headline">Statement by the Monetary Policy Board: Monetary Policy Decision', 'itemprop="headline">Payments System Board Update') }, /the release is "Payments System Board Update"/);
  await blockedBy({ [STATEMENT('mr-26-19')]: HOLD.replace('decided to leave the cash rate target unchanged at', 'decided to hold the cash rate target at') }, /first paragraph reads "At its meeting today, the Board decided to hold/);
  // The statement and the table must describe the same decision.
  await blockedBy({ [STATEMENT('mr-26-19')]: RISE.replace('2026-05-05', '2026-08-11') }, /says "increase by 25 basis points" but the table's change is 0\.00/);
  await blockedBy({ [STATEMENT('mr-26-19')]: HOLD.replace('2026-08-11T14:30', '2026-08-12T14:30') }, /dated 2026-08-12 but the decision takes effect on 2026-08-12/);
});

test('a statement that disagrees with the table\'s figure is a conflict, not a figure', async () => {
  const out = await rba.fetchCashRate({ fetch: live({ [STATEMENT('mr-26-19')]: HOLD.replace('4.35&nbsp;per', '4.60&nbsp;per') }).fetch, now: T1 });
  const r = runWith(null, out, T1);
  assert.deepEqual(r.snapshot.facts, []);
  assert.equal(r.snapshot.watch[0].state, 'conflict');
  assert.match(r.snapshot.watch[0].detail, /^The data table disagrees with the release: cross-check conflict/);
});

test('a failed statement or schedule fetch holds the figure for the day; an unreadable schedule only drops the expected date', async () => {
  await assert.rejects(rba.fetchCashRate({ fetch: live({ [STATEMENT('mr-26-19')]: 503 }).fetch, now: T1 }), /HTTP 503/);
  await assert.rejects(rba.fetchCashRate({ fetch: live({ [rba.SCHEDULE_URL]: 503 }).fetch, now: T1 }), /HTTP 503/);
  const out = await rba.fetchCashRate({ fetch: live({ [rba.SCHEDULE_URL]: SCHEDULE.replace(/Monetary Policy Board</g, 'Policy Board<') }).fetch, now: T1 });
  assert.equal(out.observations.length, 1);
  assert.equal(out.status, undefined);
});

test('the registry entry carries the agreed bounds, freshness and cadence (D-H5-3); no consumer imports it yet', async () => {
  assert.deepEqual([series.capture, series.freshnessDays, series.cadenceHours, series.publisher], ['page', 75, 12, 'Reserve Bank of Australia']);
  assert.deepEqual(series.bounds, { min: 0, max: 10, maxChange: 1 });
  // A move of more than a point is held for a reviewed override.
  const first = runWith(null, await rba.fetchCashRate({ fetch: live().fetch, now: T1 }), T1);
  const jump = statement('2026-09-29', '29&nbsp;September 2026', '2026-23', 'At its meeting today, the Board decided to increase the cash rate target by 125 basis points to 5.60 per cent.');
  const big = await rba.fetchCashRate({ fetch: live({ [rba.CASH_RATE_URL]: withTopRow('30 Sep 2026', '+1.25', '5.60', 'mr-26-23'), [STATEMENT('mr-26-23')]: jump }).fetch, now: T2 });
  const held = runWith(asPrevious(first), big, T2);
  assert.equal(held.snapshot.facts.length, 1);
  assert.match(held.snapshot.watch[0].detail, /5\.6% p\.a\. \(2026-09-30\) is outside this series' plausibility bounds \(min 0, max 10, max change 1\)/);
  // Consumers read the release and skip the series: neither maps it.
  const d = first.release.dir, f = first.release.files;
  const release = V.validateRelease({ latestText: f['latest.json'], manifestText: f[d + '/manifest.json'],
    fileTexts: { 'facts.json': f[d + '/facts.json'], 'watch.json': f[d + '/watch.json'], 'insights.json': f[d + '/insights.json'] }, directorySequence: 1 }, { bounds: {} });
  assert.equal(release.ok, true, release.errors.join('; '));
  const plan = V.planImport(null, release, { mappingVersion: 'test', allow: { series: ['abs_cpi_all_groups_annual_change'], publishers: ['Australian Bureau of Statistics'], units: ['pct'], jurisdictions: ['AU'] } }, T1);
  assert.deepEqual(plan.skips, [{ recordId: 'rba_cash_rate_target@2026-08-12#r1', reason: 'series not allowlisted' }]);
});
