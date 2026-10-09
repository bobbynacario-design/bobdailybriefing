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
  root.FlightsCore={select:select,officialUrl:url,origins:ORIGINS};
  if(typeof module!=='undefined' && module.exports)module.exports=root.FlightsCore;
})(typeof globalThis!=='undefined' ? globalThis : this);
