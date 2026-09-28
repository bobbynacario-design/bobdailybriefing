'use strict';
// RBA cash rate target (docs/grounding-phase-h.md, H-5; decisions D-H5-1 to
// D-H5-4). One observation per Monetary Policy Board decision, holds included,
// as the RBA's own "Interest Rate Decisions" table lists them. The value is
// bound to the Board's statement; the table's cell for the same decision is the
// cross-check. The next decision day comes from the RBA's meeting schedule.
// No dependencies.
//
// Fails closed. Anything the parser does not recognise is a "blocked" watch
// state that says what it saw, and nothing is published. A statement that
// cannot be fetched holds the figure for the day (an ordinary thrown error: the
// publisher keeps the previous watch state). A schedule that does not read as
// expected only means no expected date.

const crypto = require('crypto');

const SERIES_ID = 'rba_cash_rate_target';
const TITLE = 'RBA cash rate target';
const PUBLISHER = 'Reserve Bank of Australia';
const SITE = 'https://www.rba.gov.au';
const CASH_RATE_URL = SITE + '/statistics/cash-rate/';
const SCHEDULE_URL = SITE + '/schedules-events/board-meeting-schedules.html';
const STATEMENT_HEADLINE = 'Statement by the Monetary Policy Board: Monetary Policy Decision';
// The statements are RBA Material (CC BY 4.0); the cash rate target is RBA
// Financial Data (the RBA's copyright notice, section 5), which is not the
// administered "Cash Rate" (the interbank overnight rate).
const licence = (year) => 'Source: Reserve Bank of Australia ' + year + '. Statements CC BY 4.0; the cash rate target is RBA Financial Data, ' +
  'used under section 5 of https://www.rba.gov.au/copyright/ with attribution. No RBA endorsement is implied.';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n) => String(n).padStart(2, '0');

// The page changed in a way the parser does not recognise: a "blocked" state.
class SourceChanged extends Error {}
const changed = (message) => new SourceChanged(message);

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&rsquo;|&apos;/g, '\'')
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
// The text a reader sees: tags removed, entities decoded, spaces collapsed.
function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
// "12 Aug 2026" or "12 August 2026" -> "2026-08-12", or null.
function isoFromDayMonthYear(text) {
  const m = /^(\d{1,2}) ([A-Z][a-z]+) (\d{4})$/.exec(String(text).trim());
  if (!m) return null;
  const i = MONTHS.findIndex((name) => name === m[2] || name.slice(0, 3) === m[2]);
  if (i < 0) return null;
  const iso = m[3] + '-' + pad2(i + 1) + '-' + pad2(m[1]);
  const d = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
const daysApart = (fromIso, toIso) => Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86400000);
const cells = (rowHtml) => [...rowHtml.matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => ({ tag: m[1], html: m[2], text: textOf(m[2]) }));

