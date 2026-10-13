import {HOTEL_CITIES,HOTEL_API,STAY,HOTELS_PER_CITY,STAY_TTL_HOURS,LIST_TTL_DAYS,MIN_RATING,MIN_REVIEWS,HOTEL_TYPES} from './hotel-cities.js';
// Hotel rates to pair with the flight scout. Xotelo serves Tripadvisor's
// partner rates (Booking.com, Agoda, Trip.com, …) per room per night for
// exact dates, free and without a key. No model calls, no booking, no
// anti-bot workaround; a failed call leaves that hotel unpriced.
const ISO=/^\d{4}-\d{2}-\d{2}$/;
export const MAX_STAYS_PER_CITY=2;
export const MAX_CALLS=420;
export function cityFor(code) { return HOTEL_CITIES.find(c=>c.airports.includes(code)) || null; }
function economy(cabin) { return /economy/i.test(cabin || '') && !/premium/i.test(cabin || ''); }
function nightsBetween(a,b) { return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000); }
// Two upcoming Friday–Sunday stays, independent of a flight quote.
export function weekendStays(today) {
  if(!ISO.test(today || '') || !Number.isFinite(Date.parse(today+'T00:00:00Z')) || new Date(today+'T00:00:00Z').toISOString().slice(0,10)!==today) throw Error('Invalid hotel scout date');
  const base=new Date(today+'T00:00:00Z');
  const offset=(5-base.getUTCDay()+7)%7 || 7;
  const date=days=>new Date(base.getTime()+days*86400000).toISOString().slice(0,10);
  return [offset,offset+7].map(days=>({checkIn:date(days),checkOut:date(days+2),nights:2,kind:'weekend'}));
}
// The stays worth pricing: per city, the dates of its cheapest fresh economy
// return fare, then the cheapest from each other departure airport when its
// dates differ (the board ranks per departure when one is chosen).
export function pickStays(offers,{now,today}) {
  const byCity=new Map();
  for(const d of offers || []) {
    const city=d && d.kind==='advertised-fare' ? cityFor(d.destination) : null;
    if(!city || d.tripType!=='round-trip' || !economy(d.cabin) || !(d.amount>0) || !ISO.test(d.departureDate || '') || !ISO.test(d.returnDate || '')) continue;
    const nights=nightsBetween(d.departureDate,d.returnDate), age=now-Date.parse(d.checkedAt || '');
    if(d.departureDate<=today || nights<1 || nights>30 || !(age>=-300000 && age<=26*3600000)) continue;
    if(!byCity.has(city.city)) byCity.set(city.city,[]);
    byCity.get(city.city).push({...d,nights});
  }
  const stays=[];
  for(const [name,fares] of byCity) {
    // Cities are priced in one currency in practice; if not, the commoner wins.
    const counts={};fares.forEach(d=>{counts[d.currency]=(counts[d.currency] || 0)+1;});
    const currency=Object.keys(counts).sort((a,b)=>counts[b]-counts[a] || a.localeCompare(b))[0];
    const ranked=fares.filter(d=>d.currency===currency).sort((a,b)=>a.amount-b.amount || a.departureDate.localeCompare(b.departureDate));
    const picks=[ranked[0],...[...new Set(ranked.map(d=>d.origin))].map(o=>ranked.find(d=>d.origin===o))];
    const seen=new Set();
    for(const d of picks) {
      const key=d.departureDate+'|'+d.returnDate;
      if(seen.has(key) || seen.size>=MAX_STAYS_PER_CITY) continue;seen.add(key);
      stays.push({city:name,checkIn:d.departureDate,checkOut:d.returnDate,nights:d.nights,fare:{id:d.id,origin:d.origin,destination:d.destination,airline:d.airline,amount:d.amount,currency:d.currency}});
    }
  }
  return stays;
}
function tripadvisorUrl(raw) {
  try { const u=new URL(raw);return u.protocol==='https:' && /(^|\.)tripadvisor\.com$/.test(u.hostname) && !u.username && !u.password ? u.href : ''; }
  catch (_) { return ''; }
}
// Well-reviewed hotels in Tripadvisor's best-value order, plus the cheapest
// typical room among the rest when it undercuts them all (a budget pick).
export function chooseHotels(list) {
  const ok=(list || []).filter(h=>h && /^g\d+-d\d+$/.test(h.key || '') && typeof h.name==='string' && h.name.trim() && HOTEL_TYPES.includes(h.accommodation_type) &&
    h.review_summary && h.review_summary.rating>=MIN_RATING && h.review_summary.count>=MIN_REVIEWS &&
    h.price_ranges && h.price_ranges.minimum>0 && h.price_ranges.maximum>=h.price_ranges.minimum && tripadvisorUrl(h.url));
  const picks=ok.slice(0,HOTELS_PER_CITY).map(h=>({h,budget:false}));
  const cheapest=ok.slice(HOTELS_PER_CITY).sort((a,b)=>a.price_ranges.minimum-b.price_ranges.minimum)[0];
  if(cheapest && picks.length && cheapest.price_ranges.minimum<Math.min(...picks.map(p=>p.h.price_ranges.minimum))) picks.push({h:cheapest,budget:true});
  return picks.map(({h,budget})=>({key:h.key,name:h.name.trim().slice(0,120),type:h.accommodation_type,rating:h.review_summary.rating,reviews:h.review_summary.count,
    typicalMin:h.price_ranges.minimum,typicalMax:h.price_ranges.maximum,url:tripadvisorUrl(h.url),budget}));
}
// Every site's nightly rate for the dates, cheapest first.
export function quoteRates(rates) {
  return (Array.isArray(rates) ? rates : []).filter(r=>r && typeof r.name==='string' && r.name.trim() && Number.isFinite(r.rate) && r.rate>0)
    .map(r=>({site:r.name.trim().slice(0,40),rate:Math.round(r.rate*100)/100})).sort((a,b)=>a.rate-b.rate || a.site.localeCompare(b.site));
}
async function pool(tasks,size,gapMs) {
  const out=new Array(tasks.length);let next=0;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await Promise.all(Array.from({length:Math.min(size,tasks.length)},async()=>{
    while(next<tasks.length) { const i=next++;out[i]=await tasks[i]();if(gapMs)await sleep(gapMs); }
  }));
  return out;
}
// fetchJson(url) resolves to the parsed body or throws; Xotelo reports its
// own errors in body.error. Prior quotes for the same city, dates and hotels
// are reused within STAY_TTL_HOURS so a steady board costs few calls.
export async function scoutHotels({offers,prior,now=Date.now(),today,fetchJson,gapMs=250,size=3,only=null}) {
  const list=only ? HOTEL_CITIES.filter(c=>only.includes(c.city)) : HOTEL_CITIES;
  const generatedAt=new Date(now).toISOString();
  const priorCities=new Map((prior && Array.isArray(prior.cities) ? prior.cities : []).map(c=>[c.city,c]));
  let calls=0,failedCalls=0,reusedStays=0,budgetHit=false;
  const call=async path=>{
    if(calls>=MAX_CALLS){budgetHit=true;return null;}
    calls++;
    try { const body=await fetchJson(HOTEL_API+path);if(!body || body.error || !body.result)throw Error('no result');return body.result; }
    catch (_) { failedCalls++;return null; }
  };
  const lists=await pool(list.map(c=>async()=>{
    const old=priorCities.get(c.city);
    if(old && Array.isArray(old.hotels) && old.hotels.length && now-Date.parse(old.listedAt || '')<LIST_TTL_DAYS*86400000) return {hotels:old.hotels,listedAt:old.listedAt};
    const result=await call('/list?location_key='+c.location+'&limit=30&offset=0&sort=best_value');
    const hotels=result ? chooseHotels(result.list) : [];
    // A failed list keeps last week's hotels rather than dropping the city.
    if(!hotels.length && old && Array.isArray(old.hotels) && old.hotels.length) return {hotels:old.hotels,listedAt:old.listedAt};
    return {hotels,listedAt:hotels.length ? generatedAt : null};
  }),size,gapMs);
  const cities=list.map((c,i)=>({city:c.city,location:c.location,airports:c.airports,market:c.market || 'international',listedAt:lists[i].listedAt,hotels:lists[i].hotels,stays:[]}));
  const byName=new Map(cities.map(c=>[c.city,c]));
  const wanted=pickStays(offers,{now,today}).filter(s=>byName.has(s.city) && byName.get(s.city).hotels.length);
  for(const city of cities.filter(c=>c.market!=='international' && c.hotels.length)) {
    const existing=wanted.filter(s=>s.city===city.city);
    for(const weekend of weekendStays(today)) {
      if(existing.length>=MAX_STAYS_PER_CITY) break;
      if(existing.some(s=>s.checkIn===weekend.checkIn && s.checkOut===weekend.checkOut)) continue;
      const stay={city:city.city,...weekend};wanted.push(stay);existing.push(stay);
    }
  }
  const tasks=[];
  for(const s of wanted) {
    const city=byName.get(s.city), keys=city.hotels.map(h=>h.key).join(',');
    const old=(priorCities.get(s.city)?.stays || []).find(o=>o.checkIn===s.checkIn && o.checkOut===s.checkOut && o.hotelKeys===keys && now-Date.parse(o.pricedAt || '')<STAY_TTL_HOURS*3600000);
    if(old){reusedStays++;const reused={...old,kind:s.kind || 'flight'};delete reused.fare;if(s.fare)reused.fare=s.fare;city.stays.push(reused);continue;}
    const stay={checkIn:s.checkIn,checkOut:s.checkOut,nights:s.nights,kind:s.kind || 'flight',pricedAt:generatedAt,hotelKeys:keys,quotes:[]};
    if(s.fare) stay.fare=s.fare;
    city.stays.push(stay);
    city.hotels.forEach(h=>tasks.push(async()=>{
      const result=await call('/rates?hotel_key='+h.key+'&chk_in='+s.checkIn+'&chk_out='+s.checkOut+'&rooms='+STAY.rooms+'&adults='+STAY.adults+'&currency='+STAY.currency);
      const rates=result && result.chk_in===s.checkIn && result.chk_out===s.checkOut ? quoteRates(result.rates) : [];
      stay.quotes.push({key:h.key,rates,checked:!!result});
    }));
  }
  await pool(tasks,size,gapMs);
  // Keep hotel order stable: the order chooseHotels gave.
  cities.forEach(c=>c.stays.forEach(s=>s.quotes.sort((a,b)=>c.hotels.findIndex(h=>h.key===a.key)-c.hotels.findIndex(h=>h.key===b.key))));
  const stays=cities.flatMap(c=>c.stays);
  return {asOf:today,generatedAt,source:'Xotelo · Tripadvisor partner rates',currency:STAY.currency,rooms:STAY.rooms,adults:STAY.adults,modelCalls:0,
    cities:cities.filter(c=>c.hotels.length),
    summary:{cities:cities.filter(c=>c.hotels.length).length,stays:stays.length,pricedStays:stays.filter(s=>s.quotes.some(q=>q.rates.length)).length,
      quotes:stays.reduce((n,s)=>n+s.quotes.filter(q=>q.rates.length).length,0),calls,failedCalls,reusedStays,budgetHit},
    coverage:'Nightly room rates for exact dates from Tripadvisor partner sites. Flight dates where available; domestic destinations and Metro Manila also scout upcoming Friday–Sunday stays. Hotel-only totals exclude transport. Not live availability; taxes and fees may be extra.'};
}
