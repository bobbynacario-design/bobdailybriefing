// Forward-only measurement. Never feeds Radar scores or rewrites a forecast.
const HORIZON = 10;
function completedThrough(now, benchmark) {
  // US regular sessions have ended by 21:00 UTC in either DST regime. Crypto
  // daily proxies stay on prior UTC dates; their current-day point is partial.
  const time=new Date(now);
  return benchmark!=='BTC' && time.getUTCHours()>=21 ? now.slice(0,10) : new Date(time.getTime()-86400000).toISOString().slice(0,10);
}
function pairedBars(bars, symbol, benchmark) {
  const other = new Map((bars[benchmark] || []).filter(b=>Number.isFinite(b.close) && b.close>0).map(b=>[b.date,b.close]));
  return (bars[symbol] || []).filter(b=>Number.isFinite(b.close) && b.close>0 && other.has(b.date))
    .map(b=>({date:b.date,asset:b.close,benchmark:other.get(b.date)})).sort((a,b)=>a.date.localeCompare(b.date));
}
function forecastKey(symbol, dataAsOf) { return symbol+'|'+dataAsOf; }
function historicalBaseRate(pairs) {
  let wins=0,n=0;
  // Non-overlapping historical windows; descriptive baseline, not calibration.
  for(let end=pairs.length-1;end>=HORIZON;end-=HORIZON) {
    const a=pairs[end-HORIZON],b=pairs[end];
    if(b.asset/a.asset>b.benchmark/a.benchmark) wins++;
    if(++n===100) break;
  }
  return {probability:n>=10?wins/n:.5,n};
}
function measureForecastJournal(prior, additions, bars, now) {
  const entries={...((prior && prior.entries) || {})};
  for(const entry of additions || []) if(!entries[entry.key]) entries[entry.key]=structuredClone(entry);
  for(const entry of Object.values(entries)) {
    if(entry.status!=='pending') continue;
    // Entry is a later completed close, never the close already known when forecasting.
    const pairs=pairedBars(bars,entry.symbol,entry.benchmark).filter(b=>b.date>entry.generatedAt.slice(0,10) && b.date<=completedThrough(now,entry.benchmark));
    if(pairs.length>=HORIZON+1) {
      const start=pairs[0],end=pairs[HORIZON];
      const excess=(end.asset/start.asset-end.benchmark/start.benchmark)*100;
      entry.status='resolved';entry.outcome=excess>0?1:0;
      entry.result={start:start.date,end:end.date,excessReturn:excess};
    } else if(Date.parse(now)-Date.parse(entry.generatedAt)>60*86400000) {
      entry.status='unavailable'; // Missing data cannot become a loss or a successful forecast.
    }
  }
  const resolved=Object.values(entries).filter(e=>e.status==='resolved');
  const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const brier=field=>mean(resolved.map(e=>(e[field]-e.outcome)**2));
  const stats={resolved:resolved.length,pending:Object.values(entries).filter(e=>e.status==='pending').length,
    unavailable:Object.values(entries).filter(e=>e.status==='unavailable').length,
    panelBrier:brier('probability'),bullBrier:brier('bullProbability'),bearBrier:brier('bearProbability'),
    baseRateBrier:brier('baseRate'),neutralBrier:resolved.length?.25:null,
    meanExcessReturn:mean(resolved.map(e=>e.result.excessReturn))};
  // Bounded document; aggregate totals cover retained outcomes and are labelled as such.
  const ordered=Object.values(entries).sort((a,b)=>b.generatedAt.localeCompare(a.generatedAt));
  const keep=new Set(ordered.filter(e=>e.status!=='pending').slice(0,120).map(e=>e.key));
  const retained=Object.fromEntries(ordered.filter(e=>e.status==='pending' || keep.has(e.key)).map(e=>[e.key,e]));
  if(Object.keys(retained).length<Object.keys(entries).length) return measureForecastJournal({entries:retained},[],{},now);
  return {version:1,horizon:HORIZON,generatedAt:now,entries:retained,stats,
    method:'Forward forecasts only; first completed common close after the forecast UTC date to ten matched sessions later. No trading costs. Statistics cover retained outcomes; overlapping windows are correlated.'};
}
export {HORIZON,completedThrough,pairedBars,forecastKey,historicalBaseRate,measureForecastJournal};