// Read the cash rate page. Returns the latest decision:
// { effectiveDate, dateText, changeText, targetText, statementUrl, pageTitle } or throws SourceChanged.
function parseCashRatePage(html) {
  if (typeof html !== 'string' || !html) throw changed('the page was empty');
  const t = /<title>([\s\S]*?)<\/title>/.exec(html);
  const pageTitle = t ? textOf(t[1]) : '';
  if (pageTitle !== 'Cash Rate Target | RBA') throw changed('the page title is "' + pageTitle.slice(0, 60) + '"');
  const at = html.indexOf('<table id="datatable"');
  if (at < 0) throw changed('the "Interest Rate Decisions" table is missing');
  const table = html.slice(at, html.indexOf('</table>', at));
  const caption = /<caption>\s*([^<]*)/.exec(table);
  if (!caption || caption[1].trim() !== 'Interest Rate Decisions') throw changed('the table\'s caption is not "Interest Rate Decisions"');
  const head = /<thead>([\s\S]*?)<\/thead>/.exec(table);
  const heads = head ? cells(head[1]).map((c) => c.text) : [];
  const wanted = ['Effective Date', 'Change % points', 'Cash rate target %', 'Related Documents'];
  if (heads.join(' | ') !== wanted.join(' | ')) throw changed('the table\'s columns are "' + heads.join(' | ').slice(0, 120) + '"');
  const body = /<tbody>([\s\S]*)/.exec(table);
  const row = body && /<tr>([\s\S]*?)<\/tr>/.exec(body[1]);
  if (!row) throw changed('the table has no rows');
  const c = cells(row[1]);
  if (c.length !== 4 || c[0].tag !== 'h') throw changed('the top row has ' + c.length + ' cells');
  const effectiveDate = isoFromDayMonthYear(c[0].text);
  if (!effectiveDate) throw changed('the top row\'s date reads "' + c[0].text.slice(0, 30) + '"');
  if (!/^[+-]?\d{1,2}\.\d{2}$/.test(c[1].text)) throw changed('the top row\'s change reads "' + c[1].text.slice(0, 30) + '"');
  if (!/^\d{1,2}\.\d{2}$/.test(c[2].text)) throw changed('the top row\'s target reads "' + c[2].text.slice(0, 30) + '"');
  const links = [...c[3].html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter((m) => textOf(m[2]) === 'Statement');
  if (links.length !== 1) throw changed('the top row has ' + links.length + ' Statement links');
  const href = /\bhref="(\/media-releases\/\d{4}\/mr-\d{2}-\d{2,3}\.html)"/.exec(links[0][1]);
  if (!href) throw changed('the top row\'s Statement link is not a media release');
  return { effectiveDate, dateText: c[0].text, changeText: c[1].text, targetText: c[2].text, statementUrl: SITE + href[1], pageTitle };
}

// Read a Board statement. Returns { date, dateText, number, headline, sentence,
// verb, basisPoints, targetText } or throws SourceChanged.
const DECISION = /the Board decided to (?:(leave) the cash rate target unchanged at|(increase|raise|lower|reduce|cut) the cash rate target by (\d{1,3}) basis points to) (\d{1,2}\.\d{2}) per cent\./g;
function parseStatement(html) {
  if (typeof html !== 'string' || !html) throw changed('the statement was empty');
  const h = /itemprop="headline">([\s\S]*?)<\/span>/.exec(html);
  const headline = h ? textOf(h[1]) : '';
  if (headline !== STATEMENT_HEADLINE) throw changed('the release is "' + headline.slice(0, 80) + '", not a Monetary Policy Board decision');
  const time = /<time\b(?=[^>]*\bclass="rss-mr-date")([^>]*)>([\s\S]*?)<\/time>/.exec(html);
  // "2026-08-11T14:30+10:00" on recent statements, "2026-05-05" on some others.
  const stamp = time && /\bdatetime="(\d{4}-\d{2}-\d{2})(?:T[^"]*)?"/.exec(time[1]);
  if (!stamp) throw changed('the statement has no publication date');
  const number = /itemprop="issueNumber">([\s\S]*?)<\/span>/.exec(html);
  const content = html.indexOf('rss-mr-content');
  const p = content >= 0 && /<p[^>]*>([\s\S]*?)<\/p>/.exec(html.slice(content));
  if (!p) throw changed('the statement has no text');
  const paragraph = textOf(p[1]);
  const found = [...paragraph.matchAll(DECISION)];
  if (found.length !== 1) throw changed('the first paragraph reads "' + paragraph.slice(0, 120) + '"');
  const m = found[0];
  // The quote is the decision's own sentence, from its start to "per cent.".
  const from = paragraph.lastIndexOf('. ', m.index);
  const sentence = paragraph.slice(from < 0 ? 0 : from + 2, m.index + m[0].length);
  return {
    date: stamp[1], dateText: textOf(time[2]), number: number ? textOf(number[1]) : null, headline, sentence,
    verb: m[1] || m[2], basisPoints: m[3] ? Number(m[3]) : 0, targetText: m[4],
  };
}

