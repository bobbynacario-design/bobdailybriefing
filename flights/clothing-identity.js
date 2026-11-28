import {load} from 'cheerio';
import '../lib/shopping-identity.js';
const I=globalThis.ShoppingIdentity;
export function catalogueIdentity(brand,product,variant){
  const $=load(product.body_html || '');$('script,style').remove();$('br').replaceWith('\n');$('p,li,div').append('\n');const text=$('body').text();
  const styleAt=(product.options || []).findIndex(o=>/^(?:style|product code|article number)$/i.test(o.name || ''));
  const labelled=[...text.matchAll(/\b(?:Product Code|Style(?: Code)?|Article(?: Number)?)\s*:\s*([A-Z0-9-]+)/gi)].map(m=>m[1]);
  const ending=/(?:\||\()\s*([A-Z0-9-]+)\)?\s*$/i.exec(product.title || '')?.[1];
  const sku=/^([A-Z0-9]{6}(?:-\d{3})?)(?=[_ /]|$)/i.exec(variant?.sku || '')?.[1];
  const codes=[...new Set([ending,...labelled,styleAt<0?'':variant?.['option'+(styleAt+1)],sku].map(s=>I.code(brand,s)).filter(Boolean))];
  const color=/\bColou?r\s*:\s*([^\n]{1,90})/i.exec(text)?.[1]?.split(/\s+(?:Gender|Product Code|Material|Size|Style)\s*:/i)[0]?.trim() || '';
  return {...(codes.length===1?{styleCode:codes[0]}:{}),...(color?{publishedColor:color}:{})};
}
