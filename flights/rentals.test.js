import test from 'node:test';
import assert from 'node:assert/strict';
import {facts,dotTitle,parseDot,parseDotDetail,parseHoppler,parseHopplerDetail,dedupe,benchmarks,trackHistory,withFacts,crawl,dotUrl,hopplerUrl} from './rentals.js';

const icon=n=>'<img src="//build.dotproperty.com.ph/assets/'+n+'-abc12345.svg">';
const dotCard=({uuid='u1',title='1 Bedroom Condo for rent in The Sapphire Bloc, San Antonio, Metro Manila near MRT-3 Ortigas',price='25,000',per='/ month',beds='1',sqm='32',snippet='Fully furnished, 2 months deposit 1 month advance',verified=true}={})=>
  '<article data-uuid="'+uuid+'"><a href="https://www.dotproperty.com.ph/ads/x_'+uuid+'"><img src="https://pix.dotproperty.co.th/abc"><div title="'+title+'">'+title+'</div><div>'+icon('location')+' Pasig, Metro Manila</div>'+
  '<div>₱ '+price+'</div><div>'+per+'</div></a><ul>'+(beds!=null?'<li><span>'+icon('bed')+'</span> '+beds+'</li>':'')+'<li><span>'+icon('bathtub')+'</span> 1</li>'+(sqm!=null?'<li><span>'+icon('resize')+'</span> '+sqm+' m<sup>2</sup></li>':'')+'<li>'+icon('home')+' Condo</li></ul>'+
  '<div class="line-clamp-4">'+snippet+'</div><a href="https://www.dotproperty.com.ph/publisher/a/properties-for-rent"><div title="Jane Agent">Jane Agent</div>'+(verified?'<span>'+icon('verified')+'</span>':'')+'</a></article>';
const dotPage=(cards,total)=>'<html><body>'+cards.join('')+'<script>var last_search = {"totalProperty":'+total+',"x":1}</script></body></html>';
// What Firestore refuses in a document: undefined values and a list inside a list.
const firestoreProblem=(v,path='doc',inList=false)=>{
  if(v===undefined)return path+' is undefined';
  if(Array.isArray(v)){if(inList)return path+' is a list inside a list';for(let i=0;i<v.length;i++){const p=firestoreProblem(v[i],path+'['+i+']',true);if(p)return p;}return null;}
  if(v && typeof v==='object'){for(const [k,x] of Object.entries(v)){const p=firestoreProblem(x,path+'.'+k,false);if(p)return p;}}
  return null;
};
const hopplerPage=rows=>'<html><script id="hiResultsPageResult" type="application/json">'+Buffer.from(JSON.stringify(rows)).toString('base64')+'</script></html>';
const hop=(o={})=>({propertyKey:'RR1',feStatus:'Available',category:'Rent',type:'Condominium',building:'Aurora Escalades',area:'Cubao',city:'Quezon City',permalink:'/quezon-city-cubao-aurora-escalades-rr1',minPrice:21000,maxPrice:21000,discountedPrice:21000,floorArea:24,bedrooms:0,bathrooms:1,photos:['hoppler/p.png'],dateModified:'2026-03-08T10:00:00+08:00',dateAvailability:'2026-04-01T23:59:59+08:00',...o});

