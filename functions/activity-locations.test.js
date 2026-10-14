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
test('the camera faces the place from the panorama, and distances are in metres',()=>{
 assert.equal(L.bearing({lat:10,lng:120},{lat:10.001,lng:120}),0);assert.equal(L.bearing({lat:10,lng:120},{lat:10,lng:120.001}),90);
 assert.equal(L.bearing({lat:10,lng:120},{lat:9.999,lng:120}),180);assert.ok(Math.abs(L.metres({lat:10,lng:120},{lat:10.001,lng:120})-111)<=1);
});
function google({places=[],panoAt=150,status=200}={}){const calls=[];return {calls,fetchImpl:async(url,opts)=>{const u=String(url);calls.push(u);
 if(u.startsWith('https://places.googleapis.com/')){assert.equal(opts.headers['X-Goog-Api-Key'],'k');const body=JSON.parse(opts.body);assert.ok(body.locationRestriction.rectangle.low.latitude<body.locationRestriction.rectangle.high.latitude);return {ok:status===200,status,json:async()=>({places})};}
 if(u.startsWith('https://maps.googleapis.com/maps/api/streetview/metadata')){const r=Number(new URL(u).searchParams.get('radius'));return {ok:true,json:async()=>r>=panoAt?{status:'OK',pano_id:'PANO1',location:{lat:9.8,lng:126.15},date:'2023-05'}:{status:'ZERO_RESULTS'}};}
 throw new Error('unexpected '+u);}};}
const viewpoint={id:'p1',displayName:{text:'Coconut Plantation View Point'},formattedAddress:'Del Carmen, Siargao',location:{latitude:9.801,longitude:126.15},types:['tourist_attraction','point_of_interest'],googleMapsUri:'https://maps.google.com/?cid=1'};
test('with a key, Google finds the place, the free metadata check finds a panorama, and the result is cached',async()=>{
 const database=db(),g=google({places:[{...viewpoint,displayName:{text:'Del Carmen'},types:['locality','political']},viewpoint]});
 const r=await L.locate({db:database,data:{city:'Siargao',name:'Sea of Palms (Coconut Mountain View)'},apiKey:'k',fetchImpl:g.fetchImpl,now:100000});
 assert.equal(r.location.matchedName,'Coconut Plantation View Point');assert.equal(r.location.source,'Google Maps');
 assert.deepEqual([r.pano.id,r.pano.date,r.pano.heading],['PANO1','2023-05',0]);assert.ok(r.pano.distance>100 && r.pano.distance<120);
 assert.equal(g.calls.length,2);
 assert.equal((await L.locate({db:database,data:{city:'Siargao',name:'Sea of Palms (Coconut Mountain View)'},apiKey:'k',fetchImpl:g.fetchImpl,now:200000})).cached,true);assert.equal(g.calls.length,2);
});
test('a viewpoint set back from the road widens the panorama search once; none at all leaves a satellite-only view',async()=>{
 const wide=google({places:[viewpoint],panoAt:600});const r=await L.locate({db:db(),data:{city:'Siargao',name:'Viewpoint'},apiKey:'k',fetchImpl:wide.fetchImpl,now:100000});
 assert.equal(r.pano.id,'PANO1');assert.equal(wide.calls.filter(u=>u.includes('streetview')).length,2);
 const none=google({places:[viewpoint],panoAt:9999});const n=await L.locate({db:db(),data:{city:'Siargao',name:'Viewpoint'},apiKey:'k',fetchImpl:none.fetchImpl,now:100000});
 assert.ok(n.location);assert.equal(n.pano,null);
});
test('known Taipei coordinates still skip the place search but get an aimed panorama once a key exists',async()=>{
 const g=google();const r=await L.locate({db:db(),data:{city:'Taipei',name:'The Red House'},apiKey:'k',fetchImpl:g.fetchImpl,now:100000});
 assert.equal(r.location.lat,25.042013);assert.equal(r.pano.id,'PANO1');assert.ok(g.calls.every(u=>!u.includes('places.googleapis')));
});
test('a refused key falls back to OpenStreetMap and says so, and an older keyless lookup is redone once a key exists',async()=>{
 const database=db();let osm=0;const fetchImpl=async url=>{const u=String(url);if(u.includes('places.googleapis'))return {ok:false,status:403};if(u.includes('nominatim')){osm++;return {ok:true,json:async()=>[row]};}return {ok:true,json:async()=>({status:'ZERO_RESULTS'})};};
 await L.locate({db:database,data:place,fetchImpl,now:100000});assert.equal(osm,1);
 const r=await L.locate({db:database,data:place,apiKey:'k',fetchImpl,now:200000});assert.equal(osm,2);assert.match(r.note,/refused the Maps key/);assert.equal(r.location.lng,119.4);
});
function places(map){const calls=[];return {calls,fetchImpl:async(url,opts)=>{const u=String(url);calls.push(u);
 if(u.startsWith('https://places.googleapis.com/')){const q=JSON.parse(opts.body).textQuery;const p=Object.keys(map).find(k=>q.startsWith(k));return {ok:true,status:200,json:async()=>({places:p?[map[p]]:[]})};}
 if(u.includes('/streetview/metadata'))return {ok:true,json:async()=>({status:'OK',pano_id:'P1',location:{lat:9.8123,lng:126.0596},date:'2022-05',copyright:'© Chris'})};
 if(u.includes('nominatim'))throw new Error('OpenStreetMap must not be asked for the hotel');
 throw new Error('unexpected '+u);}};}
