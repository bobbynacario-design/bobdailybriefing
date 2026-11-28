(function(root){
  'use strict';
  var OFFER_URL='https://www.uniqlo.com/ph/en/feature/limited-offers/men';
  function clean(s){return String(s || '').replace(/\s+/g,' ').trim();}
  function productUrl(raw){try{var u=new URL(raw,'https://www.uniqlo.com');if(u.origin!=='https://www.uniqlo.com' || !/^\/ph\/en\/products\/E\d{6}-\d{3}\/\d{2}$/.test(u.pathname) || u.username || u.password)return '';var color=u.searchParams.get('colorDisplayCode');u.search='';if(color && /^\d{2}$/.test(color))u.searchParams.set('colorDisplayCode',color);return u.href;}catch(e){return '';}}
  function dates(text){var m=/(?:Limited Offer|Online \+ App-Member Price|App.Member Price) from (\d{1,2}) (\w{3}) [–—-] (\d{1,2}) (\w{3}) (\d{4})/i.exec(text);if(!m)return null;var months='jan feb mar apr may jun jul aug sep oct nov dec'.split(' '),sm=months.indexOf(m[2].toLowerCase()),em=months.indexOf(m[4].toLowerCase()),year=+m[5];if(sm<0 || em<0)return null;function day(y,month,d){var dt=new Date(Date.UTC(y,month,d));return dt.getUTCMonth()===month && dt.getUTCDate()===d?dt.toISOString().slice(0,10):'';}var from=day(year-(sm>em?1:0),sm,+m[1]),to=day(year,em,+m[3]);return from && to && from<=to && Date.parse(to)-Date.parse(from)<=31*86400000?{validFrom:from,validTo:to}:null;}
  function kind(name){if(/\b(sock|socks|bag|bags|cap|hat|belt|scarf|underwear)\b/i.test(name))return '';return /jacket|parka|hoodie|coat|blazer/i.test(name)?'Outerwear':/\bshorts\b/i.test(name)?'Shorts':/pants|trouser|jeans|chino|jogger/i.test(name)?'Trousers':/shirt|polo|tee|sweatshirt|sweater|cardigan|\bUT\b|tank|top/i.test(name)?'Tops':'Other';}
  function prices(text){return Array.from(String(text || '').matchAll(/(?:PHP(?:\s*\(Philippine Peso\))?|₱)\s*([\d,]+(?:\.\d{1,2})?)/gi)).map(function(m){return Number(m[1].replace(/,/g,''));});}
  function normalize(rows,checkedAt,now){
    now=now || Date.now();var at=Date.parse(checkedAt),today=new Date(now+8*3600000).toISOString().slice(0,10),items=[],campaigns=[],seen=new Set();
    // Each offer below is kept until its own published end date; the import as
    // a whole only has to be recent enough to belong to those offers.
    if(!Number.isFinite(at) || at>now+300000 || now-at>35*86400000)return {items:items,campaigns:campaigns,importedAt:checkedAt};
    (rows || []).slice(0,240).forEach(function(r){var url=productUrl(r.url),name=clean(r.name).slice(0,140),d=dates([r.label,r.text,r.terms].join(' ')),category=kind(name);if(!d && /^\d{4}-\d{2}-\d{2}$/.test(r.validFrom || '') && /^\d{4}-\d{2}-\d{2}$/.test(r.validTo || '')){var from=Date.parse(r.validFrom),to=Date.parse(r.validTo);if(Number.isFinite(from) && Number.isFinite(to) && new Date(from).toISOString().slice(0,10)===r.validFrom && new Date(to).toISOString().slice(0,10)===r.validTo && to>=from && to-from<=31*86400000)d={validFrom:r.validFrom,validTo:r.validTo};}
      var observedAt=r.checkedAt || checkedAt,observed=Date.parse(observedAt);if(!Number.isFinite(observed) || observed>now+300000 || now-observed>35*86400000)return;
      var evidence=clean([r.label,r.text,r.terms,name].join(' ')),timed=/Limited Offer|App.Member Price.*from/i.test(evidence),sale=!d && !timed && !r.validFrom && !r.validTo && (r.offerType==='sale' || /\bsale\b/i.test(evidence));
      if(!url || !name || !category || (!d && !sale) || d && (d.validFrom>today || d.validTo<today) || sale && now-observed>4*86400000 || /\b(?:women|kids|girls|boys)\b/i.test(evidence) && !/\bunisex\b/i.test(evidence) || seen.has(url))return;
      var price=Number(r.price),original=Number(r.originalPrice);if(!(price>0 && price<=100000) || !(original>price && original<=500000))return;
      seen.add(url);var condition=clean(r.condition || [r.label,r.text].join(' ')).match(/App Member Exclusive|Online \+ App-Member Price|App.Member Price|Color Size Limited Price|Limited Store/gi),terms=condition?Array.from(new Set(condition)).join(' · '):'';
      var u=new URL(url),row={id:'uniqlo-'+u.pathname.split('/').slice(-2).join('-')+(u.searchParams.get('colorDisplayCode')?'-'+u.searchParams.get('colorDisplayCode'):''),brand:'UNIQLO',retailer:'UNIQLO',name:name,url:url,category:category,price:price,originalPrice:original,validFrom:d?d.validFrom:'',validTo:d?d.validTo:'',offerType:sale?'sale':'limited',checkedAt:new Date(observed).toISOString(),channel:'online',currency:'PHP',availableSizes:null,sizeSystem:'Unverified',shipping:null,provenance:'browser-import'};
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
    var result=normalize(rows.slice(0,120),new Date(now || Date.now()).toISOString(),now);if(!result.items.length && !result.campaigns.length)throw Error('No current UNIQLO limited offers or sale markdowns could be read. Open the men’s offers or sale page, wait for the cards, press Ctrl+A then Ctrl+C, and paste here. Plain text alone loses product links; alternatively import a saved HTML page. Your saved offers have been kept.');return result;
  }
  function readRecord(record,now){
    now=now || Date.now();record=record || {};var groups=[record].concat(Array.isArray(record.batches)?record.batches:[]),byUrl=new Map(),latest='';
    // Pick the latest observed product before applying expiry, so an expired
    // replacement cannot reveal an older superseded quote from another batch.
    groups.forEach(function(g){
      if(Number.isFinite(Date.parse(g.importedAt)) && Date.parse(g.importedAt)<=now+300000 && g.importedAt>latest)latest=g.importedAt;
      [].concat(g.items || [],g.campaigns || []).forEach(function(r){var key=productUrl(r.url),observed=r.checkedAt || g.importedAt,at=Date.parse(observed),old=byUrl.get(key);
        if(!key || !Number.isFinite(at) || at>now+300000)return;
        if(new Date(at).toISOString()>latest)latest=new Date(at).toISOString();
        if(!old || at>=Date.parse(old.checkedAt))byUrl.set(key,Object.assign({},r,{checkedAt:new Date(at).toISOString()}));
      });
    });
    var rows=[];byUrl.forEach(function(r){var parsed=normalize([r],r.checkedAt,now);rows.push.apply(rows,parsed.items.concat(parsed.campaigns));});
    return {items:rows.filter(function(r){return !r.condition;}),campaigns:rows.filter(function(r){return !!r.condition;}),importedAt:latest};
  }
  function combine(previous,incoming,now){
    var next=readRecord(incoming,now);if(!next.items.length && !next.campaigns.length)throw Error('No current offers to save.');
    var merged=readRecord({batches:[previous || {}].concat(previous && Array.isArray(previous.batches)?previous.batches:[]).concat([next])},now);
    if(merged.items.length+merged.campaigns.length>240){var e=new Error('Your combined UNIQLO import holds up to 240 current offers. Import fewer cards or wait for older offers to expire. Your saved offers have been kept.');e.code='uniqlo-limit';throw e;}
    return merged;
  }
  function merge(feed,manual,now){feed=feed || {items:[],campaigns:[],sources:[]};if(!manual)return feed;var cleanImport=readRecord(manual,now),valid=cleanImport.items.length+cleanImport.campaigns.length,merged=Object.assign({},feed);
    var importedUrls=new Set(cleanImport.items.concat(cleanImport.campaigns).map(function(i){return productUrl(i.url);}));
    merged.items=(feed.items || []).filter(function(i){return !valid || i.brand!=='UNIQLO' || !importedUrls.has(productUrl(i.url));}).concat(cleanImport.items);merged.campaigns=(feed.campaigns || []).filter(function(i){return !valid || i.brand!=='UNIQLO' || !importedUrls.has(productUrl(i.url));}).concat(cleanImport.campaigns);
    merged.uniqloImport={importedAt:cleanImport.importedAt,active:!!valid};
    var dated=cleanImport.items.concat(cleanImport.campaigns).map(function(i){return i.validTo;}).filter(Boolean).sort(),saleCount=cleanImport.items.concat(cleanImport.campaigns).filter(function(i){return i.offerType==='sale';}).length;
    merged.sources=(feed.sources || []).filter(function(i){return !valid || i.id!=='uniqlo';}).concat([{id:'uniqlo-manual',brand:'UNIQLO · browser import',url:OFFER_URL,status:valid?'imported':'expired',count:cleanImport.items.length,checkedAt:cleanImport.importedAt,message:valid?'Imported separately on '+cleanImport.importedAt.slice(0,10)+'; '+(dated.length?'dated offers shown until each offer ends (latest '+dated.at(-1)+'). ':'')+(saleCount?saleCount+' undated sale items expire four days after import. ':'')+'Size stock unverified; scheduled scans cannot overwrite this import.':'The imported UNIQLO offers have ended or their sale prices need a fresh import. Update UNIQLO to read the current ones.'}]);return merged;
  }
  root.UniqloImport={OFFER_URL:OFFER_URL,normalize:normalize,fromHtml:fromHtml,readRecord:readRecord,combine:combine,merge:merge};
})(typeof window!=='undefined'?window:globalThis);
