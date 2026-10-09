// Forward-only measurement. Never feeds Radar scores or rewrites a forecast.
//
// Storage (briefings-bob, committed in the same transaction as the Radar doc):
//   radar-forecast-journal          pending forecasts, the newest completed ones
//                                   with full prose, and stats for the whole record
//   radar-forecast-history-YYYY-MM  every completed forecast, kept permanently as a
//                                   compact record (no prose), by forecast data month
// A month holds at most (universe size x days in the month) records of a few
// hundred bytes, so no document approaches Firestore's 1 MB limit.
//
// One pass of measureForecastJournal:
//   1. add     new forecasts; the first stored forecast for a key wins
//   2. resolve pending forecasts whose ten sessions have completed
//   3. archive each completed forecast to its month, once; records never change
//   4. score   the full history (Brier and effective sample)
//   5. retain  prose only for pending and the newest completed forecasts
const HORIZON = 10;
const RECENT_PROSE = 60;
const UNAVAILABLE_AFTER_DAYS = 60;
const JOURNAL_DOC = 'radar-forecast-journal';
const COMPACT_FIELDS = ['key','symbol','benchmark','generatedAt','dataAsOf','status','probability','bullProbability','bearProbability','baseRate','baseRateN','outcome'];
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
function historyMonth(entry) { return (entry.dataAsOf || entry.generatedAt).slice(0,7); }
function historyDocId(month) { return 'radar-forecast-history-'+month; }

// Step 2. Returns a new object; the stored entry is never edited in place.
function resolveEntry(entry, bars, now) {
  if(entry.status!=='pending') return entry;
  // Entry is a later completed close, never the close already known when forecasting.
  const pairs=pairedBars(bars,entry.symbol,entry.benchmark)
    .filter(b=>b.date>entry.generatedAt.slice(0,10) && b.date<=completedThrough(now,entry.benchmark));
  if(pairs.length>=HORIZON+1) {
    const start=pairs[0],end=pairs[HORIZON];
    const excess=(end.asset/start.asset-end.benchmark/start.benchmark)*100;
    return {...entry,status:'resolved',outcome:excess>0?1:0,result:{start:start.date,end:end.date,excessReturn:excess}};
  }
  // Missing data cannot become a loss or a successful forecast.
  if(Date.parse(now)-Date.parse(entry.generatedAt)>UNAVAILABLE_AFTER_DAYS*86400000) return {...entry,status:'unavailable'};
  return entry;
}

// Step 3. Everything the statistics need, nothing the cards display.
function compactForecast(entry, themes) {
  const record={};
  for(const field of COMPACT_FIELDS) record[field]=entry[field] ?? null;
  record.theme=entry.theme || (themes && themes[entry.symbol]) || null;
  record.result=entry.result ? {start:entry.result.start,end:entry.result.end,excessReturn:entry.result.excessReturn} : null;
  return record;
}
function archiveCompleted(entries, history, known, themes) {
  const changed={};
  for(const entry of entries) {
    if(entry.status==='pending' || known.has(entry.key)) continue;
    const month=historyMonth(entry);
    if(!changed[month]) changed[month]={version:1,month,records:{...((history[month] && history[month].records) || {})}};
    changed[month].records[entry.key]=compactForecast(entry,themes);
    known.add(entry.key);
  }
  return changed;
}

// Step 4. Ten-session windows of one symbol that share no daily return measure
// different moves; overlapping windows re-measure the same ones. Per symbol,
// count the most windows that do not overlap (earliest-ending first), then sum
// across symbols. Symbols in one theme still move together, so even this
// figure overstates the independent evidence.
function effectiveSample(records) {
  const bySymbol=new Map();
  for(const r of records) {
    if(r.status!=='resolved' || !r.result || !r.result.start || !r.result.end) continue;
    if(!bySymbol.has(r.symbol)) bySymbol.set(r.symbol,[]);
    bySymbol.get(r.symbol).push(r);
  }
  const themes=new Map();
  let total=0;
  for(const list of bySymbol.values()) {
    list.sort((a,b)=>a.result.end.localeCompare(b.result.end) || a.result.start.localeCompare(b.result.start));
    let windows=0,lastEnd='';
    for(const r of list) if(r.result.start>=lastEnd) {windows++;lastEnd=r.result.end;}
    const theme=list.at(-1).theme || 'Unthemed';
    const row=themes.get(theme) || {theme,resolved:0,effectiveSample:0};
    row.resolved+=list.length;row.effectiveSample+=windows;themes.set(theme,row);
    total+=windows;
  }
  const byTheme=[...themes.values()].sort((a,b)=>b.effectiveSample-a.effectiveSample || b.resolved-a.resolved || a.theme.localeCompare(b.theme));
  return {total,byTheme};
}
function forecastStats(records, pending) {
  const resolved=records.filter(r=>r.status==='resolved');
  const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const brier=field=>mean(resolved.map(r=>(r[field]-r.outcome)**2));
  const sample=effectiveSample(resolved);
  const dates=[...records,...pending].map(e=>e.dataAsOf || e.generatedAt.slice(0,10)).sort();
  return {resolved:resolved.length,pending:pending.length,unavailable:records.filter(r=>r.status==='unavailable').length,
    panelBrier:brier('probability'),bullBrier:brier('bullProbability'),bearBrier:brier('bearProbability'),
    baseRateBrier:brier('baseRate'),neutralBrier:resolved.length?.25:null,
    meanExcessReturn:mean(resolved.map(r=>r.result.excessReturn)),
    effectiveSample:sample.total,byTheme:sample.byTheme,since:dates[0] || null};
}

