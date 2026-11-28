// Scheduled retries should collect once per Philippine day. Manual refreshes
// can force another observation without pretending that a skipped run is fresh.
const DAY=86400000,day=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);

function usablePrice(item,now){
  const checked=Date.parse(item?.checkedAt),today=day(now);
  return item?.currency==='PHP' && Number.isFinite(item.price) && item.price>0 && Number.isFinite(item.originalPrice) && item.originalPrice>item.price &&
    Number.isFinite(checked) && checked<=now+300000 && now-checked<=4*DAY &&
    (!item.validFrom || item.validFrom<=today) && (!item.validTo || item.validTo>=today);
}

export function clothingRefreshDecision(feed,health,{now=Date.now(),force=false}={}){
  if(!Number.isFinite(now))throw Error('Invalid scout check time.');
  if(force)return {needed:true,reason:'Manual refresh requested.'};
  const generated=Date.parse(feed?.generatedAt);
  if(!Number.isFinite(generated) || generated>now+300000)return {needed:true,reason:'No usable saved scan timestamp.'};
  if(day(generated)!==day(now))return {needed:true,reason:'No successful scan for today in Philippine time.'};
  const lastRun=Date.parse(health?.lastRunAt);
  if(health?.status==='failed' && (!Number.isFinite(lastRun) || lastRun>=generated))return {needed:true,reason:'Retrying a failed scout.'};
  if(!(Array.isArray(feed.items)?feed.items:[]).some(i=>usablePrice(i,now) && Date.parse(i.checkedAt)>=generated-300000))return {needed:true,reason:'The saved scan has no current priced observations.'};
  return {needed:false,reason:'A successful scan with priced observations already exists for today.'};
}

export function assertPricedClothingFeed(feed,now=Date.now()){
  if(!(Array.isArray(feed?.items)?feed.items:[]).some(i=>usablePrice(i,now)))throw Error('No usable priced markdowns were read; previous clothing feed preserved.');
}
