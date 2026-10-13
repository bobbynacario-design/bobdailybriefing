import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeDay, edgeStamp, pesoAmount, parseDividends, parseFilings, parseNotices, newsKind, addSessions,
  dividendStats, ipoGroups, newsFor, applyEvents, watchEventAlerts } from './pse-events.js';

// Rows shaped like PSE Edge's own (13 Oct 2026).
const divRow = (cmpy, name, sec, type, rate, ex, rec, pay, circ, edge) =>
  '<tr><td><a href="/companyInformation/form.do?cmpy_id=' + cmpy + '">' + name + '</a></td><td class="alignC">' + sec + '</td><td class="alignC">' + type +
  '</td><td class="alignR">' + rate + '</td><td class="alignC">' + ex + '</td><td class="alignC">' + rec + '</td><td class="alignC">' + pay +
  '</td><td class="alignC"><a href="#viewer" onclick="openPopup(\'' + edge + '\');return false;">' + circ + '</a></td></tr>';
const filingRow = (cmpy, name, tmpl, form, at, circ, edge) =>
  '<tr><td><a href="/companyInformation/form.do?cmpy_id=' + cmpy + '">' + name + '</a></td><td><a href="#viewer" onclick="openPopup(\'' + edge + '\');return false;">' + tmpl +
  '</a></td><td class="alignC">' + form + '</td><td class="alignC">' + at + '</td><td class="alignC">' + circ + '</td></tr>';

test('PSE Edge dates, times and free-text dividend rates', () => {
  assert.equal(edgeDay('Feb 08, 2027'), '2027-02-08'); assert.equal(edgeDay('Feb 9, 2027'), '2027-02-09'); assert.equal(edgeDay('TBA'), null);
  assert.equal(edgeStamp('Oct 12, 2026 09:41 AM'), '2026-10-12T09:41'); assert.equal(edgeStamp('Oct 05, 2026 05:41 PM'), '2026-10-05T17:41');
  assert.equal(edgeStamp('Oct 05, 2026 12:10 PM'), '2026-10-05T12:10'); assert.equal(edgeStamp('Oct 05, 2026 12:10 AM'), '2026-10-05T00:10');
  assert.equal(pesoAmount('Php 2.0625 per share'), 2.0625); assert.equal(pesoAmount('P0.50'), 0.5); assert.equal(pesoAmount('Php0.38/share'), 0.38);
  assert.equal(pesoAmount('PhP 1.10'), 1.1); assert.equal(pesoAmount('Eighty Three Centavos (Php 0.83) per share'), 0.83); assert.equal(pesoAmount('0.25'), 0.25);
  assert.equal(pesoAmount('Php0.20 regular and Php0.10 special'), 0.3, 'a regular and a special add up');
  assert.equal(pesoAmount('Php0.05 per share or a total of Php1,234,567.00'), 0.05, 'a quoted total is not added');
  assert.equal(pesoAmount('$0.01 per share (USD)'), null); assert.equal(pesoAmount('CAD 0.44'), null);
  assert.equal(pesoAmount('20% of the outstanding capital stock'), null); assert.equal(pesoAmount('TBA'), null);
  // Formats seen on 13 Oct 2026 for RCR and CNPF
  assert.equal(pesoAmount('0.1117/share'), 0.1117); assert.equal(pesoAmount('Thirty Centavos'), 0.3); assert.equal(pesoAmount('Sixty Centavos'), 0.6);
  assert.equal(pesoAmount('One Hundred Twenty Five Pesos'), 125); assert.equal(pesoAmount('Lots of Centavos'), null);
});

test('dividends table: rows, ids, cash amounts only for cash, and the page count', () => {
  const html = '<span class="count">[1 /\n11]\n[Total 512]</span><table><tr><th>Company Name</th></tr>' +
    divRow(260, 'BDO Unibank, Inc.', 'COMMON', 'Cash', 'P1.00', 'Oct 15, 2026', 'Oct 16, 2026', 'Oct 30, 2026', 'C06545-2026', 'a'.repeat(32)) +
    divRow(13, 'A Brown Company, Inc.', 'BRNPB Series B', 'Cash', 'Php 2.0625 per share', 'Feb 08, 2027', 'Feb 9, 2027', 'Feb 23, 2027', 'C00595-2026', 'b'.repeat(32)) +
    divRow(99, 'Stock Co.', 'COMMON', 'Stock', '20%', 'Nov 02, 2026', 'Nov 3, 2026', 'TBA', 'C1-2026', 'c'.repeat(32)) + '</table>';
  const d = parseDividends(html);
  assert.equal(d.page, 1); assert.equal(d.pages, 11); assert.equal(d.items.length, 3);
  assert.deepEqual(d.items[0], { cmpyId: '260', company: 'BDO Unibank, Inc.', security: 'COMMON', type: 'Cash', rate: 'P1.00', amount: 1,
    exDate: '2026-10-15', recordDate: '2026-10-16', payDate: '2026-10-30', circular: 'C06545-2026', edgeNo: 'a'.repeat(32) });
  assert.equal(d.items[2].amount, null); assert.equal(d.items[2].payDate, null);
});

