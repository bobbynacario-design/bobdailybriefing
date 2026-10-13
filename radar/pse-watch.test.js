import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockMetrics, watchAlerts } from './ph-metrics.js';
import { refreshWatchlists, watchSymbols } from './pse-watch.js';

function weekdays(end, n, fn) {
  var out = [], t = Date.parse(end + 'T00:00:00Z');
  while (out.length < n) {
    var d = new Date(t), wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10));
    t -= 86400000;
  }
  return out.map(function (date, i) { var c = fn(i); return { date: date, open: c, high: c, low: c, close: c, value: 1 }; });
}

test('a stock row flags a 200-day cross and a new 52-week low from the last session only', () => {
  // 220 rising days from 100, then a drop to 90: crosses below the 200-day and breaks the year low.
  const bars = weekdays('2026-10-12', 221, i => (i < 220 ? 100 + i * 0.1 : 90));
  const s = stockMetrics(bars);
  assert.equal(s.crossed200, 'down'); assert.equal(s.newLow52, true); assert.equal(s.newHigh52, false);
  const next = stockMetrics(bars.concat([{ date: '2026-10-13', open: 91, high: 91, low: 91, close: 91, value: 1 }]));
  assert.equal(next.crossed200, null, 'still below: no second cross'); assert.equal(next.newLow52, false);
  const flat = stockMetrics(weekdays('2026-10-12', 260, () => 14));
  assert.equal(flat.newLow52, false); assert.equal(flat.newHigh52, false, 'an unmoving stock sets no new low or high');
});

test('watchlist alerts: one per stock, own price first, only for the session asked, signed moves', () => {
  const row = (o) => Object.assign({ asOf: '2026-10-12', close: 100, dayChangePct: 0, newLow52: false, newHigh52: false, crossed200: null }, o);
  const alerts = watchAlerts(
    { BDO: { target: 115 }, JGS: {}, AEV: {}, PLUS: { target: 5 }, OLD: {}, NOROW: {} },
    { BDO: row({ close: 112, newLow52: true }), JGS: row({ dayChangePct: -4.09 }), AEV: row({ newHigh52: true }),
      PLUS: row({ close: 7.44, crossed200: 'up' }), OLD: row({ asOf: '2026-10-09', dayChangePct: -9 }) },
    '2026-10-12');
  assert.deepEqual(alerts.map(a => a.kind + ':' + a.symbol), ['target:BDO', 'cross:PLUS', 'move:JGS', 'high:AEV']);
  assert.equal(alerts[0].text, 'BDO ₱112.00, at or below your ₱115.00');
  assert.equal(alerts[2].text, 'JGS −4.1% today');
  assert.equal(watchAlerts({ X: {} }, { X: row({ dayChangePct: 3.9 }) }, '2026-10-12').length, 0, 'under 4% is not news');
});

test('watch codes: PSE-style only, sorted, capped at 30', () => {
  const items = { bdo: {}, 'X Y': {}, '2GO': {}, BDO: {} };
  for (let i = 0; i < 40; i++) items['S' + String(i).padStart(2, '0')] = {};
  const syms = watchSymbols({ items });
  assert.equal(syms.length, 30); assert.equal(syms[0], '2GO'); assert.ok(syms.includes('BDO'));
  assert.ok(!syms.includes('bdo') && !syms.includes('X Y'));
});