test('facts reads only what the listing states', ()=>{
  const f=facts('Fully furnished (semi-furnished on request). 2 months deposit, 1 month advance. Minimum of 6 months. Inclusive of association dues. PDC required.',25000);
  assert.equal(f.furnish,'Fully furnished');assert.equal(f.deposit,2);assert.equal(f.advance,1);assert.equal(f.minLeaseMonths,6);assert.equal(f.duesIncluded,true);assert.equal(f.pdc,true);
  assert.deepEqual(facts('Nice view',20000),{furnish:null,stay:null,deposit:null,advance:null,termsAsWritten:null,pdc:null,minLeaseMonths:null,duesIncluded:null,textPrice:null});
  assert.equal(facts('Bare unit, exclusive of dues').furnish,'Unfurnished');
  assert.equal(facts('Bare unit, exclusive of dues').duesIncluded,false);
  assert.equal(facts('Association dues not included').duesIncluded,false);
  assert.equal(facts('Furnished studio').furnish,'Furnished');
  assert.equal(facts('Non-furnished').furnish,'Unfurnished');
  assert.equal(facts('1 year contract').minLeaseMonths,12);
});
test('facts tells short stays from long leases', ()=>{
  assert.equal(facts('Perfect for staycation, ₱2,500 per night').stay,'short');
  assert.equal(facts('Long term lease only, 12 months').stay,'long');
  assert.equal(facts('Short term and long term available').stay,'both');
});
test('2+1 is read beside a payment word only, as written', ()=>{
  assert.equal(facts('-no PDC required 2+1 Ortigas').termsAsWritten,'2+1');
  assert.equal(facts('-no PDC required 2+1 Ortigas').pdc,false);
  assert.equal(facts('Spacious 1+1 layout near Megamall').termsAsWritten,null);
  assert.equal(facts('Terms: 1+1, 2 months deposit').termsAsWritten,null,'stated months take precedence');
});
test('one stated monthly price that differs from the listing is flagged', ()=>{
  assert.equal(facts('Price: 28,000 / month',25000).textPrice,28000);
  assert.equal(facts('₱25,000/month',25000).textPrice,null);
  assert.equal(facts('Studio ₱18,000/month, 1BR ₱25,000/month',18000).textPrice,null,'several units say nothing');
});
test('DotProperty titles give building, barangay and station', ()=>{
  assert.deepEqual(dotTitle('1 Bedroom Condo for rent in The Sapphire Bloc, San Antonio, Metro Manila near MRT-3 Ortigas'),{building:'The Sapphire Bloc',locality:'San Antonio',near:'MRT-3 Ortigas'});
  assert.deepEqual(dotTitle('Condo for rent in Wack-Wack Greenhills, Metro Manila'),{building:null,locality:'Wack-Wack Greenhills',near:null});
});
test('DotProperty cards: monthly rent, icons, studios, no parking slots', ()=>{
  const {items,total}=parseDot(dotPage([
    dotCard(),
    dotCard({uuid:'u2',title:'Condo for rent in Aurora Escalades, San Roque, Metro Manila',beds:null,sqm:'22',snippet:'Brand-new studio at Aurora Escalades'}),
    dotCard({uuid:'u3',title:'Condo for rent in Asia Tower, Bel-Air, Metro Manila',price:'5,000',beds:null,sqm:'12.5',snippet:'Slot Number: B2'}),
    dotCard({uuid:'u4',title:'Condo for rent in BGC, Metro Manila',price:'9,000',beds:null,sqm:'20',snippet:'Tandem parking space in BGC'}),
    dotCard({uuid:'u5',per:'/ night'}),
    dotCard({uuid:'u6',beds:'1',sqm:'1'})
  ],36),'ortigas');
  assert.equal(total,36);
  assert.deepEqual(items.map(i=>i.id),['dot:u1','dot:u2','dot:u6']);
  const [a,b,c]=items;
  assert.equal(a.price,25000);assert.equal(a.beds,1);assert.equal(a.baths,1);assert.equal(a.sqm,32);assert.equal(a.building,'The Sapphire Bloc');assert.equal(a.near,'MRT-3 Ortigas');assert.equal(a.seller,'Jane Agent');assert.equal(a.verified,true);assert.equal(a.locality,'San Antonio, Pasig');
  assert.equal(b.beds,0,'studio named in the text');
  assert.equal(c.sqm,null,'a 1 m² 1-bedroom is a typo');
});
test('DotProperty detail keeps the description lines', ()=>{
  assert.equal(parseDotDetail('<div class="text-description"> FOR RENT <br /> Price: 28,000 / month<br/>-Fully Furnished </div>').description,'FOR RENT Price: 28,000 / month -Fully Furnished');
});
test('Hoppler results come from its embedded JSON', ()=>{
  const r=parseHoppler(hopplerPage([hop(),hop({propertyKey:'RR2',feStatus:'Leased'}),hop({propertyKey:'RR3',minPrice:20000,maxPrice:24000,discountedPrice:null,bedrooms:1})]),'cubao');
  assert.equal(r.readable,true);assert.equal(r.rows,3);assert.equal(r.maxPrice,21000);
  assert.deepEqual(r.items.map(i=>i.id),['hop:RR1','hop:RR3']);
  assert.equal(r.items[0].url,'https://www.hoppler.com.ph/quezon-city-cubao-aurora-escalades-rr1');
  assert.equal(r.items[0].availableFrom,'2026-04-01');
  assert.equal(r.items[1].priceFrom,true);
  assert.ok(!('priceFrom' in r.items[0]),'Firestore refuses an undefined field');
  assert.equal(parseHoppler('<html></html>','cubao').readable,false);
});
test('Hoppler detail stops before similar listings', ()=>{
  const d=parseHopplerDetail('<body><nav>Furnished condos</nav><h2>Details</h2> Studio 24 sqm Semi Furnished <p>About the Property</p><h3>Similar Properties</h3> Fully Furnished</body>').description;
  assert.match(d,/Semi Furnished/);assert.doesNotMatch(d,/Fully/);
});
test('one unit posted by several agents counts once', ()=>{
  const rows=dedupe([
    {id:'a',source:'DotProperty',building:'The Sapphire Bloc',beds:1,sqm:32,price:25000,url:'u-a'},
    {id:'b',source:'Hoppler',building:'Sapphire Bloc Tower',beds:1,sqm:32.2,price:25000,url:'u-b',detailAt:'2026-10-29T00:00:00Z',verified:true},
    {id:'c',source:'DotProperty',building:'The Sapphire Bloc',beds:1,sqm:32,price:26000,url:'u-c'},
    {id:'d',source:'DotProperty',building:null,beds:1,sqm:32,price:25000,url:'u-d'}
  ]);
  assert.deepEqual(rows.map(r=>r.id),['b','c','d']);
  assert.deepEqual(rows[0].also,[{source:'DotProperty',url:'u-a',seller:undefined}]);
  const same={source:'DotProperty',building:null,locality:'Socorro, Quezon City',beds:1,sqm:28,price:15000,seller:'Ann'};
  assert.deepEqual(dedupe([{...same,id:'x',url:'u-x'},{...same,id:'y',url:'u-y'},{...same,id:'z',url:'u-z',seller:'Ben'}]).map(r=>r.id),['x','z'],'one seller posting the same unit twice');
});
test('area medians need five listings', ()=>{
  const rows=[20000,22000,24000,26000,28000].map((price,i)=>({area:'ortigas',beds:1,price,sqm:i<4?40:null}));
  const b=benchmarks(rows);
  assert.deepEqual(b.ortigas['1br'],{n:5,medianRent:24000});
  assert.deepEqual(benchmarks(rows.concat({area:'ortigas',beds:1,price:30000,sqm:40})).ortigas['1br'],{n:6,medianRent:25000,medianPerSqm:600,sized:5});
  assert.equal(b.cubao,undefined);
});
test('price memory keeps first seen and shows a change', ()=>{
  const first=trackHistory([{id:'a',price:25000}],null,'2026-10-29T23:00:00.000Z');
  assert.equal(first.items[0].firstSeen,'2026-10-29T23:00:00.000Z');assert.equal(first.history.since,'2026-10-29T23:00:00.000Z');
  const again=trackHistory([{id:'a',price:25000}],first.history,'2026-10-29T23:30:00.000Z');
  assert.equal(again.items[0].previousPrice,undefined,'same-day rerun');
  const later=trackHistory([{id:'a',price:23000}],again.history,'2026-11-02T23:00:00.000Z');
  assert.equal(later.items[0].firstSeen,'2026-10-29T23:00:00.000Z');assert.equal(later.items[0].previousPrice,25000);assert.equal(later.items[0].previousDay,'2026-10-29');
  assert.deepEqual(later.history.items.a.p,[{d:'2026-10-29',r:25000},{d:'2026-11-02',r:23000}]);
  assert.equal(firestoreProblem(later.history),null);
  const gone=trackHistory([],later.history,'2027-02-01T00:00:00.000Z');
  assert.deepEqual(gone.history.items,{},'unseen for 60 days drops');
});
test('a read detail page overrides the card snippet', ()=>{
  const i=withFacts({title:'Condo',snippet:'Semi furnished',price:25000},{description:'Fully furnished. 2 months deposit',at:'2026-10-29T00:00:00Z'});
  assert.equal(i.furnish,'Fully furnished');assert.equal(i.deposit,2);assert.equal(i.detailAt,'2026-10-29T00:00:00Z');
  assert.equal(withFacts({title:'Condo',snippet:'Semi furnished',price:25000},null).furnish,'Semi-furnished');
});
test('crawl pages politely, records blocked pages and carries recent details', async ()=>{
  const pages=new Map([[dotUrl('pasig/ortigas'),dotPage([dotCard({uuid:'o1'})],1)],[hopplerUrl('quezon-city/cubao'),hopplerPage([hop()])],['https://www.hoppler.com.ph/quezon-city-cubao-aurora-escalades-rr1','<body>Details Studio Fully Furnished. 1 year contract</body>']]);
  const asked=[];
  const fetchImpl=async url=>{asked.push(url);const body=pages.get(url);return body?{ok:true,status:200,text:async()=>body}:{ok:false,status:403,text:async()=>''};};
  const prior={items:[{id:'dot:o1',price:25000,detailAt:'2026-10-20T00:00:00.000Z',furnish:'Semi-furnished',deposit:2}]};
  const r=await crawl({checkedAt:'2026-10-29T23:00:00.000Z',prior,fetchImpl,pause:0});
  const o=r.items.find(i=>i.id==='dot:o1'),h=r.items.find(i=>i.id==='hop:RR1');
  assert.equal(o.furnish,'Semi-furnished','carried, not refetched');assert.equal(o.detailAt,'2026-10-20T00:00:00.000Z');
  assert.ok(!asked.includes('https://www.dotproperty.com.ph/ads/x_o1'));
  assert.equal(h.furnish,'Fully furnished');assert.equal(h.minLeaseMonths,12);
  assert.equal(r.detailRead,1);assert.equal(r.detailCarried,1);
  assert.equal(r.sources.find(s=>s.loc==='taguig/bgc').status,'unavailable');
  assert.match(r.sources.find(s=>s.loc==='taguig/bgc').message,/HTTP 403; no bypass attempted/);
  assert.equal(r.sources.find(s=>s.loc==='pasig/ortigas').pages,1);
  const tracked=trackHistory(dedupe(r.items),null,'2026-10-29T23:00:00.000Z');
  assert.equal(firestoreProblem(JSON.parse(JSON.stringify({items:tracked.items,sources:r.sources}))),null);
  assert.equal(firestoreProblem(tracked.history),null);
  assert.match(String(firestoreProblem({p:[['2026-10-29',1]]})),/list inside a list/,'the check itself catches the 29 Oct failure');
});
