(function(root){
  'use strict';
  var BRANDS=['UNIQLO','H&M','ZALORA','Nike','Adidas','Crocs',"Levi's",'Under Armour','Penshoppe','Sperry','Columbia','Hush Puppies',"Toby's",'Giordano','Memo','Regatta','Timberland','Skechers','Puma','Sports Central'];
  // Stores that list other brands' stock: an item needs both its brand and the store ticked.
  var RETAILERS=['ZALORA',"Toby's",'Sports Central'];
  // The brands a profile saved before brandsSeen existed had ticked from. A
  // brand added later starts ticked, until a save shows it unticked.
  var FIRST_BRANDS=BRANDS.slice(0,6);
  var AREAS=['Quezon City','Ortigas','Makati','Pasay'];
  var CATEGORIES=['All','Tops','Trousers','Shorts','Footwear','Outerwear'];
  var JACKETS=[42,44,46,48,50,52,54,56,58,60];
  var NEED_TYPES={
    'Polo':{category:'Tops',pattern:/\bpolo\b/i},
    'T-shirt':{category:'Tops',pattern:/\bt[- ]?shirts?\b|\btees?\b/i},
    'Shirt':{category:'Tops',pattern:/\bshirt\b/i,exclude:/\bt[- ]?shirt\b|\bpolo\b|\bsweatshirt\b/i},
    'Chinos':{category:'Trousers',pattern:/\bchinos?\b/i},
    'Jeans':{category:'Trousers',pattern:/\bjeans\b/i},
    'Shorts':{category:'Shorts',pattern:/\bshorts\b/i},
    'Sneakers':{category:'Footwear',pattern:/\bsneakers?\b|\btrainers?\b/i},
    'Sandals / clogs':{category:'Footwear',pattern:/\bsandals?\b|\bclogs?\b|\bcrocband\b|\bslides?\b/i},
    'Jacket':{category:'Outerwear',pattern:/\bjackets?\b|\bblazers?\b/i},
    'Knitwear':{category:'Outerwear',pattern:/\bcardigans?\b|\bsweaters?\b|\bjumpers?\b/i}
  };
  // Explicit choices constrain a need; old free-text notes retain their meaning.
  // Missing listing evidence never satisfies a selected material or garment.
  function needMatch(item,need){
    if(!need)return {matches:true,reasons:[]};
    var reasons=[],type=Object.prototype.hasOwnProperty.call(NEED_TYPES,need.garment)?NEED_TYPES[need.garment]:null,name=String(item.name || ''),f=root.ShoppingTaste.features(item);
    if(need.category && need.category!=='All' && item.category!==need.category)return {matches:false,reasons:[]};
    if(type){if(item.category!==type.category || !type.pattern.test(name) || type.exclude && type.exclude.test(name))return {matches:false,reasons:[]};reasons.push(need.garment+' named in listing');}
    if(need.material){if(!f.materials.includes(need.material))return {matches:false,reasons:[]};reasons.push(need.material+' named in listing');}
    if(need.use){
      var uses=f.occasions.slice();
      if(/\bpolo\b|\bchinos?\b/i.test(name))uses.push('Work','Casual');
      if(/\bjeans\b|\bshorts\b|\bsneakers?\b|\bsandals?\b/i.test(name))uses.push('Casual');
      if(!uses.includes(need.use))return {matches:false,reasons:[]};
      reasons.push(need.use+' use suggested by garment type');
    }
    if(need.budget){if(item.priceFrom || item.price>need.budget)return {matches:false,reasons:[]};reasons.push('within ₱'+Number(need.budget).toLocaleString('en-PH'));}
    if(!reasons.length && need.category && need.category!=='All')reasons.push(need.category+' category');
    return {matches:true,reasons:reasons};
  }
  var HOSTS=['www.uniqlo.com','www2.hm.com','www.zalora.com.ph','www.nike.com','www.adidas.com.ph','crocs.com.ph','www.levi.com.ph','www.underarmour.com.ph','www.penshoppe.com','www.sperry.com.ph','www.columbiasportswear.com.ph','www.hushpuppies.com.ph','www.tobys.com','giordano.ph','memofashion.com','www.regattalifestyle.com','timberland.com.ph','sportscentral.ph','www.smsupermalls.com','www.ayalamalls.com'];
  function safeUrl(value){try{var u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && !u.port && HOSTS.includes(u.hostname)?u.href:'';}catch(e){return '';}}
  function imageUrl(value){try{var u=new URL(value);return u.protocol==='https:' && ['image.hm.com','images.hm.com','cdn.shopify.com','static.nike.com','image.uniqlo.com','assets.adidas.com','dynamic.zacdn.com','static-ph.zacdn.com'].includes(u.hostname) && !u.username && !u.password && !u.port?u.href:'';}catch(e){return '';}}
  function cleanPrefs(raw){raw=raw || {};var seen=Array.isArray(raw.brandsSeen)?raw.brandsSeen:FIRST_BRANDS;return Object.assign({brands:BRANDS.filter(function(b){return !Array.isArray(raw.brands)||raw.brands.includes(b)||!seen.includes(b);}),brandsSeen:BRANDS.slice(),areas:AREAS.filter(function(a){return !Array.isArray(raw.areas)||raw.areas.includes(a);}),clothingSize:['S','M','L','XL'].includes(raw.clothingSize)?raw.clothingSize:'M',americanSize:['S','M','L','XL'].includes(raw.americanSize)?raw.americanSize:'S',shoeSize:Number(raw.shoeSize)>=4 && Number(raw.shoeSize)<=16?Number(raw.shoeSize):8.5,waistSize:Number.isInteger(Number(raw.waistSize)) && Number(raw.waistSize)>=24 && Number(raw.waistSize)<=44?Number(raw.waistSize):null,jacketSize:JACKETS.includes(Number(raw.jacketSize))?Number(raw.jacketSize):null,needs:(Array.isArray(raw.needs)?raw.needs:[]).slice(0,10).map(function(n){return {id:String(n.id || '').replace(/[^a-z0-9-]/gi,'').slice(0,40),text:String(n.text || '').trim().slice(0,120),category:CATEGORIES.includes(n.category)?n.category:'All',garment:Object.prototype.hasOwnProperty.call(NEED_TYPES,n.garment)?n.garment:'',use:root.ShoppingTaste.OPTIONS.occasions.includes(n.use)?n.use:'',material:root.ShoppingTaste.OPTIONS.materials.includes(n.material)?n.material:'',budget:Number(n.budget)>0 && Number(n.budget)<=100000?Number(n.budget):null};}).filter(function(n){return n.id && n.text;}),saved:(Array.isArray(raw.saved)?raw.saved:[]).filter(function(s){return /^[a-z0-9-]{1,90}$/i.test(s);}).slice(0,150)},{taste:root.ShoppingTaste.clean(raw.taste),feedback:root.ShoppingTaste.cleanFeedback(raw.feedback),wardrobe:root.ShoppingStyle.cleanWardrobe(raw.wardrobe),wardrobeColors:root.ShoppingStyle.cleanWardrobeColors(raw.wardrobeColors),tripPlans:[...new Set((Array.isArray(raw.tripPlans)?raw.tripPlans:[]).filter(function(id){return typeof id==='string' && /^[a-z0-9-]{1,100}$/.test(id);} ))].slice(0,30),purchases:root.ShoppingStyle.cleanPurchases(raw.purchases)});}
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
  function evenWaistsOnly(item){
    var waists=(Array.isArray(item.sizeRun)?item.sizeRun:[]).map(function(s){var m=/^(\d{2})[A-Z]{0,2}$/.exec(String(s).trim().toUpperCase());return m?Number(m[1]):NaN;}).filter(function(n){return n>=24 && n<=44;});
    return waists.length>0 && waists.every(function(n){return n%2===0;});
  }
  function wholeSizesOnly(item){return Array.isArray(item.sizeRun) && item.sizeRun.length>0 && item.sizeRun.every(function(s){return String(s).trim()!=='' && Number.isFinite(Number(s)) && Number(s)>0 && Number(s)%1===0;});}
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
    if(num){
      if(!mine)return 'unknown';
      if(num.sizes.includes(mine))return 'match';
      // A line cut in even waists only (28/30/32) has no 31 to sell out: that
      // is a size-chart question, not missing stock. A made-but-sold-out 31 hides.
      if(num.kind==='waist' && mine%2 && evenWaistsOnly(item))return 'unknown';
      return 'unavailable';
    }
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
  function brandMatch(item,brand){return !brand || (RETAILERS.includes(brand)?(item.retailer===brand || item.brand===brand):item.brand===brand);}
  function retailerOn(item,prefs){return !RETAILERS.includes(item.retailer) || prefs.brands.includes(item.retailer);}
  function matchItems(feed,prefs,filters,now){
    prefs=cleanPrefs(prefs);filters=filters || {};now=now || Date.now();
    var need=prefs.needs.find(function(n){return n.id===filters.need;}),ranks=new Map();
    function rank(i){if(!ranks.has(i.id))ranks.set(i.id,rankValue(i,prefs,need));return ranks.get(i.id);}
    // Not for me, and gear your style guide says will sit unworn, go last.
    var verdicts=new Map();
    function style(i){if(!verdicts.has(i.id))verdicts.set(i.id,root.ShoppingStyle.verdict(i,prefs).kind);return verdicts.get(i.id);}
    function passed(i){return style(i)==='owned' || style(i)==='skip' || prefs.feedback.some(function(r){return r.id===i.id && r.vote==='pass';});}
    return ((feed || {}).items || []).filter(function(i){
      if(!retailerOn(i,prefs))return false;
      if(!safeUrl(i.url) || !prefs.brands.includes(i.brand) || !Number.isFinite(i.price) || !(i.price>0) || !(i.originalPrice>i.price))return false;
      if(!fresh(i,now))return false;
      if(i.channel==='store' && (!prefs.areas.includes(i.area) || !i.branch || !i.validTo || i.validTo<new Date(now+8*3600000).toISOString().slice(0,10)))return false;
      var today=new Date(now+8*3600000).toISOString().slice(0,10);if(i.validTo && i.validTo<today || i.validFrom && i.validFrom>today)return false;
      if(!brandMatch(i,filters.brand) || filters.category && filters.category!=='All' && i.category!==filters.category)return false;
      if(!needMatch(i,need).matches)return false;
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
  root.ShoppingCore={NEED_TYPES:NEED_TYPES,needMatch:needMatch,BRANDS:BRANDS,RETAILERS:RETAILERS,retailerOn:retailerOn,AREAS:AREAS,CATEGORIES:CATEGORIES,safeUrl:safeUrl,imageUrl:imageUrl,cleanPrefs:cleanPrefs,sizeMatch:sizeMatch,wholeSizesOnly:wholeSizesOnly,evenWaistsOnly:evenWaistsOnly,sizeLabel:sizeLabel,priceMemory:priceMemory,JACKETS:JACKETS,fresh:fresh,brandMatch:brandMatch,matchItems:matchItems,rankValue:rankValue};
  if(typeof module!=='undefined' && module.exports)module.exports=root.ShoppingCore;
})(typeof globalThis!=='undefined'?globalThis:this);
