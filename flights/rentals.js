import {load} from 'cheerio';
// Condos for long-term rent in Bob's areas, from two public listing sites that
// answer ordinary requests: DotProperty (agent and owner ads) and Hoppler
// (a brokerage). Lamudi, MyProperty, Rentpad and OnePropertee refuse automated
// reads, so the app links to them for a manual look instead. No AI calls.
// The scout reads up to CAP so the app's budget can move a little above
// Bob's ₱25,000 without a scout change.
export const CAP=30000;
export const AREAS=[
  {id:'cubao',name:'Cubao',dot:['quezon-city/cubao'],hoppler:['quezon-city/cubao']},
  {id:'ortigas',name:'Ortigas',dot:['pasig/ortigas'],hoppler:['pasig/ortigas-center']},
  // Makati CBD by barangay: San Lorenzo holds Legaspi Village and Greenbelt,
  // Bel-Air holds Salcedo Village, Urdaneta sits along Ayala and Paseo.
  {id:'makati',name:'Makati CBD',dot:['makati/san-lorenzo','makati/bel-air','makati/urdaneta','makati/poblacion','makati/rockwell'],hoppler:['makati/legaspi-village','makati/salcedo-village','makati/poblacion','makati/rockwell-center']},
  {id:'bgc',name:'BGC',dot:['taguig/bgc'],hoppler:['taguig/bgc-bonifacio-global-city']}
];
// Below this a "condo" is a bed space or parking slot, not a home.
export const MIN_RENT=8000;
export const UA='DaybookRentalScout/1.0 (public rental listings)';
export const dotUrl=(loc,page=1)=>'https://www.dotproperty.com.ph/condos-for-rent/metro-manila/'+loc+'?max_price='+CAP+'&sort=newest'+(page>1?'&page='+page:'');
export const hopplerUrl=(loc,page=1)=>'https://www.hoppler.com.ph/condominiums-for-rent/'+loc+'?sort=minPrice&sortBy=asc'+(page>1?'&page='+page:'');
const clean=s=>String(s==null?'':s).replace(/\s+/g,' ').trim();
const num=s=>{const n=Number(String(s==null?'':s).replace(/,/g,''));return Number.isFinite(n)?n:null;};
// Bed spaces, rooms in a shared unit, parking and offices are not a condo to live in.
const NOT_A_UNIT=/\b(?:bed ?spaces?|room for rent|rooms? for rent|dorm(?:itory)?|parking slots?|office spaces?|commercial)\b/i;

