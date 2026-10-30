(function(root){
  'use strict';
  // Condo rentals (Explore → Rentals): Bob's search over the daily scout feed
  // briefings-bob/rentals-latest (flights/refresh-rentals.js). His choices of
  // 29 Oct 2026: a long-term lease to live in, up to ₱25,000, studio or
  // 1 bedroom, in Cubao, Ortigas, Makati CBD or BGC.
  var AREAS=[{id:'cubao',name:'Cubao'},{id:'ortigas',name:'Ortigas'},{id:'makati',name:'Makati CBD'},{id:'bgc',name:'BGC'},{id:'naia',name:'NAIA area'},{id:'clark',name:'Clark area'}];
  var SIZES=[{id:'studio',label:'Studio',beds:0},{id:'1br',label:'1 bedroom',beds:1}];
  var FURNISH=[['any','Any furnishing'],['furnished','Furnished or semi'],['fully','Fully furnished only'],['unfurnished','Unfurnished']];
  var STATUSES=['Shortlisted','Messaged','Viewing booked','Viewed','Applied'];
  var MAX_BUDGET=30000;
  var DAY=86400000;
  function defaults(){return {budget:25000,sizes:['studio','1br'],areas:AREAS.map(function(a){return a.id;}),areaVersion:2,furnish:'any',hideShortStays:true,saved:{},hidden:[]};}
  var ids=function(v,allowed){return Array.isArray(v)?v.filter(function(x,i){return allowed.indexOf(x)>=0 && v.indexOf(x)===i;}):null;};
  // Shortlist entries are {status, at}; hidden is a list of listing ids.
  function cleanPrefs(p){
    var d=defaults();p=p || {};
    var budget=Math.round(Number(p.budget));
    var saved={};Object.keys(p.saved && typeof p.saved==='object'?p.saved:{}).slice(0,200).forEach(function(id){var s=p.saved[id] || {};if(/^(?:dot|hop):[\w-]{1,80}$/.test(id))saved[id]={status:STATUSES.indexOf(s.status)>=0?s.status:STATUSES[0],at:String(s.at || '').slice(0,30)};});
    var areas=ids(p.areas,AREAS.map(function(a){return a.id;})) || d.areas;
    // Include the requested airport areas once for searches saved before the
    // expansion. A later Save search can turn either one off permanently.
    if(!(p.areaVersion>=2))['naia','clark'].forEach(function(id){if(areas.indexOf(id)<0)areas.push(id);});
    return {budget:budget>=5000 && budget<=MAX_BUDGET?budget:d.budget,
      sizes:ids(p.sizes,SIZES.map(function(s){return s.id;})) || d.sizes,
      areas:areas,areaVersion:2,
      furnish:FURNISH.some(function(f){return f[0]===p.furnish;})?p.furnish:d.furnish,
      hideShortStays:p.hideShortStays!==false,saved:saved,
      hidden:Array.isArray(p.hidden)?p.hidden.filter(function(id){return /^(?:dot|hop):[\w-]{1,80}$/.test(id);}).slice(-300):[]};
  }
  function safeUrl(u){try{var x=new URL(u);return x.protocol==='https:' && /(^|\.)(?:dotproperty\.com\.ph|hoppler\.com\.ph)$/.test(x.hostname)?x.href:'';}catch(e){return '';}}
  function imageUrl(u){try{var x=new URL(u);return x.protocol==='https:' && /^(?:pix\.dotproperty\.co\.th|d2wy52y0hrt3v\.cloudfront\.net)$/.test(x.hostname)?x.href:'';}catch(e){return '';}}
  // A listing with no bedroom count is a studio when the text says so (the
  // scout reads that) or it is no bigger than a typical studio.
  function sizeOf(i){return i.beds===0?'studio':i.beds===1?'1br':i.beds==null && i.sqm && i.sqm<=30?'studio':i.beds==null?'unknown':'other';}
  function furnishOk(i,f){
    if(f==='any')return true;
    if(f==='fully')return i.furnish==='Fully furnished';
    if(f==='furnished')return ['Fully furnished','Furnished','Semi-furnished'].indexOf(i.furnish)>=0;
    return i.furnish==='Unfurnished';
  }
  function benchmark(i,feed){var b=feed && feed.benchmarks && feed.benchmarks[i.area],k=sizeOf(i);return b && (k==='studio' || k==='1br')?b[k] || null:null;}
  // Rent per m² against the area's median for the same size; without a size,
  // the rent against the median rent. Negative = cheaper than typical.
  function value(i,feed){
    var b=benchmark(i,feed);if(!b)return null;
    if(i.sqm>=15 && b.medianPerSqm){var per=Math.round(i.price/i.sqm);return {basis:'perSqm',perSqm:per,median:b.medianPerSqm,n:b.sized,pct:Math.round((per/b.medianPerSqm-1)*100)};}
    return {basis:'rent',median:b.medianRent,n:b.n,pct:Math.round((i.price/b.medianRent-1)*100)};
  }
  // "New" needs a run before it: on the scout's first day everything is new.
  function isNew(i,feed){var f=Date.parse(i.firstSeen),since=Date.parse(feed && feed.trackingSince),at=Date.parse(feed && feed.generatedAt);return Number.isFinite(f) && Number.isFinite(since) && f-since>20*3600000 && at>=f && at-f<=3*DAY;}
  function dropped(i){return i.previousPrice>i.price;}
  function stale(i,now){var u=Date.parse(i.updatedAt);return Number.isFinite(u) && (now || Date.now())-u>180*DAY;}
  function matches(i,p){
    var k=sizeOf(i);
    return p.areas.indexOf(i.area)>=0 && i.price<=p.budget && (p.sizes.indexOf(k)>=0 || k==='unknown' && p.sizes.length>0) && furnishOk(i,p.furnish) && !(p.hideShortStays && i.stay==='short');
  }
  // filters: {area, size, view:'all'|'shortlist'|'new'|'drops'|'hidden', sort:'value'|'new'|'price'}
  function matchItems(feed,prefs,filters){
    var p=cleanPrefs(prefs),f=filters || {},hidden=p.hidden;
    var rows=(feed && feed.items || []).filter(function(i){
      if(!/^(?:dot|hop):[\w-]{1,80}$/.test(i.id) || !safeUrl(i.url) || !Number.isFinite(i.price) || !(i.price>0))return false;
      if(f.area && i.area!==f.area)return false;
      if(f.size && sizeOf(i)!==f.size)return false;
      if(f.view==='hidden')return hidden.indexOf(i.id)>=0;
      if(f.view==='shortlist')return !!p.saved[i.id];
      if(hidden.indexOf(i.id)>=0 || !matches(i,p))return false;
      if(f.view==='new' && !isNew(i,feed))return false;
      if(f.view==='drops' && !dropped(i))return false;
      return true;
    });
    var v=function(i){var x=value(i,feed);return x?x.pct:1e9;};
    var sorts={
      value:function(a,b){return v(a)-v(b) || a.price-b.price;},
      new:function(a,b){return String(b.firstSeen || '').localeCompare(String(a.firstSeen || '')) || a.price-b.price;},
      price:function(a,b){return a.price-b.price || v(a)-v(b);}
    };
    return rows.sort(sorts[f.sort] || sorts.value);
  }
  var months=function(n){return n+' month'+(n===1?'':'s');};
  // Lease terms as the listing states them. Missing terms stay missing.
  function terms(i){
    var out=[];
    if(i.deposit!=null)out.push(months(i.deposit)+' deposit');
    if(i.advance!=null)out.push(months(i.advance)+' advance');
    if(i.termsAsWritten)out.push('terms written as '+i.termsAsWritten);
    if(i.minLeaseMonths)out.push(i.minLeaseMonths+'-month minimum');
    if(i.duesIncluded===true)out.push('dues included');
    if(i.duesIncluded===false)out.push('dues extra');
    if(i.pdc===true)out.push('post-dated cheques');
    if(i.pdc===false)out.push('no post-dated cheques');
    return out;
  }
  // Cash to move in: the stated deposit and advance months times the rent.
  // When neither is stated, the usual Metro Manila ask (2 + 1) is shown as
  // typical, never as the listing's terms.
  function moveIn(i){
    if(i.deposit!=null || i.advance!=null){var m=(i.deposit || 0)+(i.advance || 0);return {amount:m*i.price,months:m,stated:true,partial:i.deposit==null || i.advance==null};}
    return {amount:3*i.price,months:3,stated:false};
  }
  function enquiry(i){
    return ['Hello, is '+(i.building || i.title || 'this condo')+' in '+(AREAS.find(function(a){return a.id===i.area;}) || {name:i.area}).name+' still available for a long-term lease?',
      'I saw the advertised rent of ₱'+i.price.toLocaleString('en-PH')+' per month. Please confirm the current rent'+(i.textPrice?' (the description also mentions ₱'+i.textPrice.toLocaleString('en-PH')+')':'')+'.',
      'Are association dues included? What other monthly charges apply?',
      'Please confirm the deposit, advance rent, total move-in cash, minimum lease and whether post-dated cheques are required.',
      'What furnishings are included, and when could I view the unit?',safeUrl(i.url)].join('\n\n');
  }
  // The other big sites refuse automated reads, so these open their own
  // searches for a look by hand. Carousell and Facebook were opened on
  // 29 Oct 2026; Lamudi refuses the in-app browser too, so its paths are
  // the area pages it publishes to search engines (cubao-1, ortigas-cbd-1).
  var MANUAL={
    cubao:{lamudi:'quezon-city/cubao-1',place:'Cubao Quezon City'},
    ortigas:{lamudi:'pasig/ortigas-cbd-1',place:'Ortigas'},
    makati:{lamudi:'makati',place:'Makati'},
    bgc:{lamudi:'taguig/fort-bonifacio-1',place:'BGC Taguig'},
    naia:{place:'NAIA Pasay'},
    clark:{place:'Clark Pampanga'}
  };
  function searchLinks(area,budget){
    var m=MANUAL[area];if(!m)return [];
    var q=encodeURIComponent('condo for rent '+m.place);
    return [
      m.lamudi?{site:'Lamudi',url:'https://www.lamudi.com.ph/rent/metro-manila/'+m.lamudi+'/condo/'}:null,
      {site:'Carousell',url:'https://www.carousell.ph/search/'+q},
      {site:'Facebook Marketplace',url:'https://www.facebook.com/marketplace/'+(area==='clark'?'':'manila/')+'search/?query='+q+'&maxPrice='+budget}
    ].filter(Boolean);
  }
  root.RentalsCore={AREAS:AREAS,SIZES:SIZES,FURNISH:FURNISH,STATUSES:STATUSES,MAX_BUDGET:MAX_BUDGET,defaults:defaults,cleanPrefs:cleanPrefs,safeUrl:safeUrl,imageUrl:imageUrl,sizeOf:sizeOf,furnishOk:furnishOk,benchmark:benchmark,value:value,isNew:isNew,dropped:dropped,stale:stale,matches:matches,matchItems:matchItems,terms:terms,moveIn:moveIn,enquiry:enquiry,searchLinks:searchLinks};
  if(typeof module!=='undefined' && module.exports)module.exports=root.RentalsCore;
})(typeof globalThis!=='undefined'?globalThis:this);