// Step 5. Completed forecasts are already archived, so dropping prose loses no outcome.
function retainRecent(entries) {
  const ordered=entries.slice().sort((a,b)=>b.generatedAt.localeCompare(a.generatedAt));
  const recent=new Set(ordered.filter(e=>e.status!=='pending').slice(0,RECENT_PROSE).map(e=>e.key));
  return Object.fromEntries(ordered.filter(e=>e.status==='pending' || recent.has(e.key)).map(e=>[e.key,e]));
}

// opts.history: {month: history doc} for every month the prior journal lists.
// opts.themes: {symbol: theme} for the compact records; forecast entries carry no theme.
// Returns the journal doc and only the history months that changed.
function measureForecastJournal(prior, additions, bars, now, opts={}) {
  const history=opts.history || {};
  const listed=[...new Set([...((prior && prior.historyMonths) || []),...Object.keys(history)])];
  for(const month of listed) if(!history[month]) throw new Error('Forecast history '+month+' was not read; refusing to score a partial record');
  const known=new Set(listed.flatMap(month=>Object.keys(history[month].records || {})));
  const current={...((prior && prior.entries) || {})};
  for(const entry of additions || []) if(!current[entry.key] && !known.has(entry.key)) current[entry.key]=structuredClone(entry);
  const entries=Object.values(current).map(entry=>resolveEntry(entry,bars,now));
  const changed=archiveCompleted(entries,history,known,opts.themes);
  const months=[...new Set([...listed,...Object.keys(changed)])].sort();
  const records=months.flatMap(month=>Object.values((changed[month] || history[month]).records || {}));
  const stats=forecastStats(records,entries.filter(e=>e.status==='pending'));
  return {journal:{version:2,horizon:HORIZON,generatedAt:now,entries:retainRecent(entries),historyMonths:months,stats,
    method:'Forward forecasts only; first completed common close after the forecast UTC date to ten matched sessions later. No trading costs. Statistics cover every completed forecast since the record began. Effective sample counts non-overlapping ten-session windows per symbol, summed across symbols; overlapping windows and related symbols are correlated.'},
    history:changed};
}

// Runs inside the caller's transaction: reads the journal and every listed
// month first (Firestore requires reads before writes), then stages the writes.
// A listed month that is missing fails the transaction rather than shrinking the record.
async function stageForecastJournal(tx, collection, additions, bars, now, themes) {
  const journalRef=collection.doc(JOURNAL_DOC);
  const snapshot=await tx.get(journalRef);
  const prior=snapshot.exists ? snapshot.data() : null;
  const months=(prior && prior.historyMonths) || [];
  const snapshots=months.length ? await tx.getAll(...months.map(month=>collection.doc(historyDocId(month)))) : [];
  const history={};
  snapshots.forEach((snap,i)=>{
    if(!snap.exists) throw new Error('Forecast history '+months[i]+' is missing');
    history[months[i]]=snap.data();
  });
  const measured=measureForecastJournal(prior,additions,bars,now,{history,themes});
  for(const [month,doc] of Object.entries(measured.history)) tx.set(collection.doc(historyDocId(month)),doc);
  tx.set(journalRef,measured.journal);
  return measured.journal;
}
export {HORIZON,RECENT_PROSE,JOURNAL_DOC,completedThrough,pairedBars,forecastKey,historicalBaseRate,historyMonth,historyDocId,
  compactForecast,effectiveSample,measureForecastJournal,stageForecastJournal};
