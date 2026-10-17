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
    {id:'sandals',label:'Sandals, slides or clogs',many:'sandals',slot:'shoes',target:1},
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
  var COLORS=['White','Cream','Beige','Black','Grey','Navy','Blue','Brown','Burgundy','Green','Red'];
  function cleanWardrobeColors(raw){var out={};PIECES.forEach(function(p){var v=(raw || {})[p.id],values=Array.isArray(v)?v:typeof v==='string'?v.split(','):[];var colors=COLORS.filter(function(c){return values.some(function(x){return typeof x==='string' && x.trim().toLowerCase()===c.toLowerCase();});});if(colors.length)out[p.id]=colors;});return out;}
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
      // The guide's piece is "short-sleeve camp or resort shirt": H&M's
      // "Short-Sleeved Shirt" is that Manila shirt, not one of his long-sleeve
      // oxford or linen button shirts.
      if(/\b(resort|camp|short-sleeved?|hawaiian)\b/i.test(n))return {piece:'resort'};
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
    var T=root.ShoppingTaste,k=classify(item),flags=[],good=[],pending=[],tripNote=[],hasWardrobe=Object.keys(prefs.wardrobe || {}).length>0;
    if((prefs.purchases || []).some(function(p){return p.id===item.id;}))return {kind:'owned',label:'Already bought',piece:k.piece,reasons:['Recorded in your purchases. Check your wardrobe before buying another.']};
    if(k.skip)return {kind:'skip',label:'Likely to sit unworn',reasons:[k.skip]};
    var n=String(item.name || '')+' '+String(item.color || ''),TR=root.ShoppingTrips,trip=TR && k.piece?TR.gapFor(k.piece,prefs):null;
    // A packing gap establishes quantity, not the suitability of this fabric.
    if(/\b(wool|wool-blend|fleece|down jacket|down-filled|puffer|padded|quilted|thermal|sherpa|corduroy)\b/i.test(n)){
      if(trip)pending.push('Warm fabric: check its weight and comfort for '+trip.trip.cities.join(', ')+' ('+TR.temps(trip.trip)+'); a packing gap does not confirm fabric suitability.');
      else{
      var cools=TR?TR.coolTrips(prefs):[],layers=cools.map(function(t){return t.needs.find(function(x){return x.key==='layer';});});
      flags.push(cools.length && layers.every(function(l){return l && l.short===0;})?'Warm fabric: your '+(cools.length===1?cools[0].name+' ('+cools[0].dates+', '+TR.temps(cools[0])+') is':'coming trips ('+cools.map(function(t){return t.cities.join(' or ')+' '+t.dates;}).join('; ')+') are')+' covered by the '+layers[0].own+' warm layers you own.':'Warm fabric for Manila: worth it for casino air-con, cold trips or evening events.');
      }
    }
    if(k.formal)flags.push(k.formal+' Buy it only for an event you have coming.');
    var comparison=T.compare(item,prefs);
    flags.push.apply(flags,comparison.conflicts.map(function(c){return c.text;}));
    flags.push.apply(flags,T.assess(item,prefs).cautions.filter(function(c){return /^Shares /.test(c);}));
    if((prefs.feedback || []).some(function(f){return f.id===item.id && f.vote==='pass';}))flags.push('You marked this item Not for me.');
    var uncertain=comparison.unknown.filter(function(x){return ['fits','colors','patterns'].includes(x);});
    if(uncertain.length)pending.push('Check '+uncertain.map(function(x){return {fits:'fit',colors:'colour',patterns:'pattern'}[x];}).join(', ')+': the listing does not establish your preferred traits.');
    if(!k.piece){if(hasWardrobe)pending.push('Confirm its wardrobe category; no wardrobe gap is assumed.');return flags.length?{kind:'check',label:'Check first',reasons:flags.slice(0,3)}:pending.length?{kind:'promising',label:'Check wardrobe category',reasons:pending}:{kind:'none',label:'',reasons:[]};}
    var p=byId[k.piece],have=owned(prefs,k.piece);
    if(hasWardrobe){
      if(have===null)pending.push('Your '+p.many+' count is not recorded; a gap is not assumed.');
      else if(have>=p.target)flags.push('Already covered: you own '+have+', your guide suggests '+p.target+' ('+p.many+').');
      else good.push('Fills a gap: you own '+have+' of the '+p.target+' your guide suggests ('+p.many+').');
      var fits=outfitsWith(k.piece,prefs);
      if(fits.length>=2)good.push('Supports '+fits.length+' outfit formulas with recorded pieces: '+fits.slice(0,2).map(function(o){return o.name;}).join(', ')+'.');
      else pending.push('Only '+fits.length+' outfit formula'+(fits.length===1?' is':'s are')+' supported; the guide requires at least two.');
    }else if(!flags.length && !trip)return {kind:'none',label:'',piece:k.piece,reasons:[]};
    if(trip){
      var t=trip.trip,need=trip.need;
      if(t.late)pending.push('Useful for your '+t.name+' ('+t.dates+'), but an order now may not arrive before you leave.');
      else{
        tripNote.push('For your '+t.name+' ('+t.dates+', '+TR.temps(t)+'): you have '+need.own+' of the '+need.need+' '+need.label+' it needs. Order by '+TR.dayLabel(t.orderBy)+'.');
        // The trip needs more than he owns, so this is not a duplicate.
        flags=flags.filter(function(f){return !/^Already covered/.test(f);});
      }
    }
    // Without a wardrobe a card only gets a verdict for a real flag; the guide
    // itself asks once for the wardrobe instead of every card repeating it.
    var size=root.ShoppingCore.sizeMatch(item,prefs),priceUnknown=!!item.priceFrom;
    if(size!=='match')pending.unshift('Your size needs verification.');
    if(priceUnknown)pending.unshift('The “From” price is not confirmed for your size.');
    if(size==='unavailable')flags.push('Your selected size is not listed as available.');
    var kind=flags.length?'check':pending.length?'promising':'wear';
    var label=kind==='wear'?'Worth it':kind==='check'?'Check first':size!=='match' && priceUnknown?'Promising — check size and price':size!=='match'?'Promising — check size':priceUnknown?'Promising — check price':uncertain.length?'Potential match — check '+uncertain.map(function(x){return {fits:'fit',colors:'colour',patterns:'pattern'}[x];}).join(', '):'Promising — check details';
    // The trip reason stays visible next to any flag: it is why the deal matters now.
    return {kind:kind,label:label,piece:k.piece,reasons:(flags.length?flags.slice(0,tripNote.length?2:3).concat(tripNote,pending,good):tripNote.concat(pending,good)).slice(0,3)};
  }
  // What to wear it with. Colour partners follow plain menswear rules for the
  // item's main colour, kept to his palette; the pieces come from the outfit
  // formulas that use it. Optional recorded wardrobe colours support specific
  // pairings; otherwise colour suggestions are explicitly left to check.
  var PARTNERS={
    White:{bottoms:['navy','grey','black','beige','blue'],tops:['navy','blue','black','grey'],shoes:['white','brown','black']},
    Cream:{bottoms:['navy','brown','grey','blue'],tops:['navy','brown','blue'],shoes:['white','brown']},
    Beige:{bottoms:['navy','brown','white','blue','black'],tops:['white','navy','blue','black','brown','burgundy'],shoes:['white','brown']},
    Black:{bottoms:['grey','beige','blue','black'],tops:['white','grey','beige','blue'],shoes:['white','black']},
    Grey:{bottoms:['navy','black','blue','beige'],tops:['white','black','navy','burgundy','blue'],shoes:['white','black']},
    Navy:{bottoms:['beige','grey','white','blue'],tops:['white','blue','grey','beige','burgundy'],shoes:['white','brown']},
    Blue:{bottoms:['beige','navy','grey','white'],tops:['white','navy','grey','black','beige'],shoes:['white','brown']},
    Brown:{bottoms:['beige','navy','blue','cream'],tops:['white','cream','navy','blue','beige'],shoes:['white','brown']},
    Burgundy:{bottoms:['navy','grey','beige','blue'],tops:['white','grey','navy'],shoes:['white','brown','black']},
    Green:{bottoms:['beige','navy','white','blue'],tops:['white','beige','navy'],shoes:['white','brown']},
    Red:{bottoms:['navy','blue','grey','white'],tops:['white','navy','grey'],shoes:['white','black']}
  };
  var SLOT_OF={top:'tops',layer:'layers',bottom:'bottoms',shoes:'shoes',active:'active'};
  function words(list,last){return list.length<2?list.join(''):list.slice(0,-1).join(', ')+' '+(last || 'or')+' '+list[list.length-1];}
  function pairWith(item,prefs){
    var k=classify(item);if(!k.piece || k.skip)return null;
    var p=byId[k.piece],main=root.ShoppingTaste?root.ShoppingTaste.features(item).colors[0]:null,partners=main && PARTNERS[main];
    // Black tie has one answer, whatever the palette.
    if(k.formal)partners={tops:['white'],bottoms:['black'],shoes:['black']};
    var palette=((prefs.taste && prefs.taste.colors) || []).map(function(c){return c.toLowerCase();}),all=root.ShoppingTaste && palette.length===root.ShoppingTaste.OPTIONS.colors.length;
    var tone=function(list,slot){var keep=palette.length && !all?list.filter(function(c){return palette.includes(c) || c==='white' && slot==='shoes';}):list;keep=(keep.length?keep:list).slice(0,4);return keep.map(function(c){return c==='blue' && slot==='bottoms'?'blue-denim':c;});};
    // Partner pieces by slot, from every formula that uses this piece.
    var bySlot={};OUTFITS.forEach(function(o){var at=o.slots.findIndex(function(s){return s.includes(k.piece);});if(at<0)return;o.slots.forEach(function(s,i){if(i===at)return;s.forEach(function(id){var slot=SLOT_OF[byId[id].slot];(bySlot[slot]=bySlot[slot] || []).includes(id) || bySlot[slot].push(id);});});});
    var have=function(ids){return ids.filter(function(id){return ((prefs.wardrobe || {})[id] || 0)>0;}).map(function(id){return byId[id].many;});};
    var want=p.slot==='bottom'?['tops','shoes']:p.slot==='shoes'?['bottoms']:p.slot==='layer'?['tops','bottoms']:p.slot==='active'?['active','shoes']:['bottoms','shoes'];
    var recorded=cleanWardrobeColors(prefs.wardrobeColors);
    var parts=want.filter(function(slot){return bySlot[slot];}).map(function(slot){
      var noun={tops:p.slot==='layer'?'tops underneath':'tops',bottoms:'bottoms',shoes:'shoes',active:'gym kit'}[slot],colors=partners && slot!=='active'?tone(partners[slot==='layers'?'tops':slot] || [],slot):[],own=have(bySlot[slot]);
      var actual=bySlot[slot].filter(function(id){return owned(prefs,id)>0;}).flatMap(function(id){return (recorded[id] || []).filter(function(c){return partners && (partners[slot] || []).includes(c.toLowerCase());}).map(function(c){return c.toLowerCase()+' '+byId[id].many;});});
      if(actual.length)return 'your '+words(actual.slice(0,4));
      if(!colors.length)return own.length?'your '+words(own):'';
      return words(colors)+' '+noun+(own.length?' (you have '+words(own)+'; check their colours)':' (none recorded yet)');
    }).filter(Boolean);
    var n=String(item.name || '')+' '+String(item.color || ''),tip='';
    if(/\b(striped|stripes|plaid|checked|floral|camo|printed|graphic|jacquard)\b/i.test(n) || /\bUT\b/.test(n))tip='It carries the pattern, so keep the rest plain.';
    else if(/\b(oversized|loose|boxy)\b/i.test(n) && (p.slot==='top' || p.slot==='layer'))tip='Roomy cut: keep the trousers regular or slim so the outline stays clean.';
    else if(/\bslim\b/i.test(n) && p.slot==='bottom')tip='Slim trousers: a regular or relaxed top balances them.';
    else if(k.formal)tip='Black tie: white shirt, black trousers, black shoes.';
    else if(k.piece==='blazer')tip='Dress it down with a plain tee and clean sneakers, or up with a shirt and smart shoes.';
    return parts.length?{text:parts.join(' · '),tip:tip,main:main || ''}:null;
  }
  root.ShoppingStyle={PIECES:PIECES,COLORS:COLORS,OUTFITS:OUTFITS,RULES:RULES,pairWith:pairWith,cleanWardrobeColors:cleanWardrobeColors,cleanWardrobe:cleanWardrobe,cleanPurchases:cleanPurchases,bought:bought,undoBought:undoBought,classify:classify,outfitsWith:outfitsWith,wearable:wearable,verdict:verdict};
})(typeof globalThis!=='undefined'?globalThis:this);
