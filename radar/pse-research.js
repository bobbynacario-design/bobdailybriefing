import '../lib/pse-research-core.js';
import {edgeDay} from './pse-events.js';
const Core=globalThis.PseResearchCore;
const KEYS={'Gross Revenue':'revenue','Net Income/(Loss) After Tax':'netIncome','Net Income/(Loss) Attributable to Parent':'parentIncome',
  "Stockholders' Equity":'equity',"Stockholders' Equity - Parent":'parentEquity','Total Assets':'assets','Total Liabilities':'liabilities',
  'Current Assets':'currentAssets','Current Liabilities':'currentLiabilities','Book Value Per Share':'bookValue','Earnings/(Loss) Per Share (Basic)':'eps'};
const plain=s=>String(s || '').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function value(s){s=plain(s).replace(/,/g,'');if(/^\([\d.]+\)$/.test(s))s='-'+s.slice(1,-1);return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;}
function currency(s){return /\b(?:USD|US Dollar|US Dollars)\b/i.test(s) ? 'USD' : /(?:PHP|PhP|Phil(?:ippine|\.)?\s*Peso|Pesos)/i.test(s) ? 'PHP' : null;}
export function parseFinancials(html){
  const result={};
  for(const [name,key] of [['Annual','annual'],['Quarterly','interim']]){
    const re=new RegExp('<h3>\\s*'+name+'\\s*</h3>([\\s\\S]*?)(?=<h3>|<div id="footer"|$)','i'),match=String(html).match(re);
    if(!match)continue;
    const part=match[1],label=plain(part.slice(0,part.indexOf('<table')));
    const d=label.match(/For the (?:fiscal year|period) ended\s*:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
    const units=label.match(/Currency\(and units, if applicable\)\s*:\s*(.*)/i);
    const report={periodEnd:d ? edgeDay(d[1]) : null,currency:currency(units && units[1]),units:units ? units[1] : null,fields:{}};
    if(!report.periodEnd || !report.currency || !Number.isFinite(Date.parse(report.periodEnd)) || new Date(report.periodEnd+'T00:00:00Z').toISOString().slice(0,10)!==report.periodEnd)throw Error('Financial period or currency unreadable');
    for(const table of part.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
      const rows=[...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
      const headers=rows.length ? [...rows[0][1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>plain(m[1])) : [];
      const income=/Income Statement/i.test(table[1]);
      const expected=key==='annual' ? ['Item','Current Year','Previous Year'] : income ? ['Item','Current Year (3 Months)','Previous Year (3 Months)','Current Year-To-Date','Previous Year-To-Date'] : ['Item','Period Ended','Fiscal Year Ended(Audited)'];
      if(headers.join('|')!==expected.join('|'))throw Error('Financial comparison columns changed');
      for(const row of rows.slice(1)){
        const cells=[...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(m=>plain(m[1]));
        const field=KEYS[cells[0]];if(!field)continue;
        if(cells.length!==expected.length || report.fields[field])throw Error('Financial row shape changed');
        report.fields[field]=cells.slice(1).map(value);
      }
    }
    if(Object.keys(report.fields).length<5)throw Error('Financial summary incomplete');
    result[key]=report;
  }
  if(!result.annual && !result.interim)throw Error('Financial summary unavailable');
  return result;
}
// Six public summary requests, cached for seven days. Failed fetches retain
// dated prior facts and show a warning; no model-generated financial figures.
export async function buildResearch(board,previous,today,options={}){
  const fetcher=options.fetcher || fetch,now=options.now || new Date().toISOString(),companies=[],failed=[];
  for(const symbol of Object.keys(Core.TYPES)){
    const row=(board || []).find(r=>r.symbol===symbol);if(!row){failed.push(symbol);continue;}
    const old=(previous && previous.companies || []).find(c=>c.symbol===symbol);
    let financials=old ? {annual:old.annual,interim:old.interim,checkedAt:old.checkedAt} : null,error=null;
    const cacheAge=financials && (Date.parse(now)-Date.parse(financials.checkedAt))/86400000;
    if(!(Number.isFinite(cacheAge) && cacheAge>=0 && cacheAge<7)){
      try{
        const res=await fetcher(Core.sourceUrl(row.cmpyId),{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'Mozilla/5.0'}});
        if(!res.ok)throw Error('Financial source HTTP '+res.status);
        financials={...parseFinancials(await res.text()),checkedAt:now};
      }catch(e){error=String(e.message || e).slice(0,160);failed.push(symbol);}
    }
    const company=Core.buildCompany(row,financials,today);
    if(error){company.fetchError=error;company.brief.risks.unshift('Financial source refresh failed; retained figures keep their original dates.');}
    companies.push(company);
  }
  return {version:Core.VERSION,generatedAt:now,asOf:today,companies,failed};
}
export async function refreshPaperOutcomes(db,bars,benchmark,dryRun=false){
  const books=await db.collection('pse-paper-books').limit(100).get();let count=0;
  for(const book of books.docs){
    const picks=await book.ref.collection('picks').get();
    for(const doc of picks.docs){
      const pick=doc.data();if(!bars[pick.symbol])continue;
      const outcomeRef=book.ref.collection('outcomes').doc(doc.id),prior=await outcomeRef.get();
      if(prior.exists && prior.data().status==='completed')continue;
      const outcome=Core.evaluatePick(pick,bars[pick.symbol],benchmark,prior.exists ? prior.data() : null);
      if(prior.exists && prior.data().asOf && outcome.asOf && outcome.asOf<prior.data().asOf)continue;
      if(!dryRun)await outcomeRef.set({...outcome,checkedAt:new Date().toISOString()});
      count++;
    }
  }
  return {books:books.size,updated:count};
}
