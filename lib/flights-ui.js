(function(root) {
  'use strict';
  var state={token:0,data:null,saved:{},byId:{},saving:false,prefsUnavailable:false};
  var el=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
  function stamp(value) {
    var t=Date.parse(value || '');
    return Number.isFinite(t) ? new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(t))+' PHT' : 'unknown';
  }
  function card(d) {
    var warning=d.expired ? 'Travel date has passed · saved reference only' : d.stale ? 'Old quote · recheck with the airline' : d.kind==='promo' ? 'Campaign listed · dates and final fare unverified' : 'Advertised fare · availability unconfirmed';
    var price=d.kind==='promo' ? d.discount || d.title || 'Discount campaign' : d.currency+' '+d.amount.toLocaleString('en-PH',{maximumFractionDigits:2})+' from';
    return '<article class="flight-card"><div class="flights-note">'+esc(d.airline)+' · '+esc(d.tripType==='not-stated'?'Journey type not stated':d.tripType)+' · '+esc(d.cabin || 'Cabin not stated')+'</div>'+
      '<div class="flight-route">'+esc(d.originName || d.origin)+' → '+esc(d.destinationName || d.destination)+'</div>'+
      '<div class="flights-note">'+esc(d.origin)+' → '+esc(d.destination)+'</div><div class="flight-price">'+esc(price)+'</div>'+
      '<div>'+esc(d.departureDate ? d.departureDate+(d.returnDate?' → '+d.returnDate:'') : 'Flexible dates · airline terms need checking')+'</div>'+
      '<div class="flight-flag">'+esc(warning)+'</div>'+
      '<details class="radar-forecast"><summary>Fare details &amp; restrictions</summary>'+
        '<p>'+esc(d.priceBasis)+'</p><p><b>Booking deadline:</b> '+esc(d.bookingEnd || 'Not published in the extracted offer.')+'</p>'+
        '<p><b>Travel:</b> '+esc(d.travelPeriod)+'</p><p><b>Taxes:</b> '+esc(d.fees)+'</p>'+
        '<p><b>Baggage:</b> '+esc(d.baggage)+'</p><p><b>Connections:</b> '+esc(d.connections)+'</p><p>'+esc(d.terms)+'</p></details>'+
      '<div class="flights-note">Source checked '+esc(stamp(d.checkedAt))+(d.airlineSeen ? '<br>Airline report: '+esc(d.airlineSeen)+' (at that check)' : '')+'</div>'+
      '<div class="flight-actions"><a href="'+esc(root.FlightsCore.officialUrl(d.bookingUrl))+'" target="_blank" rel="noopener noreferrer">Check fare on airline ↗</a>'+
      '<button type="button" class="tool-chip" '+(state.saving || state.prefsUnavailable ? 'disabled ' : '')+'onclick="toggleFlightSave(\''+esc(d.id)+'\')">'+(d.saved?'Remove saved':'Save deal')+'</button></div></article>';
  }
  root.resetFlights=function(){state.token++;state.data=null;state.saved={};state.byId={};state.saving=false;state.prefsUnavailable=false;};
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
    var html='';
    groups.forEach(function(items,group){html+='<div class="flights-group">'+esc(group)+(group.indexOf('Promotions')===0 ? ' · campaigns to check' : ' · lowest advertised first')+'</div><div class="radar-grid">'+items.map(card).join('')+'</div>';});
    el('flights-out').innerHTML=html || '<div class="empty-state">'+(filters.savedOnly?'NO SAVED OFFERS MATCH THESE FILTERS':'NO VERIFIED OFFERS MATCH THESE FILTERS')+'</div>';
    var currencies=new Set(rows.filter(function(d){return d.kind==='advertised-fare';}).map(function(d){return d.currency;}));
    el('flights-status').textContent=(state.prefsUnavailable ? 'Your saved shortlist could not load; saving is disabled to protect it. ' : '')+
      rows.length+' matching offers. '+(currencies.size>1?'Currencies are shown separately; prices are not converted. ':'')+
      'Discount campaigns have no confirmed fare or travel window. Date filters exclude undated campaigns.';
    if(filters.from && filters.to && filters.from>filters.to) el('flights-status').textContent='The departure end date must be on or after the start date.';
  };
  function sources(data) {
    if(!el('flights-sources'))return;
    var rows=data && data.sources || [];
    el('flights-sources').innerHTML='<div class="flights-group">Airline source coverage</div><p class="flights-note">Scheduled at 08:00 and 20:00 PHT daily; runs may start late. Worldwide destinations where an airline publishes readable offers. Clark coverage may be incomplete.</p><div class="flight-source-list">'+
      rows.map(function(s){var url=root.FlightsCore.officialUrl(s.url);return '<div class="flight-source">'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.airline)+' ↗</a>':esc(s.airline))+
        '<div class="flights-note">'+esc(s.id)+' · '+(s.status==='ok'?s.offerCount+' offers read':'Unavailable to the scout')+'<br>Checked '+esc(stamp(s.checkedAt))+'</div><div>'+esc(s.message)+'</div></div>';}).join('')+'</div>';
  }
  root.renderFlights=async function() {
    if(state.saving)return;
    var token=++state.token;
    if(!el('flights-out'))return;
    el('flights-out').innerHTML='<div class="empty-state">LOADING FLIGHT SCOUT…</div>';
    el('flights-status').textContent='';
    var results=await Promise.allSettled([root.fbLoadFlights(),root.fbLoadFlightPrefs()]);
    if(token!==state.token)return;
    state.prefsUnavailable=results[1].status!=='fulfilled';state.saved=state.prefsUnavailable?{}:results[1].value || {};
    if(results[0].status!=='fulfilled') {
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
