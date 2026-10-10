(function(root) {
  'use strict';
  var state={token:0,input:{},events:[],manual:[],available:false,busy:false,editing:'',selected:'',month:'',view:'month'};
  var el=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
  var C=function(){return root.DaybookCalendarCore;};
  function notice(s){if(el('daycal-status'))el('daycal-status').textContent=s;}
  function shown(){return C().filtered(state.events,el('daycal-filter')?el('daycal-filter').value:'all',!!(el('daycal-done') && el('daycal-done').checked));}
  function sourceLabel(e) {
    if(e.source==='Connected calendar')return e.ref?'Open meeting brief':'Prepare meeting brief';
    return {'Saved flight':'Open saved flight','Flights':'Open sale in Flights','Decisions':'Open Decisions','Questions & Evidence':'Open working question'}[e.source] || 'Open '+e.source;
  }
  // List view shows a multi-day item once: on its first day, or on the 1st
  // when it began in an earlier month.
  function listed(rows,day,first){return C().onDay(rows,day).filter(function(e){return e.start===day || (day===first && e.start<first);});}
  function label(day){return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(new Date(day+'T00:00:00Z'));}
  function item(e) {
    var i=state.events.indexOf(e);
    return '<article class="daycal-event daycal-'+e.kind+'"><div><b>'+esc(e.title)+'</b><p class="flights-note">'+esc(e.time?e.time+' PHT':'All day')+' · '+esc(e.source)+(e.start!==e.end?' · '+esc(label(e.start)+' — '+label(e.end)):'')+(e.done?' · completed':'')+'</p>'+ (e.location?'<p>'+esc(e.location)+'</p>':'')+'<p>'+esc(e.detail)+'</p></div><div class="flight-actions">'+
      (e.origin==='manual'?'<button class="tool-chip" onclick="daycalEdit('+i+')" '+(!state.available || state.busy?'disabled':'')+'>Edit</button>'+(e.kind==='task'?'<button class="tool-chip" onclick="daycalComplete('+i+')" '+(!state.available || state.busy?'disabled':'')+'>'+(e.done?'Reopen':'Done')+'</button>':'')+'<button class="tool-chip" onclick="daycalDelete('+i+')" '+(!state.available || state.busy?'disabled':'')+'>Delete</button>':e.page?'<button class="tool-chip" onclick="daycalSource('+i+')">'+esc(sourceLabel(e))+'</button>':'')+'</div></article>';
  }
  root.paintDaybookCalendar=function() {
    if(!el('daycal-grid'))return;
    var today=C().pht().day;
    if(!state.month)state.month=today.slice(0,7);if(!state.selected)state.selected=today;
    var rows=shown(),cells=C().grid(state.month);
    el('daycal-month').textContent=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(state.month+'-01T00:00:00Z'));
    el('daycal-grid').innerHTML=cells.map(function(c){var events=C().onDay(rows,c.day);return '<button type="button" class="daycal-day'+(c.other?' is-other':'')+(c.day===today?' is-today':'')+(c.day===state.selected?' is-selected':'')+'" aria-pressed="'+(c.day===state.selected)+'" aria-label="'+esc(label(c.day)+'; '+events.length+' items')+'" onclick="daycalSelect(\''+c.day+'\',true)"><span class="daycal-number">'+Number(c.day.slice(8))+'</span>'+events.slice(0,3).map(function(e){return '<span class="daycal-bar daycal-'+e.kind+'">'+esc((e.start<c.day?'↳ ':'')+e.title)+'</span>';}).join('')+(events.length>3?'<span class="flights-note">+'+(events.length-3)+' more</span>':'')+'</button>';}).join('');
    var monthRows=rows.filter(function(e){return e.start<=C().offset(state.month+'-01',new Date(Number(state.month.slice(0,4)),Number(state.month.slice(5)),0).getDate()-1) && e.end>=state.month+'-01';});
    el('daycal-count').textContent=monthRows.length+' items this month · Philippine time';
    var first=state.month+'-01', list=state.view==='list';
    var days=list?cells.filter(function(c){return !c.other && listed(rows,c.day,first).length;}).map(function(c){return c.day;}):[state.selected];
    var hint=!state.events.length && state.available ? '<p class="flights-note">Nothing dated yet. Add an event here, or give a decision a review date, a working question a deadline, or save a flight; they appear on this calendar.</p>' : '';
    el('daycal-agenda').innerHTML=(days.map(function(day){var events=list?listed(rows,day,first):C().onDay(rows,day);return '<h3>'+esc(label(day))+'</h3>'+(events.length?events.map(item).join(''):'<p class="calendar-none">Nothing scheduled for this day.</p>');}).join('') || '<p class="calendar-none">No items match this month and filter.</p>')+hint;
    el('daycal-month-view').hidden=state.view==='list';
    ['month','list'].forEach(function(v){if(el('daycal-view-'+v))el('daycal-view-'+v).setAttribute('aria-pressed',String(state.view===v));});
    var overlaps=C().conflicts(rows).filter(function(x){return x.trip.start.slice(0,7)<=state.month && x.trip.end.slice(0,7)>=state.month;});
    el('daycal-overlaps').innerHTML=overlaps.length?'<p class="flight-flag">'+overlaps.length+' meeting/travel overlap'+(overlaps.length===1?'':'s')+' to check. Saved flight dates are tentative.</p>':'';
    if(el('daycal-add'))el('daycal-add').disabled=!state.available || state.busy;
    if(el('daycal-save'))el('daycal-save').disabled=!state.available || state.busy;
  };
  root.daycalSelect=function(day,tapped) {
    if(!C().date(day))return;state.selected=day;state.month=day.slice(0,7);root.paintDaybookCalendar();
    // On a single-column layout the agenda sits below the grid; bring it up.
    if(tapped && typeof root.matchMedia==='function' && root.matchMedia('(max-width:900px)').matches && el('daycal-agenda') && el('daycal-agenda').scrollIntoView)el('daycal-agenda').scrollIntoView({behavior:'smooth',block:'start'});
  };
  root.daycalMonth=function(n){var d=new Date(state.month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);var m=d.toISOString().slice(0,7);if(!C().date(m+'-01'))return;state.month=m;state.selected=m+'-01';root.paintDaybookCalendar();};
  root.daycalToday=function(){root.daycalSelect(C().pht().day);};
  root.daycalView=function(v){state.view=v==='list'?'list':'month';root.paintDaybookCalendar();};
  root.resetDaybookCalendar=function(){state.token++;state.input={};state.events=[];state.manual=[];state.available=false;state.busy=false;state.editing='';state.selected='';state.month='';['daycal-grid','daycal-agenda','daycal-overlaps'].forEach(function(id){if(el(id))el(id).innerHTML='';});['title','start','end','time','location','notes'].forEach(function(k){if(el('daycal-'+k))el('daycal-'+k).value='';});if(el('daycal-editor'))el('daycal-editor').hidden=true;notice('Sign in to load your calendar.');};
  root.renderDaybookCalendar=async function() {
    if(state.busy)return;
    var token=++state.token,uid=root._firebaseUid;
    if(!uid){root.resetDaybookCalendar();notice('Sign in to load your calendar.');return;}
    state.available=false;root.paintDaybookCalendar();notice('Loading calendar sources…');
    var names=['Your events','Meetings','Decisions','Research deadlines','Saved flights','Seat sales'];
    var calls=[function(){return root.fbLoadDaybookEvents();},function(){return root.daybookMember?null:root.fbLoadMeetings(uid);},function(){return root.fbLoadDecisions(true);},function(){return root.fbLoadCommandPrefs(true);},function(){return root.fbLoadFlightPrefs();},function(){return root.fbLoadFlights();}];
    var results=await Promise.allSettled(calls.map(function(f){return Promise.resolve().then(f);}));
    if(token!==state.token || root._firebaseUid!==uid)return;
    var get=function(i,fallback){return results[i].status==='fulfilled'?results[i].value || fallback:fallback;};
    state.available=results[0].status==='fulfilled';state.manual=get(0,[]);
    state.input={manual:state.manual,meetings:get(1,null),decisions:get(2,[]),evidence:get(3,{}).evidenceSets,saved:get(4,{}),flights:get(5,null)};
    state.events=C().build(state.input);root.paintDaybookCalendar();
    var failed=names.filter(function(_,i){return results[i].status!=='fulfilled';});
    notice(failed.length?'Could not load: '+failed.join(', ')+'.'+(!state.available?' Event editing is disabled to protect your saved items.':''):'Calendar loaded.');
  };
  function editor(r) {
    r=r || {};state.editing=r.id || '';
    ['title','start','end','time','location','notes','kind'].forEach(function(k){el('daycal-'+k).value=r[k] || (k==='start'?state.selected:k==='kind'?'personal':'');});
    el('daycal-editor-title').textContent=r.id?'Edit event':'Add event';el('daycal-editor').hidden=false;el('daycal-title').focus();
  }
  root.daycalNew=function(){if(state.available && !state.busy)editor();};
  root.daycalCancel=function(){el('daycal-editor').hidden=true;state.editing='';};
  root.daycalEdit=function(i){var e=state.events[i];if(!e || e.origin!=='manual' || !state.available)return;editor(state.manual.find(function(r){return r.id===e.ref;}));};
  async function write(raw,remove) {
    if(state.busy || !state.available)return;
    var uid=root._firebaseUid,token=state.token,previous=state.manual.find(function(r){return r.id===raw.id;});
    state.busy=true;root.paintDaybookCalendar();notice('Saving…');
    try {
      var next=await root.fbWriteDaybookEvent(raw,remove,previous?previous.updatedAt || '':null);
      if(token!==state.token || uid!==root._firebaseUid)return;
      state.manual=next;state.input.manual=next;state.events=C().build(state.input);root.daycalCancel();notice(remove?'Event deleted.':'Event saved.');
    }catch(e){if(token===state.token)notice(e.message || 'Could not save; your edits are still here.');}
    finally{if(token===state.token){state.busy=false;root.paintDaybookCalendar();}}
  }
  root.daycalSave=function() {
    var prior=state.manual.find(function(r){return r.id===state.editing;}),raw={id:state.editing || root.crypto.randomUUID(),done:!!(prior && prior.done)};
    ['title','start','end','time','location','notes','kind'].forEach(function(k){raw[k]=el('daycal-'+k).value;});
    var value=C().manual(raw);if(value.error){notice(value.error);return Promise.resolve();}return write(value.event,false);
  };
  root.daycalComplete=function(i){var e=state.events[i],r=e && state.manual.find(function(r){return r.id===e.ref;});return r && r.kind==='task'?write(Object.assign({},r,{done:!r.done}),false):Promise.resolve();};
  root.daycalDelete=function(i) {
    var e=state.events[i];
    if(!e || e.origin!=='manual')return Promise.resolve();
    if(typeof root.confirm==='function' && !root.confirm('Delete "'+e.title+'" from your calendar?'))return Promise.resolve();
    return write({id:e.ref},true);
  };
  root.daycalSource=async function(i) {
    var e=state.events[i],token=state.token,uid=root._firebaseUid;if(!e || !e.page)return;
    if(e.source==='Connected calendar' && root.openMeetingFromCommand){await root.openMeetingFromCommand({title:e.title,target:e.ref});return;}
    await root.switchPage(e.page,document.querySelector('.ntab[data-page="'+e.page+'"]'));
    if(token!==state.token || uid!==root._firebaseUid)return;
    if(e.page==='flights' && root.showFlightAlternative) {
      // Open only the filters that could hide this fare. Budget, nights and
      // the other remembered trip settings stay as Bob left them.
      ['flights-destination','flights-from','flights-to'].forEach(function(id){if(el(id))el(id).value='';});
      [['flights-origin','All'],['flights-cabin','All'],['flights-trip','All'],['flights-market',root.FlightsCore.domestic[e.destination]?'domestic':'international']].forEach(function(p){if(el(p[0]))el(p[0]).value=p[1];});
      if(el('flights-saved-only'))el('flights-saved-only').checked=!!e.saved;
      if(root.renderFlightOffers)root.renderFlightOffers();
      root.showFlightAlternative(e.ref);
    }
    if(e.source==='Questions & Evidence' && root.selectEvidenceSet)root.selectEvidenceSet(encodeURIComponent(e.ref));
  };
  root.daycalExport=function() {
    var rows=shown().filter(function(e){return e.start.slice(0,7)<=state.month && e.end.slice(0,7)>=state.month;});
    if(!rows.length){notice('No items to export for this month and filter.');return;}
    var url=URL.createObjectURL(new Blob([C().ics(rows)],{type:'text/calendar;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='daybook-'+state.month+'.ics';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);notice('Exported '+rows.length+' items. Saved flight plans remain tentative.');
  };
})(typeof globalThis!=='undefined'?globalThis:this);
