import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseFares,parseAirAsiaPromos,parseSource,dateValue,officialUrl} from './parse.js';
const checked='2026-10-10T02:00:00Z';
const source={id:'pal-manila',airline:'Philippine Airlines',type:'fares',url:'https://flights.philippineairlines.com/en-ph/flights-from-manila'};
function fare({origin='Manila (MNL)',destination='Tokyo (NRT)',date='22 Nov 2026 - 27 Nov 2026',price='USD 250*',trip='Round-trip'}={}) {
  return `<section><p data-test="origin-text">${origin}<span>to</span></p><span data-test="destination-text">${destination}</span><div data-test="departing-text">${date}</div><p data-test="price">${price}</p><p data-test="flight-type">${trip}</p><p data-test="travel-class">Economy</p><p data-test="last-seen">Seen: 2 hrs ago</p></section>`;
}
test('extracts route-specific amounts, sample dates, native currency and fare basis',()=>{
  const rows=parseFares('<div data-test="price">PHP 1</div>'+fare()+fare(),source,checked);
  assert.equal(rows.length,1);const d=rows[0];assert.equal(d.amount,250);assert.equal(d.currency,'USD');
  assert.equal(d.origin,'MNL');assert.equal(d.destination,'NRT');assert.equal(d.departureDate,'2026-11-22');assert.equal(d.returnDate,'2026-11-27');
  assert.equal(d.tripType,'round-trip');assert.equal(d.bookingUrl,source.url);assert.match(d.fees,/travel tax excluded/i);
});
test('rejects domestic routes, foreign origins, departed flights, incomplete round trips and invalid prices',()=>{
  for(const props of [{destination:'Cebu (CEB)'},{origin:'Tokyo (NRT)'},{date:'09 Oct 2026 - 12 Oct 2026'},
    {date:'22 Nov 2026'},{date:'27 Nov 2026 - 22 Nov 2026'},{price:'PHP 0'},{price:'Sale from 1'},{trip:'Unknown'}]) {
    assert.equal(parseFares(fare(props),source,checked).length,0,JSON.stringify(props));
  }
  assert.equal(parseFares(fare({trip:'One-way',date:'Depart: 22 Nov 2026',price:'PHP 5,999.50*'}),source,checked)[0].amount,5999.5);
});
test('AirAsia discounts stay unpriced, undated campaigns even when hidden accessibility text contains amounts',()=>{
  const aa={id:'airasia-ph',airline:'AirAsia',type:'promos',url:'https://www.airasia.com/promotions/ph/'};
  const html='<div class="carousel-card"><div aria-label="Kota Kinabalu Fly from Manila at 1299 P H P "></div><p>27% OFF</p><a href="https://www.airasia.com/flights/search/?origin=MNL&amp;destination=BKI">Book now</a></div>';
  const d=parseAirAsiaPromos(html,aa,checked)[0];assert.equal(d.amount,null);assert.equal(d.departureDate,'');assert.equal(d.bookingEnd,'');
  assert.equal(d.origin,'MNL');assert.equal(d.destination,'BKI');assert.equal(d.destinationName,'Kota Kinabalu');
  assert.equal(parseAirAsiaPromos(html.replace('BKI','TAC'),aa,checked).length,0);
});
test('blocked or changed airline markup becomes unavailable instead of invented offers',()=>{
  assert.equal(parseSource('<div id="sec-if-cpt-container"></div>',source,checked).status,'unavailable');
  assert.match(parseSource('<div id="sec-if-cpt-container"></div>',source,checked).message,/interactive browser/);
  assert.equal(parseSource('<h1>Cheap flights from PHP 1</h1>',source,checked).items.length,0);
});
test('validates dates and rejects off-domain or executable booking links',()=>{
  assert.equal(dateValue('31/02/2026'),'');assert.equal(dateValue('02 Nov 2026'),'2026-11-02');
  assert.equal(officialUrl('javascript:alert(1)',source.url),'');assert.equal(officialUrl('https://philippineairlines.com.evil.test',source.url),'');
  assert.equal(officialUrl('/en-ph/offer',source.url),'https://flights.philippineairlines.com/en-ph/offer');
});

test('accepts only the requested domestic destinations and normalizes Boracay',()=>{
 for(const [code,name] of [['MPH','Boracay'],['ENI','El Nido'],['IAO','Siargao']]) {
  const d=parseFares(fare({destination:name+' ('+code+')',price:'PHP 5,000*'}),source,checked)[0];
  assert.equal(d.destination,code);assert.equal(d.travelTaxIncluded,null);
  assert.match(d.fees,/international travel tax does not apply/);
 }
 assert.equal(parseFares(fare({destination:'Kalibo (KLO)'}),source,checked).length,0);
 assert.equal(parseFares(fare({destination:'Puerto Princesa (PPS)'}),source,checked).length,0);
 assert.equal(parseFares(fare({destination:'Siargao (IAO)',origin:'Davao (DVO)'}),source,checked).length,0);
});
