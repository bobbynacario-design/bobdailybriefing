(function(root) {
  'use strict';
  var state={token:0,data:null,fx:null,saved:{},byId:{},saving:false,prefsUnavailable:false};
  var el=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
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
  function card(d,featured) {
    var warning=d.expired ? (d.campaign?'Booking period ended':'Travel date has passed')+' · saved reference only' : d.stale ? 'Old quote · recheck with the airline' : d.campaign ? 'Base fare only · fees extra · selected routes and seats' : d.kind==='promo' ? 'Campaign listed · dates and final fare unverified' : 'Advertised fare · availability unconfirmed';
    var price=d.kind==='promo' ? d.discount || d.title || 'Discount campaign' : d.currency+' '+d.amount.toLocaleString('en-PH',{maximumFractionDigits:2})+' from';
    var peso=root.FlightsCore.phpEstimate(d,state.fx);
    if(peso) price+=' · ≈ PHP '+peso.amount.toLocaleString('en-PH',{maximumFractionDigits:0})+(peso.stale?' (older rate)':'');
    var conversion=!peso && d.kind==='advertised-fare' && d.currency!=='PHP' ? '<div class="flights-note">PHP estimate unavailable</div>' : '';
    var exchange=peso ? '<p><b>PHP estimate:</b> 1 '+esc(d.currency)+' = PHP '+esc(peso.rate)+' · PH market rate as of '+esc(peso.asOf)+(peso.stale?' · older rate':'')+'. Bank/card rates and fees may differ.</p>' : '';
    var advice=d.recommendation ? '<p class="flight-reason">'+esc(d.recommendation)+'</p>'+
      '<div><b>'+esc(d.nights)+' nights</b>'+(d.extraAllowance>0 ? ' · ≈ PHP '+esc(d.planningAmount.toLocaleString('en-PH',{maximumFractionDigits:0}))+' with your extra-cost allowance' : '')+'</div>'+
      '<div class="flight-flag">'+esc(d.costChecks.join(' · '))+'</div>'+
      (d.alternativeIds.length ? '<button class="tool-chip" type="button" onclick="showFlightAlternative(\''+esc(d.alternativeIds[0])+'\')">Compare another observed option</button>' : '') : '';
    return '<article id="flight-'+(featured?'trip-':'offer-')+esc(d.id)+'" class="flight-card"><div class="flights-note">'+esc(d.airline)+' · '+esc(d.tripType==='not-stated'?'Journey type not stated':d.tripType)+' · '+esc(d.cabin || 'Cabin not stated')+'</div>'+
      '<div class="flight-route">'+esc(d.campaign ? d.title : (d.originName || d.origin)+' → '+(d.destinationName || d.destination))+'</div>'+
      '<div class="flights-note">'+esc(d.campaign ? d.originName+' · check eligible routes on airline' : d.origin+' → '+d.destination)+'</div><div class="flight-price">'+esc(price)+'</div>'+conversion+
      '<div>'+esc(d.campaign ? 'Book '+d.bookingStart+' → '+d.bookingEnd : d.departureDate ? d.departureDate+(d.returnDate?' → '+d.returnDate:'') : 'Flexible dates · airline terms need checking')+'</div>'+
      (d.campaign ? '<div>Travel '+esc(d.travelStart)+' → '+esc(d.travelEnd)+'</div>' : '')+
      '<div class="flight-flag">'+esc(warning)+'</div>'+
      (root.FlightsCore.deadlineLabel(d) ? '<div class="flight-flag"><b>'+esc(root.FlightsCore.deadlineLabel(d))+'</b></div>' : '')+
      (changeLabel(d) ? '<div class="flight-flag">'+esc(changeLabel(d))+'</div>' : '')+advice+
      '<details class="radar-forecast"><summary>Fare details &amp; restrictions</summary>'+
        exchange+'<p>'+esc(d.priceBasis)+'</p><p><b>Booking deadline:</b> '+esc(d.bookingEnd || 'Not published in the extracted offer.')+'</p>'+
        '<p><b>Travel:</b> '+esc(d.travelPeriod)+'</p><p><b>Taxes:</b> '+esc(d.fees)+'</p>'+
        '<p><b>Baggage:</b> '+esc(d.baggage)+'</p><p><b>Connections:</b> '+esc(d.connections)+'</p><p>'+esc(d.terms)+'</p></details>'+
      '<div class="flights-note">Source checked '+esc(stamp(d.checkedAt))+(d.airlineSeen ? '<br>Airline report: '+esc(d.airlineSeen)+' (at that check)' : '')+'</div>'+
      (d.campaign ? '<div class="flights-note">Reported announcement · '+(d.evidenceStatus!=='unavailable' && root.FlightsCore.evidenceUrl(d.evidenceUrl) ? '<a href="'+esc(root.FlightsCore.evidenceUrl(d.evidenceUrl))+'" target="_blank" rel="noopener noreferrer">'+esc(d.publisher)+' ↗</a>' : esc(d.publisher)+' · publisher link unavailable; sale terms shown above')+' · route seats not verified</div>' : '')+
      '<div class="flight-actions"><a href="'+esc(root.FlightsCore.officialUrl(d.bookingUrl))+'" target="_blank" rel="noopener noreferrer">Check fare on airline ↗</a>'+
      '<button type="button" class="tool-chip" '+(state.saving || state.prefsUnavailable ? 'disabled ' : '')+'onclick="toggleFlightSave(\''+esc(d.id)+'\')">'+(d.saved?'Remove saved':'Save deal')+'</button></div></article>';
  }
  root.resetFlights=function(){state.token++;state.data=null;state.fx=null;state.saved={};state.byId={};state.saving=false;state.prefsUnavailable=false;if(el('flights-assistant'))el('flights-assistant').innerHTML='';};
  root.renderFlightOffers=function() {
    if(!el('flights-out')) return;
    var filters={origin:el('flights-origin').value || 'All',destination:el('flights-destination').value,
      currency:el('flights-currency').value || 'All',tripType:el('flights-trip').value || 'All',
      from:el('flights-from').value,to:el('flights-to').value,savedOnly:el('flights-saved-only').checked,savedIds:Object.keys(state.saved)};
    var offers=new Map((state.data && state.data.offers || []).map(function(d){return [d.id,d];}));
    if(filters.savedOnly) Object.values(state.saved).forEach(function(d){if(d && !offers.has(d.id))offers.set(d.id,d);});
    state.byId={};offers.forEach(function(d){state.byId[d.id]=d;});
    var rows=root.FlightsCore.select({offers:Array.from(offers.values())},filters), groups=new Map();
    rows.forEach(function(d){if(!groups.has(d.group))groups.set(d.group,[]);groups.get(d.group).push(d);});
    var html='',fareHtml='';
    groups.forEach(function(items,group){var section='<div class="flights-group">'+esc(group)+(items[0].campaign ? ' · booking deadlines first' : group.indexOf('Promotions')===0 ? ' · campaigns to check' : ' · lowest advertised first')+'</div><div class="radar-grid">'+items.map(function(d){return card(d,false);}).join('')+'</div>';if(items[0].kind==='promo')html+=section;else fareHtml+=section;});
    if(fareHtml)html+='<details id="flights-all" class="flight-all"><summary>Browse all '+rows.filter(function(d){return d.kind==='advertised-fare';}).length+' matching flight samples</summary>'+fareHtml+'</details>';
    el('flights-out').innerHTML=html || '<div class="empty-state">'+(filters.savedOnly?'NO SAVED OFFERS MATCH THESE FILTERS':'NO VERIFIED OFFERS MATCH THESE FILTERS')+'</div>';
    var currencies=new Set(rows.filter(function(d){return d.kind==='advertised-fare';}).map(function(d){return d.currency;}));
    el('flights-status').textContent=(state.prefsUnavailable ? 'Your saved shortlist could not load; saving is disabled to protect it. ' : '')+
      rows.length+' matching offers. '+(currencies.size>1?'Fares are grouped by original currency. ':'')+'PHP equivalents use the app’s dated PH market rates where available; they are estimates. '+
      'Seat sales show campaign travel windows, not confirmed flights. Date filters exclude undated campaigns.';
    if(filters.from && filters.to && filters.from>filters.to) el('flights-status').textContent='The departure end date must be on or after the start date.';
    if(el('flights-assistant')) {
      var value=function(id,fallback){return el(id) && el(id).value!=='' ? el(id).value : fallback;};
      var preferences={budget:value('flights-budget',0),minNights:value('flights-min-nights',3),maxNights:value('flights-max-nights',10),extra:value('flights-extra',0),baggage:!!(el('flights-baggage') && el('flights-baggage').checked),directOnly:!!(el('flights-direct') && el('flights-direct').checked)};
      var result=root.FlightsCore.shortlist(rows,preferences,state.fx);
      var note=result.error || (result.items.length ? result.eligible+' observed return samples match your trip settings. Cheapest destinations first; these are advertised fares, not live final totals.' : preferences.directOnly ? 'No matching fare confirms nonstop flights. Turn off nonstop-only to see options with stops still to check.' : 'No fresh, comparable return fares match your trip settings. Try a wider trip length, dates or budget.');
      if(result.unconverted)note+=' '+result.unconverted+' samples cannot be ranked in PHP because a current conversion rate is unavailable.';
      var compared=rows.filter(function(d){return d.change && ['dropped','rose','unchanged'].includes(d.change.status);});
      var drops=compared.filter(function(d){return d.change.status==='dropped';}).length;
      var newcomers=rows.filter(function(d){return d.change && d.change.status==='new';}).length;
      var changeNote=compared.length ? '<p class="flights-note">Since the previous scout: '+drops+' price drops across '+compared.length+' rechecked matching flight samples'+(newcomers ? ' · '+newcomers+' newly observed offers' : '')+'.</p>' : '';
      var urgent=rows.filter(function(d){return d.campaign && !d.expired && root.FlightsCore.deadlineLabel(d);});
      var urgency=urgent.map(function(d){return '<p class="flight-flag">'+esc(d.airline)+' · '+esc(root.FlightsCore.deadlineLabel(d))+' · <button class="tool-chip" type="button" onclick="showFlightAlternative(\''+esc(d.id)+'\')">View sale terms</button></p>';}).join('');
      el('flights-assistant').innerHTML='<div class="flights-group">Trips worth checking first</div>'+urgency+'<p class="flights-note">'+esc(note)+'</p>'+changeNote+(result.items.length ? '<div class="radar-grid">'+result.items.map(function(d){return card(d,true);}).join('')+'</div>' : '');
    }
  };
  root.showFlightAlternative=function(id) {
    var all=el('flights-all');if(all)all.open=true;
    var target=el('flight-offer-'+id);if(target && typeof target.scrollIntoView==='function')target.scrollIntoView({behavior:'smooth',block:'center'});
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
    [['flights-min-nights','3'],['flights-max-nights','10'],['flights-extra','0']].forEach(function(pair){if(el(pair[0]) && el(pair[0]).value==='')el(pair[0]).value=pair[1];});
    el('flights-status').textContent='';
    var results=await Promise.allSettled([root.fbLoadFlights(),root.fbLoadFlightPrefs(),typeof root.fbLoadPh==='function' ? root.fbLoadPh() : Promise.resolve(null)]);
    if(token!==state.token)return;
    state.fx=results[2].status==='fulfilled' ? results[2].value : null;
    state.prefsUnavailable=results[1].status!=='fulfilled';state.saved=state.prefsUnavailable?{}:results[1].value || {};
    if(results[0].status!=='fulfilled') {
      if(el('flights-assistant'))el('flights-assistant').innerHTML='';
      state.data=null;el('flights-out').innerHTML='<div class="empty-state">FLIGHT SCOUT COULD NOT LOAD. TRY RELOADING.</div>';
      el('flights-status').textContent='The last scout could not be read. No prices have been inferred.';el('flights-sources').innerHTML='';return;
    }
    state.data=results[0].value;
    el('flights-sub').textContent='Manila · Cebu · Clark / worldwide / flexible dates'+(state.data?' / checked '+stamp(state.data.generatedAt):' / waiting for first scout');
    var current=el('flights-currency').value || 'All';
    var currencies=Array.from(new Set((state.data && state.data.offers || []).map(function(d){return d.currency;}).filter(Boolean))).sort();
    el('flights-currency').innerHTML='<option value="All">All currencies</option>'+currencies.map(function(c){return '<option value="'+esc(c)+'">'+esc(c)+'</option>';}).join('');
    el('flights-currency').value=currencies.indexOf(current)>=0 ? current : 'All';
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