test('a stock’s dividend year: common cash in the last 365 days, the yield, the next ex-date, duplicates once', () => {
  const div = (exDate, amount, o) => Object.assign({ cmpyId: '260', security: 'COMMON', type: 'Cash', rate: 'P' + amount, amount, exDate, circular: 'C' + exDate }, o);
  const divs = [div('2026-10-15', 1), div('2026-05-10', 1), div('2026-05-10', 1), div('2025-11-20', 1), div('2025-10-01', 9),
    div('2026-04-01', 5, { security: 'BDOP Preferred' }), div('2026-03-01', null, { rate: 'TBA' }), div('2026-02-01', 3, { cmpyId: '1' })];
  const s = dividendStats(divs, '260', '2026-10-12', 112);
  assert.equal(s.div12m, 2, '20 Nov 2025 and 10 May 2026 (once), not the preferred, not a year and more ago');
  assert.equal(s.div12mCount, 3); assert.equal(s.div12mPartial, true, 'one rate could not be read');
  assert.equal(s.yield12m, 1.79);
  assert.deepEqual(s.nextEx, { exDate: '2026-10-15', payDate: undefined, type: 'Cash', rate: 'P1', amount: 1, edgeNo: undefined });
  assert.deepEqual(dividendStats([], '260', '2026-10-12', 112), { div12m: null, div12mCount: 0, div12mPartial: false, yield12m: null, nextEx: null });
});

test('filings: the ones worth reading, labelled; director trades and share counts left out', () => {
  const f = parseFilings('[2 / 3]<table>' + filingRow(260, 'BDO Unibank, Inc.', 'Change in Shareholdings of Directors and Principal Officers', '13-1', 'Oct 12, 2026 09:41 AM', 'C07348-2026', 'd'.repeat(32)) +
    filingRow(260, 'BDO Unibank, Inc.', '[Amend-1]Material Information/Transactions', '4-30', 'Oct 12, 2026 02:05 PM', 'C07350-2026', 'e'.repeat(32)) +
    filingRow(83, 'International Container Terminal Services, Inc.', 'Quarterly Report', '17-2', 'Oct 10, 2026 04:10 PM', 'CR1-2026', 'f'.repeat(32)) + '</table>');
  assert.equal(f.page, 2); assert.equal(f.pages, 3); assert.equal(f.items[1].at, '2026-10-12T14:05');
  assert.equal(newsKind('Change in Number of Issued and/or Outstanding Shares'), null);
  assert.deepEqual(newsKind('[Amend-1]Material Information/Transactions'), { kind: 'material', label: 'Material information', amended: true });
  const news = newsFor(f.items.concat(f.items), ['260', '83'], '2026-10-01T00:00', 10);
  assert.deepEqual(news.map(n => n.kind + ':' + n.cmpyId), ['material:260', 'results:83'], 'newest first, each filing once');
  assert.equal(news[0].label, 'Material information (amended)');
  assert.equal(newsFor(f.items, ['260'], '2026-10-12T14:05', 10).length, 0, 'nothing newer than the cutoff');
  const buybacks = ['09', '10', '12'].map(d => ({ cmpyId: '5', company: 'URC', template: 'Share Buy-Back Transactions', at: '2026-10-' + d + 'T08:00', circular: 'B' + d }));
  const bb = newsFor(buybacks, ['5'], '2026-10-01T00:00', 10);
  assert.equal(bb.length, 1, 'daily buyback reports collapse to the latest'); assert.equal(bb[0].at, '2026-10-12T08:00');
});

test('IPO notices grouped by company, latest first, only recent ones', () => {
  const n = parseNotices('<table>' + ['Mynt, Inc.: Initial Public Offering – Final Prospectus|Oct 05, 2026 05:37 PM|LN00170-2026',
    'Mynt, Inc.: Initial Public Offering - Final Offer Price|Oct 02, 2026 08:43 AM|LN00165-2026',
    'Ayala Land, Inc.: Stock Ownership Plan - Additional Listing|Oct 09, 2026 05:30 PM|LN00178-2026',
    '[Amend-2]Mynt, Inc.: Initial Public Offering – Preliminary Terms and Conditions|Sep 23, 2026 07:30 PM|LN00150-2026',
    'Old Co.: Initial Public Offering – Final Prospectus|Apr 01, 2026 09:00 AM|LN00010-2026']
    .map(s => { const [a, b, c] = s.split('|'); return '<tr><td><a href="#viewer" onclick="openPopup(\'' + '9'.repeat(32) + '\');return false;">' + a + '</a></td><td>' + b + '</td><td>' + c + '</td></tr>'; }).join('') + '</table>');
  const g = ipoGroups(n.items, '2026-10-13');
  assert.equal(g.length, 1, 'stock-plan listings and IPOs over 90 days old are left out');
  assert.equal(g[0].company, 'Mynt, Inc.'); assert.equal(g[0].latestAt, '2026-10-05T17:37');
  assert.deepEqual(g[0].notices.map(x => x.title), ['Final Prospectus', 'Final Offer Price', 'Preliminary Terms and Conditions (amended)'],
    'an amended notice joins its company');
});