test('refreshWatchlists fetches codes beyond the PSEi once, writes each list its own rows and alerts', async () => {
  const updates = [];
  const list = (id, data) => ({ id, data: () => data, ref: { update: async (u) => updates.push({ id, u }) } });
  const docs = [
    list('pse-watch-a', { uid: 'a', kind: 'pse-watch', items: { BDO: { target: 115 }, MREIT: {} }, rows: { MREIT: { symbol: 'MREIT', cmpyId: '9', securityId: '8', name: 'MREIT, Inc.' } } }),
    list('pse-watch-b', { uid: 'b', kind: 'pse-watch', items: { MREIT: {}, NOPE: {} } }),
    list('pse-watch-x', { kind: 'pse-watch', items: { BDO: {} } })   // no uid: not a person's list
  ];
  const db = { collection: () => ({ where: (f, op, v) => { assert.deepEqual([f, op, v], ['kind', '==', 'pse-watch']); return { get: async () => ({ docs }) }; } }) };
  const calls = [];
  const fetchStock = async (sym, known) => {
    calls.push(sym + ':' + (known ? known.cmpyId : '-'));
    if (sym === 'NOPE') throw new Error('not found on PSE Edge');
    return { cmpyId: '9', securityId: '8', name: known && known.name, page: { marketCap: 1 }, bars: weekdays('2026-10-12', 30, () => 14) };
  };
  const ph = { board: [{ symbol: 'BDO', asOf: '2026-10-12', close: 112, dayChangePct: -0.88 }], breadth: { asOf: '2026-10-12' } };
  const sum = await refreshWatchlists(db, 'briefings-bob', ph, '2026-10-13', { fetchStock });
  assert.deepEqual(calls, ['MREIT:9', 'NOPE:-'], 'each extra code once, cached ids reused');
  assert.deepEqual(sum, { lists: 2, extra: 2, fetched: 1, missing: 1, alerts: 1 });
  assert.equal(updates.length, 2);
  const a = updates.find(u => u.id === 'pse-watch-a').u, b = updates.find(u => u.id === 'pse-watch-b').u;
  assert.deepEqual(Object.keys(a.rows), ['MREIT'], 'PSEi stocks stay on radar-ph'); assert.equal(a.rows.MREIT.name, 'MREIT, Inc.');
  assert.deepEqual(a.alerts.map(x => x.kind + ':' + x.symbol), ['target:BDO']); assert.equal(a.alertsAsOf, '2026-10-12');
  assert.deepEqual(b.missing, ['NOPE']); assert.deepEqual(b.alerts, []);
  assert.ok(!('items' in a) && !('uid' in a), 'the person’s own fields are never written');
  updates.length = 0;
  await refreshWatchlists(db, 'briefings-bob', ph, '2026-10-13', { fetchStock, dryRun: true });
  assert.equal(updates.length, 0, 'a dry run writes nothing');

  // With dividends and filings: the event alerts follow the price alerts, a
  // non-PSEi row gets its dividend year, and each list gets its own news.
  const events = {
    calendar:{verified:true,years:['2026'],closedDays:[]},
    dividends: [{ cmpyId: '9', security: 'COMMON', type: 'Cash', rate: 'P0.25', amount: 0.25, exDate: '2026-10-14', circular: 'D1' },
      { cmpyId: '9', security: 'COMMON', type: 'Cash', rate: 'P0.25', amount: 0.25, exDate: '2026-07-14', circular: 'D2' }],
    filings: [{ cmpyId: '9', company: 'MREIT, Inc.', template: 'Press Release', at: '2026-10-12T15:00', circular: 'F1' }]
  };
  ph.board[0].cmpyId = '260';
  await refreshWatchlists(db, 'briefings-bob', ph, '2026-10-13', { fetchStock, events });
  const a2 = updates.find(u => u.id === 'pse-watch-a').u;
  assert.deepEqual(a2.alerts.map(x => x.kind + ':' + x.symbol), ['target:BDO', 'exdiv:MREIT', 'news:MREIT']);
  assert.equal(a2.rows.MREIT.yield12m, 1.79, '0.25 paid in July on a 14.00 close');
  assert.equal(a2.rows.MREIT.nextEx.exDate, '2026-10-14');
  assert.equal(a2.alertsCalendarVerified,true);
  assert.deepEqual(a2.news.map(n => n.symbol + ':' + n.kind), ['MREIT:press']);
});

test('non-index watch rows exclude intraday and future bars before the close',async()=>{
  let update;
  const data={uid:'a',items:{MREIT:{target:15}}};
  const db={collection:()=>({where:()=>({get:async()=>({docs:[{data:()=>data,ref:{update:async(u)=>{update=u;}}}]})})})};
  const bars=weekdays('2026-10-14',30,i=>i===29?1:i===28?2:14);
  await refreshWatchlists(db,'briefings-bob',{board:[],breadth:{asOf:'2026-10-12'}},'2026-10-13',
    {minutesNow:600,fetchStock:async()=>({bars,page:{marketCap:1},cmpyId:'9',securityId:'8',name:'MREIT'})});
  assert.equal(update.rows.MREIT.asOf,'2026-10-12');assert.equal(update.rows.MREIT.close,14);
  assert.equal(update.alertsCalendarVerified,false);
});
