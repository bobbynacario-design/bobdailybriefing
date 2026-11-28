(function(root){
  'use strict';
  var STAGES={needed:'Need to prepare',owned:'Already owned',ordered:'Ordered · awaiting delivery',received:'Received · ready to pack',packed:'Packed'};
  var CATEGORIES=['Essentials','Tops','Trousers','Shorts','Footwear','Outerwear'];
  var PIECES={Essentials:[],Tops:['tee-light','tee-dark','polo','shirt','resort'],Trousers:['chinos','jeans','joggers'],Shorts:['shorts'],Footwear:['sneakers','trainers','smart-shoes','sandals'],Outerwear:['knit','hoodie','jacket','blazer']};
  var own=function(o,k){return Object.prototype.hasOwnProperty.call(o || {},k);};
  function fail(s){throw Error(s);}
  function day(v){return /^\d{4}-\d{2}-\d{2}$/.test(v || '') && Number.isFinite(Date.parse(v)) && new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}
  function today(now){return new Date((now===undefined?Date.now():now)+8*3600000).toISOString().slice(0,10);}
  function days(a,b){return Math.round((Date.parse(b)-Date.parse(a))/86400000);}
  function tripKey(t){if(!t || !day(t.depart) || t.ret && (!day(t.ret) || t.ret<t.depart) || !/^[A-Z]{3}$/.test(t.destination || ''))fail('Reload a valid booked trip first.');return t.destination+'|'+t.depart+'|'+(t.ret || '');}
  function item(r){
    if(!r || !/^[a-z0-9-]{1,20}$/i.test(r.id || ''))fail('Invalid packing item.');
    var label=String(r.label || '').trim(),quantity=Number(r.quantity);
    if(!label || label.length>100 || !Number.isInteger(quantity) || quantity<1 || quantity>99 || !CATEGORIES.includes(r.category) || !own(STAGES,r.stage))fail('Use an item name, a quantity from 1 to 99, a category and a preparation stage.');
    var needId=r.needId || '',purchaseId=r.purchaseId || '',purchaseAt=r.purchaseAt || '';
    if(needId && !/^[a-z0-9-]{1,40}$/i.test(needId) || purchaseId && (!/^[a-z0-9-]{1,90}$/i.test(purchaseId) || !Number.isFinite(Date.parse(purchaseAt))))fail('Reload the linked Clothing record.');
    return {id:r.id,label:label,quantity:quantity,category:r.category,stage:r.stage,needId:needId,purchaseId:purchaseId,purchaseAt:purchaseId?new Date(purchaseAt).toISOString():''};
  }
  function plans(raw){
    var input=raw || {};if(typeof input!=='object' || Array.isArray(input) || Object.keys(input).length>200)fail('Packing data could not be read. Reload before editing.');
    var out={};Object.keys(input).forEach(function(id){
      var p=input[id];if(!/^b[a-z0-9]{4,16}$/.test(id) || !p || typeof p.tripKey!=='string' || !/^[A-Z]{3}\|\d{4}-\d{2}-\d{2}\|(?:\d{4}-\d{2}-\d{2})?$/.test(p.tripKey) || !Array.isArray(p.items) || p.items.length>40)fail('Packing data could not be read. Reload before editing.');
      var rows=p.items.map(item);if(new Set(rows.map(function(r){return r.id;})).size!==rows.length)fail('Duplicate packing items. Reload before editing.');
      out[id]={tripKey:p.tripKey,items:rows};
    });return out;
  }
  function suggest(t){
    tripKey(t);var nights=Math.max(1,days(t.depart,t.ret || t.depart)),climate=root.ShoppingTrips.CLIMATE[t.city],temps=climate?climate[Number(t.depart.slice(5,7))-1]:null;
    var rows=[['tops','Tops',Math.min(nights+1,7),'Tops'],['bottoms','Trousers',Math.max(1,Math.ceil(Math.min(nights,8)/4)),'Trousers'],['shoes','Closed shoes',nights>=7?2:1,'Footwear']];
    if(temps && temps[1]>=28)rows.push(['shorts','Shorts',1,'Shorts']);
    if(temps && temps[0]<=20)rows.push(['layer',temps[0]<=12?'Warm layers / jacket':'Warm layer',temps[0]<=12?2:1,'Outerwear']);
    rows.push(['underwear','Underwear',Math.min(nights+1,7),'Essentials'],['socks','Socks',Math.min(nights+1,7),'Essentials'],['toiletries','Toiletries',1,'Essentials'],['charger','Phone charger / cables',1,'Essentials']);
    return {tripKey:tripKey(t),items:rows.map(function(r){return item({id:r[0],label:r[1],quantity:r[2],category:r[3],stage:'needed'});})};
  }
  function evidence(r,prefs){
    var need=prefs && (prefs.needs || []).find(function(n){return n.id===r.needId;}),f=need && need.fulfillment;
    var id=r.purchaseId || f && f.purchaseId,at=r.purchaseId?r.purchaseAt:f && f.purchaseAt;
    var p=prefs && (prefs.purchases || []).find(function(p){return p.id===id && p.at===at;});
    return {need:need || null,purchase:p || null,linked:!!id};
  }
  function effective(r,prefs){
    var e=evidence(r,prefs),p=e.purchase,stage=r.stage,issue='';
    if(e.linked){
      var s=p && p.tracker && p.tracker.status;
      if(!prefs)issue='Clothing records unavailable';
      else if(!p)issue='Linked purchase is missing or changed';
      else if(s==='returned' || s==='return_requested')issue=s==='returned'?'Linked purchase returned':'Return requested';
      else if(p.tracker && ['small','large','other'].includes(p.tracker.fit))issue='Resolve the purchase’s fit issue';
      else if(s==='ordered')stage='ordered';
      else if(s==='received' || s==='kept' || !s && p.recordedCount!==null && p.recordedCount!==undefined){if(stage!=='packed')stage='received';}
      else issue='Confirm receipt in Clothing';
      if(issue)stage='needed';
    }
    return {stage:stage,issue:issue,purchase:p,need:e.need};
  }
  function wardrobe(r,prefs){
    if(!prefs || r.category==='Essentials')return null;
    var w=prefs.wardrobe || {},keys=PIECES[r.category],known=keys.filter(function(k){return own(w,k);});
    return {count:known.reduce(function(n,k){return n+w[k];},0),complete:known.length===keys.length};
  }
  function summary(p,prefs){var out={total:p.items.length,packed:0,needed:0,ordered:0,unpacked:0};p.items.forEach(function(r){var s=effective(r,prefs).stage;if(s==='packed')out.packed++;else{out.unpacked++;if(s==='needed')out.needed++;if(s==='ordered')out.ordered++;}});return out;}
  function due(booked,all,prefs,at){
    var date=at || today(),out=[];
    Object.keys(booked || {}).forEach(function(id){var t=booked[id],key;try{key=tripKey(t);}catch(e){return;}var left=days(date,t.depart);if(left<0 || left>14)return;
      var p=all[id],s=p?summary(p,prefs):null,detail;
      if(!p)detail='Build your packing checklist';else if(p.tripKey!==key)detail='Review packing after the trip dates or destination changed';
      else if(!s.total)detail='Add items to your empty packing checklist';
      else if(s.needed || s.ordered)detail=[s.needed?s.needed+' item'+(s.needed===1?'':'s')+' to prepare':'',s.ordered?s.ordered+' awaiting delivery':'',left<=3 && s.unpacked-s.needed-s.ordered?(s.unpacked-s.needed-s.ordered)+' ready to pack':''].filter(Boolean).join(' · ');
      else if(left<=3 && s.unpacked)detail=s.unpacked+' item'+(s.unpacked===1?'':'s')+' still unpacked';
      if(detail)out.push({id:id,city:t.city || t.destination,depart:t.depart,days:left,detail:detail});
    });return out.sort(function(a,b){return a.depart.localeCompare(b.depart) || a.id.localeCompare(b.id);});
  }
  function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
  function apply(raw,id,t,cmd,prefs){
    if(!/^b[a-z0-9]{4,16}$/.test(id || ''))fail('Invalid booked trip.');
    var all=plans(raw),key=tripKey(t),p=all[id],profile=null;
    function conflict(){fail('This packing item changed on another device. Reload Packing before saving.');}
    if(cmd.tripKey!==key)fail('This trip changed. Reload Packing and review its dates.');
    if(cmd.op==='start'){if(p)conflict();if(Object.keys(all).length>=200)fail('Your packing history is full.');all[id]=suggest(t);}
    else {
      if(!p)conflict();
      if(cmd.op==='review' || cmd.op==='clear'){
        if(!same(p,cmd.expected))conflict();
        if(cmd.op==='clear')delete all[id];
        else {p.tripKey=key;p.items=p.items.map(function(r){return Object.assign({},r,{stage:r.stage==='packed'?'owned':r.stage});});}
      }else{
        if(p.tripKey!==key)fail('Review the changed trip dates before editing its packing list.');
        var old=p.items.find(function(r){return r.id===cmd.id;}) || null;
        if(!same(old,cmd.expected))conflict();
        if(cmd.op==='remove'){if(!old)conflict();p.items=p.items.filter(function(r){return r.id!==cmd.id;});}
        else if(cmd.op==='put'){
          var r=item(cmd.item);if(r.id!==cmd.id)fail('Invalid packing item.');
          var e=evidence(r,prefs);
          if(!r.purchaseId && e.purchase){r.purchaseId=e.purchase.id;r.purchaseAt=e.purchase.at;}
          if(r.needId && (!prefs || !e.need))fail('The linked shopping need changed. Reload Packing.');
          var signal=effective(r,prefs);
          if(r.purchaseId && !signal.purchase)fail('The linked purchase changed. Reload Packing.');
          if(['owned','received','packed'].includes(r.stage) && r.purchaseId && (signal.issue || signal.stage==='ordered'))fail(signal.issue || 'This purchase is still ordered. Confirm receipt in Clothing before marking it ready or packed.');
          if(!old && p.items.length>=40)fail('This trip has 40 packing items. Remove one before adding another.');
          if(old)p.items=p.items.map(function(x){return x.id===r.id?r:x;});else p.items.push(r);
        }else if(cmd.op==='need'){
          if(!old || old.category==='Essentials')fail('Create shopping needs for clothing items only.');
          if(!prefs)fail('Reload Clothing before adding a shopping need.');
          profile=root.ShoppingCore.cleanPrefs(prefs);
          var existing=profile.needs.find(function(n){return n.id===old.needId;});
          if(!existing){
            if(root.ShoppingCore.openNeeds(profile).length>=10)fail('You have 10 open shopping needs. Complete or remove one in Clothing first.');
            var needId=(id+'-'+old.id).slice(0,40);
            existing=profile.needs.find(function(n){return n.id===needId;});
            if(!existing){existing={id:needId,text:(t.city+' packing: '+old.quantity+' × '+old.label).slice(0,120),category:old.category};profile.needs.push(existing);profile=root.ShoppingCore.cleanPrefs(profile);}
          }
          old.needId=existing.id;
        }else fail('Unknown packing action.');
      }
    }
    return {plans:all,profile:profile};
  }
  root.TripPacking={STAGES:STAGES,CATEGORIES:CATEGORIES,PIECES:PIECES,today:today,tripKey:tripKey,item:item,plans:plans,suggest:suggest,effective:effective,wardrobe:wardrobe,summary:summary,due:due,apply:apply};
})(typeof globalThis!=='undefined'?globalThis:this);
