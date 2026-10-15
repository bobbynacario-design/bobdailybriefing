import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {recordRunHealth} from '../lib/feed-health.js';

// Exact-date round-trip prices from Google Flights (through SerpApi, Bob's
// free plan: 250 searches a month), for the trips that matter: each account's
// leave and poker trips (hotel-trips-<uid>) and the best dates of each fare
// watch (flights-watch-<uid>). Once per Philippine day; a price under 20
// hours old is reused; at most PER_RUN searches a run and MONTH_CAP a month.
// Results go to exact-prices-<uid>. The key travels only in the request URL
// to serpapi.com and is never logged or stored.
export const PER_RUN = 10, MONTH_CAP = 230, REUSE_HOURS = 20, PER_ACCOUNT = 6;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// The shared core registers itself on globalThis (it also runs in the page).
await import('../lib/flights-core.js');
const FlightsCore = globalThis.FlightsCore;

export function keyOf(r) { return [r.origin, r.destination, r.depart, r.ret].join('|'); }

// What to price for one account, most useful first: leave windows, poker
// trips, then fare watches at the dates of their best scouted fare.
export function requestsFor({trips, watch, flights, fx, today, now}) {
  const out = [], seen = new Set();
  const push = (r) => {
    if (!/^[A-Z]{3}$/.test(r.destination || '') || !ISO.test(r.depart || '') || !ISO.test(r.ret || '') || r.depart <= today || r.ret <= r.depart || seen.has(keyOf(r))) return;
    seen.add(keyOf(r)); out.push(r);
  };
  const list = trips && Array.isArray(trips.trips) ? trips.trips : [];
  for (const kind of ['leave', 'poker']) list.filter(t => t && t.kind === kind).forEach(t =>
    push({origin: 'MNL', destination: (t.airports || [])[0], city: String(t.city || '').slice(0, 60), depart: t.checkIn, ret: t.checkOut, reason: kind, ref: String(t.id || '').slice(0, 160)}));
  const items = watch && watch.items && typeof watch.items === 'object' ? watch.items : {};
  Object.keys(items).sort().forEach(id => {
    const r = flights ? FlightsCore.fareWatch(items[id], flights, fx, now) : null;
    if (r && r.best) push({origin: r.best.fare.origin, destination: r.best.fare.destination, city: r.watch.city, depart: r.best.fare.departureDate, ret: r.best.fare.returnDate, reason: 'watch', ref: id});
  });
  return out.slice(0, PER_ACCOUNT);
}

// The parts of a Google Flights answer worth keeping: the cheapest option,
// the cheapest per airline, and Google's own read of the price.
export function parseSerp(json) {
  const options = [...(json && json.best_flights || []), ...(json && json.other_flights || [])].filter(o => o && Number.isFinite(o.price) && o.price > 0 && Array.isArray(o.flights) && o.flights.length);
  if (!options.length) return null;
  const airlineOf = o => [...new Set(o.flights.map(f => String(f.airline || '').slice(0, 40)))].join(' + ');
  const sorted = options.slice().sort((a, b) => a.price - b.price);
  const byAirline = {};
  sorted.forEach(o => { const a = airlineOf(o); if (a && byAirline[a] == null) byAirline[a] = o.price; });
  const best = sorted[0], pi = json.price_insights || {};
  const range = Array.isArray(pi.typical_price_range) && pi.typical_price_range.length === 2 && pi.typical_price_range.every(Number.isFinite) ? pi.typical_price_range : null;
  const url = String(json.search_metadata && json.search_metadata.google_flights_url || '');
  return {price: best.price, airline: airlineOf(best), flights: best.flights.map(f => String(f.flight_number || '').slice(0, 12)).filter(Boolean).join(' / '),
    stops: best.flights.length - 1, departTime: String(best.flights[0].departure_airport && best.flights[0].departure_airport.time || '').slice(11, 16),
    byAirline: Object.fromEntries(Object.entries(byAirline).slice(0, 6)), level: /^(low|typical|high)$/.test(pi.price_level || '') ? pi.price_level : '',
    typical: range ? {low: range[0], high: range[1]} : null, googleUrl: /^https:\/\/www\.google\.com\/travel\/flights/.test(url) ? url : '', options: options.length};
}

export async function searchSerp(r, apiKey, fetchImpl = fetch) {
  const u = new URL('https://serpapi.com/search.json');
  Object.entries({engine: 'google_flights', departure_id: r.origin, arrival_id: r.destination, outbound_date: r.depart, return_date: r.ret, type: '1', currency: 'PHP', hl: 'en', gl: 'ph', adults: '1', travel_class: '1'})
    .forEach(([k, v]) => u.searchParams.set(k, v));
  u.searchParams.set('api_key', apiKey);
  const res = await fetchImpl(u, {signal: AbortSignal.timeout(60000)});
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error) throw Error('SerpApi answered ' + res.status + (json && json.error ? ': ' + String(json.error).slice(0, 80) : ''));
  return parseSerp(json);
}

