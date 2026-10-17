(function(root){
  'use strict';
  var BRANDS=['UNIQLO','H&M','ZALORA','Nike','Adidas','Crocs'];
  var AREAS=['Quezon City','Ortigas','Makati','Pasay'];
  var CATEGORIES=['All','Tops','Trousers','Shorts','Footwear','Outerwear'];
  var JACKETS=[42,44,46,48,50,52,54,56,58,60];
  var HOSTS=['www.uniqlo.com','www2.hm.com','www.zalora.com.ph','www.nike.com','www.adidas.com.ph','crocs.com.ph','www.smsupermalls.com','www.ayalamalls.com'];
  function safeUrl(value){try{var u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && !u.port && HOSTS.includes(u.hostname)?u.href:'';}catch(e){return '';}}
  function imageUrl(value){try{var u=new URL(value);return u.protocol==='https:' && ['image.hm.com','images.hm.com','cdn.shopify.com','static.nike.com','image.uniqlo.com','assets.adidas.com','dynamic.zacdn.com','static-ph.zacdn.com'].includes(u.hostname) && !u.username && !u.password && !u.port?u.href:'';}catch(e){return '';}}
  function cleanPrefs(raw){raw=raw || {};return Object.assign({brands:BRANDS.filter(function(b){return !Array.isArray(raw.brands)||raw.brands.includes(b);}),areas:AREAS.filter(function(a){return !Array.isArray(raw.areas)||raw.areas.includes(a);}),clothingSize:['S','M','L','XL'].includes(raw.clothingSize)?raw.clothingSize:'M',americanSize:['S','M','L','XL'].includes(raw.americanSize)?raw.americanSize:'S',shoeSize:Number(raw.shoeSize)>=4 && Number(raw.shoeSize)<=16?Number(raw.shoeSize):8.5,waistSize:Number.isInteger(Number(raw.waistSize)) && Number(raw.waistSize)>=24 && Number(raw.waistSize)<=44?Number(raw.waistSize):null,jacketSize:JACKETS.includes(Number(raw.jacketSize))?Number(raw.jacketSize):null,needs:(Array.isArray(raw.needs)?raw.needs:[]).slice(0,10).map(function(n){return {id:String(n.id || '').replace(/[^a-z0-9-]/gi,'').slice(0,40),text:String(n.text || '').trim().slice(0,120),category:CATEGORIES.includes(n.category)?n.category:'All',budget:Number(n.budget)>0 && Number(n.budget)<=100000?Number(n.budget):null};}).filter(function(n){return n.id && n.text;}),saved:(Array.isArray(raw.saved)?raw.saved:[]).filter(function(s){return /^[a-z0-9-]{1,90}$/i.test(s);}).slice(0,150)},{taste:root.ShoppingTaste.clean(raw.taste),feedback:root.ShoppingTaste.cleanFeedback(raw.feedback),wardrobe:root.ShoppingStyle.cleanWardrobe(raw.wardrobe)});}
  // Numeric labels: waist inches on trousers and shorts (H&M "28"-"36"; "30L"
  // is a long leg), EU tailoring on jackets ("42"-"56"). Any other numbers
  // (EU trouser sizes, collar sizes) are not guessed at and stay unchecked.
  function numericSystem(item){
    var nums=(item.availableSizes || []).map(function(s){var m=/^(\d{2})[A-Z]{0,2}$/.exec(String(s).trim().toUpperCase());return m?Number(m[1]):NaN;});
    if(!nums.length || nums.some(isNaN))return null;
    if((item.category==='Trousers' || item.category==='Shorts') && nums.every(function(n){return n>=24 && n<=44;}))return {kind:'waist',sizes:nums};
    if(item.category==='Outerwear' && nums.every(function(n){return n>=40 && n<=64;}))return {kind:'jacket',sizes:nums};
    return null;
  }
  function sizeLabel(item,prefs){
    if(item.category==='Footwear')return 'US men '+prefs.shoeSize;
    var num=numericSystem(item);
    if(num)return num.kind==='waist'?(prefs.waistSize?'waist '+prefs.waistSize:'add your waist size'):(prefs.jacketSize?'EU '+prefs.jacketSize:'add your jacket size');
    return item.sizeSystem==='US clothing'?prefs.americanSize:prefs.clothingSize;
  }
  // What the scout's own price memory says about this listing (earlier days,
  // up to 30). A sale price that has not moved in weeks is the usual price;
  // one that was lower before says wait.
  function priceMemory(i){
    var day=function(t){var d=Date.parse(t);return Number.isFinite(d)?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',day:'numeric',month:'short'}).format(new Date(d)):'an earlier check';},peso=function(v){return '₱'+Number(v).toLocaleString('en-PH',{maximumFractionDigits:2});};
    if(!(i.priorLow>0))return {kind:'new',text:'First seen '+day(i.firstSeen || i.checkedAt)+'.'};
    var since=day(i.firstSeen || i.previousChecked);
    if(i.price<i.priorLow)return {kind:'low',text:'Lowest price seen since '+since+(i.previousPrice>i.price?', down from '+peso(i.previousPrice):'')+'.'};
    if(i.price>i.priorLow)return {kind:'higher',text:'Was '+peso(i.priorLow)+' on '+day(i.priorLowAt || i.previousChecked)+'; cheaper before.'};
    if(i.priorHigh>i.price)return {kind:'matched',text:'Back to its lowest seen since '+since+'.'};
    return {kind:'same',text:'Same price at every check since '+since+'.'};
  }
  function wholeSizesOnly(item){return Array.isArray(item.sizeRun) && item.sizeRun.length>0 && !item.sizeRun.some(function(s){return Number(s)%1;});}
  function sizeMatch(item,prefs){
    var sizes=item.availableSizes;
    if(!Array.isArray(sizes))return 'unknown';
    if(item.category==='Footwear'){
      // A men's US size is explicit; never infer it from EU, UK, women's,
      // unlabelled sizes, or round an 8.5 to a Crocs 8 or 9.
      if(item.sizeSystem!=='US men')return 'unknown';
      if(sizes.some(function(s){return Number(s)===prefs.shoeSize;}))return 'match';
      // A range made in whole sizes only (slides, Crocs) has no 8.5 to sell
      // out: that is a fit question for the brand's guide, not missing stock.
      if(prefs.shoeSize%1 && wholeSizesOnly(item))return 'unknown';
      return 'unavailable';
    }
    if(item.sizeSystem!=='Labelled clothing' && item.sizeSystem!=='US clothing')return 'unknown';
    var wanted=item.sizeSystem==='US clothing'?prefs.americanSize:prefs.clothingSize;
    var labels=sizes.map(function(s){return String(s).trim().toUpperCase();});
    if(labels.includes(wanted))return 'match';
    var num=numericSystem(item),mine=num && (num.kind==='waist'?prefs.waistSize:prefs.jacketSize);
    if(num)return mine?(num.sizes.includes(mine)?'match':'unavailable'):'unknown';
    // Numeric jacket/waist sizes and mixed systems need the retailer's size
    // chart. They cannot prove that this person's letter size is unavailable.
    return labels.every(function(s){return /^(?:XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL)$/.test(s);})?'unavailable':'unknown';
  }
  // A price read off a page goes stale after four days. A published dated
  // offer (UNIQLO's "Limited Offer from 16 Oct - 22 Oct") holds until its own
  // end date, so a pasted import lasts as long as the offer, at most 35 days.
  function fresh(i,now){
    var at=Date.parse(i.checkedAt);if(!Number.isFinite(at) || at>now+300000)return false;
    if(/^\d{4}-\d{2}-\d{2}$/.test(i.validTo || ''))return i.validTo>=new Date(now+8*3600000).toISOString().slice(0,10) && now-at<=35*86400000;
    return now-at<=4*86400000;
  }
  function brandMatch(item,brand){return !brand || (brand==='ZALORA'?(item.retailer==='ZALORA' || item.brand==='ZALORA'):item.brand===brand);}
  function matchItems(feed,prefs,filters,now){
    prefs=cleanPrefs(prefs);filters=filters || {};now=now || Date.now();
    var need=prefs.needs.find(function(n){return n.id===filters.need;}),ranks=new Map();
    function rank(i){if(!ranks.has(i.id))ranks.set(i.id,rankValue(i,prefs,need));return ranks.get(i.id);}
    // Not for me, and gear your style guide says will sit unworn, go last.
    var verdicts=new Map();
    function style(i){if(!verdicts.has(i.id))verdicts.set(i.id,root.ShoppingStyle.verdict(i,prefs).kind);return verdicts.get(i.id);}
    function passed(i){return style(i)==='skip' || prefs.feedback.some(function(r){return r.id===i.id && r.vote==='pass';});}
    return ((feed || {}).items || []).filter(function(i){
      if(i.retailer==='ZALORA' && !prefs.brands.includes('ZALORA'))return false;
      if(!safeUrl(i.url) || !prefs.brands.includes(i.brand) || !Number.isFinite(i.price) || !(i.price>0) || !(i.originalPrice>i.price))return false;
      if(!fresh(i,now))return false;
      if(i.channel==='store' && (!prefs.areas.includes(i.area) || !i.branch || !i.validTo || i.validTo<new Date(now+8*3600000).toISOString().slice(0,10)))return false;
      var today=new Date(now+8*3600000).toISOString().slice(0,10);if(i.validTo && i.validTo<today || i.validFrom && i.validFrom>today)return false;
      if(!brandMatch(i,filters.brand) || filters.category && filters.category!=='All' && i.category!==filters.category)return false;
      if(need && (need.category!=='All' && i.category!==need.category || need.budget && (i.price>need.budget || i.priceFrom)))return false;
      var ceiling=prefs.taste.budgets[i.category];if(ceiling && (i.priceFrom || i.price>ceiling))return false;
      if(filters.saved && !prefs.saved.includes(i.id))return false;
      if(filters.wear && style(i)!=='wear')return false;
      var size=sizeMatch(i,prefs);return size!=='unavailable' && (!filters.confirmed || size==='match');
    // Three tiers: your style guide's Worth it first, then everything else,
    // then Not for me and Likely to sit unworn. rankValue orders each tier.
    }).sort(function(a,b){return (passed(a)?1:0)-(passed(b)?1:0) || (style(b)==='wear'?1:0)-(style(a)==='wear'?1:0) || rank(b)-rank(a) || a.price-b.price;});
  }
  // A deal ranks by its discount in points (40% off = 40). Your size listed
  // adds 15, a price fall since the last check adds 5, and a price that was
  // lower on an earlier check takes 5 off. Taste nudges by at most 20 either
  // way: it reorders deals of similar depth but cannot bury a much deeper
  // markdown. The Worth it tier comes before this (matchItems).
  function rankValue(i,prefs,need){
    var taste=root.ShoppingTaste.assess(i,prefs,need).score;
    return Math.round((1-i.price/i.originalPrice)*100)+(sizeMatch(i,prefs)==='match'?15:0)+(i.previousPrice>i.price?5:0)-(i.priorLow>0 && i.price>i.priorLow?5:0)+Math.max(-20,Math.min(20,taste));
  }
  root.ShoppingCore={BRANDS:BRANDS,AREAS:AREAS,CATEGORIES:CATEGORIES,safeUrl:safeUrl,imageUrl:imageUrl,cleanPrefs:cleanPrefs,sizeMatch:sizeMatch,wholeSizesOnly:wholeSizesOnly,sizeLabel:sizeLabel,priceMemory:priceMemory,JACKETS:JACKETS,fresh:fresh,brandMatch:brandMatch,matchItems:matchItems,rankValue:rankValue};
  if(typeof module!=='undefined' && module.exports)module.exports=root.ShoppingCore;
})(typeof globalThis!=='undefined'?globalThis:this);
