(function(root){
  'use strict';
  var STATES={ordered:'Ordered',received:'Received · deciding',kept:'Keeping it',return_requested:'Return requested',returned:'Returned'};
  var FITS={unchecked:'Not checked',fits:'Fits',small:'Too small',large:'Too large',other:'Other fit issue'};
  var isoDate=function(v){if(typeof v!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))return '';var d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===v?v:'';};
  function today(now){return new Date((now==null?Date.now():now)+8*3600000).toISOString().slice(0,10);}
  function plus(day,n){return new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);}
  function money(v){if(v===null || v===undefined || v==='')return null;var n=Number(v);return typeof v!=='boolean' && Number.isFinite(n) && n>=0 && n<=1000000 && Math.abs(n*100-Math.round(n*100))<0.000001?Math.round(n*100)/100:null;}
  function clean(raw){
    if(!raw || !Object.prototype.hasOwnProperty.call(STATES,raw.status) || !isoDate(raw.purchasedOn) || !String(raw.retailer || '').trim())return null;
    var r={status:raw.status,retailer:String(raw.retailer).trim().slice(0,80),purchasedOn:raw.purchasedOn,amountPaid:money(raw.amountPaid),currency:'PHP',receivedOn:isoDate(raw.receivedOn),fit:Object.prototype.hasOwnProperty.call(FITS,raw.fit)?raw.fit:'unchecked',followUpOn:isoDate(raw.followUpOn),returnBy:isoDate(raw.returnBy),returnByConfirmed:raw.returnByConfirmed===true,notes:String(raw.notes || '').trim().slice(0,500),effects:{wardrobeAdjusted:raw.effects?.wardrobeAdjusted===true,needReopened:raw.effects?.needReopened===true,wardrobeReview:raw.effects?.wardrobeReview===true,needReview:raw.effects?.needReview===true}};
    if(!r.returnByConfirmed)r.returnBy='';
    if(Number.isFinite(Date.parse(raw.updatedAt)))r.updatedAt=new Date(raw.updatedAt).toISOString();
    if(Number.isFinite(Date.parse(raw.returnedAt)))r.returnedAt=new Date(raw.returnedAt).toISOString();
    return r;
  }
  function validate(raw,now){
    raw=raw || {};var day=today(now);
    if(!Object.prototype.hasOwnProperty.call(STATES,raw.status))throw Error('Choose a purchase status.');
    if(!String(raw.retailer || '').trim() || String(raw.retailer).length>80)throw Error('Enter the retailer you bought from (up to 80 characters).');
    if(!isoDate(raw.purchasedOn) || raw.purchasedOn>day)throw Error('Enter the actual purchase date, today or earlier.');
    if(raw.currency && raw.currency!=='PHP')throw Error('Record the amount paid in PHP.');
    if(raw.amountPaid!==null && raw.amountPaid!==undefined && raw.amountPaid!=='' && money(raw.amountPaid)===null)throw Error('Enter the actual amount paid from ₱0 to ₱1,000,000 with at most two decimal places, or leave it unknown.');
    ['receivedOn','followUpOn','returnBy'].forEach(function(k){if(raw[k] && (!isoDate(raw[k]) || raw[k]<raw.purchasedOn))throw Error('Use valid dates on or after the purchase date.');});
    if(raw.receivedOn && raw.receivedOn>day)throw Error('The received date cannot be in the future.');
    if(raw.status==='ordered' && (raw.receivedOn || raw.fit && raw.fit!=='unchecked'))throw Error('Mark the item received before recording delivery or fit.');
    if(raw.returnBy && raw.returnByConfirmed!==true)throw Error('Confirm the return deadline with the retailer before saving it.');
    if(raw.fit && !Object.prototype.hasOwnProperty.call(FITS,raw.fit))throw Error('Choose a fit result.');
    if(String(raw.notes || '').length>500)throw Error('Keep purchase notes within 500 characters.');
    return clean(raw);
  }
  function returned(p){return p?.tracker?.status==='returned';}
  function canFulfil(p){return !p?.tracker || !['ordered','returned'].includes(p.tracker.status);}
  function due(purchases,day){
    day=isoDate(day) || today();var soon=plus(day,2),out=[];
    (Array.isArray(purchases)?purchases:[]).forEach(function(p){
      var t=clean(p && p.tracker);if(!t || !/^[a-z0-9-]{1,90}$/i.test(p.id || '') || !Number.isFinite(Date.parse(p.at)) || t.purchasedOn>day || t.status==='returned')return;
      var add=function(type,date,title,detail){out.push({id:'purchase-'+type+'-'+p.id,purchaseId:p.id,purchaseAt:p.at,type:type,dueDate:date,title:title,detail:detail,overdue:date<day});};
      if(t.status==='ordered' && t.followUpOn && t.followUpOn<=day)add('delivery',t.followUpOn,'Check delivery: '+p.name,'Your delivery follow-up date · '+t.retailer);
      if(t.status==='return_requested' && t.followUpOn && t.followUpOn<=day)add('follow-up',t.followUpOn,'Follow up your return: '+p.name,t.retailer+' · return requested');
      if(t.status!=='kept' && t.returnBy && t.returnBy<=soon)add('return',t.returnBy,(t.returnBy<day?'Return deadline passed: ':t.status==='return_requested'?'Complete your return: ':t.status==='ordered'?'Check return deadline while awaiting delivery: ':'Keep or return: ')+p.name,'Retailer-confirmed deadline · '+t.retailer+(t.fit!=='unchecked'?' · '+FITS[t.fit]:''));
    });
    return out.sort(function(a,b){return a.dueDate.localeCompare(b.dueDate) || ((a.type==='return'?0:1)-(b.type==='return'?0:1)) || a.id.localeCompare(b.id);});
  }
  root.PurchaseTracker={STATES:STATES,FITS:FITS,isoDate:isoDate,today:today,clean:clean,validate:validate,returned:returned,canFulfil:canFulfil,due:due};
})(typeof window!=='undefined'?window:globalThis);
