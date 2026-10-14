(function(root){
  'use strict';
  function build(ledger,price,now){
    ledger=ledger||{};now=now==null?new Date():new Date(now);
    var parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(function(p){return[p.type,p.value];}));
    var today=parts.year+'-'+parts.month+'-'+parts.day,base=Date.parse(today+'T12:00:00Z');
    var input=0,output=0,inputCost=0,outputCost=0,unpriced=false;
    Object.values(ledger.entries||{}).forEach(function(e){
      if(e.model==='web-search')return;
      input+=Number(e.inputTokens)||0;output+=Number(e.outputTokens)||0;
      var a=price(e.model,Object.assign({},e,{outputTokens:0})),b=price(e.model,{outputTokens:e.outputTokens||0});
      if(a==null||b==null){unpriced=true;return;}inputCost+=a;outputCost+=b;
    });
    var days=Array.from({length:7},function(_,i){
      var day=new Date(base-(6-i)*86400000).toISOString().slice(0,10),daily=(ledger.byDay||{})[day],entries=Object.values((ledger.byDayEntries||{})[day]||{});
      if(!daily&&!entries.length)return{day:day,cost:null,today:day===today,estimated:false};
      var cost=0,knownInput=0,knownOutput=0,unknown=false;
      entries.forEach(function(e){var c=price(e.model,e);if(c==null)unknown=true;else cost+=c;if(e.model!=='web-search'){knownInput+=Number(e.inputTokens)||0;knownOutput+=Number(e.outputTokens)||0;}});
      var remainingInput=Math.max(0,((daily||{}).inputTokens||0)-knownInput),remainingOutput=Math.max(0,((daily||{}).outputTokens||0)-knownOutput);
      var estimated=remainingInput>0||remainingOutput>0;
      if(estimated&&((remainingInput>0&&!input)||(remainingOutput>0&&!output)))return{day:day,cost:null,today:day===today,estimated:true};
      cost+=(input?remainingInput*inputCost/input:0)+(output?remainingOutput*outputCost/output:0);
      return{day:day,cost:cost,today:day===today,estimated:estimated,unpriced:unknown||estimated&&unpriced};
    });
    var completed=days.slice(0,6),change=null;
    if(completed.every(function(d){return d.cost!=null;})){
      var earlier=completed.slice(0,3).reduce(function(s,d){return s+d.cost;},0),recent=completed.slice(3).reduce(function(s,d){return s+d.cost;},0);
      if(earlier>0)change=(recent-earlier)/earlier*100;
    }
    return{days:days,total:days.reduce(function(s,d){return s+(d.cost||0);},0),change:change,estimated:days.some(function(d){return d.estimated;}),unpriced:days.some(function(d){return d.unpriced;}),missing:days.filter(function(d){return d.cost==null;}).length};
  }
  root.LlmTrendCore={build:build};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.LlmTrendCore;
})(typeof globalThis!=='undefined'?globalThis:this);