// What a listing's own words say about furnishing, lease and payment terms.
// Only stated facts: anything not written stays null ("not stated").
export function facts(text,listedPrice){
  const t=clean(text),out={furnish:null,stay:null,deposit:null,advance:null,termsAsWritten:null,pdc:null,minLeaseMonths:null,duesIncluded:null,textPrice:null};
  // The first furnishing word wins: "Fully furnished (semi-furnished on request)".
  const f=/\b(semi[- ]?|un|non[- ]?|fully[- ]?|full[- ]?)?furnished\b|\bbare unit\b/i.exec(t);
  if(f)out.furnish=/^bare/i.test(f[0])?'Unfurnished':!f[1]?'Furnished':/^semi/i.test(f[1])?'Semi-furnished':/^(?:un|non)/i.test(f[1])?'Unfurnished':'Fully furnished';
  const short=/\b(?:staycations?|per night|nightly|daily rates?|short[- ]?term|short stays?|airbnb|transient|per day|weekly rates?|check[- ]?in time)\b|\/\s?night\b/i.test(t);
  const long=/\b(?:long[- ]?term|1[- ]?year|one[- ]year|12[- ]?months?|yearly|annual(?:ly)?|lease contract|6[- ]?months?|six months)\b/i.test(t);
  out.stay=short && long?'both':short?'short':long?'long':null;
  const dep=/(\d)\s*(?:months?|mos?\.?|mons?)\s*(?:security\s*)?deposits?\b/i.exec(t) || /\bdeposits?\s*(?:of|:)?\s*(\d)\s*(?:months?|mos?)\b/i.exec(t);
  const adv=/(\d)\s*(?:months?|mos?\.?|mons?)\s*advance\b/i.exec(t) || /\badvance\s*(?:payment|rent(?:al)?)?\s*(?:of|:)?\s*(\d)\s*(?:months?|mos?)\b/i.exec(t);
  if(dep)out.deposit=Number(dep[1]);
  if(adv)out.advance=Number(adv[1]);
  // "2+1" is shorthand for deposit and advance, but "1+1" can also be a
  // layout. Read it only beside a payment word, and show it as written.
  const plus=/\b(?:terms?|payments?|deposits?|advance|pdcs?)\b[^.\n]{0,30}?\b([1-3])\s*\+\s*([1-3])\b/i.exec(t) || /\b([1-3])\s*\+\s*([1-3])\b[^.\n]{0,20}?\b(?:terms?|payments?|deposits?|advance|pdcs?)\b/i.exec(t);
  if(plus && out.deposit==null && out.advance==null)out.termsAsWritten=plus[1]+'+'+plus[2];
  if(/\bno\s*pdcs?\b|\bpdcs?\s*(?:is\s*)?not\s*required\b/i.test(t))out.pdc=false;
  else if(/\bpdcs?\b|\bpost[- ]?dated\s*(?:cheques?|checks?)\b/i.test(t))out.pdc=true;
  const lease=/\b(?:minimum|min\.?)\s*(?:of\s*)?(?:lease|contract|stay|term)?\s*(?:of|:)?\s*(\d{1,2})\s*(?:months?|mos?)\b/i.exec(t) || /\b(\d{1,2})\s*(?:months?|mos?)\s*(?:minimum|min\.?|lease|contract)\b/i.exec(t);
  const year=/\b(?:minimum|min\.?)\s*(?:of\s*)?(?:lease|contract|stay|term)?\s*(?:of|:)?\s*(?:1|one)\s*(?:years?|yrs?)\b/i.test(t) || /\b(?:1|one)[- ]?(?:years?|yrs?)\s*(?:minimum|lease|contract)\b/i.test(t);
  if(lease && Number(lease[1])>=1 && Number(lease[1])<=24)out.minLeaseMonths=Number(lease[1]);else if(year)out.minLeaseMonths=12;
  const DUES='(?:the\\s*)?(?:monthly\\s*)?(?:association|assoc\\.?|condo)?\\s*dues';
  if(new RegExp('\\b(?:exclusive of|excludes?|excluding|not including|plus|w/o)\\s*'+DUES+'|\\bdues\\s*(?:are\\s*)?(?:not included|excluded|exclusive|extra)\\b|\\+\\s*'+DUES,'i').test(t))out.duesIncluded=false;
  else if(new RegExp('\\b(?:inclusive of|includes?|including|incl\\.?|with)\\s*'+DUES+'|\\bdues\\s*(?:are\\s*)?(?:included|inclusive)\\b','i').test(t))out.duesIncluded=true;
  // A single monthly price in the text that differs from the listed price is
  // worth asking about. Several prices (different units) say nothing.
  const prices=new Set();
  for(const m of t.matchAll(/(?:₱|php|\bp)\s?(\d{1,3}(?:,\d{3})+|\d{4,6})(?:\.00)?\s*(?:\/|per|a)?\s*(?:month|mo)\b/gi))prices.add(num(m[1]));
  for(const m of t.matchAll(/\b(?:price|rent|rental|rate|monthly)\s*(?:is|:|-)?\s*(?:₱|php|p)?\s?(\d{1,3}(?:,\d{3})+|\d{5,6})\b/gi))prices.add(num(m[1]));
  const stated=[...prices].filter(p=>p>=5000 && p<=200000);
  if(stated.length===1 && listedPrice && Math.abs(stated[0]-listedPrice)>=500)out.textPrice=stated[0];
  return out;
}

