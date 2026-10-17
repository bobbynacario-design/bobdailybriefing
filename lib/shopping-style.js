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
    'It makes at least two outfits with what you already own.',
    'It is in your colours, so it pairs with the rest without thinking.',
    'It fills a gap in your wardrobe rather than adding a fourth of the same.',
    'It suits Manila (cotton, linen, quick-dry), or a trip or event you actually have coming.'
  ];
  var byId={};PIECES.forEach(function(p){byId[p.id]=p;});
  function cleanWardrobe(raw){var out={};PIECES.forEach(function(p){var n=Number((raw || {})[p.id]);if(Number.isInteger(n) && n>0 && n<=20)out[p.id]=n;});return out;}
  function owned(prefs,id){return (prefs.wardrobe || {})[id] || 0;}
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
      if(/\b(t-?shirt|tee|tank)\b/i.test(n) || /\bUT\b/.test(n))return {piece:light(item)?'tee-light':'tee-dark'};
      if(/\b(corduroy|flannel|overshirt|shirt jacket)\b/i.test(n))return {piece:'jacket'};
      if(/\b(sweaters?|knit|cardigan|sweatshirt|crewneck)\b/i.test(n))return {piece:'knit'};
      if(/\b(resort|camp|short-sleeved?|hawaiian)\b/i.test(n))return {piece:'resort'};
      if(/\bshirt\b/i.test(n))return {piece:'shirt'};
    }
    return {};
  }
  // H&M names a print after the slash in its colour, capitalised ("Cream/
  // OutKast"), and a pattern in lower case ("Brown/plaid"). Nike capitalises
  // every colourway part, so this reads H&M only.
  function printName(item){return item.brand==='H&M' && /\/\s*[A-Z]/.test(String(item.color || ''));}
  function outfitsWith(piece,prefs){
    return OUTFITS.filter(function(o){var slot=o.slots.findIndex(function(s){return s.includes(piece);});if(slot<0)return false;return o.slots.every(function(s,i){return i===slot || s.some(function(id){return owned(prefs,id)>0;});});});
  }
  function wearable(o,prefs){return o.slots.every(function(s){return s.some(function(id){return owned(prefs,id)>0;});});}
  function verdict(item,prefs){
    var T=root.ShoppingTaste,k=classify(item),flags=[],good=[],hasWardrobe=Object.keys(prefs.wardrobe || {}).length>0;
    if(k.skip)return {kind:'skip',label:'Likely to sit unworn',reasons:[k.skip]};
    var n=String(item.name || '')+' '+String(item.color || '');
    if(/\b(wool|wool-blend|fleece|down jacket|down-filled|puffer|padded|quilted|thermal|sherpa|corduroy)\b/i.test(n))flags.push('Warm fabric for Manila: worth it for casino air-con, cold trips or evening events.');
    if(k.formal)flags.push(k.formal+' Buy it only for an event you have coming.');
    var colors=(prefs.taste && prefs.taste.colors) || [],main=T?T.features(item).colors[0]:null;
    // Cream reads as off-white: it sits inside a palette that has white or beige.
    var inPalette=colors.includes(main) || main==='Cream' && (colors.includes('White') || colors.includes('Beige'));
    if(main && colors.length && colors.length<T.OPTIONS.colors.length && !inPalette)flags.push(main+' is outside your colours, so it pairs with less.');
    var patterns=(prefs.taste && prefs.taste.patterns) || [];
    if(patterns.length===1 && patterns[0]==='Plain' && (/\b(striped|stripes|plaid|checked|floral|camo|printed|graphic|tie-dye)\b/i.test(n) || /\bUT\b/.test(n) || printName(item)))flags.push('Patterned, and your guide keeps to plain.');
    if(!k.piece){if(hasWardrobe)flags.push('Not one of the core pieces in your guide.');return flags.length?{kind:'check',label:'Check first',reasons:flags.slice(0,3)}:{kind:'none',label:'',reasons:[]};}
    var p=byId[k.piece],have=owned(prefs,k.piece);
    if(hasWardrobe){
      if(have>=p.target)flags.push('Already covered: you own '+have+', your guide suggests '+p.target+' ('+p.many+').');
      else good.push('Fills a gap: you own '+have+' of the '+p.target+' your guide suggests ('+p.many+').');
      var fits=outfitsWith(k.piece,prefs);
      if(fits.length)good.push('Makes '+fits.length+' outfit'+(fits.length===1?'':'s')+' with what you own: '+fits.slice(0,2).map(function(o){return o.name;}).join(', ')+'.');
      else flags.push('No outfit in your guide uses it with what you own yet.');
    }else if(!flags.length)return {kind:'none',label:'',piece:k.piece,reasons:[]};
    // Without a wardrobe a card only gets a verdict for a real flag; the guide
    // itself asks once for the wardrobe instead of every card repeating it.
    var kind=flags.length?'check':'wear';
    return {kind:kind,label:kind==='wear'?'Worth it':'Check first',piece:k.piece,reasons:(kind==='wear'?good:flags.concat(good)).slice(0,3)};
  }
  root.ShoppingStyle={PIECES:PIECES,OUTFITS:OUTFITS,RULES:RULES,cleanWardrobe:cleanWardrobe,classify:classify,outfitsWith:outfitsWith,wearable:wearable,verdict:verdict};
})(typeof globalThis!=='undefined'?globalThis:this);
