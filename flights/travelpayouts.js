import {createHash} from 'node:crypto';
import {ORIGINS,DOMESTIC} from './config.js';
import {HOTEL_CITIES} from './hotel-cities.js';

// Travelpayouts (Aviasales) Data API: the cheapest round trips Aviasales users
// found in recent searches, budget airlines included. Free with Bob's token
// (TRAVELPAYOUTS_TOKEN; GitHub secret). These are recent search prices, not
// live quotes: each record says when it was found and is dropped after three
// days. Only budget airlines are kept; PAL and Cathay come from their own pages.
const id = v => createHash('sha256').update(v).digest('hex').slice(0,20);
export const TP_AIRLINES = {
  '5J':'Cebu Pacific','DG':'Cebu Pacific','Z2':'AirAsia','AK':'AirAsia','D7':'AirAsia','FD':'AirAsia','QZ':'AirAsia','KT':'AirAsia',
  'TR':'Scoot','UO':'HK Express','7C':'Jeju Air','LJ':'Jin Air','BX':'Air Busan','ZE':'Eastar Jet','TW':"T'way Air",'RS':'Air Seoul',
  'VJ':'VietJet','VZ':'VietJet','GK':'Jetstar','3K':'Jetstar','JQ':'Jetstar','IT':'Tigerair Taiwan','MM':'Peach','ZG':'ZIPAIR','9C':'Spring Airlines'
};
// City codes the API accepts; the record names the real airports.
export const TP_ROUTES = [
  ...['HKG','TYO','OSA','SEL','PUS','TPE','KHH','SIN','KUL','BKK','SGN','HAN','DAD','DPS','BKI','MFM','FUK','NGO','OKA','CJU'].map(d => ['MNL',d]),
  ...['HKG','TYO','OSA','SEL','PUS','SIN','TPE','KUL','BKK'].map(d => ['CEB',d]),
  ...['HKG','SIN','SEL','TYO','BKK','KUL','TPE'].map(d => ['CRK',d]),
  ...['MPH','IAO','ENI','PPS','TAG','CEB'].map(d => ['MNL',d])
];
const AIRPORT_CITY = {};
HOTEL_CITIES.forEach(c => c.airports.forEach(a => { if (!AIRPORT_CITY[a]) AIRPORT_CITY[a] = c.city; }));
const ORIGIN_NAME = {MNL:'Manila',CEB:'Cebu',CRK:'Clark'};
const MAX_AGE_DAYS = 3, PER_ROUTE = 6;

