(function(root){
  'use strict';
  var C=root.PseResearchCore;
  function esc(v){return String(v==null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function n(v,suffix){return typeof v==='number' && Number.isFinite(v) ? esc(v.toFixed(2))+(suffix || '') : 'Not available';}
  function peso(v){return '₱'+n(v);}
  function source(s){return /^https:\/\/edge\.pse\.com\.ph\/companyPage\/financial_reports_view\.do\?cmpy_id=\d+$/.test(s || '') ? '<a href="'+esc(s)+'" target="_blank" rel="noopener noreferrer">PSE EDGE financial summary ↗</a>' : 'Financial source unconfirmed';}
  function list(items){return '<ul>'+(items || []).map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>';}
  // The collapsed line: the close and the one multiple that fits the type.
  function signed(v){return typeof v==='number' && Number.isFinite(v) ? (v>0 ? '+' : '')+n(v,'%') : 'Not available';}
  function summaryLine(c){
    var m=c.metrics || {},usd=c.annual && c.annual.currency && c.annual.currency!=='PHP';
    var value=c.type==='bank' ? 'P/B '+n(m.priceToBook,'×') : c.type==='reit' ? 'yield '+n(c.yield12m,'%') : usd ? 'reports in '+esc(c.annual.currency) : 'P/E '+n(m.priceToEarnings,'×');
    return peso(c.price)+' · '+value+' · YTD profit '+signed(m.ytdProfitGrowth);
  }
  function cardsHtml(data,signedIn){
    var companies=data && data.companies || [];
    var intro='<div class="journal-section">Company research</div><div class="pse-how">Six starter companies, selected for coverage across banks, a REIT and operating businesses. These are research candidates, not a ranked buy list. Financial summaries do not yet establish cash-flow quality or dividend safety.</div>';
    if(!companies.length)return intro+'<div class="rel-none-txt">Company facts will appear after the next PSE refresh.</div>';
    return intro+'<div class="pse-research-grid">'+companies.filter(function(c){return C.TYPES[c.symbol];}).map(function(c){
      var m=c.metrics || {},b=c.brief || {},a=c.annual,q=c.interim;
      var metrics=[['YTD profit vs prior YTD',n(m.ytdProfitGrowth,'%')],['YTD revenue vs prior YTD',n(m.ytdRevenueGrowth,'%')],
        ['Full-year profit growth',n(m.fyProfitGrowth,'%')],['Basic EPS · last full year',n(m.annualEps)+(a ? ' '+esc(a.currency)+'/share' : '')]];
      if(c.type==='bank')metrics.push(['P/B · latest usable book value',n(m.priceToBook,'×')],['ROE · last FY / average equity',n(m.annualRoe,'%')]);
      else if(c.type==='reit')metrics.push(['Declared gross trailing yield',n(c.yield12m,'%')+' · '+esc(c.dividendCoverage)],['Payout safety','Distributable income not verified']);
      else metrics.push(['P/E · last full-year EPS',n(m.priceToEarnings,'×')],['Total liabilities / assets',n(m.liabilitiesToAssets,'%')],['Current assets / current liabilities',n(m.currentRatio,'×')]);
      return '<details class="card pse-research-card"><summary><b>'+esc(c.symbol)+'</b> · '+esc(c.type==='bank' ? 'Bank' : c.type==='reit' ? 'REIT' : 'Operating company')+'<span>'+summaryLine(c)+'</span></summary>'+
        '<div class="pse-how">'+esc(c.name)+' · close '+peso(c.price)+' on '+esc(c.priceDate)+'</div><dl class="pse-research-metrics">'+metrics.map(function(x){return '<dt>'+esc(x[0])+'</dt><dd>'+x[1]+'</dd>';}).join('')+'</dl>'+
        '<div class="pse-how">Annual: '+esc(a && a.periodEnd || 'unavailable')+(a && !c.annualFresh ? ' (stale)' : '')+' · interim: '+esc(q && q.periodEnd || 'unavailable')+(q && !c.interimFresh ? ' (stale)' : '')+
        '<br>'+source(c.source)+' · checked '+esc((c.checkedAt || 'unconfirmed').slice(0,10))+'</div>'+
        '<div class="pse-brief"><b>Decision brief · '+esc(b.view)+'</b>'+list(b.observations)+'<b>Before deciding</b>'+list(b.checks)+
        '<div>'+esc(b.nextCheck)+'</div><div class="pse-how">What would change the view: '+esc(b.wouldChange)+'</div></div>'+
        '<details class="pse-research-gaps"><summary>Evidence gaps and risks</summary>'+list(b.risks)+'</details>'+
        (signedIn ? '<button type="button" class="tool-chip" onclick="pseStartPick(\''+c.symbol+'\')">Draft a paper pick</button>' : '<div class="pse-how">Sign in to save a paper thesis.</div>')+'</details>';
    }).join('')+'</div>';
  }
  // "Start from the facts": the card's own figures as an editable first draft.
  // Nothing here is a forecast; the reason to own it is left for him to write.
  function starter(c){
    var m=c.metrics || {},facts=[],period=c.interimFresh && c.interim ? c.interim.periodEnd : c.annual && c.annual.periodEnd;
    if(m.ytdProfitGrowth!=null)facts.push('YTD profit '+signed(m.ytdProfitGrowth)+(m.ytdRevenueGrowth!=null ? ' and revenue '+signed(m.ytdRevenueGrowth) : '')+' against the same months last year');
    if(c.type==='bank' && m.priceToBook!=null)facts.push('price '+n(m.priceToBook,'×')+' book value'+(m.annualRoe!=null ? ', ROE '+n(m.annualRoe,'%') : ''));
    else if(c.type==='reit' && c.yield12m!=null)facts.push('trailing yield '+n(c.yield12m,'%')+' before tax');
    else if(m.priceToEarnings!=null)facts.push('P/E '+n(m.priceToEarnings,'×')+' last full-year EPS');
    var thesis=c.symbol+(period ? ' (reports to '+period+')' : '')+': '+(facts.length ? facts.join('; ') : 'no comparable figures yet')+'. Why I would own it: ';
    var stop=c.price>0 ? Math.round(c.price*0.85*100)/100 : null,bits=[];
    if(m.ytdProfitGrowth!=null)bits.push(m.ytdProfitGrowth>0 ? 'The next results show YTD profit below last year' : 'YTD profit is still below last year at the next results');
    if(c.type==='bank')bits.push('non-performing loans or credit costs rise');
    if(c.type==='reit')bits.push('the regular distribution is cut');
    if(stop)bits.push('it closes below '+peso(stop)+' (15% under the '+peso(c.price)+' close on '+c.priceDate+')');
    var invalidation=bits.length ? bits.join('; or ')+'.' : '';
    return {thesis:thesis,invalidation:invalidation.charAt(0).toUpperCase()+invalidation.slice(1)};
  }
  function formHtml(draft,company,busy){
    if(!draft || !company)return '';
    var scenario=C.scenario(company,draft.lowMultiple,draft.highMultiple),canValue=C.scenario(company,1,2),method=company.type==='bank' ? 'P/B' : 'P/E';
    function opt(values,current){return values.map(function(x){return '<option value="'+esc(x[0])+'"'+(String(current)===String(x[0]) ? ' selected' : '')+'>'+esc(x[1])+'</option>';}).join('');}
    return '<div class="card pse-paper-draft" id="pse-paper-draft"><div class="journal-section">Paper thesis · '+esc(company.symbol)+'</div><div class="pse-how">Saving freezes this thesis and today’s sourced research. Entry is the first completed close after the Manila day you save it, then a fixed session horizon. This places no order.</div><fieldset'+(busy ? ' disabled' : '')+'>'+
      '<div class="pse-paper-fields"><label>Approach<select id="pse-pick-approach">'+opt([['quality','Long-term quality/value'],['income','Income'],['momentum','Momentum']],draft.approach)+'</select></label>'+
      '<label>Holding horizon<select id="pse-pick-horizon">'+opt([[20,'20 trading sessions'],[60,'60 trading sessions'],[120,'120 trading sessions']],draft.horizon)+'</select></label></div>'+
      '<div class="pse-how"><button type="button" class="pse-link" onclick="pseFillStarter()">Start from the facts</button> fills empty boxes with this card’s sourced figures and example exit conditions. Edit them into your own reasons.</div>'+
      '<label>Your thesis<textarea id="pse-pick-thesis" maxlength="1000" rows="3" placeholder="Why consider this company, and what evidence supports it?">'+esc(draft.thesis)+'</textarea></label>'+
      '<label>What would invalidate it?<textarea id="pse-pick-invalidation" maxlength="500" rows="2" placeholder="Which result, risk or price condition would change your view?">'+esc(draft.invalidation)+'</textarea></label>'+
      (canValue ? '<details><summary>Optional valuation scenario · your assumptions</summary><div class="pse-paper-fields"><label>Lower '+method+' multiple<input id="pse-pick-low" type="number" min="0.01" max="100" step="0.1" value="'+esc(draft.lowMultiple || '')+'" oninput="psePreviewValue()"></label><label>Upper '+method+' multiple<input id="pse-pick-high" type="number" min="0.01" max="100" step="0.1" value="'+esc(draft.highMultiple || '')+'" oninput="psePreviewValue()"></label></div><div id="pse-pick-value" class="pse-how">'+scenarioHtml(scenario)+'</div></details>' : '<div class="pse-how">PHP valuation range unavailable: '+(company.type==='reit' ? 'distributable income is not verified.' : company.annual && company.annual.currency && company.annual.currency!=='PHP' ? esc(company.symbol)+' reports in '+esc(company.annual.currency)+', so a peso multiple is not computed. Save without a range.' : 'positive, recent PHP per-share evidence is required.')+'</div>')+
      '<div class="pse-paper-fields"><label>Assumed fees / taxes per side (%)<input id="pse-pick-fee" type="number" min="0" max="2" step="0.01" value="'+esc(draft.feePct)+'"></label><label>Assumed slippage per side (%)<input id="pse-pick-slip" type="number" min="0" max="5" step="0.01" value="'+esc(draft.slippagePct)+'"></label></div>'+
      '<div class="pse-how">0.30% costs and 0.10% slippage are editable modelling assumptions, not a broker quote. Returns initially exclude dividends and do not verify corporate actions.</div>'+
      '<button type="button" class="tool-chip" onclick="pseCommitPick()"'+(busy ? ' disabled' : '')+'>'+(busy ? 'Saving…' : 'Save permanent paper pick')+'</button> <button type="button" class="pse-link" onclick="pseCancelPick()"'+(busy ? ' disabled' : '')+'>Cancel draft</button></fieldset><div id="pse-paper-status" class="pse-paper-status'+(busy ? ' pending' : '')+'" role="status">'+esc(draft.status || '')+'</div></div>';
  }
  function scenarioHtml(s){return s ? peso(s.low)+'–'+peso(s.high)+' · '+esc(s.assumption)+' Base period '+esc(s.periodEnd)+'.' : 'Enter both multiples to preview. This is your scenario, not a fair-value recommendation.';}
  function paperHtml(records,error,all){
    var picks=records || [],completed=picks.filter(function(r){return r.outcome && r.outcome.status==='completed';}).length;
    var html='<div class="journal-section">Permanent paper-pick record</div><div class="pse-how">'+picks.length+' saved · '+completed+' completed. Original theses cannot be edited or deleted here; outcomes update separately. Price-only results remain provisional and do not prove a picking edge.</div>';
    if(error){html+='<div class="pse-stale">'+esc(error)+' <button type="button" class="pse-link" onclick="pseReloadPaper()">Retry loading</button></div>';if(!picks.length)return html;}
    if(!picks.length)return html+'<div class="rel-none-txt">No paper picks yet. Open a company card and draft a thesis before its outcome is known.</div>';
    return html+picks.slice(0,all ? 500 : 50).map(function(r){
      var p=r.pick,o=r.outcome || {},s=p.research || {},status={'waiting-entry':'Waiting for a future close',tracking:'Tracking',completed:'Horizon completed','history-unavailable':'Price history incomplete','awaiting-exit-quote':'Waiting for exit quote'}[o.status] || 'Outcome unavailable';
      return '<details class="card pse-paper-record"><summary><b>'+esc(p.symbol)+'</b> · '+esc(p.approach)+' · '+p.horizon+' sessions<span>'+esc(status)+'</span></summary>'+
        '<div class="pse-how">Recorded '+esc(p.recordedAt)+' · observed close '+peso(p.observedClose)+' ('+esc(p.observedDate)+')</div><p><b>Original thesis:</b> '+esc(p.thesis)+'</p><p><b>Invalidation:</b> '+esc(p.invalidation)+'</p>'+
        (p.valuation ? '<div class="pse-how">Frozen valuation scenario: '+scenarioHtml(p.valuation)+'</div>' : '<div class="pse-how">No valuation scenario recorded.</div>')+
        '<div class="pse-how">Entry: '+(o.entryDate ? peso(o.entryPrice)+' at the '+esc(o.entryDate)+' close' : 'pending first completed close after '+esc(p.recordedDay))+' · costs '+n(p.feePct,'%')+' + slippage '+n(p.slippagePct,'%')+' per side.'+(o.targetDate ? ' Horizon date '+esc(o.targetDate)+'; exit uses the first available close on or after it.' : '')+(o.entryDate && o.calendarAvailable===false ? ' Benchmark calendar unavailable; horizon settlement pending.' : '')+'</div>'+
        (o.asOf ? '<dl class="pse-research-metrics"><dt>Net paper price return · '+esc(o.asOf)+'</dt><dd>'+n(o.netPriceReturn,'%')+'</dd><dt>PSE30 price return · before costs</dt><dd>'+n(o.benchmarkPriceReturn,'%')+'</dd><dt>Net paper minus gross PSE30</dt><dd>'+n(o.netExcessReturn,'%')+'</dd><dt>Largest closing-price drawdown</dt><dd>'+n(o.maxCloseDrawdown,'%')+'</dd></dl><div class="pse-how">'+esc(o.caveat)+'</div>' : '')+
        '<details><summary>Evidence frozen at save</summary><div class="pse-how">'+source(s.source)+' · checked '+esc(s.checkedAt)+' · annual '+esc(s.annual && s.annual.periodEnd)+' · interim '+esc(s.interim && s.interim.periodEnd)+' · '+esc(p.version)+'</div>'+list(s.brief && s.brief.observations)+list(s.brief && s.brief.risks)+'</details></details>';
    }).join('')+(picks.length>50 && !all ? '<button type="button" class="pse-link" onclick="pseShowAllPicks()">Show all '+picks.length+' saved picks</button>' : '');
  }
  root.PseResearchUI={cardsHtml:cardsHtml,formHtml:formHtml,paperHtml:paperHtml,scenarioHtml:scenarioHtml,starter:starter};
  if(typeof module!=='undefined' && module.exports)module.exports=root.PseResearchUI;
})(typeof globalThis!=='undefined' ? globalThis : this);
