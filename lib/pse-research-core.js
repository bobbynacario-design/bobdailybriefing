(function(root) {
  'use strict';
  var VERSION='pse-research-v1';
  var TYPES={BDO:'bank',BPI:'bank',AREIT:'reit',ICT:'company',MER:'company',CNPF:'company'};
  function number(n){return typeof n==='number' && Number.isFinite(n) ? n : null;}
  function round(n){return number(n)==null ? null : Math.round(n*100)/100;}
  function ratio(a,b){return number(a)!=null && number(b)!=null && b>0 ? a/b : null;}
  function growth(a,b){var r=ratio(a,b);return r==null ? null : round((r-1)*100);}
  function percent(a,b){var r=ratio(a,b);return r==null ? null : round(r*100);}
  function age(date,today){return (Date.parse(today+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86400000;}
  function usable(report,today,limit){var a=report && age(report.periodEnd,today);return !!(report && Number.isFinite(a) && a>=0 && a<=limit);}
  function field(report,key,i){return number(report && report.fields && report.fields[key] && report.fields[key][i || 0]);}
  function pair(report,key,a,b){return field(report,key,a)!=null && field(report,key,b)!=null;}
  function sourceUrl(id){return /^\d+$/.test(String(id || '')) ? 'https://edge.pse.com.ph/companyPage/financial_reports_view.do?cmpy_id='+id : null;}
  // fx: the snapshot's {usdphp:{level}}. A USD reporter's P/E is converted at
  // that rate; P/B and valuation ranges stay suppressed.
  function buildCompany(row,financials,today,fx){
    var type=TYPES[row.symbol],a=financials && financials.annual,q=financials && financials.interim;
    var af=usable(a,today,550),qf=usable(q,today,200),latest=qf ? q : af ? a : null;
    var annualIncome=pair(a,'parentIncome',0,1) ? 'parentIncome' : 'netIncome';
    var interimIncome=pair(q,'parentIncome',2,3) ? 'parentIncome' : 'netIncome';
    var currency=latest && latest.currency;
    var samePriceCurrency=currency==='PHP',annualPHP=af && a.currency==='PHP';
    var eps=af ? field(a,'eps') : null,bv=latest ? field(latest,'bookValue') : null;
    var equityKey=pair(a,'parentEquity',0,1) && annualIncome==='parentIncome' ? 'parentEquity' : 'equity';
    var roeIncome=equityKey==='parentEquity' ? field(a,'parentIncome') : field(a,'netIncome');
    var e0=field(a,equityKey),e1=field(a,equityKey,1);
    var metrics={annualEps:eps,bookValue:bv,
      fyProfitGrowth:af ? growth(field(a,annualIncome),field(a,annualIncome,1)) : null,
      ytdProfitGrowth:qf ? growth(field(q,interimIncome,2),field(q,interimIncome,3)) : null,
      ytdRevenueGrowth:qf ? growth(field(q,'revenue',2),field(q,'revenue',3)) : null,
      priceToEarnings:type!=='reit' && annualPHP ? round(ratio(row.close,eps)) : null,
      priceToEarningsPhp:null,fxRate:null,
      priceToBook:type!=='reit' && samePriceCurrency ? round(ratio(row.close,bv)) : null,
      annualRoe:af && e0>0 && e1>0 ? percent(roeIncome,(e0+e1)/2) : null,
      liabilitiesToAssets:type!=='bank' && latest ? percent(field(latest,'liabilities'),field(latest,'assets')) : null,
      currentRatio:type!=='bank' && latest ? round(ratio(field(latest,'currentAssets'),field(latest,'currentLiabilities'))) : null};
    var rate=number(fx && fx.usdphp && fx.usdphp.level);
    if(type!=='reit' && af && a.currency==='USD' && eps>0 && rate>0){
      metrics.priceToEarningsPhp=round(ratio(row.close,eps*rate));metrics.fxRate=rate;
      // EPS is reported to the cent: half a cent either way moves the multiple.
      metrics.priceToEarningsPhpRange=[round(ratio(row.close,(eps+0.005)*rate)),round(ratio(row.close,(eps-0.005)*rate))];
    }
    var gaps=['Operating cash flow and interest-bearing debt are not covered by this summary.'];
    if(!af) gaps.push('Annual report missing, future-dated or over 550 days old.');
    if(!qf) gaps.push('Interim report missing, future-dated or over 200 days old.');
    if(qf && metrics.ytdProfitGrowth==null) gaps.push('Comparable interim profit growth is unavailable.');
    if(type==='bank') gaps.push('Capital adequacy, non-performing loans and credit costs need the full bank report.');
    if(type==='reit') gaps.push('Distributable income, occupancy and debt maturity coverage need the full REIT report; accounting EPS does not establish payout safety.');
    if((!annualPHP && af) || (!samePriceCurrency && latest)) gaps.push(metrics.priceToEarningsPhp!=null ? 'Reports are in '+a.currency+': the P/E converts last year’s EPS at today’s USD/PHP rate, so currency moves change it; P/B and valuation ranges are suppressed.' : 'Report currency differs from the PHP share price: affected price multiples are suppressed.');
    if(row.div12mCoverage!=='complete' || row.div12mPartial) gaps.push('Dividend history or amounts are incomplete or unverified.');
    var observations=[];
    if(metrics.ytdProfitGrowth!=null) observations.push('YTD '+(interimIncome==='parentIncome' ? 'parent profit' : 'net profit')+' changed '+metrics.ytdProfitGrowth+'% against the comparable prior-year period.');
    if(metrics.ytdRevenueGrowth!=null) observations.push('YTD reported revenue changed '+metrics.ytdRevenueGrowth+'% against the comparable prior-year period.');
    if(metrics.priceToBook!=null && type==='bank') observations.push('The closing price is '+metrics.priceToBook+'× reported book value; asset quality must be checked before calling that attractive.');
    if(metrics.priceToEarningsPhp!=null) observations.push('The closing price is about '+metrics.priceToEarningsPhp+'× last full-year basic EPS of US$'+eps+' converted at USD/PHP '+rate+' (between '+metrics.priceToEarningsPhpRange[0]+'× and '+metrics.priceToEarningsPhpRange[1]+'× because EPS is reported to the cent); this is a historical multiple, not an earnings forecast.');
    if(metrics.priceToEarnings!=null && type==='company') observations.push('The closing price is '+metrics.priceToEarnings+'× last full-year basic EPS; this is a historical multiple, not an earnings forecast.');
    var checklist=type==='bank' ? ['Check capital adequacy, non-performing loans and credit costs.','Check whether earnings growth comes from recurring operations.'] : type==='reit' ? ['Check distributable income against regular distributions.','Check occupancy, lease expiries, leverage and refinancing.'] : ['Check operating cash flow against reported profit.','Check interest-bearing debt, maturities and exceptional earnings.'];
    var nextCheck=row.nextEx ? 'Declared next ex-date: '+row.nextEx.exDate+'. Payment and eligibility remain as declared.' : 'Check the next official results filing; its release date is not confirmed here.';
    return {symbol:row.symbol,name:row.name,type:type,version:VERSION,price:row.close,priceDate:row.asOf,checkedAt:financials && financials.checkedAt || null,
      source:sourceUrl(row.cmpyId),annual:a || null,interim:q || null,annualFresh:af,interimFresh:qf,metrics:metrics,
      yield12m:row.yield12m==null ? null : row.yield12m,dividendCoverage:row.div12mCoverage || 'unverified',
      brief:{view:'Research incomplete',observations:observations,risks:gaps,checks:checklist,nextCheck:nextCheck,
        wouldChange:'Reassess if the next comparable profit result deteriorates, cash coverage weakens, or a material filing contradicts the thesis.'}};
  }
  function scenario(company,low,high){
    low=Number(low);high=Number(high);
    if(!(low>0 && high>=low && high<=100))return null;
    var method=company.type==='bank' ? 'P/B' : 'P/E',base=company.type==='bank' ? company.metrics.bookValue : company.metrics.annualEps;
    var report=company.type==='bank' ? company.interimFresh ? company.interim : company.annual : company.annual;
    if(company.type==='reit' || !report || report.currency!=='PHP' || !(base>0) || !(company.type==='bank' ? company.interimFresh || company.annualFresh : company.annualFresh))return null;
    return {method:method,lowMultiple:low,highMultiple:high,base:base,periodEnd:report.periodEnd,
      low:round(base*low),high:round(base*high),assumption:'Your selected '+method+' range applied to reported '+(method==='P/B' ? 'book value' : 'last full-year EPS')+'. No growth forecast or analyst target is implied.'};
  }
  function cleanPick(input){
    input=input || {};
    var symbol=String(input.symbol || '').toUpperCase(),approach=input.approach,horizon=Number(input.horizon);
    var thesis=String(input.thesis || '').trim(),invalidation=String(input.invalidation || '').trim();
    var fee=Number(input.feePct),slippage=Number(input.slippagePct);
    if(!TYPES[symbol] || !['quality','income','momentum'].includes(approach) || ![20,60,120].includes(horizon))throw Error('Choose a covered company, approach and horizon.');
    if(thesis.length<10 || thesis.length>1000 || invalidation.length<10 || invalidation.length>500)throw Error('Write a thesis and what would invalidate it (at least 10 characters each).');
    if(input.feePct==null || input.feePct==='' || input.slippagePct==null || input.slippagePct==='' || !Number.isFinite(fee) || !Number.isFinite(slippage) || fee<0 || fee>2 || slippage<0 || slippage>5)throw Error('Enter per-side costs between 0–2% and slippage between 0–5%.');
    var low=input.lowMultiple==null || input.lowMultiple==='' ? null : Number(input.lowMultiple),high=input.highMultiple==null || input.highMultiple==='' ? null : Number(input.highMultiple);
    if((low!=null || high!=null) && !(low>0 && high>=low && high<=100))throw Error('Enter both valuation multiples, with the upper at least the lower.');
    return {symbol:symbol,approach:approach,horizon:horizon,thesis:thesis,invalidation:invalidation,feePct:fee,slippagePct:slippage,lowMultiple:low,highMultiple:high};
  }
  // First close strictly after the recording day. Never fill at an already
  // observed close. A completed horizon remains fixed as later bars arrive.
  function evaluatePick(pick,bars,benchmark,prior){
    var from=pick.recordedDay;
    var rows=(bars || []).filter(function(b){return b.date>from && b.close>0;}).slice().sort(function(a,b){return a.date.localeCompare(b.date);});
    if(!rows.length)return {status:'waiting-entry',method:VERSION};
    if((prior && prior.entryDate && rows[0].date!==prior.entryDate) || (!prior?.entryDate && age(from,rows[0].date)>14))return {status:'history-unavailable',method:VERSION};
    var entry=rows[0],calendar=(benchmark || []).filter(function(b){return b.date>=entry.date && b.close>0;}).slice().sort(function(a,b){return a.date.localeCompare(b.date);});
    var hasCalendar=calendar.length && calendar[0].date===entry.date,target=hasCalendar && calendar[pick.horizon];
    var exit=target && rows.find(function(b){return b.date>=target.date;}),done=!!exit,last=exit || rows[rows.length-1];
    var cost=(pick.feePct+pick.slippagePct)/100;
    var gross=(last.close/entry.close-1)*100,net=(last.close*(1-cost)/(entry.close*(1+cost))-1)*100;
    var be=(benchmark || []).find(function(b){return b.date===entry.date;}),bx=(benchmark || []).find(function(b){return b.date===last.date;});
    var benchmarkReturn=be && bx ? (bx.close/be.close-1)*100 : null;
    var drawdown=0,peak=entry.close;
    rows.filter(function(b){return b.date<=last.date;}).forEach(function(b){peak=Math.max(peak,b.close);drawdown=Math.min(drawdown,(b.close/peak-1)*100);});
    return {status:done ? 'completed' : target ? 'awaiting-exit-quote' : 'tracking',method:VERSION,entryDate:entry.date,entryPrice:entry.close,asOf:last.date,markPrice:last.close,
      targetDate:target ? target.date : null,calendarAvailable:!!hasCalendar,
      sessions:hasCalendar ? calendar.filter(function(b){return b.date<=last.date;}).length-1 : null,grossPriceReturn:round(gross),netPriceReturn:round(net),maxCloseDrawdown:round(drawdown),
      benchmarkPriceReturn:round(benchmarkReturn),netExcessReturn:benchmarkReturn==null ? null : round(net-benchmarkReturn),
      caveat:'Price-only paper return with assumed entry and exit costs; excludes dividends. Corporate actions are not verified. Benchmark is PSE30 price return before costs. Not verified strategy performance.'};
  }
  root.PseResearchCore={VERSION:VERSION,TYPES:TYPES,buildCompany:buildCompany,scenario:scenario,cleanPick:cleanPick,evaluatePick:evaluatePick,sourceUrl:sourceUrl};
  if(typeof module!=='undefined' && module.exports)module.exports=root.PseResearchCore;
})(typeof globalThis!=='undefined' ? globalThis : this);
