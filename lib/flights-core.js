(function(root) {
  'use strict';
  var ORIGINS=['MNL','CEB','CRK'];
  var DOMAINS=['philippineairlines.com','cathaypacific.com','airasia.com','cebupacificair.com','flyscoot.com'];
  function url(raw) {
    try { var u=new URL(raw);return u.protocol==='https:' && !u.username && !u.password && DOMAINS.some(function(d){return u.hostname===d || u.hostname.endsWith('.'+d);}) ? u.href : ''; }
    catch (_) { return ''; }
  }
  function select(data, filters, now) {
    filters=filters || {};now=now===undefined ? Date.now() : Number(new Date(now));
    var parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
    var p=Object.fromEntries(parts.map(function(p){return [p.type,p.value];}));
    var today=p.year+'-'+p.month+'-'+p.day, saved=new Set(filters.savedIds || []);
    var rows=(data && data.offers || []).filter(function(d) {
      if(!d || !/^[a-f0-9]{20}$/.test(d.id || '') || !url(d.sourceUrl) || !url(d.bookingUrl)) return false;
      if(d.campaign) {
        if(d.kind!=='promo' || !Array.isArray(d.origins) || !d.origins.some(function(o){return ORIGINS.includes(o);}) || !/^\d{4}-\d{2}-\d{2}$/.test(d.bookingEnd || '') || !/^\d{4}-\d{2}-\d{2}$/.test(d.travelStart || '') || !/^\d{4}-\d{2}-\d{2}$/.test(d.travelEnd || '') || d.travelEnd<d.travelStart)return false;
        if(d.bookingEnd<today && !filters.savedOnly)return false;
      } else if(!ORIGINS.includes(d.origin) || !/^[A-Z]{3}$/.test(d.destination || ''))return false;
      if(d.kind!=='advertised-fare' && d.kind!=='promo') return false;
      if(d.kind==='advertised-fare' && (!(typeof d.amount==='number' && Number.isFinite(d.amount) && d.amount>0) || !/^[A-Z]{3}$/.test(d.currency || '') || !['one-way','round-trip'].includes(d.tripType))) return false;
      if(d.kind==='advertised-fare' && (!/^\d{4}-\d{2}-\d{2}$/.test(d.departureDate || '') || !Number.isFinite(Date.parse(d.departureDate)) ||
        (d.tripType==='round-trip' && (!/^\d{4}-\d{2}-\d{2}$/.test(d.returnDate || '') || d.returnDate<d.departureDate)))) return false;
      if(d.departureDate && d.departureDate<today && !filters.savedOnly) return false;
      if(filters.origin && filters.origin!=='All' && (d.campaign ? !d.origins.includes(filters.origin) : d.origin!==filters.origin)) return false;
      if(filters.currency && filters.currency!=='All' && d.currency!==filters.currency) return false;
      if(filters.tripType==='campaigns' ? d.kind!=='promo' : filters.tripType && filters.tripType!=='All' && d.tripType!==filters.tripType) return false;
      var needle=String(filters.destination || '').trim().toLowerCase();
      if(needle && (d.destination+' '+d.destinationName+' '+d.airline+' '+(d.destinationKeywords || '')).toLowerCase().indexOf(needle)<0) return false;
      // A date-bounded search cannot assume an undated campaign covers that window.
      if(filters.from && (d.campaign ? d.travelEnd<filters.from : !d.departureDate || d.departureDate<filters.from)) return false;
      if(filters.to && (d.campaign ? d.travelStart>filters.to : !d.departureDate || d.departureDate>filters.to)) return false;
      if(filters.savedOnly && !saved.has(d.id)) return false;
      return true;
    }).map(function(d) {
      var checked=Date.parse(d.checkedAt || '');
      return Object.assign({},d,{expired:d.campaign ? d.bookingEnd<today : !!d.departureDate && d.departureDate<today,stale:!Number.isFinite(checked) || checked>now+300000 || now-checked>26*3600000,
        saved:saved.has(d.id),group:d.campaign ? 'Seat sales · base fares only' : d.kind==='promo' ? 'Promotions · fare and dates to verify' : d.currency+' · '+d.tripType+' · '+(d.cabin || 'Cabin not stated')});
    });
    rows.sort(function(a,b) {
      if(!!a.campaign!==!!b.campaign)return a.campaign ? -1 : 1;
      if(a.campaign && b.campaign)return a.bookingEnd.localeCompare(b.bookingEnd);
      if(a.kind!==b.kind) return a.kind==='advertised-fare' ? -1 : 1;
      return a.group.localeCompare(b.group) || (a.expired-b.expired) || (a.stale-b.stale) || (a.amount || Infinity)-(b.amount || Infinity) || (a.departureDate || '').localeCompare(b.departureDate || '');
    });
    return rows;
  }
  function phpEstimate(offer, snapshot, now) {
    if(!offer || offer.kind!=='advertised-fare' || offer.currency==='PHP' || !Number.isFinite(offer.amount) || offer.amount<=0) return null;
    var rate=snapshot && snapshot.fx && snapshot.fx[String(offer.currency || '').toLowerCase()+'php'];
    var level=rate && rate.level, asOf=snapshot && snapshot.asOf;
    var date=/^\d{4}-\d{2}-\d{2}$/.test(asOf || '') ? Date.parse(asOf+'T00:00:00Z') : NaN;
    now=now===undefined ? Date.now() : Number(new Date(now));
    // Locale output can be MM/DD/YYYY in some browsers. Build an ISO date
    // from named parts instead of passing display text to Date.parse.
    var parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
    var calendar={};parts.forEach(function(p){calendar[p.type]=p.value;});
    var today=Date.parse(calendar.year+'-'+calendar.month+'-'+calendar.day+'T00:00:00Z');
    if(!Number.isFinite(level) || level<=0 || !Number.isFinite(date) || new Date(date).toISOString().slice(0,10)!==asOf || date>today || !Number.isFinite(offer.amount*level)) return null;
    return {amount:offer.amount*level,rate:level,asOf:asOf,stale:today-date>=4*86400000};
  }
  function evidenceUrl(raw) {
    if(url(raw))return url(raw);
    try {var u=new URL(raw);return u.protocol==='https:' && ['hellomnl.com','logisticsnews.ph'].includes(u.hostname) && !u.username && !u.password ? u.href : '';}catch(_){return '';}
  }
  function shortlist(rows,preferences,snapshot,now) {
    preferences=preferences || {};
    var min=Number(preferences.minNights),max=Number(preferences.maxNights),budget=Number(preferences.budget),extra=Number(preferences.extra);
    min=Number.isFinite(min)&&min>=0?min:3;max=Number.isFinite(max)&&max>=0?max:10;
    if(budget<0 || extra<0)return {items:[],error:'Budget and extra-cost allowance must be zero or more.',eligible:0,unconverted:0};
    extra=Number.isFinite(extra)&&extra>=0?extra:0;
    if(min>max)return {items:[],error:'Minimum nights must not exceed maximum nights.',eligible:0,unconverted:0};
    var unconverted=0,eligible=[];
    rows.forEach(function(d){
      if(d.kind!=='advertised-fare'||d.tripType!=='round-trip'||d.stale||d.expired||!/economy/i.test(d.cabin || '')||/premium/i.test(d.cabin || ''))return;
      var nights=(Date.parse(d.returnDate)-Date.parse(d.departureDate))/86400000;
      if(!Number.isFinite(nights)||nights<min||nights>max)return;
      if(preferences.directOnly && d.stops!==0)return;
      var peso=d.currency==='PHP'?{amount:d.amount,stale:false}:phpEstimate(d,snapshot,now);
      if(!peso || peso.stale){unconverted++;return;}
      var phpFare=Math.round(peso.amount*100)/100,estimate=Math.round((phpFare+extra)*100)/100;
      if(budget>0 && estimate>budget)return;
      eligible.push(Object.assign({},d,{nights:nights,phpFare:phpFare,planningAmount:estimate,extraAllowance:extra}));
    });
    eligible.sort(function(a,b){return a.planningAmount-b.planningAmount || (b.taxesIncluded===true)-(a.taxesIncluded===true) || a.nights-b.nights || a.departureDate.localeCompare(b.departureDate);});
    var unique=new Set(),items=[];
    eligible.forEach(function(d){
      var key=d.destination;
      if(unique.has(key)||items.length>=3)return;unique.add(key);
      var alternatives=eligible.filter(function(other){return other.destination===d.destination && other.id!==d.id;});
      var dateOptions=new Set(alternatives.map(function(other){return other.departureDate+'|'+other.returnDate;}));
      var reason='Lowest observed return fare to '+(d.destinationName || d.destination)+' matching '+min+'–'+max+' nights.';
      if(dateOptions.size)reason+=' '+dateOptions.size+' other date '+(dateOptions.size===1?'combination':'combinations')+' observed.';
      var checks=[];
      if(d.taxesIncluded!==true)checks.push('Taxes and surcharges unconfirmed');
      if(d.travelTaxIncluded!==true)checks.push('Philippine travel tax unconfirmed or extra');
      if(d.checkedBaggageIncluded!==true)checks.push(preferences.baggage?'Your checked bag is not confirmed':'Baggage allowance unconfirmed');
      if(!Number.isInteger(d.stops))checks.push('Stops unconfirmed');
      checks.push('Recheck seats and final price on airline');
      items.push(Object.assign({},d,{recommendation:reason,costChecks:checks,alternativeIds:alternatives.slice(0,3).map(function(d){return d.id;})}));
    });
    return {items:items,eligible:eligible.length,unconverted:unconverted,error:''};
  }
  function deadlineLabel(d,now) {
    if(!d.campaign || !/^\d{4}-\d{2}-\d{2}$/.test(d.bookingEnd || ''))return '';
    var parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now===undefined?Date.now():now));
    var p=Object.fromEntries(parts.map(function(p){return [p.type,p.value];}));
    var days=(Date.parse(d.bookingEnd+'T00:00:00Z')-Date.parse(p.year+'-'+p.month+'-'+p.day+'T00:00:00Z'))/86400000;
    return days<0?'Sale ended':days===0?'Sale ends today · Philippine time':days===1?'Sale ends tomorrow · Philippine time':days<=3?'Sale ends in '+days+' days':'';
  }
  root.FlightsCore={select:select,officialUrl:url,evidenceUrl:evidenceUrl,origins:ORIGINS,phpEstimate:phpEstimate,shortlist:shortlist,deadlineLabel:deadlineLabel};
  if(typeof module!=='undefined' && module.exports)module.exports=root.FlightsCore;
})(typeof globalThis!=='undefined' ? globalThis : this);
