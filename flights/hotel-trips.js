import {HOTEL_CITIES,HOTEL_API,STAY,STAY_TTL_HOURS,LIST_TTL_DAYS} from './hotel-cities.js';
import {cityFor,quoteRates} from './hotels.js';
// Hotels for the owner's own trips: the leave windows and poker trips the
// Flights page shows. The page saves them to hotel-trips-<uid> (kind
// 'hotel-trips'); this prices each against its city's hotels (plus the poker
// venue when it is a hotel) and writes hotel-stays-<uid>, which only that
// account can read. Shared documents never hold anyone's dates.
const ISO=/^\d{4}-\d{2}-\d{2}$/;
export const MAX_TRIPS=12;
export const MAX_TRIP_CALLS=150;
const GENERIC=new Set('hotel hotels resort resorts casino casinos entertainment integrated spa the and poker room club card cards of at'.split(' '));
function words(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g,' ').split(/\s+/).filter(Boolean); }
// The first listed hotel whose name holds every distinctive word of the
// venue ("INSPIRE Entertainment Resort" → inspire). Venues that are not
// hotels (Red Space) usually match nothing, which is the honest answer.
export function matchVenue(list,venue) {
  const need=words(venue).filter(w=>w.length>=3 && !GENERIC.has(w));
  if(!need.length) return null;
  return (list || []).find(h=>{
    if(!h || !/^g\d+-d\d+$/.test(h.key || '') || typeof h.name!=='string') return false;
    const have=new Set(words(h.name));return need.every(w=>have.has(w));
  }) || null;
}
// Map keys hold only letters, digits and spaces.
function venueKey(t) { return t.city+'|'+words(t.venue).join(' '); }
function nights(a,b) { return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000); }
function cityNamed(name,airports) {
  const n=String(name || '').trim().toLowerCase();
  return HOTEL_CITIES.find(c=>c.city.toLowerCase()===n) || (Array.isArray(airports) ? airports.map(cityFor).find(Boolean) : null) || null;
}
// Requests come from a signed-in page, so each field is re-checked here.
export function validTrips(trips,today) {
  const seen=new Set();
  return (Array.isArray(trips) ? trips : []).filter(t=>{
    if(!t || typeof t.id!=='string' || t.id.length>160 || seen.has(t.id) || !['leave','leave-fare','poker'].includes(t.kind)) return false;
    if(!ISO.test(t.checkIn || '') || !ISO.test(t.checkOut || '') || t.checkIn<=today) return false;
    const n=nights(t.checkIn,t.checkOut);
    if(!(n>=1 && n<=30) || !cityNamed(t.city,t.airports)) return false;
    seen.add(t.id);return true;
  }).slice(0,MAX_TRIPS).map(t=>{
    const c=cityNamed(t.city,t.airports);
    return {id:t.id,kind:t.kind,label:String(t.label || '').slice(0,120),city:c.city,location:c.location,checkIn:t.checkIn,checkOut:t.checkOut,nights:nights(t.checkIn,t.checkOut),
      venue:t.kind==='poker' ? String(t.venue || '').slice(0,120) : ''};
  });
}
function venueMeta(h) {
  try { const u=new URL(h.url);if(u.protocol!=='https:' || !/(^|\.)tripadvisor\.com$/.test(u.hostname))return null; } catch(_) { return null; }
  return {key:h.key,name:String(h.name).trim().slice(0,120),type:h.accommodation_type || 'Hotel',rating:h.review_summary?.rating ?? null,reviews:h.review_summary?.count ?? 0,
    typicalMin:h.price_ranges?.minimum || 0,typicalMax:h.price_ranges?.maximum || 0,url:h.url,budget:false,venue:true};
}
async function pool(tasks,size,gapMs) {
  let next=0;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await Promise.all(Array.from({length:Math.min(size,tasks.length)},async()=>{while(next<tasks.length){const i=next++;await tasks[i]();if(gapMs)await sleep(gapMs);}}));
}
// One account's trips. cities: this run's hotels-latest cities (their hotel
// lists); prior: the account's last hotel-stays document; call(path) returns
// Xotelo's result or null and owns the shared call budget.
export async function priceTrips({uid,trips,prior,cities,now,today,call,gapMs=250,size=3}) {
  const generatedAt=new Date(now).toISOString(), byCity=new Map((cities || []).map(c=>[c.city,c]));
  const venues={...(prior && prior.venues || {})}, priorTrips=new Map((prior && Array.isArray(prior.trips) ? prior.trips : []).map(t=>[t.id,t]));
  const wanted=validTrips(trips,today), out=[], tasks=[];
  let reused=0;
  // Venue lookups first, one list call per city and venue, kept for a week.
  for(const t of wanted.filter(t=>t.venue)) {
    const key=venueKey(t), old=venues[key];
    if(old && now-Date.parse(old.checkedAt || '')<LIST_TTL_DAYS*86400000) continue;
    const result=await call('/list?location_key='+t.location+'&limit=100&offset=0&sort=best_value');
    if(result){const h=matchVenue(result.list,t.venue);venues[key]={checkedAt:generatedAt,hotel:h ? venueMeta(h) : null};}
  }
  for(const t of wanted) {
    const base=(byCity.get(t.city)?.hotels || []).filter(h=>h && h.key);
    const venue=t.venue ? venues[venueKey(t)]?.hotel : null;
    const hotels=venue ? [venue,...base.filter(h=>h.key!==venue.key)] : base;
    if(!hotels.length) { out.push({...t,pricedAt:null,hotels:[],quotes:[],hotelKeys:'',venueFound:!!venue});continue; }
    const keys=hotels.map(h=>h.key).join(','), old=priorTrips.get(t.id);
    if(old && old.checkIn===t.checkIn && old.checkOut===t.checkOut && old.hotelKeys===keys && now-Date.parse(old.pricedAt || '')<STAY_TTL_HOURS*3600000) {
      reused++;out.push({...old,label:t.label,kind:t.kind});continue;
    }
    const trip={...t,pricedAt:generatedAt,hotelKeys:keys,hotels,quotes:[],venueFound:!!venue};
    out.push(trip);
    hotels.forEach(h=>tasks.push(async()=>{
      const result=await call('/rates?hotel_key='+h.key+'&chk_in='+t.checkIn+'&chk_out='+t.checkOut+'&rooms='+STAY.rooms+'&adults='+STAY.adults+'&currency='+STAY.currency);
      const rates=result && result.chk_in===t.checkIn && result.chk_out===t.checkOut ? quoteRates(result.rates) : [];
      trip.quotes.push({key:h.key,rates,checked:!!result});
    }));
  }
  await pool(tasks,size,gapMs);
  out.forEach(t=>t.quotes.sort((a,b)=>t.hotels.findIndex(h=>h.key===a.key)-t.hotels.findIndex(h=>h.key===b.key)));
  return {uid,kind:'hotel-stays',generatedAt,currency:STAY.currency,rooms:STAY.rooms,adults:STAY.adults,modelCalls:0,trips:out,venues,
    summary:{requested:Array.isArray(trips) ? trips.length : 0,valid:wanted.length,priced:out.filter(t=>t.quotes.some(q=>q.rates.length)).length,reused}};
}
// Shared call budget and counters for every account in one run.
export function caller(fetchJson,limit=MAX_TRIP_CALLS) {
  const stats={calls:0,failedCalls:0,budgetHit:false};
  const call=async path=>{
    if(stats.calls>=limit){stats.budgetHit=true;return null;}
    stats.calls++;
    try { const body=await fetchJson(HOTEL_API+path);if(!body || body.error || !body.result)throw Error('no result');return body.result; }
    catch(_) { stats.failedCalls++;return null; }
  };
  return {call,stats};
}