// "1 Bedroom Condo for rent in The Sapphire Bloc, San Antonio, Metro Manila
// near MRT-3 Ortigas" → building, barangay and the nearest station.
export function dotTitle(title){
  const m=/for rent in (.+?)(?: near (.+))?$/i.exec(clean(title));
  if(!m)return {building:null,locality:null,near:null};
  const parts=m[1].split(/\s*,\s*/).filter(p=>!/^metro manila$/i.test(p));
  return {building:parts.length>=2?parts[0]:null,locality:parts.length>=2?parts[1]:parts[0] || null,near:m[2]?clean(m[2]):null};
}
export function parseDot(html,area){
  const $=load(html),out=[];
  const total=num((/"totalProperty":(\d+)/.exec(html) || [])[1]);
  $('article[data-uuid]').each((_,node)=>{
    const a=$(node),uuid=a.attr('data-uuid'),url=a.find('a[href^="https://www.dotproperty.com.ph/ads/"]').first().attr('href');
    const title=clean(a.find('div[title]').filter((_,d)=>/for rent/i.test($(d).attr('title') || '')).first().attr('title'));
    const text=clean(a.text()),price=num((/₱\s*([\d,]+)\s*\/\s*month/i.exec(text) || [])[1]);
    if(!uuid || !url || !title || !price || NOT_A_UNIT.test(title))return;
    let beds=null,baths=null,sqm=null;
    a.find('li').each((_,li)=>{const l=$(li),src=l.find('img').attr('src') || '',v=clean(l.text());
      if(/\/bed-/.test(src))beds=num(v);else if(/\/bathtub-/.test(src))baths=num(v);else if(/\/resize-/.test(src))sqm=num((/([\d.,]+)\s*m/.exec(v) || [])[1]);});
    const snippet=clean(a.find('.line-clamp-4,.line-clamp-3').first().text()).slice(0,200);
    if(beds==null){const b=/^(\d+)\s*Bedrooms?\b/i.exec(title);beds=b?Number(b[1]):/\bstudio\b/i.test(title+' '+snippet)?0:null;}
    // Parking slots are listed as condos (11–13 m², no bedrooms). A unit with
    // bedrooms and a 1 m² size is a typo, so its size is dropped instead.
    if(beds==null && (sqm!=null && sqm<16 || /\b(?:parking|slot)\b/i.test(snippet.slice(0,160))))return;
    if(sqm!=null && sqm<16)sqm=null;
    const where=dotTitle(title),seller=clean(a.find('a[href*="/publisher/"] [title]').first().attr('title'));
    const city=clean(a.find('img[src*="/location-"]').first().closest('div').text()).replace(/,\s*Metro Manila$/i,'');
    out.push({id:'dot:'+uuid,source:'DotProperty',area,url,title:title.slice(0,200),price,beds,baths,sqm,
      building:where.building,locality:[where.locality,city].filter(Boolean).filter((v,i,all)=>all.indexOf(v)===i).join(', ') || null,near:where.near,
      seller:seller || null,verified:a.find('img[src*="/verified-"]').length>0,featured:/\bFeatured\b/.test(a.find('[title="Featured"]').text() || ''),
      image:a.find('img[src^="https://pix.dotproperty.co.th/"]').first().attr('src') || null,snippet});
  });
  return {items:out,total};
}
export function parseDotDetail(html){
  const $=load(html),box=$('.text-description').first();
  box.find('br').replaceWith('\n');
  return {description:clean(box.text()).slice(0,4000)};
}
const hopplerRows=html=>{const m=/<script id="hiResultsPageResult" type="application\/json">([^<]*)<\/script>/.exec(html);if(!m)return null;try{const v=JSON.parse(Buffer.from(m[1],'base64').toString('utf8'));return Array.isArray(v)?v:null;}catch{return null;}};
export function parseHoppler(html,area){
  const rows=hopplerRows(html);
  if(!rows)return {items:[],rows:0,maxPrice:0,readable:false};
  const items=rows.flatMap(r=>{
    const price=num(r.discountedPrice) || num(r.minPrice);
    if(r.category!=='Rent' || r.type!=='Condominium' || r.feStatus!=='Available' || !price || !/^\/[a-z0-9-]+$/.test(r.permalink || ''))return [];
    return [{id:'hop:'+r.propertyKey,source:'Hoppler',area,url:'https://www.hoppler.com.ph'+r.permalink,title:clean([r.bedrooms===0?'Studio':r.bedrooms+' BR',r.building,r.area].filter(Boolean).join(' · ')),
      price,...(num(r.maxPrice)>num(r.minPrice)?{priceFrom:true}:{}),beds:num(r.bedrooms),baths:num(r.bathrooms),sqm:num(r.floorArea),building:clean(r.building) || null,locality:[r.area,r.city].filter(Boolean).join(', ') || null,near:null,
      seller:'Hoppler',verified:true,featured:false,image:r.photos && r.photos[0]?'https://d2wy52y0hrt3v.cloudfront.net/'+r.photos[0]+'?sg=propertycard':null,
      updatedAt:r.dateModified || null,availableFrom:r.dateAvailability?String(r.dateAvailability).slice(0,10):null,snippet:''}];
  });
  return {items,rows:rows.length,maxPrice:Math.max(0,...rows.map(r=>num(r.minPrice) || 0)),readable:true};
}
// Hoppler's detail page opens with a Details block ("Studio 1 1 24 sqm (Floor
// Area) Fully Furnished Status Available Last Updated …") and then About the
// Property. Similar listings below it would mislead the facts, so stop there.
export function parseHopplerDetail(html){
  const $=load(html);$('script,style,noscript,svg').remove();
  // Spaces between elements, or headings run into the words beside them.
  const t=clean(load('<p>'+String($('body').html() || '').replace(/<[^>]+>/g,' ')+'</p>').text()),start=t.search(/\bDetails\b/),rest=start>=0?t.slice(start):t;
  const end=rest.search(/\b(?:Similar (?:Properties|Listings)|Nearby (?:Properties|Listings)|You may also like|Other (?:Properties|Listings))\b/i);
  return {description:(end>0?rest.slice(0,end):rest).slice(0,4000)};
}

