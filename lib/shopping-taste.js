(function(root){
  'use strict';
  var OPTIONS={fits:['Slim','Regular','Relaxed','Oversized','Boxy'],colors:['Black','White','Grey','Navy','Blue','Beige','Cream','Brown','Green','Red','Burgundy'],patterns:['Plain','Striped','Printed / graphic'],materials:['Cotton','Linen','Quick-dry'],occasions:['Work','Casual','Active']};
  var CATEGORIES=['Tops','Trousers','Shorts','Footwear','Outerwear'],REASONS=['fit','color','design','price','material','occasion','other'];
  function clean(raw){raw=raw || {};var out={budgets:{}};Object.keys(OPTIONS).forEach(function(k){out[k]=OPTIONS[k].filter(function(v){return Array.isArray(raw[k]) && raw[k].includes(v);});});CATEGORIES.forEach(function(k){var n=Number((raw.budgets || {})[k]);out.budgets[k]=Number.isFinite(n) && n>0 && n<=100000?n:null;});return out;}
  // Main colour only: the first part of a colourway ("White/Midnight Navy/...")
  // or, with no colour field, the first colour the name mentions. Matching any
  // colour named let a multi-colour shoe fit almost every palette.
  function mainColor(item){
    var source=item.color?String(item.color).split('/')[0]:String(item.name || ''),best=null,at=Infinity;
    OPTIONS.colors.forEach(function(c){var m=new RegExp('\\b'+(c==='Grey'?'(?:grey|gray)':c)+'\\b','i').exec(source);if(m && m.index<at){at=m.index;best=c;}});
    return best?[best]:[];
  }
  function features(item){
    var text=String(item.name || ''),color=String(item.color || ''),both=text+' '+color,out={fits:[],colors:[],patterns:[],materials:[],occasions:[]};
    OPTIONS.fits.forEach(function(f){if(new RegExp('\\b'+f+'(?:[- ]fit)?\\b','i').test(text))out.fits.push(f);});
    out.colors=mainColor(item);
    if(/\bplain\b|\bsolid[- ]colou?red\b/i.test(text))out.patterns.push('Plain');
    if(/\bstriped\b|\bstripes\b/i.test(both))out.patterns.push('Striped');
    if(/\bprinted\b|\bgraphic\b|\blogo\b/i.test(text))out.patterns.push('Printed / graphic');
    if(/\bcotton\b/i.test(text))out.materials.push('Cotton');if(/\blinen\b/i.test(text))out.materials.push('Linen');
    if(/\bquick[- ]dry\b|\bdry-ex\b|\bdri-fit\b|\baeroready\b/i.test(text))out.materials.push('Quick-dry');
    // Occasion suggestions are deliberately narrow garment-type mappings.
    if(/\bbroadcloth\b|\boxford\b|\bblazer\b|\bdress shirt\b|\bsuit\b/i.test(text))out.occasions.push('Work');
    if(/\brunning\b|\btraining\b|\bgolf\b|\bsports?\b|\bworkout\b/i.test(text))out.occasions.push('Active');
    if(/\bt-shirt\b|\btee\b|\bhoodie\b|\bclog\b|\bclogs\b|\bsweatshirt\b/i.test(text))out.occasions.push('Casual');
    return out;
  }
  function cleanFeatures(raw){var out={};Object.keys(OPTIONS).forEach(function(k){out[k]=OPTIONS[k].filter(function(v){return Array.isArray((raw || {})[k]) && raw[k].includes(v);});});return out;}
  function cleanFeedback(rows){var seen=new Set();return (Array.isArray(rows)?rows:[]).slice(-100).reverse().filter(function(r){if(!r || !/^[a-z0-9-]{1,90}$/i.test(r.id || '') || !['like','pass'].includes(r.vote) || seen.has(r.id))return false;seen.add(r.id);return true;}).reverse().map(function(r){return {id:r.id,name:String(r.name || '').slice(0,140),vote:r.vote,reason:REASONS.includes(r.reason)?r.reason:'other',features:cleanFeatures(r.features),at:Number.isFinite(Date.parse(r.at))?r.at:''};});}
  function feedbackFor(item,vote,reason,at){return {id:item.id,name:item.name,vote:vote,reason:reason || 'other',features:features(item),at:at || new Date().toISOString()};}
  function assess(item,prefs,need){
    var taste=clean(prefs.taste),f=features(item),feedback=cleanFeedback(prefs.feedback),exact=feedback.find(function(r){return r.id===item.id;}),score=0,reasons=[],cautions=[],matched=0,learned=0;
    // Ticking every option in a group states no preference, so it scores nothing.
    Object.keys(OPTIONS).forEach(function(k){if(taste[k].length===OPTIONS[k].length)taste[k]=[];});
    var labels={fits:'Fit named in the listing',colors:'Listed colour',patterns:'Design named in the listing',materials:'Material or technology named',occasions:'Garment type for your preferred use'},weights={fits:18,colors:14,patterns:14,materials:12,occasions:10};
    Object.keys(OPTIONS).forEach(function(k){if(!taste[k].length)return;var hits=f[k].filter(function(v){return taste[k].includes(v);});if(hits.length){score+=weights[k];matched++;reasons.push(labels[k]+': '+hits.join(', ')+'.');}else if(f[k].length && ['fits','colors','patterns'].includes(k)){score-=weights[k];cautions.push('Listed '+f[k].join(', ')+' differs from your '+(k==='fits'?'fit':k==='colors'?'colour':'design')+' choices.');}});
    if(exact){score+=exact.vote==='like'?50:-60;reasons.unshift(exact.vote==='like'?'You marked this item My style.':'You marked this item Not for me'+(exact.reason!=='other'?' ('+exact.reason+')':'')+'.');}
    var reasonDims={fit:'fits',color:'colors',design:'patterns',material:'materials',occasion:'occasions'};
    // Cross-item feedback needs two independent examples and a known shared
    // trait. Price and generic passes never become invented style preferences.
    Object.keys(OPTIONS).forEach(function(k){f[k].forEach(function(trait){var likes=0,passes=0;feedback.forEach(function(r){if(r.id===item.id || !(r.features[k] || []).includes(trait))return;var relevant=r.reason==='other'?r.vote==='like':reasonDims[r.reason]===k;if(relevant){if(r.vote==='like')likes++;else passes++;}});if(likes>=2){score+=4;learned++;if(reasons.length<3)reasons.push('Shares '+trait+' with '+likes+' items you marked My style.');}if(passes>=2){score-=6;cautions.push('Shares '+trait+' with items you passed on for '+k+'.');}});});
    if(prefs.saved.includes(item.id)){score+=2;if(reasons.length<2)reasons.push('You saved this deal.');}
    if(need && need.category!=='All' && need.category===item.category){score+=12;reasons.push('Matches the '+need.category.toLowerCase()+' category on your selected shopping need.');}
    var budget=taste.budgets[item.category];if(need && need.budget)budget=budget?Math.min(budget,need.budget):need.budget;
    if(budget && !item.priceFrom && item.price<=budget)reasons.push('₱'+Number(item.price).toLocaleString('en-PH')+' is within your ₱'+budget.toLocaleString('en-PH')+' item limit.');
    if(!reasons.length)reasons.push('You follow '+item.brand+'. No personal style match has been established yet.');
    if(!matched && !learned && !exact && Object.keys(OPTIONS).some(function(k){return taste[k].length;}))cautions.push('The listing does not establish a match to your taste choices.');
    if(Object.keys(OPTIONS).some(function(k){return taste[k].length && !f[k].length;}))cautions.push('Some preferred traits are not stated; missing details are not treated as matches.');
    return {score:Math.max(-100,Math.min(100,score)),reasons:reasons.slice(0,3),cautions:cautions.slice(0,2),label:exact?exact.vote==='like'?'You like this':'Passed item':matched?'Matches stated preferences':learned?'Similar to your feedback':'Brand match only'};
  }
  root.ShoppingTaste={OPTIONS:OPTIONS,CATEGORIES:CATEGORIES,REASONS:REASONS,clean:clean,cleanFeedback:cleanFeedback,features:features,feedbackFor:feedbackFor,assess:assess};
})(typeof globalThis!=='undefined'?globalThis:this);
