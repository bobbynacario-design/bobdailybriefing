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
test('Start from the facts drafts only from sourced figures and leaves the reason to the writer',()=>{
  const s=U.starter({...c,metrics:{ytdProfitGrowth:0.27,ytdRevenueGrowth:10.7,priceToBook:0.92,annualRoe:14.34}});
  assert.equal(s.thesis,'BDO (reports to 2026-06-30): YTD profit +0.27% and revenue +10.70% against the same months last year; price 0.92× book value, ROE 14.34%. Why I would own it: ');
  assert.equal(s.invalidation,'The next results show YTD profit below last year; or non-performing loans or credit costs rise; or it closes below ₱95.20 (15% under the ₱112.00 close on 2026-10-12).');
  const reit=U.starter({...c,symbol:'AREIT',type:'reit',yield12m:6.75,metrics:{ytdProfitGrowth:-2}});
  assert.match(reit.thesis,/trailing yield 6\.75% before tax/);assert.match(reit.invalidation,/^YTD profit is still below last year.*distribution is cut/);
  const draft={symbol:'ICT',approach:'quality',horizon:60,thesis:'',invalidation:'',feePct:0.3,slippagePct:0.1};
  assert.match(U.formHtml(draft,{...c,symbol:'ICT',type:'company',annual:{periodEnd:'2025-12-31',currency:'USD'}},false),/ICT reports in USD, so a peso multiple is not computed/);
  assert.match(U.formHtml({...draft,status:'Write a thesis'},c,false),/class="pse-paper-status" role="status">Write a thesis/);
  assert.match(U.formHtml(draft,c,true),/class="pse-paper-status pending"/);
});
test('the ICT card shows the converted P/E on its line and in the figures',()=>{
  const ict={...c,symbol:'ICT',type:'company',price:884,annual:{periodEnd:'2025-12-31',currency:'USD'},metrics:{ytdProfitGrowth:21.94,priceToEarningsPhp:27.61,fxRate:62.78}};
  const html=U.cardsHtml({companies:[ict]},true);
  assert.ok(html.includes('₱884.00 · P/E ≈27.61× in pesos · YTD profit +21.94%'));
  assert.ok(html.includes('<dt>P/E · last full-year EPS in pesos</dt><dd>≈27.61× at USD/PHP 62.78</dd>'));
  assert.match(U.starter(ict).thesis,/P\/E about 27\.61× last full-year EPS in pesos/);
});
