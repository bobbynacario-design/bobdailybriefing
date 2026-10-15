import {createHash} from 'node:crypto';

// Budget airlines price each direction on its own, so two published one-way
// fares make an honest round-trip estimate: an AirAsia MOVE outbound from
// Manila, Cebu or Clark, plus the cheapest return leg on the same route
// 2-14 nights later, converted to PHP at the stored market rate (radar-ph).
// It is two tickets, not one fare: the record says so, and no pair is made
// when the rate is missing or more than three days old.
const id = v => createHash('sha256').update(v).digest('hex').slice(0,20);
const nightsBetween = (a,b) => Math.round((Date.parse(b)-Date.parse(a))/86400000);

export function rateFor(fx, currency, asOf) {
  if (currency === 'PHP') return 1;
  if (!fx || !/^\d{4}-\d{2}-\d{2}$/.test(fx.asOf || '') || !asOf || nightsBetween(fx.asOf, asOf) > 3) return null;
  const level = Number(fx.fx && fx.fx[String(currency).toLowerCase() + 'php'] && fx.fx[String(currency).toLowerCase() + 'php'].level);
  return level > 0 ? level : null;
}

export function pairReturns(offers, legs, fx, asOf, opts = {}) {
  const min = opts.minNights ?? 2, max = opts.maxNights ?? 14, perRoute = opts.perRoute ?? 8;
  const routes = new Map();
  for (const o of offers) {
    if (o.kind !== 'advertised-fare' || o.tripType !== 'one-way' || o.currency !== 'PHP' || !/(^|\.)airasia\.com\//.test(String(o.sourceUrl).replace(/^https:\/\//, ''))) continue;
    let best = null;
    for (const l of legs) {
      if (l.kind !== 'return-leg' || l.origin !== o.destination || l.destination !== o.origin) continue;
      const n = nightsBetween(o.departureDate, l.departureDate);
      if (!(n >= min && n <= max)) continue;
      const rate = rateFor(fx, l.currency, asOf);
      if (!rate) continue;
      const php = Math.round(l.amount * rate);
      if (!best || php < best.php) best = {leg: l, php, rate, nights: n};
    }
    if (!best) continue;
    const l = best.leg, airline = o.airline === l.airline ? o.airline : o.airline + ' + ' + l.airline;
    const amount = o.amount + best.php, key = o.origin + '|' + o.destination;
    const rateNote = l.currency === 'PHP' ? '' : ' (' + l.currency + ' ' + l.amount.toLocaleString('en-PH') + (l.rounded ? ', rounded on the page' : '') + ' at ' + best.rate + ' PHP, market rate as of ' + fx.asOf + ')';
    const pair = {...o, id: id(['pair', o.id, l.id].join('|')), airline, tripType: 'round-trip', returnDate: l.departureDate, amount, priceLabel: 'PHP ' + amount,
      paired: {outbound: o.amount, inbound: l.amount, inboundCurrency: l.currency, inboundPhp: best.php, rate: best.rate, fxAsOf: l.currency === 'PHP' ? '' : fx.asOf, inboundUrl: l.bookingUrl},
      stops: o.stops === 0 && l.stops === 0 ? 0 : null,
      priceBasis: 'Two AirAsia MOVE one-way fares for one adult added together: out PHP ' + o.amount.toLocaleString('en-PH') + ', back ≈ PHP ' + best.php.toLocaleString('en-PH') + rateNote + '. Two separate tickets, not a round-trip fare; book and confirm each leg.',
      travelPeriod: 'Exact sample dates for each leg; other dates may cost more.',
      terms: 'Sold through AirAsia MOVE as two one-way tickets (' + airline + '). A missed or changed leg does not protect the other; confirm both before booking.'};
    if (!routes.has(key)) routes.set(key, []);
    routes.get(key).push(pair);
  }
  return [...routes.values()].flatMap(list => list.sort((a, b) => a.amount - b.amount || a.departureDate.localeCompare(b.departureDate)).slice(0, perRoute));
}
