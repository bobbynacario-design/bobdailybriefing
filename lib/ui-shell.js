// DOM helpers for navigation, modal focus, and opening a source item.
(function(root) {
  'use strict';
  var groups = [
    {name:'Home',pages:['today','command']},
    {name:'Explore',pages:['radar','pse','miro','sports','journal']},
    {name:'Research',pages:['research','evidence','timeline']},
    {name:'Decisions',pages:['decisions']},
    {name:'More',pages:['history','trends','help']}
  ];
  root.setApplicationLocked = function(locked) {
    document.querySelectorAll('.nav,.page,.feed-health,.mobile-nav,.return-to-source').forEach(function(el) {
      el.inert = locked;
      if (locked) el.setAttribute('aria-hidden','true'); else el.removeAttribute('aria-hidden');
    });
    if (locked) { var button = document.getElementById('auth-btn'); if (button) button.focus(); }
  };
  root.updatePrimaryNavigation = function(page) {
    document.querySelectorAll('.nav-group').forEach(function(group) {
      group.open = false;
      var active = !!group.querySelector('[data-page="' + page + '"]');
      group.classList.toggle('active',active);
      group.querySelector('summary').setAttribute('aria-label', group.dataset.name + (active ? ', current section' : ''));
    });
    document.querySelectorAll('.ntab').forEach(function(button) {
      button.classList.toggle('active',button.dataset.page === page);
      if (button.dataset.page === page) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
    });
  };
  root.rememberModalFocus = function(overlay) {
    if (overlay.hidden) overlay._previousFocus = document.activeElement;
  };
  root.restoreModalFocus = function(overlay) {
    if (overlay._previousFocus && overlay._previousFocus.isConnected) overlay._previousFocus.focus();
    overlay._previousFocus = null;
  };
  document.addEventListener('keydown',function(event) {
    if (event.key !== 'Tab') return;
    var overlay = document.querySelector('#auth-overlay:not(.hidden)') || document.querySelector('#evidence-picker-overlay:not([hidden])') || document.querySelector('#intel-search-overlay:not([hidden])');
    if (!overlay) return;
    var focusable = Array.from(overlay.querySelectorAll('button,input,textarea,a[href],[tabindex="0"]')).filter(function(el) { return !el.disabled && el.getClientRects().length; });
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (!overlay.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  root.exportEvidenceEdits = function() {
    var blob = new Blob([JSON.stringify(root.evidenceSetState.data,null,2)],{type:'application/json'});
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'briefing-evidence-' + new Date().toISOString().slice(0,10) + '.json'; a.click();
    setTimeout(function() { URL.revokeObjectURL(url); },1000);
  };
  root.reloadEvidenceEdits = function() {
    if (root.evidenceSetState.conflict && !confirm('Reload saved evidence? Export your pending edits first to keep them.')) return;
    root.loadEvidenceSets(true);
  };
  root.highlightSourceTitle = function(title,page,commandId) {
    var container = document.getElementById('page-' + page);
    if (!container) return false;
    var needle = String(title || '').trim().toLowerCase();
    var candidates = Array.from(container.querySelectorAll('.card-hl,.radar-symbol,.radar-ticker,.miro-title,.miro-signal-name,.decision-asset,h3,h4,.command-item-title'));
    var exact = commandId && Array.from(container.querySelectorAll('[data-command-id]')).find(function(el) { return el.dataset.commandId === commandId; });
    var match = exact || candidates.find(function(el) {
      var ownText = Array.from(el.childNodes).filter(function(node) { return node.nodeType === 3; }).map(function(node) { return node.textContent; }).join('').trim().toLowerCase();
      return el.textContent.trim().toLowerCase() === needle || ownText === needle;
    });
    if (!match) return false;
    // A remembered reading filter must not hide a directly opened source.
    if (page === 'today') {
      root.setSectionGroup('all',document.querySelector('.secgroup-chip[data-group="all"]'));
      root.setRelevanceFilter('all',document.querySelector('.filter-chip[data-filter="all"]'));
      root.expandAllSections();
      var section = match.closest('[data-group]');
      if (section) { section.style.display = ''; section.classList.remove('collapsed'); }
      var card = match.closest('.card'); if (card) { card.style.display = ''; card.hidden = false; }
    }
    document.querySelectorAll('.source-highlight').forEach(function(el) { el.classList.remove('source-highlight'); });
    var target = exact || match.closest('.card,article') || match;
    for (var parent = target.parentElement; parent && parent !== container; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    target.classList.add('source-highlight'); target.tabIndex = -1; target.focus({preventScroll:true}); target.scrollIntoView({block:'center',behavior:'smooth'});
    return true;
  };
  root.commandOpenItem = async function(encodedId) {
    var item = root.commandCenterData && root.commandCenterData.items.find(function(row) { return row.id === decodeURIComponent(encodedId); });
    if (!item) return;
    if (item.url && /^https?:\/\//i.test(item.url)) { root.commandOpenUrl(encodeURIComponent(item.url)); return; }
    await root.switchPage(item.page,document.querySelector('.ntab[data-page="' + item.page + '"]'));
    var title = item.source === 'Radar' ? item.id.replace(/^radar-/,'') : item.source === 'Decisions' ? item.title.replace(/^(Review open call: |Today: )/,'') : item.title;
    if (!root.highlightSourceTitle(title,item.page,item.id)) root.showToast('Source opened. This item is not in the current view; check its filters or archive.','info');
    var back = document.getElementById('return-command');
    if (!back) { back = document.createElement('button'); back.id = 'return-command'; back.className = 'return-to-source'; back.textContent = '← Back to Morning 5'; document.body.appendChild(back); }
    back.onclick = function() { back.remove(); root.commandGo('command'); };
  };
  root.renderWorkingQuestion = function(set) {
    var state = root.evidenceSetState;
    state.questionDrafts = state.questionDrafts || {};
    var q = state.questionDrafts[set.id] || set.question || {}, panel = document.createElement('form');
    panel.className = 'working-question';
    var heading = document.createElement('h3'); heading.textContent = 'Working question'; panel.appendChild(heading);
    var hint = document.createElement('p'); hint.textContent = 'Turn this collection into a research note. Record your own assessment and the evidence still needed.'; panel.appendChild(hint);
    function field(name,label,type,max) {
      var wrap = document.createElement('label'); wrap.textContent = label;
      var input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
      if (type !== 'textarea') input.type = type;
      input.name = name; input.value = q[name] || ''; if (max) input.maxLength = max;
      if (name === 'prompt') input.required = true;
      wrap.appendChild(input); panel.appendChild(wrap); return input;
    }
    field('prompt','What are you investigating?','textarea',500);
    field('purpose','Why does this matter?','textarea',1000);
    field('keywords','Search terms (for example: battery fire)','text',150);
    field('deadline','Target date (optional)','date');
    field('assessment','My assessment','textarea',4000);
    field('gaps','Unresolved questions / evidence to request','textarea',2000);
    var statusLabel = document.createElement('label'); statusLabel.textContent = 'Status';
    var status = document.createElement('select'); status.name = 'status';
    ['active','closed'].forEach(function(value) { var option = document.createElement('option'); option.value=value; option.textContent=value === 'active' ? 'Active' : 'Closed'; status.appendChild(option); });
    status.value=q.status || 'active'; statusLabel.appendChild(status); panel.appendChild(statusLabel);
    var changes = document.createElement('p');
    var added = set.items.filter(function(item) { return !q.reviewedAt || item.capturedAt > q.reviewedAt; }).length;
    changes.textContent = q.reviewedAt ? added+' saved items added since your last review ('+root.evidenceDate(q.reviewedAt)+').' : 'Not reviewed yet · '+set.items.length+' saved items. This tracks saved evidence, not an automatic search for new developments.';
    panel.appendChild(changes);
    var draftStatus=document.createElement('p'); draftStatus.setAttribute('role','status');
    draftStatus.textContent=state.questionDrafts[set.id] ? 'Unsaved changes' : 'Save your changes before leaving the app.'; panel.appendChild(draftStatus);
    panel.oninput=function() { state.questionDrafts[set.id]=Object.assign({},q,Object.fromEntries(new FormData(panel))); draftStatus.textContent='Unsaved changes'; };
    var actions = document.createElement('div'); actions.className='evidence-item-actions'; panel.appendChild(actions);
    function save(review) {
      if (state !== root.evidenceSetState) return false;
      if (!panel.reportValidity()) return false;
      var value = Object.fromEntries(new FormData(panel)); value.reviewedAt = review ? new Date().toISOString() : q.reviewedAt || '';
      var result = root.EvidenceSetsCore.updateQuestion(root.evidenceSetState.data,set.id,value,new Date().toISOString());
      if (result.error) { root.showToast(result.error,'warn'); return false; }
      root.evidenceSetState.data=result.state; q=result.state.sets.find(function(row) { return row.id===set.id; }).question;
      delete state.questionDrafts[set.id];
      root.saveEvidenceSets('Working question synced'); return true;
    }
    function button(label,action) { var b=document.createElement('button'); b.type='button'; b.className='tool-chip'; b.textContent=label; b.onclick=action; actions.appendChild(b); }
    button('Save question',function() { if (save(false)) root.paintEvidencePage(); });
    button('Find evidence',function() {
      if (!save(false)) return;
      var input=document.getElementById('intel-search-input'); input.value=q.keywords || q.prompt;
      root.openIntelligenceSearch();
    });
    button('Mark evidence reviewed',function() { if (save(true)) root.paintEvidencePage(); });
    button('Export research note',function() {
      if (!save(false)) return;
      var note=root.EvidenceSetsCore.researchNote(root.evidenceSetState.data,set.id);
      state.notePreview={id:set.id,text:note};
      var url=URL.createObjectURL(new Blob([note],{type:'text/markdown;charset=utf-8'}));
      var a=document.createElement('a'); a.href=url; a.download='research-note-'+set.id+'.md'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function() { URL.revokeObjectURL(url); },1000);
      root.paintEvidencePage();
    });
    if (state.notePreview && state.notePreview.id === set.id) {
      var preview=document.createElement('label'); preview.style.gridColumn='1/-1'; preview.textContent='Exported research note — select and copy if the download does not appear';
      var output=document.createElement('textarea'); output.readOnly=true; output.value=state.notePreview.text; output.style.minHeight='240px'; preview.appendChild(output); panel.appendChild(preview);
    }
    panel.onsubmit=function(event) { event.preventDefault(); if (save(false)) root.paintEvidencePage(); };
    document.getElementById('evidence-set-detail').insertBefore(panel,document.querySelector('#evidence-set-detail .evidence-item-list'));
  };
  root.addEventListener('beforeunload',function(event) {
    if (root.evidenceSetState && Object.keys(root.evidenceSetState.questionDrafts || {}).length) { event.preventDefault(); event.returnValue=''; }
  });
  document.addEventListener('DOMContentLoaded',function() {
    var nav = document.querySelector('.nav-center');
    if (!nav) return;
    var buttons = Array.from(nav.querySelectorAll('.ntab'));
    var questionsButton=buttons.find(function(button) { return button.dataset.page === 'evidence'; });
    if (questionsButton) questionsButton.textContent='▣ Questions & Evidence';
    groups.forEach(function(config) {
      var group = document.createElement('details'); group.className = 'nav-group'; group.dataset.name = config.name;
      var summary = document.createElement('summary'); summary.textContent = config.name; group.appendChild(summary);
      var panel = document.createElement('div'); panel.className = 'nav-group-panel';
      config.pages.forEach(function(page) { var button = buttons.find(function(el) { return el.dataset.page === page; }); if (button) { button.setAttribute('aria-label',button.textContent.trim()); panel.appendChild(button); } });
      group.appendChild(panel); nav.appendChild(group);
      group.addEventListener('toggle',function() { if (group.open) nav.querySelectorAll('details').forEach(function(other) { if (other !== group) other.open = false; }); });
    });
    root.updatePrimaryNavigation((location.hash || '#today').slice(1));
    document.addEventListener('click',function(event) { if (!nav.contains(event.target)) nav.querySelectorAll('details').forEach(function(group) { group.open = false; }); });
    var dialog = document.querySelector('.intel-search-dialog');
    if (dialog) { dialog.removeAttribute('aria-labelledby'); dialog.setAttribute('aria-label','Search intelligence'); }
  });
})(window);