test('applyEvents: board rows gain their dividend year; ex-dates within 45 days, news within 14 days', () => {
  const board = [{ symbol: 'BDO', name: 'BDO Unibank', cmpyId: '260', close: 112 }, { symbol: 'ICT', name: 'ICTSI', cmpyId: '83', close: 884 }];
  const raw = {
    dividends: [{ cmpyId: '260', security: 'COMMON', type: 'Cash', rate: 'P1.00', amount: 1, exDate: '2026-10-15', payDate: '2026-10-30', circular: 'C1' },
      { cmpyId: '260', security: 'COMMON', type: 'Cash', rate: 'P1.00', amount: 1, exDate: '2026-05-10', circular: 'C2' },
      { cmpyId: '83', security: 'COMMON', type: 'Cash', rate: 'P9', amount: 9, exDate: '2027-01-30', circular: 'C3' }],
    filings: [{ cmpyId: '83', company: 'ICTSI', template: 'Press Release', at: '2026-10-12T09:00', circular: 'X1' },
      { cmpyId: '83', company: 'ICTSI', template: 'Press Release', at: '2026-09-20T09:00', circular: 'X2' },
      { cmpyId: '7', company: 'Other', template: 'Press Release', at: '2026-10-12T09:00', circular: 'X3' }],
    notices: [], failed: []
  };
  const ev = applyEvents(board, raw, '2026-10-12', '2026-10-13');
  assert.equal(board[0].yield12m, 0.89); assert.equal(board[0].nextEx.exDate, '2026-10-15');
  assert.deepEqual(ev.dividends.map(d => d.symbol + ':' + d.exDate), ['BDO:2026-10-15'], 'ICT’s January ex-date is past the 45 days');
  assert.deepEqual(ev.news.map(n => n.symbol + ':' + n.at), ['ICT:2026-10-12T09:00']);
  assert.deepEqual(ev.ipos, []);
  const none = applyEvents(board, { failed: ['dividends', 'news', 'ipos'] }, '2026-10-12', '2026-10-13');
  assert.equal(none.dividends, null); assert.equal(none.news, null); assert.deepEqual(none.failed, ['dividends', 'news', 'ipos']);
});

test('watchlist event alerts: the last day to buy before an ex-date, and news since the last refresh', () => {
  assert.equal(addSessions('2026-10-09', 1), '2026-10-12', 'Friday to Monday'); assert.equal(addSessions('2026-10-12', 2), '2026-10-14');
  const rows = { BDO: { cmpyId: '260', close: 112 }, ICT: { cmpyId: '83', close: 884 } };
  const raw = {
    dividends: [{ cmpyId: '260', security: 'COMMON', type: 'Cash', rate: 'P1.00', amount: 1, exDate: '2026-10-14', circular: 'C1' }],
    filings: [{ cmpyId: '83', company: 'ICTSI', template: 'Quarterly Report', at: '2026-10-12T16:10', circular: 'R1' },
      { cmpyId: '83', company: 'ICTSI', template: 'Press Release', at: '2026-10-11T09:00', circular: 'R2' }]
  };
  const a = watchEventAlerts({ BDO: {}, ICT: {} }, rows, raw, '2026-10-12', '2026-10-11T17:00');
  assert.deepEqual(a.map(x => x.kind + ':' + x.symbol), ['exdiv:BDO', 'news:ICT']);
  assert.equal(a[0].text, 'BDO goes ex-dividend 14 Oct: own it by the 13 Oct close to get ₱1 a share');
  assert.equal(a[1].text, 'ICT: Quarterly or annual report (12 Oct)');
  assert.equal(watchEventAlerts({ BDO: {} }, rows, raw, '2026-10-13', '2026-10-12T17:00').length, 0, 'a day later the ex-date alert does not repeat');
  const bbRaw = { filings: [{ cmpyId: '83', company: 'ICTSI', template: 'Share Buy-Back Transactions', at: '2026-10-12T16:10', circular: 'B1' }] };
  assert.equal(watchEventAlerts({ ICT: {} }, rows, bbRaw, '2026-10-12', '2026-10-11T17:00').length, 0, 'a buyback report is not pushed');
});
