import {load} from 'cheerio';
import {createHash} from 'node:crypto';
import {ORIGINS,DOMESTIC} from './config.js';
import {parseCebuCampaigns} from './campaigns.js';
import {HOTEL_CITIES} from './hotel-cities.js';

// Domestic fares are limited to the three requested destinations.
const PH = new Set('MNL CEB CRK DVO ILO KLO MPH PPS TAG TAC BCD CGY ZAM GES DGT BXU DRP LGP LAO TUG RXS CYZ CBO DPL PAG SJI IAO SUG USU WNP WNP BSO RZP ENI MBT TBH JOL TWT CYP DTI VRC WNP SFE BQA BPH CRM OMH SGS LWA MXI LBX'.split(' '));
// Budget-airline pages give only airport codes; name them by city (the first
// city listing an airport wins), so DMK and BKK both read as Bangkok.
const AIRPORT_CITY = {};
HOTEL_CITIES.forEach(c => c.airports.forEach(a => { if (!AIRPORT_CITY[a]) AIRPORT_CITY[a] = c.city; }));
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
    if(!ORIGINS.includes(origin) || !(outsidePH(destination) || DOMESTIC[destination])) return;
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
      originName:cleanName(originText),destinationName:DOMESTIC[destination] || cleanName(destinationText),...dates,tripType,cabin,currency,amount,
      priceLabel:quote,priceBasis:'Advertised from fare; availability and final total need confirmation',
      taxesIncluded:source.airline==='Philippine Airlines' ? true : null,travelTaxIncluded:DOMESTIC[destination] ? null : source.airline==='Philippine Airlines' ? false : null,checkedBaggageIncluded:null,stops:null,
      fees:DOMESTIC[destination] ? 'Domestic flight: Philippine international travel tax does not apply. Confirm taxes and fees on the airline.' : source.airline==='Philippine Airlines' ? 'Airline states taxes, fees and surcharges included; Philippine travel tax excluded.' : 'Check taxes, fees and Philippine travel tax on the airline.',
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
      if(!ORIGINS.includes(origin) || !(outsidePH(destination) || DOMESTIC[destination])) continue;
      const key=[source.airline,origin,destination,discount].join('|');if(seen.has(key))continue;seen.add(key);
      const label=text(card.find('[aria-label]').first().attr('aria-label'));
      const destinationName=label.split(/\s+Fly from\s+/i)[0] || destination;
      // Hidden aria-label numbers are not a visible fare quote and are never used as prices.
      records.push({id:id(key),kind:'promo',airline:source.airline,origin,destination,originName:origin==='MNL'?'Manila':origin==='CEB'?'Cebu':'Clark',destinationName:DOMESTIC[destination] || destinationName,
        title:discount,amount:null,currency:'',tripType:'not-stated',cabin:'Not stated',departureDate:'',returnDate:'',
        discount,priceBasis:'Discount campaign; final fare not quoted',bookingEnd:'',travelPeriod:'Travel dates and booking deadline not verified on this page.',
        fees:DOMESTIC[destination] ? 'Domestic flight: Philippine international travel tax does not apply. Confirm taxes and fees on the airline.' : 'Check taxes, fees and Philippine travel tax.',baggage:'Confirm baggage allowance.',connections:'Confirm stops and connection times.',
        sourceUrl:source.url,bookingUrl,checkedAt,airlineSeen:'',terms:'Listed on the airline promo page. Terms, dates and availability must be checked before relying on this offer.'});
    }
  });
  return records;
}
export function parseSource(html, source, checkedAt) {
  const items=source.type==='trip-fares' ? parseTripFares(html,source,checkedAt) : source.type==='airasia-fares' ? parseAirAsiaFares(html,source,checkedAt) : source.type==='fares' ? parseFares(html,source,checkedAt) : source.id==='airasia-ph' ? parseAirAsiaPromos(html,source,checkedAt) : source.airline==='Cebu Pacific' ? parseCebuCampaigns(html,source,checkedAt) : [];
  const blocked=/sec-if-cpt|captcha|access denied|verify you are human/i.test(html);
  if(source.type==='campaign-feed' && !items.length && !blocked && /<rss\b/i.test(html) && /<channel>/i.test(html))return {items,status:'ok',message:'No current eligible sale announcements in the readable feed.'};
  const legs=items.filter(d=>d.kind==='return-leg').length;
  if(legs) return {items,status:'ok',message:legs+' return '+(legs===1?'leg':'legs')+' read for round-trip pairing'+(items.length>legs ? ' · '+(items.length-legs)+' eligible offers read' : '')};
  return {items,status:items.length ? 'ok' : 'unavailable',message:items.length ? items.length+(source.type==='campaign-feed'?' sale announcements read; route availability not verified':' eligible offers read') : blocked ?
    'Airline page requires an interactive browser; no fares extracted.' : 'No readable eligible offers with verified route and fare fields. Check the airline directly.'};
}

