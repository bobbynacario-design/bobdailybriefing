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
  var LETTER_SIZES=['XXS','XS','S','M','L','XL','XXL','XXXL'];
  var SIZE_BRANDS=BRANDS.filter(function(b){return !RETAILERS.includes(b);});
  var STOCK_MAX_HOURS=48;
  var OPEN_NEEDS='@open-needs',MAX_OPEN_NEEDS=10,MAX_FULFILLED_NEEDS=50;
  function cleanBrandSizes(raw){
    var out={};SIZE_BRANDS.forEach(function(b){var r=(raw || {})[b] || {},s={};
      ['clothingSize','americanSize'].forEach(function(k){if(LETTER_SIZES.includes(r[k]))s[k]=r[k];});
      if(r.shoeSize!=='' && Number(r.shoeSize)>=4 && Number(r.shoeSize)<=16 && Number(r.shoeSize)*2%1===0)s.shoeSize=Number(r.shoeSize);
      if(r.waistSize!=='' && Number.isInteger(Number(r.waistSize)) && Number(r.waistSize)>=24 && Number(r.waistSize)<=44)s.waistSize=Number(r.waistSize);
      if(JACKETS.includes(Number(r.jacketSize)))s.jacketSize=Number(r.jacketSize);
      if(Object.keys(s).length)out[b]=s;
    });return out;
  }
  function sizePrefs(item,prefs){return Object.assign({},prefs,cleanBrandSizes(prefs.brandSizes)[item.brand] || {});}
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
  function snapshot(item,at){
    if(!item || !/^[a-z0-9-]{1,90}$/i.test(item.id || '') || !safeUrl(item.url) || safeUrl(item.url).length>1024 || !Number.isFinite(item.price) || item.price<=0)return null;
    var out={id:item.id,url:safeUrl(item.url),price:item.price,savedAt:Number.isFinite(Date.parse(at))?new Date(at).toISOString():''};
    ['name','brand','retailer','category','color','sizeSystem','channel','branch','area','provenance'].forEach(function(k){if(typeof item[k]==='string')out[k]=item[k].slice(0,140);});
    ['checkedAt','sizesCheckedAt','firstSeen','previousChecked','priorLowAt'].forEach(function(k){if(Number.isFinite(Date.parse(item[k])))out[k]=new Date(item[k]).toISOString();});
    ['validFrom','validTo'].forEach(function(k){if(/^\d{4}-\d{2}-\d{2}$/.test(item[k] || ''))out[k]=item[k];});
    ['originalPrice','previousPrice','priorLow','priorHigh'].forEach(function(k){if(Number.isFinite(item[k]) && item[k]>0)out[k]=item[k];});
    ['availableSizes','sizeRun'].forEach(function(k){if(Array.isArray(item[k]))out[k]=item[k].slice(0,30).map(function(s){return String(s).slice(0,12);});});
    if(imageUrl(item.image))out.image=imageUrl(item.image).slice(0,1024);
    if(item.priceFrom)out.priceFrom=true;
    return out;
  }
  function cleanSavedDeals(rows,ids){var seen=new Set();return (Array.isArray(rows)?rows:[]).filter(function(i){return i && ids.includes(i.id) && !seen.has(i.id) && seen.add(i.id);}).map(function(i){return snapshot(i,i.savedAt);}).filter(Boolean).slice(0,150);}
  function cleanNeeds(rows){
    var seen=new Set(),open=[],done=[];
    (Array.isArray(rows)?rows:[]).slice(0,200).forEach(function(n){
      if(!n || typeof n!=='object')return;
      var id=String(n.id || '').replace(/[^a-z0-9-]/gi,'').slice(0,40),text=String(n.text || '').trim().slice(0,120);
      if(!id || !text || seen.has(id))return;seen.add(id);
      var f=n.fulfillment,fulfillment=f && typeof f.purchaseId==='string' && (f.purchaseId==='' || /^[a-z0-9-]{1,90}$/i.test(f.purchaseId)) && Number.isFinite(Date.parse(f.at))?{purchaseId:f.purchaseId,at:new Date(f.at).toISOString(),purchaseAt:f.purchaseId && Number.isFinite(Date.parse(f.purchaseAt===undefined?f.at:f.purchaseAt))?new Date(f.purchaseAt===undefined?f.at:f.purchaseAt).toISOString():'',purchaseName:String(f.purchaseName || '').slice(0,140)}:null;
      var row={id:id,text:text,category:CATEGORIES.includes(n.category)?n.category:'All',garment:Object.prototype.hasOwnProperty.call(NEED_TYPES,n.garment)?n.garment:'',use:root.ShoppingTaste.OPTIONS.occasions.includes(n.use)?n.use:'',material:root.ShoppingTaste.OPTIONS.materials.includes(n.material)?n.material:'',budget:Number(n.budget)>0 && Number(n.budget)<=100000?Number(n.budget):null,fulfillment:fulfillment};
      (fulfillment?done:open).push(row);
    });
    return open.slice(0,MAX_OPEN_NEEDS).concat(done.sort(function(a,b){return Date.parse(b.fulfillment.at)-Date.parse(a.fulfillment.at);}).slice(0,MAX_FULFILLED_NEEDS));
  }
  function openNeeds(prefs){return (prefs.needs || []).filter(function(n){return !n.fulfillment;});}
  function fulfilNeed(prefs,id,purchaseId,at){
    var next=cleanPrefs(prefs),need=next.needs.find(function(n){return n.id===id;});
    if(!need || need.fulfillment)throw Error('This need is no longer open. Reload your shopping list.');
    var purchase=purchaseId?next.purchases.find(function(p){return p.id===purchaseId;}):null;
    if(purchaseId && !purchase)throw Error('Record this purchase before linking a need.');
    if(purchase && purchase.needId && purchase.needId!==id){
      var linked=next.needs.find(function(n){return n.id===purchase.needId;});
      if(linked && linked.fulfillment && linked.fulfillment.purchaseId===purchase.id && linked.fulfillment.purchaseAt===purchase.at)throw Error('This purchase already fulfils another need. Reopen that need before choosing another.');
    }
    var time=at || new Date().toISOString();if(!Number.isFinite(Date.parse(time)))throw Error('The completion date could not be recorded.');
    need.fulfillment={purchaseId:purchase?purchase.id:'',at:new Date(time).toISOString(),purchaseAt:purchase?purchase.at:'',purchaseName:purchase?purchase.name:''};
    if(purchase)purchase.needId=id;
    return cleanPrefs(next);
  }
  function reopenNeed(prefs,id){
    var next=cleanPrefs(prefs),need=next.needs.find(function(n){return n.id===id;});
    if(!need || !need.fulfillment)return next;
    if(openNeeds(next).length>=MAX_OPEN_NEEDS)throw Error('Keep up to ten open needs. Fulfil or remove one before reopening another.');
    var f=need.fulfillment,purchase=next.purchases.find(function(p){return p.id===f.purchaseId && p.at===f.purchaseAt && p.needId===id;});
    if(purchase)purchase.needId='';need.fulfillment=null;
    return cleanPrefs(next);
  }
  function recordPurchase(prefs,item,piece,total,needId,at){
    var next=root.ShoppingStyle.bought(cleanPrefs(prefs),item,piece,total,at);
    return needId?fulfilNeed(next,needId,item.id,at):cleanPrefs(next);
  }
  function undoPurchase(prefs,id){
    var base=cleanPrefs(prefs),entry=base.purchases.find(function(p){return p.id===id;}),result=root.ShoppingStyle.undoBought(base,id);
    result.needReview=false;result.reopened=false;
    if(entry && entry.needId){
      var need=result.prefs.needs.find(function(n){return n.id===entry.needId;});
      if(need && need.fulfillment && need.fulfillment.purchaseId===entry.id && need.fulfillment.purchaseAt===entry.at){
        if(openNeeds(result.prefs).length>=MAX_OPEN_NEEDS)throw Error('Undo needs an open shopping-list slot. Fulfil or remove one open need, then undo this purchase.');
        need.fulfillment=null;result.reopened=true;
      }else if(need && need.fulfillment)result.needReview=true;
    }
    result.prefs=cleanPrefs(result.prefs);return result;
  }
  function cleanPrefs(raw){raw=raw || {};var seen=Array.isArray(raw.brandsSeen)?raw.brandsSeen:FIRST_BRANDS,saved=[...new Set((Array.isArray(raw.saved)?raw.saved:[]).filter(function(s){return typeof s==='string' && /^[a-z0-9-]{1,90}$/i.test(s);}))].slice(0,150);return Object.assign({brands:BRANDS.filter(function(b){return !Array.isArray(raw.brands)||raw.brands.includes(b)||!seen.includes(b);}),brandsSeen:BRANDS.slice(),areas:AREAS.filter(function(a){return !Array.isArray(raw.areas)||raw.areas.includes(a);}),clothingSize:['S','M','L','XL'].includes(raw.clothingSize)?raw.clothingSize:'M',americanSize:['S','M','L','XL'].includes(raw.americanSize)?raw.americanSize:'S',shoeSize:Number(raw.shoeSize)>=4 && Number(raw.shoeSize)<=16?Number(raw.shoeSize):8.5,waistSize:Number.isInteger(Number(raw.waistSize)) && Number(raw.waistSize)>=24 && Number(raw.waistSize)<=44?Number(raw.waistSize):null,jacketSize:JACKETS.includes(Number(raw.jacketSize))?Number(raw.jacketSize):null,needs:cleanNeeds(raw.needs),saved:saved,savedDeals:cleanSavedDeals(raw.savedDeals,saved)},{taste:root.ShoppingTaste.clean(raw.taste),feedback:root.ShoppingTaste.cleanFeedback(raw.feedback),wardrobe:root.ShoppingStyle.cleanWardrobe(raw.wardrobe),wardrobeColors:root.ShoppingStyle.cleanWardrobeColors(raw.wardrobeColors),tripPlans:[...new Set((Array.isArray(raw.tripPlans)?raw.tripPlans:[]).filter(function(id){return typeof id==='string' && /^[a-z0-9-]{1,100}$/.test(id);} ))].slice(0,30),purchases:root.ShoppingStyle.cleanPurchases(raw.purchases),brandSizes:cleanBrandSizes(raw.brandSizes)});}
  // Merge only changes since the profile this device read. Independent fields,
  // checkbox choices and records merge; incompatible edits fail atomically.
  function mergePrefs(latest,base,next){
    function same(a,b){if(a===b)return true;if(!a || !b || typeof a!=='object' || typeof b!=='object' || Array.isArray(a)!==Array.isArray(b))return false;var keys=Object.keys(a);return keys.length===Object.keys(b).length && keys.every(function(k){return Object.prototype.hasOwnProperty.call(b,k) && same(a[k],b[k]);});}
    function conflict(){var e=Error('This shopping value changed on another device. Reload the latest profile, then retry your edit.');e.code='shopping-conflict';throw e;}
    function merge(b,n,r,path){
      if(same(b,n))return r;if(same(b,r) || same(n,r))return n;
      if(Array.isArray(b) && Array.isArray(n) && Array.isArray(r)){
        if(['needs','feedback','purchases','savedDeals'].includes(path)){
          var bm=new Map(b.map(function(x){return [x.id,x];})),nm=new Map(n.map(function(x){return [x.id,x];})),rm=new Map(r.map(function(x){return [x.id,x];}));
          return [...new Set(r.concat(n,b).map(function(x){return x.id;}))].map(function(id){return merge(bm.get(id),nm.get(id),rm.get(id),path+'.'+id);}).filter(Boolean);
        }
        return [...new Set(r.concat(n))].filter(function(v){return b.includes(v)?n.includes(v) && r.includes(v):n.includes(v) || r.includes(v);});
      }
      if((b===undefined || b && typeof b==='object' && !Array.isArray(b)) && n && r && !Array.isArray(n) && !Array.isArray(r) && typeof n==='object' && typeof r==='object'){
        b=b || {};
        var out={};[...new Set(Object.keys(b).concat(Object.keys(n),Object.keys(r)))].forEach(function(k){var v=merge(b[k],n[k],r[k],path?path+'.'+k:k);if(v!==undefined)out[k]=v;});return out;
      }
      return conflict();
    }
    var b=cleanPrefs(base),n=cleanPrefs(next),r=cleanPrefs(latest);
    // A purchase and its confirmed wardrobe count form one operation. Two
    // different purchases cannot silently share the same stale total.
    [...new Set(b.purchases.concat(n.purchases).map(function(p){return p.id;}))].forEach(function(id){
      var before=b.purchases.find(function(p){return p.id===id;}),after=n.purchases.find(function(p){return p.id===id;}),remote=r.purchases.find(function(p){return p.id===id;}),piece=(after || before).piece;
      var countChanged=!before || !after || before.piece!==after.piece || before.previousCount!==after.previousCount || before.recordedCount!==after.recordedCount;
      if(piece && countChanged && !same(before,after) && !same(after,remote) && (!same(b.wardrobe[piece],r.wardrobe[piece]) || !same(b.purchases.filter(function(p){return p.piece===piece;}),r.purchases.filter(function(p){return p.piece===piece;}))))conflict();
    });
    // Completing or reopening a need confirms its current requirements. Do
    // not attach a purchase to requirements edited on another device, or let
    // a stale editor change the requirements of a newly fulfilled need.
    b.needs.forEach(function(before){
      var after=n.needs.find(function(x){return x.id===before.id;}),remote=r.needs.find(function(x){return x.id===before.id;});
      if(!after || same(before,after) || same(after,remote))return;
      if(!same(before.fulfillment,after.fulfillment)){if(!same(before,remote))conflict();}
      else if(!same(before.fulfillment,remote && remote.fulfillment))conflict();
    });
    var out=merge(b,n,r,'');
    if(out.saved.length>150 || openNeeds(out).length>MAX_OPEN_NEEDS || out.tripPlans.length>30){var e=Error('The combined shopping profile exceeds a list limit. Reload and remove an entry before adding another.');e.code='shopping-limit';throw e;}
    return cleanPrefs(out);
  }
  // A saved view is a private history, independent of current recommendation
  // gates. Missing from a bounded scout never proves a retailer sold out.
  function savedItems(feed,prefs,filters,now){
    prefs=cleanPrefs(prefs);filters=cleanFilters(filters);now=now==null?Date.now():now;
    var live=new Map(((feed || {}).items || []).map(function(i){return [i.id,i];})),saved=new Map(prefs.savedDeals.map(function(i){return [i.id,i];})),today=new Date(now+8*3600000).toISOString().slice(0,10);
    return prefs.saved.map(function(id){
      var current=snapshot(live.get(id),''),stored=saved.get(id),item=current || stored || {id:id,name:'Previously saved deal · '+id},status='Current observation',kind='current';
      if(!stored && !current){status='Older save · details unavailable';kind='missing';}
      else if(item.validTo && item.validTo<today){status='Expired offer';kind='expired';}
      else if(!current){status=feed?'Not in latest scout · availability unverified':'Scout unavailable · availability unverified';kind='missing';}
      else if(!fresh(current,now)){status='Old observation · recheck price and stock';kind='old';}
      else if(current.validFrom && current.validFrom>today){status='Offer not started';kind='pending';}
      else if(stockConfidence(current,prefs,now).match==='unavailable'){status='Your size is no longer listed';kind='size';}
      else if(!(current.originalPrice>current.price)){status='No current markdown observed';kind='regular';}
      if(kind==='current' && stored && current.price!==stored.price){status='Price changed since saving';kind='changed';}
      return {id:id,item:item,snapshot:stored || null,current:current || null,status:status,kind:kind};
    }).filter(function(r){var stored=r.snapshot || {},searchable=Object.assign({},r.item,{name:[r.item.name,stored.name].filter(Boolean).join(' '),color:[r.item.color,stored.color].filter(Boolean).join(' ')});return (!filters.brand || brandMatch(r.item,filters.brand)) && (!filters.category || filters.category==='All' || r.item.category===filters.category) && searchMatch(searchable,filters.query) && !filters.priceError && (!filters.maxPrice || Number.isFinite(r.item.price) && !r.item.priceFrom && r.item.price<=filters.maxPrice);}).sort(function(a,b){return browseOrder(a.item,b.item,filters.sort);});
  }
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
    prefs=sizePrefs(item,prefs);
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
    prefs=sizePrefs(item,prefs);
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
  function stockConfidence(item,prefs,now){
    now=now==null?Date.now():now;
    var raw=sizeMatch(item,prefs),mine=sizePrefs(item,prefs),hasSizes=Array.isArray(item.availableSizes),at=Date.parse(item.sizesCheckedAt===undefined?item.checkedAt:item.sizesCheckedAt),valid=hasSizes && Number.isFinite(at) && at<=now+300000;
    var kind=!valid?'unchecked':now-at>STOCK_MAX_HOURS*3600000?'old':raw==='match'?'recent':raw==='unavailable'?'unavailable':'chart';
    var label=kind==='unchecked'?'Size stock is not checked':kind==='old'?'Stock check is over 48 hours old · recheck your size':kind==='recent'?'Your size was listed at the stock check':kind==='unavailable'?'Your size was not listed at the stock check':
      item.category==='Footwear' && wholeSizesOnly(item)?'Made in whole sizes only; check the fit guide':mine.waistSize%2===1 && evenWaistsOnly(item)?'Made in even waists only; check the size chart':'Check the retailer’s size chart; the size system does not confirm your fit';
    var numeric=numericSystem(item),key=item.category==='Footwear'?'shoeSize':numeric?numeric.kind==='waist'?'waistSize':'jacketSize':item.sizeSystem==='US clothing'?'americanSize':'clothingSize';
    return {kind:kind,match:kind==='recent'?'match':kind==='unavailable'?'unavailable':'unknown',label:label,checkedAt:valid?new Date(at).toISOString():'',hours:valid?Math.max(0,Math.floor((now-at)/3600000)):null,brandOverride:Object.prototype.hasOwnProperty.call(cleanBrandSizes(prefs.brandSizes)[item.brand] || {},key)};
  }
  function cleanFilters(raw){
    raw=raw || {};var value=raw.maxPrice,has=value!=null && String(value).trim()!=='',max=Number(value);
    return Object.assign({},raw,{query:String(raw.query || '').trim().slice(0,120),maxPrice:has && Number.isFinite(max) && max>0 && max<=100000?max:null,priceError:raw.priceError===true || has && (!Number.isFinite(max) || max<=0 || max>100000),sort:['price','newest','drop'].includes(raw.sort)?raw.sort:'recommended'});
  }
  function searchMatch(item,query){var text=[item.name,item.brand,item.retailer,item.color].filter(Boolean).join(' ').toLowerCase();return String(query || '').toLowerCase().split(/\s+/).filter(Boolean).every(function(word){return text.includes(word);});}
  function browseOrder(a,b,sort){
    if(sort==='price'){var ap=Number.isFinite(a.price)?a.price:Infinity,bp=Number.isFinite(b.price)?b.price:Infinity;return ap===bp?0:ap-bp;}
    if(sort==='newest')return (Date.parse(b.firstSeen || b.checkedAt) || 0)-(Date.parse(a.firstSeen || a.checkedAt) || 0);
    if(sort==='drop'){var drop=function(i){return Number.isFinite(i.previousPrice) && Number.isFinite(i.price)?Math.max(0,i.previousPrice-i.price):0;};return drop(b)-drop(a);}
    return 0;
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
  function browseResult(feed,prefs,filters,now){
    prefs=cleanPrefs(prefs);filters=cleanFilters(filters);now=now==null?Date.now():now;
    var active=openNeeds(prefs),need=active.find(function(n){return n.id===filters.need;}),ranks=new Map(),verdicts=new Map(),excluded={},total=((feed || {}).items || []).length;
    function rank(i){if(!ranks.has(i.id))ranks.set(i.id,rankValue(i,prefs,need,now));return ranks.get(i.id);}
    function style(i){if(!verdicts.has(i.id))verdicts.set(i.id,root.ShoppingStyle.verdict(i,prefs,now).kind);return verdicts.get(i.id);}
    function passed(i){return style(i)==='owned' || style(i)==='skip' || prefs.feedback.some(function(r){return r.id===i.id && r.vote==='pass';});}
    function omit(key){excluded[key]=(excluded[key] || 0)+1;return false;}
    var today=new Date(now+8*3600000).toISOString().slice(0,10);
    var rows=((feed || {}).items || []).filter(function(i){
      if(!safeUrl(i.url) || !Number.isFinite(i.price) || !(i.price>0) || !(i.originalPrice>i.price))return omit('unpriced');
      if(!fresh(i,now) || i.validTo && i.validTo<today || i.validFrom && i.validFrom>today)return omit('old');
      if(i.channel==='store' && (!prefs.areas.includes(i.area) || !i.branch || !i.validTo))return omit('area');
      if(!retailerOn(i,prefs) || !prefs.brands.includes(i.brand))return omit('profile');
      if(!brandMatch(i,filters.brand))return omit('brand');
      if(filters.category && filters.category!=='All' && i.category!==filters.category)return omit('category');
      if(!searchMatch(i,filters.query))return omit('query');
      if(filters.priceError || filters.maxPrice && (i.priceFrom || i.price>filters.maxPrice))return omit('price');
      if(filters.need===OPEN_NEEDS? !active.some(function(n){return needMatch(i,n).matches;}):filters.need && (!need || !needMatch(i,need).matches))return omit('need');
      var ceiling=prefs.taste.budgets[i.category];if(ceiling && (i.priceFrom || i.price>ceiling))return omit('budget');
      if(filters.saved && !prefs.saved.includes(i.id))return omit('saved');
      var stock=stockConfidence(i,prefs,now);
      if(stock.match==='unavailable')return omit('size');
      if(filters.confirmed && stock.match!=='match')return omit('confirmed');
      if(filters.wear && style(i)!=='wear')return omit('wear');
      return true;
    }).sort(function(a,b){return browseOrder(a,b,filters.sort) || (passed(a)?1:0)-(passed(b)?1:0) || (style(b)==='wear'?1:0)-(style(a)==='wear'?1:0) || rank(b)-rank(a) || a.price-b.price;});
    return {items:rows,excluded:excluded,total:total};
  }
  function needCounts(feed,prefs,filters,now){
    prefs=cleanPrefs(prefs);var pool=matchItems(feed,prefs,Object.assign({},filters,{need:''}),now),active=openNeeds(prefs);
    return {rows:active.map(function(n){return {need:n,count:pool.filter(function(i){return needMatch(i,n).matches;}).length};}),total:pool.filter(function(i){return active.some(function(n){return needMatch(i,n).matches;});}).length};
  }
  function matchItems(feed,prefs,filters,now){return browseResult(feed,prefs,filters,now).items;}
  // A deal ranks by its discount in points (40% off = 40). Your size listed
  // in a stock check within 48 hours adds 15. A price fall adds 5; a price that was
  // lower on an earlier check takes 5 off. Taste nudges by at most 20 either
  // way: it reorders deals of similar depth but cannot bury a much deeper
  // markdown. The Worth it tier comes before this (matchItems).
  function rankValue(i,prefs,need,now){
    var taste=root.ShoppingTaste.assess(i,prefs,need).score;
    return Math.round((1-i.price/i.originalPrice)*100)+(stockConfidence(i,prefs,now).match==='match'?15:0)+(i.previousPrice>i.price?5:0)-(i.priorLow>0 && i.price>i.priorLow?5:0)+Math.max(-20,Math.min(20,taste));
  }
  root.ShoppingCore={OPEN_NEEDS:OPEN_NEEDS,MAX_OPEN_NEEDS:MAX_OPEN_NEEDS,cleanNeeds:cleanNeeds,openNeeds:openNeeds,fulfilNeed:fulfilNeed,reopenNeed:reopenNeed,recordPurchase:recordPurchase,undoPurchase:undoPurchase,needCounts:needCounts,STOCK_MAX_HOURS:STOCK_MAX_HOURS,LETTER_SIZES:LETTER_SIZES,SIZE_BRANDS:SIZE_BRANDS,cleanBrandSizes:cleanBrandSizes,sizePrefs:sizePrefs,stockConfidence:stockConfidence,cleanFilters:cleanFilters,searchMatch:searchMatch,browseResult:browseResult,NEED_TYPES:NEED_TYPES,needMatch:needMatch,BRANDS:BRANDS,RETAILERS:RETAILERS,retailerOn:retailerOn,AREAS:AREAS,CATEGORIES:CATEGORIES,safeUrl:safeUrl,imageUrl:imageUrl,cleanPrefs:cleanPrefs,snapshot:snapshot,mergePrefs:mergePrefs,savedItems:savedItems,sizeMatch:sizeMatch,wholeSizesOnly:wholeSizesOnly,evenWaistsOnly:evenWaistsOnly,sizeLabel:sizeLabel,priceMemory:priceMemory,JACKETS:JACKETS,fresh:fresh,brandMatch:brandMatch,matchItems:matchItems,rankValue:rankValue};
  if(typeof module!=='undefined' && module.exports)module.exports=root.ShoppingCore;
})(typeof globalThis!=='undefined'?globalThis:this);
