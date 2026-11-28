import {SOURCES,balancedItems,priceHistory} from './clothing.js';
import {sourceSucceeded,assertPricedClothingFeed} from './clothing-refresh-policy.js';
const day=at=>new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);
export const CLOTHING_SOURCE_IDS=SOURCES.map(s=>s.id).concat(['sm-search','sc-events']);
export function sourceId(row){
  if(row.sourceId)return row.sourceId;
  // Migrate the previous bounded feed without changing its observed times.
  try{
    const u=new URL(row.url);
    if(u.origin==='https://www.smsupermalls.com')return 'sm-search';
    if(u.origin==='https://sportscentral.ph' && u.pathname.startsWith('/pages/'))return 'sc-events';
    return SOURCES.find(s=>new URL(s.url).origin===u.origin && (s.vendors?Object.values(s.vendors).includes(row.brand):s.brand===row.brand || s.brand.endsWith(' · '+row.brand)))?.id || '';
  }catch{return '';}
}
export function buildClothingFeed(previous,results,prior,checkedAt,{full=true}={}){
  const oldSources=previous?.sources || [],allIds=CLOTHING_SOURCE_IDS.filter(id=>results.some(r=>r.id===id) || oldSources.some(r=>r.id===id));
  const previousRows=field=>(previous?.[field] || []).map(r=>({...r,sourceId:sourceId(r)}));
  const old={items:previousRows('items'),campaigns:previousRows('campaigns'),promos:previousRows('promos')},combined=[];
  for(const id of allIds){
    const result=results.find(r=>r.id===id),before=oldSources.find(r=>r.id===id);
    if(!result){combined.push({...before,items:old.items.filter(r=>r.sourceId===id),campaigns:old.campaigns.filter(r=>r.sourceId===id),promos:old.promos.filter(r=>r.sourceId===id)});continue;}
    const previousAttempt=before?.lastAttemptAt || before?.checkedAt,legacyAttempt=Number.isFinite(Date.parse(previousAttempt)) && day(previousAttempt)===day(checkedAt)?1:0;
    const ok=sourceSucceeded(result),row={...result,lastAttemptAt:checkedAt,lastSuccessAt:ok?checkedAt:(before?.lastSuccessAt || (sourceSucceeded(before)?before.checkedAt:'') || ''),attemptDay:day(checkedAt),attempts:(before?.attemptDay===day(checkedAt)?before.attempts || 0:legacyAttempt)+1};
    let retained=0;
    for(const field of ['items','campaigns','promos']){
      const fresh=(result[field] || []).map(r=>({...r,sourceId:id,...(field==='items' && Array.isArray(r.availableSizes) && !r.sizesCheckedAt?{sizesCheckedAt:r.checkedAt}:{})}));
      const keep=ok?[]:old[field].filter(r=>r.sourceId===id && !fresh.some(n=>n.id===r.id));
      retained+=keep.length;row[field]=fresh.concat(keep);
    }
    row.retainedCount=retained;combined.push(row);
  }
  const sample=balancedItems(combined),fresh=sample.filter(i=>i.checkedAt===checkedAt),tracked=priceHistory(fresh,prior,checkedAt),updates=new Map(tracked.items.map(i=>[i.id,i]));
  if(full && !fresh.some(i=>i.currency==='PHP' && i.price>0 && i.originalPrice>i.price))throw Error('No fresh priced markdowns read; previous clothing feed preserved.');
  const sources=combined.map(({items,campaigns,promos,candidates,fetchUrl,browser,shopify,vendors,pages,pageSize,shoes,...row})=>row);
  const unique=field=>combined.flatMap(r=>r[field] || []).filter((r,i,all)=>all.findIndex(n=>n.id===r.id)===i).slice(0,field==='campaigns'?60:80);
  const feed={kind:'shopping-feed',generatedAt:full?checkedAt:previous.generatedAt,...(!full?{lastRetryAt:checkedAt}:{}),items:sample.map(i=>updates.get(i.id) || i),campaigns:unique('campaigns'),promos:unique('promos'),sources,modelCalls:0,coverage:'A bounded sample of public Philippine sale pages; not a complete catalogue or live branch inventory. Retained observations keep their original timestamps; shipping and vouchers need checking.'};
  assertPricedClothingFeed(feed,Date.parse(checkedAt));
  return {feed,history:tracked.history};
}
