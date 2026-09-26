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
  // Short page names for the "you are here" hint in a section label. A tab's own
  // text carries an icon and can be long ("▣ Questions & Evidence").
  var pageNames = {today:'Today',command:'Command',evidence:'Evidence',timeline:'Timeline',
    history:'History',trends:'Trends',research:'Reports',radar:'Radar',journal:'Journal',
    pse:'PSE',miro:'Markets',sports:'Sports',help:'Help',decisions:'Decisions'};
  // Story counts live on the page tabs, which are now inside closed menus. Roll
  // them up so a section still shows there is something new behind it.
  root.syncNavGroupBadges = function() {
    document.querySelectorAll('.nav-group').forEach(function(group) {
      var total = 0;
      group.querySelectorAll('.nav-group-panel .tab-badge').forEach(function(badge) { total += Number(badge.textContent) || 0; });
      var summary = group.querySelector('summary'), rollup = summary.querySelector('.tab-badge');
      if (!total) { if (rollup) rollup.remove(); return; }
      if (!rollup) { rollup = document.createElement('span'); rollup.className = 'tab-badge nav-group-badge'; summary.insertBefore(rollup,summary.querySelector('.nav-caret')); }
      rollup.textContent = total;
      rollup.title = total + ' item' + (total === 1 ? '' : 's') + ' in this section';
    });
  };
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
      var summary = group.querySelector('summary'), here = summary.querySelector('.nav-group-here');
      if (here) here.textContent = active ? pageNames[page] || '' : '';
      summary.setAttribute('aria-label', group.dataset.name + (active ? ', current section, ' + (pageNames[page] || page) + ' open' : ''));
    });
    document.querySelectorAll('.ntab').forEach(function(button) {
      button.classList.toggle('active',button.dataset.page === page);
      if (button.dataset.page === page) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
    });
    root.syncNavGroupBadges();
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
    var candidates = Array.from(container.querySelectorAll('.card-hl,.aha-title,.radar-symbol,.radar-ticker,.miro-title,.miro-signal-name,.decision-asset,h3,h4,.command-item-title'));
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
  // Split a tab into an icon column and a label so menu rows line up, and
  // return the label on its own for the accessible name.
  function splitTabLabel(button) {
    var badge = button.querySelector('.tab-badge');
    var parts = button.textContent.trim().match(/^([^\w\s]+)\s+(.*)$/);
    var icon = document.createElement('span'); icon.className = 'ntab-icon'; icon.setAttribute('aria-hidden','true');
    var label = document.createElement('span'); label.className = 'ntab-label';
    // The section's line icon from the page's sprite (index.html), else the
    // symbol written in front of the label.
    var page = button.dataset && button.dataset.page;
    if (page && document.getElementById('i-' + page)) {
      icon.innerHTML = '<svg class="ico"><use href="#i-' + page + '"/></svg>';
    } else icon.textContent = parts ? parts[1] : '';
    label.textContent = parts ? parts[2] : button.textContent.trim();
    button.textContent = '';
    button.appendChild(icon); button.appendChild(label);
    if (badge) button.appendChild(badge);
    return label.textContent;
  }
  function menuItems(group) { return Array.from(group.querySelectorAll('.nav-group-panel .ntab')); }
  // The brand's small slot carries today's PHT date ("// FRI 25 SEP").
  function renderBrandDate() {
    var slot = document.getElementById('nav-brand-date'), parts = {};
    if (!slot) return;
    new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',weekday:'short',day:'numeric',month:'short'}).formatToParts(new Date()).forEach(function(part) { parts[part.type] = part.value; });
    slot.textContent = ('// ' + parts.weekday + ' ' + parts.day + ' ' + parts.month).toUpperCase();
  }
  document.addEventListener('DOMContentLoaded',function() {
    renderBrandDate();
    document.addEventListener('visibilitychange',function() { if (!document.hidden) renderBrandDate(); });
    root.setInterval(renderBrandDate,60000);
  });
  document.addEventListener('DOMContentLoaded',function() {
    // Each page's header card carries its own section icon, large and faint,
    // instead of the one newspaper drawing every page used to share.
    Array.prototype.forEach.call(document.querySelectorAll('.page .hero'), function(hero) {
      var page = hero.closest('.page'), id = page ? page.id.replace(/^page-/, '') : '';
      if (!id || hero.querySelector('.hero-mark') || !document.getElementById('i-' + id)) return;
      hero.insertAdjacentHTML('beforeend', '<svg class="hero-mark" aria-hidden="true" focusable="false"><use href="#i-' + id + '"/></svg>');
    });
    var nav = document.querySelector('.nav-center');
    if (!nav) return;
    var buttons = Array.from(nav.querySelectorAll('.ntab'));
    var questionsButton=buttons.find(function(button) { return button.dataset.page === 'evidence'; });
    if (questionsButton) questionsButton.textContent='▣ Questions & Evidence';
    groups.forEach(function(config) {
      var pages = config.pages.map(function(page) { return buttons.find(function(el) { return el.dataset.page === page; }); }).filter(Boolean);
      if (!pages.length) return;
      // A section with a single page has nothing to choose from: keep it a tab
      // rather than costing a second click to open a one-item menu.
      if (pages.length === 1) { pages[0].setAttribute('aria-label',splitTabLabel(pages[0])); nav.appendChild(pages[0]); return; }
      var group = document.createElement('details'); group.className = 'nav-group'; group.dataset.name = config.name;
      var summary = document.createElement('summary');
      summary.setAttribute('aria-haspopup','true'); summary.setAttribute('aria-expanded','false');
      summary.appendChild(document.createTextNode(config.name));
      var here = document.createElement('span'); here.className = 'nav-group-here'; summary.appendChild(here);
      var caret = document.createElement('span'); caret.className = 'nav-caret'; caret.setAttribute('aria-hidden','true'); summary.appendChild(caret);
      group.appendChild(summary);
      var panel = document.createElement('div'); panel.className = 'nav-group-panel';
      pages.forEach(function(button) { button.setAttribute('aria-label',splitTabLabel(button)); panel.appendChild(button); });
      group.appendChild(panel); nav.appendChild(group);
      group.addEventListener('toggle',function() {
        summary.setAttribute('aria-expanded',String(group.open));
        if (!group.open) return;
        nav.querySelectorAll('details').forEach(function(other) { if (other !== group) other.open = false; });
        // Keep a menu on screen when its section sits near the right edge.
        panel.classList.remove('flip');
        if (panel.getBoundingClientRect().right > root.innerWidth - 10) panel.classList.add('flip');
      });
      // Once one menu is open, sliding across the bar previews the others.
      summary.addEventListener('mouseenter',function() {
        var open = nav.querySelector('.nav-group[open]');
        if (open && open !== group) group.open = true;
      });
      group.addEventListener('keydown',function(event) {
        if (event.key === 'Escape' && group.open) { event.preventDefault(); group.open = false; summary.focus(); return; }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        if (!group.open) group.open = true;
        var items = menuItems(group), index = items.indexOf(document.activeElement);
        if (index < 0) index = event.key === 'ArrowDown' ? -1 : 0;
        var next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      });
    });
    // Left/right moves along the bar itself, the way a menu bar is expected to.
    nav.addEventListener('keydown',function(event) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      var tops = Array.from(nav.children).map(function(el) { return el.tagName === 'DETAILS' ? el.querySelector('summary') : el; });
      var index = tops.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      tops[(index + (event.key === 'ArrowRight' ? 1 : -1) + tops.length) % tops.length].focus();
    });
    root.updatePrimaryNavigation((location.hash || '#today').slice(1));
    document.addEventListener('click',function(event) { if (!nav.contains(event.target)) nav.querySelectorAll('details').forEach(function(group) { group.open = false; }); });
    var dialog = document.querySelector('.intel-search-dialog');
    if (dialog) { dialog.removeAttribute('aria-labelledby'); dialog.setAttribute('aria-label','Search intelligence'); }
  });
})(window);
