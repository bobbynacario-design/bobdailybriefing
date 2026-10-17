(function(root){
  'use strict';
  if(typeof document==='undefined')return;
  var state={token:0,feed:null,choices:{},prefs:null,busy:false,loaded:false};
  var C=root.ScoutCore,el=function(id){return document.getElementById(id);};
  function esc(v){return String(v||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function notice(v){if(el('scout-status'))el('scout-status').textContent=v;}
  function items(){var map={};Object.values(state.choices).forEach(function(c){var v=c&&C.clean([c.item])[0];if(v)map[v.id]=v;});C.clean(state.feed&&state.feed.items).forEach(function(v){map[v.id]=v;});return Object.values(map);}
  function card(v){var c=state.choices[v.id]||{},old=C.expired(v,C.today()),id=esc(v.id);
    return '<article class="deal-card scout-card"><div class="flights-note">'+esc(v.organizer||C.lanes[v.lane])+(old?' · Past / registration closed':'')+'</div><h3>'+esc(v.title)+'</h3><p>'+esc(v.why)+'</p><dl><dt>When</dt><dd>'+esc(v.start?(v.start+(v.end!==v.start?' – '+v.end:'')+(v.pht||v.when?' · '+(v.pht||v.when):'')+(v.dateCheck==='not-found'?' · not found on its page, check before you plan':v.dateCheck==='unchecked'?' · its page could not be read to check the date':'')):'Ongoing community · check the source for meetings')+'</dd><dt>Where</dt><dd>'+esc(v.location+(C.formats[v.format]?' · '+C.formats[v.format]:''))+'</dd><dt>Cost</dt><dd>'+esc(v.cost)+'</dd><dt>Register by</dt><dd>'+esc(v.deadline?v.deadline+(v.deadlineCheck==='not-found'?' · not found on its page':''):'Deadline not listed')+'</dd></dl><a href="'+esc(v.url)+'" target="_blank" rel="noopener noreferrer">View source & registration ↗</a><div class="flight-actions">'+['saved','interested','more','hidden'].map(function(a,i){return '<button class="tool-chip" data-scout-id="'+id+'" data-scout-action="'+a+'" aria-pressed="'+!!c[a]+'" '+(state.busy?'disabled':'')+'>'+([c.saved?'Saved ✓':'Save',c.interested?'Interested ✓':'Interested',c.more?'More like this ✓':'More like this',c.hidden?'Unhide':'Hide'][i])+'</button>';}).join('')+'</div></article>';
  }
  function today(){var out=el('scout-today');if(!out)return;var rows=C.due(items(),state.choices,C.today());out.hidden=!rows.length;out.innerHTML=rows.length?'<h3>Scout · deadlines coming up</h3>'+rows.map(function(v){return '<p><a href="'+esc(v.url)+'" target="_blank" rel="noopener noreferrer">'+esc(v.title)+'</a> · register by '+esc(v.deadline)+'</p>';}).join('')+'<button class="tool-chip" onclick="switchPage(\'scout\',null)">Open Scout</button>':'';}
  function paint(){
    var out=el('scout-results');if(!out)return;
    if(el('scout-build'))el('scout-build').disabled=state.busy;
    if(el('scout-save-prefs'))el('scout-save-prefs').disabled=state.busy;
    var mode=el('scout-view').value,lane=el('scout-lane').value,day=C.today();
    var rows=items().filter(function(v){var c=state.choices[v.id]||{};return (!lane||v.lane===lane)&&(mode==='hidden'?c.hidden:!c.hidden)&&(mode==='saved'?(c.saved||c.interested):mode==='hidden'||!C.expired(v,day));});
    rows.sort(function(a,b){return (a.dateCheck==='not-found')-(b.dateCheck==='not-found')||(a.deadline||a.start||'9999').localeCompare(b.deadline||b.start||'9999');});
    var fresh=state.feed&&state.feed.generatedAt;
    el('scout-updated').textContent=fresh?'Last scouted '+new Date(fresh).toLocaleString('en-GB',{timeZone:'Asia/Manila'})+' PHT'+(Date.now()-Date.parse(fresh)>7*86400000?' · weekly refresh due':''):'Your first shortlist is ready to scout.';
    out.innerHTML=Object.keys(C.lanes).filter(function(k){return rows.some(function(v){return v.lane===k;});}).map(function(k){return '<h2 class="flights-group">'+esc(C.lanes[k])+'</h2><div class="deal-grid">'+rows.filter(function(v){return v.lane===k;}).map(card).join('')+'</div>';}).join('')||'<p class="flights-note">'+(state.feed?'No matching opportunities. Try another view, adjust your interests, or scout again.':'Build your first shortlist to find upcoming events and communities around your work and interests.')+'</p>';
    today();
  }
  root.resetScout=function(){state={token:state.token+1,feed:null,choices:{},prefs:null,busy:false,loaded:false};if(el('scout-results'))el('scout-results').innerHTML='';if(el('scout-today')){el('scout-today').hidden=true;el('scout-today').innerHTML='';}if(el('scout-interests'))el('scout-interests').value='';if(el('scout-geography'))el('scout-geography').value='';notice('');};
  root.renderScout=async function(){
    if(state.loaded){paint();return;}var token=++state.token;
    try{notice('Loading Scout…');var data=await root.fbLoadScout();if(token!==state.token)return;
      state.feed=data.feed;state.choices=data.choices||{};state.prefs=C.prefs(data.prefs);state.loaded=true;
      el('scout-interests').value=state.prefs.interests;el('scout-geography').value=state.prefs.geography;paint();notice('');
    }catch(e){if(token===state.token)notice('Scout could not load: '+e.message);}
  };
  root.paintScout=paint;
  root.reloadScout=function(){if(state.busy)return;state.loaded=false;return root.renderScout();};
  root.saveScoutPreferences=async function(){if(state.busy||!state.loaded)return;var token=state.token;state.busy=true;paint();
    try{var p=C.prefs({interests:el('scout-interests').value,geography:el('scout-geography').value});await root.fbSaveScoutPrefs(p);if(token!==state.token)return;state.prefs=p;notice('Preferences saved. They will shape your next scout.');}
    catch(e){if(token===state.token)notice('Preferences could not save: '+e.message);}finally{if(token===state.token){state.busy=false;paint();}}
  };
  root.buildScout=async function(){if(state.busy||!state.loaded)return;var token=state.token;state.busy=true;paint();notice('Searching current organiser pages… This may take a couple of minutes.');
    try{var p=C.prefs({interests:el('scout-interests').value,geography:el('scout-geography').value});await root.fbSaveScoutPrefs(p);if(token!==state.token)return;state.prefs=p;var result=await root.fbBuildScout();if(token!==state.token)return;state.feed=result;notice('Shortlist updated. Check the source for current registration and availability.');}
    catch(e){if(token===state.token)notice('Scout could not finish: '+e.message);}finally{if(token===state.token){state.busy=false;paint();}}
  };
  document.addEventListener('click',async function(event){var b=event.target.closest&&event.target.closest('[data-scout-action]');if(!b||state.busy||!state.loaded)return;
    var id=b.dataset.scoutId,action=b.dataset.scoutAction,v=items().find(function(v){return v.id===id;});if(!v)return;
    var token=state.token;state.busy=true;paint();
    try{var choices=await root.fbScoutChoice(v,action,!(state.choices[id]||{})[action]);if(token!==state.token)return;state.choices=choices;notice('Choice saved.');}
    catch(e){if(token===state.token)notice('Choice could not save: '+e.message);}finally{if(token===state.token){state.busy=false;paint();}}
  });
})(typeof window!=='undefined'?window:globalThis);
