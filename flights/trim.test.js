import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trimOffers} from './trim.js';
import {SOURCES,MAX_OFFERS} from './config.js';
const fare=(destination,amount,extra={})=>({id:destination+amount,kind:'advertised-fare',airline:'Philippine Airlines',origin:'MNL',destination,tripType:'round-trip',cabin:'Economy',currency:'USD',amount,departureDate:'2026-11-0'+(amount%9+1),...extra});
test('trimming keeps promotions and spreads the fare budget across routes, cheapest first',()=>{
  const busy=[400,300,200,100].map(a=>fare('HKG',a)), quiet=fare('ADL',900), promo={id:'p',kind:'promo',campaign:true};
  const kept=trimOffers([...busy,quiet,promo],4);
  assert.ok(kept.includes(promo));assert.ok(kept.includes(quiet),'a single-sample route survives a busy one');
  assert.deepEqual(kept.filter(d=>d.destination==='HKG').map(d=>d.amount),[100,200]);
  assert.equal(trimOffers([...busy,quiet],10).length,5,'nothing is dropped under the limit');
  assert.equal(trimOffers([fare('HKG',100),fare('HKG',100,{currency:'PHP'})],1).length,1);
});
test('source list has unique ids and labelled official https pages within the document budget',()=>{
  assert.equal(new Set(SOURCES.map(s=>s.id)).size,SOURCES.length);
  for(const s of SOURCES){assert.match(s.url,/^https:\/\//);assert.ok(s.label,s.id);}
  assert.ok(MAX_OFFERS<=400);
});