// Read the meeting schedule. Returns the Monetary Policy Board's decision days
// (the last day of each meeting), sorted, or throws SourceChanged.
function parseSchedule(html) {
  if (typeof html !== 'string' || !html) throw changed('the schedule was empty');
  const days = [];
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)];
  tables.forEach((t) => {
    const cap = /<caption[^>]*>([\s\S]*?)<\/caption>/.exec(t[1]);
    const year = cap && /^Board meeting schedules (\d{4})$/.exec(textOf(cap[1]));
    if (!year) return;
    const head = /<thead>([\s\S]*?)<\/thead>/.exec(t[1]);
    const heads = head ? cells(head[1]).map((c) => c.text).join(' | ') : '';
    if (heads !== 'Month | Monetary Policy Board | Payments System Board') throw changed('the ' + year[1] + ' schedule\'s columns are "' + heads.slice(0, 80) + '"');
    const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(t[1]);
    [...(body ? body[1] : '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].forEach((r) => {
      const c = cells(r[1]);
      if (c.length !== 3 || c[0].tag !== 'h' || !c[1].text) return;
      // "28–29 September", "30 September–1 October" or a one-day "5 March".
      const m = /^(?:(\d{1,2})(?: ([A-Z][a-z]+))? ?– ?)?(\d{1,2}) ([A-Z][a-z]+)$/.exec(c[1].text);
      const day = m && isoFromDayMonthYear(m[3] + ' ' + m[4] + ' ' + year[1]);
      if (!day) throw changed('a ' + year[1] + ' Monetary Policy Board meeting reads "' + c[1].text.slice(0, 40) + '"');
      days.push(day);
    });
  });
  if (!days.length) throw changed('no Monetary Policy Board meetings were found');
  return days.sort();
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// Today's date where the RBA decides, for "is the next decision overdue?".
function sydneyDate(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

// Build the observation: a fact record without its identity fields.
function observation(page, statement, fetched) {
  const lic = licence(statement.date.slice(0, 4));
  return {
    seriesId: SERIES_ID, observationKey: page.effectiveDate, kind: 'rate', title: TITLE,
    value: Number(statement.targetText), range: null, unitCode: 'pct_pa', basisCode: 'policy_rate_target',
    scope: { jurisdiction: 'AU', classification: 'Cash rate target', period: { from: page.effectiveDate, to: null } },
    qualifications: [],
    valueBindings: [{ field: 'value', token: statement.targetText, evidenceId: 'statement' }],
    observationDate: page.effectiveDate, publishedAt: statement.date, effectiveFrom: page.effectiveDate, effectiveTo: null,
    evidence: [
      {
        evidenceId: 'statement', role: 'release', url: page.statementUrl, publisher: PUBLISHER,
        title: statement.headline + ', ' + statement.dateText + (statement.number ? ' (Media Release ' + statement.number + ')' : ''),
        quote: statement.sentence, locator: { paragraph: 'First paragraph' },
        asOf: statement.date, tier: 'primary', retrievedAt: fetched.at, contentSha256: fetched.statementSha256, licence: lic,
      },
      {
        // The value cell alone, as for the CPI's cross-check: the whole row also
        // carries the date and the change, which a target could match by accident.
        evidenceId: 'table', role: 'cross_check', url: CASH_RATE_URL, publisher: PUBLISHER, title: 'Cash Rate Target: Interest Rate Decisions',
        quote: page.targetText, locator: { table: 'Interest Rate Decisions, column "Cash rate target %"', row: page.dateText },
        asOf: statement.date, tier: 'primary', retrievedAt: fetched.at, contentSha256: fetched.pageSha256, licence: lic,
      },
    ],
    derivation: null, plausibilityOverride: null, captureMethod: 'page',
  };
}

// The statement and the table must describe the same decision.
function disagreement(page, statement) {
  const change = Math.round(Number(page.changeText) * 100);
  const sign = statement.verb === 'leave' ? 0 : /^(increase|raise)$/.test(statement.verb) ? 1 : -1;
  if (change !== sign * statement.basisPoints) {
    return 'the statement says "' + statement.verb + (statement.basisPoints ? ' by ' + statement.basisPoints + ' basis points' : '') + '" but the table\'s change is ' + page.changeText;
  }
  const lag = daysApart(statement.date, page.effectiveDate);
  if (lag < 1 || lag > 7) return 'the statement is dated ' + statement.date + ' but the decision takes effect on ' + page.effectiveDate;
  return null;
}

// The registry's fetch: ({ fetch, now }) -> { observations, status }.
// `fetch` is the publisher's fetchWithIdentity: it sends Daybook's user agent
// and throws on an HTTP error, with a 401/403 reported as "blocked".
async function fetchCashRate(ctx) {
  const now = ctx.now;
  const blocked = (what, e, url) => ({ observations: [], status: { state: 'blocked', url: url || CASH_RATE_URL, detail: 'Not published: ' + what + ' did not read as expected: ' + e.message + '.' } });
  const pageBytes = Buffer.from(await (await ctx.fetch(CASH_RATE_URL)).arrayBuffer());
  let page;
  try { page = parseCashRatePage(pageBytes.toString('utf8')); } catch (e) {
    if (!(e instanceof SourceChanged)) throw e;
    return blocked('the RBA cash rate page', e);
  }
  // A failed fetch holds the figure for today (the publisher keeps the watch).
  const statementBytes = Buffer.from(await (await ctx.fetch(page.statementUrl)).arrayBuffer());
  let statement;
  try { statement = parseStatement(statementBytes.toString('utf8')); } catch (e) {
    if (!(e instanceof SourceChanged)) throw e;
    return blocked('the Board statement for ' + page.dateText, e, page.statementUrl);
  }
  const differs = disagreement(page, statement);
  if (differs) return { observations: [], status: { state: 'blocked', url: CASH_RATE_URL, detail: 'Not published: ' + differs + '.' } };

  // The next decision day (G8). A schedule that does not read as expected only
  // means no expected date; a failed fetch holds everything for today.
  const scheduleBytes = Buffer.from(await (await ctx.fetch(SCHEDULE_URL)).arrayBuffer());
  let next = null;
  try { next = parseSchedule(scheduleBytes.toString('utf8')).find((day) => day > statement.date) || null; } catch (e) {
    if (!(e instanceof SourceChanged)) throw e;
  }
  if (next && sydneyDate(now) > next) {
    return { observations: [], status: { state: 'overdue', expectedBy: next, url: CASH_RATE_URL,
      detail: 'The RBA scheduled a Monetary Policy Board decision for ' + next + '; its cash rate page still shows the decision of ' + statement.date + '.' } };
  }
  const obs = observation(page, statement, { at: now, pageSha256: sha256(pageBytes), statementSha256: sha256(statementBytes) });
  const status = next ? { expectedBy: next, url: SCHEDULE_URL, detail: 'Next: a Monetary Policy Board decision, scheduled by the RBA for ' + next + '.' } : undefined;
  return { observations: [obs], status };
}

module.exports = {
  SERIES_ID, TITLE, PUBLISHER, CASH_RATE_URL, SCHEDULE_URL, licence,
  parseCashRatePage, parseStatement, parseSchedule, observation, fetchCashRate, sydneyDate, SourceChanged,
};
