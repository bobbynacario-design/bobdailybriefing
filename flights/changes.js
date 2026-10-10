export function trackChanges(offers,prior,checkedAt) {
  const priorTime=Date.parse(prior?.generatedAt || '');
  const comparable=Number.isFinite(priorTime) && Date.parse(checkedAt)>priorTime && Date.parse(checkedAt)-priorTime<=7*86400000;
  const previous=new Map((comparable ? prior.offers || [] : []).map(d=>[d.id,d]));
  // A page the last scout did not read cannot tell us an offer is new to the airline.
  const readBefore=new Set((prior?.sources || []).filter(s=>s.status==='ok').map(s=>s.url));
  return offers.map(d=>{
    // Retained offers were not re-read and cannot produce a fresh change signal.
    if(d.checkedAt!==checkedAt)return {...d,change:{status:'not-rechecked'}};
    const p=previous.get(d.id);
    if(!comparable)return {...d,change:{status:'first-observation'}};
    if(!p)return prior.sources && !readBefore.has(d.discoveryUrl || d.sourceUrl) ? {...d,change:{status:'first-observation'}} : {...d,change:{status:'new',since:prior.generatedAt}};
    if(d.kind!=='advertised-fare' || p.kind!==d.kind || p.currency!==d.currency || p.tripType!==d.tripType || p.cabin!==d.cabin || p.origin!==d.origin || p.destination!==d.destination || p.departureDate!==d.departureDate || p.returnDate!==d.returnDate || !Number.isFinite(p.amount) || !Number.isFinite(d.amount) || p.amount<=0)return {...d,change:{status:'rechecked'}};
    const delta=Math.round((d.amount-p.amount)*100)/100;
    return {...d,change:{status:delta<0?'dropped':delta>0?'rose':'unchanged',previousAmount:p.amount,delta,percent:Math.round(delta/p.amount*1000)/10,since:p.checkedAt}};
  });
}
