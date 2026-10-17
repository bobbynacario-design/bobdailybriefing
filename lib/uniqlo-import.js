(function(root){
  'use strict';
  var OFFER_URL='https://www.uniqlo.com/ph/en/feature/limited-offers/men';
  function clean(s){return String(s || '').replace(/\s+/g,' ').trim();}
  function productUrl(raw){try{var u=new URL(raw,'https://www.uniqlo.com');if(u.origin!=='https://www.uniqlo.com' || !/^\/ph\/en\/products\/E\d{6}-\d{3}\/\d{2}$/.test(u.pathname) || u.username || u.password)return '';var color=u.searchParams.get('colorDisplayCode');u.search='';if(color && /^\d{2}$/.test(color))u.searchParams.set('colorDisplayCode',color);return u.href;}catch(e){return '';}}
  function dates(text){var m=/Limited Offer from (\d{1,2}) (\w{3}) - (\d{1,2}) (\w{3}) (\d{4})/i.exec(text);if(!m)return null;var months='jan feb mar apr may jun jul aug sep oct nov dec'.split(' '),sm=months.indexOf(m[2].toLowerCase()),em=months.indexOf(m[4].toLowerCase()),year=+m[5];if(sm<0 || em<0)return null;function day(y,month,d){var dt=new Date(Date.UTC(y,month,d));return dt.getUTCMonth()===month && dt.getUTCDate()===d?dt.toISOString().slice(0,10):'';}var from=day(year-(sm>em?1:0),sm,+m[1]),to=day(year,em,+m[3]);return from && to && from<=to && Date.parse(to)-Date.parse(from)<=31*86400000?{validFrom:from,validTo:to}:null;}
  function kind(name){if(/\b(sock|socks|bag|bags|cap|hat|belt|scarf|underwear)\b/i.test(name))return '';return /jacket|parka|hoodie|coat|blazer/i.test(name)?'Outerwear':/\bshorts\b/i.test(name)?'Shorts':/pants|trouser|jeans|chino|jogger/i.test(name)?'Trousers':/shirt|polo|tee|sweatshirt|sweater|cardigan|\bUT\b|tank|top/i.test(name)?'Tops':'Other';}
  function prices(text){return Array.from(String(text || '').matchAll(/(?:PHP(?:\s*\(Philippine Peso\))?|₱)\s*([\d,]+(?:\.\d{1,2})?)/gi)).map(function(m){return Number(m[1].replace(/,/g,''));});}
  function normalize(rows,checkedAt,now){
    now=now || Date.now();var at=Date.parse(checkedAt),today=new Date(now+8*3600000).toISOString().slice(0,10),items=[],campaigns=[],seen=new Set();
    if(!Number.isFinite(at) || at>now+300000 || now-at>4*86400000)return {items:items,campaigns:campaigns,importedAt:checkedAt};
    (rows || []).slice(0,120).forEach(function(r){var url=productUrl(r.url),name=clean(r.name).slice(0,140),d=dates(r.label || r.terms || ''),category=kind(name);if(!d && /^\d{4}-\d{2}-\d{2}$/.test(r.validFrom || '') && /^\d{4}-\d{2}-\d{2}$/.test(r.validTo || '')){var from=Date.parse(r.validFrom),to=Date.parse(r.validTo);if(Number.isFinite(from) && Number.isFinite(to) && new Date(from).toISOString().slice(0,10)===r.validFrom && new Date(to).toISOString().slice(0,10)===r.validTo && to>=from && to-from<=31*86400000)d={validFrom:r.validFrom,validTo:r.validTo};}
      if(!url || !name || !category || !d || d.validFrom>today || d.validTo<today || seen.has(url))return;
      var price=Number(r.price),original=Number(r.originalPrice);if(!(price>0 && price<=100000) || !(original>price && original<=500000))return;
      seen.add(url);var condition=clean(r.condition || [r.label,r.text].join(' ')).match(/App Member Exclusive|Color Size Limited Price|Limited Store/gi),terms=condition?Array.from(new Set(condition)).join(' · '):'';
      var u=new URL(url),row={id:'uniqlo-'+u.pathname.split('/').slice(-2).join('-')+(u.searchParams.get('colorDisplayCode')?'-'+u.searchParams.get('colorDisplayCode'):''),brand:'UNIQLO',retailer:'UNIQLO',name:name,url:url,category:category,price:price,originalPrice:original,validFrom:d.validFrom,validTo:d.validTo,checkedAt:checkedAt,channel:'online',currency:'PHP',availableSizes:null,sizeSystem:'Unverified',shipping:null,provenance:'browser-import'};
      if(root.ShoppingCore && root.ShoppingCore.imageUrl(r.image))row.image=root.ShoppingCore.imageUrl(r.image);
      if(terms)campaigns.push(Object.assign(row,{kind:'restricted',condition:terms+' · confirm eligibility and size price'}));else items.push(row);
    });return {items:items,campaigns:campaigns,importedAt:checkedAt};
  }
  function fromHtml(html,now){
    if(typeof html!=='string' || html.length>6000000)throw Error('The copied page is too large. Copy just the UNIQLO offer cards.');
    // Template contents stay detached and inert: pasted scripts, styles and
    // external resources are never attached to the live document or saved.
    var template=document.createElement('template');template.innerHTML=html;var rows=[];
    template.content.querySelectorAll('script,style,iframe,object,embed').forEach(function(n){n.remove();});
    template.content.querySelectorAll('a[href*="/ph/en/products/"]').forEach(function(a){var text=clean(a.textContent),label=a.getAttribute('aria-label') || text,nameNode=a.querySelector('h2,h3'),name=nameNode?nameNode.textContent:label.split(/,?\s*PHP|,?\s*₱/i)[0],all=prices(text),originalNode=a.querySelector('.strikethrough,del,s'),original=originalNode?prices(originalNode.textContent)[0]:all[1];rows.push({url:a.getAttribute('href'),name:name,label:label,text:text,price:prices(label)[0] || all[0],originalPrice:original,image:a.querySelector('img')?.getAttribute('src') || ''});});
    var result=normalize(rows,new Date(now || Date.now()).toISOString(),now);if(!result.items.length && !result.campaigns.length)throw Error('No current dated UNIQLO markdowns could be read. Open the men’s offers page, wait for the cards, press Ctrl+A then Ctrl+C, and paste here. Plain text alone loses product links; alternatively import a saved HTML page. Your saved offers have been kept.');return result;
  }
  function merge(feed,manual,now){feed=feed || {items:[],campaigns:[],sources:[]};if(!manual)return feed;var cleanImport=normalize([].concat(manual.items || [],manual.campaigns || []),manual.importedAt,now),valid=cleanImport.items.length+cleanImport.campaigns.length,merged=Object.assign({},feed);
    merged.items=(feed.items || []).filter(function(i){return !valid || i.brand!=='UNIQLO';}).concat(cleanImport.items);merged.campaigns=(feed.campaigns || []).filter(function(i){return !valid || i.brand!=='UNIQLO';}).concat(cleanImport.campaigns);
    merged.uniqloImport={importedAt:manual.importedAt,active:!!valid};
    merged.sources=(feed.sources || []).filter(function(i){return !valid || i.id!=='uniqlo';}).concat([{id:'uniqlo-manual',brand:'UNIQLO · browser import',url:OFFER_URL,status:valid?'imported':'expired',count:cleanImport.items.length,checkedAt:manual.importedAt,message:valid?'Imported separately on '+manual.importedAt+'. Size stock unverified; scheduled scans cannot overwrite this import.':'Saved import is stale or expired. Update UNIQLO to read current offers.'}]);return merged;
  }
  root.UniqloImport={OFFER_URL:OFFER_URL,normalize:normalize,fromHtml:fromHtml,merge:merge};
})(typeof window!=='undefined'?window:globalThis);
