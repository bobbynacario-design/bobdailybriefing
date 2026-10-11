(function(root) {
  'use strict';
  // "Draft a note" under a Go deeper dossier (functions/client-note.js): a short
  // email to an instructing party or a colleague, for Bob to edit and send from
  // his own mail. Daybook never sends it. What he did with each draft is kept
  // on briefings-bob/client-notes-<uid> so we can see whether it saves time:
  // how much of the draft he changed before opening it in his mail, and a
  // one-tap rating. Pure helpers first, then the panel.
  var arr=function(v){return Array.isArray(v)?v:[];};
  var esc=function(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
  var KIND_ORDER=['insurer','law','broker','utility','road','telco','other'];
  var KIND_LABELS={insurer:'Insurers',law:'Law firms',broker:'Brokers & adjusters',utility:'Utilities',road:'Road authorities',telco:'Telcos',other:'Others'};
  var RATINGS=[['asis','Sent as is'],['little','Changed a little'],['lot','Changed a lot'],['unused','Didn’t use it']];

  // His accounts grouped for the picker, insurers first, then a colleague.
  function recipients(accounts,kindOf) {
    var list=arr(accounts).filter(function(a){return a && a.name;}).map(function(a){return {name:String(a.name).slice(0,60),kind:kindOf?kindOf(a):(a.kind || 'other')};});
    list.sort(function(a,b){return KIND_ORDER.indexOf(a.kind)-KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name);});
    return list.concat([{name:'A colleague',kind:'colleague'}]);
  }
  // The email as it goes out: his edited subject and body, then the links.
  function compose(subject,body,sources) {
    var links=arr(sources).filter(function(s){return s && /^https?:\/\//i.test(s.url || '');}).map(function(s){return '- '+(s.title || s.url)+': '+s.url;});
    return {subject:String(subject || '').trim(),body:String(body || '').trim()+(links.length?'\n\nSources:\n'+links.join('\n'):'')};
  }
  // How much of the draft he changed: 0 when sent as drafted, 1 when nothing
  // of it is left (word-level longest common subsequence).
  function changedRatio(a,b) {
    var x=String(a || '').toLowerCase().match(/[\p{L}\p{N}$%.,']+/gu) || [],y=String(b || '').toLowerCase().match(/[\p{L}\p{N}$%.,']+/gu) || [];
    if(!x.length && !y.length)return 0;
    x=x.slice(0,600);y=y.slice(0,600);
    var prev=new Array(y.length+1).fill(0);
    for(var i=1;i<=x.length;i++){var cur=[0];for(var j=1;j<=y.length;j++)cur[j]=x[i-1]===y[j-1]?prev[j-1]+1:Math.max(prev[j],cur[j-1]);prev=cur;}
    return Math.round((1-2*prev[y.length]/(x.length+y.length))*100)/100;
  }
  function gmailUrl(mail){return 'https://mail.google.com/mail/?view=cm&fs=1&su='+encodeURIComponent(mail.subject)+'&body='+encodeURIComponent(mail.body);}
  function outlookUrl(mail){return 'https://outlook.office.com/mail/deeplink/compose?subject='+encodeURIComponent(mail.subject)+'&body='+encodeURIComponent(mail.body);}
  // What the drafts have been worth so far, from his own record of them.
  function summary(items) {
    var notes=Object.keys(items || {}).map(function(k){return items[k];}).filter(Boolean);
    var used=notes.filter(function(n){return n.usedAt;}),rated={};
    notes.forEach(function(n){if(n.rating)rated[n.rating]=(rated[n.rating] || 0)+1;});
    var changes=used.map(function(n){return Number(n.changed);}).filter(function(n){return Number.isFinite(n);});
    var avg=changes.length?Math.round(changes.reduce(function(s,n){return s+n;},0)/changes.length*100):null;
    return {drafted:notes.length,used:used.length,averageChanged:avg,rated:rated,
      text:notes.length?notes.length+' drafted · '+used.length+' opened in your mail'+(avg!=null?' · on average '+avg+'% changed before sending':'')+
        (Object.keys(rated).length?' · '+RATINGS.filter(function(r){return rated[r[0]];}).map(function(r){return rated[r[0]]+' '+r[1].toLowerCase();}).join(', '):''):''};
  }
  var core={recipients:recipients,compose:compose,changedRatio:changedRatio,gmailUrl:gmailUrl,outlookUrl:outlookUrl,summary:summary,RATINGS:RATINGS,KIND_LABELS:KIND_LABELS};
  root.ClientNoteCore=core;
  if(typeof module!=='undefined' && module.exports){module.exports=core;return;}

  // ── The panel ──
  var state={notes:null,notesFor:null,current:null};
  function pickerHtml(list) {
    var groups={};list.forEach(function(r,i){var g=r.kind==='colleague'?'Colleague':KIND_LABELS[r.kind] || 'Others';(groups[g]=groups[g] || []).push('<option value="'+i+'">'+esc(r.name)+'</option>');});
    return Object.keys(groups).map(function(g){return '<optgroup label="'+esc(g)+'">'+groups[g].join('')+'</optgroup>';}).join('');
  }
  async function loadNotes() {
    var uid=root._firebaseUid || null;
    if(!uid || typeof root.fbLoadClientNotes!=='function')return {};
    if(state.notesFor===uid && state.notes)return state.notes;
    try{state.notes=await root.fbLoadClientNotes(uid) || {};state.notesFor=uid;}catch(e){state.notes={};}
    return state.notes;
  }
  async function paintSummary(box) {
    var line=box.querySelector('.note-summary');if(!line)return;
    var s=summary(await loadNotes());
    line.textContent=s.text?'Your notes so far: '+s.text+'.':'';
  }
  function draftHtml(id,note) {
    return '<label class="note-field">Subject<input class="note-subject" maxlength="200" value="'+esc(note.subject)+'"></label>'+
      '<label class="note-field">Email (edit it here or in your mail)<textarea class="note-body" rows="11">'+esc(note.body)+'</textarea></label>'+
      (arr(note.unverified).length?'<p class="note-unverified">Not in the dossier: '+esc(note.unverified.join(', '))+'. Check before sending.</p>':'')+
      (arr(note.sources).length?'<div class="note-sources">Links added at the end: '+note.sources.map(function(s){return '<a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title)+' ↗</a>';}).join(' · ')+'</div>':'')+
      '<div class="note-actions"><button type="button" class="tool-chip" data-note-send="gmail">Open in Gmail</button><button type="button" class="tool-chip" data-note-send="outlook">Open in Outlook</button>'+
      '<button type="button" class="tool-chip" data-note-send="copy">Copy</button></div>'+
      '<div class="note-rate" role="group" aria-label="How much did you change it?"><span>How much did you change it?</span>'+RATINGS.map(function(r){
        return '<button type="button" class="tool-chip" data-note-rate="'+r[0]+'" aria-pressed="'+(note.rating===r[0])+'">'+esc(r[1])+'</button>';}).join('')+'</div>';
  }
  async function record(id,patch) {
    if(state.notes && state.notes[id])Object.assign(state.notes[id],patch);
    if(typeof root.fbUpdateClientNote==='function'){try{await root.fbUpdateClientNote(id,patch);}catch(e){if(root.showToast)root.showToast('Could not save what you did with the note.','warn');}}
  }
  // Under the dossier: who it is for, his angle, then the draft to edit.
  root.openNoteDrafter=async function(panel,dossier,key) {
    var box=panel.querySelector('.note-drafter');
    if(box){box.remove();return;}
    box=document.createElement('section');box.className='note-drafter';box.setAttribute('aria-label','Draft a note');
    var list=recipients(typeof root.activeAccounts==='function'?root.activeAccounts():[],typeof root.accountKind==='function'?root.accountKind:null);
    box.innerHTML='<h4>Draft a note about this story</h4><p class="note-intro">A short email from this dossier only, for you to edit and send from your own mail. Daybook sends nothing.</p>'+
      '<div class="note-form"><label class="note-field">To<select class="note-to">'+pickerHtml(list)+'</select></label>'+
      '<label class="note-field note-angle-field">Your angle (optional)<input class="note-angle" maxlength="240" placeholder="e.g. ask whether their open pole-strike files use the old rates"></label>'+
      '<button type="button" class="tool-chip weekly-primary note-draft">Draft</button></div><div class="note-status" role="status"></div><div class="note-out"></div><p class="note-summary"></p>';
    var actions=panel.querySelector('.dossier-actions');
    if(actions && actions.nextSibling)panel.insertBefore(box,actions.nextSibling);else panel.appendChild(box);
    paintSummary(box);
    var status=box.querySelector('.note-status'),out=box.querySelector('.note-out');
    box.querySelector('.note-draft').addEventListener('click',async function() {
      var button=this,r=list[Number(box.querySelector('.note-to').value)] || list[list.length-1];
      if(typeof root.fbDraftClientNote!=='function'){status.textContent='Sign in to draft a note.';return;}
      button.disabled=true;out.innerHTML='';status.textContent='Drafting from the dossier… usually under half a minute.';
      try {
        var res=await root.fbDraftClientNote(key,r,box.querySelector('.note-angle').value);
        if(!res || !res.note)throw new Error('The note came back empty. Try again in a minute.');
        state.current={id:res.id,note:res.note,drafted:compose(res.note.subject,res.note.body,res.note.sources)};
        if(state.notes)state.notes[res.id]=res.note;
        status.textContent='';out.innerHTML=draftHtml(res.id,res.note);paintSummary(box);
      } catch(error) {
        var code=String(error && error.code || '').replace(/^functions\//,'');
        status.textContent=code==='resource-exhausted'?'That is fifteen notes today. Try again tomorrow.':code==='not-found' || /^internal$/i.test(String(error && error.message || ''))?
          'Could not reach Draft a note. If it was just added it needs a functions deploy; otherwise try again in a minute.':(error && error.message) || 'Could not draft the note. Try again in a minute.';
      } finally { button.disabled=false; }
    });
    out.addEventListener('click',async function(event) {
      var send=event.target.closest('[data-note-send]'),rate=event.target.closest('[data-note-rate]'),cur=state.current;
      if(!cur || (!send && !rate))return;
      if(rate) {
        out.querySelectorAll('[data-note-rate]').forEach(function(b){b.setAttribute('aria-pressed',String(b===rate));});
        return record(cur.id,{rating:rate.getAttribute('data-note-rate')}).then(function(){paintSummary(box);});
      }
      var via=send.getAttribute('data-note-send');
      var mail=compose(out.querySelector('.note-subject').value,out.querySelector('.note-body').value,cur.note.sources);
      var changed=changedRatio(cur.drafted.subject+'\n'+cur.drafted.body,mail.subject+'\n'+mail.body);
      // Opened first: a popup opened after a network wait can be blocked.
      if(via==='gmail')root.open(gmailUrl(mail),'_blank','noopener');
      else if(via==='outlook')root.open(outlookUrl(mail),'_blank','noopener');
      else if(typeof root.copyCardText==='function')root.copyCardText(mail.subject+'\n\n'+mail.body,send,'Note copied with its links. Paste it into your email.');
      await record(cur.id,{usedAt:new Date().toISOString(),via:via,changed:changed,final:{subject:mail.subject.slice(0,200),body:mail.body.slice(0,4000)}});
      paintSummary(box);
    });
  };
  root.resetClientNotes=function(){state.notes=null;state.notesFor=null;state.current=null;};
})(typeof globalThis!=='undefined'?globalThis:this);
