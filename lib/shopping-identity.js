(function(root){
  'use strict';
  var clean=function(v){return String(v || '').trim().toUpperCase();};
  function code(brand,value){var s=clean(value);return brand==='Adidas'?/^(?:[A-Z]{2}\d{4}|[A-Z]\d{5})$/.test(s)?s:'':brand==='Nike'?/^[A-Z0-9]{6}-\d{3}$/.test(s)?s:'':/^[A-Z0-9][A-Z0-9-]{3,24}$/.test(s) && /[A-Z]/.test(s) && /\d/.test(s)?s:'';}
  function colour(v){return clean(v).replace(/\s*[/|,]\s*/g,'/').replace(/\s+/g,' ');}
  function key(item){
    var style=code(item.brand,item.styleCode);if(!style)return '';
    // Adidas publishes distinct article numbers for colour variants, e.g.
    // IP2234 BLACK / IP2235 OWHITE in its own article/colour catalogue:
    // https://brand.assets.adidas.com/image/upload/v1716925874/TYC_EA_CYBER_ADIDAS_2024_VF_2_af7098c37b.pdf
    // Nike's full style includes the three-digit colour suffix. Retailer SKUs
    // and model names alone are never treated as manufacturer identities.
    if(item.brand==='Adidas' || item.brand==='Nike')return item.brand+':'+style;
    var color=colour(item.colorCode || item.color);return color?item.brand+':'+style+':'+color:'';
  }
  function same(a,b){var k=key(a);if(!k || k!==key(b) || a.category!==b.category)return false;var ac=colour(a.color),bc=colour(b.color);return !ac || !bc || ac===bc;}
  root.ShoppingIdentity={code:code,colour:colour,key:key,same:same};
})(typeof window!=='undefined'?window:globalThis);
