(function(root) {
  'use strict';
  var state={token:0,data:null,fx:null,memory:null,cal:null,calError:false,saved:{},byId:{},saving:false,prefsUnavailable:false,remembered:false};
  // Trip settings and filters are a per-device convenience, not account data.
  // The destination text and dates are left out: a stale one would hide fares.
  var REMEMBER_KEY='daybook-flights-settings-v1';
  var REMEMBER={'flights-market':'international','flights-origin':'All','flights-cabin':'economy','flights-trip':'All','flights-budget':'','flights-min-nights':'3','flights-max-nights':'10','flights-extra':'0','flights-baggage':false,'flights-direct':false};
  var el=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
  function storage() { try { return root.localStorage || null; } catch (_) { return null; } }
  function recall() {
    var saved={};
    try { saved=JSON.parse(storage() && storage().getItem(REMEMBER_KEY) || '{}') || {}; } catch (_) { saved={}; }
    Object.keys(REMEMBER).forEach(function(id) {
      var node=el(id), value=saved[id];
      if(!node || value===undefined) return;
      if(typeof REMEMBER[id]==='boolean') { node.checked=value===true; return; }
      value=String(value);
      // A select keeps its default when the stored option no longer exists.
      if(node.options && !Array.prototype.some.call(node.options,function(o){return o.value===value;})) return;
      if(/^flights-(budget|min-nights|max-nights|extra)$/.test(id) && value!=='' && !(Number(value)>=0)) return;
      node.value=value;
    });
  }
  function remember() {
    var values={};
    Object.keys(REMEMBER).forEach(function(id){var node=el(id);if(node)values[id]=typeof REMEMBER[id]==='boolean' ? !!node.checked : String(node.value==null ? '' : node.value);});
    try { if(storage()) storage().setItem(REMEMBER_KEY,JSON.stringify(values)); } catch (_) { /* Private windows can refuse storage; filters still work. */ }
  }
  root.resetFlightSettings=function() {
    Object.keys(REMEMBER).forEach(function(id){var node=el(id);if(!node)return;if(typeof REMEMBER[id]==='boolean')node.checked=REMEMBER[id];else node.value=REMEMBER[id];});
    ['flights-destination','flights-from','flights-to'].forEach(function(id){if(el(id))el(id).value='';});
    try { if(storage()) storage().removeItem(REMEMBER_KEY); } catch (_) {}
    root.renderFlightOffers();
    if(el('flights-status')) el('flights-status').textContent='Filters and trip settings reset to the defaults. '+el('flights-status').textContent;
  };
  function stamp(value) {
    var t=Date.parse(value || '');
    return Number.isFinite(t) ? new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(t))+' PHT' : 'unknown';
  }
  function changeLabel(d) {
    var c=d.change;
    if(!c)return '';
    if(c.status==='dropped'||c.status==='rose')return (c.status==='dropped'?'Price down ':'Price up ')+d.currency+' '+Math.abs(c.delta).toLocaleString('en-PH')+' ('+Math.abs(c.percent)+'%) for these same dates since '+stamp(c.since);
    return c.status==='new' ? 'Newly observed in this scout' : '';
  }
  function memoryText(d,mem) {
    if(!mem) return '';
    var F=root.FlightsCore, route=d.origin+' → '+d.destination;
    if(!mem.earlierDays) return 'No earlier fare recorded for '+route+' (price memory since '+F.dayLabel(mem.since)+').';
    var span=mem.earlierDays+' earlier scout '+(mem.earlierDays===1?'day':'days')+' since '+F.dayLabel(mem.since);
    var low=mem.currency+' '+mem.low.toLocaleString('en-PH')+' on '+F.dayLabel(mem.lowDay);
    if(d.stale || d.expired) return route+': lowest seen '+low+' ('+span+'); this '+(d.expired?'expired':'old')+' quote is '+(mem.delta<0 ? mem.currency+' '+Math.abs(mem.delta).toLocaleString('en-PH')+' below it' : mem.delta>0 ? mem.currency+' '+mem.delta.toLocaleString('en-PH')+' above it' : 'equal to it')+'; recheck before comparing current fares.';
    if(mem.newLow) return 'New low for '+route+': below '+low+' ('+span+').';
    return route+': lowest seen '+low+' ('+span+')'+(mem.delta>0 ? '; this fare is '+mem.currency+' '+mem.delta.toLocaleString('en-PH')+' above it.' : '; this fare matches it.');
  }
  function slug(v) { return String(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
  function money(d) { return d.currency+' '+d.amount.toLocaleString('en-PH',{maximumFractionDigits:2}); }
  function pesoText(d) { return d.php!=null ? '≈ PHP '+d.php.toLocaleString('en-PH') : ''; }
  function seen(d) {
    var m=String(d.airlineSeen || '').match(/^Seen:?\s*(.+?)\s+ago$/i);
    return m ? 'airline saw it '+m[1]+' before the scout' : d.airlineSeen ? 'airline: '+d.airlineSeen : '';
  }
  function saveButton(d,label) {
    return '<button type="button" class="tool-chip" '+(state.saving || state.prefsUnavailable ? 'disabled ' : '')+'onclick="toggleFlightSave(\''+esc(d.id)+'\')">'+(d.saved?'Remove saved':label)+'</button>';
  }
  // One observed date pair inside a destination row.
  function sampleRow(d) {
    var conversion=root.FlightsCore.phpEstimate(d,state.fx);
    var exchange=conversion ? '<p><b>PHP estimate:</b> 1 '+esc(d.currency)+' = PHP '+esc(conversion.rate)+' · PH market rate as of '+esc(conversion.asOf)+(conversion.stale?' · older rate':'')+'. Bank/card rates and fees may differ.</p>' : '';
    var F=root.FlightsCore, flag=d.expired ? 'Travel date has passed · saved reference only' : d.stale ? 'Old quote · recheck with the airline' : '', change=changeLabel(d);
    return '<div id="flight-offer-'+esc(d.id)+'" class="flight-sample"><div><b>'+esc(F.tripLabel(d))+'</b>'+
      '<div class="flights-note">'+esc([d.origin+' → '+d.destination,d.airline,d.cabin || 'Cabin not stated',seen(d)].filter(Boolean).join(' · '))+'</div>'+
      (flag ? '<div class="flight-flag">'+esc(flag)+'</div>' : '')+(change ? '<div class="flight-flag">'+esc(change)+'</div>' : '')+'</div>'+
      '<div class="flight-sample-price"><b>'+esc(pesoText(d) || money(d))+'</b><div class="flights-note">'+esc(pesoText(d) ? money(d)+' from' : d.currency!=='PHP' ? 'PHP estimate unavailable' : 'from')+'</div></div>'+
      '<details class="radar-forecast" style="grid-column:1/-1"><summary>Fare details &amp; restrictions</summary>'+exchange+
      '<p><b>Source checked:</b> '+esc(stamp(d.checkedAt))+'</p><p>'+esc(d.priceBasis || 'Advertised fare; availability and final total need confirmation.')+'</p>'+
      '<p><b>Travel:</b> '+esc(d.travelPeriod || 'Exact sample dates shown; other dates may cost more.')+'</p>'+
      '<p><b>Taxes:</b> '+esc(d.fees || 'Confirm taxes and fees on the airline.')+'</p><p><b>Baggage:</b> '+esc(d.baggage || 'Confirm baggage allowance on the airline.')+'</p>'+
      '<p><b>Connections:</b> '+esc(d.connections || 'Confirm stops and connection times on the airline.')+'</p><p>'+esc(d.terms || 'Confirm fare conditions, changes and refunds on the airline.')+'</p></details>'+
      '<div class="flight-actions"><a href="'+esc(F.officialUrl(d.bookingUrl))+'" target="_blank" rel="noopener noreferrer">Check on airline ↗</a>'+saveButton(d,'Save')+'</div></div>';
  }
  function cityRow(city) {
    var b=city.best, notes={}, drop=city.samples.some(function(d){return d.change && d.change.status==='dropped';}), memory=memoryText(b,city.memory);
    city.samples.forEach(function(d){if(d.fees)notes[d.airline]=d.fees;});
    return '<details class="flight-city" id="flight-city-'+esc(slug(city.name+'-'+city.comparison))+'"><summary>'+
      '<span class="flight-city-line"><span class="flight-city-name">'+esc(city.name)+' <span class="flights-note">'+esc(city.codes.join(' · ')+' · '+city.comparison)+'</span></span>'+
      '<span class="flight-city-price">'+esc(pesoText(b) || money(b))+'</span></span>'+
      '<span class="flight-city-line"><span class="flight-city-when">'+esc(root.FlightsCore.tripLabel(b))+'</span>'+
      '<span class="flights-note">'+esc((pesoText(b) ? money(b)+' · ' : '')+city.airlines.join(', ')+' · '+city.samples.length+(city.samples.length===1?' fare':' fares'))+(city.memory && city.memory.newLow ? ' · <b class="flight-down">new low</b>' : drop ? ' · <b class="flight-down">price down</b>' : '')+'</span></span></summary>'+
      (memory ? '<p class="flights-note flight-memory">'+esc(memory)+'</p>' : '')+
      '<div class="flight-samples">'+city.samples.map(sampleRow).join('')+'</div>'+
      '<p class="flights-note">'+Object.keys(notes).map(function(a){return esc(a)+': '+esc(notes[a]);}).join('<br>')+(Object.keys(notes).length ? '<br>' : '')+
      'Exact sample dates shown; other dates may cost more. Displayed fares may no longer be available; confirm baggage, stops and fare rules before booking.</p></details>';
  }
  function boardHtml(regions,fares) {
    var cities=new Set(regions.flatMap(function(r){return r.cities.map(function(c){return c.name;});})).size;
    return '<details id="flights-all" class="flight-all" open><summary>All destinations · '+cities+(cities===1?' city':' cities')+' · '+fares+(fares===1?' fare':' fares')+' · cheapest first in each region</summary>'+
      regions.map(function(r){return '<div class="flights-group">'+esc(r.name)+' · '+esc(r.comparison)+' · from '+esc(pesoText(r.best) || money(r.best))+'</div><div class="flight-board">'+r.cities.map(cityRow).join('')+'</div>';}).join('')+'</details>';
  }
  function card(d,featured) {
    var warning=d.expired ? (d.campaign?'Booking period ended':'Travel date has passed')+' · saved reference only' : d.stale ? 'Old quote · recheck with the airline' : d.campaign ? 'Base fare only · fees extra · selected routes and seats' : d.kind==='promo' ? 'Campaign listed · dates and final fare unverified' : 'Advertised fare · availability unconfirmed';
    var price=d.kind==='promo' ? d.discount || d.title || 'Discount campaign' : d.currency+' '+d.amount.toLocaleString('en-PH',{maximumFractionDigits:2})+' from';
    var peso=root.FlightsCore.phpEstimate(d,state.fx);
    if(peso) price+=' · ≈ PHP '+peso.amount.toLocaleString('en-PH',{maximumFractionDigits:0})+(peso.stale?' (older rate)':'');
    var conversion=!peso && d.kind==='advertised-fare' && d.currency!=='PHP' ? '<div class="flights-note">PHP estimate unavailable</div>' : '';
    var exchange=peso ? '<p><b>PHP estimate:</b> 1 '+esc(d.currency)+' = PHP '+esc(peso.rate)+' · PH market rate as of '+esc(peso.asOf)+(peso.stale?' · older rate':'')+'. Bank/card rates and fees may differ.</p>' : '';
    var advice=d.recommendation ? '<p class="flight-reason">'+esc(d.recommendation)+(memoryText(d,d.memory) ? ' '+esc(memoryText(d,d.memory)) : '')+'</p>'+
      (d.extraAllowance>0 ? '<div>≈ PHP '+esc(d.planningAmount.toLocaleString('en-PH',{maximumFractionDigits:0}))+' with your extra-cost allowance</div>' : '')+
      '<div class="flight-flag">Still to confirm: '+esc(d.costChecks.join(' · '))+'</div>'+
      (d.cityFares>1 ? '<button class="tool-chip" type="button" onclick="showFlightAlternative(\''+esc(d.id)+'\')">All '+esc(d.cityFares)+' fares to '+esc(d.destinationName || d.destination)+'</button>' : '') : '';
    return '<article id="flight-'+(featured?'trip-':'offer-')+esc(d.id)+'" class="flight-card"><div class="flights-note">'+esc(d.airline)+' · '+esc(d.tripType==='not-stated'?'Journey type not stated':d.tripType)+' · '+esc(d.cabin || 'Cabin not stated')+'</div>'+
      '<div class="flight-route">'+esc(d.campaign ? d.title : (d.originName || d.origin)+' → '+(d.destinationName || d.destination))+'</div>'+
      '<div class="flights-note">'+esc(d.campaign ? d.originName+' · check eligible routes on airline' : d.origin+' → '+d.destination)+'</div><div class="flight-price">'+esc(price)+'</div>'+conversion+
      '<div>'+esc(d.campaign ? 'Book '+root.FlightsCore.dayLabel(d.bookingStart)+' → '+root.FlightsCore.dayLabel(d.bookingEnd) : d.departureDate ? root.FlightsCore.tripLabel(d) : 'Flexible dates · airline terms need checking')+'</div>'+
      (d.campaign ? '<div>Travel '+esc(root.FlightsCore.dayLabel(d.travelStart))+' → '+esc(root.FlightsCore.dayLabel(d.travelEnd))+'</div>' : '')+
      '<div class="flight-flag">'+esc(warning)+'</div>'+
      (root.FlightsCore.deadlineLabel(d) ? '<div class="flight-flag"><b>'+esc(root.FlightsCore.deadlineLabel(d))+'</b></div>' : '')+
      (changeLabel(d) ? '<div class="flight-flag">'+esc(changeLabel(d))+'</div>' : '')+advice+
      '<details class="radar-forecast"><summary>Fare details &amp; restrictions</summary>'+
        exchange+'<p>'+esc(d.priceBasis)+'</p>'+(d.kind==='promo' ? '<p><b>Booking deadline:</b> '+esc(d.bookingEnd || 'Not published in the extracted offer.')+'</p>' : '')+
        '<p><b>Travel:</b> '+esc(d.travelPeriod)+'</p><p><b>Taxes:</b> '+esc(d.fees)+'</p>'+
        '<p><b>Baggage:</b> '+esc(d.baggage)+'</p><p><b>Connections:</b> '+esc(d.connections)+'</p><p>'+esc(d.terms)+'</p></details>'+
      '<div class="flights-note">Source checked '+esc(stamp(d.checkedAt))+(seen(d) ? '<br>'+esc(seen(d).charAt(0).toUpperCase()+seen(d).slice(1)) : '')+'</div>'+
      (d.campaign ? '<div class="flights-note">Reported announcement · '+(d.evidenceStatus!=='unavailable' && root.FlightsCore.evidenceUrl(d.evidenceUrl) ? '<a href="'+esc(root.FlightsCore.evidenceUrl(d.evidenceUrl))+'" target="_blank" rel="noopener noreferrer">'+esc(d.publisher)+' ↗</a>' : esc(d.publisher)+' · publisher link unavailable; sale terms shown above')+' · route seats not verified</div>' : '')+
      '<div class="flight-actions"><a href="'+esc(root.FlightsCore.officialUrl(d.bookingUrl))+'" target="_blank" rel="noopener noreferrer">Check fare on airline ↗</a>'+
      saveButton(d,'Save deal')+'</div></article>';
  }
  // Your time off, from the Calendar's leave and holidays, with the scouted
  // fares that fit, exact-date searches, clashes, and poker series abroad.
  var ORIGIN_CITY={MNL:'Manila',CEB:'Cebu',CRK:'Clark'};
  function timeOffHtml(all,filters) {
    var K=root.DaybookCalendarCore,F=root.FlightsCore;
    if(!K || typeof K.offWindows!=='function')return '';
    if(state.calError)return '<div class="flights-group">Your time off · trips abroad</div><p class="flights-note">Your calendar could not load, so your leave windows are not shown. Reload to try again.</p>';
    if(!state.cal)return '';
    var today=K.pht().day,windows=K.offWindows(state.cal,today),events=K.build(state.cal),asOf=state.data && state.data.asOf;
    var intl=F.select({offers:all},Object.assign({},filters,{market:'international',destination:'',from:'',to:'',tripType:'All',savedOnly:false}))
      .filter(function(d){return d.kind==='advertised-fare' && !d.stale && !d.expired;})
      .map(function(d){var p=d.currency==='PHP'?{amount:d.amount}:F.phpEstimate(d,state.fx);return Object.assign({},d,{php:p && !p.stale?Math.round(p.amount):null});});
    var byPrice=function(a,b){return (a.php==null)-(b.php==null) || (a.php!=null ? a.php-b.php : a.amount-b.amount) || a.departureDate.localeCompare(b.departureDate);};
    var from=ORIGIN_CITY[filters.origin] || 'Manila';
    // Exact-date searches for the cheapest cities the scout currently sees,
    // by PHP estimate, or by the advertised amount when no rate is available.
    var cheapest={};intl.forEach(function(d){var n=d.destinationName || d.destination;if(!cheapest[n] || byPrice(d,cheapest[n])<0)cheapest[n]=d;});
    var top=Object.keys(cheapest).sort(function(a,b){return byPrice(cheapest[a],cheapest[b]) || (cheapest[a].amount-cheapest[b].amount);}).slice(0,6);
    var span=function(s,e){return F.dayLabel(s)+(e && e!==s?' – '+F.dayLabel(e):'');};
    // A fare that fits the dates can still be a peak-season price, so a much
    // cheaper sample to the same city on other dates is shown beside it.
    var regionLow={};intl.forEach(function(d){var r=F.region(d.destination).name;if(d.php!=null && (!regionLow[r] || d.php<regionLow[r].php))regionLow[r]=d;});
    var context=function(d){
      if(d.php==null)return '';
      var city=cheapest[d.destinationName || d.destination],region=F.region(d.destination),low=regionLow[region.name];
      if(city && city.id!==d.id && city.php!=null && d.php>city.php*1.3)return ' · other dates from ≈ PHP '+city.php.toLocaleString('en-PH');
      if(low && low.id!==d.id && d.php>low.php*1.5)return ' · '+region.name+' from ≈ PHP '+low.php.toLocaleString('en-PH')+' on other dates';
      return '';
    };
    var fareRow=function(d){var mem=F.priceMemory(d,state.memory,asOf);
      return '<li><b>'+esc(d.destinationName || d.destination)+'</b> · '+esc(F.tripLabel(d))+' · '+esc(d.php!=null?'≈ PHP '+d.php.toLocaleString('en-PH'):d.currency+' '+d.amount.toLocaleString('en-PH'))+' · '+esc(d.airline)+esc(context(d))+
      (mem && mem.newLow?' · <b class="flight-down">new low</b>':'')+' · <a href="'+esc(F.officialUrl(d.bookingUrl))+'" target="_blank" rel="noopener noreferrer">airline ↗</a></li>';};
    var links=function(cities,s,e){return cities.map(function(c){var u=F.searchLink(from,c,s,e);return u?'<a class="tool-chip" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(c)+' ↗</a>':'';}).join('');};
    var cards=windows.slice(0,3).map(function(w) {
      var fits=intl.filter(function(d){return d.departureDate>=w.start && d.returnDate && d.returnDate<=w.end;}).sort(byPrice);
      var clashes=events.filter(function(e){return e.kind!=='allday' && !e.done && e.start<=w.end && e.end>=w.start;});
      return '<div class="timeoff"><div class="timeoff-head">'+esc(span(w.start,w.end))+'</div>'+
        '<div class="flights-note">'+w.days+' days off for '+w.leave+' leave '+(w.leave===1?'day':'days')+(w.holidays.length?' · includes '+esc(w.holidays.join(', ')):'')+' · back at work '+esc(F.dayLabel(w.back))+'</div>'+
        clashes.map(function(e){return '<div class="flight-flag">Overlaps '+(e.kind==='poker'?'♠ ':'')+esc(e.title)+' ('+esc(span(e.start,e.end))+')</div>';}).join('')+
        (fits.length?'<div class="flights-note">Scouted fares inside these dates</div><ul class="timeoff-fares">'+fits.slice(0,4).map(fareRow).join('')+'</ul>'+(fits.length>4?'<div class="flights-note">'+(fits.length-4)+' more under All destinations.</div>':'')
          :'<div class="flights-note">No scouted fare fits these dates; airlines publish their own sample dates.</div>')+
        '<div class="flights-note">Live prices for exact dates, budget airlines included:</div><div class="timeoff-links">'+links(top,w.start,w.end)+
        '<form class="timeoff-city" onsubmit="event.preventDefault();flightsOpenSearch(this,\''+esc(w.start)+'\',\''+esc(w.end)+'\')"><input name="city" maxlength="60" placeholder="Any city, e.g. Tokyo" aria-label="Search another city for these dates"><button class="tool-chip" type="submit">Search ↗</button></form></div></div>';
    });
    var trips=events.filter(function(e){return e.kind==='poker' && e.end>=today && K.pokerCity(e.title);}).slice(0,4).map(function(e) {
      var place=K.pokerCity(e.title),need=K.leaveNeeded(e.start,e.end,windows);
      var near=intl.filter(function(d){return place.airports.indexOf(d.destination)>=0 && d.departureDate>=K.offset(e.start,-3) && d.departureDate<=e.end;}).sort(byPrice);
      return '<div class="timeoff timeoff-poker"><div class="timeoff-head">♠ '+esc(e.title)+'</div><div class="flights-note">'+esc(span(e.start,e.end))+' · '+esc(place.city)+' · '+
        (need?need+' weekday'+(need===1?'':'s')+' outside your time off':'inside your time off')+'</div>'+
        (near.length?'<ul class="timeoff-fares">'+near.slice(0,3).map(fareRow).join('')+'</ul>':'<div class="flights-note">No scouted fare to '+esc(place.city)+' around these dates.</div>')+
        '<div class="timeoff-links">'+links([place.city],K.offset(e.start,-1),e.end)+'</div></div>';
    });
    var pokerNote=trips.length?'':'<p class="flights-note">Overseas poker: none on your calendar. Add a series with its city in the title (for example "APT Championship Taipei") to Google Calendar or Daybook’s Calendar, and flights to it appear here.</p>';
    if(!cards.length && !trips.length)return '<div class="flights-group">Your time off · trips abroad</div><p class="flights-note">No upcoming leave on your calendar. Leave synced from Zoho People, or an event with “leave” in its title, shows here with the fares that fit.</p>'+pokerNote;
    return '<div class="flights-group">Your time off · trips abroad</div><div class="timeoff-grid">'+cards.join('')+trips.join('')+'</div>'+pokerNote+
      '<p class="flights-note">Search links open Google Flights in PHP for the whole window; change the dates there. Daybook does not price those dates itself.</p>';
  }
  // The any-city box on a time-off window: a Google Flights search for those dates.
  root.flightsOpenSearch=function(form,start,end) {
    var city=form && form.city ? String(form.city.value || '').trim().slice(0,60) : '';
    var origin=el('flights-origin') ? el('flights-origin').value : 'All';
    var url=city ? root.FlightsCore.searchLink(ORIGIN_CITY[origin] || 'Manila',city,start,end) : '';
    if(url && typeof root.open==='function')root.open(url,'_blank','noopener');
    return url;
  };
  root.resetFlights=function(){state.token++;state.data=null;state.fx=null;state.memory=null;state.cal=null;state.calError=false;if(el('flights-timeoff'))el('flights-timeoff').innerHTML='';state.saved={};state.byId={};state.saving=false;state.prefsUnavailable=false;if(el('flights-assistant'))el('flights-assistant').innerHTML='';};
  root.renderFlightOffers=function() {
    if(!el('flights-out')) return;
    if(state.remembered) remember();
    var filters={market:el('flights-market') && el('flights-market').value || 'international',origin:el('flights-origin').value || 'All',destination:el('flights-destination').value,
      cabin:el('flights-cabin').value || 'economy',tripType:el('flights-trip').value || 'All',
      from:el('flights-from').value,to:el('flights-to').value,savedOnly:el('flights-saved-only').checked,savedIds:Object.keys(state.saved)};
    var offers=new Map((state.data && state.data.offers || []).map(function(d){return [d.id,d];}));
    if(filters.savedOnly) Object.values(state.saved).forEach(function(d){if(d && !offers.has(d.id))offers.set(d.id,d);});
    state.byId={};offers.forEach(function(d){state.byId[d.id]=d;});
    var all=Array.from(offers.values()), rows=root.FlightsCore.select({offers:all},filters), groups=new Map();
    rows.forEach(function(d){if(d.kind==='promo'){if(!groups.has(d.group))groups.set(d.group,[]);groups.get(d.group).push(d);}});
    var html='', fares=rows.filter(function(d){return d.kind==='advertised-fare';}), regions=root.FlightsCore.board(fares,state.fx), cityFares={};
    var asOf=state.data && state.data.asOf, lows=[];
    regions.forEach(function(r){r.cities.forEach(function(c){
      c.memory=root.FlightsCore.priceMemory(c.best,state.memory,asOf);
      if(c.memory && c.memory.newLow) lows.push(c);
      c.samples.forEach(function(d){cityFares[d.id]=c.samples.length;});
    });});
    groups.forEach(function(items,group){html+='<div class="flights-group">'+esc(group)+(items[0].campaign ? ' · booking deadlines first' : ' · campaigns to check')+'</div><div class="radar-grid">'+items.map(function(d){return card(d,false);}).join('')+'</div>';});
    if(fares.length)html+=boardHtml(regions,fares.length);
    if(filters.market!=='international' && (!filters.savedOnly) && (filters.market==='domestic' || filters.market==='ENI') && !fares.some(function(d){return d.destination==='ENI';}))html+='<p class="flights-note">El Nido (ENI): no readable advertised fare in this scout. <a href="https://www.cebupacificair.com/en-PH" target="_blank" rel="noopener noreferrer">Check El Nido on Cebu Pacific</a>; confirm departure airport, available dates and total there.</p>';
    el('flights-out').innerHTML=html || '<div class="empty-state">'+(filters.savedOnly?'NO SAVED OFFERS MATCH THESE FILTERS':'NO ADVERTISED OFFERS MATCH THESE FILTERS')+'</div>';
    var hidden=filters.cabin==='All' ? 0 : root.FlightsCore.select({offers:all},Object.assign({},filters,{cabin:'All'})).length-rows.length;
    var cities=new Set(regions.flatMap(function(r){return r.cities.map(function(c){return c.name;});})).size, promos=rows.length-fares.length;
    el('flights-status').textContent=(state.prefsUnavailable ? 'Your saved shortlist could not load; saving is disabled to protect it. ' : '')+
      fares.length+(fares.length===1?' fare':' fares')+' to '+cities+(cities===1?' city':' cities')+(promos ? ' · '+promos+(promos===1?' sale or promotion':' sales and promotions') : '')+'. '+
      (hidden ? hidden+(filters.cabin==='economy' ? ' business and premium' : ' economy')+(hidden===1?' fare':' fares')+' hidden by the cabin filter. ' : '')+
      'PHP figures are estimates from the app’s dated PH market rates. Seat sales show campaign travel windows, not confirmed flights. Date filters exclude undated campaigns.';
    if(filters.from && filters.to && filters.from>filters.to) el('flights-status').textContent='The departure end date must be on or after the start date.';
    if(el('flights-assistant')) {
      var value=function(id,fallback){return el(id) && el(id).value!=='' ? el(id).value : fallback;};
      var preferences={budget:value('flights-budget',0),minNights:value('flights-min-nights',3),maxNights:value('flights-max-nights',10),extra:value('flights-extra',0),baggage:!!(el('flights-baggage') && el('flights-baggage').checked),directOnly:!!(el('flights-direct') && el('flights-direct').checked)};
      var result=root.FlightsCore.shortlist(rows,preferences,state.fx);
      result.items=result.items.map(function(d){return Object.assign({},d,{cityFares:cityFares[d.id] || 0,memory:root.FlightsCore.priceMemory(d,state.memory,asOf)});});
      var note=result.error || (result.items.length ? result.eligible+' observed return samples match your trip settings. Cheapest destinations first; these are advertised fares, not live final totals.' : preferences.directOnly ? 'No matching fare confirms nonstop flights. Turn off nonstop-only to see options with stops still to check.' : 'No fresh, comparable return fares match your trip settings. Try a wider trip length, dates or budget.');
      if(result.unconverted)note+=' '+result.unconverted+' samples cannot be ranked in PHP because a current conversion rate is unavailable.';
      var compared=rows.filter(function(d){return d.change && ['dropped','rose','unchanged'].includes(d.change.status);});
      var drops=compared.filter(function(d){return d.change.status==='dropped';}).length;
      var newcomers=rows.filter(function(d){return d.change && d.change.status==='new';}).length;
      var changeNote=compared.length ? '<p class="flights-note">Since the previous scout: '+drops+(drops===1?' price drop':' price drops')+' across '+compared.length+' rechecked matching '+(compared.length===1?'fare':'fares')+(newcomers ? ' · '+newcomers+' newly observed '+(newcomers===1?'offer':'offers') : '')+'.</p>' : '';
      // Biggest drops below the earlier low first; the board marks the rest.
      lows.sort(function(x,y){return x.memory.delta/x.memory.low-y.memory.delta/y.memory.low;});
      var lowNote=lows.length ? '<p class="flights-note">New lows against earlier scouts: '+lows.slice(0,6).map(function(c){return '<button class="tool-chip" type="button" onclick="showFlightAlternative(\''+esc(c.best.id)+'\')">'+esc(c.name)+' −'+esc(Math.round(-c.memory.delta/c.memory.low*100))+'%</button>';}).join(' ')+(lows.length>6 ? ' and '+(lows.length-6)+' more, marked on the board' : '')+'</p>' : '';
      var urgent=rows.filter(function(d){return d.campaign && !d.expired && root.FlightsCore.deadlineLabel(d);});
      var urgency=urgent.map(function(d){return '<p class="flight-flag">'+esc(d.airline)+' · '+esc(root.FlightsCore.deadlineLabel(d))+' · <button class="tool-chip" type="button" onclick="showFlightAlternative(\''+esc(d.id)+'\')">View sale terms</button></p>';}).join('');
      el('flights-assistant').innerHTML='<div class="flights-group">Trips worth checking first</div>'+urgency+'<p class="flights-note">'+esc(note)+'</p>'+changeNote+lowNote+(result.items.length ? '<div class="radar-grid">'+result.items.map(function(d){return card(d,true);}).join('')+'</div>' : '');
    }
    if(el('flights-timeoff'))el('flights-timeoff').innerHTML=timeOffHtml(all,filters);
  };
  root.showFlightAlternative=function(id) {
    var all=el('flights-all');if(all)all.open=true;
    var target=el('flight-offer-'+id), city=target && typeof target.closest==='function' ? target.closest('details.flight-city') : null;
    if(city)city.open=true;
    if(target && target.classList){target.classList.add('flight-hit');setTimeout(function(){target.classList.remove('flight-hit');},2400);}
    if(target && typeof target.scrollIntoView==='function')target.scrollIntoView({behavior:'smooth',block:'center'});
  };
  function sources(data) {
    if(!el('flights-sources'))return;
    var rows=data && data.sources || [], offers=data && data.offers || [];
    var readable=rows.filter(function(s){return s.status==='ok';}).length;
    // Name the airline when all its pages failed, otherwise the failed page.
    var down=Array.from(new Set(rows.filter(function(s){return s.status!=='ok';}).map(function(s){
      return rows.some(function(o){return o.airline===s.airline && o.status==='ok';}) ? s.airline+' '+String(s.label || s.id).toLowerCase() : s.airline;
    })));
    var origins=root.FlightsCore.origins.filter(function(o){return !offers.some(function(d){return d.kind==='advertised-fare' && d.origin===o;});});
    var names={MNL:'Manila',CEB:'Cebu',CRK:'Clark'};
    var gap=origins.length ? ' No priced fares from '+origins.map(function(o){return names[o];}).join(' or ')+' were readable in this scout.' : '';
    el('flights-sources').innerHTML='<details class="flight-all"><summary>Airline source coverage · '+readable+' of '+rows.length+' pages readable'+(down.length ? ' · unavailable: '+esc(down.join(', ')) : '')+'</summary>'+
      '<p class="flights-note">Scheduled at 08:00 and 20:00 PHT daily; runs may start late. Worldwide destinations where an airline publishes readable offers.'+esc(gap)+'</p><div class="flight-source-list">'+
      rows.map(function(s){var url=root.FlightsCore.evidenceUrl(s.url), label=s.publisher || s.airline;return '<div class="flight-source">'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+' ↗</a>':esc(label))+
        '<div class="flights-note">'+esc(s.label || s.id)+' · '+(s.status==='ok'?s.offerCount+' offers read':'Unavailable to the scout')+'<br>Checked '+esc(stamp(s.checkedAt))+'</div><div>'+esc(s.message)+'</div></div>';}).join('')+'</div></details>';
  }
  root.renderFlights=async function() {
    if(state.saving)return;
    var token=++state.token;
    if(!el('flights-out'))return;
    el('flights-out').innerHTML='<div class="empty-state">LOADING FLIGHT SCOUT…</div>';
    if(el('flights-assistant'))el('flights-assistant').innerHTML='';
    if(!state.remembered){recall();state.remembered=true;}
    [['flights-min-nights','3'],['flights-max-nights','10'],['flights-extra','0']].forEach(function(pair){if(el(pair[0]) && el(pair[0]).value==='')el(pair[0]).value=pair[1];});
    el('flights-status').textContent='';
    // The owner's calendar supplies leave windows and poker plans; members have none.
    var uid=root._firebaseUid,owner=!!uid && !root.daybookMember && typeof root.fbLoadMeetings==='function';
    var results=await Promise.allSettled([root.fbLoadFlights(),root.fbLoadFlightPrefs(),typeof root.fbLoadPh==='function' ? root.fbLoadPh() : Promise.resolve(null),
      typeof root.fbLoadFlightHistory==='function' ? root.fbLoadFlightHistory() : Promise.resolve(null),
      owner ? root.fbLoadMeetings(uid) : Promise.resolve(null),owner && typeof root.fbLoadDaybookEvents==='function' ? root.fbLoadDaybookEvents() : Promise.resolve([])]);
    if(token!==state.token)return;
    state.calError=owner && results[4].status!=='fulfilled';
    state.cal=owner && !state.calError ? {meetings:results[4].value || null,manual:results[5].status==='fulfilled' ? results[5].value || [] : []} : null;
    // Without the price memory the board simply omits its comparisons.
    state.memory=results[3].status==='fulfilled' && results[3].value ? root.FlightsCore.memoryIndex(results[3].value) : null;
    state.fx=results[2].status==='fulfilled' ? results[2].value : null;
    state.prefsUnavailable=results[1].status!=='fulfilled';state.saved=state.prefsUnavailable?{}:results[1].value || {};
    if(results[0].status!=='fulfilled') {
      if(el('flights-assistant'))el('flights-assistant').innerHTML='';
      state.data=null;el('flights-out').innerHTML='<div class="empty-state">FLIGHT SCOUT COULD NOT LOAD. TRY RELOADING.</div>';
      el('flights-status').textContent='The last scout could not be read. No prices have been inferred.';el('flights-sources').innerHTML='';return;
    }
    state.data=results[0].value;
    el('flights-sub').textContent='Manila · Cebu · Clark / international and key domestic destinations / flexible dates'+(state.data?' / checked '+stamp(state.data.generatedAt):' / waiting for first scout');
    sources(state.data);root.renderFlightOffers();
  };
  root.toggleFlightSave=async function(id) {
    if(state.saving || state.prefsUnavailable || !state.byId[id])return;
    var token=state.token, keep=!state.saved[id];state.saving=true;root.renderFlightOffers();
    try {
      var saved=await root.fbSetSavedFlight(state.byId[id],keep);
      if(token!==state.token)return;
      state.saved=saved || {};state.saving=false;root.renderFlightOffers();
      el('flights-status').textContent=keep?'Offer saved to your shortlist. Recheck the price before booking.':'Offer removed from your shortlist.';
    } catch(error) {
      if(token!==state.token)return;
      state.saving=false;root.renderFlightOffers();el('flights-status').textContent=error.message || 'Could not save. Try again.';
    }
  };
})(typeof window!=='undefined'?window:globalThis);
