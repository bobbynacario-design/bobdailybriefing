(function(root) {
  'use strict';
  var state={token:0,data:null,fx:null,memory:null,hotels:null,tripStays:null,tripRequests:null,stayOverrides:{},stayPlans:{},extraTrips:[],tripsSaved:null,tripsLoaded:false,tripTimer:null,cal:null,calError:false,pokerhq:null,pokerBankroll:null,saved:{},byId:{},saving:false,prefsUnavailable:false,remembered:false};
  // Trip settings and filters are a per-device convenience, not account data.
  // The destination text and dates are left out: a stale one would hide fares.
  var REMEMBER_KEY='daybook-flights-settings-v1';
  var REMEMBER={'flights-market':'international','flights-origin':'All','flights-cabin':'economy','flights-trip':'All','flights-budget':'','flights-min-nights':'3','flights-max-nights':'10','flights-extra':'0','flights-baggage':false,'flights-direct':false};
  var el=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
  var activityTrips={},activitySerial=0,activityView=0,activityBusy=false,placeViews={},placeSerial=0;
  // The button sits in the card's action row; its view opens below the row.
  function surroundingsParts(a,ctx) {
    var id='place'+(++placeSerial);placeViews[id]={name:a.name,city:ctx.city,base:ctx.base || '',interests:ctx.interests || '',location:null,pano:null,hotel:null};
    return {button:'<button type="button" class="tool-chip" onclick="openActivitySurroundings(\''+id+'\')">View surroundings</button>',box:'<div id="activity-'+id+'" class="activity-place-view" hidden></div>'};
  }
  var MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
  function panoDate(d) {var m=/^(\d{4})(?:-(\d{2}))?$/.exec(d || '');return m ? (m[2] ? MONTHS[Number(m[2])-1]+' ' : '')+m[1] : '';}
  function embedUrl(mode,params) {
    var url=new URL('https://www.google.com/maps/embed/v1/'+mode);url.searchParams.set('key',root.DaybookMapsEmbed && root.DaybookMapsEmbed.apiKey || '');
    Object.keys(params).forEach(function(k){url.searchParams.set(k,params[k]);});return url.href;
  }
  function metresBetween(a,b) {
    var r=Math.PI/180,h=Math.pow(Math.sin((b.lat-a.lat)*r/2),2)+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.pow(Math.sin((b.lng-a.lng)*r/2),2);
    return 2*6371000*Math.asin(Math.sqrt(h));
  }
  // Straight line from the hotel, and a flag when that clashes with a stated
  // wish to stay close. Roads are longer; the route link has the real trip.
  var STAY_CLOSE=/minimal travel|near (?:my|the) (?:hotel|base)|nearby|avoid long drives|walking distance|close to (?:my|the) (?:hotel|base)/i;
  function hotelDistance(place) {
    if(!place.hotel || !place.location)return '';
    var m=metresBetween(place.hotel,place.location),far=m>5000 && STAY_CLOSE.test(place.interests);
    var d=m<1000 ? 'about '+(Math.round(m/50)*50 || 50)+' m' : 'about '+(m<10000 ? (Math.round(m/100)/10).toFixed(1) : Math.round(m/1000))+' km';
    return '<p class="'+(far?'flight-flag':'flights-note')+'">'+esc(d)+' from '+esc(place.hotel.matchedName)+' in a straight line; the road trip is longer.'+(far?' Further than your wish to keep travel minimal.':'')+'</p>';
  }
  function pane(title,src,caption,wide) {
    return '<figure class="place-pane'+(wide?' wide':'')+'"><iframe title="'+esc(title)+'" src="'+esc(src)+'" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe><figcaption>'+caption+'</figcaption></figure>';
  }
  // Like RiskM8's premises capture: the server finds the place and the
  // nearest panorama and aims it at the place; here that exact panorama and
  // a pinned satellite view sit side by side, through the free Embed API.
  function placeFrame(id) {
    var place=placeViews[id],box=el('activity-'+id);if(!place || !box)return;
    // A photo taken on the spot (under 15 m) has no meaningful direction to
    // the place, so Google's own camera direction is kept.
    var loc=place.location,p=place.pano,near=p && Number(p.distance)<15,key=root.DaybookMapsEmbed && root.DaybookMapsEmbed.apiKey,panes='',links=[];
    var card=box.closest && box.closest('.deal-card');if(card && card.classList)card.classList.add('is-viewing');
    if(!key) panes='<p class="flights-note">Embedded maps are not configured.</p>';
    else if(loc){
      if(p) panes+=pane('Street View of '+place.name,embedUrl('streetview',near?{pano:p.id,location:p.lat+','+p.lng}:{pano:p.id,heading:String(p.heading),pitch:'0',fov:'80',location:p.lat+','+p.lng}),
        (p.by?'Photo sphere by '+esc(p.by)+(panoDate(p.date)?', '+esc(panoDate(p.date)):''):'Street View'+(panoDate(p.date)?' · photo from '+esc(panoDate(p.date)):''))+(near?' · taken at the place':' · taken about '+esc(Number(p.distance).toLocaleString('en-PH'))+' m away, facing the place')+'. Drag to look around.');
      panes+=pane('Satellite view of '+place.name,embedUrl('place',{q:loc.lat+','+loc.lng,zoom:'17',maptype:'satellite'}),
        'Satellite · pinned at '+esc(loc.matchedName || place.name)+(loc.address?', '+esc(loc.address):''),!p);
    } else panes=pane('Map search for '+place.name,embedUrl('place',{q:place.name+', '+place.city}),'Map search · no exact place was found, so check the marker is the right spot.',true);
    if(p) links.push('<a href="https://www.google.com/maps/@?api=1&amp;map_action=pano&amp;pano='+encodeURIComponent(p.id)+(near?'':'&amp;heading='+encodeURIComponent(p.heading)+'&amp;pitch=0&amp;fov=80')+'" target="_blank" rel="noopener noreferrer">Open this view in Google Maps ↗</a>');
    links.push('<a href="'+esc(loc ? 'https://www.google.com/maps/search/?api=1&query='+loc.lat+','+loc.lng : 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(place.name+', '+place.city))+'" target="_blank" rel="noopener noreferrer">Place photos &amp; reviews ↗</a>');
    if(loc && loc.sourceUrl) links.push('<a href="'+esc(loc.sourceUrl)+'" target="_blank" rel="noopener noreferrer">Location: '+esc(loc.source)+' ↗</a>');
    var note=loc && !p ? 'No Street View photo within about 600 m of this place, so the satellite view shows the spot.' : '';
    box.innerHTML=hotelDistance(place)+'<div class="place-panes">'+panes+'</div>'+
      ((note || place.note)?'<p class="flights-note">'+esc([note,place.note].filter(Boolean).join(' '))+'</p>':'')+
      '<div class="flight-actions">'+links.join(' ')+' <button class="tool-chip" type="button" onclick="closeActivityPlace(\''+id+'\')">Close view</button></div>';
  }
  root.openActivitySurroundings=async function(id) {
    var place=placeViews[id],box=el('activity-'+id);if(!place || !box || place.loading)return;
    var view=activityView,token=state.token;box.hidden=false;box.innerHTML='<p class="flights-note">Finding this place and the nearest Street View photo · no AI call…</p>';place.loading=true;
    try {var result=await root.fbActivitySurroundings({name:place.name,city:place.city,base:place.base});if(view!==activityView || token!==state.token || !placeViews[id] || box.hidden)return;place.location=result.location;place.pano=result.pano || null;place.hotel=result.base || null;place.note=result.note;placeFrame(id);}
    catch(e){if(view===activityView && token===state.token && !box.hidden){place.note=e.message || 'Place lookup unavailable.';placeFrame(id);}}
    finally{place.loading=false;}
  };
  root.closeActivityPlace=function(id){var box=el('activity-'+id);if(box){var card=box.closest && box.closest('.deal-card');if(card && card.classList)card.classList.remove('is-viewing');box.hidden=true;box.innerHTML='';}};
  var WANT_SUGGESTIONS={food:['Local food & small eateries','I want local food and small eateries near my base.'],nearby:['Must-see places nearby','I want worthwhile sights near my hotel, with minimal travel.'],quiet:['Quiet walks & scenery','I want quiet walks, scenery and places where I can slow down.'],culture:['Culture & historic places','I want local culture, historic streets and distinctive architecture.'],value:['Free or low-cost experiences','I want good-value experiences; prioritise free or low-cost options.'],wellness:['Relaxation & wellness','I want a relaxing outing, such as a spa or a peaceful place to unwind.'],shopping:['Local crafts & markets','I want local crafts and interesting markets rather than big malls.'],family:['Easy activities together','I want easy activities to enjoy together, without a packed schedule.'],beach:['Beaches & swimming','I want beaches and swimming, with time to relax.'],water:['Island-hopping & snorkelling','I want island-hopping or snorkelling if conditions and the schedule allow.']};
  var AVOID_SUGGESTIONS={crowds:['Crowds & tourist traps','Avoid crowded attractions and tourist traps.'],drives:['Long drives & transfers','Avoid long drives and complicated transfers.'],cost:['Expensive tours & extras','Avoid expensive tours, hidden charges and unnecessary extras.'],effort:['Strenuous hikes & activities','Avoid strenuous hikes and physically demanding activities.'],boats:['Boats & rough water','Avoid boat trips and rough-water activities.'],late:['Late nights','Avoid late-night outings; keep evenings easy.'],queues:['Long queues & rigid bookings','Avoid long queues and activities requiring rigid advance bookings.'],malls:['Big malls & shopping stops','Avoid big malls and shopping-focused tour stops.']};
  function preferenceSuggestions(city) {
    var beach=/^(El Nido|Boracay|Siargao|Cebu|Bohol|Puerto Princesa)$/i.test(city);
    var options=function(list,want){return Object.keys(list).filter(function(k){return !want || beach || (k!=='beach' && k!=='water');}).map(function(k){return '<option value="'+k+'">'+esc(list[k][0])+'</option>';}).join('');};
    return '<div class="activity-preferences"><div class="activity-suggestions"><label>I’d like…<select id="activity-want-suggestion" onchange="addTripPreference(\'want\',this)"><option value="">Choose a suggestion…</option>'+options(WANT_SUGGESTIONS,true)+'</select></label><label>I’d prefer to avoid…<select id="activity-avoid-suggestion" onchange="addTripPreference(\'avoid\',this)"><option value="">Choose a suggestion…</option>'+options(AVOID_SUGGESTIONS,false)+'</select></label></div><label>What you want · and what to avoid<textarea id="activity-interests" minlength="15" maxlength="500" required placeholder="E.g. local food and quiet walks with my partner; avoid long drives and crowded attractions"></textarea></label><span class="flights-note">Pick several suggestions or write your own. Each choice adds to your note; you can edit it freely.</span></div>';
  }
  root.addTripPreference=function(kind,select) {
    if(activityBusy || !select)return;
    var list=kind==='want'?WANT_SUGGESTIONS:kind==='avoid'?AVOID_SUGGESTIONS:null,choice=list && list[select.value],node=el('activity-interests');
    if(!Array.isArray(choice) || !node)return;
    select.value='';var existing=String(node.value || '').trim(),sentence=choice[1];
    if(existing.toLowerCase().includes(sentence.toLowerCase()))return;
    var next=existing ? existing+'\n'+sentence : sentence;
    if(next.length>500){el('activity-status').textContent='Your preference note is full. Shorten it before adding another suggestion.';return;}
    node.value=next;
  };
  function activityButton(city,start,end,base,commitments) {
    // Only cities with a destination guide; elsewhere the button would only say "not available".
    city=root.FlightsCore && root.FlightsCore.activityCity(city);
    if(!city || !start || !end)return '';
    var key='trip'+(++activitySerial);
    activityTrips[key]={city:city,start:start,end:end,base:base || '',commitments:commitments || ''};
    return '<button type="button" class="tool-chip owner-only" onclick="openTripActivities(\''+key+'\')">What could I do on this trip?</button>';
  }
  // Grouped by role: free time on arrival and free days, a light morning
  // before play on poker days, and backups in case of an early bust. Each
  // group says its rule once, instead of on every card.
  var ACTIVITY_GROUPS=[['plan','Your free time',''],['before-play','Mornings before play','Light and close to your base, so you are back well before play.'],
    ['if-you-bust','If you bust early','Backups, not a plan: choose one if time allows, and check it is open on the day you choose.']];
  var SLOT_ORDER={flexible:0,morning:1,afternoon:2,evening:3};
  function dayName(d) {return root.FlightsCore && root.FlightsCore.dayLabel(d) || String(d || '');}
  function activityResult(plan,cached) {
    placeViews={};
    if(!plan.context.version || plan.context.version<2)return '<p class="flight-flag">This saved shortlist used the earlier selection rules. Tap “Improve saved shortlist” to rebuild it with fewer, more practical options. No AI call has run automatically.</p>';
    var ctx=plan.context,oldFacts=false;
    // What the source itself says (Wikivoyage hours, price and last edit;
    // Google rating), in the source's words, never the model's. A listing
    // over two years old, or undated, is marked where its hours or price show.
    var factLine=function(f){
      if(!f || !f.source)return '';
      var edited=Date.parse(f.lastedit || ''),old=Number.isFinite(edited) && Date.now()-edited>2*365.25*86400000,listed=f.hours || f.price;
      var bits=f.source==='Google Maps'
        ? [f.rating?esc('★ '+f.rating+(f.reviews?' · '+Number(f.reviews).toLocaleString('en-PH')+' reviews':'')):'']
        : [esc(f.hours || ''),esc(f.price || ''),f.rating?esc('Google ★ '+f.rating):''];
      if(f.source==='Wikivoyage' && f.lastedit)bits.push(old && listed?'<span class="act-old">listing from '+esc(panoDate(f.lastedit.slice(0,7)))+'</span>':'updated '+esc(panoDate(f.lastedit.slice(0,7))));
      else if(f.source==='Wikivoyage' && listed)bits.push('<span class="act-old">undated listing</span>');
      if(listed && (old || !Number.isFinite(edited)))oldFacts=true;
      bits=bits.filter(Boolean);
      return bits.length?'<p class="act-facts"><span class="act-src">'+esc(f.source)+'</span> '+bits.join(' · ')+'</p>':'';
    };
    var sourceLink=function(a){
      var label=a.facts && a.facts.source==='Google Maps'?'Open in Google Maps ↗':a.facts && a.facts.source==='Wikivoyage'?'Read on Wikivoyage ↗':'Read destination guide ↗';
      return a.url?'<a href="'+esc(a.url)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>':'';
    };
    // Backups are shared: any poker day still in the stay and not reserved.
    var bustDays=(ctx.pokerDays || []).filter(function(d){return d>=ctx.start && d<ctx.end && !(ctx.busy || []).includes(d);}).slice().sort().map(dayName);
    var card=function(a){
      var maps='https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(ctx.base+', '+ctx.city)+'&destination='+encodeURIComponent(a.name+', '+ctx.city);
      var backup=a.role==='if-you-bust' && bustDays.length,place=surroundingsParts(a,ctx);
      var when=(backup?bustDays.join(' or '):dayName(a.date)+' · '+a.slot)+(a.effort?' · '+a.effort:'');
      return '<article class="deal-card act-card"><div class="act-when">'+esc(when)+'</div><h4>'+esc(a.name)+'</h4>'+(a.areaFit?'<p class="act-near">'+esc(a.areaFit)+'</p>':'')+factLine(a.facts)+
        '<p class="act-why">'+esc(a.whyFit)+'</p><dl class="act-notes"><dt>Tradeoff</dt><dd>'+esc(a.tradeoff)+'</dd><dt>Before going</dt><dd>'+esc(a.check)+'</dd></dl>'+
        '<details class="act-source"><summary>Source evidence</summary><p>'+esc(a.evidence)+'</p>'+sourceLink(a)+'</details>'+
        '<div class="flight-actions"><a href="'+esc(maps)+'" target="_blank" rel="noopener noreferrer">Route from your base ↗</a>'+place.button+'</div>'+place.box+'</article>';
    };
    var groups=ACTIVITY_GROUPS.map(function(g){
      var rows=plan.activities.filter(function(a){return (a.role || 'plan')===g[0];});
      if(g[0]!=='if-you-bust')rows.sort(function(a,b){return String(a.date).localeCompare(String(b.date)) || (SLOT_ORDER[a.slot] || 0)-(SLOT_ORDER[b.slot] || 0);});
      return rows.length?'<h4 class="flights-group">'+g[1]+'</h4>'+(g[2]?'<p class="flights-note act-rule">'+g[2]+'</p>':'')+'<div class="deal-grid">'+rows.map(card).join('')+'</div>':'';
    }).join('');
    return '<div class="act-summary"><b>'+esc(ctx.city)+'</b> · '+esc(dayName(ctx.start))+' → '+esc(dayName(ctx.end))+
      '<div class="flights-note">From '+esc(ctx.base)+(ctx.interests?' · you asked for “'+esc(ctx.interests)+'”':'')+'</div>'+
      '<div class="flights-note">'+(cached?'Saved plan · no new AI call':'Saved to your account')+' · generated '+esc(stamp(plan.generatedAt))+'</div></div>'+
      '<p class="flights-note act-caveat">Time slots are suggestions. Hours and prices are what each listing says, not confirmed for your dates'+(oldFacts?'; <span class="act-old">amber</span> marks listings over two years old or undated':'')+'. Check routes, weather and opening before you go.</p>'+
      groups+((plan.notes || []).length?'<details class="act-how"><summary>How these were chosen</summary>'+plan.notes.map(function(n){return '<p class="flights-note">'+esc(n)+'</p>';}).join('')+'</details>':'');
  }
  root.openTripActivities=async function(key) {
    var trip=activityTrips[key],panel=el('flights-activities');if(!trip || !panel)return;
    var view=++activityView,token=state.token;activityBusy=true;
    panel.hidden=false;
    var input=function(id,label,value,type){return '<label>'+label+'<input id="activity-'+id+'" type="'+(type || 'text')+'" value="'+esc(value)+'" '+(type==='date'?'': 'maxlength="500"')+' required></label>';};
    panel.innerHTML='<div class="act-head"><h3>Things to do in '+esc(trip.city)+'</h3><button class="tool-chip" type="button" onclick="closeTripActivities()">Close</button></div><p class="flights-note">Options for your free time, picked from Wikivoyage and Google Maps listings · not a booked itinerary.</p>'+
      '<form onsubmit="event.preventDefault();generateTripActivities(false)"><details id="activity-form" class="activity-form" open><summary>Trip details &amp; what you want</summary><fieldset id="activity-fields" disabled style="border:0;padding:0;margin:0"><div class="flights-controls">'+
      input('city','Destination',trip.city)+input('start','Arrival / check-in',trip.start,'date')+input('end','Departure / check-out',trip.end,'date')+input('base','Actual hotel or neighbourhood',trip.base)+
      preferenceSuggestions(trip.city)+'<label>Pace<select id="activity-pace"><option value="relaxed">Relaxed</option><option value="balanced" selected>Balanced</option><option value="active">Active</option></select></label><label>Activity budget per person / day · PHP<input id="activity-budget" type="number" min="0" max="100000" placeholder="Optional; excludes flights and hotel"></label><label>Existing plans / poker commitments<textarea id="activity-commitments" maxlength="500">'+esc(trip.commitments)+'</textarea></label><label>Poker days · a light morning before play, plus backups if you bust<input id="activity-poker" maxlength="500" placeholder="YYYY-MM-DD, YYYY-MM-DD"></label><label>Reserved full days · nothing planned<input id="activity-busy" maxlength="500" placeholder="YYYY-MM-DD, YYYY-MM-DD"></label></div></fieldset><p class="flights-note">Departure day stays free. Arrival and free days get up to one food pick and one other; poker days get a light morning before play, plus up to three backups if you bust. Put a day under Reserved to keep it empty. Each build is one Haiku call, logged as trip-activities; failed attempts count too.</p></details>'+
      '<div class="act-buttons"><button class="tool-chip" id="activity-generate" type="submit" disabled>Build my activity shortlist</button><button class="tool-chip" id="activity-refresh" type="button" hidden onclick="generateTripActivities(true)">Refresh saved plan · new AI call</button><span id="activity-quota" class="flights-note"></span></div>'+
      '<p id="activity-status" class="flights-note" role="status">Checking for a saved plan…</p><div id="activity-progress" class="activity-build-progress" hidden></div><div id="activity-result" aria-live="polite" aria-busy="false"></div></form>';
    if(trip.commitments.indexOf('Poker trip:')===0){var play=[];for(var day=new Date(Date.parse(trip.start)+86400000).toISOString().slice(0,10);day<trip.end;day=new Date(Date.parse(day)+86400000).toISOString().slice(0,10))play.push(day);el('activity-poker').value=play.join(', ');}
    if(typeof panel.scrollIntoView==='function')panel.scrollIntoView({behavior:'smooth',block:'start'});
    try {
      var result=await root.fbTripActivities(Object.assign({},trip,{loadTrip:true}));
      if(view!==activityView || token!==state.token)return;
      showActivityQuota(result.quota);
      if(result.plan){var c=result.plan.context;['city','start','end','base','interests','pace','budget','commitments'].forEach(function(k){el('activity-'+k).value=c[k] || '';});if(c.version>=3){el('activity-busy').value=(c.busy || []).join(', ');el('activity-poker').value=(c.pokerDays || []).join(', ');}el('activity-result').innerHTML=activityResult(result.plan,true);el('activity-form').open=false;el('activity-refresh').hidden=false;el('activity-refresh').textContent=(!c.version || c.version<3)?'Improve saved shortlist · new AI call':'Refresh saved plan · new AI call';}
      el('activity-status').textContent=result.plan?'Your saved plan. Open Trip details to plan a different version.':'No saved plan yet. Add your hotel and what you want above.';
    } catch(e){if(view===activityView && token===state.token)el('activity-status').textContent=e.message || 'Could not load the saved plan.';}
    finally{if(view===activityView && token===state.token){activityBusy=false;el('activity-fields').disabled=false;el('activity-generate').disabled=false;}}
  };
  function showActivityQuota(quota) {
    var node=el('activity-quota');if(!node || !quota)return;
    var reset=Date.parse(quota.resetAt),when=Number.isFinite(reset)?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(reset))+' PHT':'midnight Philippine time';
    node.textContent=quota.remaining+' of '+quota.limit+' activity builds remaining today, across all trips · resets '+when+' · reopening a saved plan is free';
  }
  function activityProgress(busy) {
    var progress=el('activity-progress'),result=el('activity-result');
    if(progress){progress.hidden=!busy;progress.innerHTML=!busy ? '' : typeof root.aiWorkingHtml==='function' ? root.aiWorkingHtml('Checking sources and building your shortlist',{slow:120}) : 'Building your activity shortlist…';}
    if(result && result.setAttribute)result.setAttribute('aria-busy',String(busy));
  }
  root.closeTripActivities=function(){activityProgress(false);placeViews={};activityView++;activityBusy=false;var panel=el('flights-activities');if(panel){panel.hidden=true;panel.innerHTML='';}};
  root.generateTripActivities=async function(refresh) {
    if(activityBusy)return;var data={generate:true,refresh:!!refresh,requestId:root.crypto.randomUUID()};
    ['city','start','end','base','interests','pace','budget','commitments'].forEach(function(k){data[k]=el('activity-'+k).value;});
    data.busy=el('activity-busy').value.split(',').map(function(d){return d.trim();}).filter(Boolean);
    data.pokerDays=el('activity-poker').value.split(',').map(function(d){return d.trim();}).filter(Boolean);
    if(data.interests.trim().length<15 || data.base.trim().length<3){el('activity-status').textContent='Add your actual base and a specific preference (at least 15 characters).';return;}
    var view=activityView,token=state.token,refreshLabel=el('activity-refresh').textContent;activityBusy=true;el('activity-fields').disabled=true;el('activity-generate').disabled=true;el('activity-refresh').disabled=true;el(refresh?'activity-refresh':'activity-generate').textContent='Building your shortlist…';activityProgress(true);el('activity-result').innerHTML='';el('activity-status').textContent='This can take up to two minutes. Keep this panel open; no need to click again.';
    try {var result=await root.fbTripActivities(data);if(view!==activityView || token!==state.token)return;showActivityQuota(result.quota);el('activity-result').innerHTML=activityResult(result.plan,result.cached);el('activity-form').open=false;el('activity-status').textContent=result.cached?'Reused the saved plan for these exact preferences.':'Your activity shortlist is ready.';el('activity-refresh').hidden=false;el('activity-refresh').textContent='Refresh saved plan · new AI call';}
    catch(e){if(view===activityView && token===state.token){showActivityQuota(e.details && e.details.quota);el('activity-status').textContent=e.message || 'Could not build a sourced shortlist. No automatic retry was made.';}}
    finally{if(view===activityView && token===state.token){activityBusy=false;activityProgress(false);el('activity-fields').disabled=false;el('activity-generate').disabled=false;el('activity-generate').textContent='Build my activity shortlist';el('activity-refresh').disabled=false;if(el('activity-refresh').textContent==='Building your shortlist…')el('activity-refresh').textContent=refreshLabel;}}
  };
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
  // Hotels (hotels-latest) for a fare's destination; null when the scout has
  // no hotel rates for that city or the document did not load.
  function pesoAmount(n) { return 'PHP '+Math.round(n).toLocaleString('en-PH'); }
  function farePeso(d) {
    if(d.php!=null) return d.php;
    var p=d.currency==='PHP' ? {amount:d.amount} : root.FlightsCore.phpEstimate(d,state.fx);
    return p && !p.stale ? Math.round(p.amount) : null;
  }
  function hotelsFor(d) { return state.hotels && d ? root.FlightsCore.hotelCity(state.hotels,'',[d.destination]) : null; }
  function placeFor(d) { var hc=hotelsFor(d);return hc ? hc.city : String(d.destinationName || d.destination).replace(/\s*\(.*\)$/,''); }
  function quotesFor(d) {
    if(state.stayOverrides['stay|'+d.id]) return null;
    var hc=hotelsFor(d);
    return hc && d.returnDate ? root.FlightsCore.stayQuotes(hc,d.departureDate,d.returnDate,state.hotels,state.fx) : null;
  }
  // Google keeps its own guest count, so a stay for other than one room and
  // two adults says what to set there.
  function hotelLink(place,start,end,label,occupancy) {
    var u=root.FlightsCore.hotelSearchLink(place,start,end);
    var custom=occupancy && ((Number(occupancy.rooms) || 1)!==1 || (Number(occupancy.adults) || 2)!==2);
    return u ? '<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>'+(custom ? '<span class="flights-note"> (set '+esc(root.FlightsCore.guestsLabel(occupancy))+' there)</span>' : '') : '';
  }
  function phtToday() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
  // The source gives a nightly rate only, so these stay to confirm; said
  // once per list rather than under every hotel.
  var CONFIRM_NOTE='Room type, cancellation, breakfast and taxes are not in the source; confirm them on the booking site.';
  function hotelCurrency() { return state.hotels && state.hotels.currency || state.tripStays && state.tripStays.currency || 'USD'; }
  function nightly(row) {
    return row.php!=null ? '≈ '+pesoAmount(row.php)+'/night' : hotelCurrency()+' '+row.best.rate.toLocaleString('en-PH')+'/night';
  }
  // Your own trips (leave windows, poker trips): the page saves their dates
  // to hotel-trips-<uid> and the next scout prices them into hotel-stays-<uid>.
  function tripKey(list) { return JSON.stringify((list || []).map(function(t){return [t.id,t.venue || '',t.checkIn,t.checkOut,t.rooms || 1,t.adults || 2,!!t.edited];})); }
  function nightsOfStay(s,e) { return Math.round((Date.parse(e)-Date.parse(s))/86400000); }
  function stayPlan(t) {
    var plan=Object.assign({rooms:1,adults:2},t,state.stayOverrides[t.id] || {});
    state.stayPlans[t.id]=plan;return plan;
  }
  function stayEditor(t) {
    if(!state.tripsLoaded) return '';
    var field=function(name,label,type,value,min,max){return '<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'"'+(min ? ' min="'+min+'"' : '')+(max ? ' max="'+max+'"' : '')+' required></label>';};
    return '<details class="flight-stay-editor"><summary>Edit hotel dates &amp; guests</summary><form data-stay-id="'+esc(t.id)+'" onsubmit="event.preventDefault();saveHotelStay(this,this.dataset.stayId)">'+
      field('checkIn','Check-in','date',t.checkIn)+field('checkOut','Check-out','date',t.checkOut)+field('rooms','Rooms','number',t.rooms,1,4)+field('adults','Adults','number',t.adults,1,8)+
      '<button type="submit" class="tool-chip">Request hotel prices</button>'+(t.edited ? '<button type="button" class="tool-chip" onclick="resetHotelStay(this.closest(\'form\').dataset.stayId)">Reset hotel settings</button>' : '')+'</form><p class="flights-note">Use your arrival date for check-in. New quotes arrive with the next scout. Adults only; confirm children with the booking site.</p></details>';
  }
  // Re-render without losing the place: cities that were open stay open, and
  // the stay just edited is brought back into view.
  // Cities that were open stay open through any re-render (filters, saves).
  function openCities() {
    var doc=root.document;
    return doc && typeof doc.querySelectorAll==='function' ? Array.prototype.map.call(doc.querySelectorAll('details.flight-city[open]'),function(n){return n.id;}) : [];
  }
  function renderKeepingPlace(id) {
    var doc=root.document;
    root.renderFlightOffers();
    if(id && doc && typeof doc.querySelectorAll==='function') {
      var form=Array.prototype.filter.call(doc.querySelectorAll('form[data-stay-id]'),function(f){return f.dataset.stayId===id;})[0];
      var box=form && typeof form.closest==='function' ? form.closest('.flight-stay, .timeoff-stay') : null;
      if(box && typeof box.scrollIntoView==='function') box.scrollIntoView({block:'center'});
    }
  }
  root.resetHotelStay=function(id) {
    delete state.stayOverrides[id];
    state.extraTrips=state.extraTrips.filter(function(t){return t.id!==id;});
    renderKeepingPlace(id);
  };
  // Edits nobody can see any more stop being priced: a stay whose check-in
  // has come, or an edited fare stay whose fare has left the scout. Only with
  // the scout loaded, so a failed read never discards edits.
  function pruneStayOverrides() {
    var today=phtToday(), haveFares=!!(state.data && Array.isArray(state.data.offers) && state.data.offers.length);
    Object.keys(state.stayOverrides).forEach(function(id) {
      var t=state.stayOverrides[id];
      if(t.checkIn<=today || t.kind==='custom' && haveFares && !state.byId[String(id).replace(/^stay\|/,'')]) delete state.stayOverrides[id];
    });
    state.extraTrips=state.extraTrips.filter(function(t){return state.stayOverrides[t.id];});
  }
  root.saveHotelStay=async function(form,id) {
    if(!state.tripsLoaded || !state.stayPlans[id]) return;
    var read=function(n){return form.elements.namedItem(n).value;};
    var settings=root.FlightsCore.hotelStaySettings({checkIn:read('checkIn'),checkOut:read('checkOut'),rooms:read('rooms'),adults:read('adults')});
    if(!settings || settings.checkIn<=phtToday()){el('flights-status').textContent='Choose a future stay of 1–30 nights, 1–4 rooms and 1–8 adults, with at least one adult per room.';return;}
    var plan=Object.assign({},state.stayPlans[id],settings,{edited:true});
    if(!state.stayOverrides[id] && Object.keys(state.stayOverrides).length>=12){el('flights-status').textContent='You already have 12 edited stays. Change an existing stay.';return;}
    state.stayOverrides[id]=plan;
    if(plan.kind==='custom')state.extraTrips=state.extraTrips.filter(function(t){return t.id!==id;}).concat([plan]);
    renderKeepingPlace(id);
    if(state.tripTimer){root.clearTimeout(state.tripTimer);state.tripTimer=null;}
    var token=state.token,snapshot=state.tripRequests.map(function(t){return Object.assign({},t);});
    el('flights-status').textContent='Saving hotel dates and guests…';
    try{await root.fbSaveHotelTrips(snapshot);if(token===state.token){state.tripsSaved=tripKey(snapshot);el('flights-status').textContent='Hotel request saved. The next scout will price these dates and guests.';}}
    catch(_){if(token===state.token)el('flights-status').textContent='Hotel request could not save. Try again; prices for the new settings are not ready.';}
  };
  function tripQuotes(id) {
    var t=state.tripStays && Array.isArray(state.tripStays.trips) ? state.tripStays.trips.filter(function(t){return t && t.id===id;})[0] : null;
    var plan=state.stayPlans[id] || state.stayOverrides[id];
    if(t && plan && (t.checkIn!==plan.checkIn || t.checkOut!==plan.checkOut || (t.rooms || 1)!==plan.rooms || (t.adults || 2)!==plan.adults)) t=null;
    if(!t || !t.pricedAt || !Array.isArray(t.hotels) || !t.hotels.length) return {trip:t || null,q:null};
    var index={currency:state.tripStays.currency || 'USD',rooms:t.rooms || 1,adults:t.adults || 2};
    return {trip:t,q:root.FlightsCore.stayQuotes({city:t.city,hotels:t.hotels,stays:[t]},t.checkIn,t.checkOut,index,state.fx)};
  }
  function scheduleTripSave() {
    if(!state.tripsLoaded || !state.tripRequests || typeof root.fbSaveHotelTrips!=='function' || typeof root.setTimeout!=='function') return;
    var key=tripKey(state.tripRequests), token=state.token;
    if(key===state.tripsSaved) return;
    if(state.tripTimer) root.clearTimeout(state.tripTimer);
    // Filters re-render often; the trips are saved once they settle.
    state.tripTimer=root.setTimeout(function() {
      state.tripTimer=null;
      if(token!==state.token) return;
      var snapshot=state.tripRequests.map(function(t){return Object.assign({},t);});
      root.fbSaveHotelTrips(snapshot).then(function(){if(token===state.token){state.tripsSaved=tripKey(snapshot);if(snapshot.some(function(t){return t.edited;}))el('flights-status').textContent='Hotel request saved. The next scout will price these dates and guests.';}}).catch(function(){if(token===state.token)el('flights-status').textContent='Hotel request could not save. Try again; prices for the new settings are not ready.';});
    },3000);
  }
  // One trip's stay: the cheapest priced room (the venue first when it is a
  // hotel), the total for the nights, every hotel folded below, or a note
  // that the dates wait for the next scout.
  // noEditor: a second showing of the same stay (a shortlist card) carries
  // no form; the stay's own place does.
  function tripStayHtml(id,place,start,end,nights,usual,noEditor) {
    var F=root.FlightsCore, plan=state.stayPlans[id], editor=plan && !noEditor ? stayEditor(plan) : '', r=tripQuotes(id), q=r.q;
    if(plan){start=plan.checkIn;end=plan.checkOut;nights=nightsOfStay(start,end);}
    editor+=activityButton(place,start,end,q && q.cheapest ? q.cheapest.hotel.name : (plan && plan.venue || ''),plan && plan.kind==='poker' ? 'Poker trip: '+plan.label+'. Keep event days and possible later rounds reserved.' : '');
    var label=nights+(nights===1?' night':' nights'), edited=plan && plan.edited ? esc(F.tripLabel({departureDate:start,returnDate:end}))+' · '+esc(F.guestsLabel(plan))+' · ' : '';
    if(!r.trip) return editor+'<div class="flights-note">'+edited+(!edited && usual ? usual+' · ' : '')+'hotels for these '+label+' are priced by the next scout (08:00 or 20:00 PHT). '+hotelLink('Hotels in '+place,start,end,'Compare current prices ↗',plan)+'</div>';
    if(q && q.stale) return editor+'<div class="flight-flag">Old quote — recheck. Checked '+esc(stamp(q.stay.pricedAt))+'.</div>'+hotelLink('Hotels in '+place,start,end,'Compare current prices ↗',plan);
    if(!q || !q.cheapest) return editor+'<div class="flights-note">'+edited+(usual ? usual+' · ' : '')+(r.trip.hotels && r.trip.hotels.length ? 'no nightly rate listed for these dates.' : 'no scouted hotels for '+esc(place)+'.')+'</div>';
    var venue=q.rows.filter(function(x){return x.hotel.venue && x.best;})[0], other=q.rows.filter(function(x){return !x.hotel.venue && x.best;})[0];
    var line=function(x,lead){return lead+esc(x.hotel.name)+' '+esc(nightly(x))+' ('+esc(x.best.site)+')'+(x.php!=null ? ', ≈ '+esc(pesoAmount(x.php*q.nights*((plan && plan.rooms) || 1)))+' for '+label : '')+(x.deal ? ' · <b class="flight-down">'+x.below+'% below Tripadvisor’s typical minimum</b>' : '');};
    var lines=venue ? [line(venue,'At the venue: '),other ? line(other,'or ') : ''] : [line(q.cheapest,'Stay from '),''];
    if(r.trip.venue && !r.trip.venueFound) lines[1]=esc(r.trip.venue)+' is not a listed hotel, so these are hotels in '+esc(r.trip.city)+'.';
    return editor+'<div class="flight-stay-line">'+lines.filter(Boolean).join('<br>')+'</div>'+
      '<details class="flight-trip-hotels"><summary>All '+q.rows.length+' hotels for '+esc(F.tripLabel({departureDate:start,returnDate:end}))+'</summary><ul class="timeoff-fares">'+
      q.rows.map(function(x){return hotelItem(x,r.trip.city,start,end,plan);}).join('')+'</ul><p class="flights-note">'+esc(F.guestsLabel(plan || {}))+', checked '+esc(stamp(q.stay.pricedAt))+'. '+CONFIRM_NOTE+'</p></details>';
  }
  function hotelItem(row,city,start,end,occupancy) {
    var h=row.hotel, F=root.FlightsCore, reviews=F.hotelUrl(h.url);
    var price=row.best ? nightly(row)+' on '+row.best.site : row.checked ? 'No nightly rate listed for these dates' : 'Not checked in this scout';
    if(row.stale) price='Old quote — recheck · '+price;
    if(row.leftOut) price+=' · '+row.leftOut+(row.leftOut===1 ? ' site figure' : ' site figures')+' left out (looks like a whole-stay total)';
    var usual=row.typical.min!=null ? 'Tripadvisor typical minimum ≈ '+pesoAmount(row.typical.min) : '';
    var flag=row.deal ? ' · <b class="flight-down">'+row.below+'% below Tripadvisor’s typical minimum</b>' : row.lone ? ' · <span class="flight-flag">'+esc(row.best.site)+' is far below the other sites; check the room and terms</span>' : '';
    var others=row.rates.slice(1,4).map(function(r){return r.site+' '+(r.php!=null ? '≈ '+pesoAmount(r.php) : hotelCurrency()+' '+r.rate);}).join(' · ');
    return '<li><b>'+esc(h.name)+'</b>'+(h.rating!=null ? ' · ★ '+esc(h.rating)+' ('+esc(Number(h.reviews).toLocaleString('en-PH'))+' reviews)' : '')+(h.budget ? ' · budget pick' : '')+(h.venue ? ' · the venue' : '')+
      '<br>'+esc(price)+(usual ? ' · '+esc(usual) : '')+flag+(others ? '<br><span class="flights-note">Also '+esc(others)+'</span>' : '')+
      '<br>'+hotelLink(h.name+', '+city,start,end,'Compare sites ↗',occupancy)+(reviews ? ' · <a href="'+esc(reviews)+'" target="_blank" rel="noopener noreferrer">Reviews ↗</a>' : '')+'</li>';
  }
  // The stay inside an open city: hotels for its best fare's dates, or for
  // the dates the scout priced, or the city's usual range when none fit.
  function stayBlock(d) {
    if(!state.hotels || !d || !d.returnDate) return '';
    var F=root.FlightsCore, hc=hotelsFor(d), place=placeFor(d);
    var plan=stayPlan({id:'stay|'+d.id,kind:'custom',label:'Hotel stay',city:place,airports:[d.destination],checkIn:d.departureDate,checkOut:d.returnDate}),editor=hc ? stayEditor(plan) : '';
    if(plan.edited) return '<div class="flight-stay">'+tripStayHtml(plan.id,place,plan.checkIn,plan.checkOut,nightsOfStay(plan.checkIn,plan.checkOut),'')+'</div>';
    var search=hotelLink('Hotels in '+place,d.departureDate,d.returnDate,'Hotels for these dates ↗');
    if(!hc) return '<div class="flight-stay">'+editor+'<p class="flights-note">No scouted hotel rates for '+esc(place)+'. '+search+'</p></div>';
    var q=quotesFor(d), other=null;
    if(q && q.stale) return '<div class="flight-stay">'+editor+'<p class="flight-flag">Old quote — recheck. Checked '+esc(stamp(q.stay.pricedAt))+'.</p>'+search+'</div>';
    if(!q || !q.cheapest) (hc.stays || []).some(function(s){var alt=F.stayQuotes(hc,s.checkIn,s.checkOut,state.hotels,state.fx);if(alt && alt.cheapest){q=alt;other=s;return true;}return false;});
    var usual=F.typicalNightly(hc,state.hotels,state.fx);
    if(!q || !q.cheapest) return '<div class="flight-stay">'+editor+'<p class="flights-note">'+(usual ? 'Well-reviewed hotels in '+esc(place)+' usually from ≈ '+esc(pesoAmount(usual.low))+'–'+esc(pesoAmount(usual.high))+' a night (Tripadvisor typical lowest rates); not priced for these dates. ' : '')+search+'</p></div>';
    var start=q.stay.checkIn, end=q.stay.checkOut, fare=farePeso(d), total=!other && q.cheapest.php!=null ? F.tripTotal(fare,q.cheapest.php,q.nights) : null;
    return '<div class="flight-stay">'+editor+'<div class="flights-group">Stay · '+esc(F.tripLabel({departureDate:start,returnDate:end}))+'</div>'+
      (other ? '<p class="flight-flag">Priced for the dates of the cheapest fare from '+esc(other.fare && other.fare.origin || 'another airport')+', not this fare’s dates.</p>' : '')+
      (total ? '<p class="flight-stay-sum">Flight + '+q.nights+(q.nights===1?' night':' nights')+' at '+esc(q.cheapest.hotel.name)+' ≈ '+esc(pesoAmount(total.one))+' for one · ≈ '+esc(pesoAmount(total.two))+' for two sharing</p>' : '')+
      '<ul class="timeoff-fares">'+q.rows.map(function(r){return hotelItem(r,hc.city,start,end);}).join('')+'</ul>'+
      '<p class="flights-note">One room for '+esc(state.hotels.adults)+' adults, per night as booking sites list it on Tripadvisor, checked '+esc(stamp(q.stay.pricedAt))+'. '+CONFIRM_NOTE+' '+hotelLink('Hotels in '+place,start,end,'All hotels for these dates ↗')+'</p></div>';
  }
  // One line for a shortlist card or a fare row. An edited stay keeps its
  // form only where it is edited (withEditor: the fare's own row).
  function stayLine(d,withEditor) {
    if(!state.hotels || !d.returnDate) return '';
    var edited=state.stayOverrides['stay|'+d.id];
    if(edited){stayPlan(edited);return tripStayHtml(edited.id,edited.city,edited.checkIn,edited.checkOut,nightsOfStay(edited.checkIn,edited.checkOut),'',!withEditor);}
    var F=root.FlightsCore, hc=hotelsFor(d), q=quotesFor(d), place=placeFor(d);
    var link=hotelLink('Hotels in '+place,d.departureDate,d.returnDate,'Hotels for these dates ↗');
    if(q && q.cheapest) {
      var c=q.cheapest, total=c.php!=null ? F.tripTotal(farePeso(d),c.php,q.nights) : null;
      var deal=!c.deal && q.deals[0];
      return '<div class="flight-stay-line">Stay from '+esc(nightly(c))+' at '+esc(c.hotel.name)+' ('+esc(c.best.site)+')'+(c.deal ? ' · <b class="flight-down">'+c.below+'% below Tripadvisor’s typical minimum</b>' : '')+
        (total ? ' · flight + '+q.nights+(q.nights===1?' night':' nights')+' ≈ '+esc(pesoAmount(total.one))+' for one' : '')+
        (deal ? ' · <b class="flight-down">hotel deal</b>: '+esc(deal.hotel.name)+' '+esc(nightly(deal))+', '+deal.below+'% below Tripadvisor’s typical minimum' : '')+' · '+link+'</div>';
    }
    var usual=hc && F.typicalNightly(hc,state.hotels,state.fx);
    return '<div class="flight-stay-line">'+(q && q.stale ? 'Old quote — recheck · ' : '')+(usual ? 'Hotels in '+esc(place)+' usually from ≈ '+esc(pesoAmount(usual.low))+' a night · ' : '')+link+'</div>';
  }
  // Rooms below Tripadvisor’s typical minimum rate on the dates of fares now shown.
  function hotelDeals(regions) {
    var best={};
    regions.forEach(function(r){r.cities.forEach(function(c){c.samples.forEach(function(d) {
      if(d.stale || d.expired || !d.returnDate) return;
      var q=quotesFor(d), hc=hotelsFor(d);
      (q ? q.deals : []).forEach(function(row) {
        var key=row.hotel.key+'|'+d.departureDate+'|'+d.returnDate, seen=best[key];
        if(!seen || d.php!=null && (seen.fare.php==null || d.php<seen.fare.php)) best[key]={city:hc.city,fare:d,row:row,nights:q.nights,pricedAt:q.stay.pricedAt};
      });
    });});});
    var plans=Object.values(state.stayOverrides).concat(Object.values(state.stayPlans));
    return Object.keys(best).map(function(k){var x=best[k],total=root.FlightsCore.tripTotal(farePeso(x.fare),x.row.php,x.nights);x.total=total ? total.one : null;x.fits=plans.some(function(t){return (t.kind!=='custom' || t.edited) && t.city===x.city && x.fare.departureDate>=t.checkIn && x.fare.returnDate<=t.checkOut;});return x;}).sort(function(a,b){return Number(b.fits)-Number(a.fits) || (a.total==null ? Infinity : a.total)-(b.total==null ? Infinity : b.total) || b.row.below-a.row.below;});
  }
  function dealsHtml(deals) {
    if(!state.hotels) return '';
    if(!deals.length) return '<p class="flights-note">Hotel deals: no well-reviewed room on the dates of the fares shown is at least 10% below Tripadvisor’s typical minimum rate in this scout.</p>';
    var F=root.FlightsCore;
    // One small card per deal: where and how much below typical minimum, the hotel, its
    // nightly price, the dates it goes with, and flight + hotel for one.
    return '<div class="flights-group">Hotel deals on these fare dates · trip dates first, then estimated flight + stay cost</div><div class="deal-grid">'+deals.slice(0,6).map(function(x) {
      var r=x.row, h=r.hotel, total=r.php!=null ? F.tripTotal(farePeso(x.fare),r.php,x.nights) : null;
      return '<article class="deal-card"><div class="deal-head"><span class="deal-city">'+esc(x.city)+'</span><span class="deal-badge">'+r.below+'% below typical</span></div>'+
        '<div class="deal-hotel">'+esc(h.name)+'</div>'+
        '<div class="flights-note">★ '+esc(h.rating)+' · '+esc(Number(h.reviews).toLocaleString('en-PH'))+' reviews'+(h.budget ? ' · budget pick' : '')+'</div>'+
        '<div class="deal-price">'+esc(nightly(r))+'</div>'+
        '<div class="flights-note">on '+esc(r.best.site)+(r.typical.min!=null ? ' · Tripadvisor typical minimum ≈ '+esc(pesoAmount(r.typical.min)) : '')+'</div>'+
        (x.fits ? '<div class="flights-note">Fits your planned trip</div>' : '')+'<div class="deal-when">'+esc(F.tripLabel(x.fare))+'</div>'+
        (total ? '<div class="deal-total">Flight + hotel ≈ '+esc(pesoAmount(total.one))+'</div><div class="flights-note">for one, with the '+esc(x.fare.airline)+' fare</div>' : '')+
        '<div class="flight-actions"><button class="tool-chip" type="button" onclick="showFlightAlternative(\''+esc(x.fare.id)+'\')">View fare &amp; hotels</button>'+
        hotelLink(h.name+', '+x.city,x.fare.departureDate,x.fare.returnDate,'Compare sites ↗')+'</div></article>';
    }).join('')+'</div>'+
      '<p class="flights-note">'+(deals.length>6 ? (deals.length-6)+' more '+(deals.length===7 ? 'room' : 'rooms')+' at least 10% below '+(deals.length===7 ? 'its' : 'their')+' Tripadvisor typical minimum; '+(deals.length===7 ? 'its city says' : 'their cities say')+' “hotel deal” on the board. ' : '')+
      'One room for two adults, rates checked '+esc(stamp(deals.slice(0,6).map(function(x){return x.pricedAt;}).sort()[0]))+'. '+CONFIRM_NOTE+'</p>';
  }
  function localHotelsHtml(market,title) {
    var F=root.FlightsCore, cities=state.hotels ? Object.values(state.hotels.byName) : [], today;
    // Avoid locale-dependent numeric date order when comparing travel dates.
    var parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    var part=function(type){return parts.filter(function(p){return p.type===type;})[0].value;};today=part('year')+'-'+part('month')+'-'+part('day');
    var entries=[], old=false, byHotel={};
    cities.filter(function(c){return c.market===market;}).forEach(function(c){(c.stays || []).forEach(function(s){
      if(s.checkIn<=today) return;
      var q=F.stayQuotes(c,s.checkIn,s.checkOut,state.hotels,state.fx);
      if(q && q.stale) old=true;
      if(!q || !q.cheapest) return;
      var r=q.deals[0] || q.cheapest;entries.push({city:c,stay:s,quotes:q,row:r,also:[]});
    });});
    entries.sort(function(a,b){return Number(b.row.deal)-Number(a.row.deal) || a.row.best.rate-b.row.best.rate || a.stay.checkIn.localeCompare(b.stay.checkIn);});
    // The same hotel on several weekends: its best dates lead, the rest follow.
    entries=entries.filter(function(x){var k=x.city.city+'|'+x.row.hotel.key;if(byHotel[k]){byHotel[k].also.push(x);return false;}byHotel[k]=x;return true;});
    var checked=entries.map(function(x){return x.stay.pricedAt;}).sort()[0];
    var head='<p class="flights-note">'+(market==='staycation'?'Manila, Makati and Pasay · no flight needed. ':'Boracay, El Nido, Siargao, Cebu, Bohol and Puerto Princesa. ')+'Weekend stays are Friday–Sunday. One room for two adults, transport excluded'+(checked ? ', rates checked '+esc(stamp(checked)) : '')+'. These hotel-only options are independent of the airfare filters.</p>';
    if(!entries.length) {
      var start=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10),end=new Date(Date.parse(today+'T00:00:00Z')+3*86400000).toISOString().slice(0,10);
      return '<div class="flights-group">'+esc(title)+'</div><p class="flights-note">'+(old?'Old quotes — recheck. ':'')+'No current nightly rates available in this scout. '+hotelLink(market==='staycation'?'Metro Manila':'Philippines',start,end,'Compare hotels for the next two nights ↗')+'</p>';
    }
    var deals=entries.filter(function(x){return x.row.deal;}).length;
    var low=entries.map(function(x){return x.row.php;}).filter(function(n){return n!=null;}).sort(function(a,b){return a-b;})[0];
    var title2=esc(title)+' · '+entries.length+(entries.length===1?' hotel':' hotels')+(deals ? ' · '+deals+' below typical' : '')+(low!=null ? ' · from ≈ '+esc(pesoAmount(low))+'/night' : '');
    return foldSection('hotels|'+market,title2,head+(deals?'':'<p class="flights-note">No qualifying discounts in this scout; these are current rates to compare.</p>')+'<div class="deal-grid">'+entries.map(function(x){
      var r=x.row,h=r.hotel,s=x.stay;
      return '<article class="deal-card"><div class="deal-head"><span class="deal-city">'+esc(x.city.city)+'</span><span class="deal-badge">'+(r.deal?r.below+'% below typical':'Rate to compare')+'</span></div><div class="deal-hotel">'+esc(h.name)+'</div><div class="flights-note">★ '+esc(h.rating)+' · '+esc(Number(h.reviews).toLocaleString('en-PH'))+' reviews</div><div class="deal-price">'+esc(nightly(r))+'</div><div class="deal-when">'+esc(F.tripLabel({departureDate:s.checkIn,returnDate:s.checkOut})+(s.kind==='weekend'?' · weekend':''))+'</div>'+(r.php!=null?'<div class="deal-total">Room total ≈ '+esc(pesoAmount(r.php*x.quotes.nights))+'</div>':'')+
        (x.also.length?'<div class="flights-note">Also '+x.also.map(function(o){return esc(F.tripLabel({departureDate:o.stay.checkIn,returnDate:o.stay.checkOut}).replace(/ · \d+ nights?$/,''))+' ≈ '+esc(nightly(o.row).replace(/^≈ /,''));}).join('; ')+'</div>':'')+'<details class="flight-trip-hotels"><summary>Compare '+x.quotes.rows.length+' hotels</summary><ul class="timeoff-fares">'+x.quotes.rows.map(function(row){return hotelItem(row,x.city.city,s.checkIn,s.checkOut);}).join('')+'</ul></details><div class="flight-actions">'+hotelLink(h.name+', '+x.city.city,s.checkIn,s.checkOut,'Compare sites ↗')+activityButton(x.city.city,s.checkIn,s.checkOut,h.name)+'</div></article>';
    }).join('')+'</div><p class="flights-note">Discounts use Tripadvisor’s broad typical minimum, not a verified saving for the same room and terms. '+CONFIRM_NOTE+'</p>');
  }
  // Secondary lanes fold to one line that says what is inside. Opening one
  // holds for this visit, so a filter change (which redraws) keeps it open.
  var openFolds={};
  function foldSection(key,title,body) {
    return '<details class="flight-fold" data-fold="'+esc(key)+'"'+(openFolds[key] ? ' open' : '')+' ontoggle="flightsFoldToggled(this)"><summary class="flights-group">'+title+'</summary>'+body+'</details>';
  }
  root.flightsFoldToggled=function(node) {var key=node && node.getAttribute ? node.getAttribute('data-fold') : '';if(key)openFolds[key]=!!node.open;};
  function saveButton(d,label) {
    return '<button type="button" class="tool-chip" '+(state.saving || state.prefsUnavailable ? 'disabled ' : '')+'onclick="toggleFlightSave(\''+esc(d.id)+'\')">'+(d.saved?'Remove saved':label)+'</button>';
  }
  // One observed date pair inside a destination row. shown is what the
  // city's Stay block already covers: the fare it is built on (its id) and,
  // when it shows scouted quotes, their dates; those repeat no stay line.
  function sampleRow(d,shown) {
    shown=shown || {};
    var conversion=root.FlightsCore.phpEstimate(d,state.fx);
    var exchange=conversion ? '<p><b>PHP estimate:</b> 1 '+esc(d.currency)+' = PHP '+esc(conversion.rate)+' · PH market rate as of '+esc(conversion.asOf)+(conversion.stale?' · older rate':'')+'. Bank/card rates and fees may differ.</p>' : '';
    var F=root.FlightsCore, flag=d.expired ? 'Travel date has passed · saved reference only' : d.stale ? 'Old quote · recheck with the airline' : '', change=changeLabel(d);
    return '<div id="flight-offer-'+esc(d.id)+'" class="flight-sample"><div><b>'+esc(F.tripLabel(d))+'</b>'+
      '<div class="flights-note">'+esc([d.origin+' → '+d.destination,d.airline,d.cabin || 'Cabin not stated',seen(d)].filter(Boolean).join(' · '))+'</div>'+
      (d.userSupplied?'<div class="flight-flag">Quote entered by you · '+esc(d.passengers)+' traveller(s) · per-person comparison</div>':d.partner?'<div class="flight-flag">Published via '+esc(d.partner)+' · cabin not established</div>':'')+(flag ? '<div class="flight-flag">'+esc(flag)+'</div>' : '')+(change ? '<div class="flight-flag">'+esc(change)+'</div>' : '')+(d.expired || shown.id===d.id || shown.dates===d.departureDate+'|'+d.returnDate ? '' : stayLine(d,true))+'</div>'+
      '<div class="flight-sample-price"><b>'+esc(pesoText(d) || money(d))+'</b><div class="flights-note">'+esc(pesoText(d) ? money(d)+' from' : d.currency!=='PHP' ? 'PHP estimate unavailable' : 'from')+'</div></div>'+
      '<details class="radar-forecast" style="grid-column:1/-1"><summary>Fare details &amp; restrictions</summary>'+exchange+
      '<p><b>Source checked:</b> '+esc(stamp(d.checkedAt))+'</p><p>'+esc(d.priceBasis || 'Advertised fare; availability and final total need confirmation.')+'</p>'+
      '<p><b>Travel:</b> '+esc(d.travelPeriod || 'Exact sample dates shown; other dates may cost more.')+'</p>'+
      '<p><b>Taxes:</b> '+esc(d.fees || 'Confirm taxes and fees on the airline.')+'</p><p><b>Baggage:</b> '+esc(d.baggage || 'Confirm baggage allowance on the airline.')+'</p>'+
      '<p><b>Connections:</b> '+esc(d.connections || 'Confirm stops and connection times on the airline.')+'</p><p>'+esc(d.terms || 'Confirm fare conditions, changes and refunds on the airline.')+'</p></details>'+
      '<div class="flight-actions"><a href="'+esc(F.officialUrl(d.bookingUrl))+'" target="_blank" rel="noopener noreferrer">Check on airline ↗</a>'+
      (!state.hotels && d.returnDate && !d.expired ? hotelLink('Hotels in '+placeFor(d),d.departureDate,d.returnDate,'Hotels for these dates ↗') : '')+saveButton(d,'Save')+'</div></div>';
  }
  function cityRow(city) {
    var b=city.best, notes={}, drop=city.samples.some(function(d){return d.change && d.change.status==='dropped';}), memory=memoryText(b,city.memory);
    city.samples.forEach(function(d){if(d.fees)notes[d.airline]=d.fees;});
    var stay=!b.expired && quotesFor(b), room=stay && stay.cheapest && stay.cheapest.php!=null ? ' · room from ≈ '+pesoAmount(stay.cheapest.php) : '';
    var hotelDeal=city.samples.some(function(d){var q=!d.stale && !d.expired && quotesFor(d);return q && q.deals.length;});
    return '<details class="flight-city" id="flight-city-'+esc(slug(city.name+'-'+city.comparison))+'"><summary>'+
      '<span class="flight-city-line"><span class="flight-city-name">'+esc(city.name)+' <span class="flights-note">'+esc(city.codes.join(' · ')+' · '+city.comparison)+'</span></span>'+
      '<span class="flight-city-price">'+esc(pesoText(b) || money(b))+'</span></span>'+
      '<span class="flight-city-line"><span class="flight-city-when">'+esc(root.FlightsCore.tripLabel(b))+'</span>'+
      '<span class="flights-note">'+esc((pesoText(b) ? money(b)+' · ' : '')+city.airlines.join(', ')+' · '+city.samples.length+(city.samples.length===1?' fare':' fares')+room)+(city.memory && city.memory.newLow ? ' · <b class="flight-down">new low</b>' : drop ? ' · <b class="flight-down">price down</b>' : '')+
      (hotelDeal ? ' · <b class="flight-down">hotel deal</b>' : '')+'</span></span></summary>'+
      (memory ? '<p class="flights-note flight-memory">'+esc(memory)+'</p>' : '')+(b.expired ? '' : stayBlock(b))+
      '<div class="flight-samples">'+city.samples.map(function(d){return sampleRow(d,b.expired || !state.hotels ? {} : {id:b.id,dates:stay && stay.cheapest ? b.departureDate+'|'+b.returnDate : ''});}).join('')+'</div>'+
      '<p class="flights-note">'+Object.keys(notes).map(function(a){return esc(a)+': '+esc(notes[a]);}).join('<br>')+(Object.keys(notes).length ? '<br>' : '')+
      'Exact sample dates shown; other dates may cost more. Displayed fares may no longer be available; confirm baggage, stops and fare rules before booking.</p></details>';
  }
  // Each region folds to its one-line header; folded regions are remembered
  // on this device (a convenience, like the filters). Expand all opens every
  // region with its cities as one-line rows; Collapse all folds them all.
  var FOLD_KEY='daybook-flights-folded-v1';
  function foldedRegions() {
    try { var v=JSON.parse(storage() && storage().getItem(FOLD_KEY) || '[]');return Array.isArray(v) ? v : []; } catch (_) { return []; }
  }
  function saveFolded(list) {
    try { if(storage()) storage().setItem(FOLD_KEY,JSON.stringify(list.slice(0,60))); } catch (_) { /* folding still works for this visit */ }
  }
  root.flightsRegionToggled=function(node) {
    var key=node && node.getAttribute ? node.getAttribute('data-region') : '';
    if(!key) return;
    var list=foldedRegions().filter(function(k){return k!==key;});
    if(!node.open) list.push(key);
    saveFolded(list);
  };
  root.flightsFoldAll=function(collapse) {
    var doc=root.document;
    if(!doc || typeof doc.querySelectorAll!=='function') return;
    var keys=[];
    Array.prototype.forEach.call(doc.querySelectorAll('#flights-all details.flight-region'),function(n){n.open=!collapse;keys.push(n.getAttribute('data-region'));});
    // Collapsing also closes open cities, so a later Expand shows plain rows.
    if(collapse) Array.prototype.forEach.call(doc.querySelectorAll('#flights-all details.flight-city[open]'),function(n){n.open=false;});
    var rest=foldedRegions().filter(function(k){return keys.indexOf(k)<0;});
    saveFolded(collapse ? rest.concat(keys) : rest);
  };
  function boardHtml(regions,fares) {
    var cities=new Set(regions.flatMap(function(r){return r.cities.map(function(c){return c.name;});})).size, folded=foldedRegions();
    return '<details id="flights-all" class="flight-all" open><summary>All destinations · '+cities+(cities===1?' city':' cities')+' · '+fares+(fares===1?' fare':' fares')+' · cheapest first in each region</summary>'+
      '<div class="flight-board-tools"><span class="flights-note">'+regions.length+(regions.length===1?' region':' regions')+' · tap a region to fold it</span><span>'+
      '<button class="tool-chip" type="button" onclick="flightsFoldAll(false)">Expand all</button> <button class="tool-chip" type="button" onclick="flightsFoldAll(true)">Collapse all</button></span></div>'+
      regions.map(function(r){
        var key=r.name+'|'+r.comparison, n=r.cities.length;
        return '<details class="flight-region" data-region="'+esc(key)+'"'+(folded.indexOf(key)>=0 ? '' : ' open')+' ontoggle="flightsRegionToggled(this)">'+
          '<summary class="flights-group">'+esc(r.name)+' · '+esc(r.comparison)+' · from '+esc(pesoText(r.best) || money(r.best))+' · '+n+(n===1?' city':' cities')+'</summary>'+
          '<div class="flight-board">'+r.cities.map(cityRow).join('')+'</div></details>';
      }).join('')+'</details>';
  }
  function budgetChecks(d) {
    var F=root.FlightsCore,missing=F.missingBudgetPrices(d,state.data && state.data.offers);
    if(!missing.length)return '<p class="flights-note">Budget-airline samples also observed for this route and these dates; checkout terms still need confirmation.</p>';
    var links={'Cebu Pacific':'https://www.cebupacificair.com/en-PH','AirAsia':'https://www.airasia.com/flights/','Scoot':'https://www.flyscoot.com/'};
    return '<div class="flight-flag">Budget-airline prices not compared for these exact dates: '+esc(missing.join(', '))+'. Route eligibility and seats still need checking.</div><div class="flight-actions"><a href="'+esc(F.searchLink(d.origin,d.destination,d.departureDate,d.returnDate))+'" target="_blank" rel="noopener noreferrer">Compare all airlines for these dates ↗</a>'+missing.map(function(name){return '<a href="'+esc(links[name])+'" target="_blank" rel="noopener noreferrer">Check '+esc(name)+' ↗</a>';}).join('')+'</div><p class="flights-note">The comparison search carries your route and dates. Set those dates on the official airline sites.</p>';
  }
  function card(d,featured) {
    var warning=d.expired ? (d.campaign?'Booking period ended':'Travel date has passed')+' · saved reference only' : d.stale ? 'Old quote · recheck with the airline' : d.campaign ? 'Base fare only · fees extra · selected routes and seats' : d.kind==='promo' ? 'Campaign listed · dates and final fare unverified' : 'Advertised fare · availability unconfirmed';
    var price=d.kind==='promo' ? d.discount || d.title || 'Discount campaign' : d.currency+' '+d.amount.toLocaleString('en-PH',{maximumFractionDigits:2})+' from';
    var peso=root.FlightsCore.phpEstimate(d,state.fx);
    if(peso) price+=' · ≈ PHP '+peso.amount.toLocaleString('en-PH',{maximumFractionDigits:0})+(peso.stale?' (older rate)':'');
    var conversion=!peso && d.kind==='advertised-fare' && d.currency!=='PHP' ? '<div class="flights-note">PHP estimate unavailable</div>' : '';
    var exchange=peso ? '<p><b>PHP estimate:</b> 1 '+esc(d.currency)+' = PHP '+esc(peso.rate)+' · PH market rate as of '+esc(peso.asOf)+(peso.stale?' · older rate':'')+'. Bank/card rates and fees may differ.</p>' : '';
    var advice=d.recommendation ? '<p class="flight-reason">'+esc(d.recommendation)+(memoryText(d,d.memory) ? ' '+esc(memoryText(d,d.memory)) : '')+'</p>'+
      (d.hotelTotal!=null ? '<div class="deal-total">Estimated flight + room'+(d.extraAllowance>0?' + your allowance':'')+' ≈ '+esc(pesoAmount(d.planningAmount))+'</div><p class="flights-note">For one traveller · one room for two adults at '+esc(d.hotelName)+' · taxes, baggage and transfers still to check.</p>' : d.extraAllowance>0 ? '<div>≈ PHP '+esc(d.planningAmount.toLocaleString('en-PH',{maximumFractionDigits:0}))+' with your extra-cost allowance; hotel not included</div>' : '')+stayLine(d)+
      (d.cityFares>1 ? '<button class="tool-chip" type="button" onclick="showFlightAlternative(\''+esc(d.id)+'\')">All '+esc(d.cityFares)+' fares to '+esc(d.destinationName || d.destination)+'</button>' : '') : '';
    return '<article id="flight-'+(featured?'trip-':'offer-')+esc(d.id)+'" class="flight-card">'+(d.userSupplied?'<div class="flight-flag">Quote entered by you · private · '+esc(d.passengers)+' traveller(s), price per person</div>':d.partner?'<div class="flight-flag">Published via '+esc(d.partner)+' · confirm cabin and fees</div>':'')+'<div class="flights-note">'+esc(d.airline)+' · '+esc(d.tripType==='not-stated'?'Journey type not stated':d.tripType)+' · '+esc(d.cabin || 'Cabin not stated')+'</div>'+
      '<div class="flight-route">'+esc(d.campaign ? d.title : (d.originName || d.origin)+' → '+(d.destinationName || d.destination))+'</div>'+
      '<div class="flights-note">'+esc(d.campaign ? d.originName+' · check eligible routes on airline' : d.origin+' → '+d.destination)+'</div><div class="flight-price">'+esc(price)+'</div>'+conversion+
      '<div>'+esc(d.campaign ? 'Book '+root.FlightsCore.dayLabel(d.bookingStart)+' → '+root.FlightsCore.dayLabel(d.bookingEnd) : d.departureDate ? root.FlightsCore.tripLabel(d) : 'Flexible dates · airline terms need checking')+'</div>'+
      (d.campaign ? '<div>Travel '+esc(root.FlightsCore.dayLabel(d.travelStart))+' → '+esc(root.FlightsCore.dayLabel(d.travelEnd))+'</div>' : '')+
      '<div class="flight-flag">'+esc(warning)+'</div>'+
      (root.FlightsCore.deadlineLabel(d) ? '<div class="flight-flag"><b>'+esc(root.FlightsCore.deadlineLabel(d))+'</b></div>' : '')+
      (changeLabel(d) ? '<div class="flight-flag">'+esc(changeLabel(d))+'</div>' : '')+advice+
      '<details class="radar-forecast"><summary>'+(d.recommendation ? 'Fare details &amp; what to check' : 'Fare details &amp; restrictions')+'</summary>'+
        (d.recommendation ? '<div class="flight-flag">Still to confirm: '+esc(d.costChecks.join(' · '))+'</div>'+budgetChecks(d) : '')+exchange+'<p>'+esc(d.priceBasis)+'</p>'+(d.kind==='promo' ? '<p><b>Booking deadline:</b> '+esc(d.bookingEnd || 'Not published in the extracted offer.')+'</p>' : '')+
        '<p><b>Travel:</b> '+esc(d.travelPeriod)+'</p><p><b>Taxes:</b> '+esc(d.fees)+'</p>'+
        '<p><b>Baggage:</b> '+esc(d.baggage)+'</p><p><b>Connections:</b> '+esc(d.connections)+'</p><p>'+esc(d.terms)+'</p></details>'+
      '<div class="flights-note">Source checked '+esc(stamp(d.checkedAt))+(seen(d) ? '<br>'+esc(seen(d).charAt(0).toUpperCase()+seen(d).slice(1)) : '')+'</div>'+
      (d.campaign ? '<div class="flights-note">Reported announcement · '+(d.evidenceStatus!=='unavailable' && root.FlightsCore.evidenceUrl(d.evidenceUrl) ? '<a href="'+esc(root.FlightsCore.evidenceUrl(d.evidenceUrl))+'" target="_blank" rel="noopener noreferrer">'+esc(d.publisher)+' ↗</a>' : esc(d.publisher)+' · publisher link unavailable; sale terms shown above')+' · route seats not verified</div>' : '')+
      '<div class="flight-actions"><a href="'+esc(root.FlightsCore.officialUrl(d.bookingUrl))+'" target="_blank" rel="noopener noreferrer">'+(d.partner?'Check partner quote ↗':'Check fare on airline ↗')+'</a>'+
      saveButton(d,'Save deal')+activityButton(placeFor(d),d.departureDate,d.returnDate,'')+'</div></article>';
  }
  // Your time off, from the Calendar's leave and holidays, with the scouted
  // fares that fit, exact-date searches, clashes, and poker series abroad.
  var ORIGIN_CITY={MNL:'Manila',CEB:'Cebu',CRK:'Clark'};
  function timeOffHtml(all,filters) {
    var K=root.DaybookCalendarCore,F=root.FlightsCore;
    state.tripRequests=Object.values(state.stayOverrides).slice(0,12);
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
      (mem && mem.newLow?' · <b class="flight-down">new low</b>':'')+' · <a href="'+esc(F.officialUrl(d.bookingUrl))+'" target="_blank" rel="noopener noreferrer">airline ↗</a>'+roomNote(d)+'</li>';};
    // Trips whose hotels the next scout prices for you: poker first, then
    // each leave window's whole break and the fares inside it.
    var pokerTrips=[],leaveTrips=[];
    var nightsOf=nightsOfStay;
    var fareTripId=function(d){return 'leave-fare|'+placeFor(d)+'|'+d.departureDate+'|'+d.returnDate;};
    // The cheapest scouted room for a fare's exact dates, when priced: from
    // the shared hotel scout, or from your own trips.
    var roomNote=function(d){var q=quotesFor(d);if(!q || !q.cheapest)q=tripQuotes(fareTripId(d)).q;var c=q && q.cheapest;return c && c.php!=null?'<br><span class="flights-note">Room from ≈ ₱'+esc(c.php.toLocaleString('en-PH'))+'/night at '+esc(c.hotel.name)+' ('+esc(c.best.site)+')'+(c.deal?', '+c.below+'% below Tripadvisor’s typical minimum':'')+'</span>':'';};
    var links=function(cities,s,e){return cities.map(function(c){var u=F.searchLink(from,c,s,e);return u?'<a class="tool-chip" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(c)+' ↗</a>':'';}).join('');};
    // Google Hotels for the same dates; checkout is the last day away.
    var hotelChips=function(places,s,e){return places.map(function(p){var u=F.hotelSearchLink('Hotels in '+p,s,e);return u?'<a class="tool-chip" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(p)+' hotels ↗</a>':'';}).join('');};
    // A city's usual nightly room for a stay the scout did not price.
    var usualStay=function(name,airports,nights){
      var hc=F.hotelCity(state.hotels,name,airports),u=hc && F.typicalNightly(hc,state.hotels,state.fx);
      return u && nights>0?'Hotels in '+esc(hc.city)+' usually from ≈ ₱'+esc(u.low.toLocaleString('en-PH'))+' a night, about ₱'+esc((u.low*nights).toLocaleString('en-PH'))+' for '+nights+(nights===1?' night':' nights')+' (Tripadvisor typical lowest rates)':'';
    };
    var cards=windows.slice(0,3).map(function(w) {
      var fits=intl.filter(function(d){return d.departureDate>=w.start && d.returnDate && d.returnDate<=w.end;}).sort(byPrice);
      var clashes=events.filter(function(e){return K.clashes(e) && e.start<=w.end && e.end>=w.start;});
      // The whole break in the two cheapest cities with scouted hotels, and
      // the two cheapest fitting fares the shared scout has not priced.
      var n=nightsOf(w.start,w.end);
      // One stay per hotel city: two airports (DMK, BKK) can share one.
      var breakSeen={},breakCities=n>=1 && n<=30 ? top.map(function(name){return cheapest[name];}).filter(function(d){
        var place=placeFor(d);if(breakSeen[place] || state.hotels && !F.hotelCity(state.hotels,'',[d.destination]))return false;breakSeen[place]=true;return true;}).slice(0,2) : [];
      var breakHtml=breakCities.map(function(d) {
        var city=placeFor(d),id='leave|'+city+'|'+w.start+'|'+w.end;
        leaveTrips.push(stayPlan({id:id,kind:'leave',label:'Whole break',city:city,airports:[d.destination],checkIn:w.start,checkOut:w.end}));
        return '<div class="timeoff-stay"><b>'+esc(city)+'</b>'+tripStayHtml(id,city,w.start,w.end,n,state.hotels ? usualStay(city,[d.destination],n) : '')+'</div>';
      }).join('');
      fits.filter(function(d){var q=quotesFor(d);return !(q && q.cheapest) && nightsOf(d.departureDate,d.returnDate)<=30 && (!state.hotels || F.hotelCity(state.hotels,'',[d.destination]));}).slice(0,2).forEach(function(d) {
        leaveTrips.push(stayPlan({id:fareTripId(d),kind:'leave-fare',label:'Fare dates',city:placeFor(d),airports:[d.destination],checkIn:d.departureDate,checkOut:d.returnDate}));
      });
      return '<div class="timeoff"><div class="timeoff-head">'+esc(span(w.start,w.end))+'</div>'+
        '<div class="flights-note">'+w.days+' days off for '+w.leave+' leave '+(w.leave===1?'day':'days')+(w.holidays.length?' · includes '+esc(w.holidays.join(', ')):'')+' · back at work '+esc(F.dayLabel(w.back))+'</div>'+
        clashes.map(function(e){return '<div class="flight-flag">Overlaps '+(e.kind==='poker'?'♠ ':'')+esc(e.title)+' ('+esc(span(e.start,e.end))+')</div>';}).join('')+
        (fits.length?'<div class="flights-note">Scouted fares inside these dates</div><ul class="timeoff-fares">'+fits.slice(0,4).map(fareRow).join('')+'</ul>'+(fits.length>4?'<div class="flights-note">'+(fits.length-4)+' more under All destinations.</div>':'')
          :'<div class="flights-note">No scouted fare fits these dates; airlines publish their own sample dates.</div>')+
        (breakHtml?'<div class="flights-note">Hotels for the whole break, '+n+' nights:</div>'+breakHtml:'')+
        '<div class="flights-note">Live prices for exact dates, budget airlines included:</div><div class="timeoff-links">'+links(top,w.start,w.end)+
        '<form class="timeoff-city" onsubmit="event.preventDefault();flightsOpenSearch(this,\''+esc(w.start)+'\',\''+esc(w.end)+'\')"><input name="city" maxlength="60" placeholder="Any city, e.g. Tokyo" aria-label="Search another city for these dates"><button class="tool-chip" type="submit">Search ↗</button></form></div>'+
        (top.length?'<div class="flights-note">Hotels for the same dates, every booking site:</div><div class="timeoff-links">'+hotelChips(top.map(function(n){return placeFor(cheapest[n]);}).filter(function(p,i,all){return all.indexOf(p)===i;}),w.start,w.end)+'</div>':'')+'</div>';
    });
    // PokerHQ festivals abroad. His ★ picks (Playing These) decide the trip.
    // Without picks, the events PokerHQ grades within his bankroll stand in,
    // labelled as such: a grade says he can afford it, not that he will play.
    // Festivals with neither get one line in case a cheap flight changes his mind.
    var peso=function(n){return '₱'+Math.round(n).toLocaleString('en-PH');};
    // A poker trip's stay, saved for pricing when it is 1 to 30 nights.
    var stayFor=function(t){
      var n=nightsOf(t.checkIn,t.checkOut);
      if(!(n>=1 && n<=30))return '';
      t=stayPlan(t);pokerTrips.push(t);
      return '<div class="timeoff-stay">'+tripStayHtml(t.id,t.city,t.checkIn,t.checkOut,n,state.hotels ? usualStay(t.city,t.airports,n) : '')+'</div>';
    };
    var venueChip=function(f,s,e){var u=F.hotelSearchLink('Hotels near '+(f.venue ? f.venue+', ' : '')+f.city,s,e);return u?'<a class="tool-chip" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">Hotels near the venue ↗</a>':'';};
    var festivals=state.pokerhq?K.pokerFestivals(state.pokerhq,today,state.pokerBankroll):[];
    var eventList=function(rows,withGrade){return rows.slice(0,3).map(function(p){return esc(p.name)+' ('+(withGrade?esc(p.grade)+', ':'')+esc(F.dayLabel(p.day))+(p.buyin?', '+esc(peso(p.buyin)):'')+')';}).join('; ')+(rows.length>3?' and '+(rows.length-3)+' more':'');};
    var picked=festivals.filter(function(f){return f.picks.length || f.affordable.length;}).slice(0,4).map(function(f) {
      var starred=f.picks.length>0,targets=f.affordable.filter(function(r){return r.grade==='target';});
      var basis=starred?f.picks:targets.length?targets:f.affordable;
      var first=basis[0].day,last=basis[basis.length-1].day,start=K.offset(first,-1),end=K.offset(last,1),need=K.leaveNeeded(first,last,windows);
      var spend=basis.reduce(function(n,p){return n+(p.buyin || 0);},0);
      var toCity=intl.filter(function(d){return f.airports.indexOf(d.destination)>=0;}).sort(byPrice);
      var near=toCity.filter(function(d){return d.departureDate>=K.offset(start,-2) && d.departureDate<=last;});
      var inside=windows.some(function(w){return w.start<=first && w.end>=last;});
      var grade='PokerHQ grade'+(f.gradeSource==='import'?', as saved at import':' for your bankroll');
      return '<div class="timeoff timeoff-poker"><div class="timeoff-head">♠ '+esc(f.label)+'</div>'+
        '<div class="flights-note">'+esc(f.city)+' · '+esc(f.venue)+' · '+esc(span(f.start,f.end))+' · '+f.events+(f.events===1?' event':' events')+
          (f.buyinMin?' · buy-ins '+esc(peso(f.buyinMin))+(f.buyinMax>f.buyinMin?' – '+esc(peso(f.buyinMax)):''):'')+(f.main && f.main.buyin?' · main event '+esc(peso(f.main.buyin))+' ('+esc(F.dayLabel(f.main.day))+')':'')+'</div>'+
        (starred?'<div class="flights-note">Your ★ picks in PokerHQ: '+eventList(f.picks,false)+'</div>'
          :'<div class="flights-note">Nothing starred in PokerHQ yet. Within your bankroll ('+esc(grade)+'): '+eventList(f.affordable,true)+'</div>')+
        '<div><b>'+(starred?'Trip for your picks: ':'Trip if you play '+(basis.length===1?'that':'those')+(targets.length && targets.length<f.affordable.length?' target events':'')+': ')+esc(span(start,end))+'</b> · '+
          (inside?'inside your time off':need+' leave '+(need===1?'day':'days'))+(spend?' · '+esc(peso(spend))+' in buy-ins':'')+
          (near.length?' · flight from '+esc(near[0].php!=null?'≈ '+peso(near[0].php):near[0].currency+' '+near[0].amount)+' (scouted '+esc(F.tripLabel(near[0]))+')'
            :toCity.length?' · no scouted fare near these dates; '+esc(f.city)+' from '+esc(toCity[0].php!=null?'≈ '+peso(toCity[0].php):toCity[0].currency+' '+toCity[0].amount)+' on '+esc(F.tripLabel(toCity[0]))
            :'')+'</div>'+
        stayFor({id:'poker|'+f.city+'|'+start+'|'+end,kind:'poker',label:f.label,city:f.city,airports:f.airports,checkIn:start,checkOut:end,venue:f.venue})+
        '<div class="timeoff-links">'+links([f.city],start,end)+venueChip(f,start,end)+(f.url?'<a class="tool-chip" href="'+esc(f.url)+'" target="_blank" rel="noopener noreferrer">Organiser ↗</a>':'')+
          '<a class="tool-chip" href="https://bobbynacario-design.github.io/pokerhq/" target="_blank" rel="noopener noreferrer">PokerHQ ↗</a></div></div>';
    });
    var skipped=festivals.filter(function(f){return !f.picks.length && !f.affordable.length;}).slice(0,4);
    var skippedNote=skipped.length?'<p class="flights-note">Also in PokerHQ abroad, nothing starred or within your bankroll: '+skipped.map(function(f){
      var day=f.main?f.main.day:f.start;
      return esc(f.label)+' · '+esc(f.city)+' · '+esc(span(f.start,f.end))+(f.main && f.main.buyin?' · main '+esc(peso(f.main.buyin)):'')+' · <a href="'+esc(F.searchLink(from,f.city,K.offset(day,-1),K.offset(day,1)))+'" target="_blank" rel="noopener noreferrer">flights ↗</a>';
    }).join('; ')+'.</p>':'';
    // Calendar poker entries abroad that PokerHQ does not already cover.
    var trips=events.filter(function(e){return e.kind==='poker' && e.end>=today && K.pokerCity(e.title) && !festivals.some(function(f){return f.city===K.pokerCity(e.title).city && f.start<=e.end && f.end>=e.start;});}).slice(0,4).map(function(e) {
      var place=K.pokerCity(e.title),need=K.leaveNeeded(e.start,e.end,windows);
      var near=intl.filter(function(d){return place.airports.indexOf(d.destination)>=0 && d.departureDate>=K.offset(e.start,-3) && d.departureDate<=e.end;}).sort(byPrice);
      return '<div class="timeoff timeoff-poker"><div class="timeoff-head">♠ '+esc(e.title)+'</div><div class="flights-note">'+esc(span(e.start,e.end))+' · '+esc(place.city)+' · '+
        (need?need+' weekday'+(need===1?'':'s')+' outside your time off':'inside your time off')+'</div>'+
        (near.length?'<ul class="timeoff-fares">'+near.slice(0,3).map(fareRow).join('')+'</ul>':'<div class="flights-note">No scouted fare to '+esc(place.city)+' around these dates.</div>')+
        stayFor({id:'poker|'+place.city+'|'+K.offset(e.start,-1)+'|'+e.end,kind:'poker',label:e.title,city:place.city,airports:place.airports,checkIn:K.offset(e.start,-1),checkOut:e.end,venue:''})+
        '<div class="timeoff-links">'+links([place.city],K.offset(e.start,-1),e.end)+hotelChips([place.city],K.offset(e.start,-1),e.end)+'</div></div>';
    });
    var pokerNote=picked.length || trips.length || skipped.length?'':state.pokerhq?'<p class="flights-note">Overseas poker: nothing upcoming abroad in PokerHQ. Tournaments you add there with a venue abroad (Taipei, Incheon, Jeju, Macau…) appear here with flights.</p>':
      '<p class="flights-note">Overseas poker: PokerHQ’s tournaments could not be read. Calendar entries with a city abroad in the title still appear here.</p>';
    var requested=state.extraTrips.concat(Object.values(state.stayOverrides),pokerTrips,leaveTrips),seen=new Set();
    state.tripRequests=requested.filter(function(t){if(seen.has(t.id))return false;seen.add(t.id);return true;}).slice(0,12);
    if(!cards.length && !trips.length && !picked.length)return '<div class="flights-group">Your time off · trips abroad</div><p class="flights-note">No upcoming leave on your calendar. Leave synced from Zoho People, or an event with “leave” in its title, shows here with the fares that fit.</p>'+skippedNote+pokerNote;
    return '<div class="flights-group">Your time off · trips abroad</div><div class="timeoff-grid">'+cards.join('')+picked.join('')+trips.join('')+'</div>'+skippedNote+pokerNote+
      '<p class="flights-note">Search links open Google Flights in PHP for the whole window; change the dates there. Daybook does not price those flights itself. Hotels for these trips are saved to your account and priced by the next scout (08:00 or 20:00 PHT); new dates show “priced by the next scout” until then.</p>';
  }
  // The any-city box on a time-off window: a Google Flights search for those dates.
  root.flightsOpenSearch=function(form,start,end) {
    var city=form && form.city ? String(form.city.value || '').trim().slice(0,60) : '';
    var origin=el('flights-origin') ? el('flights-origin').value : 'All';
    var url=city ? root.FlightsCore.searchLink(ORIGIN_CITY[origin] || 'Manila',city,start,end) : '';
    if(url && typeof root.open==='function')root.open(url,'_blank','noopener');
    return url;
  };
  root.resetFlights=function(){root.closeTripActivities();activityTrips={};state.token++;state.data=null;state.fx=null;state.memory=null;state.hotels=null;state.tripStays=null;state.tripRequests=null;state.stayOverrides={};state.stayPlans={};state.extraTrips=[];state.tripsSaved=null;state.tripsLoaded=false;if(state.tripTimer && typeof root.clearTimeout==='function')root.clearTimeout(state.tripTimer);state.tripTimer=null;state.cal=null;state.calError=false;state.pokerhq=null;state.pokerBankroll=null;if(el('flights-timeoff'))el('flights-timeoff').innerHTML='';state.saved={};state.byId={};state.saving=false;state.prefsUnavailable=false;if(el('flights-assistant'))el('flights-assistant').innerHTML='';var form=el('flight-quote-form');if(form&&typeof form.reset==='function')form.reset();if(el('flight-quote-status'))el('flight-quote-status').textContent='';};
  root.renderFlightOffers=function() {
    if(!el('flights-out')) return;
    var reopen=openCities();
    try { renderOffers(); } finally { reopen.forEach(function(cid){var n=el(cid);if(n)n.open=true;}); }
  };
  function renderOffers() {
    activityTrips={};
    if(state.remembered) remember();
    var filters={market:el('flights-market') && el('flights-market').value || 'international',origin:el('flights-origin').value || 'All',destination:el('flights-destination').value,
      cabin:el('flights-cabin').value || 'economy',tripType:el('flights-trip').value || 'All',
      from:el('flights-from').value,to:el('flights-to').value,savedOnly:el('flights-saved-only').checked,savedIds:Object.keys(state.saved)};
    var offers=new Map((state.data && state.data.offers || []).map(function(d){return [d.id,d];}));
    Object.values(state.saved).forEach(function(d){if(d && (filters.savedOnly || d.userSupplied) && !offers.has(d.id))offers.set(d.id,d);});
    state.stayPlans={};
    state.byId={};offers.forEach(function(d){state.byId[d.id]=d;});
    pruneStayOverrides();
    var all=Array.from(offers.values()), rows=root.FlightsCore.select({offers:all},filters), groups=new Map();
    rows.forEach(function(d){if(d.kind==='promo'){if(!groups.has(d.group))groups.set(d.group,[]);groups.get(d.group).push(d);}});
    var html='', fares=rows.filter(function(d){return d.kind==='advertised-fare';}), regions=root.FlightsCore.board(fares,state.fx), cityFares={};
    var asOf=state.data && state.data.asOf, lows=[];
    regions.forEach(function(r){r.cities.forEach(function(c){
      c.memory=c.best.userSupplied?null:root.FlightsCore.priceMemory(c.best,state.memory,asOf);
      if(c.memory && c.memory.newLow) lows.push(c);
      c.samples.forEach(function(d){cityFares[d.id]=c.samples.length;});
    });});
    groups.forEach(function(items,group){var grid='<div class="radar-grid">'+items.map(function(d){return card(d,false);}).join('')+'</div>';
      html+=items[0].campaign ? '<div class="flights-group">'+esc(group)+' · booking deadlines first</div>'+grid : foldSection('promo|'+group,esc(group)+' · campaigns to check · '+items.length,grid);});
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
    if(el('flights-settings-sum')){
      var setting=function(id){return el(id) && el(id).value!=='' ? Number(el(id).value) : null;},lo=setting('flights-min-nights'),hi=setting('flights-max-nights'),budget=setting('flights-budget'),extra=setting('flights-extra');
      el('flights-settings-sum').textContent='· '+[(lo!=null ? lo : 3)+'–'+(hi!=null ? hi : 10)+' nights',budget ? 'budget PHP '+budget.toLocaleString('en-PH') : 'no budget limit',extra ? 'PHP '+extra.toLocaleString('en-PH')+' extra' : '',
        el('flights-baggage') && el('flights-baggage').checked ? 'checked bag' : '',el('flights-direct') && el('flights-direct').checked ? 'nonstop only' : ''].filter(Boolean).join(' · ');
    }
    if(el('flights-timeoff')){el('flights-timeoff').innerHTML=timeOffHtml(all,filters);scheduleTripSave();}
    if(el('flights-assistant')) {
      var value=function(id,fallback){return el(id) && el(id).value!=='' ? el(id).value : fallback;};
      var preferences={budget:value('flights-budget',0),minNights:value('flights-min-nights',3),maxNights:value('flights-max-nights',10),extra:value('flights-extra',0),baggage:!!(el('flights-baggage') && el('flights-baggage').checked),directOnly:!!(el('flights-direct') && el('flights-direct').checked)};
      preferences.stayCost=function(d,nights){var q=quotesFor(d);return q && q.cheapest && q.cheapest.php!=null && q.nights===nights ? {total:q.cheapest.php*nights,name:q.cheapest.hotel.name}:null;};
      var result=root.FlightsCore.shortlist(rows,preferences,state.fx);
      result.items=result.items.map(function(d){return Object.assign({},d,{cityFares:cityFares[d.id] || 0,memory:d.userSupplied?null:root.FlightsCore.priceMemory(d,state.memory,asOf)});});
      var note=result.error || (result.items.length ? result.eligible+' observed return samples match your trip settings. Flight + room estimates first, then airfare-only options with hotel costs missing. Budget applies to the shown estimate; taxes and add-ons may be extra.' : preferences.directOnly ? 'No matching fare confirms nonstop flights. Turn off nonstop-only to see options with stops still to check.' : 'No fresh, comparable return fares match your trip settings. Try a wider trip length, dates or budget.');
      var oneWay=fares.filter(function(d){return ['Cebu Pacific','AirAsia','Scoot'].includes(d.airline)&&d.tripType==='one-way'&&!d.stale&&!d.expired;});
      var coverage='<p class="flight-flag">Budget-airline coverage in the fares shown: '+['Cebu Pacific','AirAsia','Scoot'].map(function(name){var count=fares.filter(function(d){return d.airline===name&&!d.stale&&!d.expired;}).length;return esc(name)+' '+(count?count+' dated samples':'no dated prices');}).join(' · ')+'. No dated prices does not mean no flights or deals are available.</p>';
      var partnerRows=root.FlightsCore.select({offers:all},Object.assign({},filters,{cabin:'All'})).filter(function(d){return d.partner && d.cabin==='Not stated'&&!d.stale&&!d.expired;});
      var partnerLane=partnerRows.length?foldSection('partner','Partner fare samples · cabin and baggage need checking · '+partnerRows.length,'<p class="flights-note">Trip.com published prices for exact dates, not direct-airline quotes. Cabin is not established by these summary cards, so they stay outside the economy shortlist.</p><div class="radar-grid">'+partnerRows.slice(0,6).map(function(d){return card(d,false);}).join('')+'</div>'):'';
      var oneWayLow=oneWay.map(farePeso).filter(function(n){return n!=null;}).sort(function(a,b){return a-b;})[0];
      var budgetLane=oneWay.length?foldSection('one-way','Budget-airline one-way fares · return leg not priced · '+oneWay.length+(oneWayLow!=null ? ' · from ≈ '+esc(pesoAmount(oneWayLow)) : ''),'<p class="flights-note">These cannot be compared with return-ticket totals. Check the return flight, baggage and fees before judging trip value.</p><div class="radar-grid">'+oneWay.slice().sort(function(a,b){return (farePeso(a)==null?Infinity:farePeso(a))-(farePeso(b)==null?Infinity:farePeso(b));}).slice(0,3).map(function(d){return card(d,false);}).join('')+'</div>'):'';
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
      el('flights-assistant').innerHTML='<div class="flights-group">Trips worth checking first</div>'+coverage+urgency+'<p class="flights-note">'+esc(note)+'</p>'+changeNote+lowNote+(result.items.length ? '<div class="radar-grid">'+result.items.map(function(d){return card(d,true);}).join('')+'</div>' : '')+
        budgetLane+partnerLane+dealsHtml(hotelDeals(regions))+localHotelsHtml('domestic','Domestic hotel deals')+localHotelsHtml('staycation','Manila staycation deals');
    }
  }
  root.showFlightAlternative=function(id) {
    var all=el('flights-all');if(all)all.open=true;
    var target=el('flight-offer-'+id), city=target && typeof target.closest==='function' ? target.closest('details.flight-city') : null;
    var region=city && typeof city.closest==='function' ? city.closest('details.flight-region') : null;
    if(region)region.open=true;
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
        '<div class="flights-note">'+esc(s.label || s.id)+' · '+(s.status==='ok'?s.offerCount+' offers read':'Unavailable to the scout')+'<br>Checked '+esc(stamp(s.checkedAt))+'</div><div>'+esc(s.message)+'</div></div>';}).join('')+'</div></details>'+
      (state.hotels ? '<p class="flights-note">Hotel rates: '+Object.keys(state.hotels.byName).length+' cities, from the booking sites Tripadvisor lists (through Xotelo), for the dates of each city’s cheapest fare; updated '+esc(stamp(state.hotels.generatedAt))+
        '. Each open city names its hotels; other dates and places link to Google Hotels.</p>' : '');
  }
  root.renderFlights=async function() {
    if(el('flight-quote-observed') && !el('flight-quote-observed').value)el('flight-quote-observed').value=new Date(Date.now()+8*3600000).toISOString().slice(0,16);
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
      owner ? root.fbLoadMeetings(uid) : Promise.resolve(null),owner && typeof root.fbLoadDaybookEvents==='function' ? root.fbLoadDaybookEvents() : Promise.resolve([]),
      owner && typeof root.fbLoadPokerHQTourneys==='function' ? root.fbLoadPokerHQTourneys() : Promise.resolve(null),
      owner && typeof root.fbLoadPokerHQBankroll==='function' ? root.fbLoadPokerHQBankroll() : Promise.resolve(null),
      typeof root.fbLoadHotels==='function' ? root.fbLoadHotels() : Promise.resolve(null),
      owner && typeof root.fbLoadHotelTrips==='function' ? root.fbLoadHotelTrips() : Promise.resolve(undefined),
      owner && typeof root.fbLoadHotelStays==='function' ? root.fbLoadHotelStays() : Promise.resolve(null)]);
    if(token!==state.token)return;
    // Without hotels-latest the page keeps its hotel search links only.
    var hotels=results[8].status==='fulfilled' && results[8].value ? root.FlightsCore.hotelIndex(results[8].value) : null;
    state.hotels=hotels && Object.keys(hotels.byName).length ? hotels : null;
    // Your saved trip dates (to save only when they change) and their prices.
    // An unreadable request document means no saving this visit.
    state.stayOverrides={};state.extraTrips=[];
    if(owner && results[9].status==='fulfilled' && results[9].value)(results[9].value.trips || []).forEach(function(t){if(t.edited){state.stayOverrides[t.id]=t;if(t.kind==='custom')state.extraTrips.push(t);}});
    state.tripsLoaded=owner && results[9].status==='fulfilled' && results[9].value!==undefined;
    state.tripsSaved=state.tripsLoaded ? tripKey(results[9].value && results[9].value.trips) : null;
    state.tripStays=owner && results[10].status==='fulfilled' && results[10].value && Array.isArray(results[10].value.trips) ? results[10].value : null;
    state.pokerhq=results[6].status==='fulfilled' && Array.isArray(results[6].value) ? results[6].value : null;
    // Only used to compute PokerHQ's own grade; the amount is never shown.
    state.pokerBankroll=results[7].status==='fulfilled' ? results[7].value : null;
    state.calError=owner && results[4].status!=='fulfilled';
    state.cal=owner && !state.calError ? {meetings:results[4].value || null,manual:results[5].status==='fulfilled' ? results[5].value || [] : []} : null;
    // Without the price memory the board simply omits its comparisons.
    state.memory=results[3].status==='fulfilled' && results[3].value ? root.FlightsCore.memoryIndex(results[3].value) : null;
    state.fx=results[2].status==='fulfilled' ? results[2].value : null;
    state.prefsUnavailable=results[1].status!=='fulfilled';state.saved=state.prefsUnavailable?{}:results[1].value || {};
    if(results[0].status!=='fulfilled') {
      if(el('flights-assistant'))el('flights-assistant').innerHTML=localHotelsHtml('domestic','Domestic hotel deals')+localHotelsHtml('staycation','Manila staycation deals');
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
  root.saveFlightQuote=async function(form) {
    var status=el('flight-quote-status');if(state.saving)return;if(state.prefsUnavailable){status.textContent='Your saved shortlist could not load. Reload before saving a quote.';return;}
    var read=function(name){return form.elements.namedItem(name).value;};
    var bytes=new Uint8Array(10);root.crypto.getRandomValues(bytes);var id=Array.from(bytes).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    var quote=root.FlightsCore.manualQuote({airline:read('airline'),origin:read('origin'),destination:read('destination'),departureDate:read('departureDate'),returnDate:read('returnDate'),passengers:read('passengers'),total:read('total'),observedAt:read('observedAt')+'+08:00',baggageKg:read('baggageKg'),taxes:read('taxes'),stops:read('stops'),link:read('link')},id);
    if(!quote){status.textContent='Check the route, future dates, total, travellers and quote time (Philippine time, within seven days). Use an official airline or Trip.com link.';return;}
    var previous=Object.values(state.saved).find(function(d){return d.userSupplied&&d.airline===quote.airline&&d.origin===quote.origin&&d.destination===quote.destination&&d.departureDate===quote.departureDate&&d.returnDate===quote.returnDate&&d.passengers===quote.passengers;});if(previous)quote.id=previous.id;
    var token=state.token;state.saving=true;status.textContent='Saving your private quote…';
    try{var saved=await root.fbSetSavedFlight(quote,true);if(token!==state.token)return;state.saved=saved||{};state.saving=false;root.renderFlightOffers();status.textContent='Quote saved privately. It appears under its destination mode and date filters; fresh economy quotes join the comparison. Quotes older than 26 hours need rechecking.';}
    catch(error){if(token!==state.token)return;state.saving=false;status.textContent=error.message||'Quote could not save. Try again.';}
  };
  root.openFlightQuote=function() {
    var panel=el('flight-quote-panel');if(!panel)return;
    panel.open=true;
    if(typeof panel.scrollIntoView==='function')panel.scrollIntoView({behavior:'smooth',block:'start'});
    var form=el('flight-quote-form'),destination=form&&form.elements&&form.elements.namedItem('destination');
    if(destination&&typeof destination.focus==='function')destination.focus({preventScroll:true});
  };
})(typeof window!=='undefined'?window:globalThis);
