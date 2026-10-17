import {load} from 'cheerio';
import {createHash} from 'node:crypto';
import {category} from './clothing.js';
const id=s=>createHash('sha256').update(s).digest('hex').slice(0,24);
const clean=s=>String(s || '').replace(/\s+/g,' ').trim();
const php=s=>{const m=clean(s).match(/(?:PHP|₱)\s*([\d,]+(?:\.\d{1,2})?)/i);return m?Number(m[1].replace(/,/g,'')):null;};
function urlOn(raw,host,path){try{const u=new URL(raw,host);return u.origin===host && u.pathname.startsWith(path)?u.href:'';}catch{return '';}}
function base(brand,retailer,name,url,checkedAt){return {id:id(retailer+':'+url),brand,retailer,name:clean(name).slice(0,140),url,checkedAt,channel:'online',currency:'PHP',availableSizes:null,sizeSystem:'Unverified',shipping:null};}
export function offerDates(text){
  const m=/Limited Offer from (\d{1,2}) (\w{3}) - (\d{1,2}) (\w{3}) (\d{4})/i.exec(text);
  if(!m)return null;
  const months='jan feb mar apr may jun jul aug sep oct nov dec'.split(' '),endYear=Number(m[5]),sm=months.indexOf(m[2].toLowerCase()),em=months.indexOf(m[4].toLowerCase());
  if(sm<0 || em<0)return null;
  const format=(y,month,d)=>{const date=new Date(Date.UTC(y,month,d));return date.getUTCMonth()===month && date.getUTCDate()===d?date.toISOString().slice(0,10):'';};
  const from=format(endYear-(sm>em?1:0),sm,Number(m[1])),to=format(endYear,em,Number(m[3]));
  return from && to && from<=to?{validFrom:from,validTo:to}:null;
}
export function parseUniqlo(html,checkedAt){
  const $=load(html),items=[],campaigns=[],seen=new Set(),today=new Date(Date.parse(checkedAt)+8*3600000).toISOString().slice(0,10);
  $('a.product-tile__link[href*="/ph/en/products/"]').each((_,node)=>{
    const a=$(node),name=clean(a.find('h2').first().text()),url=urlOn(a.attr('href'),'https://www.uniqlo.com','/ph/en/products/'),label=clean(a.attr('aria-label')),dates=offerDates(label+' '+a.text());
    const kind=category(name);
    if(!name || !url || !kind || seen.has(url) || !dates || dates.validFrom>today || dates.validTo<today)return;seen.add(url);
    const price=php(label),originalPrice=php(a.find('.strikethrough,del,s').first().text()),item={...base('UNIQLO','UNIQLO',name,url,checkedAt),...dates,category:kind,price,originalPrice,image:a.find('img[src*="imagesgoods"]').first().attr('src') || '',terms:label};
    // A size range printed on a tile is a range offered, not size stock.
    if(price>0 && originalPrice>price)items.push(item);else campaigns.push({...item,kind:'announcement',name:name+' · limited offer',terms:label+' · regular price and size stock are unverified.'});
  });return {items,campaigns};
}
export function parseAdidas(html,checkedAt){
  const $=load(html),items=[],seen=new Set();
  $('[data-testid="plp-product-card"]').each((_,node)=>{
    const a=$(node),name=clean(a.find('[data-testid="product-card-title"]').text()),subtitle=clean(a.find('[data-testid="product-card-subtitle"]').text()),url=urlOn(a.find('[data-testid="product-card-description-link"]').attr('href'),'https://www.adidas.com.ph','/'),price=php(a.find('[data-testid="main-price"]').text()),originalPrice=php(a.find('[data-testid="original-price"]').text()),kind=category(name);
    if(!name || !url || !/\/[A-Z0-9]{6}\.html(?:\?|$)/.test(url) || !/\bMen\b|Unisex/i.test(subtitle) || /women|kids/i.test(subtitle) || /sock|backpack|wristband|waist bag|\bcap\b/i.test(name) || !kind || !(price>0) || !(originalPrice>price) || seen.has(url))return;seen.add(url);
    items.push({...base('Adidas','Adidas',name,url,checkedAt),styleCode:new URL(url).pathname.split('/').at(-1).replace('.html',''),color:'',category:kind,price,originalPrice,image:a.find('[data-testid="product-card-primary-image"]').attr('src') || ''});
  });return {items,campaigns:[]};
}
export function parseZalora(html,checkedAt){
  const $=load(html),items=[],campaigns=[],seen=new Set(),brands={'ADIDAS':'Adidas','CROCS':'Crocs','NIKE':'Nike','H&M':'H&M','ZALORA':'ZALORA'};
  $('a[data-test-id="productLink"]').each((_,node)=>{
    const a=$(node),brand=brands[clean(a.find('[data-test-id="productBrandName"]').text()).toUpperCase()],name=clean(a.find('[data-test-id="productTitle"]').text()),url=urlOn(a.attr('href'),'https://www.zalora.com.ph','/p/');
    // Crocs makes footwear: "Crocband In White" names no garment, so it is not a top.
    const kind=category(name,'',brand==='Crocs'?'Footwear':'Other');
    if(!brand || !name || !url || !kind || seen.has(url) || /women|womens|kids|toddler|baby|girl|boy|sock|backpack|wristband|waist bag/i.test(name))return;seen.add(url);
    const originalPrice=php(a.find('[data-test-id="originalPrice"]').text()),current=a.find('[data-test-id="specialPrice"]'),price=php(current.text()),conditional=a.find('[data-test-id="voucherPill"]').length>0 || a.find('.vip-icon').length>0;
    const image=a.find('[data-test-id="productImages"] img').first().attr('src') || '',item={...base(brand,'ZALORA',name,url,checkedAt),category:kind,image,price,originalPrice,priceFrom:/\bFrom\b/i.test(current.text())};
    if(!conditional && price>0 && originalPrice>price)items.push(item);
    else if(conditional && originalPrice>0){
      const advertised=php(a.find('[data-test-id="voucherPill"]').text()),terms=clean(a.text()).slice(0,650);
      campaigns.push({...item,kind:'conditional',price:advertised || null,name:name+' · conditional offer',terms:'Voucher, member or payment conditions apply; the displayed price is not an unconditional item price. '+terms,validFrom:'',validTo:''});
    }
  });return {items,campaigns};
}
export function parseCrocsCollection(html,url,checkedAt){
  const $=load(html);$('script,style,header,footer,nav').remove();const title=clean($('h1').first().text());
  // A retailer's active Sale link is a lead, not proof that a campaign's
  // dates are current or every item in the collection is discounted.
  return {items:[],campaigns:title?[{id:id('crocs-collection:'+url),brand:'Crocs',retailer:'Crocs',name:title,url,checkedAt,kind:'collection',validFrom:'',validTo:'',terms:'Retailer-linked sale collection. Dates, item markdowns, eligible sizes and voucher conditions have not been verified. Do not treat its campaign name as a current date.'}]:[]};
}
export function parseRendered(source,html,checkedAt,url=source.url){
  return source.id==='uniqlo'?parseUniqlo(html,checkedAt):source.id==='adidas'?parseAdidas(html,checkedAt):source.id.startsWith('zalora')?parseZalora(html,checkedAt):source.id==='crocs'?parseCrocsCollection(html,url,checkedAt):{items:[],campaigns:[]};
}
