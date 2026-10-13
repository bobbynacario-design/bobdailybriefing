import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseFinancials,buildResearch,refreshPaperOutcomes} from './pse-research.js';
const C=globalThis.PseResearchCore;
const fixture=s=>readFileSync(new URL('./fixtures/pse-financial-'+s+'.html',import.meta.url),'utf8');
const row=(symbol='BDO',extra={})=>({symbol,name:symbol,cmpyId:'260',close:112,asOf:'2026-10-12',div12mCoverage:'complete',...extra});
const company=(symbol='BDO',extra={})=>C.buildCompany(row(symbol),{...parseFinancials(fixture(symbol==='ICT' ? 'ict' : symbol==='AREIT' ? 'areit' : 'bdo')),checkedAt:'2026-10-13T01:00:00Z'},'2026-10-13');
test('real PSE tables preserve currencies, units, annual vs interim and YTD columns',()=>{
  const f=parseFinancials(fixture('bdo'));
  assert.equal(f.annual.periodEnd,'2025-12-31');assert.equal(f.interim.periodEnd,'2026-06-30');assert.equal(f.annual.currency,'PHP');
  assert.deepEqual(f.interim.fields.parentIncome,[20611,20911,40723,40615]);assert.equal(f.annual.fields.eps[0],16.28);
  assert.equal(parseFinancials(fixture('ict')).annual.currency,'USD');assert.equal(parseFinancials(fixture('areit')).annual.fields.parentIncome[0],null);
});
test('changed comparison headers or malformed dates fail closed',()=>{
  assert.throws(()=>parseFinancials(fixture('bdo').replace('Current Year-To-Date','Current Quarter')),/columns/);
  assert.throws(()=>parseFinancials(fixture('bdo').replace('Dec 31, 2025','not a date')),/period/);
  assert.throws(()=>parseFinancials('<html>Unavailable</html>'),/unavailable/);
});
test('bank card uses comparable parent earnings and average equity, never industrial debt ratios',()=>{
  const c=company();assert.equal(c.metrics.ytdProfitGrowth,0.27);assert.equal(c.metrics.ytdRevenueGrowth,10.7);
  assert.equal(c.metrics.priceToBook,0.92);assert.equal(c.metrics.priceToEarnings,6.88);
  assert.equal(c.metrics.liabilitiesToAssets,null);assert.equal(c.metrics.currentRatio,null);
  assert.match(c.brief.risks.join(' '),/Capital adequacy/);assert.equal(c.brief.view,'Research incomplete');
  assert.equal(C.scenario(c,0.8,1.2).low,97.42);assert.equal(C.scenario(c,0.8,1.2).method,'P/B');
});
test('REIT payout safety is not inferred from EPS and USD earnings are never divided into PHP prices',()=>{
  const reit=company('AREIT'),usd=company('ICT');
  assert.equal(reit.metrics.priceToEarnings,null);assert.equal(C.scenario(reit,10,15),null);assert.match(reit.brief.risks.join(' '),/Distributable income/);
  assert.equal(usd.metrics.priceToEarnings,null);assert.equal(usd.metrics.priceToBook,null);assert.equal(C.scenario(usd,10,15),null);
  assert.notEqual(usd.metrics.ytdRevenueGrowth,null);
});
test('missing numbers stay missing; stale or future reports never yield multiples',()=>{
  const f=parseFinancials(fixture('bdo'));delete f.annual.fields.netIncome;delete f.annual.fields.parentIncome;
  const c=C.buildCompany(row('MER'),f,'2026-10-13');assert.equal(c.metrics.annualRoe,null);
  const empty=C.buildCompany(row('MER'),{annual:{periodEnd:'2025-12-31',currency:'PHP',fields:{}},interim:{periodEnd:'2026-06-30',currency:'PHP',fields:{}}},'2026-10-13');
  assert.equal(empty.metrics.liabilitiesToAssets,null);assert.equal(empty.metrics.priceToEarnings,null);
  assert.equal(C.buildCompany(row(),f,'2025-01-01').metrics.priceToBook,null);
  assert.equal(C.buildCompany(row(),f,'2028-01-01').metrics.priceToEarnings,null);
});
test('financial cache fetches once per week and retained facts stay dated on failure',async()=>{
  let calls=0;const options={now:'2026-10-13T02:00:00Z',fetcher:async()=>{calls++;return {ok:true,text:async()=>fixture('bdo')};}};
  const first=await buildResearch([row()],null,'2026-10-13',options);assert.equal(calls,1);
  await buildResearch([row()],first,'2026-10-13',options);assert.equal(calls,1);
  const failed=await buildResearch([row()],first,'2026-10-21',{now:'2026-10-21T02:00:00Z',fetcher:async()=>{throw Error('offline');}});
  assert.equal(failed.companies[0].checkedAt,'2026-10-13T02:00:00Z');assert.equal(failed.companies[0].fetchError,'offline');
  assert.match(failed.companies[0].brief.risks[0],/retained figures/);
});
test('paper outcomes leave completed records untouched and never log private theses',async()=>{
  const writes=[];
  const book={ref:{collection:n=>n==='picks' ? {get:async()=>({docs:[{id:'p',data:()=>({symbol:'BDO',recordedDay:'2026-10-12',horizon:20,feePct:0.3,slippagePct:0.1})}]})} : {doc:()=>({get:async()=>({exists:true,data:()=>({status:'completed'})}),set:async d=>writes.push(d)})}}};
  const db={collection:()=>({limit:()=>({get:async()=>({docs:[book],size:1})})})};
  assert.equal((await refreshPaperOutcomes(db,{BDO:[{date:'2026-10-14',close:100}]},[])).updated,0);assert.equal(writes.length,0);
});
test('a USD reporter gets a peso P/E at the snapshot rate, with the rounding range; P/B and ranges stay off',()=>{
  const f={...parseFinancials(fixture('ict')),checkedAt:'2026-10-13T01:00:00Z'},fx={usdphp:{level:62.78}};
  const ict=C.buildCompany(row('ICT',{close:884}),f,'2026-10-13',fx),eps=f.annual.fields.eps[0];
  assert.equal(ict.metrics.priceToEarningsPhp,Math.round(884/(eps*62.78)*100)/100);assert.equal(ict.metrics.fxRate,62.78);
  assert.ok(ict.metrics.priceToEarningsPhpRange[0]<ict.metrics.priceToEarningsPhp && ict.metrics.priceToEarningsPhp<ict.metrics.priceToEarningsPhpRange[1]);
  assert.equal(ict.metrics.priceToEarnings,null);assert.equal(ict.metrics.priceToBook,null);assert.equal(C.scenario(ict,10,15),null);
  assert.match(ict.brief.observations.join(' '),/about [\d.]+× last full-year basic EPS of US\$0\.51 converted at USD\/PHP 62\.78/);
  assert.match(ict.brief.risks.join(' '),/converts last year’s EPS at today’s USD\/PHP rate/);
  assert.equal(C.buildCompany(row('ICT',{close:884}),f,'2026-10-13').metrics.priceToEarningsPhp,null);
  assert.equal(C.buildCompany(row('MER'),{...parseFinancials(fixture('bdo')),checkedAt:'x'},'2026-10-13',fx).metrics.priceToEarningsPhp,null);
});
test('buildResearch passes the snapshot rate through',async()=>{
  const r=await buildResearch([row('ICT',{close:884})],null,'2026-10-13',{now:'2026-10-13T02:00:00Z',fx:{usdphp:{level:62.78}},fetcher:async()=>({ok:true,text:async()=>fixture('ict')})});
  assert.ok(r.companies[0].metrics.priceToEarningsPhp>0);
});
