const {test}=require('node:test'),assert=require('node:assert/strict'),L=require('./activity-locations');
const place={city:'El Nido',name:'Test Beach'},row={name:'Test Beach',lat:'11.1',lon:'119.4',address:{country_code:'ph'},type:'beach',osm_type:'way',osm_id:123};
function db(){const records=new Map(),ref=id=>({id,get:async()=>({exists:records.has(id),data:()=>records.get(id)}),set:async v=>records.set(id,v)});return {collection:()=>({doc:ref}),runTransaction:async fn=>fn({get:r=>r.get(),set:(r,v)=>records.set(r.id,v)})};}
test('source coordinates resolve known Taipei places without a network call',async()=>{
 let calls=0;const r=await L.locate({db:db(),data:{city:'Taipei',name:'The Red House'},fetchImpl:()=>{calls++;}});assert.equal(r.location.lat,25.042013);assert.equal(calls,0);assert.match(r.location.sourceUrl,/taiwan.net.tw/);
});
test('free geocoding accepts only one exact named place in the correct country and destination',()=>{
 assert.equal(L.match([row],place).lng,119.4);
 for(const rows of [[row,row],[{...row,address:{country_code:'sg'}}],[{...row,lon:'121.5'}],[{...row,name:'Different Beach'}],[{...row,type:'city'}]])assert.equal(L.match(rows,place),null);
 assert.equal(L.match([{...row,name:''}],{...place,name:'中文地點'}),null);
});
test('lookup results are cached and uncached requests obey the global one-per-second policy',async()=>{
 const database=db();let calls=0;const fetchImpl=async(url,opts)=>{calls++;assert.equal(url.hostname,'nominatim.openstreetmap.org');assert.match(opts.headers['User-Agent'],/DaybookTravel/);return {ok:true,json:async()=>[row]};};
 const options={db:database,data:place,fetchImpl,now:100000};assert.ok((await L.locate(options)).location);assert.equal((await L.locate(options)).cached,true);assert.equal(calls,1);
 const busy=await L.locate({...options,data:{...place,name:'Other Beach'}});assert.equal(busy.location,null);assert.match(busy.note,/busy/);assert.equal(calls,1);
});
test('unavailable or ambiguous locations produce a map fallback, and input cannot change the service host',async()=>{
 assert.throws(()=>L.input({city:'Unknown',name:'Place'}),{code:'invalid-argument'});
 const r=await L.locate({db:db(),data:place,fetchImpl:async()=>({ok:false}),now:100000});assert.equal(r.location,null);assert.match(r.note,/map search/);
});
test('upstream lookups can be disabled server-side without disabling map searches',async()=>{
 const database=db();await database.collection().doc('_settings').set({enabled:false});let calls=0;const r=await L.locate({db:database,data:place,fetchImpl:async()=>{calls++;},now:100000});assert.equal(calls,0);assert.equal(r.location,null);assert.match(r.note,/map search/);
});
