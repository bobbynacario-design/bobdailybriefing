import {load} from 'cheerio';
import {createHash} from 'node:crypto';
export const SOURCES=[
  {id:'hm',brand:'H&M',url:'https://www2.hm.com/en_ph/men/sale/view-all.html'},
  {id:'uniqlo',brand:'UNIQLO',browser:true,url:'https://www.uniqlo.com/ph/en/feature/limited-offers/men'},
  {id:'nike',brand:'Nike',url:'https://www.nike.com/ph/w/mens-sale-3yaepz8nb9wznik1'},
  {id:'adidas',brand:'Adidas',browser:true,url:'https://www.adidas.com.ph/men-deals-outlet'},
  {id:'crocs',brand:'Crocs',browser:true,url:'https://crocs.com.ph/collections/shop-sale',fetchUrl:'https://crocs.com.ph/collections/shop-sale/products.json?limit=100'},
  {id:'zalora-adidas',brand:'ZALORA · Adidas',browser:true,url:'https://www.zalora.com.ph/c/men/adidas/b-678'},
  {id:'zalora-crocs',brand:'ZALORA · Crocs',browser:true,url:'https://www.zalora.com.ph/c/men/crocs/b-378'},
  {id:'zalora-nike',brand:'ZALORA · Nike',browser:true,url:'https://www.zalora.com.ph/c/men/nike/b-126'},
  {id:'zalora-hm',brand:'ZALORA · H&M',browser:true,url:'https://www.zalora.com.ph/c/men/hm/b-6777'},
  // Shopify stores publish their storefront catalogue as JSON, per collection.
  {id:'levis',brand:"Levi's",shopify:true,url:'https://www.levi.com.ph/collections/men-sale'},
  {id:'underarmour',brand:'Under Armour',shopify:true,url:'https://www.underarmour.com.ph/collections/men'},
  {id:'penshoppe',brand:'Penshoppe',shopify:true,url:'https://www.penshoppe.com/collections/sale'},
  {id:'sm',brand:'Mall promotions',url:'https://www.smsupermalls.com/smdeals'}
];
const id=s=>createHash('sha256').update(s).digest('hex').slice(0,24);
// Whole words only, and the product name decides before a retailer's category
// code: H&M files polos and T-shirts under "..._shortsleeve", which a bare
// /shorts/ read as Shorts. '' means an accessory or care item, not clothing.
const ACCESSORY=/\b(?:laces|socks?|bags?|backpacks?|wallets?|belts?|caps?|hats?|beanies?|scarf|scarves|sunglasses|jibbitz|charms?|wristbands?|repair patch(?:es)?|hemming|bottles?|umbrellas?)\b/i;
const KINDS=[
  ['Footwear',/\b(?:shoes?|sneakers?|trainers?|clogs?|sandals?|slides?|flip[- ]?flops?|flips?|boots?|loafers?|mules?|slip-ons?|espadrilles?)\b/i],
  ['Shorts',/\bshorts\b/i],
  ['Trousers',/\b(?:trousers?|jeans|pants|chinos?|joggers?|sweatpants|trackpants|cargos?)\b/i],
  ['Outerwear',/\b(?:jackets?|coats?|hoodies?|blazers?|parkas?|windbreakers?|overshirts?|gilets?)\b/i],
  ['Tops',/\b(?:shirts?|t-shirts?|tees?|polos?|tops?|tanks?|sweaters?|sweatshirts?|jumpers?|cardigans?|henleys?|jerseys?)\b/i]
];
export function category(name,hint='',fallback='Other'){
  if(ACCESSORY.test(name))return '';
  for(const text of [name,String(hint || '').replace(/_/g,' ')])for(const [kind,re] of KINDS)if(re.test(text))return kind;
  return fallback;
}
export function parseHM(html,checkedAt){
  const $=load(html);let data;try{data=JSON.parse($('#__NEXT_DATA__').text());}catch{return [];}
  const rows=data?.props?.pageProps?.plpProps?.productListingSectionProps?.productListingData?.rawProductList || [];
  return rows.flatMap(p=>{
    const price=p.prices?.find(x=>x.priceType==='redPrice')?.price,originalPrice=p.prices?.find(x=>x.priceType==='whitePrice')?.price;
    if(p.removed || p.availability?.comingSoon || p.availability?.stockState!=='Available' || !Number.isFinite(price) || !(originalPrice>price))return [];
    let url;try{url=new URL(p.url,'https://www2.hm.com');}catch{return [];}
    if(url.origin!=='https://www2.hm.com' || !url.pathname.startsWith('/en_ph/productpage.'))return [];
    // H&M stock code 2 is explicitly available in the public listing. Other
    // codes are not guessed to mean stock. Listing availability isn't a hold.
    const sizes=Array.isArray(p.sizes)?p.sizes.filter(s=>s.stock===2).map(s=>String(s.label)):null;
    // The whole run, stocked or not, tells a line cut in even waists only
    // (28/30/32) from a sold-out 31.
    const sizeRun=Array.isArray(p.sizes)?[...new Set(p.sizes.map(s=>String(s.label)))]:null;
    if(sizes && !sizes.length)return [];
    // The men's sale page also lists kids' care items and men's accessories.
    const code=String(p.mainCatCode || ''),kind=category(String(p.productName || ''),code);
    if(code && (!code.startsWith('men_') || code.startsWith('men_accessories')) || !kind)return [];
    return [{id:id('hm:'+p.id),brand:'H&M',name:String(p.productName || '').slice(0,140),color:String(p.colorName || '').slice(0,60),category:kind,image:p.productImage || '',price,originalPrice,currency:'PHP',url:url.href,checkedAt,channel:'online',availableSizes:sizes,...(sizeRun?{sizeRun}:{}),sizeSystem:'Labelled clothing',shipping:null}];
  });
}
export function parseCrocs(body,checkedAt){
  let data;try{data=JSON.parse(body);}catch{return [];}
  return (data.products || []).flatMap(p=>{
    if(/women|kids|toddler|jibbitz|charm/i.test(p.title))return [];
    // Keep each available men's variant separate: color and size can change
    // price. A collection called Sale is not proof of a markdown.
    return (p.variants || []).flatMap(v=>{
      const size=/\bM(\d+(?:\.\d+)?)(?=W|\b)/i.exec([v.option1,v.option2,v.option3].join(' '));
      const price=Number(v.price),originalPrice=Number(v.compare_at_price);
      if(!size || v.available!==true || !(price>0) || !(originalPrice>price))return [];
      return [{id:id('crocs:'+v.id),brand:'Crocs',name:String(p.title).slice(0,140),color:String(v.title || '').slice(0,80),category:'Footwear',price,originalPrice,currency:'PHP',url:'https://crocs.com.ph/products/'+encodeURIComponent(p.handle)+'?variant='+v.id,checkedAt,channel:'online',availableSizes:[size[1]],sizeSystem:'US men',shipping:null}];
    });
  });
}
export function parseNike(html,checkedAt){
  const $=load(html);let data;try{data=JSON.parse($('#__NEXT_DATA__').text());}catch{return [];}
  const groups=data?.props?.pageProps?.initialState?.Wall?.productGroupings || [];
  const seen=new Set();
  return groups.flatMap(g=>g.products || []).flatMap(p=>{
    const name=p.copy?.title,subtitle=p.copy?.subTitle || '',price=p.prices?.currentPrice,originalPrice=p.prices?.initialPrice;
    if(!name || /women|kids|baby|toddler|girl|boy/i.test(subtitle) || p.prices?.currency!=='PHP' || !(price>0) || !(originalPrice>price) || seen.has(p.productCode))return [];
    let url;try{url=new URL(p.pdpUrl?.url);}catch{return [];}
    if(url.origin!=='https://www.nike.com' || !url.pathname.startsWith('/ph/t/'))return [];seen.add(p.productCode);
    // Nike's subtitle names the garment ("Men's Golf Polo"); the title often doesn't.
    const kind=p.productType==='FOOTWEAR'?'Footwear':category(name+' '+subtitle);if(!kind)return [];
    return [{id:id('nike:'+p.productCode),brand:'Nike',name:String(name+' · '+subtitle).slice(0,140),color:String(p.displayColors?.colorDescription || '').slice(0,90),category:kind,image:p.colorwayImages?.portraitURL || '',price,originalPrice,currency:'PHP',url:url.href,checkedAt,channel:'online',availableSizes:null,sizeSystem:'Unverified',shipping:null}];
  });
}
// One listing per men's product colour with a marked-down size in stock online.
// compare_at_price is the struck-through price the store itself shows; a
// variant without one is full price, whatever collection it sits in.
const SHOPIFY_SKIP=/\b(?:wallets?|purses?|bags?|backpacks?|sackpacks?|slings?|duffle|totes?|caps?|hats?|visors?|socks?|belts?|underwear|boxers?|briefs?|fragrances?|giftsets?|hair|bath|home care|eyewear|sunglasses|gloves?|headbands?|bottles?|travel kit|school|leggings?|tights|bras?|accessor(?:y|ies))\b/i;
const NOT_MEN=/\b(?:women'?s?|ladies|girls?|boys?|kids?|youth|toddlers?|baby|infants?)\b/i;
// Levi's tags each product with a colour family ("Black", "Dark Indigo", "Multicolour").
const SHOP_COLORS=['White','Cream','Beige','Black','Grey','Gray','Navy','Blue','Brown','Burgundy','Green','Red','Khaki','Olive','Tan','Dark Indigo','Medium Indigo','Light Indigo','Neutral','Multicolour'];
// Under Armour writes SM/MD/LG, Penshoppe "SIZE 30", trousers "30/32" or
// "3032" (waist then leg), and unisex shoes "7/8.5" (men's first).
function shopSize(raw,{waist,footwear}){
  const s=String(raw || '').trim().toUpperCase().replace(/^SIZE\s+/,'');if(s==='DEFAULT TITLE')return '';
  if(footwear)return /^(\d{1,2}(?:\.5)?)(?:\/\d{1,2}(?:\.5)?)?$/.exec(s)?.[1] || '';
  if(waist)return /^\d{2}$/.test(s)?s:'';
  return /^(\d{2})(?:\/\d{2}|\d{2})$/.exec(s)?.[1] || {SM:'S',MD:'M',LG:'L'}[s] || s;
}
export function parseShopify(source,products,checkedAt){
  const host=new URL(source.url).origin,rows=[];
  for(const p of products || []){
    const type=String(p.product_type || ''),tags=Array.isArray(p.tags)?p.tags:[],title=String(p.title || '');
    if(!/\b(?:men'?s?|mens|unisex)\b/i.test(title+' '+type) || NOT_MEN.test(title+' '+type) || SHOPIFY_SKIP.test(type) || SHOPIFY_SKIP.test(title))continue;
    const name=title.replace(/^(?:Levi's®?|UA)\s+/i,'').replace(/^(?:Men'?s?|Mens)\s+/i,'').replace(/\s*\|\s*[\w-]+$/,'').slice(0,140);
    let kind=category(name,type,'');if(kind==='')kind=category(name,tags.join(' '),'');
    if(!kind)continue;
    const opts=(p.options || []).map(o=>String(o.name || '')),at=re=>opts.findIndex(n=>re.test(n));
    const colorAt=at(/colou?rs?/i),waistAt=at(/^waist$/i),sizeAt=waistAt>=0?waistAt:at(/size|^title$/i),footwear=kind==='Footwear';
    const value=(v,i)=>i<0?'':String(v['option'+(i+1)] || '');
    const sizeSystem=footwear?(/\bUS\b/i.test(opts[sizeAt] || '')?'US men':'Unverified'):sizeAt<0?'Unverified':/\bUS\b/i.test(opts[sizeAt])?'US clothing':'Labelled clothing';
    // A store without a colour option (Levi's) files one colour per product and tags it.
    const tagColors=tags.filter(t=>SHOP_COLORS.some(c=>c.toLowerCase()===t.toLowerCase()));
    const groups=new Map();
    for(const v of p.variants || []){const c=value(v,colorAt).replace(/\s*-\s*\d{3}$/,'');if(!groups.has(c))groups.set(c,[]);groups.get(c).push(v);}
    const made=[];
    for(const [color,variants] of groups){
      const size=v=>sizeAt<0?'':shopSize(value(v,sizeAt),{waist:waistAt>=0,footwear});
      const deals=variants.filter(v=>v.available===true && Number(v.price)>0 && Number(v.compare_at_price)>Number(v.price));
      if(!deals.length)continue;
      const best=deals.reduce((m,v)=>Number(v.price)<Number(m.price)?v:m),price=Number(best.price),originalPrice=Number(best.compare_at_price);
      const sizeRun=[...new Set(variants.map(size).filter(Boolean))],availableSizes=[...new Set(deals.map(size).filter(Boolean))];
      if(footwear && sizeAt>=0 && !availableSizes.length)continue;
      const image=best.featured_image?.src || p.images?.[0]?.src || '';
      made.push({id:id(source.id+':'+p.id+':'+color),brand:source.brand,name,color:(color || tagColors[0] || '').slice(0,80),category:kind,image,price,originalPrice,currency:'PHP',url:host+'/products/'+encodeURIComponent(p.handle)+'?variant='+best.id,checkedAt,channel:'online',availableSizes:sizeAt<0 || !availableSizes.length?null:availableSizes,...(sizeRun.length?{sizeRun}:{}),sizeSystem,shipping:null,...(deals.some(v=>Number(v.price)!==price)?{priceFrom:true}:{})});
    }
    // Three colours of one product at most, deepest markdown first.
    rows.push(...made.sort((a,b)=>a.price/a.originalPrice-b.price/b.originalPrice).slice(0,3));
  }
  return rows.sort((a,b)=>a.price/a.originalPrice-b.price/b.originalPrice).slice(0,source.max || 45);
}
export function mallCandidates(html){const $=load(html);return [...new Set($('a[href]').map((_,e)=>{const a=$(e),text=a.text()+' '+(a.find('img').attr('alt') || '');if(!/uniqlo|h\s*&\s*m|nike|adidas|crocs|zalora/i.test(text))return null;try{const u=new URL(a.attr('href'),'https://www.smsupermalls.com');return u.origin==='https://www.smsupermalls.com' && u.pathname.startsWith('/smdeals/')?(u.search='',u.href):null;}catch{return null;}}).get().filter(Boolean))].slice(0,8);}
export function parseMall(html,url,checkedAt){
  const $=load(html);$('script,style,header,footer,nav').remove();const main=$('main').length?$('main'):$('body');const text=main.text().replace(/\s+/g,' '),title=main.find('h1').first().text().trim();
  const brand=/uniqlo|h\s*&\s*m|nike|adidas|crocs|zalora/i.exec(title)?.[0];
  const end=/Valid (?:Until|To)\s+(\w+ \d{1,2},? \d{4})/i.exec(text)?.[1],start=/Valid From\s+(\w+ \d{1,2},? \d{4})/i.exec(text)?.[1];
  const iso=s=>{const d=new Date(s+' 12:00:00 GMT+0800');return Number.isFinite(d.getTime())?new Date(d.getTime()+8*3600000).toISOString().slice(0,10):'';};
  const validTo=end?iso(end):'',validFrom=start?iso(start):'',today=new Date(Date.parse(checkedAt)+8*3600000).toISOString().slice(0,10);
  if(!brand || !validTo || validTo<today || validFrom && validFrom>today)return [];
  // Participating malls must be in the deal's main content, not the site's
  // global mall directory/footer. No branch stock or brand-wide price claim.
  const branches=[['SM City North Edsa','Quezon City'],['SM City Fairview','Quezon City'],['SM Megamall','Ortigas'],['SM Makati','Makati'],['SM Mall of Asia','Pasay']];
  const participation=/(?:Participating Malls|Available at|Participating Branches)\s*:?\s*(.{1,1800})/i.exec(text)?.[1]?.split(/Related Deals|Other Deals|Terms and Conditions|Recommended|See Also/i)[0] || '';
  return branches.filter(([name])=>participation.toLowerCase().includes(name.toLowerCase())).map(([branch,area])=>({id:id(url+branch),brand:brand.toLowerCase().replace(/\s/g,'')==='h&m'?'H&M':SOURCES.find(s=>s.brand.toLowerCase()===brand.toLowerCase())?.brand || brand,name:title.slice(0,180),branch,area,validFrom,validTo,url,checkedAt,channel:'store',terms:text.slice(0,900)}));
}
export async function readSource(source,checkedAt,fetchImpl=fetch){
  try{
    const get=async url=>{
      const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(18000),headers:{accept:'text/html,application/json','user-agent':'DaybookClothingScout/1.0 (public sale listings)'}});
      if(!r.ok)throw Error('HTTP '+r.status);
      const text=await r.text();if(text.length>4000000)throw Error('Page exceeded reader limit');return text;
    };
    if(source.shopify){
      // Up to four pages of 100 products; a short page is the last one.
      const products=[];
      for(let page=1;page<=4;page++){const rows=JSON.parse(await get(source.url+'/products.json?limit=100&page='+page)).products || [];products.push(...rows);if(rows.length<100)break;}
      const items=parseShopify(source,products,checkedAt);
      return {...source,checkedAt,status:items.length?'ok':'unpriced',count:items.length,items,candidates:[],message:items.length?'PHP markdowns read from the store’s public catalogue ('+products.length+' products); sizes are those in stock online.':'No marked-down men’s items read from '+products.length+' products. Open the official page to check.'};
    }
    const text=await get(source.fetchUrl || source.url);
    const items=source.id==='hm'?parseHM(text,checkedAt):source.id==='crocs'?parseCrocs(text,checkedAt):source.id==='nike'?parseNike(text,checkedAt):[];
    return {...source,checkedAt,status:items.length?'ok':source.id==='sm'?'checked':'unpriced',count:items.length,items,candidates:source.id==='sm'?mallCandidates(text):[],message:items.length?'Published PHP markdowns read; checkout and size need rechecking.':'No usable product markdowns read. Open the official page to check; this does not mean there are no deals.'};
  }catch(e){return {...source,checkedAt,status:'unavailable',count:0,items:[],candidates:[],message:e.message.startsWith('HTTP')?e.message+'; official page remains available to check manually.':'Page timed out or could not be read; no bypass attempted.'};}
}
export function priceHistory(items,prior,checkedAt){
  const day=checkedAt.slice(0,10),cut=new Date(Date.parse(checkedAt)-30*86400000).toISOString().slice(0,10),history={};
  for(const [key,rows] of Object.entries(prior || {})){const keep=rows.filter(r=>r.day>=cut && r.day<=day && r.price>0).slice(-30);if(keep.length)history[key]=keep;}
  // Compare with earlier days only: a same-day rerun replaces today's row.
  // priorLowAt is the latest day the low was seen ("Was ₱990 on 13 Oct").
  const updated=items.map(i=>{const before=(history[i.id] || []).filter(r=>r.day!==day),last=before[before.length-1];
    const low=before.reduce((m,r)=>!m || r.price<=m.price?r:m,null),high=Math.max(...before.map(r=>r.price));
    const out={...i,firstSeen:before[0]?.at || checkedAt,checks:before.length,...(last?{previousPrice:last.price,previousChecked:last.at,priorLow:low.price,priorLowAt:low.at,priorHigh:high}:{})};
    history[i.id]=before.concat({day,price:i.price,at:checkedAt});return out;});
  // Bound the shared history document independently of retailer growth.
  const keep=Object.keys(history).sort((a,b)=>history[b].at(-1).at.localeCompare(history[a].at(-1).at)).slice(0,400);
  return {items:updated,history:Object.fromEntries(keep.map(k=>[k,history[k]]))};
}
