(function(root) {
  'use strict';
  // "This week" on Today: three commitments with a daily tick, and the weekly
  // review that scores the week and sets the next. Saved to
  // briefings-bob/review-<uid> through fbUpdateReview, which applies each change
  // to the latest copy inside a transaction, so a tick on another device is kept.
  var state={token:0,weeks:null,loadedAt:0,available:false,busy:false,inputs:null,editing:false};
  var el=function(id){return document.getElementById(id);};
  var esc=function(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
  var W=function(){return root.WeeklyReviewCore;};
  var DOW=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  function label(d){return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short'}).format(new Date(d+'T00:00:00Z'));}
  function range(start){return label(start)+' – '+label(W().offset(start,6));}
  function note(t){var n=el('weekly-status');if(n)n.textContent=t || '';}
  function areaOptions(selected){return W().AREAS.map(function(a){return '<option value="'+a[0]+'"'+(a[0]===selected?' selected':'')+'>'+esc(a[1])+'</option>';}).join('');}

  function cardHtml() {
    var C=W(),d=C.today(),start=C.weekStart(d),week=state.weeks[start],p=C.plan(state.weeks,d),days=C.weekDays(start);
    var list=week?week.commitments:[],nextWeek=state.weeks[C.offset(start,7)],upcoming=!list.length && nextWeek && nextWeek.commitments.length?nextWeek.commitments:[];
    var ask=p.review?(p.review===start?'Sunday: review this week'+(p.set?' and set next week’s three.':'.'):'Last week is not reviewed yet.')
      :p.set===start?'Choose up to three commitments for this week.':'Plan next week: choose up to three commitments.';
    var due=p.due?'<div class="weekly-due"><span>'+esc(ask)+'</span>'+
      '<button type="button" class="tool-chip weekly-primary" onclick="openWeeklyReview()" '+(state.available && !state.busy?'':'disabled')+'>'+(p.review?'Start weekly review':p.set===start?'Set this week':'Plan next week')+'</button></div>':'';
    var soon=upcoming.length?'<div class="flights-note">Next week, starts Monday:</div><ul class="weekly-list">'+upcoming.map(function(c){return '<li class="weekly-item"><div class="weekly-item-text"><span class="weekly-area">'+esc(C.areaLabel(c.area))+'</span> '+esc(c.text)+'</div></li>';}).join('')+'</ul>':'';
    var rows=list.map(function(c){
      var pr=C.progress(c,d);
      return '<li class="weekly-item"><div class="weekly-item-text"><span class="weekly-area">'+esc(C.areaLabel(c.area))+'</span> '+esc(c.text)+(c.measure?'<div class="flights-note">How you’ll know: '+esc(c.measure)+'</div>':'')+'</div>'+
        '<div class="weekly-dots" aria-label="'+esc('Ticked on '+pr.ticked+' of '+pr.elapsed+' days so far')+'">'+days.map(function(x,i){return '<span class="weekly-dot'+(c.ticks.indexOf(x)>=0?' is-on':'')+(x===d?' is-today':'')+(x>d?' is-future':'')+'" title="'+esc(DOW[i]+(c.ticks.indexOf(x)>=0?' · done':''))+'"></span>';}).join('')+'</div>'+
        '<button type="button" class="tool-chip" aria-pressed="'+pr.today+'" onclick="weeklyTick(\''+esc(c.id)+'\')" '+(state.available && !state.busy?'':'disabled')+'>'+(pr.today?'✓ Done today':'Did it today')+'</button></li>';
    }).join('');
    return '<div class="weekly-head"><h2 id="weekly-title">This week</h2><span class="flights-note">'+esc(range(start))+'</span>'+
      (list.length && !p.due?'<button type="button" class="tool-chip" onclick="openWeeklyReview()" '+(state.available && !state.busy?'':'disabled')+'>Edit</button>':'')+'</div>'+
      due+(rows?'<ul class="weekly-list">'+rows+'</ul>':'')+soon+'<p class="flights-note" id="weekly-status" role="status"></p>';
  }
  root.renderWeeklyCard=async function(force) {
    var card=el('weekly-card');if(!card)return;
    var uid=root._firebaseUid;
    if(!uid || typeof root.fbLoadReview!=='function'){card.hidden=true;return;}
    card.hidden=false;
    if(state.weeks && !force && Date.now()-state.loadedAt<60000){card.innerHTML=cardHtml();return;}
    var token=++state.token;
    if(!state.weeks)card.innerHTML='<div class="weekly-head"><h2 id="weekly-title">This week</h2></div><p class="flights-note">Loading your week…</p>';
    try {
      var weeks=await root.fbLoadReview();
      if(token!==state.token || uid!==root._firebaseUid)return;
      state.weeks=W().cleanWeeks(weeks);state.available=true;state.loadedAt=Date.now();
      card.innerHTML=cardHtml();
    } catch(e) {
      if(token!==state.token)return;
      state.weeks=state.weeks || {};state.available=false;
      card.innerHTML=cardHtml();note('Your week could not load, so changes are paused to protect it. Reload to try again.');
    }
  };
  async function update(mutate,done) {
    if(state.busy || !state.available)return;
    var uid=root._firebaseUid,token=state.token;state.busy=true;
    if(el('weekly-card'))el('weekly-card').innerHTML=cardHtml();
    try {
      var weeks=await root.fbUpdateReview(function(latest){return mutate(W().cleanWeeks(latest));});
      if(token!==state.token || uid!==root._firebaseUid)return;
      state.weeks=W().cleanWeeks(weeks);state.loadedAt=Date.now();state.busy=false;
      if(el('weekly-card'))el('weekly-card').innerHTML=cardHtml();
      if(done)done();
    } catch(e) {
      if(token!==state.token)return;
      state.busy=false;if(el('weekly-card'))el('weekly-card').innerHTML=cardHtml();note(e && e.message || 'Could not save. Try again.');
    }
  }
  root.weeklyTick=function(id) {
    var C=W(),d=C.today(),start=C.weekStart(d);
    return update(function(weeks){
      var week=weeks[start],c=week && week.commitments.filter(function(x){return x.id===id;})[0];
      if(!c)throw new Error('That commitment is no longer in this week. Reload to see the latest.');
      c.ticks=c.ticks.indexOf(d)>=0?c.ticks.filter(function(x){return x!==d;}):c.ticks.concat(d);
      return weeks;
    });
  };

  // Records the review draws on, read only when the review opens. Each one is
  // optional: a source that fails is simply left out of the facts.
  async function loadInputs() {
    var uid=root._firebaseUid,owner=!root.daybookMember;
    var calls=[
      typeof root.fbLoadUsage==='function'?root.fbLoadUsage(uid):null,
      typeof root.fbLoadDecisions==='function'?root.fbLoadDecisions(true):null,
      owner && typeof root.fbLoadMeetings==='function'?root.fbLoadMeetings(uid):null,
      typeof root.fbLoadDaybookEvents==='function'?root.fbLoadDaybookEvents():null,
      owner && typeof root.fbLoadPokerHQTourneys==='function'?root.fbLoadPokerHQTourneys():null,
      typeof root.fbLoadGoals==='function'?root.fbLoadGoals(uid):null,
      owner && typeof root.fbLoadWeeklyMirror==='function'?root.fbLoadWeeklyMirror(uid):null];
    var r=await Promise.allSettled(calls.map(function(c){return Promise.resolve(c);}));
    var v=function(i){return r[i].status==='fulfilled'?r[i].value:null;};
    var K=root.DaybookCalendarCore,meetings=v(2),manual=v(3) || [];
    var events=K?K.build({meetings:meetings,manual:manual}):[];
    var windows=K && meetings?K.offWindows({meetings:meetings,manual:manual}).map(function(w){return Object.assign({},w,{label:label(w.start)+' – '+label(w.end)});}):[];
    var starred=K?(v(4) || []).filter(function(t){return t && t.planning===true;}).map(function(t){var dd=K.pokerDate(t.date);return dd?{day:dd,name:String(t.name || 'Tournament').slice(0,100),venue:String(t.venue || '').split(',')[0].trim().slice(0,60),label:label(dd)}:null;}).filter(Boolean):[];
    var mirrors=v(6) || {},lastKey=Object.keys(mirrors).sort().pop(),last=lastKey && mirrors[lastKey];
    return {usage:v(0),decisions:v(1) || [],calendarDays:meetings && meetings.days || [],events:events,pokerStarred:starred,goals:v(5) || [],windows:windows,
      tryNext:last && last.try_next && last.try_next.action || ''};
  }
  function setRows(p,set) {
    var existing=state.weeks[set] && state.weeks[set].commitments || [];
    var rows='';
    for(var i=0;i<W().MAX;i++){var c=existing[i] || {};
      rows+='<div class="weekly-row" data-id="'+esc(c.id || '')+'"><select aria-label="Area" class="weekly-row-area">'+areaOptions(c.area || 'work')+'</select>'+
        '<input class="weekly-row-text" maxlength="140" placeholder="'+(i===0?'What will you do? e.g. Submit two reports before Friday':'Another commitment (optional)')+'" value="'+esc(c.text || '')+'" aria-label="Commitment '+(i+1)+'">'+
        '<input class="weekly-row-measure" maxlength="100" placeholder="How you’ll know (optional)" value="'+esc(c.measure || '')+'" aria-label="How you will know, commitment '+(i+1)+'"></div>';}
    return rows;
  }
  function reviewHtml(p,inputs) {
    var C=W(),html='<div class="weekly-review-head"><h2>Weekly review</h2><button type="button" class="tool-chip" onclick="closeWeeklyReview()">Close</button></div>';
    if(p.review) {
      var lb=C.lookback(Object.assign({weeks:state.weeks},inputs),p.review),week=state.weeks[p.review];
      html+='<section class="weekly-step"><h3>1 · Looking back · '+esc(range(p.review))+'</h3>'+
        (lb.facts.length?'<ul class="weekly-facts">'+lb.facts.map(function(f){return '<li><span class="weekly-area">'+esc(f.source)+'</span> '+esc(f.text)+'</li>';}).join('')+'</ul>':'')+
        (lb.thin?'<p class="flights-note">Not much was recorded this week. That is a record, not a verdict: the review only sees what was saved.</p>':'')+'</section>'+
        '<section class="weekly-step"><h3>2 · How did they go?</h3>'+week.commitments.map(function(c){
          return '<fieldset class="weekly-result" data-id="'+esc(c.id)+'"><legend>'+esc(c.text)+' <span class="flights-note">· ticked '+c.ticks.length+' of 7 days</span></legend>'+
            C.RESULTS.map(function(r){return '<label><input type="radio" name="weekly-res-'+esc(c.id)+'" value="'+r+'"'+(c.result===r?' checked':'')+'> '+(r==='done'?'Done':r==='partly'?'Partly':'Missed')+'</label>';}).join('')+'</fieldset>';
        }).join('')+'<label class="weekly-reflect">One line: what helped, or what got in the way? (optional)<textarea id="weekly-reflection" maxlength="400">'+esc(week.reflection)+'</textarea></label></section>';
    }
    if(p.set) {
      var ideas=C.suggestions(Object.assign({weeks:state.weeks},inputs),p.set);
      html+='<section class="weekly-step"><h3>'+(p.review?'3 · ':'')+'Commitments for '+esc(range(p.set))+'</h3><p class="flights-note">Up to three. Small and checkable beats ambitious: something you can tick on a good day.</p>'+
        '<div id="weekly-rows">'+setRows(p,p.set)+'</div>'+
        (ideas.length?'<div class="flights-note">Ideas from your records:</div><div class="weekly-ideas">'+ideas.map(function(s,i){return '<button type="button" class="tool-chip" title="'+esc(s.why)+'" onclick="weeklyUseIdea('+i+')">＋ '+esc(s.text)+'</button>';}).join('')+'</div>':'')+'</section>';
      state.ideas=ideas;
    }
    html+='<div class="weekly-actions"><button type="button" class="tool-chip weekly-primary" onclick="saveWeeklyReview()">'+(p.review?'Save review':'Save commitments')+'</button>'+
      (typeof root.openWeeklyRead==='function' && !root.daybookMember?'<button type="button" class="tool-chip" onclick="openWeeklyRead()">Read your week back (AI)</button>':'')+'</div>';
    return html;
  }
  root.openWeeklyReview=async function() {
    var box=el('weekly-review');if(!box || !state.weeks || !state.available)return;
    var C=W(),d=C.today(),p=C.plan(state.weeks,d);
    if(!p.due)p={review:'',set:C.weekStart(d),due:false};
    state.plan=p;box.hidden=false;box.innerHTML='<p class="flights-note">Gathering your week…</p>';
    if(box.scrollIntoView)box.scrollIntoView({behavior:'smooth',block:'start'});
    var token=state.token;
    try { state.inputs=await loadInputs(); } catch(e) { state.inputs={}; }
    if(token!==state.token)return;
    box.innerHTML=reviewHtml(p,state.inputs);
  };
  root.closeWeeklyReview=function(){var box=el('weekly-review');if(box){box.hidden=true;box.innerHTML='';}};
  root.weeklyUseIdea=function(i) {
    var idea=state.ideas && state.ideas[i];if(!idea)return;
    var rows=document.querySelectorAll?Array.prototype.slice.call(document.querySelectorAll('#weekly-rows .weekly-row')):[];
    var row=rows.filter(function(r){return !r.querySelector('.weekly-row-text').value.trim();})[0];
    if(!row){note('All three are filled. Clear one to use this idea.');return;}
    row.querySelector('.weekly-row-text').value=idea.text;row.querySelector('.weekly-row-area').value=idea.area;
  };
  // Reads the open review form: results for the reviewed week, rows for the set week.
  function readForm(p) {
    var q=function(s){return document.querySelectorAll?Array.prototype.slice.call(document.querySelectorAll(s)):[];};
    var results={};q('#weekly-review .weekly-result').forEach(function(f){var c=f.querySelector('input:checked');if(c)results[f.getAttribute('data-id')]=c.value;});
    var rows=q('#weekly-rows .weekly-row').map(function(r){return {id:r.getAttribute('data-id') || '',area:r.querySelector('.weekly-row-area').value,text:r.querySelector('.weekly-row-text').value.trim(),measure:r.querySelector('.weekly-row-measure').value.trim()};}).filter(function(r){return r.text;});
    return {results:results,reflection:el('weekly-reflection')?el('weekly-reflection').value:'',rows:rows};
  }
  root.saveWeeklyReview=function() {
    var p=state.plan,C=W();if(!p)return Promise.resolve();
    var form=readForm(p),now=new Date().toISOString();
    if(p.review && Object.keys(form.results).length<state.weeks[p.review].commitments.length){note('Mark each commitment done, partly or missed first.');return Promise.resolve();}
    return update(function(weeks) {
      if(p.review) {
        var w=weeks[p.review];if(!w)throw new Error('That week changed on another device. Reload and review again.');
        w.commitments.forEach(function(c){if(form.results[c.id])c.result=form.results[c.id];});
        w.reflection=String(form.reflection || '').trim().slice(0,400);w.reviewedAt=now;
      }
      if(p.set) {
        var prior=weeks[p.set] || {start:p.set,commitments:[]};
        var kept={};prior.commitments.forEach(function(c){kept[c.id]=c;});
        prior.commitments=form.rows.slice(0,C.MAX).map(function(r){var old=kept[r.id];return {id:old?old.id:C.newId(),area:r.area,text:r.text,measure:r.measure,ticks:old && old.text===r.text?old.ticks:[],result:old && old.text===r.text?old.result:''};});
        prior.setAt=now;weeks[p.set]=prior;
      }
      return weeks;
    },function() {
      root.closeWeeklyReview();
      note(p.review?'Week reviewed'+(p.set?' and next week set':'')+'.':'Commitments saved. Tick one on any day you move it forward.');
    });
  };
  root.resetWeeklyReview=function(){state.token++;state.weeks=null;state.available=false;state.busy=false;state.inputs=null;state.plan=null;root.closeWeeklyReview();if(el('weekly-card')){el('weekly-card').hidden=true;el('weekly-card').innerHTML='';}};
})(typeof window!=='undefined'?window:globalThis);
