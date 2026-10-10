import {createHash} from 'node:crypto';
// Daily lowest advertised fare per route (origin, destination, journey, cabin,
// currency; any airline), kept for HISTORY_DAYS so the app can say whether a
// city's fare is low against what the scout has seen. Exact sample dates
// rotate between scouts, so a route-level low is the comparable signal.
export const HISTORY_DAYS=60;
export function historyKey(d) {
  return [d.origin,d.destination,d.tripType,d.cabin,d.currency].join('|');
}
export function updateHistory(prior,offers,asOf,checkedAt) {
  const cutoff=new Date(Date.parse(asOf+'T00:00:00Z')-(HISTORY_DAYS-1)*86400000).toISOString().slice(0,10);
  const routes={};
  for(const [id,route] of Object.entries(prior?.routes || {})) {
    const days=Object.fromEntries(Object.entries(route.days || {}).filter(([day,amount])=>day>=cutoff && day<=asOf && Number.isFinite(amount) && amount>0));
    if(Object.keys(days).length)routes[id]={key:route.key,days};
  }
  // Retained offers from failed pages were not re-read and never set a low.
  for(const d of offers) {
    if(d.kind!=='advertised-fare' || d.checkedAt!==checkedAt || !Number.isFinite(d.amount) || d.amount<=0)continue;
    const key=historyKey(d), id=createHash('sha256').update(key).digest('hex').slice(0,16);
    routes[id] ||= {key,days:{}};
    const low=routes[id].days[asOf];
    if(!(low<=d.amount))routes[id].days[asOf]=d.amount;
  }
  const days=Object.values(routes).flatMap(r=>Object.keys(r.days)).sort();
  return {asOf,updatedAt:checkedAt,firstDay:days[0] || asOf,keepDays:HISTORY_DAYS,routes};
}
