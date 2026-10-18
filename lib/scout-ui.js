(function(root){
  'use strict';
  if(typeof document==='undefined')return;
  var state={token:0,feed:null,choices:{},prefs:null,calendar:null,cpe:null,editStart:false,busy:false,building:0,loaded:false};
  var C=root.ScoutCore,el=function(id){return document.getElementById(id);};
  function esc(v){return String(v||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function notice(v){if(el('scout-status'))el('scout-status').textContent=v;}
  // A build waits about two minutes on the search and the page checks: the
  // app's turning ring and a timer count up, with "longer than usual" past three.
  function working(text,since){var s=el('scout-status');if(!s)return;if(typeof root.aiWorkingHtml==='function')s.innerHTML=root.aiWorkingHtml(text,{since:since,slow:180});else s.textContent=text+'…';}
  function items(){var map={};Object.values(state.choices).forEach(function(c){var v=c&&C.clean([c.item])[0];if(v)map[v.id]=v;});C.clean(state.feed&&state.feed.items).forEach(function(v){map[v.id]=v;});return Object.values(map);}
  function meets(v){var parts=[];if(v.nextActive)parts.push('Next meets '+v.nextActive);if(v.lastActive)parts.push('Last met '+v.lastActive);
    return parts.length?'Community · '+parts.join(' · ')+(v.activityCheck==='unchecked'?' · its page could not be read to check':''):'Ongoing community · check the source for meetings';}
  // The work calendar (functions/scout-sources.js): every listed event you can
  // join from Manila, by date, with its CPD points; in-person ones are folded.
  var WEEKDAY=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function dayLabel(iso){var d=new Date(iso+'T00:00:00Z');return isNaN(d)?iso:WEEKDAY[d.getUTCDay()]+' '+d.getUTCDate()+' '+MON[d.getUTCMonth()];}
  // Attended (or Going, for a session still to come) logs it toward the CIA year.
  function cpeButton(v,today){var on=!!(state.cpe&&state.cpe.entries&&state.cpe.entries[v.id]),soon=(v.start||'')>today;
    return '<button class="tool-chip scout-cpe-btn" data-cpe-id="'+esc(v.id)+'" aria-pressed="'+on+'" '+(state.busy?'disabled':'')+'>'+(soon?'Going':'Attended')+(on?' ✓':'')+'</button>';}
  var n1=function(n){return String(Math.round(n*10)/10);};
  function bar(have,need){return '<span class="scout-bar" aria-hidden="true"><i style="width:'+Math.min(100,Math.round(100*have/(need||1)))+'%"></i></span>';}
  // The CIA CPE card: hours toward 40 and ethics toward 2 by 31 December.
  function cpeHtml(today){
    var s=C.cpeSummary(state.cpe,today),form=!s.hasStart||state.editStart;
    return '<section class="scout-cpe"><h2 class="flights-group">CIA CPE '+esc(s.year)+'</h2>'+
      '<div class="scout-cpe-bars"><div><b>'+n1(s.earned)+'</b> of '+s.target+' hours '+bar(s.earned,s.target)+'</div><div><b>'+n1(s.ethics)+'</b> of '+s.ethicsTarget+' on ethics '+bar(s.ethics,s.ethicsTarget)+'</div></div>'+
      '<p class="flights-note">'+(s.daysLeft>=0?s.daysLeft+' day'+(s.daysLeft===1?'':'s')+' to 31 December. ':'')+(s.booked?'Booked: '+n1(s.booked)+' hour'+(s.booked===1?'':'s')+' in sessions still to come'+(s.bookedEthics?' ('+n1(s.bookedEthics)+' on ethics)':'')+'. ':'')+
      (s.hasStart&&!form?'Includes the '+n1(s.start)+' hour'+(s.start===1?'':'s')+(s.startEthics?' ('+n1(s.startEthics)+' on ethics)':'')+' you had before logging here. <button class="tool-chip" onclick="editCpeStart()">Change</button>':'')+'</p>'+
      (form?'<div class="flights-controls scout-cpe-start"><label>Hours you already have for '+esc(s.year)+'<input id="scout-cpe-start" type="number" min="0" step="0.5" inputmode="decimal" value="'+(s.hasStart?n1(s.start):'')+'"></label><label>of which on ethics<input id="scout-cpe-ethics" type="number" min="0" step="0.5" inputmode="decimal" value="'+(s.hasStart?n1(s.startEthics):'')+'"></label></div><div class="flight-actions"><button class="tool-chip" onclick="saveCpeStart()" '+(state.busy?'disabled':'')+'>Save starting hours</button></div><p class="flights-note">From your IIA CPE record for this year. Then tap Attended on any session below and it adds up here.</p>':'')+
      (s.entries.length?'<details class="flight-fold"><summary class="flights-note">Logged in '+esc(s.year)+' ('+s.entries.length+')</summary><ol class="scout-cal">'+s.entries.map(function(e){
        return '<li class="scout-cal-row"><span class="scout-cal-when">'+esc(dayLabel(e.date))+(e.date>today?'<br>to come':'')+'</span><span class="scout-cal-what">'+(e.url?'<a href="'+esc(e.url)+'" target="_blank" rel="noopener noreferrer">'+esc(e.title)+'</a>':esc(e.title))+
          '<span class="scout-cpe-edit"><label>Hours <input type="number" min="0" step="0.5" value="'+n1(e.hours)+'" data-cpe-hours="'+esc(e.id)+'"></label><label><input type="checkbox" data-cpe-ethics="'+esc(e.id)+'"'+(e.ethics?' checked':'')+'> Ethics</label><button class="tool-chip" data-cpe-remove="'+esc(e.id)+'">Remove</button></span>'+
          '<span class="flights-note">'+esc([e.organizer,e.iia?'IIA CPE':'counts only if relevant to internal auditing: your call'].filter(Boolean).join(' · '))+'</span></span></li>';}).join('')+'</ol></details>':'')+
      '<p class="flights-note">The IIA gives webinar CPE for the live broadcast only. Philippine CPA: PRC accepts a CPD Undertaking for renewals until 31 Dec 2026, and from January 2027 self-directed learning and work experience also earn units (PRC Res. 2165, s. 2026). Your CPD units are not tracked here; check your requirement with PRC.</p></section>';
  }
  function calendarHtml(cal,today){
    var all=Object.values((cal&&cal.items)||{}).sort(function(a,b){return (a.start+(a.time||'')).localeCompare(b.start+(b.time||''));});
    var since=new Date(Date.parse(today+'T00:00:00Z')-14*86400000).toISOString().slice(0,10);
    var rows=all.filter(function(v){return (v.end||v.start)>=today;}),recent=all.filter(function(v){var end=v.end||v.start;return end<today&&end>=since;}).reverse();
    var join=rows.filter(function(v){return v.format!=='in-person';}),away=rows.filter(function(v){return v.format==='in-person';});
    var sources=(cal&&cal.sources)||[],failed=sources.filter(function(s){return !s.ok;});
    var line=function(v){var topic=C.workMatch(v),meta=[v.organizer,C.formats[v.format]||'',v.cpd,C.access[v.access]||'',v.cost].filter(Boolean);
      return '<li class="scout-cal-row"><span class="scout-cal-when">'+esc(dayLabel(v.start)+(v.end&&v.end!==v.start?' – '+dayLabel(v.end):''))+'<br>'+esc(v.pht||v.time||'Time on the page')+'</span><span class="scout-cal-what"><a href="'+esc(v.url)+'" target="_blank" rel="noopener noreferrer">'+esc(v.title)+'</a>'+
        (C.isNew(v,cal.startedOn,today)?' <span class="scout-new">New</span>':'')+(topic?' <span class="scout-topic">On your work: '+esc(topic)+'</span>':'')+'<span class="flights-note">'+esc(meta.join(' · '))+'</span>'+cpeButton(v,today)+'</span></li>';};
    return '<section class="scout-calendar"><h2 class="flights-group">Work calendar · join from Manila</h2>'+
      '<p class="flights-note">Read straight from '+esc(sources.map(function(s){return s.label;}).join(', ')||'the organisers')+(cal&&cal.refreshedAt?', checked '+esc(new Date(cal.refreshedAt).toLocaleString('en-GB',{timeZone:'Asia/Manila',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))+' PHT':'')+'. '+
      (failed.length?esc(failed.map(function(s){return s.label;}).join(' and '))+' could not be read then; their events are from the last good read. ':'')+
      (cal&&cal.searched&&cal.searched.length?'The weekly search covers '+esc(cal.searched.join(', '))+'.':'')+'</p>'+
      (join.length?'<ol class="scout-cal">'+join.map(line).join('')+'</ol>':'<p class="flights-note">No listed events you can join online in the next 120 days.</p>')+
      (recent.length?'<details class="flight-fold"><summary class="flights-note">'+recent.length+' session'+(recent.length===1?'':'s')+' ended in the last two weeks: log any you attended</summary><ol class="scout-cal">'+recent.map(line).join('')+'</ol></details>':'')+
      (away.length?'<details class="flight-fold"><summary class="flights-note">'+away.length+' in-person event'+(away.length===1?'':'s')+' in Australia and New Zealand</summary><ol class="scout-cal">'+away.map(line).join('')+'</ol></details>':'')+'</section>';
  }
  function card(v){var c=state.choices[v.id]||{},old=C.expired(v,C.today()),id=esc(v.id),fresh=state.feed&&C.isNew(v,state.feed.startedOn,C.today());
    return '<article class="deal-card scout-card"><div class="flights-note">'+(fresh?'<span class="scout-new">New</span> ':'')+esc(v.organizer||C.lanes[v.lane])+(old?' · Past / registration closed':'')+'</div><h3>'+esc(v.title)+'</h3><p>'+esc(v.why)+'</p><dl><dt>When</dt><dd>'+esc(v.start?(v.start+(v.end!==v.start?' – '+v.end:'')+(v.pht||v.when?' · '+(v.pht||v.when):'')+(v.dateCheck==='not-found'?' · not found on its page, check before you plan':v.dateCheck==='unchecked'?' · its page could not be read to check the date':'')):meets(v))+'</dd><dt>Where</dt><dd>'+esc(v.location+(C.formats[v.format]?' · '+C.formats[v.format]:''))+'</dd><dt>Cost</dt><dd>'+esc(v.cost)+'</dd>'+(C.access[v.access]?'<dt>Who</dt><dd>'+esc(C.access[v.access])+'</dd>':'')+'<dt>Register by</dt><dd>'+esc(v.deadline?v.deadline+(v.deadlineCheck==='not-found'?' · not found on its page':''):'Deadline not listed')+'</dd></dl><a href="'+esc(v.url)+'" target="_blank" rel="noopener noreferrer">View source & registration ↗</a><div class="flight-actions">'+['saved','interested','more','hidden'].map(function(a,i){return '<button class="tool-chip" data-scout-id="'+id+'" data-scout-action="'+a+'" aria-pressed="'+!!c[a]+'" '+(state.busy?'disabled':'')+'>'+([c.saved?'Saved ✓':'Save',c.interested?'Interested ✓':'Interested',c.more?'More like this ✓':'More like this',c.hidden?'Unhide':'Hide'][i])+'</button>';}).join('')+(v.lane==='work'&&v.start?cpeButton(v,C.today()):'')+'</div></article>';
  }
  function today(){var out=el('scout-today');if(!out)return;var rows=C.due(items(),state.choices,C.today());out.hidden=!rows.length;out.innerHTML=rows.length?'<h3>Scout · deadlines coming up</h3>'+rows.map(function(v){return '<p><a href="'+esc(v.url)+'" target="_blank" rel="noopener noreferrer">'+esc(v.title)+'</a> · register by '+esc(v.deadline)+'</p>';}).join('')+'<button class="tool-chip" onclick="switchPage(\'scout\',null)">Open Scout</button>':'';}
  function paint(){
    var out=el('scout-results');if(!out)return;
    if(el('scout-cpe'))el('scout-cpe').innerHTML=state.loaded?cpeHtml(C.today()):'';
    var build=el('scout-build');if(build){build.disabled=state.busy;build.textContent=state.building?'Scouting…':'Scout opportunities';}
    if(el('scout-save-prefs'))el('scout-save-prefs').disabled=state.busy;
    var mode=el('scout-view').value,lane=el('scout-lane').value,day=C.today();
    var rows=items().filter(function(v){var c=state.choices[v.id]||{};return (!lane||v.lane===lane)&&(mode==='hidden'?c.hidden:!c.hidden)&&(mode==='saved'?(c.saved||c.interested):mode==='hidden'||!C.expired(v,day));});
    rows.sort(function(a,b){return (a.dateCheck==='not-found')-(b.dateCheck==='not-found')||(a.deadline||a.start||'9999').localeCompare(b.deadline||b.start||'9999');});
    var fresh=state.feed&&state.feed.generatedAt;
    el('scout-updated').textContent=fresh?'Last scouted '+new Date(fresh).toLocaleString('en-GB',{timeZone:'Asia/Manila'})+' PHT'+(Date.now()-Date.parse(fresh)>7*86400000?' · weekly refresh due':''):'Your first shortlist is ready to scout.';
    // A lane the latest build left empty still shows, saying why (feed.checks).
    var checks=mode==='all'&&state.feed&&state.feed.checks,stat=function(k){return ((checks&&checks.lanes)||{})[k];};
    var calendar=mode==='all'&&(!lane||lane==='work')&&state.calendar?calendarHtml(state.calendar,day):'';
    out.innerHTML=calendar+(Object.keys(C.lanes).filter(function(k){return rows.some(function(v){return v.lane===k;})||(checks&&(!lane||lane===k)&&!(stat(k)||{}).kept);}).map(function(k){var mine=rows.filter(function(v){return v.lane===k;});
      return '<h2 class="flights-group">'+esc(C.lanes[k])+'</h2>'+(mine.length?'<div class="deal-grid">'+mine.map(card).join('')+'</div>':'<p class="flights-note scout-empty">'+esc(C.laneNote(stat(k)))+'</p>');}).join('')||(calendar?'':'<p class="flights-note">'+(state.feed?'No matching opportunities. Try another view, adjust your interests, or scout again.':'Build your first shortlist to find upcoming events and communities around your work and interests.')+'</p>'));
    today();
  }
  root.resetScout=function(){state={token:state.token+1,feed:null,choices:{},prefs:null,calendar:null,cpe:null,editStart:false,busy:false,building:0,loaded:false};if(el('scout-results'))el('scout-results').innerHTML='';if(el('scout-cpe'))el('scout-cpe').innerHTML='';if(el('scout-today')){el('scout-today').hidden=true;el('scout-today').innerHTML='';}if(el('scout-interests'))el('scout-interests').value='';if(el('scout-geography'))el('scout-geography').value='';notice('');};
  root.renderScout=async function(){
    if(state.loaded){paint();return;}var token=++state.token;
    try{notice('Loading Scout…');var data=await root.fbLoadScout();if(token!==state.token)return;
      state.feed=data.feed;state.choices=data.choices||{};state.prefs=C.prefs(data.prefs);state.calendar=data.calendar||null;state.cpe=data.cpe||null;state.loaded=true;
      el('scout-interests').value=state.prefs.interests;el('scout-geography').value=state.prefs.geography;paint();notice('');
    }catch(e){if(token===state.token)notice('Scout could not load: '+e.message);}
  };
  root.paintScout=paint;
  root.reloadScout=function(){if(state.busy)return;state.loaded=false;return root.renderScout();};
  root.saveScoutPreferences=async function(){if(state.busy||!state.loaded)return;var token=state.token;state.busy=true;paint();
    try{var p=C.prefs({interests:el('scout-interests').value,geography:el('scout-geography').value});await root.fbSaveScoutPrefs(p);if(token!==state.token)return;state.prefs=p;notice('Preferences saved. They will shape your next scout.');}
    catch(e){if(token===state.token)notice('Preferences could not save: '+e.message);}finally{if(token===state.token){state.busy=false;paint();}}
  };
  root.buildScout=async function(){if(state.busy||!state.loaded)return;var token=state.token;state.busy=true;state.building=Date.now();paint();working('Searching organiser pages, then checking each date on its own page',state.building);
    try{var p=C.prefs({interests:el('scout-interests').value,geography:el('scout-geography').value});await root.fbSaveScoutPrefs(p);if(token!==state.token)return;state.prefs=p;var result=await root.fbBuildScout();if(token!==state.token)return;state.feed=result;try{var fresh=await root.fbLoadScout();if(token===state.token)state.calendar=fresh.calendar||state.calendar;}catch(e){}notice('Shortlist updated. Check the source for current registration and availability.');}
    catch(e){if(token===state.token)notice('Scout could not finish: '+e.message);}finally{if(token===state.token){state.busy=false;state.building=0;paint();}}
  };
  // Every CPE change is one transaction on cpe-<uid> (fbUpdateCpe).
  async function cpeChange(change,done){if(state.busy||!state.loaded)return;var token=state.token;state.busy=true;paint();
    try{var next=await root.fbUpdateCpe(change);if(token!==state.token)return;state.cpe=next;if(done)done();notice(change.op==='toggle'?'CPE log updated.':'Saved.');}
    catch(e){if(token===state.token)notice('CPE could not save: '+e.message);}finally{if(token===state.token){state.busy=false;paint();}}}
  root.saveCpeStart=function(){return cpeChange({op:'start',year:C.today().slice(0,4),start:el('scout-cpe-start').value,ethics:el('scout-cpe-ethics').value},function(){state.editStart=false;});};
  root.editCpeStart=function(){state.editStart=true;paint();};
  function sessionById(id){var cal=state.calendar&&state.calendar.items&&state.calendar.items[id];return cal||items().find(function(v){return v.id===id;});}
  document.addEventListener('click',function(event){var t=event.target,b=t.closest&&t.closest('[data-cpe-id],[data-cpe-remove]');if(!b)return;
    if(b.dataset.cpeRemove)return cpeChange({op:'remove',id:b.dataset.cpeRemove});
    var v=sessionById(b.dataset.cpeId);if(v)cpeChange({op:'toggle',id:b.dataset.cpeId,item:v});});
  document.addEventListener('change',function(event){var t=event.target,id=t&&t.dataset&&(t.dataset.cpeHours||t.dataset.cpeEthics);if(!id)return;
    var row=state.cpe&&state.cpe.entries&&state.cpe.entries[id];if(!row)return;
    cpeChange({op:'edit',id:id,hours:t.dataset.cpeHours?t.value:row.hours,ethics:t.dataset.cpeEthics?t.checked:row.ethics});});
  document.addEventListener('click',async function(event){var b=event.target.closest&&event.target.closest('[data-scout-action]');if(!b||state.busy||!state.loaded)return;
    var id=b.dataset.scoutId,action=b.dataset.scoutAction,v=items().find(function(v){return v.id===id;});if(!v)return;
    var token=state.token;state.busy=true;paint();
    try{var choices=await root.fbScoutChoice(v,action,!(state.choices[id]||{})[action]);if(token!==state.token)return;state.choices=choices;notice('Choice saved.');}
    catch(e){if(token===state.token)notice('Choice could not save: '+e.message);}finally{if(token===state.token){state.busy=false;paint();}}
  });
})(typeof window!=='undefined'?window:globalThis);
