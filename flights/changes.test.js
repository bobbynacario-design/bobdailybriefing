import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trackChanges} from './changes.js';
const now='2026-10-10T02:00:00Z',previous='2026-10-09T02:00:00Z';
const offer={id:'a',kind:'advertised-fare',currency:'USD',amount:200,origin:'MNL',destination:'HKG',tripType:'round-trip',cabin:'Economy',departureDate:'2026-11-01',returnDate:'2026-11-06',checkedAt:now};
test('price changes require the same itinerary and recent, actually rechecked evidence',()=>{
  const prior={generatedAt:previous,offers:[{...offer,amount:250,checkedAt:previous}]};
  const d=trackChanges([offer],prior,now)[0];assert.equal(d.change.status,'dropped');assert.equal(d.change.delta,-50);assert.equal(d.change.percent,-20);
  assert.equal(trackChanges([{...offer,amount:300}],prior,now)[0].change.status,'rose');
  assert.equal(trackChanges([{...offer,amount:250}],prior,now)[0].change.status,'unchanged');
  for(const changed of [{currency:'PHP'},{departureDate:'2026-11-02'},{tripType:'one-way'},{cabin:'Business'},{origin:'CEB'}])assert.equal(trackChanges([{...offer,...changed}],prior,now)[0].change.status,'rechecked');
  assert.equal(trackChanges([{...offer,checkedAt:previous}],prior,now)[0].change.status,'not-rechecked');
  assert.equal(trackChanges([offer],{...prior,generatedAt:'2026-09-01'},now)[0].change.status,'first-observation');
  assert.equal(trackChanges([{...offer,id:'new'}],prior,now)[0].change.status,'new');
  assert.equal(trackChanges([offer],null,now)[0].change.status,'first-observation');
  const sources=[{url:'https://a.test/p',status:'ok'},{url:'https://a.test/down',status:'unavailable'}];
  assert.equal(trackChanges([{...offer,id:'new',sourceUrl:'https://a.test/p'}],{...prior,sources},now)[0].change.status,'new');
  for(const sourceUrl of ['https://a.test/added','https://a.test/down'])assert.equal(trackChanges([{...offer,id:'new',sourceUrl}],{...prior,sources},now)[0].change.status,'first-observation',sourceUrl);
});
