(function(root){
  'use strict';
  // Bob's style guide: the core pieces his life uses, outfit formulas for the
  // four things he dresses for, and the checks that keep a cheap deal from
  // sitting unworn. Deterministic: names, listed colours and his wardrobe
  // counts only, no AI and no guesses from photos.
  var PIECES=[
    {id:'tee-light',label:'White or light tee',many:'light tees',slot:'top',target:3},
    {id:'tee-dark',label:'Dark tee (black, navy, grey)',many:'dark tees',slot:'top',target:3},
    {id:'polo',label:'Polo shirt',many:'polos',slot:'top',target:2},
    {id:'shirt',label:'Button shirt (oxford, linen)',many:'button shirts',slot:'top',target:2},
    {id:'resort',label:'Short-sleeve camp or resort shirt',many:'resort shirts',slot:'top',target:2},
    {id:'knit',label:'Light knit or sweatshirt',many:'knits',slot:'layer',target:1},
    {id:'hoodie',label:'Hoodie or zip-up',many:'hoodies',slot:'layer',target:1},
    {id:'jacket',label:'Light jacket or overshirt',many:'light jackets',slot:'layer',target:1},
    {id:'blazer',label:'Blazer',many:'blazers',slot:'layer',target:1},
    {id:'chinos',label:'Chinos or smart trousers',many:'chinos',slot:'bottom',target:2},
    {id:'jeans',label:'Dark jeans',many:'dark jeans',slot:'bottom',target:1},
    {id:'shorts',label:'Casual shorts',many:'casual shorts',slot:'bottom',target:2},
    {id:'joggers',label:'Joggers or track pants',many:'joggers',slot:'bottom',target:1},
    {id:'sneakers',label:'Clean everyday sneakers',many:'everyday sneakers',slot:'shoes',target:1},
    {id:'trainers',label:'Running or gym trainers',many:'trainers',slot:'shoes',target:1},
    {id:'smart-shoes',label:'Loafers or smart shoes',many:'smart shoes',slot:'shoes',target:1},
    {id:'sandals',label:'Sandals, slides or clogs',many:'sandals or slides',slot:'shoes',target:1},
    {id:'active-top',label:'Gym or running top',many:'gym tops',slot:'active',target:3},
    {id:'active-shorts',label:'Gym or running shorts',many:'gym shorts',slot:'active',target:2}
  ];
  // Each slot lists the pieces that can fill it; an outfit is wearable when
  // every slot has at least one piece he owns.
  var OUTFITS=[
    {occasion:'Home and video calls',name:'Camera-ready',slots:[['shirt','polo'],['shorts','joggers','chinos']]},
    {occasion:'Home and video calls',name:'Easy desk day',slots:[['tee-light','tee-dark'],['shorts','joggers'],['sandals']]},
    {occasion:'Poker nights and trips',name:'Casino night (cold air-con)',slots:[['tee-dark','tee-light','polo'],['knit','hoodie','jacket'],['jeans','chinos'],['sneakers']]},
    {occasion:'Poker nights and trips',name:'Travel day',slots:[['tee-light','tee-dark'],['hoodie','jacket'],['joggers','jeans'],['sneakers','trainers']]},
    {occasion:'Gym, walking and running',name:'Run or gym',slots:[['active-top'],['active-shorts'],['trainers']]},
    {occasion:'Gym, walking and running',name:'Long walk',slots:[['tee-light','tee-dark','active-top'],['shorts','active-shorts'],['trainers','sneakers']]},
    {occasion:'Going out and events',name:'Dinner out',slots:[['shirt','resort','polo'],['chinos','jeans'],['sneakers','smart-shoes']]},
    {occasion:'Going out and events',name:'Smart event',slots:[['shirt'],['blazer'],['chinos'],['smart-shoes']]},
    {occasion:'Going out and events',name:'Weekend',slots:[['resort','tee-light','polo'],['shorts','chinos'],['sneakers','sandals']]}
  ];
  var RULES=[
    'Would you buy it at full price? If not, the discount is the only reason. Skip it.',
    'It supports at least two outfit formulas with pieces you have recorded.',
    'It is in your colours, so it pairs with the rest without thinking.',
    'It fills a gap in your wardrobe rather than adding a fourth of the same.',
    'It suits Manila (cotton, linen, quick-dry), or a trip or event you actually have coming.'
  ];
  var byId={};PIECES.forEach(function(p){byId[p.id]=p;});
  function cleanWardrobe(raw){var out={};PIECES.forEach(function(p){var value=(raw || {})[p.id];if(value==null || typeof value==='boolean' || typeof value==='string' && !value.trim())return;var n=Number(value);if(Number.isInteger(n) && n>=0 && n<=20)out[p.id]=n;});return out;}
  function owned(prefs,id){return Object.prototype.hasOwnProperty.call(prefs.wardrobe || {},id)?prefs.wardrobe[id]:null;}
  function light(item){var c=String(item.color || '').split('/')[0] || String(item.name || '');return /\b(white|cream|beige|ecru|ivory|sand|stone|off-white|light)\b/i.test(c);}
  // Which core piece a listing is, from its name and category. Some items get
  // a hard "skip" (gear for a sport he doesn't do); null means not a core piece.
  function classify(item){
    var n=String(item.name || ''),c=item.category;
    if(c==='Footwear'){
      if(/\bspikes?\b/i.test(n))return {skip:'Track spikes are built for running tracks, not streets or gyms.'};
      if(/\b(cleats?|football boots?|firm ground|golf)\b/i.test(n))return {skip:'Made for a sport your guide doesn’t include.'};
      if(/\b(slides?|sandals?|clogs?|flips?|flip-flops?)\b/i.test(n))return {piece:'sandals'};
      // Crocs names its clogs by line ("Crocband In White"), not by "clog".
      if(item.brand==='Crocs' && !/\bsneakers?\b/i.test(n))return {piece:'sandals'};
      if(/\b(running|run|trail|training|trainers?|gym|road)\b/i.test(n))return {piece:'trainers'};
      if(/\b(loafers?|derby|brogues?|boots?|dress shoes?)\b/i.test(n))return {piece:'smart-shoes'};
      return {piece:'sneakers'};
    }
    if(c==='Outerwear'){
      if(/\btuxedo\b/i.test(n))return {piece:'blazer',formal:'A tuxedo jacket is black-tie only.'};
      if(/\b(blazers?|double-breasted|suit|sport coat)\b/i.test(n))return {piece:'blazer'};
      if(/\b(hoodie|hooded|zip)\b/i.test(n))return {piece:'hoodie'};
      return {piece:'jacket'};
    }
    if(c==='Trousers')return {piece:/\b(jeans|denim)\b/i.test(n)?'jeans':/\b(joggers?|track|sweat ?pants?)\b/i.test(n)?'joggers':'chinos'};
    if(c==='Shorts')return {piece:/\b(running|training|gym|dri-fit|sport)\b/i.test(n)?'active-shorts':'shorts'};
    if(c==='Tops'){
      if(/\bpolo\b/i.test(n))return {piece:'polo'};
      if(/\b(running|training|gym|workout|tennis|athletic)\b/i.test(n))return {piece:'active-top'};
      // "UT" is UNIQLO's graphic-tee line ("PEANUTS UT"); case matters here.
      if(/\b(t-?shirt|tee|tank)\b/i.test(n) || /\bUT\b/.test(n)){var color=root.ShoppingTaste.features(item).colors[0];return light(item)?{piece:'tee-light'}:['Black','Navy','Grey'].includes(color)?{piece:'tee-dark'}:{candidates:['tee-light','tee-dark']};}
      if(/\b(corduroy|flannel|overshirt|shirt jacket)\b/i.test(n))return {piece:'jacket'};
      if(/\b(sweaters?|knit|cardigan|sweatshirt|crewneck)\b/i.test(n))return {piece:'knit'};
      if(/\b(resort|camp|hawaiian)\b/i.test(n))return {piece:'resort'};
      if(/\bshirt\b/i.test(n))return {piece:'shirt'};
    }
    return {};
  }
  function outfitsWith(piece,prefs){
    return OUTFITS.filter(function(o){var slot=o.slots.findIndex(function(s){return s.includes(piece);});if(slot<0)return false;return o.slots.every(function(s,i){return i===slot || s.some(function(id){return owned(prefs,id)>0;});});});
  }
  function wearable(o,prefs){return o.slots.every(function(s){return s.some(function(id){return owned(prefs,id)>0;});});}
  function cleanPurchases(rows){var seen=new Set();return (Array.isArray(rows)?rows:[]).slice(-100).reverse().filter(function(r){if(!r || !/^[a-z0-9-]{1,90}$/i.test(r.id || '') || seen.has(r.id) || !Number.isFinite(Date.parse(r.at)))return false;seen.add(r.id);return true;}).reverse().map(function(r){var piece=Object.prototype.hasOwnProperty.call(byId,r.piece)?r.piece:'',valid=function(n){return typeof n==='number' && Number.isInteger(n) && n>=0 && n<=20;};return {id:r.id,name:String(r.name || '').slice(0,140),piece:piece,at:r.at,previousCount:piece && valid(r.previousCount)?r.previousCount:null,recordedCount:piece && valid(r.recordedCount) && r.recordedCount>0?r.recordedCount:null};});}
  function bought(prefs,item,piece,total,at){
    var purchases=cleanPurchases(prefs.purchases),wardrobe=cleanWardrobe(prefs.wardrobe);
    if(!/^[a-z0-9-]{1,90}$/i.test(item.id || ''))throw Error('This item cannot be recorded.');
    if(purchases.some(function(p){return p.id===item.id;}))throw Error('This item is already recorded as bought.');
    if(piece && !Object.prototype.hasOwnProperty.call(byId,piece))throw Error('Choose a wardrobe category.');
    if(piece && (!Number.isInteger(Number(total)) || Number(total)<1 || Number(total)>20))throw Error('Enter how many you own now, from 1 to 20.');
    var prior=piece && Object.prototype.hasOwnProperty.call(wardrobe,piece)?wardrobe[piece]:null;
    if(piece)wardrobe[piece]=Number(total);
    purchases.push({id:item.id,name:item.name,piece:piece || '',at:at || new Date().toISOString(),previousCount:prior,recordedCount:piece?Number(total):null});
    return Object.assign({},prefs,{wardrobe:wardrobe,purchases:cleanPurchases(purchases)});
  }
  function undoBought(prefs,id){
    var purchases=cleanPurchases(prefs.purchases),entry=purchases.find(function(p){return p.id===id;}),wardrobe=cleanWardrobe(prefs.wardrobe),review=false;
    if(entry && entry.piece && entry.recordedCount!==null){if(wardrobe[entry.piece]===entry.recordedCount){if(entry.previousCount===null)delete wardrobe[entry.piece];else wardrobe[entry.piece]=entry.previousCount;}else review=true;}
    return {prefs:Object.assign({},prefs,{wardrobe:wardrobe,purchases:purchases.filter(function(p){return p.id!==id;})}),review:review};
  }
  function verdict(item,prefs){
    var T=root.ShoppingTaste,k=classify(item),flags=[],good=[],pending=[],hasWardrobe=Object.keys(prefs.wardrobe || {}).length>0;
    if((prefs.purchases || []).some(function(p){return p.id===item.id;}))return {kind:'owned',label:'Already bought',piece:k.piece,reasons:['Recorded in your purchases. Check your wardrobe before buying another.']};
    if(k.skip)return {kind:'skip',label:'Likely to sit unworn',reasons:[k.skip]};
    var n=String(item.name || '')+' '+String(item.color || '');
    if(/\b(wool|wool-blend|fleece|down jacket|down-filled|puffer|padded|quilted|thermal|sherpa|corduroy)\b/i.test(n))flags.push('Warm fabric for Manila: worth it for casino air-con, cold trips or evening events.');
    if(k.formal)flags.push(k.formal+' Buy it only for an event you have coming.');
    var comparison=T.compare(item,prefs);
    flags.push.apply(flags,comparison.conflicts.map(function(c){return c.text;}));
    flags.push.apply(flags,T.assess(item,prefs).cautions.filter(function(c){return /^Shares /.test(c);}));
    if((prefs.feedback || []).some(function(f){return f.id===item.id && f.vote==='pass';}))flags.push('You marked this item Not for me.');
    if(comparison.unknown.length)pending.push('Confirm the preferred traits the listing does not establish.');
    if(!k.piece){if(hasWardrobe)pending.push('Confirm its wardrobe category; no wardrobe gap is assumed.');return flags.length?{kind:'check',label:'Check first',reasons:flags.slice(0,3)}:pending.length?{kind:'promising',label:'Check wardrobe category',reasons:pending}:{kind:'none',label:'',reasons:[]};}
    var p=byId[k.piece],have=owned(prefs,k.piece);
    if(hasWardrobe){
      if(have===null)pending.push('Your '+p.many+' count is not recorded; a gap is not assumed.');
      else if(have>=p.target)flags.push('Already covered: you own '+have+', your guide suggests '+p.target+' ('+p.many+').');
      else good.push('Fills a gap: you own '+have+' of the '+p.target+' your guide suggests ('+p.many+').');
      var fits=outfitsWith(k.piece,prefs);
      if(fits.length>=2)good.push('Supports '+fits.length+' outfit formulas with recorded pieces: '+fits.slice(0,2).map(function(o){return o.name;}).join(', ')+'.');
      else pending.push('Only '+fits.length+' outfit formula'+(fits.length===1?' is':'s are')+' supported; the guide requires at least two.');
    }else if(!flags.length)return {kind:'none',label:'',piece:k.piece,reasons:[]};
    // Without a wardrobe a card only gets a verdict for a real flag; the guide
    // itself asks once for the wardrobe instead of every card repeating it.
    var size=root.ShoppingCore.sizeMatch(item,prefs),priceUnknown=!!item.priceFrom;
    if(size!=='match')pending.unshift('Your size needs verification.');
    if(priceUnknown)pending.unshift('The “From” price is not confirmed for your size.');
    if(size==='unavailable')flags.push('Your selected size is not listed as available.');
    var kind=flags.length?'check':pending.length?'promising':'wear';
    var label=kind==='wear'?'Worth it':kind==='check'?'Check first':size!=='match' && priceUnknown?'Promising — check size and price':size!=='match'?'Promising — check size':priceUnknown?'Promising — check price':'Promising — check details';
    return {kind:kind,label:label,piece:k.piece,reasons:(flags.length?flags.concat(pending,good):pending.concat(good)).slice(0,3)};
  }
  root.ShoppingStyle={PIECES:PIECES,OUTFITS:OUTFITS,RULES:RULES,cleanWardrobe:cleanWardrobe,cleanPurchases:cleanPurchases,bought:bought,undoBought:undoBought,classify:classify,outfitsWith:outfitsWith,wearable:wearable,verdict:verdict};
})(typeof globalThis!=='undefined'?globalThis:this);