const at=(name,lat,lng)=>({id:name,displayName:{text:name},formattedAddress:name+', Siargao',location:{latitude:lat,longitude:lng},types:['tourist_attraction'],googleMapsUri:'https://maps.google.com/?q='+name});
test('a visitor photo sphere keeps its author; Google car imagery adds no credit',async()=>{
 const g=places({'Viewpoint':at('Coconut Plantation View Point',9.81232,126.05961)});
 const r=await L.locate({db:db(),data:{city:'Siargao',name:'Viewpoint'},apiKey:'k',fetchImpl:g.fetchImpl,now:100000});assert.equal(r.pano.by,'Chris');
 const car=await L.panorama({lat:10,lng:120},'k',async()=>({ok:true,json:async()=>({status:'OK',pano_id:'P2',location:{lat:10,lng:120},date:'2019-03',copyright:'© 2019 Google'})}));assert.equal(car.by,'');
});
test('the hotel is looked up once, in the same permit, by Google only and without a panorama check',async()=>{
 const database=db(),g=places({'Viewpoint':at('Coconut Plantation View Point',9.81232,126.05961),'Siargao Bleu':at('Siargao Bleu Resort & Spa',9.7872,126.1557)});
 const r=await L.locate({db:database,data:{city:'Siargao',name:'Viewpoint',base:'Siargao Bleu Resort & Spa'},apiKey:'k',fetchImpl:g.fetchImpl,now:100000});
 assert.equal(r.base.matchedName,'Siargao Bleu Resort & Spa');assert.ok(Math.abs(L.metres(r.base,r.location)-10900)<600);
 assert.equal(g.calls.filter(u=>u.includes('places.googleapis')).length,2);assert.equal(g.calls.filter(u=>u.includes('metadata')).length,1);
 const again=await L.locate({db:database,data:{city:'Siargao',name:'Viewpoint',base:'Siargao Bleu Resort & Spa'},apiKey:'k',fetchImpl:g.fetchImpl,now:100500});
 assert.equal(again.cached,true);assert.equal(again.base.matchedName,'Siargao Bleu Resort & Spa');assert.equal(g.calls.length,3);
});
test('without a key, or when the hotel is not found, no distance is offered',async()=>{
 const none=await L.locate({db:db(),data:{city:'Taipei',name:'The Red House',base:'Muzik Hotel - Ximen Station Branch'},now:100000,fetchImpl:()=>{throw new Error('no network');}});
 assert.equal(none.base,undefined);assert.ok(none.location);
 const g=places({'Viewpoint':at('Coconut Plantation View Point',9.81232,126.05961)});
 const r=await L.locate({db:db(),data:{city:'Siargao',name:'Viewpoint',base:'Unknown Hut'},apiKey:'k',fetchImpl:g.fetchImpl,now:100000});assert.equal(r.base,undefined);assert.ok(r.pano);
});
