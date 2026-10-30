(function(root){
  'use strict';
  // Explore → Rentals. Reads the daily scout feed and Bob's private search
  // (rentals-prefs-<uid>: budget, areas, sizes, furnishing, shortlist, hidden).
  var C=root.RentalsCore,state={token:0,feed:null,prefs:C.cleanPrefs(),available:false,busy:false};
  var el=function(id){return document.getElementById(id);},esc=function(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
  var money=function(v){return '₱'+Math.round(Number(v)).toLocaleString('en-PH');};
  var stamp=function(v){var d=Date.parse(v);return Number.isFinite(d)?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(d))+' PHT':'not checked';};
  var day=function(v){var d=Date.parse(v);return Number.isFinite(d)?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric'}).format(new Date(d)):'';};
  var areaName=function(id){var a=C.AREAS.find(function(x){return x.id===id;});return a?a.name:id;};
  var sizeName=function(i){var k=C.sizeOf(i);return k==='studio'?(i.beds===0?'Studio':'Studio (bedrooms not stated)'):k==='1br'?'1 bedroom':'Bedrooms not stated';};
  function notice(t){if(el('rentals-status'))el('rentals-status').textContent=t;}
  function out(url,label){var u=C.safeUrl(url);return u?'<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+' ↗</a>':'';}
  function filters(){return {area:el('rentals-area').value,size:el('rentals-size').value,view:el('rentals-view').value,sort:el('rentals-sort').value};}
  function valueHtml(i){
    var v=C.value(i,state.feed);if(!v)return '<p class="flights-note">'+(C.sizeOf(i)==='unknown'?'No bedroom count, so no comparison with '+esc(areaName(i.area))+'.':'Too few listings of this size in '+esc(areaName(i.area))+' to compare.')+'</p>';
    var what=areaName(i.area)+' '+(C.sizeOf(i)==='studio'?'studio':'1-bedroom')+' median ('+(v.basis==='perSqm'?money(v.median)+'/m²':money(v.median)+' a month')+', '+v.n+' listings)';
    var cls=v.pct<=-10?'low':v.pct>=10?'high':'mid';
    return '<p class="rental-value rental-value-'+cls+'">'+(Math.abs(v.pct)<3?'About the '+esc(what):Math.abs(v.pct)+'% '+(v.pct<0?'below':'above')+' the '+esc(what))+'</p>';
  }
  function checks(i){
    var c=[];
    if(i.textPrice)c.push('The description mentions '+money(i.textPrice)+' a month; ask which is right.');
    if(i.stay==='both')c.push('Short stays are offered too; confirm a long lease.');
    if(C.stale(i))c.push('Last updated '+day(i.updatedAt)+'; ask if it is still available.');
    if(i.priceFrom)c.push('Rent from '+money(i.price)+'; units in this listing differ.');
    if(!i.detailAt)c.push('Listing page not read yet; terms come from the card only.');
    return c;
  }
  function card(i){
    var saved=state.prefs.saved[i.id],hidden=state.prefs.hidden.indexOf(i.id)>=0,dis=!state.available || state.busy?' disabled':'',t=C.terms(i),m=C.moveIn(i),img=C.imageUrl(i.image);
    var tags=[C.isNew(i,state.feed)?'New':'',C.dropped(i)?'Down from '+money(i.previousPrice):'',i.furnish || '',i.stay==='long'?'Long lease':''].filter(Boolean);
    var place=[areaName(i.area),i.locality,i.near?'near '+i.near:''].filter(Boolean).join(' · ');
    var heading=i.building || (sizeName(i)+(i.locality?' in '+i.locality.split(',')[0]:''));
    var check=checks(i);
    return '<article class="deal-card rental-card">'+(img?'<img class="rental-photo" src="'+esc(img)+'" alt="" loading="lazy" referrerpolicy="no-referrer">':'')+
      '<p class="flights-note">'+esc(place)+'</p><h3>'+esc(heading)+'</h3>'+
      '<p class="rental-price">'+money(i.price)+' <span>a month</span></p>'+
      '<p>'+esc(sizeName(i))+(i.sqm?' · '+esc(i.sqm)+' m² · '+money(i.price/i.sqm)+'/m²':' · size not stated')+'</p>'+valueHtml(i)+
      (tags.length?'<p class="rental-tags">'+tags.map(function(x){return '<span>'+esc(x)+'</span>';}).join('')+'</p>':'')+
      '<p><b>Terms:</b> '+(t.length?esc(t.join(' · ')):'not stated in the listing')+'</p>'+
      '<p><b>Move-in cash:</b> '+(m.partial?'at least ':'about ')+money(m.amount)+(m.stated?' ('+m.months+' month'+(m.months===1?'':'s')+' as stated'+(m.partial?'; the rest not stated':'')+')':' if it is the usual 2 months deposit + 1 month advance (not stated)')+'. Confirm other fees'+(i.duesIncluded!==true?' and association dues':'')+'.</p>'+
      (check.length?'<p class="rental-check"><b>Check:</b> '+esc(check.join(' '))+'</p>':'')+
      '<p class="flights-note">'+esc([i.seller,i.verified && i.source==='DotProperty'?'verified seller':'',i.source,i.firstSeen?'first seen '+day(i.firstSeen):''].filter(Boolean).join(' · '))+
      (i.also && i.also.length?' · also posted '+i.also.map(function(a,n){return out(a.url,(a.seller || a.source)+(i.also.length>1?' '+(n+1):''));}).join(' '):'')+'</p>'+
      '<div class="flight-actions">'+out(i.url,'Open listing')+' <button class="tool-chip" onclick="prepareRentalEnquiry(\''+i.id+'\')">Agent enquiry</button> '+
      (hidden?'<button class="tool-chip"'+dis+' onclick="hideRental(\''+i.id+'\',false)">Show again</button>':
        '<button class="tool-chip"'+dis+' aria-pressed="'+!!saved+'" onclick="shortlistRental(\''+i.id+'\')">'+(saved?'Shortlisted · remove':'Shortlist')+'</button> <button class="tool-chip"'+dis+' onclick="hideRental(\''+i.id+'\',true)">Hide</button>')+'</div>'+
      (saved?'<label class="rental-stage">Stage <select'+dis+' onchange="setRentalStage(\''+i.id+'\',this.value)">'+C.STATUSES.map(function(s){return '<option'+(s===saved.status?' selected':'')+'>'+esc(s)+'</option>';}).join('')+'</select></label>':'')+
      '</article>';
  }
  // Typical rent in each of Bob's areas, from this morning's listings.
  function typicalHtml(){
    var b=state.feed.benchmarks || {},rows=state.prefs.areas.map(function(a){var x=b[a] || {},cell=function(k){var r=x[k];return r?money(r.medianRent)+(r.medianPerSqm?'<span> · '+money(r.medianPerSqm)+'/m²</span>':'')+'<span> · '+r.n+'</span>':'<span>too few</span>';};return '<tr><th>'+esc(areaName(a))+'</th><td>'+cell('studio')+'</td><td>'+cell('1br')+'</td></tr>';}).join('');
    return '<table class="rental-typical"><caption>Scouted rents · median, rent per m², listings · '+esc(day(state.feed.generatedAt))+'<br>Only the two sources up to '+money(C.MAX_BUDGET)+'; this is not the full market. Dues and furnishing vary.</caption><thead><tr><th scope="col">Area</th><th scope="col">Studio</th><th scope="col">1 bedroom</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }
  root.renderRentalList=function(){
    var feed=state.feed,p=state.prefs;
    if(!feed){el('rentals-glance').innerHTML='';el('rentals-coverage').innerHTML='';el('rentals-summary').textContent='';el('rentals-results').innerHTML='<p class="flights-note">No rentals scout saved yet. The places to look below still work.</p>';moreHtml();return;}
    var f=filters(),rows=C.matchItems(feed,p,f),all=C.matchItems(feed,p,{});
    var fresh=all.filter(function(i){return C.isNew(i,feed);}).length,drops=all.filter(C.dropped).length,old=!Number.isFinite(Date.parse(feed.generatedAt)) || Date.now()-Date.parse(feed.generatedAt)>36*3600000;
    el('rentals-glance').innerHTML='<div><b>'+all.length+'</b><span>Within '+money(p.budget)+' in your areas</span></div><div><b>'+fresh+' · '+drops+'</b><span>New in 3 days · price drops</span></div><div><b>'+Object.keys(p.saved).length+'</b><span>On your shortlist</span></div><div><b>'+esc(stamp(feed.generatedAt))+'</b><span>Scout'+(old?' · late; the next run may still be on its way':'')+'</span></div>'+typicalHtml();
    var label={all:'',new:' new in the last 3 days',drops:' with a price drop',shortlist:' on your shortlist',hidden:' hidden'}[f.view] || '';
    // Absence may reflect coverage or a failed source, not a completed lease.
    var missing=Object.keys(p.saved).filter(function(id){return !(feed.items || []).some(function(i){return i.id===id;});}),gone=missing.length;
    el('rentals-summary').textContent=rows.length+' condo'+(rows.length===1?'':'s')+label+(f.view==='shortlist'?(gone?' · '+gone+' shortlisted listing'+(gone===1?' is':'s are')+' missing from this scout; availability unknown':''):f.view==='hidden'?'':' · '+[f.area?areaName(f.area):'all your areas',f.size?(f.size==='studio'?'studios':'1 bedrooms'):'studio and 1 bedroom','up to '+money(p.budget)].join(' · '));
    el('rentals-results').innerHTML=rows.length?'<div class="deal-grid">'+rows.slice(0,12).map(card).join('')+'</div>'+(rows.length>12?'<details class="rental-more"><summary>Show '+(rows.length-12)+' more</summary><div class="deal-grid">'+rows.slice(12,200).map(card).join('')+'</div></details>':''):
      '<p class="flights-note">'+(f.view==='shortlist'?(Object.keys(p.saved).length?'No available shortlist cards match these area and size filters. Missing listings are listed below.':'Nothing shortlisted yet. Tap Shortlist on a listing to keep it here with its stage.'):f.view==='hidden'?'No hidden listings match these area and size filters.':'No condos match. Try another area or size, or raise the budget in Your search.')+'</p>';
    if(f.view==='shortlist' && missing.length)el('rentals-results').innerHTML+='<section class="rental-missing"><h3>Missing from this scout</h3><p class="flights-note">A listing may be outside the scout’s coverage or temporarily unavailable. This does not confirm it has been let. These saved stages are kept until you remove them.</p><ul>'+missing.map(function(id){return '<li><span>'+esc(id)+' · '+esc(p.saved[id].status)+'</span> <button class="tool-chip"'+(!state.available || state.busy?' disabled':'')+' onclick="shortlistRental(\''+id+'\')">Remove from shortlist</button></li>';}).join('')+'</ul></section>';
    moreHtml();
    el('rentals-coverage').innerHTML='<summary>Where these come from</summary><p class="flights-note">'+esc(feed.coverage || '')+' Listing pages read this run: '+Number(feed.details && feed.details.read || 0)+'; carried from earlier runs: '+Number(feed.details && feed.details.carried || 0)+'. Parking slots, bed spaces and anything under ₱8,000 are left out. One unit posted by several agents shows once, with the other posts as links.</p>'+
      (feed.sources || []).map(function(s){return '<p class="flights-note"><b>'+esc(s.site)+' · '+esc(areaName(s.area))+'</b> · '+esc(s.loc)+' · '+esc(s.status)+' · '+esc(s.message)+' '+out(s.url,'Open')+'</p>';}).join('');
  };
  function moreHtml(){
    el('rentals-more').innerHTML='<h3>More places to look</h3><p class="flights-note">These sites block automated reads, so check them yourself. Many Metro Manila rentals are also posted only in Facebook groups or kept by a building’s admin office; ask at the lobby of a building you like.</p><ul class="rental-links">'+
      state.prefs.areas.map(function(a){return '<li><b>'+esc(areaName(a))+'</b> · '+C.searchLinks(a,state.prefs.budget).map(function(l){return '<a href="'+esc(l.url)+'" target="_blank" rel="noopener noreferrer">'+esc(l.site)+' ↗</a>';}).join(' · ')+'</li>';}).join('')+'</ul>';
  }
  function searchForm(){
    var p=state.prefs,dis=state.available?'':' disabled',box=function(name,list,on){return list.map(function(x){return '<label><input type="checkbox" name="'+name+'" value="'+x.id+'"'+(on.indexOf(x.id)>=0?' checked':'')+'> '+esc(x.name || x.label)+'</label>';}).join(' ');};
    el('rentals-search').innerHTML='<summary>Your search · '+money(p.budget)+' · '+p.areas.map(areaName).join(', ')+'</summary><form onsubmit="event.preventDefault();saveRentalSearch(this)"><fieldset'+dis+'><legend>Saved privately to your account</legend>'+
      '<div class="flights-controls"><label>Top monthly rent<input name="budget" type="number" min="5000" max="'+C.MAX_BUDGET+'" step="500" value="'+p.budget+'" required></label><label>Furnishing<select name="furnish">'+C.FURNISH.map(function(f){return '<option value="'+f[0]+'"'+(f[0]===p.furnish?' selected':'')+'>'+esc(f[1])+'</option>';}).join('')+'</select></label></div>'+
      '<div class="shopping-options">'+box('area',C.AREAS,p.areas)+'</div><div class="shopping-options">'+box('size',C.SIZES,p.sizes)+'<label><input type="checkbox" name="hideShortStays"'+(p.hideShortStays?' checked':'')+'> Hide short-stay listings</label></div>'+
      '<p class="flights-note">The scout reads up to '+money(C.MAX_BUDGET)+' a month, so the budget stops there. A listing whose text doesn’t give furnishing only shows under Any furnishing. Listings with no bedroom count stay in view.</p><button class="tool-chip" type="submit">Save search</button></fieldset></form>';
  }
  async function persist(next){
    if(!state.available || state.busy)return false;
    var token=state.token;state.busy=true;root.renderRentalList();
    try{await root.fbSaveRentalPrefs(C.cleanPrefs(next));if(token!==state.token)return false;state.prefs=C.cleanPrefs(next);notice('Saved to your account.');return true;}
    catch(e){if(token===state.token)notice('Could not save. Your earlier choices are kept.');return false;}
    finally{if(token===state.token){state.busy=false;root.renderRentalList();}}
  }
  root.saveRentalSearch=async function(form){
    var pick=function(name){return Array.from(form.querySelectorAll('input[name="'+name+'"]:checked')).map(function(n){return n.value;});};
    var next=Object.assign({},state.prefs,{budget:Number(form.elements.namedItem('budget').value),furnish:form.elements.namedItem('furnish').value,areas:pick('area'),sizes:pick('size'),hideShortStays:form.elements.namedItem('hideShortStays').checked});
    if(!next.areas.length || !next.sizes.length){notice('Pick at least one area and one size.');return;}
    if(await persist(next)){searchForm();root.renderRentalList();}
  };
  root.shortlistRental=async function(id){var next=C.cleanPrefs(state.prefs);if(next.saved[id])delete next.saved[id];else next.saved[id]={status:C.STATUSES[0],at:new Date().toISOString()};if(await persist(next))root.renderRentalList();};
  root.setRentalStage=async function(id,status){var next=C.cleanPrefs(state.prefs);if(!next.saved[id])return;next.saved[id]={status:status,at:new Date().toISOString()};if(await persist(next))root.renderRentalList();};
  root.prepareRentalEnquiry=function(id){
    var i=(state.feed && state.feed.items || []).find(function(x){return x.id===id;});if(!i || !C.safeUrl(i.url))return;
    var panel=el('rentals-enquiry');panel.hidden=false;
    panel.innerHTML='<h3>Enquiry for '+esc(i.building || sizeName(i))+'</h3><p class="flights-note">Edit this draft, then copy it into the listing’s contact form or your messaging app.</p><label for="rentals-enquiry-text">Message to agent</label><textarea id="rentals-enquiry-text" rows="10">'+esc(C.enquiry(i))+'</textarea><div class="flight-actions"><button class="tool-chip" onclick="copyRentalEnquiry()">Copy message</button><button class="tool-chip" onclick="closeRentalEnquiry()">Close draft</button></div>';
    panel.scrollIntoView({block:'center',behavior:'smooth'});el('rentals-enquiry-text').focus();
  };
  root.closeRentalEnquiry=function(){el('rentals-enquiry').hidden=true;el('rentals-enquiry').innerHTML='';};
  root.copyRentalEnquiry=async function(){
    var token=state.token,message=el('rentals-enquiry-text');if(!message)return;
    try{await root.navigator.clipboard.writeText(message.value);if(token===state.token)notice('Enquiry copied. Paste it into your message to the agent.');}
    catch(e){if(token===state.token){message.focus();message.select();notice('Select and copy the draft with Ctrl+C or Cmd+C.');}}
  };
  root.hideRental=async function(id,hide){var next=C.cleanPrefs(state.prefs);next.hidden=next.hidden.filter(function(x){return x!==id;});if(hide){next.hidden.push(id);delete next.saved[id];}if(await persist(next))root.renderRentalList();};
  root.openRentalSearch=function(){var d=el('rentals-search');d.open=true;d.scrollIntoView({block:'start',behavior:'smooth'});};
  root.renderRentals=async function(){
    if(state.busy){notice('Saving your changes; reload once the save finishes.');return;}
    var token=++state.token;state.busy=false;state.available=false;notice('Loading the latest scout…');
    searchForm();root.renderRentalList();
    try{var r=await root.fbLoadRentals();if(token!==state.token)return;state.feed=r.feed;state.prefs=C.cleanPrefs(r.prefs);state.available=true;notice(r.feed?'':'No rentals scout saved yet; the first daily run is at 07:00 PHT.');}
    catch(e){if(token!==state.token)return;state.available=false;notice(e && e.message?e.message:'Could not load rentals.');}
    searchForm();root.renderRentalList();
  };
  // Sign-out: drop the feed and the private search, and any late load.
  root.resetRentals=function(){state.token++;state.feed=null;state.prefs=C.cleanPrefs();state.available=false;state.busy=false;root.closeRentalEnquiry();['rentals-glance','rentals-results','rentals-more','rentals-search','rentals-coverage'].forEach(function(id){if(el(id))el(id).innerHTML='';});['rentals-summary','rentals-status'].forEach(function(id){if(el(id))el(id).textContent='';});};
})(typeof globalThis!=='undefined'?globalThis:this);
