"use strict";
const {createHash}=require('node:crypto');
const FlightsCore=require('./flights-core');
const CITIES=Object.fromEntries(Object.entries(FlightsCore.activityDestinations).map(([city,d])=>[city,d.box]));
// Tourism Administration coordinates; precise location, not live imagery coverage.
const KNOWN=[
 ['Taipei',['the red house','red house'],25.042013,121.50685,'https://eng.taiwan.net.tw/m1.aspx?id=3310&print=1&sNo=0002090'],
 ['Taipei',['bopiliao old street','bopiliao historic block','bopiliao historic district'],25.036838,121.50216,'https://eng.taiwan.net.tw/m1.aspx?id=a12-00067&sno=0002090'],
 ['Taipei',['lungshan temple','longshan temple'],25.037162,121.4999,'https://eng.taiwan.net.tw/m1.aspx?id=93&sNo=0002090']
];
const fold=s=>String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function input(data) {const city=FlightsCore.activityCity(data.city),name=String(data.name || '').trim();if(!city||name.length<4||name.length>120)throw Object.assign(Error('Choose a named activity in a supported destination.'),{code:'invalid-argument'});return {city,name};}
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
// Google lookups, the way RiskM8 captures a premises: find the place, run
// the free Street View metadata check, then aim the camera from the
// panorama toward the place. The browser shows that exact panorama through
// the free Maps Embed API, so no image is fetched or stored here.
const CACHE_VERSION=3;
const toRad=d=>d*Math.PI/180;
function bearing(from,to) {
 const y=Math.sin(toRad(to.lng-from.lng))*Math.cos(toRad(to.lat)),x=Math.cos(toRad(from.lat))*Math.sin(toRad(to.lat))-Math.sin(toRad(from.lat))*Math.cos(toRad(to.lat))*Math.cos(toRad(to.lng-from.lng));
 return Math.round((Math.atan2(y,x)*180/Math.PI+360)%360);
}
function metres(a,b) {
 const h=Math.sin(toRad(b.lat-a.lat)/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(toRad(b.lng-a.lng)/2)**2;
 return Math.round(2*6371000*Math.asin(Math.sqrt(h)));
}
// A city, region or road is not a place to look at.
const AREA_TYPES=['locality','sublocality','administrative_area_level_1','administrative_area_level_2','administrative_area_level_3','country','postal_code','route','political','colloquial_area'];
async function googlePlace(place,apiKey,fetchImpl) {
 const b=CITIES[place.city];
 const r=await fetchImpl('https://places.googleapis.com/v1/places:searchText',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
  headers:{'Content-Type':'application/json','X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri'},
  body:JSON.stringify({textQuery:place.name+', '+place.city,languageCode:'en',regionCode:b[0],maxResultCount:3,locationRestriction:{rectangle:{low:{latitude:b[2],longitude:b[1]},high:{latitude:b[4],longitude:b[3]}}}})});
 if(!r.ok)return {error:r.status===403||r.status===401?'key':'unavailable'};
 const rows=((await r.json()).places || []).filter(p=>p.location && Number.isFinite(p.location.latitude) && Number.isFinite(p.location.longitude) && !(p.types || []).every(t=>AREA_TYPES.includes(t)));
 if(!rows.length)return {location:null};
 const p=rows[0];
 return {location:{lat:p.location.latitude,lng:p.location.longitude,source:'Google Maps',sourceUrl:p.googleMapsUri || 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(place.name+', '+place.city)+'&query_place_id='+encodeURIComponent(p.id),matchedName:p.displayName && p.displayName.text || place.name,address:p.formattedAddress || ''}};
}
// The metadata check is free. Nearest outdoor panorama first; a wider
// search for beaches and viewpoints set back from the road.
async function panorama(location,apiKey,fetchImpl) {
 for(const radius of [150,600]){
  const u=new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
  Object.entries({location:location.lat+','+location.lng,radius:String(radius),source:'outdoor',key:apiKey}).forEach(([k,v])=>u.searchParams.set(k,v));
  const r=await fetchImpl(u,{redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)return null;
  const m=await r.json();
  if(m.status==='REQUEST_DENIED')return null;
  if(m.status!=='OK' || !m.pano_id || !m.location)continue;
  const at={lat:Number(m.location.lat),lng:Number(m.location.lng)};
  // A visitor's photo sphere carries its author ("© Chris"); Google's own
  // car imagery says Google, which the embed already credits.
  const by=String(m.copyright || '').replace(/^\s*(?:©|\(c\)|copyright)\s*/i,'').trim().slice(0,60);
  return {id:String(m.pano_id),lat:at.lat,lng:at.lng,date:/^\d{4}(-\d{2})?$/.test(m.date || '')?m.date:'',heading:bearing(at,location),distance:metres(at,location),by:/google/i.test(by)?'':by};
 }
 return null;
}
// Low-volume, cached, explicit-click use only: one upstream permit per
// click, however many lookups it needs. The server-side switch can stop
// upstream lookups immediately without a client update.
async function permit(db,now) {
 const col=db.collection('activity-place-locations'),rate=col.doc('_lookup-rate'),settings=col.doc('_settings'),daily=col.doc('_daily-'+new Date(now+8*3600000).toISOString().slice(0,10));
 return db.runTransaction(async tx=>{const [s,config,day]=await Promise.all([tx.get(rate),tx.get(settings),tx.get(daily)]);if(config.exists && config.data().enabled===false)return 'disabled';const count=day.exists?Number(day.data().count || 0):0;if(count>=50)return 'quota';if(s.exists && now-s.data().lastAt<1100)return 'busy';tx.set(rate,{lastAt:now});tx.set(daily,{count:count+1});return 'allowed';});
}
// One place: cached for 30 days (a miss for 1), Google first when a key
// exists, OpenStreetMap otherwise. `pano` is skipped for the user's hotel.
async function lookup({db,place,apiKey,fetchImpl,now,withPano,gate,osm=true}) {
 const fixed=known(place),id=createHash('sha256').update(place.city+':'+fold(place.name)).digest('hex'),ref=db.collection('activity-place-locations').doc(id),cache=await ref.get();
 const c=cache.exists?cache.data():null;
 // Lookups made before Google was configured, or before the photo credit
 // was kept, are redone; a hotel-only entry has no panorama check yet.
 if(c && c.v===CACHE_VERSION && (c.google || !apiKey) && (c.panoChecked || !withPano || !apiKey) && now-c.checkedAt<(c.location?30:1)*86400000)return {location:c.location,pano:c.pano || null,cached:true};
 if(fixed && !apiKey)return {location:fixed,pano:null};
 const permitted=await gate();
 if(permitted!=='allowed')return {location:fixed,pano:null,note:permitted==='busy'?'Place lookup is busy. The map search is available; try again shortly.':'Exact-location lookup is unavailable for now. The map search remains available.'};
 let location=fixed,note='';
 try {
  if(!location && apiKey){const g=await googlePlace(place,apiKey,fetchImpl);location=g.location;if(g.error==='key')note='Google refused the Maps key, so OpenStreetMap was used instead.';}
  if(!location && osm){
   const query=new URL('https://nominatim.openstreetmap.org/search');Object.entries({q:place.name+', '+place.city,format:'jsonv2',addressdetails:'1',namedetails:'1',countrycodes:CITIES[place.city][0],limit:'5',viewbox:CITIES[place.city].slice(1).join(','),bounded:'1'}).forEach(([k,v])=>query.searchParams.set(k,v));
   const response=await fetchImpl(query,{headers:{'User-Agent':'DaybookTravel/1.0 (https://bobbynacario-design.github.io/bobdailybriefing/)','Accept':'application/json','Accept-Language':'en'},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(response.ok)location=match(await response.json(),place);else note='Exact location lookup is unavailable. Use the map search.';
  }
  const pano=location && apiKey && withPano ? await panorama(location,apiKey,fetchImpl) : null;
  await ref.set({v:CACHE_VERSION,google:!!apiKey,panoChecked:!!(withPano && apiKey),city:place.city,name:place.name,location,pano,checkedAt:now});
  return note?{location,pano,note}:{location,pano};
 }catch(_){return {location,pano:null,note:'Exact location lookup is unavailable. Use the map search.'};}
}
async function locate({db,data,apiKey='',fetchImpl=fetch,now=Date.now()}) {
 const place=input(data);let permitted=null;const gate=async()=>permitted || (permitted=await permit(db,now));
 const result=await lookup({db,place,apiKey,fetchImpl,now,withPano:true,gate});
 // The user's hotel, for a straight-line distance on the page. Google only:
 // a second OpenStreetMap request in the same second breaks its usage policy.
 const base=String(data.base || '').trim();
 if(result.location && apiKey && base.length>=4 && base.length<=160 && fold(base)!==fold(place.name)){
  const b=await lookup({db,place:{city:place.city,name:base},apiKey,fetchImpl,now,withPano:false,gate,osm:false}).catch(()=>null);
  if(b && b.location)result.base={lat:b.location.lat,lng:b.location.lng,matchedName:b.location.matchedName || base};
 }
 return result;
}
// The hotel alone, for trip activities: a point to measure distances from.
async function placePoint({db,city,name,apiKey,fetchImpl=fetch,now=Date.now()}) {
 const n=String(name || "").trim();if(!apiKey || !CITIES[city] || n.length<4 || n.length>160)return null;
 let permitted=null;const gate=async()=>permitted || (permitted=await permit(db,now));
 const r=await lookup({db,place:{city,name:n},apiKey,fetchImpl,now,withPano:false,gate,osm:false}).catch(()=>null);
 return r && r.location ? {lat:r.location.lat,lng:r.location.lng,matchedName:r.location.matchedName || n} : null;
}
module.exports={CITIES,input,known,match,locate,placePoint,bearing,metres,panorama,googlePlace};
