import {load} from 'cheerio';
import {createHash} from 'node:crypto';
import {ORIGINS} from './config.js';

// Airport codes used to reject domestic itineraries. Origin selection is explicit.
const PH = new Set('MNL CEB CRK DVO ILO KLO MPH PPS TAG TAC BCD CGY ZAM GES DGT BXU DRP LGP LAO TUG RXS CYZ CBO DPL PAG SJI IAO SUG USU WNP WNP BSO RZP ENI MBT TBH JOL TWT CYP DTI VRC WNP SFE BQA BPH CRM OMH SGS LWA MXI LBX'.split(' '));
const text = v => String(v || '').replace(/\s+/g,' ').trim();
const id = v => createHash('sha256').update(v).digest('hex').slice(0,20);
const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
export function dateValue(raw) {
  let y,m,d;
  let match = text(raw).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) [,y,m,d] = match;
  else if ((match=text(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [,d,m,y]=match;
  else if ((match=text(raw).match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/))) { [,d,m,y]=match; m=months[m.toLowerCase()]; }
  else return '';
  if (!m) return '';
  const value=String(y)+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10)===value ? value : '';
}
export function officialUrl(raw, sourceUrl) {
  try {
    const url=new URL(raw,sourceUrl), host=new URL(sourceUrl).hostname;
    const domain=host.split('.').slice(-2).join('.');
    return url.protocol==='https:' && !url.username && !url.password &&
      (url.hostname===domain || url.hostname.endsWith('.'+domain)) ? url.href : '';
  } catch { return ''; }
}
function airport(raw) { return text(raw).match(/\(([A-Z]{3})\)/)?.[1] || ''; }
function outsidePH(code) { return /^[A-Z]{3}$/.test(code) && !PH.has(code); }
function parseDates(raw) {
  const tokens=text(raw).replace(/^Depart:\s*/i,'').split(/\s+-\s+/);
  return {departureDate:dateValue(tokens[0]),returnDate:tokens[1] ? dateValue(tokens[1]) : ''};
}
function cleanName(raw) { return text(raw).replace(/\s*\([A-Z]{3}\).*$/,''); }
export function parseFares(html, source, checkedAt) {
  const $=load(html), records=[], seen=new Set();
  $('[data-test="destination-text"]').each((i,element)=>{
    let card=$(element).parent();
    while(card.length && card[0].tagName!=='html') {
      if(card.find('[data-test="destination-text"]').length>1) return;
      if(card.find('[data-test="origin-text"]').length===1 && card.find('[data-test="price"]').length===1) break;
      card=card.parent();
    }
    if(!card.length || card[0].tagName==='html') return;
    const originText=card.find('[data-test="origin-text"]').text(), destinationText=$(element).text();
    const origin=airport(originText),destination=airport(destinationText);
    if(!ORIGINS.includes(origin) || !outsidePH(destination)) return;
    const dates=parseDates(card.find('[data-test="dates"],[data-test="departing-text"]').first().text());
    if(!dates.departureDate || dates.departureDate<checkedAt.slice(0,10) || (dates.returnDate && dates.returnDate<dates.departureDate)) return;
    const quote=text(card.find('[data-test="price"]').text());
    const priceMatch=quote.match(/\b([A-Z]{3})\s*([\d,]+(?:\.\d{1,2})?)(?:\s*\*|\s*$)/);
    if(!priceMatch) return;
    const currency=priceMatch[1],amount=Number(priceMatch[2].replace(/,/g,''));
    if(!Number.isFinite(amount) || amount<=0) return;
    const tripText=text(card.find('[data-test="flight-type"]').text());
    const tripType=/round[ -]?trip/i.test(tripText) ? 'round-trip' : /one[ -]?way/i.test(tripText) ? 'one-way' : '';
    // Never turn a missing return leg or unknown journey basis into a priced trip.
    if(!tripType || (tripType==='round-trip' && !dates.returnDate)) return;
    const cabin=text(card.find('[data-test="travel-class"]').text()) || 'Not stated';
    let bookingUrl=source.url;
    card.find('a[href]').each((i,a)=>{const safe=officialUrl($(a).attr('href'),source.url);if(safe)bookingUrl=safe;});
    const key=[source.airline,origin,destination,dates.departureDate,dates.returnDate,tripType,cabin,currency].join('|');
    if(seen.has(key)) return;seen.add(key);
    records.push({id:id(key),kind:'advertised-fare',airline:source.airline,origin,destination,
      originName:cleanName(originText),destinationName:cleanName(destinationText),...dates,tripType,cabin,currency,amount,
      priceLabel:quote,priceBasis:'Advertised from fare; availability and final total need confirmation',
      fees:source.airline==='Philippine Airlines' ? 'Airline states taxes, fees and surcharges included; Philippine travel tax excluded.' : 'Check taxes, fees and Philippine travel tax on the airline.',
      baggage:'Confirm baggage allowance for the selected fare.',connections:'Confirm stops and connection times on the airline.',
      bookingEnd:'',travelPeriod:'Exact sample dates shown; other dates may cost more.',sourceUrl:source.url,bookingUrl,checkedAt,
      airlineSeen:text(card.find('[data-test="last-seen"]').text()),terms:'Displayed fares may no longer be available. Check fare conditions, baggage, changes and refunds before booking.'});
  });
  return records;
}
export function parseAirAsiaPromos(html, source, checkedAt) {
  const $=load(html), records=[], seen=new Set();
  $('.carousel-card').each((i,element)=>{
    const card=$(element), body=text(card.text());
    const discount=body.match(/(?:Up to\s*)?\d{1,2}%\s*OFF/i)?.[0];
    if(!discount) return;
    const anchors=card.find('a[href]').toArray();
    for(const anchor of anchors) {
      const bookingUrl=officialUrl($(anchor).attr('href'),source.url);
      if(!bookingUrl) continue;
      const u=new URL(bookingUrl),origin=u.searchParams.get('origin'),destination=u.searchParams.get('destination');
      if(!ORIGINS.includes(origin) || !outsidePH(destination)) continue;
      const key=[source.airline,origin,destination,discount].join('|');if(seen.has(key))continue;seen.add(key);
      const label=text(card.find('[aria-label]').first().attr('aria-label'));
      const destinationName=label.split(/\s+Fly from\s+/i)[0] || destination;
      // Hidden aria-label numbers are not a visible fare quote and are never used as prices.
      records.push({id:id(key),kind:'promo',airline:source.airline,origin,destination,originName:origin==='MNL'?'Manila':origin==='CEB'?'Cebu':'Clark',destinationName,
        title:discount,amount:null,currency:'',tripType:'not-stated',cabin:'Not stated',departureDate:'',returnDate:'',
        discount,priceBasis:'Discount campaign; final fare not quoted',bookingEnd:'',travelPeriod:'Travel dates and booking deadline not verified on this page.',
        fees:'Check taxes, fees and Philippine travel tax.',baggage:'Confirm baggage allowance.',connections:'Confirm stops and connection times.',
        sourceUrl:source.url,bookingUrl,checkedAt,airlineSeen:'',terms:'Listed on the airline promo page. Terms, dates and availability must be checked before relying on this offer.'});
    }
  });
  return records;
}
export function parseSource(html, source, checkedAt) {
  const items=source.type==='fares' ? parseFares(html,source,checkedAt) : source.id==='airasia-ph' ? parseAirAsiaPromos(html,source,checkedAt) : [];
  const blocked=/sec-if-cpt|captcha|access denied|verify you are human/i.test(html);
  return {items,status:items.length ? 'ok' : 'unavailable',message:items.length ? items.length+' international offers read' : blocked ?
    'Airline page requires an interactive browser; no fares extracted.' : 'No readable international offers with verified route and fare fields. Check the airline directly.'};
}
