(function(root){
  'use strict';
  var BRANDS=['UNIQLO','H&M','ZALORA','Nike','Adidas','Crocs'];
  var AREAS=['Quezon City','Ortigas','Makati','Pasay'];
  var CATEGORIES=['All','Tops','Trousers','Shorts','Footwear','Outerwear'];
  var HOSTS=['www.uniqlo.com','www2.hm.com','www.zalora.com.ph','www.nike.com','www.adidas.com.ph','crocs.com.ph','www.smsupermalls.com','www.ayalamalls.com'];
  function safeUrl(value){try{var u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && !u.port && HOSTS.includes(u.hostname)?u.href:'';}catch(e){return '';}}
  function imageUrl(value){try{var u=new URL(value);return u.protocol==='https:' && ['image.hm.com','images.hm.com','cdn.shopify.com','static.nike.com','image.uniqlo.com','assets.adidas.com','dynamic.zacdn.com','static-ph.zacdn.com'].includes(u.hostname) && !u.username && !u.password && !u.port?u.href:'';}catch(e){return '';}}
  function cleanPrefs(raw){raw=raw || {};return {brands:BRANDS.filter(function(b){return !Array.isArray(raw.brands)||raw.brands.includes(b);}),areas:AREAS.filter(function(a){return !Array.isArray(raw.areas)||raw.areas.includes(a);}),clothingSize:['S','M','L','XL'].includes(raw.clothingSize)?raw.clothingSize:'M',americanSize:['S','M','L','XL'].includes(raw.americanSize)?raw.americanSize:'S',shoeSize:Number(raw.shoeSize)>=4 && Number(raw.shoeSize)<=16?Number(raw.shoeSize):8.5,needs:(Array.isArray(raw.needs)?raw.needs:[]).slice(0,10).map(function(n){return {id:String(n.id || '').replace(/[^a-z0-9-]/gi,'').slice(0,40),text:String(n.text || '').trim().slice(0,120),category:CATEGORIES.includes(n.category)?n.category:'All',budget:Number(n.budget)>0 && Number(n.budget)<=100000?Number(n.budget):null};}).filter(function(n){return n.id && n.text;}),saved:(Array.isArray(raw.saved)?raw.saved:[]).filter(function(s){return /^[a-z0-9-]{1,90}$/i.test(s);}).slice(0,150)};}
  function sizeMatch(item,prefs){
    var sizes=item.availableSizes;
    if(!Array.isArray(sizes))return 'unknown';
    if(item.category==='Footwear'){
      // A men's US size is explicit; never infer it from EU, UK, women's,
      // unlabelled sizes, or round an 8.5 to a Crocs 8 or 9.
      if(item.sizeSystem!=='US men')return 'unknown';
      return sizes.some(function(s){return Number(s)===prefs.shoeSize;})?'match':'unavailable';
    }
    var wanted=item.sizeSystem==='US clothing'?prefs.americanSize:prefs.clothingSize;
    return sizes.map(function(s){return String(s).toUpperCase();}).includes(wanted)?'match':'unavailable';
  }
  function matchItems(feed,prefs,filters,now){
    prefs=cleanPrefs(prefs);filters=filters || {};now=now || Date.now();
    var need=prefs.needs.find(function(n){return n.id===filters.need;});
    return ((feed || {}).items || []).filter(function(i){
      if(i.retailer==='ZALORA' && !prefs.brands.includes('ZALORA'))return false;
      if(!safeUrl(i.url) || !prefs.brands.includes(i.brand) || !Number.isFinite(i.price) || !(i.price>0) || !(i.originalPrice>i.price))return false;
      var at=Date.parse(i.checkedAt);if(!Number.isFinite(at) || now-at>4*86400000 || at>now+300000)return false;
      if(i.channel==='store' && (!prefs.areas.includes(i.area) || !i.branch || !i.validTo || i.validTo<new Date(now+8*3600000).toISOString().slice(0,10)))return false;
      var today=new Date(now+8*3600000).toISOString().slice(0,10);if(i.validTo && i.validTo<today || i.validFrom && i.validFrom>today)return false;
      if(filters.brand && i.brand!==filters.brand || filters.category && filters.category!=='All' && i.category!==filters.category)return false;
      if(need && (need.category!=='All' && i.category!==need.category || need.budget && (i.price>need.budget || i.priceFrom)))return false;
      if(filters.saved && !prefs.saved.includes(i.id))return false;
      var size=sizeMatch(i,prefs);return size!=='unavailable' && (!filters.confirmed || size==='match');
    }).sort(function(a,b){return (sizeMatch(a,prefs)==='match'?0:1)-(sizeMatch(b,prefs)==='match'?0:1) || (b.previousPrice>b.price?1:0)-(a.previousPrice>a.price?1:0) || (1-b.price/b.originalPrice)-(1-a.price/a.originalPrice) || a.price-b.price;});
  }
  root.ShoppingCore={BRANDS:BRANDS,AREAS:AREAS,CATEGORIES:CATEGORIES,safeUrl:safeUrl,imageUrl:imageUrl,cleanPrefs:cleanPrefs,sizeMatch:sizeMatch,matchItems:matchItems};
  if(typeof module!=='undefined' && module.exports)module.exports=root.ShoppingCore;
})(typeof globalThis!=='undefined'?globalThis:this);
