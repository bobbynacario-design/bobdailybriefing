const {test}=require('node:test');
const assert=require('node:assert/strict');
const T=require('./trip-sources');

const page=[
  "==See==",
  "===Wanhua===",
  "* {{see",
  "| name=Longshan Temple | alt=龍山寺 | url=https://www.lungshan.org.tw/",
  "| address=No.211, Guangzhou Rd | lat=25.037200 | long=121.499400",
  "| hours=Daily 06:00-22:00 | price=Free | lastedit=2026-01-19",
  "| content=This temple is dedicated to [[Guanyin|the goddess of mercy]], with {{IPA|folk}} beliefs ''mixed'' in.<ref>x</ref>",
  "}}",
  "* {{listing | type=do | name=Riverside Park | lat= | long= | content=A long walk by the river.}}",
  "==Eat==",
  "* '''Ah Chung Mee Soa''' – famous oyster noodles near [[Taipei/Old Taipei|Ximending]].",
  "==Get in==",
  "* {{go | name=Songshan Airport | content=Domestic flights.}}",
  "==Sleep==",
  "* {{sleep | name=Hotel Nice | content=A hotel.}}",
  "* '''Hostel Bad''' – not an activity.",
  "Districts: [[Taipei/Old Taipei|Old Taipei]] [[Taipei/Shilin]] [[Kaohsiung/Center]] [[Taipei/Old Taipei]]"
].join("\n");

test('listings keep their facts, lose their markup, and exclude transport and lodging',()=>{
  const rows=T.parseListings(page,'Taipei');
  assert.deepEqual(rows.map(r=>[r.type,r.name]),[['see','Longshan Temple'],['do','Riverside Park'],['eat','Ah Chung Mee Soa']]);
  const t=rows[0];
  assert.equal(t.text,'This temple is dedicated to the goddess of mercy, with beliefs mixed in.');
  assert.deepEqual([t.lat,t.lng,t.hours,t.price,t.lastedit,t.alt],[25.0372,121.4994,'Daily 06:00-22:00','Free','2026-01-19','龍山寺']);
  assert.equal(rows[1].lat,null);assert.equal(rows[2].text,'famous oyster noodles near Ximending.');
});
test('district pages are the article\'s own sub-pages, once each',()=>{
  assert.deepEqual(T.districtTitles(page,'Taipei'),['Taipei/Old Taipei','Taipei/Shilin']);
});
test('one place under two spellings is merged; sights come nearest first, then food, with Google filling missing coordinates',()=>{
  const data={wikivoyage:[
      {type:'see',name:'Red House',lat:25.0420,lng:121.5067,text:'A historic market and theatre.',source:'Wikivoyage',url:'w1'},
      {type:'see',name:'Taipei 101',lat:null,lng:null,text:'The tall tower.',source:'Wikivoyage',url:'w2'}],
    places:[{type:'see',name:'The Red House',lat:25.042,lng:121.5068,rating:4.4,reviews:9000,text:'The Red House: Theatre.',source:'Google Maps',url:'g1'},
      {type:'see',name:'Taipei 101',lat:25.0340,lng:121.5645,rating:4.6,reviews:80000,text:'Taipei 101: Skyscraper.',source:'Google Maps',url:'g2'},
      {type:'eat',name:'Ah Chung',lat:25.0433,lng:121.5079,rating:4.2,reviews:20000,text:'Ah Chung: Noodle shop.',source:'Google Maps',url:'g3'}]};
  const s=T.select(data,{lat:25.0420,lng:121.5051});
  assert.deepEqual(s.map(x=>x.name),['Red House','Taipei 101','Ah Chung']);
  assert.equal(s[0].rating,4.4);assert.equal(s[0].content,'Red House. A historic market and theatre.');
  assert.equal(s[2].content,'Ah Chung: Noodle shop.');assert.ok(s[1].distanceKm>5 && s[1].distanceKm<7);
  assert.deepEqual(s.map(x=>x.id),['s0','s1','s2']);
  assert.equal(T.select(data,null)[0].distanceKm,null);
});
function db(){const m=new Map(),ref=id=>({get:async()=>({exists:m.has(id),data:()=>m.get(id)}),set:async v=>m.set(id,v)});return {m,collection:()=>({doc:ref})};}
test('a destination is fetched once a week, Google only with a key, and an empty result is not cached',async()=>{
  const calls=[];const fetchImpl=async(url,opts)=>{const u=String(url);calls.push(u);
    if(u.startsWith('https://en.wikivoyage.org/'))return new Response(JSON.stringify({query:{pages:[{title:'Siargao',revisions:[{timestamp:'2026-06-29T20:41:36Z',slots:{main:{content:'==Do==\n* {{do | name=Fat Lips Surfshop | lat=9.79 | long=126.16 | content=Surfboards and tours.}}'}}}]}]}}));
    assert.equal(opts.headers['X-Goog-Api-Key'],'k');assert.match(opts.headers['X-Goog-FieldMask'],/places.rating/);
    return new Response(JSON.stringify({places:[{displayName:{text:'Magpupungko Rock Pools'},location:{latitude:9.9,longitude:126.1},primaryTypeDisplayName:{text:'Tourist attraction'},rating:4.6,userRatingCount:3200,editorialSummary:{text:'Tidal pools in the rocks.'},googleMapsUri:'https://maps.google.com/?cid=7'}]}));};
  const database=db(),now=1_800_000_000_000;
  const d=await T.destination({db:database,city:'Siargao',apiKey:'k',fetchImpl,now});
  assert.equal(d.wikivoyage[0].name,'Fat Lips Surfshop');assert.equal(d.places[0].text,'Magpupungko Rock Pools: Tourist attraction. Tidal pools in the rocks.');
  assert.equal(calls.filter(u=>u.includes('places.googleapis')).length,3);
  await T.destination({db:database,city:'Siargao',apiKey:'k',fetchImpl,now:now+86400000});assert.equal(calls.length,4);
  const empty=db();await T.destination({db:empty,city:'Siargao',apiKey:'',fetchImpl:async()=>new Response('no',{status:503}),now});assert.equal(empty.m.size,0);
});
test('every destination has a Wikivoyage article and a search box',()=>{
  const {CITIES}=require('./activity-locations');
  for(const city of Object.keys(T.WIKIVOYAGE)){assert.ok(T.WIKIVOYAGE[city].length);assert.ok(CITIES[city],city);}
  assert.equal(T.pageUrl('Taipei/Old Taipei'),'https://en.wikivoyage.org/wiki/Taipei/Old_Taipei');
});
test('listing text decodes hex and named entities in one pass',()=>{
  assert.equal(T.plain("the country&#x27;s culture &hellip; Manila&rsquo;s parks &amp;quot; &#39;x&#39; &bogus; 1&ndash;2"),"the country's culture \u2026 Manila\u2019s parks &quot; 'x' &bogus; 1\u20132");
});