export function parseTripFares(html,source,checkedAt) {
  const $=load(html),out=[];$('script,style').remove();
  const asOf=$.text().match(/flight prices found on Trip\.com as of ([A-Za-z]{3}) (\d{1,2}), (\d{4})/);
  const sourceDay=asOf && dateValue(asOf[2]+' '+asOf[1]+' '+asOf[3]);
  if(!sourceDay || Date.parse(sourceDay+'T00:00:00+08:00')>Date.parse(checkedAt) || Date.parse(checkedAt)-Date.parse(sourceDay+'T00:00:00+08:00')>26*3600000)return [];
  const observedDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(checkedAt));
  const parts=Object.fromEntries(observedDay.map(p=>[p.type,p.value]));
  const today=parts.year+'-'+parts.month+'-'+parts.day;
  $('._tp-card').each((_,element)=>{
    const card=$(element),bookingUrl=officialUrl(card.find('a[test-item="view_button"]').attr('href'),source.url);
    if(!bookingUrl)return;const p=new URL(bookingUrl).searchParams;
    const origin=(p.get('departcitycode')||'').toUpperCase(),destination=(p.get('arrivalcitycode')||'').toUpperCase();
    const departureDate=dateValue(p.get('ddate')),returnDate=p.get('flighttype')==='d'?dateValue(p.get('rdate')):'';
    if(!ORIGINS.includes(origin) || !(outsidePH(destination)||DOMESTIC[destination]) || !departureDate || departureDate<=today || !['s','d'].includes(p.get('flighttype')) || p.get('flighttype')==='d'&&(!returnDate||returnDate<=departureDate))return;
    const body=text(card.text()),info=text(card.find('._tp-info').text()),prices=[...body.matchAll(/\bPHP\s+([\d,]+(?:\.\d{1,2})?)/g)];
    const operator=card.find('[data-tp-full-name]').attr('data-tp-full-name');
    const airline=operator==='Cebu Pacific'?'Cebu Pacific':operator==='Philippines AirAsia'?'AirAsia':operator==='Philippine Airlines'?'Philippine Airlines':operator==='Scoot'?'Scoot':operator==='HK Express'?'HK Express':null;
    if(!airline||prices.length!==1||!info.includes(origin+'-'+destination))return;
    const amount=Number(prices[0][1].replace(/,/g,''));if(!(amount>0)||Number(p.get('recentviewprice'))!==amount)return;
    const flights=(p.get('recentviewflt')||'').split('|'),prefix={'Cebu Pacific':'5j','AirAsia':'z2','Philippine Airlines':'pr','Scoot':'tr','HK Express':'uo'}[airline];
    if(flights.length!==(returnDate?2:1)||!flights.every(f=>new RegExp('^'+prefix+'\\d+$','i').test(f)))return;
    const visibleDate=iso=>{const d=new Date(iso+'T00:00:00Z');return new RegExp('\\b'+Object.keys(months)[d.getUTCMonth()]+'\\s+'+d.getUTCDate()+'\\b','i').test(info);};
    if(!visibleDate(departureDate)||returnDate&&!visibleDate(returnDate))return;
    const tripType=returnDate?'round-trip':'one-way',key=[airline,origin,destination,departureDate,returnDate,tripType,'Not stated','PHP','Trip.com'].join('|');
    out.push({id:id(key),kind:'advertised-fare',airline,origin,destination,originName:origin==='MNL'?'Manila':origin==='CEB'?'Cebu':'Clark',destinationName:DOMESTIC[destination]||AIRPORT_CITY[destination]||destination,departureDate,returnDate,tripType,cabin:'Not stated',currency:'PHP',amount,partner:'Trip.com',sourceAsOf:sourceDay,
      priceLabel:'PHP '+amount,priceBasis:'Trip.com published fare sample per traveller; not a direct-airline quote or guaranteed checkout price.',taxesIncluded:null,travelTaxIncluded:null,checkedBaggageIncluded:null,stops:!returnDate&&/Nonstop/.test(info)?0:null,
      fees:'Confirm mandatory fees and taxes at partner checkout; international travel tax may be additional.',baggage:'Baggage allowance is not established by this published quote.',connections:'Confirm flight times and all legs before booking.',bookingEnd:'',travelPeriod:'Exact dates in the partner booking link.',sourceUrl:source.url,bookingUrl,checkedAt:sourceDay===today?checkedAt:sourceDay+'T00:00:00+08:00',airlineSeen:'',terms:'Sold through Trip.com. Compare the direct airline price and cancellation terms; the displayed price may no longer be available.'});
  });return out;
}

