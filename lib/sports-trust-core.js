(function(root){
  'use strict';
  function before(seen,start){var a=Date.parse(seen),b=Date.parse(start);return Number.isFinite(a) && Number.isFinite(b) && a<b;}
  function probability(p){return typeof p==='number' && Number.isFinite(p) && p>=0 && p<=1;}
  function tag(value){return value==='Strong edge' ? 'Strong lean' : value==='Moderate edge' ? 'Moderate lean' : value;}
  function decisive(value){return ['Strong lean','Moderate lean'].includes(tag(value));}
  function freshness(mod,now){
    mod=mod || {};now=now==null ? Date.now() : now;
    var checkedAt=mod.lastSuccessfulAt || mod.generatedAt || '',at=Date.parse(checkedAt);
    var age=Number.isFinite(at) ? (now-at)/3600000 : null;
    var threshold=Number(mod.staleAfterHours);if(!(threshold>0 && Number.isFinite(threshold)))threshold=12;
    var retained=!!mod.fallback || ['fallback','error'].includes(mod.refreshStatus);
    var current=age!=null && age>=0 && age<=threshold && !retained;
    return {checkedAt:checkedAt || null,current:current,live:current && age<=0.25,ageHours:age,
      label:retained ? 'retained snapshot' : current ? 'checked' : 'stale or unverified'};
  }
  root.SportsTrust={before:before,probability:probability,tag:tag,decisive:decisive,freshness:freshness};
  if(typeof module!=='undefined' && module.exports)module.exports=root.SportsTrust;
})(typeof globalThis!=='undefined' ? globalThis : this);
