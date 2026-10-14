"use strict";
// Where trip activities come from. Wikivoyage gives described listings
// (name, coordinates, hours, price, last edit) for most destinations, and
// big cities through their district pages. Google Places gives named
// sights and food with ratings and coordinates everywhere, including places
// Wikivoyage barely covers (Siargao has two listings). Both carry
// coordinates, so "near my hotel" is a measured distance, not a guess.
const {CITIES}=require("./activity-locations");

const UA={"User-Agent":"DaybookTravel/1.0 (https://bobbynacario-design.github.io/bobdailybriefing/)","Accept":"application/json"};
// Wikivoyage article(s) per destination. Region articles (Bohol) add the
// towns where visitors stay; Cebu's own article is a disambiguation page.
const WIKIVOYAGE={
  Manila:["Manila"],Makati:["Makati"],Pasay:["Pasay"],Boracay:["Boracay"],Cebu:["Cebu City"],
  Bohol:["Bohol","Panglao Island","Tagbilaran"],"El Nido":["El Nido"],Siargao:["Siargao"],"Puerto Princesa":["Puerto Princesa"],
  Singapore:["Singapore"],"Hong Kong":["Hong Kong"],Taipei:["Taipei"],Tokyo:["Tokyo"],Osaka:["Osaka"],Macau:["Macau"]
};
// "go" listings are transport (airports, piers), not things to do.
const TYPES=["see","do","eat","drink","buy"],SECTIONS={See:"see",Do:"do",Eat:"eat",Drink:"drink",Buy:"buy"};
const MAX_DISTRICTS=12,MAX_ENTRIES=400,CACHE_DAYS=7,CACHE_VERSION=2;

