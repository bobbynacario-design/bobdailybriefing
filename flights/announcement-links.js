const allowed=['hellomnl.com','logisticsnews.ph','www.cebupacificair.com'];
function safe(raw) {
  try {const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&allowed.includes(u.hostname);}catch{return false;}
}
export async function checkAnnouncementLinks(offers,fetcher=fetch) {
  const urls=[...new Set(offers.filter(d=>d.campaign).map(d=>d.evidenceUrl))].slice(0,12);
  const statuses=new Map();
  for(let i=0;i<urls.length;i+=2)await Promise.all(urls.slice(i,i+2).map(async url=>{
    let ok=false;
    if(safe(url))try {
      const response=await fetcher(url,{signal:AbortSignal.timeout(12000),headers:{accept:'text/html'}});
      ok=response.ok && safe(response.url || url) && /text\/html/i.test(response.headers.get('content-type') || '');
      if(response.body?.cancel)await response.body.cancel();
    }catch{ /* Publisher outages do not remove a discovered campaign. */ }
    statuses.set(url,ok?'ok':'unavailable');
  }));
  return offers.map(d=>d.campaign?{...d,evidenceStatus:statuses.get(d.evidenceUrl)||'unavailable'}:d);
}
export function preferAnnouncement(existing,candidate) {
  if(!existing)return candidate;
  if(existing.campaign && candidate.campaign) {
    if(existing.evidenceStatus==='ok' && candidate.evidenceStatus!=='ok')return existing;
    if(candidate.evidenceStatus==='ok' && existing.evidenceStatus!=='ok')return candidate;
    if(existing.publisher===existing.airline)return existing;
  }
  return candidate.publisher===candidate.airline ? candidate : existing;
}