const normBuilding=b=>String(b || '').toLowerCase().replace(/\b(?:the|tower|towers|residences?|condominium|condo)\b/g,'').replace(/[^a-z0-9]/g,'');
// One unit is often posted by several agents and on both sites. The same
// building, bedrooms, size and rent count as one listing; the others are
// kept as extra links. The listing with read details leads.
export function dedupe(items){
  const groups=new Map(),out=[];
  for(const i of items){
    // With no building named, one seller's identical posts in one barangay.
    const key=i.building && i.sqm?[normBuilding(i.building),i.beds,Math.round(i.sqm),i.price].join('|'):i.sqm && i.seller && i.locality?['seller',i.seller,i.locality,i.beds,Math.round(i.sqm),i.price].join('|'):i.id;
    if(!groups.has(key)){groups.set(key,[]);out.push(key);}
    groups.get(key).push(i);
  }
  return out.map(k=>{const g=groups.get(k).sort((a,b)=>(b.detailAt?1:0)-(a.detailAt?1:0) || (b.verified?1:0)-(a.verified?1:0));
    return g.length>1?{...g[0],also:g.slice(1,4).map(x=>({source:x.source,url:x.url,seller:x.seller}))}:g[0];});
}
const median=v=>{const s=[...v].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:Math.round((s[m-1]+s[m])/2);};
// Typical rent per area and size from this run's listings, so a card can say
// whether its rent per m² is low or high for where it is.
export function benchmarks(items){
  const out={};
  for(const area of AREAS)for(const [kind,beds] of [['studio',0],['1br',1]]){
    const rows=items.filter(i=>i.area===area.id && i.beds===beds && i.price>0);
    const sized=rows.filter(i=>i.sqm>=15 && i.sqm<=120);
    if(rows.length>=5)(out[area.id] ||= {})[kind]={n:rows.length,medianRent:median(rows.map(i=>i.price)),...(sized.length>=5?{medianPerSqm:median(sized.map(i=>Math.round(i.price/i.sqm))),sized:sized.length}:{})};
  }
  return out;
}
// Compact price memory: first seen, last seen and each price change, 60 days.
export function trackHistory(items,prior,checkedAt){
  const day=checkedAt.slice(0,10),cut=new Date(Date.parse(checkedAt)-60*86400000).toISOString().slice(0,10),entries={};
  for(const [id,e] of Object.entries(prior?.items || {}))if(e && e.l>=cut)entries[id]=e;
  const out=items.map(i=>{
    const e=entries[i.id] || {f:checkedAt,l:day,p:[]},before=e.p.filter(r=>r[0]!==day),last=before[before.length-1];
    const p=last && last[1]===i.price?before:before.concat([[day,i.price]]);
    entries[i.id]={f:e.f,l:day,p:p.slice(-12)};
    return {...i,firstSeen:e.f,...(last && last[1]!==i.price?{previousPrice:last[1],previousDay:last[0]}:{})};
  });
  const keep=Object.keys(entries).sort((a,b)=>entries[b].l.localeCompare(entries[a].l)).slice(0,3000);
  const since=prior?.since || checkedAt;
  return {items:out,history:{since,updatedAt:checkedAt,items:Object.fromEntries(keep.map(k=>[k,entries[k]]))}};
}

