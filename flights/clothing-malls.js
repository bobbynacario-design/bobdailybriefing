// Public SM search used by its storefront, plus a separately hosted retailer
// event page. Search matches are discovery only; details must prove the offer.
import {load} from 'cheerio';
import {createHash} from 'node:crypto';
import {parseMall} from './clothing.js';
const SM='https://www.smsupermalls.com';
const EVENT='https://sportscentral.ph/pages/sports-central-clearance-sale';
const clean=s=>String(s || '').replace(/\s+/g,' ').trim();
const sale=/\bsale\b|\boff\b|discount|buy\s+\d.*(?:get|take)|markdown/i;
const brands=/uniqlo|h\s*&\s*m|nike|adidas|crocs|zalora/i;
export function mallSearchCandidates(data,checkedAt){
  if(data?.status!==true || !Array.isArray(data.deals?.deals))throw Error('Unrecognised SM search response');
  const today=new Date(Date.parse(checkedAt)+8*3600000).toISOString().slice(0,10);
  return [...new Set(data.deals.deals.slice(0,24).flatMap(r=>{
    const title=clean(r.deal_promo_title || r.deal_name),slug=String(r.deal_slug || '');
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !brands.test(title) || !sale.test(title) || /\bwomen'?s?\b|\bkids?\b|\bboys?\b|\bgirls?\b/i.test(title))return [];
    const day=s=>/^\d{4}-\d{2}-\d{2}(?: |T)/.test(s || '')?s.slice(0,10):'';
    if(!day(r.deal_end) || day(r.deal_end)<today || day(r.deal_start)>today)return [];
    return [SM+'/smdeals/'+slug];
  }))];
}
export function parseRetailerEvent(html,checkedAt){
  const $=load(html);$('script,style,header,footer,nav').remove();
  const main=$('main').length?$('main'):$('body');main.find('h1,h2,h3,p,li,br').append(' ');const text=clean(main.text()),title=clean(main.find('h1').map((_,e)=>$(e).text()).get().join(' '));
  if(!/clearance sale/i.test(title) || !sale.test(text))return [];
  // The first date range is the event. Do not mistake a card/member perk's
  // smaller redemption window for the entire event, or invent a current year.
  const m=/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*[–—-]\s*(\d{1,2})(?:,?\s+(20\d{2}))?\b/i.exec(text);
  const year=m?.[4] || /\b(20\d{2})\b/.exec(title)?.[1];if(!m || !year)return [];
  const month='jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(m[1].slice(0,3).toLowerCase());
  const day=n=>{const d=new Date(Date.UTC(+year,month,+n));return d.getUTCMonth()===month && d.getUTCDate()===+n?d.toISOString().slice(0,10):'';};
  const validFrom=day(m[2]),validTo=day(m[3]),today=new Date(Date.parse(checkedAt)+8*3600000).toISOString().slice(0,10);
  if(!validFrom || !validTo || validFrom>validTo || today<validFrom || today>validTo)return [];
  const location=/📍\s*(.{1,160}?)(?=📅|PLUS|$)/u.exec(text)?.[1] || /\b(?:at|Venue:)\s+(SM [^.!]{1,100})/i.exec(text)?.[1] || '';
  const branches=[['SM City North Edsa','Quezon City'],['SM City Fairview','Quezon City'],['SM Megamall','Ortigas'],['SM Makati','Makati'],['SM Mall of Asia','Pasay']];
  const offered=['Adidas','Nike','Crocs','Under Armour','Skechers','Puma'].filter(b=>new RegExp('\\b'+b+'\\b','i').test(text.split(/PLUS ENJOY|EVENT EXCLUSIVES/i)[0]));
  return branches.filter(([b])=>location.toLowerCase().includes(b.toLowerCase())).flatMap(([branch,area])=>offered.map(brand=>({id:createHash('sha256').update(EVENT+branch+brand).digest('hex').slice(0,24),brand,retailer:'Sports Central',name:'Sports Central clearance sale · '+brand,branch,area,validFrom,validTo,url:EVENT,checkedAt,channel:'store',terms:text.slice(0,1800)})));
}
export async function readMallAlternatives(checkedAt,{fetchImpl=fetch,candidates=[],sourceIds=['sm-search','sc-events']}={}){
  const get=async url=>{const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'text/html,application/json','user-agent':'DaybookClothingScout/1.0 (public sale listings)'}});if(!r.ok)throw Error('HTTP '+r.status);const text=await r.text();if(text.length>4000000)throw Error('Page exceeded reader limit');return text;};
  const urls=new Set(candidates),promos=[],sources=[];let searchesChecked=0,detailsChecked=0,failed=0;
  if(sourceIds.includes('sm-search')){
  for(const keyword of ['uniqlo','adidas','nike','crocs','h&m']){
    try{const data=JSON.parse(await get(SM+'/list-deals?malls=all&tenants=all&category=all&keyword='+encodeURIComponent(keyword)+'&page=0'));mallSearchCandidates(data,checkedAt).forEach(u=>urls.add(u));searchesChecked++;}catch{failed++;}
  }
  for(const url of [...urls].slice(0,8)){
    try{const u=new URL(url);if(u.origin!==SM || !/^\/smdeals\/[a-z0-9-]+$/.test(u.pathname) || u.username || u.password)continue;promos.push(...parseMall(await get(u.href),u.href,checkedAt));detailsChecked++;}catch{failed++;}
  }
  sources.push({id:'sm-search',brand:'SM · clothing offer search',url:SM+'/smdeals',checkedAt,status:failed?'partial':'checked',count:0,promoCount:promos.length,searchesChecked,detailsChecked,message:searchesChecked+' of 5 brand searches and '+detailsChecked+' detail pages read; '+promos.length+' current branch announcements verified.'+(failed?' Some public pages were unavailable.':' No verified offer does not mean no sale.')});
  }
  if(sourceIds.includes('sc-events')){
  try{const rows=parseRetailerEvent(await get(EVENT),checkedAt);promos.push(...rows);sources.push({id:'sc-events',brand:'Sports Central · mall events',url:EVENT,checkedAt,status:rows.length?'announcements':'checked',count:0,promoCount:rows.length,message:rows.length?'Dated retailer event and participating venue verified; member/card perks remain in the published terms.':'Event page checked; no current dated event at a covered mall was verified.'});}
  catch(e){sources.push({id:'sc-events',brand:'Sports Central · mall events',url:EVENT,checkedAt,status:'unavailable',count:0,promoCount:0,message:e.message+'; open the retailer event page to check.'});}
  }
  return {promos:promos.filter((r,i,all)=>all.findIndex(x=>x.id===r.id)===i),sources};
}