// AirAsia MOVE is a booking site: its route pages list many airlines. Only
// named budget airlines are kept (the full-service ones come from their own
// pages), each under one name. A card whose logos name two different airlines,
// or only a ticketing carrier such as Hahn Air, is left out.
const BUDGET_AIRLINES=[
  [/^(?:Philippines |Thai |Indonesia |Malaysia )?AirAsia(?: X| Cambodia)?$/i,'AirAsia'],[/^Scoot$/i,'Scoot'],[/^Cebu Pacific$/i,'Cebu Pacific'],
  [/^Jetstar(?: Japan| Asia| Airways)?$/i,'Jetstar'],[/^(?:Hong Kong Express(?: Airways)?|HK Express)$/i,'HK Express'],[/^Jeju Air$/i,'Jeju Air'],[/^Jin Air$/i,'Jin Air'],
  [/^Eastar Jet$/i,'Eastar Jet'],[/^T.?way Air$/i,"T'way Air"],[/^Air Busan$/i,'Air Busan'],[/^Air Seoul$/i,'Air Seoul'],[/^(?:Thai )?Viet ?Jet(?: Air)?$/i,'VietJet'],
  [/^Tigerair Taiwan$/i,'Tigerair Taiwan'],[/^Peach(?: Aviation)?$/i,'Peach'],[/^ZIPAIR(?: Tokyo)?$/i,'ZIPAIR'],[/^Spring Airlines$/i,'Spring Airlines']
];
export function budgetAirline(names) {
  const found=[...new Set(names.map(n=>{const m=BUDGET_AIRLINES.find(([re])=>re.test(text(n)));return m ? m[1] : '';}))];
  return found.length===1 && found[0] && names.length ? found[0] : null;
}
// MOVE route cards include the exact dated booking link and visible price.
// Flight+hotel bundles and page headline prices are deliberately not fares.
// A page into Manila, Cebu or Clark gives return legs (kind 'return-leg', in
// the origin's currency) that the scout pairs with outbound fares; they are
// never shown as fares themselves.
export function parseAirAsiaFares(html,source,checkedAt) {
  const $=load(html), out=[],seen=new Map();
  $('a[href]').each((_,element)=>{
    const card=$(element),link=officialUrl(card.attr('href'),source.url);
    if(!link) return;
    const u=new URL(link),p=u.searchParams;
    if(u.pathname!=='/v2/flights/search/' || p.get('tripType')!=='O' || p.get('adult')!=='1' || p.get('child')!=='0' || p.get('infant')!=='0' || p.get('cabinClass')!=='economy') return;
    const origin=p.get('origin'),destination=p.get('destination'),departureDate=dateValue(p.get('departDate'));
    const inbound=ORIGINS.includes(destination) && outsidePH(origin);
    if(!(inbound || ORIGINS.includes(origin) && (outsidePH(destination) || DOMESTIC[destination])) || !departureDate || departureDate<checkedAt.slice(0,10)) return;
    const body=text(card.text());
    const visibleCodes=card.find('span').toArray().map(e=>text($(e).text()));
    if(!visibleCodes.includes(origin) || !visibleCodes.includes(destination)) return;
    const date=new Date(departureDate+'T00:00:00Z');
    const visibleDay=new RegExp('\\b'+date.getUTCDate()+'\\s+'+Object.keys(months)[date.getUTCMonth()]+'\\b','i');
    if(!visibleCodes.some(v=>visibleDay.test(v))) return;
    // The price sits in a large span, or (newer cards) right after the currency code.
    let prices=card.find('span.text-2xl').toArray().map(e=>text($(e).text()));
    if(!prices.length) prices=visibleCodes.map((v,i)=>v===p.get('currency') ? visibleCodes[i+1] : null).filter(v=>v!=null);
    const currencies=visibleCodes.filter(v=>/^[A-Z]{3}$/.test(v)&&v===p.get('currency'));
    if(prices.length!==1 || !(/^[\d,]+(?:\.\d{1,2})?$/.test(prices[0]) || inbound && /^\d+(?:\.\d)?[KM]$/.test(prices[0])) || !currencies.length) return;
    // Return pages in won or dong show rounded amounts (146K, 2.6M); kept, marked rounded.
    const rounded=/[KM]$/.test(prices[0]),amount=rounded ? Math.round(Number(prices[0].slice(0,-1))*(prices[0].endsWith('M') ? 1e6 : 1e3)) : Number(prices[0].replace(/,/g,''));if(!(amount>0)) return;
    const operators=card.find('img[alt]').toArray().map(e=>text($(e).attr('alt')));
    const airline=budgetAirline(operators);
    if(!airline) return;
    const currency=p.get('currency'),key=[airline,origin,destination,departureDate,'','one-way','Economy',currency].join('|');
    // The page repeats cards, sometimes at two prices for one date: keep the cheaper.
    if(seen.has(key)){const prev=out[seen.get(key)];if(prev.amount<=amount)return;out.splice(seen.get(key),1);seen.forEach((v,k)=>{if(v>seen.get(key))seen.set(k,v-1);});}
    seen.set(key,out.length);
    const direct=visibleCodes.includes('Direct');
    if(inbound) {
      out.push({id:id('leg|'+key),kind:'return-leg',airline,origin,destination,departureDate,currency,amount,rounded,stops:direct?0:null,sourceUrl:source.url,bookingUrl:link,checkedAt});
      return;
    }
    out.push({id:id(key),kind:'advertised-fare',airline,origin,destination,originName:origin==='MNL'?'Manila':origin==='CEB'?'Cebu':'Clark',destinationName:DOMESTIC[destination] || AIRPORT_CITY[destination] || destination,departureDate,returnDate:'',tripType:'one-way',cabin:'Economy',currency,amount,
      priceLabel:currency+' '+amount,priceBasis:'AirAsia MOVE advertised one-way fare for one adult; not a return ticket or final checkout total.',taxesIncluded:null,travelTaxIncluded:null,checkedBaggageIncluded:null,stops:direct?0:null,
      fees:'Confirm taxes, surcharges and applicable travel tax at checkout.',baggage:'Confirm baggage allowance and add-on prices.',connections:direct ? 'Shown as direct on AirAsia MOVE; reconfirm flight times.' : 'Connection or stops not established; reconfirm before booking.',bookingEnd:'',travelPeriod:'Exact sample departure date; return leg not priced.',sourceUrl:source.url,bookingUrl:link,checkedAt,airlineSeen:'',terms:'Sold through AirAsia MOVE'+(airline==='AirAsia' ? '' : ' for '+airline)+'. Confirm the operating airline, availability and final price before booking.'});
  });return out;
}
