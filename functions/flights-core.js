(function(root) {
  'use strict';
  var ORIGINS=['MNL','CEB','CRK'];
  var DOMESTIC={MPH:'Boracay (Caticlan)',ENI:'El Nido',IAO:'Siargao'};
  var PH=new Set('MNL CEB CRK DVO ILO KLO MPH PPS TAG TAC BCD CGY ZAM GES DGT BXU DRP LGP LAO TUG RXS CYZ CBO DPL PAG SJI IAO SUG USU WNP BSO RZP ENI MBT TBH JOL TWT CYP DTI VRC SFE BQA BPH CRM OMH SGS LWA MXI LBX'.split(' '));
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
      var market=filters.market || 'international';
      if(market==='international' ? !d.campaign && PH.has(d.destination) : d.campaign || !DOMESTIC[d.destination] || market!=='domestic' && d.destination!==market)return false;
      if(d.kind!=='advertised-fare' && d.kind!=='promo') return false;
      if(d.kind==='advertised-fare' && (!(typeof d.amount==='number' && Number.isFinite(d.amount) && d.amount>0) || !/^[A-Z]{3}$/.test(d.currency || '') || !['one-way','round-trip'].includes(d.tripType))) return false;
      if(d.kind==='advertised-fare' && (!/^\d{4}-\d{2}-\d{2}$/.test(d.departureDate || '') || !Number.isFinite(Date.parse(d.departureDate)) ||
        (d.tripType==='round-trip' && (!/^\d{4}-\d{2}-\d{2}$/.test(d.returnDate || '') || d.returnDate<d.departureDate)))) return false;
      if(d.departureDate && d.departureDate<today && !filters.savedOnly) return false;
      if(filters.origin && filters.origin!=='All' && (d.campaign ? !d.origins.includes(filters.origin) : d.origin!==filters.origin)) return false;
      if(filters.currency && filters.currency!=='All' && d.currency!==filters.currency) return false;
      if(d.kind==='advertised-fare' && (filters.cabin==='economy' && !economy(d.cabin) || filters.cabin==='premium' && economy(d.cabin))) return false;
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
      if(d.taxesIncluded!==true)checks.push('Taxes and surcharges');
      if(!DOMESTIC[d.destination] && d.travelTaxIncluded!==true)checks.push('Philippine travel tax');
      if(d.checkedBaggageIncluded!==true)checks.push(preferences.baggage?'Your checked bag':'Baggage allowance');
      if(!Number.isInteger(d.stops))checks.push('Stops');
      checks.push('Seats and final price');
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
  // Display grouping only, near to far. Unlisted airports fall under Elsewhere.
  var REGIONS=[
    ['Philippines','MPH ENI IAO'],
    ['Hong Kong, Taiwan & China','HKG MFM TPE TSA KHH PVG SHA PEK PKX CAN SZX XMN JJN WUH CTU CKG'],
    ['Japan','NRT HND TYO KIX ITM FUK NGO CTS ASJ KMI NGS TKS HIJ OKA AXT KOJ SDJ OIT'],
    ['South Korea','ICN GMP PUS CJU'],
    ['Southeast Asia','SIN SGN HAN DAD KUL BKK DMK HKT CNX CGK DPS BKI PNH REP RGN BWN'],
    ['Australia & New Zealand','SYD MEL BNE PER ADL CNS CBR OOL DRW AKL CHC WLG'],
    ['North America & Hawaii','LAX SFO JFK EWR ORD SEA DFW BOS IAH LAS PHX MCO ATL DCA IAD SAN PHL HNL YYZ YVR YEG YYC YUL YOW YWG'],
    ['United Kingdom & Europe','LHR LGW MAN CDG FRA AMS FCO MAD ZRH'],
    ['Middle East & South Asia','DXB AUH DOH RUH JED DEL BOM']
  ];
  function region(code) {
    for(var i=0;i<REGIONS.length;i++) if(REGIONS[i][1].split(' ').indexOf(code)>=0) return {name:REGIONS[i][0],order:i};
    return {name:'Elsewhere',order:REGIONS.length};
  }
  function economy(cabin) { return /economy/i.test(cabin || '') && !/premium/i.test(cabin || ''); }
  function phtYear(now) {
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric'}).formatToParts(new Date(now===undefined?Date.now():now)).filter(function(p){return p.type==='year';})[0].value;
  }
  // "Sun 1 Nov", with the year only when it differs from this year in Manila.
  function dayLabel(iso, now) {
    var date=new Date(String(iso || '')+'T00:00:00Z');
    // Engines roll 2026-02-30 into March; only a round-tripped date is real.
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso || '') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==iso) return '';
    var parts={};new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short'}).formatToParts(date).forEach(function(p){parts[p.type]=p.value;});
    return parts.weekday+' '+parts.day+' '+parts.month+(iso.slice(0,4)!==phtYear(now) ? ' '+iso.slice(0,4) : '');
  }
  function tripLabel(d, now) {
    if(!d || !d.departureDate) return '';
    var nights=d.returnDate ? Math.round((Date.parse(d.returnDate)-Date.parse(d.departureDate))/86400000) : NaN;
    return dayLabel(d.departureDate,now)+(d.returnDate ? ' → '+dayLabel(d.returnDate,now)+' · '+nights+(nights===1?' night':' nights') : ' · one way');
  }
  function peso(d, snapshot, now) {
    if(d.kind!=='advertised-fare') return null;
    if(d.currency==='PHP') return {amount:d.amount,stale:false};
    return phpEstimate(d,snapshot,now);
  }
  // One entry per destination city, grouped by region. Cities rank by the
  // cheapest PHP estimate; a fare without a current rate ranks after them.
  function board(rows, snapshot, now) {
    var cities=new Map();
    rows.forEach(function(d) {
      if(d.kind!=='advertised-fare') return;
      var name=d.destinationName || d.destination, php=peso(d,snapshot,now);
      var comparison=d.tripType+' · '+(d.cabin || 'Cabin not stated')+(php && !php.stale ? '' : ' · '+d.currency);
      var key=name+'|'+comparison;
      if(!cities.has(key)) cities.set(key,{name:name,comparison:comparison,codes:[],airlines:[],samples:[],region:region(d.destination)});
      var city=cities.get(key);
      if(city.codes.indexOf(d.destination)<0) city.codes.push(d.destination);
      if(city.airlines.indexOf(d.airline)<0) city.airlines.push(d.airline);
      city.samples.push(Object.assign({},d,{php:php && !php.stale ? Math.round(php.amount) : null}));
    });
    var rank=function(a,b){return (a.expired-b.expired) || (a.stale-b.stale) || ((a.php==null)-(b.php==null)) || (a.php==null ? a.currency.localeCompare(b.currency) || a.amount-b.amount : a.php-b.php) || a.departureDate.localeCompare(b.departureDate);};
    var regions=new Map();
    cities.forEach(function(city) {
      city.samples.sort(rank);city.best=city.samples[0];
      var key=city.region.name+'|'+city.comparison;
      if(!regions.has(key)) regions.set(key,{name:city.region.name,comparison:city.comparison,order:city.region.order,cities:[]});
      regions.get(key).cities.push(city);
    });
    return Array.from(regions.values()).map(function(r){r.cities.sort(function(a,b){return rank(a.best,b.best) || a.name.localeCompare(b.name);});r.best=r.cities[0].best;return r;})
      .sort(function(a,b){return a.order-b.order || a.comparison.localeCompare(b.comparison);});
  }
  // Price memory: flights-history keeps each route's daily low (any airline,
  // any sample dates). A fare is compared only with earlier days of its own
  // origin, destination, journey, cabin and currency.
  function historyKey(d) { return [d.origin,d.destination,d.tripType,d.cabin,d.currency].join('|'); }
  function memoryIndex(history) {
    var byKey={};
    Object.keys(history && history.routes || {}).forEach(function(id){var r=history.routes[id];if(r && typeof r.key==='string' && r.days && typeof r.days==='object')byKey[r.key]=r.days;});
    return {byKey:byKey,firstDay:history && /^\d{4}-\d{2}-\d{2}$/.test(history.firstDay || '') ? history.firstDay : ''};
  }
  function priceMemory(d, index, asOf) {
    if(!d || d.kind!=='advertised-fare' || !index || !index.firstDay || !/^\d{4}-\d{2}-\d{2}$/.test(asOf || '')) return null;
    var days=index.byKey[historyKey(d)] || {}, earlier=Object.keys(days).filter(function(day){return /^\d{4}-\d{2}-\d{2}$/.test(day) && day<asOf && typeof days[day]==='number' && Number.isFinite(days[day]) && days[day]>0;}).sort();
    if(!earlier.length) return {earlierDays:0,since:index.firstDay};
    // The most recent day at the low is the more useful reference.
    var lowDay=earlier.reduce(function(m,day){return days[day]<=days[m] ? day : m;},earlier[0]), low=days[lowDay];
    return {earlierDays:earlier.length,since:earlier[0],low:low,lowDay:lowDay,currency:d.currency,delta:Math.round((d.amount-low)*100)/100,newLow:!d.stale && !d.expired && d.amount<low};
  }
  // A Google Flights search for exact dates, priced in PHP. It covers the
  // budget airlines the scout cannot read; Daybook itself quotes nothing here.
  function searchLink(from,to,start,end) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) || !String(from || '').trim() || !String(to || '').trim()) return '';
    var q='Flights from '+String(from).trim()+' to '+String(to).trim()+' on '+start+(end ? ' through '+end : ' one way');
    return 'https://www.google.com/travel/flights?hl=en&curr=PHP&q='+encodeURIComponent(q);
  }
  // Hotels: hotels-latest holds, per city, a few well-reviewed hotels with
  // Tripadvisor's typical nightly range and the booking-site rates for the
  // dates of scouted fares (per room per night, in the document's currency).
  function hotelIndex(doc) {
    var byAirport={},byName={};
    (doc && Array.isArray(doc.cities) ? doc.cities : []).forEach(function(c) {
      if(!c || typeof c.city!=='string' || !Array.isArray(c.hotels) || !c.hotels.length || !Array.isArray(c.airports)) return;
      // Cities arrive in the scout's order, so ICN stays with Seoul, not Incheon.
      c.airports.forEach(function(a){if(!byAirport[a])byAirport[a]=c;});
      byName[c.city.toLowerCase()]=c;
    });
    return {byAirport:byAirport,byName:byName,currency:/^[A-Z]{3}$/.test(doc && doc.currency || '') ? doc.currency : 'USD',
      rooms:Number(doc && doc.rooms) || 1,adults:Number(doc && doc.adults) || 2,generatedAt:doc && doc.generatedAt || ''};
  }
  // A city by name first (a poker venue city such as Incheon), then airport.
  function hotelCity(index,name,airports) {
    if(!index) return null;
    var c=index.byName[String(name || '').toLowerCase()];
    for(var i=0;!c && i<(airports || []).length;i++) c=index.byAirport[airports[i]];
    return c || null;
  }
  function hotelPeso(amount,index,fx,now) {
    if(!(amount>0)) return null;
    if(index.currency==='PHP') return {amount:amount,stale:false};
    var p=phpEstimate({kind:'advertised-fare',currency:index.currency,amount:amount},fx,now);
    return p && !p.stale ? p : null;
  }
  function tripadvisorUrl(raw) {
    try { var u=new URL(raw);return u.protocol==='https:' && /(^|\.)tripadvisor\.com$/.test(u.hostname) && !u.username && !u.password ? u.href : ''; }
    catch(_) { return ''; }
  }
  // Every hotel for one priced stay, cheapest priced first. A deal is a
  // cheapest rate at least 10% below Tripadvisor's typical lowest for that
  // hotel (about 1 room in 12 on 12 Oct 2026; any amount below was 1 in 4),
  // unless a single site sits far under the next one (often another room).
  function stayQuotes(city,checkIn,checkOut,index,fx,now) {
    var stay=(city && Array.isArray(city.stays) ? city.stays : []).filter(function(s){return s && s.checkIn===checkIn && s.checkOut===checkOut;})[0];
    if(!stay || !index) return null;
    var age=(now==null ? Date.now() : new Date(now).getTime())-Date.parse(stay.pricedAt || '');
    var stale=!(age>=-300000 && age<=26*3600000);
    var peso=function(v){var p=hotelPeso(v,index,fx,now);return p ? Math.round(p.amount) : null;};
    var rows=city.hotels.map(function(h) {
      var q=(Array.isArray(stay.quotes) ? stay.quotes : []).filter(function(q){return q && q.key===h.key;})[0];
      var valid=(q && Array.isArray(q.rates) ? q.rates : []).filter(function(r){return r && typeof r.site==='string' && Number.isFinite(r.rate) && r.rate>0;});
      // Some hotel brand sites report the whole stay as the rate (Hilton
      // Boston: 7,338 for 20 nights on 12 Oct 2026). Far above the hotel's
      // typical top rate, a figure is left out rather than read as nightly.
      var rates=valid.filter(function(r){return !(h.typicalMax>0 && r.rate>h.typicalMax*2.5);}).sort(function(a,b){return a.rate-b.rate;});
      var best=rates[0] || null, lone=!!(best && rates[1] && best.rate<rates[1].rate*0.6);
      var discount=best && h.typicalMin>0 && best.rate<h.typicalMin ? (1-best.rate/h.typicalMin)*100 : 0;
      var below=Math.round(discount);
      return {hotel:h,rates:rates.map(function(r){return {site:r.site,rate:r.rate,php:peso(r.rate)};}),best:best,php:best ? peso(best.rate) : null,
        checked:!!(q && q.checked),stale:stale,lone:lone,below:below,deal:!!(best && best.rate<=h.typicalMin*0.9 && !lone && !stale),typical:{min:peso(h.typicalMin),max:peso(h.typicalMax)},leftOut:valid.length-rates.length};
    });
    rows.sort(function(a,b){return (!a.best)-(!b.best) || (a.best && b.best ? a.best.rate-b.best.rate : 0);});
    var nights=Math.round((Date.parse(checkOut)-Date.parse(checkIn))/86400000);
    return {stay:stay,stale:stale,nights:nights,rows:rows,cheapest:!stale && rows[0] && rows[0].best ? rows[0] : null,deals:rows.filter(function(r){return r.deal;})};
  }
  // Validate actual calendar dates and occupancy before requesting a new quote.
  function hotelStaySettings(value) {
    var date=function(s){return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;};
    if(!value || !date(value.checkIn) || !date(value.checkOut)) return null;
    var nights=(Date.parse(value.checkOut)-Date.parse(value.checkIn))/86400000;
    var rooms=value.rooms==null ? 1 : Number(value.rooms),adults=value.adults==null ? 2 : Number(value.adults);
    if(nights<1 || nights>30 || !Number.isInteger(rooms) || rooms<1 || rooms>4 || !Number.isInteger(adults) || adults<rooms || adults>8) return null;
    return {checkIn:value.checkIn,checkOut:value.checkOut,rooms:rooms,adults:adults,nights:nights};
  }
  // Tripadvisor's typical lowest nightly rates across a city's hotels, in PHP.
  function typicalNightly(city,index,fx,now) {
    var mins=(city && city.hotels || []).map(function(h){var p=hotelPeso(h.typicalMin,index,fx,now);return p ? Math.round(p.amount) : null;}).filter(function(n){return n!=null;}).sort(function(a,b){return a-b;});
    return mins.length ? {low:mins[0],high:mins[mins.length-1],hotels:mins.length} : null;
  }
  // Flight per traveller plus the room for the stay, for one and for two sharing.
  function tripTotal(farePhp,nightlyPhp,nights) {
    if(!(farePhp>0) || !(nightlyPhp>0) || !(nights>0)) return null;
    return {one:Math.round(farePhp+nightlyPhp*nights),two:Math.round(farePhp*2+nightlyPhp*nights)};
  }
  // A Google Hotels search for exact dates in PHP; it compares the booking
  // sites (Agoda included) for one hotel or a whole place.
  function hotelSearchLink(place,checkIn,checkOut,occupancy) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(checkIn || '') || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut || '') || checkOut<=checkIn || !String(place || '').trim()) return '';
    var settings=occupancy && hotelStaySettings({checkIn:checkIn,checkOut:checkOut,rooms:occupancy.rooms,adults:occupancy.adults});
    return 'https://www.google.com/travel/search?hl=en&gl=ph&curr=PHP&q='+encodeURIComponent(String(place).trim().slice(0,120)+' from '+checkIn+' to '+checkOut+(settings ? ' for '+settings.adults+' adults in '+settings.rooms+' rooms' : ''));
  }
  root.FlightsCore={searchLink:searchLink,select:select,officialUrl:url,evidenceUrl:evidenceUrl,origins:ORIGINS,domestic:DOMESTIC,phpEstimate:phpEstimate,shortlist:shortlist,deadlineLabel:deadlineLabel,
    region:region,economy:economy,dayLabel:dayLabel,tripLabel:tripLabel,board:board,memoryIndex:memoryIndex,priceMemory:priceMemory,
    hotelIndex:hotelIndex,hotelCity:hotelCity,stayQuotes:stayQuotes,typicalNightly:typicalNightly,tripTotal:tripTotal,hotelStaySettings:hotelStaySettings,hotelSearchLink:hotelSearchLink,hotelUrl:tripadvisorUrl};
  if(typeof module!=='undefined' && module.exports)module.exports=root.FlightsCore;
})(typeof globalThis!=='undefined' ? globalThis : this);
