(function(root) {
  'use strict';
  var ORIGINS=['MNL','CEB','CRK'];
  var DOMESTIC={MPH:'Boracay (Caticlan)',ENI:'El Nido',IAO:'Siargao',CEB:'Cebu',TAG:'Bohol',PPS:'Puerto Princesa'};
  var PH=new Set('MNL CEB CRK DVO ILO KLO MPH PPS TAG TAC BCD CGY ZAM GES DGT BXU DRP LGP LAO TUG RXS CYZ CBO DPL PAG SJI IAO SUG USU WNP BSO RZP ENI MBT TBH JOL TWT CYP DTI VRC SFE BQA BPH CRM OMH SGS LWA MXI LBX'.split(' '));
  var DOMAINS=['philippineairlines.com','cathaypacific.com','airasia.com','cebupacificair.com','flyscoot.com','trip.com'];
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
      if(d.campaign) {if(!(d.markets || ['international']).includes(market))return false;}
      else if(market==='international' ? PH.has(d.destination) : !(DOMESTIC[d.destination] || d.userSupplied&&PH.has(d.destination)) || market!=='domestic' && d.destination!==market)return false;
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
      var stay=typeof preferences.stayCost==='function' ? preferences.stayCost(d,nights) : null;
      var hotelTotal=stay && Number.isFinite(stay.total) && stay.total>=0 ? stay.total : null;
      var phpFare=Math.round(peso.amount*100)/100,estimate=Math.round((phpFare+extra+(hotelTotal || 0))*100)/100;
      if(budget>0 && estimate>budget)return;
      eligible.push(Object.assign({},d,{nights:nights,phpFare:phpFare,planningAmount:estimate,extraAllowance:extra,hotelTotal:hotelTotal,hotelName:hotelTotal!=null ? stay.name : '',hotelPricingEnabled:typeof preferences.stayCost==='function'}));
    });
    eligible.sort(function(a,b){return (a.hotelTotal==null)-(b.hotelTotal==null) || a.planningAmount-b.planningAmount || (b.taxesIncluded===true)-(a.taxesIncluded===true) || a.nights-b.nights || a.departureDate.localeCompare(b.departureDate);});
    var unique=new Set(),items=[];
    eligible.forEach(function(d){
      var key=d.destination;
      if(unique.has(key)||items.length>=3)return;unique.add(key);
      var alternatives=eligible.filter(function(other){return other.destination===d.destination && other.id!==d.id;});
      var dateOptions=new Set(alternatives.map(function(other){return other.departureDate+'|'+other.returnDate;}));
      var reason=(d.hotelTotal!=null?'Lowest observed flight + room estimate to ':'Lowest observed return fare to ')+(d.destinationName || d.destination)+' matching '+min+'–'+max+' nights.';
      if(dateOptions.size)reason+=' '+dateOptions.size+' other date '+(dateOptions.size===1?'combination':'combinations')+' observed.';
      var checks=[];
      if(d.taxesIncluded!==true)checks.push('Taxes and surcharges');
      if(!PH.has(d.destination) && d.travelTaxIncluded!==true)checks.push('Philippine travel tax');
      if(d.checkedBaggageIncluded!==true)checks.push(preferences.baggage?'Your checked bag':'Baggage allowance');
      if(!Number.isInteger(d.stops))checks.push('Stops');
      if(d.hotelPricingEnabled && d.hotelTotal==null)checks.push('Hotel cost not included');
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
  function manualQuote(value,id,now) {
    now=now==null?Date.now():Number(new Date(now));value=value || {};
    var airlines={'Cebu Pacific':'https://www.cebupacificair.com/en-PH','AirAsia':'https://www.airasia.com/flights/','Scoot':'https://www.flyscoot.com/','Philippine Airlines':'https://www.philippineairlines.com/'};
    var date=function(s){return /^\d{4}-\d{2}-\d{2}$/.test(s || '')&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;};
    var passengers=Number(value.passengers),total=Number(value.total),checked=Date.parse(value.observedAt),destination=String(value.destination || '').trim().toUpperCase();
    if(!/^[a-f0-9]{20}$/.test(id || '') || !airlines[value.airline] || !ORIGINS.includes(value.origin) || !/^[A-Z]{3}$/.test(destination) || destination===value.origin || !date(value.departureDate) || value.returnDate && (!date(value.returnDate)||value.returnDate<value.departureDate) || !Number.isInteger(passengers)||passengers<1||passengers>9 || !(total>0)||!Number.isFinite(total)||total>1000000 || !Number.isFinite(checked)||checked>now+300000||now-checked>7*86400000)return null;
    var parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(function(p){return [p.type,p.value];}));
    if(value.departureDate<=parts.year+'-'+parts.month+'-'+parts.day)return null;
    var kg=value.baggageKg===''||value.baggageKg==null?null:Number(value.baggageKg);
    if(kg!=null&&(!Number.isFinite(kg)||kg<0||kg>100))return null;
    var link=value.link ? url(value.link) : airlines[value.airline];if(!link)return null;
    return {id:id,kind:'advertised-fare',userSupplied:true,airline:value.airline,origin:value.origin,destination:destination,originName:{MNL:'Manila',CEB:'Cebu',CRK:'Clark'}[value.origin],destinationName:DOMESTIC[destination] || destination,departureDate:value.departureDate,returnDate:value.returnDate || '',tripType:value.returnDate?'round-trip':'one-way',cabin:'Economy',currency:'PHP',amount:Math.round(total/passengers*100)/100,quoteTotal:total,passengers:passengers,baggageKg:kg,
      taxesIncluded:value.taxes==='yes'?true:value.taxes==='no'?false:null,checkedBaggageIncluded:kg==null?null:kg>0,stops:value.stops==='0'?0:null,travelTaxIncluded:null,
      sourceUrl:link,bookingUrl:link,checkedAt:new Date(checked).toISOString(),priceLabel:'PHP '+(Math.round(total/passengers*100)/100),priceBasis:'Economy quote entered by you: PHP '+total+' total for '+passengers+' traveller(s); comparison uses the per-person amount.',fees:value.taxes==='yes'?'You recorded mandatory airline taxes and fees included; other charges need confirmation.':'Mandatory taxes and fees not confirmed included.',baggage:kg==null?'Baggage not recorded.':kg+' kg checked baggage per traveller recorded by you.',connections:value.stops==='0'?'Nonstop recorded by you.':'Stops not recorded.',bookingEnd:'',travelPeriod:'Your recorded travel dates.',airlineSeen:'',terms:'Private user-supplied quote, not independently checked by the scout. Recheck availability, passenger settings and final checkout price.'};
  }
  // The budget airlines the scout names (flights/parse.js budgetAirline). A
  // paired round trip ("Jin Air + Jeju Air") counts when every part is one.
  var BUDGET_AIRLINES=['AirAsia','Cebu Pacific','Scoot','Jetstar','HK Express','Jeju Air','Jin Air','Air Busan','Eastar Jet',"T'way Air",'Air Seoul','VietJet','Tigerair Taiwan','Peach','ZIPAIR','Spring Airlines'];
  function budgetParts(airline) {var parts=String(airline || '').split(' + ');return parts.every(function(p){return BUDGET_AIRLINES.indexOf(p)>=0;}) ? parts : [];}
  function missingBudgetPrices(d,offers,now) {
    now=now==null?Date.now():Number(new Date(now));
    var carriers=PH.has(d.destination)?['Cebu Pacific','AirAsia']:['Cebu Pacific','AirAsia','Scoot'];
    return carriers.filter(function(airline){return !(offers || []).some(function(o){
      var age=now-Date.parse(o.checkedAt || '');
      return o.kind==='advertised-fare' && o.airline===airline && o.origin===d.origin && o.destination===d.destination && o.tripType===d.tripType && o.departureDate===d.departureDate && o.returnDate===d.returnDate && economy(o.cabin) && o.amount>0 && age>=-300000 && age<=26*3600000;
    });});
  }
  var HOTEL_FRESH_HOURS=40;
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
    // The scout reuses a quote for up to 20 hours, and its twice-daily runs
    // can start hours late, so a current quote reaches ~36 hours before the
    // next re-price. Past 40 hours the scout really has missed it.
    var age=(now==null ? Date.now() : new Date(now).getTime())-Date.parse(stay.pricedAt || '');
    var stale=!(age>=-300000 && age<=HOTEL_FRESH_HOURS*3600000);
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
  // Guests are not in the link: Google applies the dates from the query text
  // but ignores "for 4 adults in 2 rooms" (checked 12 Oct 2026; it stays at 2
  // travellers), so the page says what to set there instead.
  function hotelSearchLink(place,checkIn,checkOut) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(checkIn || '') || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut || '') || checkOut<=checkIn || !String(place || '').trim()) return '';
    return 'https://www.google.com/travel/search?hl=en&gl=ph&curr=PHP&q='+encodeURIComponent(String(place).trim().slice(0,120)+' from '+checkIn+' to '+checkOut);
  }
  function guestsLabel(p) {
    var rooms=Number(p && p.rooms) || 1, adults=Number(p && p.adults) || 2;
    return (rooms===1 ? '1 room' : rooms+' rooms')+', '+(adults===1 ? '1 adult' : adults+' adults');
  }
  // One catalog drives UI availability, source articles and location bounds.
  // Bounds are destination search areas, not hotel/venue coordinates.
  var ACTIVITY_DESTINATIONS={
    'Tokyo':{box:['jp',139,35,140.3,36.2],wiki:['Tokyo']},
    'Osaka':{box:['jp',135,34,136,35],wiki:['Osaka']},
    'Fukuoka':{box:['jp',130.15,33.3,130.7,33.85],wiki:['Fukuoka']},
    'Sapporo':{box:['jp',141,42.8,141.7,43.3],wiki:['Sapporo']},
    'Nagoya':{box:['jp',136.6,34.85,137.25,35.4],wiki:['Nagoya']},
    'Okinawa':{box:['jp',127.5,26,128.4,27],wiki:['Okinawa Island','Naha','Okinawa City']},
    'Hiroshima':{box:['jp',132.1,34.1,132.85,34.7],wiki:['Hiroshima']},
    'Seoul':{box:['kr',126.7,37.35,127.25,37.8],wiki:['Seoul']},
    'Incheon':{box:['kr',126.25,37.2,126.9,37.8],wiki:['Incheon']},
    'Busan':{box:['kr',128.8,34.9,129.35,35.45],wiki:['Busan']},
    'Jeju':{box:['kr',126.1,33.1,127,33.6],wiki:['Jeju','Jeju City','Seogwipo']},
    'Hong Kong':{box:['hk',113.7,22,114.6,22.7],wiki:['Hong Kong']},
    'Macau':{box:['mo',113.4,22,113.7,22.3],wiki:['Macau']},
    'Taipei':{box:['tw',121.3,24.8,121.8,25.3],wiki:['Taipei']},
    'Kaohsiung':{box:['tw',120.1,22.4,120.6,22.95],wiki:['Kaohsiung']},
    'Shanghai':{box:['cn',120.9,30.7,122,31.6],wiki:['Shanghai']},
    'Guangzhou':{box:['cn',113,22.7,113.8,23.65],wiki:['Guangzhou']},
    'Singapore':{box:['sg',103.5,1,104.2,1.6],wiki:['Singapore']},
    'Bangkok':{box:['th',100.25,13.45,100.95,14.1],wiki:['Bangkok']},
    'Kuala Lumpur':{box:['my',101.4,2.85,101.9,3.45],wiki:['Kuala Lumpur']},
    'Ho Chi Minh City':{box:['vn',106.35,10.55,107,11.15],wiki:['Ho Chi Minh City']},
    'Hanoi':{box:['vn',105.55,20.75,106.15,21.4],wiki:['Hanoi']},
    'Da Nang':{box:['vn',107.9,15.85,108.4,16.35],wiki:['Da Nang']},
    'Phnom Penh':{box:['kh',104.65,11.3,105.15,11.85],wiki:['Phnom Penh']},
    'Sydney':{box:['au',150.6,-34.2,151.5,-33.4],wiki:['Sydney']},
    'Melbourne':{box:['au',144.5,-38.3,145.5,-37.4],wiki:['Melbourne']},
    'Brisbane':{box:['au',152.7,-27.85,153.4,-27.15],wiki:['Brisbane']},
    'Gold Coast':{box:['au',153,-28.35,153.6,-27.6],wiki:['Gold Coast']},
    'Perth':{box:['au',115.5,-32.5,116.2,-31.5],wiki:['Perth']},
    'Adelaide':{box:['au',138.3,-35.2,138.9,-34.6],wiki:['Adelaide']},
    'Hobart':{box:['au',147,-43.1,147.6,-42.6],wiki:['Hobart']},
    'Auckland':{box:['nz',174.4,-37.15,175.1,-36.5],wiki:['Auckland']},
    'Los Angeles':{box:['us',-118.8,33.6,-117.7,34.4],wiki:['Los Angeles']},
    'San Francisco':{box:['us',-122.6,37.5,-122.3,37.9],wiki:['San Francisco']},
    'San Jose':{box:['us',-122.15,37.05,-121.5,37.6],wiki:['San Jose (California)']},
    'Sacramento':{box:['us',-121.8,38.3,-121.1,38.9],wiki:['Sacramento']},
    'San Diego':{box:['us',-117.4,32.5,-116.8,33.1],wiki:['San Diego']},
    'Las Vegas':{box:['us',-115.5,35.9,-114.9,36.5],wiki:['Las Vegas']},
    'Phoenix':{box:['us',-112.6,33,-111.5,34],wiki:['Phoenix']},
    'Honolulu':{box:['us',-158.3,21.2,-157.65,21.75],wiki:['Honolulu']},
    'Seattle':{box:['us',-122.6,47.2,-122,47.9],wiki:['Seattle']},
    'Portland':{box:['us',-123.1,45.2,-122.3,45.8],wiki:['Portland (Oregon)']},
    'New York':{box:['us',-74.35,40.45,-73.55,41],wiki:['New York City']},
    'Boston':{box:['us',-71.35,42.1,-70.8,42.6],wiki:['Boston']},
    'Washington, D.C.':{box:['us',-77.5,38.6,-76.7,39.2],wiki:['Washington, D.C.']},
    'Chicago':{box:['us',-88,41.5,-87.4,42.2],wiki:['Chicago']},
    'Dallas':{box:['us',-97.3,32.4,-96.4,33.3],wiki:['Dallas']},
    'Houston':{box:['us',-95.9,29.3,-94.9,30.3],wiki:['Houston']},
    'San Antonio':{box:['us',-99,29.1,-98.1,29.8],wiki:['San Antonio']},
    'Atlanta':{box:['us',-84.8,33.4,-84,34.1],wiki:['Atlanta']},
    'Orlando':{box:['us',-81.8,28.1,-81,28.9],wiki:['Orlando']},
    'Raleigh':{box:['us',-79,35.5,-78.3,36.15],wiki:['Raleigh']},
    'Vancouver':{box:['ca',-123.4,49,-122.7,49.5],wiki:['Vancouver']},
    'Toronto':{box:['ca',-79.95,43.4,-79,44.05],wiki:['Toronto']},
    'London':{box:['gb',-0.55,51.25,0.35,51.8],wiki:['London']},
    'Manchester':{box:['gb',-2.6,53.2,-1.9,53.75],wiki:['Manchester']},
    'Boracay':{box:['ph',121.8,11.8,122.1,12.1],wiki:['Boracay']},
    'El Nido':{box:['ph',119,10.8,120,11.7],wiki:['El Nido']},
    'Siargao':{box:['ph',125.7,9.5,126.4,10.2],wiki:['Siargao']},
    'Cebu':{box:['ph',123,9,125,12],wiki:['Cebu City']},
    'Bohol':{box:['ph',123,9,125,11],wiki:['Bohol','Panglao Island','Tagbilaran']},
    'Puerto Princesa':{box:['ph',118,9,120,11],wiki:['Puerto Princesa']},
    'Manila':{box:['ph',120,14,122,16],wiki:['Manila']},
    'Makati':{box:['ph',120,14,122,16],wiki:['Makati']},
    'Pasay':{box:['ph',120,14,122,16],wiki:['Pasay']}
  };
  var ACTIVITY_CITIES=Object.keys(ACTIVITY_DESTINATIONS);
  var ACTIVITY_ALIASES={macao:'Macau', 'cebu city':'Cebu','saigon':'Ho Chi Minh City','ho chi minh':'Ho Chi Minh City','new york city':'New York','nyc':'New York','washington dc':'Washington, D.C.','washington d.c.':'Washington, D.C.','washington, dc':'Washington, D.C.','dc':'Washington, D.C.','san jose (california)':'San Jose','san jose, california':'San Jose','portland (oregon)':'Portland','portland, oregon':'Portland','jeju island':'Jeju','okinawa island':'Okinawa'};
  function activityCity(name) {
    var n=String(name || '').trim().toLowerCase();
    if(ACTIVITY_ALIASES[n]) return ACTIVITY_ALIASES[n];
    for(var i=0;i<ACTIVITY_CITIES.length;i++) if(ACTIVITY_CITIES[i].toLowerCase()===n) return ACTIVITY_CITIES[i];
    return null;
  }
  // Entry rules for an ordinary Philippine passport, checked 15 Oct 2026
  // against current reporting (Taiwan's visa-free scheme renewed to 31 Jul
  // 2027; Thailand cut to 30 days from 15 Sep 2026; Korea visa-free only on
  // Jeju via a direct flight; Japan's eVisa only for designated package
  // tours). Rules change: the page dates them and says to confirm. lead is
  // Daybook's planning allowance in days before departure, not an official
  // processing time. Countries not listed get no claim, only a link.
  var ENTRY_CHECKED='2026-10-15';
  var ENTRY_PH={
    hk:{name:'Hong Kong',free:14},mo:{name:'Macau',free:30,card:'arrival card'},tw:{name:'Taiwan',free:14,until:'2027-07-31'},
    sg:{name:'Singapore',free:30,card:'SG Arrival Card within 3 days before arrival'},my:{name:'Malaysia',free:30,card:'Malaysia Digital Arrival Card within 3 days before arrival'},
    th:{name:'Thailand',free:30,card:'Thailand Digital Arrival Card before arrival'},vn:{name:'Vietnam',free:21,card:'digital arrival card at some airports'},
    id:{name:'Indonesia',free:30},kh:{name:'Cambodia',free:21},bn:{name:'Brunei',free:14},mm:{name:'Myanmar',free:14},
    jp:{name:'Japan',visa:'tourist visa through an accredited agency or visa centre',lead:21},
    kr:{name:'South Korea',visa:'C-3-9 tourist visa through KVAC',lead:28},
    'kr-jeju':{name:'Jeju',free:30,note:'Jeju only, arriving on a direct international flight to Jeju; no mainland travel'},
    cn:{name:'China',visa:'tourist (L) visa from the Chinese embassy or a consulate',lead:21},
    au:{name:'Australia',visa:'visitor visa (subclass 600), applied for online',lead:42},
    nz:{name:'New Zealand',visa:'visitor visa (the NZeTA is not open to Philippine passports)',lead:42},
    us:{name:'the US',visa:'B1/B2 visa with an embassy interview; check the current interview wait',lead:90},
    ca:{name:'Canada',visa:'visitor visa, or an eTA if you held a Canadian visa in the last 10 years or hold a valid US visa',lead:42},
    gb:{name:'the UK',visa:'Standard Visitor visa',lead:42},
    schengen:{name:'the Schengen area',visa:'Schengen short-stay visa',lead:42}
  };
  var AIRPORT_COUNTRY={};
  [['hk','HKG'],['mo','MFM'],['tw','TPE TSA KHH RMQ'],['cn','PVG SHA PEK PKX CAN SZX XMN JJN WUH CTU CKG'],['jp','NRT HND TYO KIX ITM FUK NGO CTS ASJ KMI NGS TKS HIJ OKA AXT KOJ SDJ OIT'],
   ['kr','ICN GMP PUS'],['kr-jeju','CJU'],['sg','SIN'],['vn','SGN HAN DAD CXR PQC'],['my','KUL BKI PEN'],['th','BKK DMK HKT CNX'],['id','CGK DPS'],['kh','PNH REP KTI'],['mm','RGN'],['bn','BWN'],
   ['au','SYD MEL BNE PER ADL CNS CBR OOL DRW'],['nz','AKL CHC WLG'],['us','LAX SFO SJC SMF SAN LAS PHX HNL SEA PDX JFK EWR BOS DCA IAD ORD DFW IAH SAT ATL MCO RDU PHL'],
   ['ca','YYZ YVR YEG YYC YUL YOW YWG'],['gb','LHR LGW MAN'],['schengen','CDG FRA AMS FCO MAD ZRH']].forEach(function(r){r[1].split(' ').forEach(function(a){AIRPORT_COUNTRY[a]=r[0];});});
  function addDays(iso,n){return new Date(Date.parse(iso+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);}
  // One line for a destination airport and trip: visa-free and for how long
  // (flagged when the stay is longer), or the visa and the date to apply by
  // (flagged when that date has passed). Null when the country is not listed.
  function entryCheck(code,depart,ret,today) {
    var key=AIRPORT_COUNTRY[String(code || '').toUpperCase()],r=key && ENTRY_PH[key];
    if(!r) return null;
    var days=depart && ret ? Math.round((Date.parse(ret)-Date.parse(depart))/86400000)+1 : null;
    if(r.free) {
      var over=days!=null && days>r.free,ended=r.until && depart && depart>r.until;
      return {country:key,name:r.name,kind:'free',flag:!!(over || ended),
        text:r.name+': visa-free up to '+r.free+' days'+(r.note ? ' ('+r.note+')' : '')+(r.card ? '; '+r.card : '')+
          (ended ? '. The visa-free scheme runs to '+dayLabel(r.until)+', before this trip; check whether it was renewed' : over ? '. This trip is '+days+' days, longer than that' : '')};
    }
    var by=depart ? addDays(depart,-r.lead) : '',late=by && today && by<today;
    return {country:key,name:r.name,kind:'visa',flag:!!late,applyBy:by,
      text:r.name+': visa needed, '+r.visa+(by ? '. '+(late ? 'Allowing '+Math.round(r.lead/7)+' weeks, the time to apply ('+dayLabel(by)+') has passed; check processing now' : 'Apply by '+dayLabel(by)+' (Daybook allows '+Math.round(r.lead/7)+' weeks)') : '')};
  }
  // A fare watch: a city (its airports), a departure window, a trip length and
  // a PHP target per traveller. The best fresh economy return the scout saw
  // that fits, with its PHP estimate, and whether it is at or under target.
  // Shared by the page and the morning push, so both say the same thing.
  function cleanWatch(w) {
    if(!w || typeof w!=='object') return null;
    var airports=(Array.isArray(w.airports) ? w.airports : []).filter(function(a){return /^[A-Z]{3}$/.test(a);}).slice(0,4);
    var iso=function(v){return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '';};
    var n=function(v,lo,hi,dflt){v=Number(v);return Number.isFinite(v) && v>=lo && v<=hi ? Math.round(v) : dflt;};
    if(!airports.length || !iso(w.from) || !iso(w.to) || w.to<w.from) return null;
    var c={city:String(w.city || airports[0]).slice(0,60),airports:airports,origin:/^(MNL|CEB|CRK)$/.test(w.origin || '') ? w.origin : 'All',from:w.from,to:w.to,
      minNights:n(w.minNights,1,60,3),maxNights:n(w.maxNights,1,90,10),target:n(w.target,500,1000000,0),addedAt:String(w.addedAt || '').slice(0,30)};
    if(c.maxNights<c.minNights) c.maxNights=c.minNights;
    return c.target ? c : null;
  }
  function fareWatch(watch,data,fx,now) {
    var w=cleanWatch(watch);if(!w) return null;
    var market=DOMESTIC[w.airports[0]] ? 'domestic' : 'international';
    var rows=select(data,{market:market,origin:w.origin,cabin:'economy',tripType:'round-trip',from:w.from,to:w.to},now).filter(function(d){
      var nights=Math.round((Date.parse(d.returnDate)-Date.parse(d.departureDate))/86400000);
      return d.kind==='advertised-fare' && !d.stale && !d.expired && w.airports.indexOf(d.destination)>=0 && nights>=w.minNights && nights<=w.maxNights;
    }).map(function(d){var p=d.currency==='PHP' ? {amount:d.amount,stale:false} : phpEstimate(d,fx,now);return p && !p.stale ? {fare:d,php:Math.round(p.amount)} : null;})
      .filter(Boolean).sort(function(a,b){return a.php-b.php || a.fare.departureDate.localeCompare(b.fare.departureDate);});
    var best=rows[0] || null;
    return {watch:w,best:best,matches:rows.length,hit:!!(best && best.php<=w.target)};
  }
  root.FlightsCore={budgetAirlines:BUDGET_AIRLINES,budgetParts:budgetParts,cleanWatch:cleanWatch,fareWatch:fareWatch,entryCheck:entryCheck,entryChecked:ENTRY_CHECKED,activityDestinations:ACTIVITY_DESTINATIONS,activityCities:ACTIVITY_CITIES,activityCity:activityCity,searchLink:searchLink,manualQuote:manualQuote,missingBudgetPrices:missingBudgetPrices,select:select,officialUrl:url,evidenceUrl:evidenceUrl,origins:ORIGINS,domestic:DOMESTIC,phpEstimate:phpEstimate,shortlist:shortlist,deadlineLabel:deadlineLabel,
    region:region,economy:economy,dayLabel:dayLabel,tripLabel:tripLabel,board:board,memoryIndex:memoryIndex,priceMemory:priceMemory,
    hotelIndex:hotelIndex,hotelCity:hotelCity,stayQuotes:stayQuotes,typicalNightly:typicalNightly,tripTotal:tripTotal,hotelStaySettings:hotelStaySettings,hotelSearchLink:hotelSearchLink,guestsLabel:guestsLabel,hotelFreshHours:HOTEL_FRESH_HOURS,hotelUrl:tripadvisorUrl};
  if(typeof module!=='undefined' && module.exports)module.exports=root.FlightsCore;
})(typeof globalThis!=='undefined' ? globalThis : this);
