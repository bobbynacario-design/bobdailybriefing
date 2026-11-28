(function(root){
  'use strict';
  var P=root.PurchaseTracker,C=root.ShoppingCore,S=root.ShoppingStyle;
  var el=function(id){return document.getElementById(id);},esc=function(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
  var price=function(n){return '₱'+Number(n).toLocaleString('en-PH',{minimumFractionDigits:Number(n)%1?2:0,maximumFractionDigits:2});};
  function field(form,name){return form.elements.namedItem(name);}
  function value(form,name){var f=field(form,name);return f && !f.disabled?f.value:'';}
  function checked(form,name){var f=field(form,name);return !!(f && !f.disabled && !f.matches?.(':disabled') && f.checked);}
  function read(form){return {status:value(form,'status'),retailer:value(form,'retailer'),purchasedOn:value(form,'purchasedOn'),amountPaid:value(form,'amountPaid'),receivedOn:value(form,'receivedOn'),fit:value(form,'fit') || 'unchecked',followUpOn:value(form,'followUpOn'),returnBy:value(form,'returnBy'),returnByConfirmed:checked(form,'returnByConfirmed'),notes:value(form,'purchaseNotes')};}
  function fields(t,retailer,initial){
    t=t || {};var status=t.status || 'received';
    return '<input type="hidden" name="purchaseTracked" value="1"><div class="flights-controls"><label>Status<select name="status" onchange="updateShoppingPurchaseStage(this.form)">'+Object.keys(P.STATES).filter(function(k){return !initial || !['return_requested','returned'].includes(k);}).map(function(k){return '<option value="'+k+'"'+(k===status?' selected':'')+(status==='returned' && k!=='returned' || status!=='ordered' && t.status && k==='ordered'?' disabled':'')+'>'+P.STATES[k]+'</option>';}).join('')+'</select></label><label>Retailer actually bought from<input name="retailer" required maxlength="80" value="'+esc(t.retailer || retailer)+'"></label><label>Actual purchase date<input name="purchasedOn" type="date" required max="'+P.today()+'" value="'+esc(t.purchasedOn || (initial?P.today():''))+'"></label><label>Actual amount paid for this item · PHP<input name="amountPaid" type="number" min="0" max="1000000" step=".01" placeholder="Unknown" value="'+(t.amountPaid==null?'':t.amountPaid)+'"></label><label>Received date · optional<input name="receivedOn" type="date" max="'+P.today()+'" value="'+esc(t.receivedOn)+'"></label><label>Fit<select name="fit">'+Object.keys(P.FITS).map(function(k){return '<option value="'+k+'"'+((t.fit || 'unchecked')===k?' selected':'')+'>'+P.FITS[k]+'</option>';}).join('')+'</select></label><label>Delivery / return follow-up date · optional<input name="followUpOn" type="date" value="'+esc(t.followUpOn)+'"></label><label>Confirmed return deadline · optional<input name="returnBy" type="date" value="'+esc(t.returnBy)+'" onchange="this.form.elements.namedItem(\'returnByConfirmed\').checked=false"></label></div><label><input name="returnByConfirmed" type="checkbox"'+(t.returnByConfirmed?' checked':'')+'> I checked this return deadline with the retailer</label><p class="flights-note">Enter the actual amount paid, including this item’s delivery share if known; blank means unknown. Use a retailer-confirmed return deadline. Today shows follow-ups when due and return decisions two days before that deadline.</p><label>Purchase / fit notes<textarea name="purchaseNotes" maxlength="500" rows="2">'+esc(t.notes)+'</textarea></label>';
  }
  function wardrobe(p,editor){
    if(editor && p.recordedCount!==null)return '<p class="flights-note">Wardrobe addition already recorded · '+esc(S.PIECES.find(function(r){return r.id===p.piece;})?.label || p.piece)+': '+(p.previousCount===null?'unknown':p.previousCount)+' → '+p.recordedCount+(p.tracker?.effects?.wardrobeAdjusted?' · return adjustment applied':'')+'. Edit later counts in Your wardrobe.</p>';
    return '<div class="flights-controls"><label>Wardrobe category<select name="piece" onchange="updateShoppingPurchaseStage(this.form)"><option value="">Record only · category not set</option>'+S.PIECES.map(function(r){return '<option value="'+r.id+'"'+(r.id===p.piece?' selected':'')+'>'+esc(r.label)+'</option>';}).join('')+'</select></label><label>Total usable pieces now'+(editor?' · leave blank to keep counts unchanged':'')+'<input name="total" type="number" min="1" max="20" step="1" placeholder="Unknown"'+(p.tracker?.status==='ordered' || p.tracker?.status==='returned'?' disabled':'')+'></label></div><p class="flights-note">An order does not add usable clothing or fulfil a need. For a received item, choose a category and confirm your total to record it in the wardrobe.</p>';
  }
  function attach(a){
    var focusId='',panelOpen=false,reveal=false,todayToken=0,todayRead=null;
    function paintToday(prefs){
      var box=el('today-purchases');if(!box)return;
      if(root.daybookMember){box.hidden=true;box.innerHTML='';return;}
      var rows=P.due(S.cleanPurchases(prefs?.purchases),P.today());box.hidden=!rows.length;
      if(root.markTodayQuiet)root.markTodayQuiet(box,!rows.length);
      box.innerHTML=rows.length?'<h3>Purchase follow-ups · '+rows.length+'</h3><ul>'+rows.slice(0,5).map(function(r){return '<li><button class="tool-chip" onclick="openShoppingPurchase(\''+r.purchaseId+'\')">'+esc(r.title)+'</button><p>'+esc(r.detail)+' · '+esc(r.dueDate)+(r.overdue?' · overdue':r.dueDate===P.today()?' · today':' · soon')+'</p></li>';}).join('')+'</ul>'+(rows.length>5?'<button class="tool-chip" onclick="openShoppingPurchases()">View all '+rows.length+' due actions</button>':''):'';
    }
    root.renderTodayPurchases=function(){
      var uid=root._firebaseUid || '',box=el('today-purchases');if(!uid || root.daybookMember){if(box){box.hidden=true;box.innerHTML='';}return Promise.resolve();}
      if(todayRead && todayRead.uid===uid)return todayRead.promise;
      var token=++todayToken,promise=Promise.resolve().then(function(){return root.fbLoadShoppingPrefs();}).then(function(prefs){if(token===todayToken && uid===root._firebaseUid)paintToday(prefs);}).catch(function(){if(token!==todayToken || uid!==root._firebaseUid || !box)return;box.hidden=false;if(root.markTodayQuiet)root.markTodayQuiet(box,false);box.innerHTML='<p>Purchase follow-ups could not be loaded. <button class="tool-chip" onclick="renderTodayPurchases()">Retry</button></p>';}).finally(function(){if(todayRead?.promise===promise)todayRead=null;});
      todayRead={uid:uid,promise:promise};return promise;
    };
    function updatedToday(){todayToken++;todayRead=null;paintToday(a.prefs());}
    function paint(){
      var box=el('shopping-purchases');if(!box)return;var prefs=a.prefs(),disabled=!a.available() || a.busy(),rows=prefs.purchases || [],due=P.due(rows,P.today());
      box.innerHTML='<details id="shopping-purchases-panel"'+(panelOpen || focusId?' open':'')+' ontoggle="purchaseTrackerPanelOpen(this.open)"><summary>Purchase &amp; Returns · '+rows.length+' record'+(rows.length===1?'':'s')+(due.length?' · '+due.length+' due action'+(due.length===1?'':'s'):'')+'</summary><p class="flights-note">Private records, including purchases no longer in the scout. Up to 100 records. Undo purchase record removes a mistaken record and safely reverses its linked updates.</p>'+
        (!a.available()?'<p class="flights-note">Your purchase records could not be loaded. Reload Clothing to retry; saving is disabled.</p>':'')+
        '<details><summary>Add a purchase manually</summary><form onsubmit="event.preventDefault();addTrackedShoppingPurchase(this)"><fieldset '+(disabled?'disabled':'')+'><label>Item bought<input name="purchaseName" maxlength="140" required></label>'+fields(null,'',true)+wardrobe({piece:''},false)+a.needSelect(null,true)+'<button class="tool-chip" type="submit">Save purchase</button></fieldset></form></details>'+
        (rows.length?rows.slice().sort(function(a,b){var ad=due.find(function(r){return r.purchaseId===a.id;}),bd=due.find(function(r){return r.purchaseId===b.id;});return ad && bd?ad.dueDate.localeCompare(bd.dueDate):ad?-1:bd?1:Date.parse(b.at)-Date.parse(a.at);}).map(function(p){var action=due.find(function(r){return r.purchaseId===p.id;}),t=p.tracker,linked=prefs.needs.find(function(n){return n.id===p.needId && n.fulfillment?.purchaseId===p.id && n.fulfillment.purchaseAt===p.at;});
          return '<details id="purchase-entry-'+p.id+'" class="shopping-tracked-purchase"'+(p.id===focusId?' open':'')+'><summary>'+esc(p.name)+' · '+esc(t?P.STATES[t.status]:'Purchase recorded · add tracking')+(action?' · '+(action.overdue?'overdue since ':'due ')+action.dueDate:'')+'</summary><p class="flights-note">Recorded '+esc(p.at.slice(0,10))+(t?' · bought '+esc(t.purchasedOn)+' · '+esc(t.retailer)+(t.amountPaid!==null?' · paid '+price(t.amountPaid):' · paid amount unknown'):' · actual purchase date and paid amount not yet recorded')+'</p>'+(t?.effects.wardrobeReview?'<p class="flights-note">Your wardrobe count changed later and was kept. Review it in Your wardrobe.</p>':'')+(t?.effects.needReview?'<p class="flights-note">The linked need changed later and was kept. Review your shopping needs.</p>':'')+
            '<form data-tracker-editor="1" onsubmit="event.preventDefault();saveTrackedShoppingPurchase(\''+p.id+'\',this)"><fieldset '+(disabled?'disabled':'')+'>'+fields(t || (p.recordedCount!==null?{status:'received'}:null),'',false)+wardrobe(p,true)+'<fieldset data-return-choices '+(t?.status==='returned'?'':'disabled')+'><legend>When marked Returned · optional</legend>'+(p.recordedCount!==null && !t?.effects.wardrobeAdjusted?'<label><input type="checkbox" name="adjustWardrobe"> Undo this purchase’s recorded wardrobe addition, only if the count is still unchanged</label>':'<p class="flights-note">No unadjusted wardrobe addition remains on this record.</p>')+(linked && !t?.effects.needReopened?'<label><input type="checkbox" name="reopenNeed"> Reopen “'+esc(linked.text)+'” because this return leaves it unfilled</label>':'<p class="flights-note">No unchanged fulfilled need is linked to this purchase.</p>')+'<p class="flights-note">Neither choice is selected automatically. Later edits to counts or need fulfilments are protected.</p></fieldset><button class="tool-chip" type="submit">Save purchase details</button></fieldset></form>'+a.needActions(p)+' <button class="tool-chip" '+(disabled?'disabled':'')+' onclick="undoShoppingPurchase(\''+p.id+'\')">Undo purchase record</button></details>';
        }).join(''):'<p class="flights-note">No purchases recorded yet. Use Bought it on a deal, or add one manually.</p>')+'</details>';
      if(reveal){var target=el(focusId?'purchase-entry-'+focusId:'shopping-purchases-panel');if(target?.scrollIntoView){target.scrollIntoView({block:'start',behavior:'smooth'});reveal=false;}}
    }
    root.purchaseTrackerPanelOpen=function(open){panelOpen=!!open;};
    root.openShoppingPurchase=function(id){panelOpen=true;focusId=/^[a-z0-9-]{1,90}$/i.test(id || '')?id:'';reveal=true;var pending=root.switchPage?root.switchPage('shopping'):a.load();return Promise.resolve(pending).then(paint);};
    root.openShoppingPurchases=function(){return root.openShoppingPurchase('');};
    root.updateShoppingPurchaseStage=function(form){
      var status=value(form,'status'),piece=value(form,'piece'),total=field(form,'total'),need=field(form,'needId'),choices=form.querySelector?form.querySelector('[data-return-choices]'):null;
      if(total){total.disabled=status==='ordered' || status==='returned' || !piece;total.required=!total.disabled && form.getAttribute?.('data-tracker-editor')!=='1';}
      if(need)need.disabled=status==='ordered' || status==='returned';if(choices)choices.disabled=status!=='returned';
      if(status==='ordered'){var received=field(form,'receivedOn'),fit=field(form,'fit');if(received)received.value='';if(fit)fit.value='unchecked';}
    };
    root.addTrackedShoppingPurchase=async function(form){
      if(!a.available() || a.busy())return;try{var name=String(value(form,'purchaseName') || '').trim();if(!name)throw Error('Name the item you bought.');var id='purchase-'+root.crypto.randomUUID(),next=C.recordPurchase(a.prefs(),{id:id,name:name},value(form,'piece'),value(form,'total'),value(form,'needId'),undefined,read(form));
        if(await a.save(next)){focusId=id;paint();a.render();a.status('Purchase saved. Due delivery and return follow-ups appear on Today.');}
      }catch(e){a.status(e.message);}
    };
    root.saveTrackedShoppingPurchase=async function(id,form){
      if(!a.available() || a.busy())return;try{var r=C.updateTrackedPurchase(a.prefs(),id,read(form),{piece:value(form,'piece'),total:value(form,'total'),adjustWardrobe:checked(form,'adjustWardrobe'),reopenNeed:checked(form,'reopenNeed')});
        if(await a.save(r.prefs)){focusId=id;paint();a.render();a.status('Purchase details saved.'+(r.wardrobeReview?' Your later wardrobe count was kept; review it manually.':'')+(r.needReview?' Your changed shopping need was kept.':''));}
      }catch(e){a.status(e.message);}
    };
    return {paint:paint,updatedToday:updatedToday,read:read,fields:fields,reset:function(){focusId='';panelOpen=false;reveal=false;todayToken++;todayRead=null;var box=el('today-purchases');if(box){box.innerHTML='';box.hidden=true;}var panel=el('shopping-purchases');if(panel)panel.innerHTML='';}};
  }
  root.PurchaseTrackerUI={attach:attach};
})(typeof window!=='undefined'?window:globalThis);
