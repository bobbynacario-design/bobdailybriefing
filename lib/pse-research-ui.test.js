import test from 'node:test';
import assert from 'node:assert/strict';
import './pse-research-core.js';
import './pse-research-ui.js';
const U=globalThis.PseResearchUI;
const c={symbol:'BDO',name:'BDO <unsafe>',type:'bank',price:112,priceDate:'2026-10-12',annualFresh:true,interimFresh:true,
  checkedAt:'2026-10-13T01:00:00Z',source:'https://edge.pse.com.ph/companyPage/financial_reports_view.do?cmpy_id=260',
  annual:{periodEnd:'2025-12-31',currency:'PHP'},interim:{periodEnd:'2026-06-30',currency:'PHP'},
  metrics:{ytdProfitGrowth:0.27,bookValue:121.78,annualRoe:14.34},brief:{view:'Research incomplete',risks:['Cash flow <unverified>'],checks:['Check credit costs'],observations:['Profit grew'],nextCheck:'Next results date unconfirmed',wouldChange:'Earnings deteriorate'}};
test('company cards display sourced periods, sector-specific evidence and gaps without manufacturing numbers',()=>{
  const html=U.cardsHtml({companies:[c]},true);assert.match(html,/BDO &lt;unsafe&gt;/);assert.doesNotMatch(html,/<unsafe>/);
  assert.match(html,/2025-12-31/);assert.match(html,/2026-06-30/);assert.match(html,/PSE EDGE financial summary/);assert.match(html,/Research incomplete/);
  assert.match(html,/Not available/);assert.match(html,/Draft a paper pick/);
  assert.ok(html.includes('<span>₱112.00 · P/B Not available · YTD profit +0.27%</span>'));
  assert.ok(U.cardsHtml({companies:[{...c,symbol:'AREIT',type:'reit',yield12m:5.1,metrics:{ytdProfitGrowth:-2}}]},true).includes('yield 5.10% · YTD profit -2.00%'));
  assert.ok(U.cardsHtml({companies:[{...c,symbol:'ICT',type:'company',annual:{periodEnd:'2025-12-31',currency:'USD'}}]},true).includes('₱112.00 · reports in USD · YTD'));
  assert.doesNotMatch(U.cardsHtml({companies:[{...c,source:'javascript:alert(1)'}]},false),/javascript:|pseStartPick/);
});
test('draft has explicit modelling assumptions and uses user-selected valuation ranges',()=>{
  const draft={symbol:'BDO',approach:'quality',horizon:60,thesis:'</textarea><script>bad</script>',invalidation:'risk',feePct:0.3,slippagePct:0.1,lowMultiple:0.8,highMultiple:1.2};
  const html=U.formHtml(draft,c,true);assert.match(html,/fieldset disabled/);assert.match(html,/₱97\.42–₱146\.14/);assert.match(html,/not a broker quote/);
  assert.doesNotMatch(html,/<script>bad/);assert.match(html,/&lt;\/textarea&gt;/);
  assert.doesNotMatch(U.formHtml(draft,{...c,type:'reit'},false),/id="pse-pick-low"/);
});
test('paper record keeps losing results and original evidence with price-only limitations',()=>{
  const pick={symbol:'BDO',approach:'quality',horizon:20,recordedAt:'2026-10-13T02:00:00Z',recordedDay:'2026-10-13',observedDate:'2026-10-12',observedClose:112,
    thesis:'Thesis <one>',invalidation:'Profit decline',feePct:0.3,slippagePct:0.1,research:c,version:'v1'};
  const html=U.paperHtml([{pick,outcome:{status:'completed',entryDate:'2026-10-14',entryPrice:110,asOf:'2026-11-12',netPriceReturn:-20,benchmarkPriceReturn:-3,netExcessReturn:-17,caveat:'Price-only, excludes dividends'}}]);
  assert.match(html,/-20\.00%/);assert.match(html,/1 completed/);assert.match(html,/Evidence frozen at save/);assert.match(html,/excludes dividends/);
  assert.match(html,/Thesis &lt;one&gt;/);assert.doesNotMatch(html,/onclick="[^"]*(?:delete|editPick)|Buy now/);
  assert.match(U.paperHtml([], 'Loading failed'),/Retry loading/);
});
