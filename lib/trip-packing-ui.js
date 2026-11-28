(function(root){
  'use strict';
  var P=root.TripPacking,C=root.ShoppingCore,state={uid:'',token:0,booked:{},plans:{},prefs:null,loaded:false,busy:false,read:null,error:'',clothingVersion:0},open=new Set(),focus='';
  function el(id){return root.document.getElementById(id);}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function allowed(){return !!root._firebaseUid && !root.daybookMember;}
  function current(uid,token){return allowed() && uid===root._firebaseUid && uid===state.uid && token===state.token;}
  function status(s){var box=el('packing-status');if(box)box.textContent=s;}
  function option(v,label,selected){return '<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(label)+'</option>';}
  function field(form,name){return form.elements.namedItem(name).value;}
  function rows(){return Object.keys(state.booked).map(function(id){return {id:id,t:root.FlightsCore.cleanBooked(state.booked[id])};}).filter(function(x){return x.t && (x.t.ret || x.t.depart)>=P.today();}).sort(function(a,b){return a.t.depart.localeCompare(b.t.depart);});}
  function paintToday(){
    var box=el('today-packing');if(!box)return;
    if(!allowed() || state.uid!==root._firebaseUid){box.hidden=true;box.innerHTML='';return;}
    if(state.error){box.hidden=false;if(root.markTodayQuiet)root.markTodayQuiet(box,false);box.innerHTML='<p>Trip preparation could not be loaded. <button class="tool-chip" onclick="renderTodayPacking()">Retry</button></p>';return;}
    if(!state.loaded)return;
    var due=P.due(state.booked,state.plans,state.prefs),unavailable=!state.prefs && due.length;
    box.hidden=!due.length;if(root.markTodayQuiet)root.markTodayQuiet(box,!due.length);
    box.innerHTML=due.length?'<div class="next-eyebrow">Trip preparation</div>'+ (unavailable?'<p>Clothing records could not be loaded; linked purchases need checking.</p>':'')+'<ul>'+due.slice(0,5).map(function(r){return '<li><button class="tool-chip" onclick="openTripPacking(\''+r.id+'\')">'+esc(r.city)+' · '+(r.days===0?'departs today':r.days===1?'tomorrow':'in '+r.days+' days')+'</button><p>'+esc(r.detail)+'</p></li>';}).join('')+'</ul>'+(due.length>5?'<button class="tool-chip" onclick="openTripPacking()">View all '+due.length+' trips</button>':''):'';
  }
  function wardrobeText(r){var w=P.wardrobe(r,state.prefs);if(!w)return '';return w.complete?w.count+' recorded in this wardrobe category'+(w.count<r.quantity?' · review a possible gap':''):'Wardrobe partly recorded: '+w.count+' known · availability unconfirmed';}
  function editor(id,r,isNew){
    var signal=P.effective(r,state.prefs),selected=signal.purchase?signal.purchase.id:r.purchaseId,needs=state.prefs?state.prefs.needs:[],purchases=state.prefs?state.prefs.purchases:[],disabled=state.busy || !state.loaded;
    return '<form onsubmit="event.preventDefault();savePackingItem(\''+id+'\',\''+r.id+'\',this)"><fieldset '+(disabled?'disabled':'')+'><div class="flights-controls">'+
      '<label>Item<input name="label" value="'+esc(r.label)+'" maxlength="100" required></label><label>Quantity<input name="quantity" type="number" min="1" max="99" step="1" value="'+r.quantity+'" required></label>'+
      '<label>Category<select name="category">'+P.CATEGORIES.map(function(c){return option(c,c,r.category);}).join('')+'</select></label>'+
      '<label>Preparation stage<select name="stage">'+Object.keys(P.STAGES).map(function(s){return option(s,P.STAGES[s],signal.stage);}).join('')+'</select></label>'+
      '<label>Clothing need · optional<select name="needId" '+(!state.prefs?'disabled':'')+'>'+option('','No linked need',r.needId)+(r.needId && !needs.some(function(n){return n.id===r.needId;})?option(r.needId,'Linked need unavailable',r.needId):'')+needs.map(function(n){return option(n.id,n.text+(n.fulfillment?' · fulfilled':''),r.needId);}).join('')+'</select></label>'+
      '<label>Purchase reference · optional<select name="purchaseId" '+(!state.prefs?'disabled':'')+'>'+option('','No linked purchase',selected)+(selected && !purchases.some(function(p){return p.id===selected;})?option(selected,'Linked purchase unavailable',selected):'')+purchases.map(function(p){return option(p.id,p.name+' · '+(p.tracker?root.PurchaseTracker.STATES[p.tracker.status]:'receipt untracked'),selected);}).join('')+'</select></label></div>'+
      '<p class="flights-note">Received or Packed confirms the full quantity above. A purchase reference does not prove quantity, fit, or delivery. Update delivery and returns in Clothing.</p>'+
      '<button class="tool-chip" type="submit">'+(isNew?'Add packing item':'Save item')+'</button></fieldset></form>';
  }
  function paint(){
    var box=el('trip-packing');if(!box)return;
    box.hidden=!allowed();if(!allowed()){box.innerHTML='';return;}
    var header='<h3>Trip Packing Planner</h3><p class="flights-note">Your own packing list for each booked trip. Wardrobe counts are hints; confirm what you have and pack each trip separately. Preparation appears on Today within 14 days; ready items appear three days before departure.</p><p id="packing-status" class="flights-note" role="status"></p>';
    if(state.error){box.innerHTML=header+'<p>Packing could not be loaded. Your saved lists have been kept. <button class="tool-chip" onclick="renderTripPacking()">Reload Packing</button></p>';status(state.error);return;}
    if(!state.loaded){box.innerHTML=header+'<p>Loading booked trips and packing lists…</p>';return;}
    var trips=rows();
    box.innerHTML=header+(!state.prefs?'<p class="packing-issue">Clothing records could not be read. Reload Packing to reconnect. Manual packing is available; linking needs and purchases is disabled.</p>':'')+
      (!trips.length?'<p class="flights-note">Add a booked trip above to start its packing checklist.</p>':trips.map(function(x){
        var id=x.id,t=x.t,p=state.plans[id],key=P.tripKey(t),s=p?P.summary(p,state.prefs):null;
        var body;
        if(!p)body='<p class="flights-note">Start with an editable list of clothes and daily essentials. Quantities are for you, not all travellers; adjust for laundry and your plans. A trip without a return date starts with a one-night list.</p><button class="tool-chip" onclick="startTripPacking(\''+id+'\')">Build packing checklist</button>';
        else if(p.tripKey!==key)body='<p class="packing-issue">The booked dates or destination changed. Review your quantities for this trip. Keeping this list will reset Packed items to Already owned, so you confirm packing again.</p><button class="tool-chip" onclick="reviewTripPacking(\''+id+'\')">Keep list for updated trip</button><button class="tool-chip" onclick="clearTripPacking(\''+id+'\')">Delete old checklist</button>';
        else body='<p class="flights-note">'+(s.total?s.packed+' of '+s.total+' items packed':'Your list is empty. Add an item below.')+(t.travellers>1?' · Personal list · trip has '+t.travellers+' travellers':'')+'. Suggested quantities cover up to seven days before laundry. Seasonal clothing uses rough monthly climate normals where available; check the forecast yourself.</p>'+p.items.map(function(r){
          var e=P.effective(r,state.prefs),w=wardrobeText(r),k=id+'-'+r.id;
          return '<details class="packing-item" id="packing-item-'+k+'"'+(open.has(k)?' open':'')+' ontoggle="packingDetailsOpen(\''+k+'\',this.open)"><summary>'+r.quantity+' × '+esc(r.label)+' · '+esc(P.STAGES[e.stage])+'</summary>'+
            (w?'<p class="flights-note">'+esc(w)+'. Counts do not confirm the right size, condition, or availability.</p>':'')+(e.issue?'<p class="packing-issue">'+esc(e.issue)+'.</p>':'')+
            (e.purchase?'<button class="tool-chip" onclick="openShoppingPurchase(\''+e.purchase.id+'\')">View purchase in Clothing</button>':'')+(e.need?'<p class="flights-note">Linked need: '+esc(e.need.text)+(e.need.fulfillment?' · fulfilled':' · open')+'</p><button class="tool-chip" onclick="openPackingNeed(\''+e.need.id+'\')">View need in Clothing</button>':'')+
            editor(id,r,false)+'<div class="flight-actions">'+(r.category!=='Essentials' && !e.need?'<button class="tool-chip" '+(!state.prefs?'disabled':'')+' onclick="createPackingNeed(\''+id+'\',\''+r.id+'\')">Create Clothing need for saved item</button>':'')+'<button class="tool-chip" onclick="removePackingItem(\''+id+'\',\''+r.id+'\')">Remove item</button></div></details>';
        }).join('')+'<details ontoggle="packingDetailsOpen(\''+id+'-new\',this.open)"'+(open.has(id+'-new')?' open':'')+'><summary>+ Add a packing item</summary>'+editor(id,{id:'new',label:'',quantity:1,category:'Essentials',stage:'needed',needId:'',purchaseId:''},true)+'</details>';
        return '<details class="packing-trip" id="packing-trip-'+id+'"'+(focus===id || open.has(id)?' open':'')+' ontoggle="packingDetailsOpen(\''+id+'\',this.open)"><summary><b>'+esc(t.city)+'</b> · '+esc(t.depart)+(t.ret?' – '+esc(t.ret):' · return date unknown')+' · '+(p && p.tripKey===key?s.packed+'/'+s.total+' packed':'checklist '+(p?'needs review':'not started'))+'</summary>'+body+'</details>';
      }).join(''))+'<button class="tool-chip" onclick="renderTripPacking()">Reload Packing</button>';
    if(focus){var target=el('packing-trip-'+focus);if(target && target.scrollIntoView)target.scrollIntoView({block:'start',behavior:'smooth'});focus='';}
  }
  async function load(){
    if(!allowed()){paint();paintToday();return;}
    var uid=root._firebaseUid;
    if(state.read && state.uid===uid)return state.read;
    if(state.uid!==uid){root.resetTripPacking();state.uid=uid;}
    if(state.busy)return;
    var token=++state.token,version=state.clothingVersion;state.error='';if(!state.loaded)paint();
    var promise=Promise.allSettled([function(){return root.fbLoadBookedTrips();},function(){return root.fbLoadTripPacking();},function(){return root.fbLoadPackingClothing?root.fbLoadPackingClothing():root.fbLoadShoppingPrefs();}].map(function(read){return Promise.resolve().then(read);})).then(function(results){
      if(!current(uid,token))return;
      if(results[0].status!=='fulfilled' || results[1].status!=='fulfilled')throw Error('Reload to read your booked trips and saved packing lists before editing.');
      var booked=results[0].value;if(!booked || !booked.items || typeof booked.items!=='object' || Array.isArray(booked.items))throw Error('Booked trips could not be read.');
      state.booked=booked.items;state.plans=P.plans(results[1].value);if(version===state.clothingVersion)state.prefs=results[2].status==='fulfilled'?C.cleanPrefs(results[2].value):null;state.loaded=true;paint();paintToday();
    }).catch(function(e){if(!current(uid,token))return;state.loaded=false;state.error=e.message || 'Packing could not be loaded.';paint();paintToday();}).finally(function(){if(state.read===promise)state.read=null;});
    state.read=promise;return promise;
  }
  function setBusy(on){state.busy=on;if(root.document.querySelectorAll)root.document.querySelectorAll('#trip-packing fieldset').forEach(function(f){f.disabled=on;});}
  async function save(id,cmd,message){
    if(!allowed() || state.uid!==root._firebaseUid || !state.loaded || state.busy)return;
    if(state.read){status('Packing is reloading. Wait for it to finish before saving.');return;}
    var uid=state.uid,token=state.token;setBusy(true);status('Saving…');
    try{
      cmd.tripKey=P.tripKey(state.booked[id]);var result=await root.fbUpdateTripPacking(id,cmd);if(!current(uid,token))return;
      state.plans=P.plans(result.plans);if(result.profile){state.prefs=C.cleanPrefs(result.profile);state.clothingVersion++;}setBusy(false);paint();paintToday();status(message);return true;
    }catch(e){if(!current(uid,token))return;setBusy(false);status(e.message || 'Could not save. Your edits are still here; retry or reload Packing.');return false;}
  }
  function command(id,row,op){var p=state.plans[id];return {op:op,id:row,expected:p && p.items.find(function(r){return r.id===row;}) || null};}
  root.packingDetailsOpen=function(id,on){if(on)open.add(id);else open.delete(id);};
  root.startTripPacking=function(id){open.add(id);return save(id,{op:'start'},'Packing checklist created. Review quantities and confirm what you already own.');};
  root.reviewTripPacking=function(id){return save(id,{op:'review',expected:state.plans[id]},'Checklist kept for the new trip dates. Confirm packing again.');};
  root.clearTripPacking=function(id){return save(id,{op:'clear',expected:state.plans[id]},'Old checklist deleted. Build a new one for this trip.');};
  root.removePackingItem=function(id,row){return save(id,command(id,row,'remove'),'Packing item removed. Linked Clothing records were kept.');};
  root.createPackingNeed=function(id,row){return save(id,command(id,row,'need'),'Shopping need linked. Find it in Clothing, then link the purchase here when ordered.');};
  root.savePackingItem=function(id,row,form){
    try{
      var isNew=row==='new',cmd=command(id,row,'put'),purchaseId=field(form,'purchaseId'),purchase=state.prefs && state.prefs.purchases.find(function(p){return p.id===purchaseId;}),old=cmd.expected;
      if(isNew)row='p'+root.crypto.randomUUID().replace(/-/g,'').slice(0,16);
      cmd.id=row;cmd.item=P.item({id:row,label:field(form,'label'),quantity:Number(field(form,'quantity')),category:field(form,'category'),stage:field(form,'stage'),needId:field(form,'needId'),purchaseId:purchaseId,purchaseAt:purchase?purchase.at:old && old.purchaseAt});
      open.add(id+'-'+row);return save(id,cmd,'Packing item saved. Today reflects unfinished preparation.');
    }catch(e){status(e.message);return Promise.resolve(false);}
  };
  root.openPackingNeed=function(id){return Promise.resolve(root.switchPage('shopping')).then(function(){if(!allowed())return;var filter=el('shopping-need');if(filter){filter.value=id;root.renderShoppingDeals();}if(root.showShoppingNeeds)root.showShoppingNeeds();});};
  root.openTripPacking=function(id){focus=id || '';if(id)open.add(id);return root.switchPage?Promise.resolve(root.switchPage('flights')).then(function(){return state.read || load();}).then(paint):load();};
  root.renderTripPacking=load;
  root.renderTodayPacking=load;
  root.tripPackingClothingChanged=function(prefs){if(!allowed() || state.uid!==root._firebaseUid)return;state.clothingVersion++;state.prefs=C.cleanPrefs(prefs);paintToday();if(!state.busy)paint();};
  root.resetTripPacking=function(){state.token++;state.uid='';state.booked={};state.plans={};state.prefs=null;state.loaded=false;state.read=null;state.error='';state.busy=false;state.clothingVersion++;open.clear();focus='';['trip-packing','today-packing'].forEach(function(id){var b=el(id);if(b){b.innerHTML='';b.hidden=true;}});};
})(typeof window!=='undefined'?window:globalThis);