const DETAIL_FIELDS=['furnish','stay','deposit','advance','termsAsWritten','pdc','minLeaseMonths','duesIncluded','textPrice'];
// Listing-card facts first; a read detail page replaces them. A detail read
// in the last 30 days is carried over rather than fetched again.
export function withFacts(item,detail){
  const base=facts([item.title,item.snippet].join(' \n '),item.price);
  if(!detail)return {...item,...base};
  const d=facts(detail.description,item.price),merged={};
  for(const k of DETAIL_FIELDS)merged[k]=d[k]!=null?d[k]:base[k];
  return {...item,...merged,detailAt:detail.at};
}
export function carried(prior,checkedAt){
  const cut=Date.parse(checkedAt)-30*86400000,map=new Map();
  for(const i of prior?.items || [])if(i.detailAt && Date.parse(i.detailAt)>=cut && i.price)map.set(i.id,{price:i.price,at:i.detailAt,...Object.fromEntries(DETAIL_FIELDS.map(k=>[k,i[k]]))});
  return map;
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function getText(url,fetchImpl=fetch){
  const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{accept:'text/html','user-agent':UA}});
  if(!r.ok)throw Error('HTTP '+r.status);
  const text=await r.text();if(text.length>4000000)throw Error('Page exceeded reader limit');return text;
}
// One request at a time with a pause between, as a person paging through.
export async function crawl({checkedAt,prior,fetchImpl=fetch,pause=700,detailCap=120,log=()=>{}}){
  const sources=[],found=new Map();
  const take=rows=>{for(const i of rows)if(i.price<=CAP && i.price>=MIN_RENT && (i.beds==null || i.beds<=1) && !found.has(i.id))found.set(i.id,i);};
  for(const area of AREAS){
    for(const loc of area.dot){
      const row={site:'DotProperty',area:area.id,loc,url:dotUrl(loc),status:'ok',count:0,pages:0,message:''},seen=new Set();
      try{
        for(let page=1;page<=20;page++){
          const {items,total}=parseDot(await getText(dotUrl(loc,page),fetchImpl),area.id);row.pages=page;
          // Featured ads repeat on every page, so a page with nothing new is the end.
          const before=found.size,fresh=items.filter(i=>!seen.has(i.id));items.forEach(i=>seen.add(i.id));take(items);row.count+=found.size-before;
          if(row.total==null)row.total=total;
          if(!fresh.length || page*20>=(total || 0))break;
          await sleep(pause);
        }
        row.message=row.count+' studio/1-bedroom condos up to ₱'+CAP.toLocaleString('en-PH')+' read from '+row.pages+' page'+(row.pages===1?'':'s')+'.';
      }catch(e){row.status=row.count?'partial':'unavailable';row.message=(e.message.startsWith('HTTP')?e.message:'Page timed out or could not be read')+'; no bypass attempted.'+(row.count?' Kept '+row.count+' read before it stopped.':'');}
      sources.push(row);log(row);await sleep(pause);
    }
    for(const loc of area.hoppler){
      const row={site:'Hoppler',area:area.id,loc,url:hopplerUrl(loc),status:'ok',count:0,pages:0,message:''};
      try{
        // Cheapest first, so the pages past the cap need not be read.
        for(let page=1;page<=6;page++){
          const r=parseHoppler(await getText(hopplerUrl(loc,page),fetchImpl),area.id);row.pages=page;
          if(!r.readable){if(page===1)throw Error('Listing data not found');break;}
          const before=found.size;take(r.items);row.count+=found.size-before;
          if(r.rows<24 || r.maxPrice>CAP)break;
          await sleep(pause);
        }
        row.message=row.count+' studio/1-bedroom condos up to ₱'+CAP.toLocaleString('en-PH')+' read from '+row.pages+' page'+(row.pages===1?'':'s')+'.';
      }catch(e){row.status=row.count?'partial':'unavailable';row.message=(e.message.startsWith('HTTP')?e.message:e.message==='Listing data not found'?'The page no longer carries its listing data':'Page timed out or could not be read')+'; no bypass attempted.';}
      sources.push(row);log(row);await sleep(pause);
    }
  }
  // Detail pages: carry recent reads, then fetch the cheapest unread first.
  const keep=carried(prior,checkedAt),details=new Map();
  for(const [id,d] of keep)if(found.has(id) && found.get(id).price===d.price)details.set(id,{description:null,at:d.at,carried:d});
  const queue=[...found.values()].filter(i=>!details.has(i.id)).sort((a,b)=>a.price-b.price).slice(0,detailCap);
  let read=0,failed=0;
  for(const i of queue){
    try{const html=await getText(i.url,fetchImpl);details.set(i.id,{...(i.source==='Hoppler'?parseHopplerDetail(html):parseDotDetail(html)),at:checkedAt});read++;}
    catch{failed++;if(failed>=8 && !read)break;}
    await sleep(pause);
  }
  const items=[...found.values()].map(i=>{const d=details.get(i.id);
    if(d && d.carried){const merged={...withFacts(i,null)};for(const k of DETAIL_FIELDS)if(d.carried[k]!=null)merged[k]=d.carried[k];return {...merged,detailAt:d.at};}
    return withFacts(i,d && d.description!=null?d:null);});
  return {items,sources,detailRead:read,detailFailed:failed,detailCarried:[...details.values()].filter(d=>d.carried).length};
}