// "search_date=11102026" in the link: the day the price was found.
export function foundDate(link) {
  const m = /[?&]search_date=(\d{2})(\d{2})(\d{4})\b/.exec(String(link || ''));
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
}
export function normalize(rows, checkedAt) {
  const today = checkedAt.slice(0,10), out = [], seen = new Set();
  for (const r of rows || []) {
    const airline = TP_AIRLINES[r && r.airline];
    const origin = r && r.origin_airport, destination = r && r.destination_airport;
    const dep = String(r && r.departure_at || '').slice(0,10), ret = String(r && r.return_at || '').slice(0,10), found = foundDate(r && r.link);
    if (!airline || !ORIGINS.includes(origin) || !/^[A-Z]{3}$/.test(destination || '') || ORIGINS.includes(destination) && !DOMESTIC[destination]) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dep) || !/^\d{4}-\d{2}-\d{2}$/.test(ret) || dep <= today || ret <= dep) continue;
    if (!(Number.isFinite(r.price) && r.price > 0) || !found || (Date.parse(today) - Date.parse(found)) / 86400000 > MAX_AGE_DAYS) continue;
    if (!/^\/search\/[A-Za-z0-9]+\?/.test(r.link || '')) continue;
    const key = ['tp', airline, origin, destination, dep, ret].join('|');
    if (seen.has(key)) continue; seen.add(key);
    // Aviasales names itself in Russian on some results.
    const direct = r.transfers === 0 && r.return_transfers === 0, seller = /авиасейлс|aviasales/i.test(String(r.gate || '')) ? 'Aviasales' : String(r.gate || '').slice(0,40);
    out.push({id:id(key),kind:'advertised-fare',airline,origin,destination,originName:ORIGIN_NAME[origin],destinationName:DOMESTIC[destination] || AIRPORT_CITY[destination] || destination,
      departureDate:dep,returnDate:ret,tripType:'round-trip',cabin:'Economy',currency:'PHP',amount:Math.round(r.price),priceLabel:'PHP '+Math.round(r.price),
      priceBasis:'Round-trip price an Aviasales user found on '+found+(seller ? ' (sold by '+seller+')' : '')+', for one adult in economy. A recent search price, not a live quote.',
      searched:{foundOn:found,seller},taxesIncluded:null,travelTaxIncluded:null,checkedBaggageIncluded:null,stops:direct ? 0 : null,
      fees:'Confirm taxes, fees and Philippine travel tax at checkout.',baggage:'Confirm baggage allowance; budget fares often exclude checked bags.',
      connections:direct ? 'Direct both ways in the search result; reconfirm flight times.' : 'Connection in at least one direction; check times before booking.',
      bookingEnd:'',travelPeriod:'Exact dates from the search result; other dates may cost more.',sourceUrl:'https://www.aviasales.com/',
      bookingUrl:'https://www.aviasales.com'+r.link,checkedAt,airlineSeen:'',terms:'Found through Aviasales'+(seller ? ' from '+seller : '')+'. Prices change quickly; open the search to see the current price before booking.'});
  }
  // The cheapest few dates per route and airline.
  const groups = new Map();
  out.forEach(d => { const k = d.airline + '|' + d.origin + '|' + d.destination; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); });
  return [...groups.values()].flatMap(list => list.sort((a, b) => a.amount - b.amount || a.departureDate.localeCompare(b.departureDate)).slice(0, PER_ROUTE));
}

// This month and the next two, per route. One request each, a short pause
// between them, no retries. Returns a source row like the page readers.
export async function fetchTravelpayouts(token, checkedAt, opts = {}) {
  const source = {id:'aviasales',airline:'Aviasales data',label:'Recent searches · budget airlines incl. Cebu Pacific',type:'travelpayouts',url:'https://www.aviasales.com/'};
  if (!token) return {...source,checkedAt,status:'unavailable',items:[],message:'No Travelpayouts token configured.'};
  const fetchImpl = opts.fetchImpl || fetch, pause = opts.pause ?? 250, routes = opts.routes || TP_ROUTES;
  const start = new Date(checkedAt), months = [0,1,2].map(n => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1)).toISOString().slice(0,7));
  const rows = []; let failed = 0, calls = 0;
  for (const [origin, destination] of routes) for (const month of months) {
    calls++;
    try {
      const u = new URL('https://api.travelpayouts.com/aviasales/v3/prices_for_dates');
      Object.entries({origin,destination,departure_at:month,unique:'false',sorting:'price',direct:'false',currency:'php',limit:'30',one_way:'false'}).forEach(([k,v]) => u.searchParams.set(k,v));
      const r = await fetchImpl(u, {headers:{'X-Access-Token':token,accept:'application/json'},signal:AbortSignal.timeout(20000)});
      const j = r.ok ? await r.json() : null;
      if (!j || j.success === false) { failed++; continue; }
      rows.push(...(Array.isArray(j.data) ? j.data : []));
    } catch (e) { failed++; }
    if (pause) await new Promise(res => setTimeout(res, pause));
  }
  const items = normalize(rows, checkedAt);
  if (failed === calls) return {...source,checkedAt,status:'unavailable',items:[],message:'Travelpayouts did not answer ('+failed+' requests failed).'};
  return {...source,checkedAt,status:items.length ? 'ok' : 'unavailable',items,
    message:items.length ? items.length+' recent-search round trips kept from '+rows.length+' results'+(failed ? '; '+failed+' of '+calls+' requests failed' : '') : 'No recent budget-airline round trips in the results.'};
}
