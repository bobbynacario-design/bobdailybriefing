// Keeps every campaign and promotion, then takes fares round-robin across
// routes, cheapest first, so one busy route never crowds out a destination.
export function routeKey(d) {
  return [d.airline,d.origin,d.destination,d.tripType,d.cabin,d.currency].join('|');
}
export function trimOffers(offers,max) {
  const promos=offers.filter(d=>d.kind!=='advertised-fare'), routes=new Map();
  for(const d of offers) {
    if(d.kind!=='advertised-fare')continue;
    const key=routeKey(d);
    if(!routes.has(key))routes.set(key,[]);
    routes.get(key).push(d);
  }
  const queues=[...routes.values()].map(list=>list.sort((a,b)=>a.amount-b.amount || a.departureDate.localeCompare(b.departureDate)));
  const room=Math.max(0,max-promos.length), kept=[];
  for(let round=0;kept.length<room && queues.some(q=>q.length>round);round++) {
    for(const q of queues) if(q[round] && kept.length<room) kept.push(q[round]);
  }
  return [...promos,...kept];
}
