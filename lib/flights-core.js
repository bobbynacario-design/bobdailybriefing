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
    var today=new Date(now).toISOString().slice(0,10), saved=new Set(filters.savedIds || []);
    var rows=(data && data.offers || []).filter(function(d) {
      if(!d || !/^[a-f0-9]{20}$/.test(d.id || '') || !ORIGINS.includes(d.origin) || !/^[A-Z]{3}$/.test(d.destination || '') || !url(d.sourceUrl) || !url(d.bookingUrl)) return false;
      if(d.kind!=='advertised-fare' && d.kind!=='promo') return false;
      if(d.kind==='advertised-fare' && (!(typeof d.amount==='number' && Number.isFinite(d.amount) && d.amount>0) || !/^[A-Z]{3}$/.test(d.currency || '') || !['one-way','round-trip'].includes(d.tripType))) return false;
      if(d.kind==='advertised-fare' && (!/^\d{4}-\d{2}-\d{2}$/.test(d.departureDate || '') || !Number.isFinite(Date.parse(d.departureDate)) ||
        (d.tripType==='round-trip' && (!/^\d{4}-\d{2}-\d{2}$/.test(d.returnDate || '') || d.returnDate<d.departureDate)))) return false;
      if(d.departureDate && d.departureDate<today && !filters.savedOnly) return false;
      if(filters.origin && filters.origin!=='All' && d.origin!==filters.origin) return false;
      if(filters.currency && filters.currency!=='All' && d.currency!==filters.currency) return false;
      if(filters.tripType && filters.tripType!=='All' && d.tripType!==filters.tripType) return false;
      var needle=String(filters.destination || '').trim().toLowerCase();
      if(needle && (d.destination+' '+d.destinationName+' '+d.airline).toLowerCase().indexOf(needle)<0) return false;
      // A date-bounded search cannot assume an undated campaign covers that window.
      if(filters.from && (!d.departureDate || d.departureDate<filters.from)) return false;
      if(filters.to && (!d.departureDate || d.departureDate>filters.to)) return false;
      if(filters.savedOnly && !saved.has(d.id)) return false;
      return true;
    }).map(function(d) {
      var checked=Date.parse(d.checkedAt || '');
      return Object.assign({},d,{expired:!!d.departureDate && d.departureDate<today,stale:!Number.isFinite(checked) || checked>now+300000 || now-checked>26*3600000,
        saved:saved.has(d.id),group:d.kind==='promo' ? 'Promotions · fare and dates to verify' : d.currency+' · '+d.tripType+' · '+(d.cabin || 'Cabin not stated')});
    });
    rows.sort(function(a,b) {
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
  root.FlightsCore={select:select,officialUrl:url,origins:ORIGINS,phpEstimate:phpEstimate};
  if(typeof module!=='undefined' && module.exports)module.exports=root.FlightsCore;
})(typeof globalThis!=='undefined' ? globalThis : this);