// HTML entities, decoded in one pass so "&amp;quot;" stays "&quot;", and so
// evidence quoted with real punctuation (Manila's, …) still matches.
const ENTITIES={amp:"&",quot:'"',apos:"'",nbsp:" ",hellip:"\u2026",rsquo:"\u2019",lsquo:"\u2018",ldquo:"\u201c",rdquo:"\u201d",mdash:"\u2014",ndash:"\u2013",lt:" ",gt:" "};
function entity(m,e) {
  if(e[0]==="#"){const n=/^#x/i.test(e)?parseInt(e.slice(2),16):Number(e.slice(1));return n>0 && n<=0x10ffff?String.fromCodePoint(n):" ";}
  const v=ENTITIES[e.toLowerCase()];return v===undefined?m:v;
}
// Wiki markup to plain text: links keep their label, templates and
// references go, bold/italic quotes go.
function plain(s) {
  let t=String(s || "").replace(/<!--[\s\S]*?-->/g," ").replace(/<ref[^>]*\/>/gi," ").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi," ");
  for(let i=0;i<4;i++)t=t.replace(/\{\{[^{}]*\}\}/g," ");
  return t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g,"$1").replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g,"$1").replace(/\[https?:\/\/[^\]]*\]/g," ")
    .replace(/'{2,}/g,"").replace(/<[^>]+>/g," ").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,entity).replace(/\s+/g," ").trim();
}
// The parameters of one listing template, split on top-level pipes only.
function params(body) {
  const out={};let depth=0,link=0,start=0,parts=[];
  for(let i=0;i<body.length;i++){
    const two=body.slice(i,i+2);
    if(two==="{{"){depth++;i++;continue;} if(two==="}}"){depth--;i++;continue;}
    if(two==="[["){link++;i++;continue;} if(two==="]]"){link--;i++;continue;}
    if(body[i]==="|" && !depth && !link){parts.push(body.slice(start,i));start=i+1;}
  }
  parts.push(body.slice(start));
  for(const p of parts.slice(1)){const eq=p.indexOf("=");if(eq>0)out[p.slice(0,eq).trim().toLowerCase()]=p.slice(eq+1).trim();}
  return out;
}
// One place under two spellings ("The Red House", "Red House") is one place.
const same=s=>String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/^the\s+/,"").replace(/[^a-z0-9]+/g," ").trim();
const num=v=>{const n=Number(String(v || "").trim());return Number.isFinite(n) && String(v).trim()!=="" ? n : null;};
// Listing templates ({{see|...}}, {{listing|type=do|...}}), plus older
// bulleted "* '''Name''' – text" items under See/Do/Eat/Drink/Buy.
function parseListings(wikitext,title) {
  const w=String(wikitext || ""),out=[];
  const re=/\{\{\s*(see|do|eat|drink|buy|go|sleep|listing)\s*(?=[|\n}])/gi;let m;
  while((m=re.exec(w))){
    let depth=0,i=m.index,end=-1;
    for(;i<w.length-1;i++){if(w[i]==="{" && w[i+1]==="{"){depth++;i++;}else if(w[i]==="}" && w[i+1]==="}"){depth--;i++;if(!depth){end=i+1;break;}}}
    if(end<0)break;
    const p=params(w.slice(m.index+2,end-2)),type=(m[1].toLowerCase()==="listing"?String(p.type || "").toLowerCase():m[1].toLowerCase());
    re.lastIndex=end;
    const name=plain(p.name);
    if(!TYPES.includes(type) || name.length<3)continue;
    out.push({type,name,alt:plain(p.alt).slice(0,60),lat:num(p.lat),lng:num(p.long),address:plain(p.address).slice(0,140),hours:plain(p.hours).slice(0,80),price:plain(p.price).slice(0,80),
      lastedit:/^\d{4}-\d{2}(-\d{2})?$/.test(String(p.lastedit || "").trim())?String(p.lastedit).trim():"",text:plain(p.content || p.description).slice(0,420),page:title});
  }
  let section="";
  for(const line of w.split(/\r?\n/)){
    const h=/^==\s*([^=]+?)\s*==\s*$/.exec(line);if(h){section=SECTIONS[h[1]] || "";continue;}
    const b=section && /^\*+\s*'''([^']{3,80})'''\s*(?:\([^)]*\))?\s*[-–—:,.]?\s*(.*)$/.exec(line);
    if(b && !out.some(o=>o.name===plain(b[1])))out.push({type:section,name:plain(b[1]),alt:"",lat:null,lng:null,address:"",hours:"",price:"",lastedit:"",text:plain(b[2]).slice(0,420),page:title});
  }
  return out;
}
function districtTitles(wikitext,title) {
  const seen=new Set(),esc=title.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),re=new RegExp("\\[\\["+esc+"\\/([^\\]|#]+)","g");let m;
  while((m=re.exec(String(wikitext || ""))) && seen.size<MAX_DISTRICTS)seen.add(title+"/"+m[1].trim());
  return [...seen];
}
async function wikiPages(titles,fetchImpl) {
  const u=new URL("https://en.wikivoyage.org/w/api.php");
  Object.entries({action:"query",prop:"revisions",rvprop:"content|timestamp",rvslots:"main",titles:titles.join("|"),redirects:"1",format:"json",formatversion:"2",maxlag:"5"}).forEach(([k,v])=>u.searchParams.set(k,v));
  const r=await fetchImpl(u,{headers:UA,redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error("Wikivoyage unavailable");
  return ((await r.json()).query || {}).pages || [];
}
const pageUrl=t=>"https://en.wikivoyage.org/wiki/"+encodeURIComponent(t.replace(/ /g,"_")).replace(/%2F/g,"/");
async function wikivoyage(city,fetchImpl) {
  const main=(await wikiPages(WIKIVOYAGE[city],fetchImpl)).filter(p=>!p.missing && p.revisions);
  const districts=[...new Set(main.flatMap(p=>districtTitles(p.revisions[0].slots.main.content,p.title)))].slice(0,MAX_DISTRICTS);
  const extra=districts.length?(await wikiPages(districts,fetchImpl)).filter(p=>!p.missing && p.revisions):[];
  const pages=[...main,...extra],entries=[];
  for(const p of pages)for(const l of parseListings(p.revisions[0].slots.main.content,p.title))
    if(!entries.some(e=>same(e.name)===same(l.name)))entries.push({...l,source:"Wikivoyage",url:pageUrl(p.title),district:p.title!==main[0]?.title});
  return {entries:entries.slice(0,MAX_ENTRIES),pages:pages.map(p=>({title:p.title,edited:p.revisions[0].timestamp}))};
}
// Three searches per destination: attractions, outdoor places, local food.
// "tourist attractions in X" finds Siargao's Magpupungko, Sugba Lagoon and
// Naked Island; "top sights and things to do" found surf shops and archery.
// Ratings and editorial summaries are Google's; nothing here is model-written.
const GOOGLE_QUERIES=[["see","tourist attractions in "],["see","parks, beaches and scenic spots in "],["eat","popular local restaurants in "]];
// Places with almost no reviews are often tour agents or mislabelled pins.
const MIN_REVIEWS=15;
async function googleSights(city,apiKey,fetchImpl) {
  const b=CITIES[city],out=[];
  for(const [type,q] of GOOGLE_QUERIES){
    const r=await fetchImpl("https://places.googleapis.com/v1/places:searchText",{method:"POST",redirect:"error",signal:AbortSignal.timeout(10000),
      headers:{"Content-Type":"application/json","X-Goog-Api-Key":apiKey,"X-Goog-FieldMask":"places.id,places.displayName,places.location,places.primaryTypeDisplayName,places.rating,places.userRatingCount,places.formattedAddress,places.googleMapsUri,places.editorialSummary"},
      body:JSON.stringify({textQuery:q+city,languageCode:"en",regionCode:b[0],maxResultCount:20,locationRestriction:{rectangle:{low:{latitude:b[2],longitude:b[1]},high:{latitude:b[4],longitude:b[3]}}}})});
    if(!r.ok)continue;
    for(const p of (await r.json()).places || []){
      const name=String(p.displayName && p.displayName.text || "").trim();
      if(name.length<3 || !p.location || Number(p.userRatingCount || 0)<MIN_REVIEWS || out.some(o=>same(o.name)===same(name)))continue;
      const kind=String(p.primaryTypeDisplayName && p.primaryTypeDisplayName.text || (type==="eat"?"Restaurant":"Sight")),summary=String(p.editorialSummary && p.editorialSummary.text || "").trim();
      out.push({type,name,alt:"",lat:p.location.latitude,lng:p.location.longitude,address:String(p.formattedAddress || "").slice(0,140),hours:"",price:"",lastedit:"",
        rating:Number(p.rating) || null,reviews:Number(p.userRatingCount) || 0,text:(name+": "+kind+(summary?". "+summary:"")).replace(/([^.!?])$/,"$1.").slice(0,420),source:"Google Maps",url:p.googleMapsUri || "",page:""});
    }
  }
  return out;
}
const toRad=d=>d*Math.PI/180;
function km(a,b) {const h=Math.sin(toRad(b.lat-a.lat)/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(toRad(b.lng-a.lng)/2)**2;return Math.round(2*6371*Math.asin(Math.sqrt(h))*10)/10;}
// Cached per destination for a week: Wikivoyage changes slowly, and the
// Google searches stay well inside the free monthly allowance.
async function destination({db,city,apiKey,fetchImpl,now}) {
  const ref=db.collection("activity-sources").doc(city.replace(/[^A-Za-z]/g,"-")),snap=await ref.get(),c=snap.exists?snap.data():null;
  if(c && c.v===CACHE_VERSION && (c.google || !apiKey) && now-c.savedAt<CACHE_DAYS*86400000)return c;
  const [wv,g]=await Promise.all([wikivoyage(city,fetchImpl).catch(()=>({entries:[],pages:[]})),apiKey?googleSights(city,apiKey,fetchImpl).catch(()=>[]):Promise.resolve([])]);
  const data={v:CACHE_VERSION,city,savedAt:now,google:!!apiKey,pages:wv.pages,wikivoyage:wv.entries,places:g};
  if(wv.entries.length || g.length)await ref.set(data);
  return data;
}
// The shortlist of sources for one trip: the nearest places to the hotel,
// the most-reviewed sights and food, and the destination's own highlights,
// at most 70, each with a straight-line distance when both points are known.
function select(data,base,max=70) {
  // Wikivoyage's description wins; Google adds its rating and, when the
  // listing has none, its coordinates.
  const wv=data.wikivoyage.map(w=>{const g=data.places.find(x=>same(x.name)===same(w.name));return g?{...w,rating:g.rating,reviews:g.reviews,lat:w.lat!=null?w.lat:g.lat,lng:w.lng!=null?w.lng:g.lng}:w;});
  const all=[...wv,...data.places.filter(g=>!wv.some(w=>same(w.name)===same(g.name)))];
  const rows=all.map(e=>({...e,distanceKm:base && e.lat!=null && e.lng!=null ? km(base,{lat:e.lat,lng:e.lng}) : null}));
  // Food is capped in each tier so restaurants near the hotel cannot crowd
  // out the sights (in General Luna, 20 of the nearest 30 were restaurants).
  const picked=[],add=e=>{if(e && picked.length<max && !picked.includes(e))picked.push(e);},eat=e=>e.type==="eat" || e.type==="drink";
  const near=rows.filter(e=>e.distanceKm!=null).sort((a,b)=>a.distanceKm-b.distanceKm),liked=rows.filter(e=>e.source==="Google Maps").sort((a,b)=>b.reviews-a.reviews);
  near.filter(e=>!eat(e)).slice(0,18).forEach(add);near.filter(eat).slice(0,8).forEach(add);
  liked.filter(e=>!eat(e)).slice(0,18).forEach(add);liked.filter(eat).slice(0,6).forEach(add);
  rows.filter(e=>e.source==="Wikivoyage" && !e.district).forEach(add);
  rows.forEach(add);
  return picked.map((e,i)=>({id:"s"+i,...e,content:e.source==="Google Maps"?e.text:e.name+(e.alt?" ("+e.alt+")":"")+". "+e.text}));
}
module.exports={same,WIKIVOYAGE,plain,params,parseListings,districtTitles,wikivoyage,googleSights,destination,select,km,pageUrl};
