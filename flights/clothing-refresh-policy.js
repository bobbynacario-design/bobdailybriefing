// Full scans run once per Philippine day; failed sources get a bounded retry. Manual refreshes
// can force another observation without pretending that a skipped run is fresh.
const DAY=86400000,day=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);

function usablePrice(item,now){
  const checked=Date.parse(item?.checkedAt),today=day(now);
  return item?.currency==='PHP' && Number.isFinite(item.price) && item.price>0 && Number.isFinite(item.originalPrice) && item.originalPrice>item.price &&
    Number.isFinite(checked) && checked<=now+300000 && now-checked<=4*DAY &&
    (!item.validFrom || item.validFrom<=today) && (!item.validTo || item.validTo>=today);
}

export const sourceSucceeded=s=>['ok','checked','announcements','imported'].includes(s?.status);
export function clothingRefreshDecision(feed,health,{now=Date.now(),force=false,expectedIds=[]}={}){
  if(!Number.isFinite(now))throw Error('Invalid scout check time.');
  const full=reason=>({needed:true,mode:'full',sourceIds:expectedIds,reason});
  if(force)return full('Manual refresh requested.');
  const generated=Date.parse(feed?.generatedAt);
  if(!Number.isFinite(generated) || generated>now+300000)return full('No usable saved scan timestamp.');
  if(day(generated)!==day(now))return full('No successful scan for today in Philippine time.');
  if(!(Array.isArray(feed.items)?feed.items:[]).some(i=>usablePrice(i,now) && Date.parse(i.checkedAt)>=generated-300000))return full('The saved scan has no current priced observations.');
  const sources=Array.isArray(feed.sources)?feed.sources:[],ids=[...new Set(expectedIds.concat(sources.map(s=>s.id)))];
  const failed=ids.filter(id=>{const s=sources.find(r=>r.id===id);return !s || !sourceSucceeded(s);});
  const retry=failed.filter(id=>{const s=sources.find(r=>r.id===id);return !s || s.attemptDay!==day(now) || !(s.attempts>=2);});
  if(retry.length)return {needed:true,mode:'sources',sourceIds:retry,reason:'Retrying only failed or missing sources ('+retry.length+'); successful observations keep their timestamps.'};
  const lastRun=Date.parse(health?.lastRunAt);
  if(!failed.length && health?.status==='failed' && (!Number.isFinite(lastRun) || lastRun>=generated))return full('Retrying a failed scout.');
  return {needed:false,mode:'skip',sourceIds:[],reason:failed.length?'Failed sources have reached today’s two-attempt limit.':'A successful scan with priced observations already exists for today.'};
}

export function assertPricedClothingFeed(feed,now=Date.now()){
  if(!(Array.isArray(feed?.items)?feed.items:[]).some(i=>usablePrice(i,now)))throw Error('No usable priced markdowns were read; previous clothing feed preserved.');
}
