"use strict";
const {createHash}=require('node:crypto');
const CITIES={Manila:['ph',120,14,122,16],Makati:['ph',120,14,122,16],Pasay:['ph',120,14,122,16],Boracay:['ph',121.8,11.8,122.1,12.1],Cebu:['ph',123,9,125,12],Bohol:['ph',123,9,125,11],'El Nido':['ph',119,10.8,120,11.7],Siargao:['ph',125.7,9.5,126.4,10.2],'Puerto Princesa':['ph',118,9,120,11],Singapore:['sg',103.5,1,104.2,1.6],'Hong Kong':['hk',113.7,22,114.6,22.7],Taipei:['tw',121.3,24.8,121.8,25.3],Tokyo:['jp',139,35,140.3,36.2],Osaka:['jp',135,34,136,35],Macau:['mo',113.4,22,113.7,22.3]};
// Tourism Administration coordinates; precise location, not live imagery coverage.
const KNOWN=[
 ['Taipei',['the red house','red house'],25.042013,121.50685,'https://eng.taiwan.net.tw/m1.aspx?id=3310&print=1&sNo=0002090'],
 ['Taipei',['bopiliao old street','bopiliao historic block','bopiliao historic district'],25.036838,121.50216,'https://eng.taiwan.net.tw/m1.aspx?id=a12-00067&sno=0002090'],
 ['Taipei',['lungshan temple','longshan temple'],25.037162,121.4999,'https://eng.taiwan.net.tw/m1.aspx?id=93&sNo=0002090']
];
const fold=s=>String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function input(data) {const city=Object.keys(CITIES).find(c=>fold(c)===fold(data.city)),name=String(data.name || '').trim();if(!city||name.length<4||name.length>120)throw Object.assign(Error('Choose a named activity in a supported destination.'),{code:'invalid-argument'});return {city,name};}
function known(place) {const row=KNOWN.find(r=>r[0]===place.city && r[1].includes(fold(place.name)));return row?{lat:row[2],lng:row[3],source:'Tourism Administration',sourceUrl:row[4],matchedName:place.name}:null;}
function match(rows,place) {
 const bounds=CITIES[place.city],target=fold(place.name).replace(/^the /,'');
 if(!target)return null;
 const candidates=(Array.isArray(rows)?rows:[]).filter(r=>{
   const lat=Number(r.lat),lng=Number(r.lon),country=r.address?.country_code;
   if(country!==bounds[0] || !Number.isFinite(lat)||!Number.isFinite(lng)||lng<bounds[1]||lat<bounds[2]||lng>bounds[3]||lat>bounds[4]||['city','town','village','administrative','municipality'].includes(r.type))return false;
   const names=[r.name,...Object.values(r.namedetails || {})].map(v=>fold(v).replace(/^the /,''));
   return names.includes(target);
 });
 // Ambiguous places are map searches, never an arbitrary panorama.
 if(candidates.length!==1)return null;const r=candidates[0];
 return {lat:Number(r.lat),lng:Number(r.lon),source:'OpenStreetMap',sourceUrl:'https://www.openstreetmap.org/?mlat='+Number(r.lat)+'&mlon='+Number(r.lon)+'#map=18/'+Number(r.lat)+'/'+Number(r.lon),matchedName:r.name || place.name};
}
async function locate({db,data,fetchImpl=fetch,now=Date.now()}) {
 const place=input(data),fixed=known(place);if(fixed)return {location:fixed};
 const id=createHash('sha256').update(place.city+':'+fold(place.name)).digest('hex'),ref=db.collection('activity-place-locations').doc(id),cache=await ref.get();
 if(cache.exists && now-cache.data().checkedAt<(cache.data().location?30:1)*86400000)return {location:cache.data().location,cached:true};
 const rate=db.collection('activity-place-locations').doc('_lookup-rate'),settings=db.collection('activity-place-locations').doc('_settings'),daily=db.collection('activity-place-locations').doc('_daily-'+new Date(now+8*3600000).toISOString().slice(0,10));
 // Low-volume, cached, explicit-click use only. The server-side switch can
 // stop upstream lookups immediately without a client update.
 const permitted=await db.runTransaction(async tx=>{const [s,config,day]=await Promise.all([tx.get(rate),tx.get(settings),tx.get(daily)]);if(config.exists && config.data().enabled===false)return 'disabled';const count=day.exists?Number(day.data().count || 0):0;if(count>=50)return 'quota';if(s.exists && now-s.data().lastAt<1100)return 'busy';tx.set(rate,{lastAt:now});tx.set(daily,{count:count+1});return 'allowed';});
 if(permitted!=='allowed')return {location:null,note:permitted==='busy'?'Place lookup is busy. The map search is available; try Street View again shortly.':'Exact-location lookup is unavailable for now. The map search remains available.'};
 const query=new URL('https://nominatim.openstreetmap.org/search');Object.entries({q:place.name+', '+place.city,format:'jsonv2',addressdetails:'1',namedetails:'1',countrycodes:CITIES[place.city][0],limit:'5',viewbox:CITIES[place.city].slice(1).join(','),bounded:'1'}).forEach(([k,v])=>query.searchParams.set(k,v));
 try {
  const response=await fetchImpl(query,{headers:{'User-Agent':'DaybookTravel/1.0 (https://bobbynacario-design.github.io/bobdailybriefing/)','Accept':'application/json','Accept-Language':'en'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return {location:null,note:'Exact location lookup is unavailable. Use the map search.'};
  const location=match(await response.json(),place);await ref.set({city:place.city,name:place.name,location,checkedAt:now});return {location};
 }catch(_){return {location:null,note:'Exact location lookup is unavailable. Use the map search.'};}
}
module.exports={input,known,match,locate};