// One account: reuse fresh prices, search the rest within the run's budget.
export async function priceAccount({uid, requests, prior, now, budget, search}) {
  const items = {}, priorItems = prior && prior.items || {};
  let searched = 0, failed = 0;
  for (const r of requests) {
    const k = keyOf(r), old = priorItems[k];
    if (old && now - Date.parse(old.checkedAt || '') < REUSE_HOURS * 3600000) { items[k] = {...old, reason: r.reason, ref: r.ref, city: r.city}; continue; }
    if (!budget.take()) { if (old) items[k] = old; continue; }
    try { const p = await search(r); searched++; items[k] = {...r, checkedAt: new Date(now).toISOString(), result: p}; }
    catch (e) { failed++; if (old) items[k] = old; }
  }
  return {doc: {uid, kind: 'exact-prices', checkedAt: new Date(now).toISOString(), items}, searched, failed};
}

async function main() {
  const started = Date.now(), dryRun = process.argv.includes('--dry-run'), apiKey = process.env.SERPAPI_KEY || '';
  const {initializeApp, cert, applicationDefault} = await import('firebase-admin/app');
  const {getFirestore, FieldValue} = await import('firebase-admin/firestore');
  const root = dirname(fileURLToPath(import.meta.url)), keyFile = join(root, '../radar/serviceAccountKey.json');
  initializeApp({projectId: 'pokerhq-a67e4', credential: existsSync(keyFile) ? cert(JSON.parse(readFileSync(keyFile, 'utf8'))) : applicationDefault()});
  const db = getFirestore(), C = db.collection('briefings-bob'), now = Date.now();
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(now));
  if (!apiKey) { console.log('No SerpApi key; exact prices skipped.'); return; }
  const [flights, ph, budgetSnap] = await Promise.all([C.doc('flights-latest').get(), C.doc('radar-ph').get(), C.doc('serpapi-budget').get()]);
  const month = today.slice(0, 7), b = budgetSnap.exists && budgetSnap.data().month === month ? budgetSnap.data() : {month, count: 0};
  let used = 0;
  const budget = {take: () => { if (used >= PER_RUN || b.count + used >= MONTH_CAP) return false; used++; return true; }};
  const accounts = new Map();
  (await C.where('kind', '==', 'hotel-trips').get()).docs.forEach(d => { const v = d.data(); if (v.uid && d.id === 'hotel-trips-' + v.uid) accounts.set(v.uid, {...(accounts.get(v.uid) || {}), trips: v}); });
  (await C.where('kind', '==', 'flights-watch').get()).docs.forEach(d => { const v = d.data(); if (v.uid && d.id === 'flights-watch-' + v.uid) accounts.set(v.uid, {...(accounts.get(v.uid) || {}), watch: v}); });
  let searched = 0, failed = 0, written = 0;
  for (const [uid, a] of accounts) {
    const prior = await C.doc('exact-prices-' + uid).get();
    if (prior.exists && String(prior.data().checkedAt || '').slice(0, 10) === new Date(now).toISOString().slice(0, 10) && !process.argv.includes('--force')) continue;
    const requests = requestsFor({trips: a.trips, watch: a.watch, flights: flights.exists ? flights.data() : null, fx: ph.exists ? ph.data() : null, today, now});
    const r = await priceAccount({uid, requests, prior: prior.exists ? prior.data() : null, now, budget, search: req => searchSerp(req, apiKey)});
    searched += r.searched; failed += r.failed;
    console.log('account ' + uid.slice(0, 6) + '…: ' + requests.length + ' trips, ' + r.searched + ' searched, ' + r.failed + ' failed');
    if (!dryRun) { await C.doc('exact-prices-' + uid).set(r.doc); written++; }
    else console.log(JSON.stringify(Object.values(r.doc.items).map(i => [i.reason, i.destination, i.depart, i.ret, i.result && i.result.price, i.result && i.result.airline, i.result && i.result.level])));
  }
  if (!dryRun) {
    await C.doc('serpapi-budget').set({month, count: b.count + used, updatedAt: new Date(now).toISOString()});
    await recordRunHealth(db, 'flights-exact', {status: failed && !searched ? 'failed' : 'ok', asOf: today, durationMs: Date.now() - started, message: searched + ' searches (' + (b.count + used) + '/' + MONTH_CAP + ' this month), ' + failed + ' failed, ' + written + ' accounts.'});
  }
  console.log(JSON.stringify({searched, failed, monthUsed: b.count + used, accounts: accounts.size}));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error('Exact prices failed:', e.message); process.exitCode = 1; });
