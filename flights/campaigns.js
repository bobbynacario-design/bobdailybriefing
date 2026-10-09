import {load} from 'cheerio';
import {createHash} from 'node:crypto';
const monthNames='January February March April May June July August September October November December'.split(' ');
const monthPattern='('+monthNames.join('|')+')';
function day(year,month,date) {
  const value=year+'-'+String(monthNames.findIndex(m=>m.toLowerCase()===month.toLowerCase())+1).padStart(2,'0')+'-'+String(date).padStart(2,'0');
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10)===value ? value : '';
}
function todayPHT(checkedAt) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(checkedAt));
  const p=Object.fromEntries(parts.map(p=>[p.type,p.value]));return p.year+'-'+p.month+'-'+p.day;
}
export function campaignFromArticle({title,html,publishedAt,evidenceUrl,publisher,discoveryUrl},checkedAt) {
  const $=load(html);$('script,style,nav,footer').remove();
  const body=$.text().replace(/\s+/g,' ').trim();
  const published=Date.parse(publishedAt),checked=Date.parse(checkedAt);
  if(!Number.isFinite(published)||published>checked||checked-published>45*86400000||!/Cebu Pacific/i.test(title+' '+body)||!/seat sale/i.test(title+' '+body))return null;
  if(!/international/i.test(body))return null;
  const quote=body.match(/(?:PHP|₱|P)\s*([\d,]+(?:\.\d{1,2})?)\s+one[ -]way\s+base fare/i);
  const booking=body.match(new RegExp('(?:From|runs? from)\\s+'+monthPattern+'\\s+(\\d{1,2})\\s*(?:to|[-–])\\s*(?:'+monthPattern+'\\s+)?(\\d{1,2})(?:,?\\s+(20\\d{2}))?','i'));
  const travel=body.match(new RegExp('travel period[^.]{0,70}?'+monthPattern+'\\s+(\\d{1,2})\\s*(?:through|to|[-–])\\s*'+monthPattern+'\\s+(\\d{1,2}),?\\s+(20\\d{2})','i'));
  if(!quote||!booking||!travel||!/exclusive of fees and surcharges/i.test(body))return null;
  const year=booking[5]||String(new Date(published).getUTCFullYear());
  const bookingStart=day(year,booking[1],booking[2]),bookingEnd=day(year,booking[3]||booking[1],booking[4]);
  const travelStart=day(travel[5],travel[1],travel[2]),travelEnd=day(travel[5],travel[3],travel[4]);
  const baseFareAmount=Number(quote[1].replace(/,/g,''));
  if(!bookingStart||!bookingEnd||!travelStart||!travelEnd||bookingEnd<bookingStart||travelEnd<travelStart||bookingEnd<todayPHT(checkedAt)||!Number.isFinite(baseFareAmount)||baseFareAmount<=0||Math.abs(Date.parse(bookingStart)-published)>60*86400000)return null;
  const bookingUrl='https://www.cebupacificair.com/en-PH/seat-sale';
  return {id:createHash('sha256').update(['Cebu Pacific',bookingStart,bookingEnd,travelStart,travelEnd,baseFareAmount].join('|')).digest('hex').slice(0,20),
    kind:'promo',campaign:true,airline:'Cebu Pacific',origin:'ANY',destination:'ANY',origins:['MNL','CEB','CRK'],
    originName:'Check Manila, Cebu & Clark',destinationName:'Selected international destinations',title,
    destinationKeywords:body.match(/(?:Japan|Vietnam|Hong Kong|Bangkok|Hanoi|Shanghai|Nagoya|Singapore|Taipei|Macao|Macau|Da Nang|Sapporo|Narita|Fukuoka|Ho Chi Minh|Osaka)/gi)?.join(' ')||'',
    amount:null,currency:'PHP',baseFareAmount,tripType:'one-way',cabin:'Not stated',departureDate:'',returnDate:'',
    discount:'PHP '+baseFareAmount.toLocaleString('en-PH')+' one-way base fare',bookingStart,bookingEnd,travelStart,travelEnd,
    travelPeriod:travelStart+' → '+travelEnd,priceBasis:'Campaign starting base fare only; not a dated route quote or final ticket price.',
    fees:'Fees and surcharges excluded. Confirm taxes, Philippine travel tax and the final total on Cebu Pacific.',
    baggage:'Add-ons and baggage need confirmation.',connections:'Routes and stops need confirmation.',
    sourceUrl:bookingUrl,bookingUrl,evidenceUrl,publisher,discoveryUrl,publishedAt:new Date(published).toISOString(),checkedAt,airlineSeen:'',
    terms:'Selected destinations and limited sale seats. Origin/destination eligibility and availability must be checked on the airline. This announcement does not confirm a PHP '+baseFareAmount+' seat on any specific route.'};
}
export function parseCebuCampaigns(html,source,checkedAt) {
  const $=load(html,{xmlMode:source.type==='campaign-feed'}),items=[];
  if(source.type==='campaign-feed') {
    $('item').slice(0,15).each((_,element)=>{
      const item=$(element),evidenceUrl=item.find('link').text().trim();
      try {const u=new URL(evidenceUrl);if(u.protocol!=='https:'||u.hostname!=='hellomnl.com'||u.username||u.password)return;}catch{return;}
      const record=campaignFromArticle({title:item.find('title').text(),html:item.find('content\\:encoded').text(),publishedAt:item.find('pubDate').text(),evidenceUrl,publisher:source.publisher,discoveryUrl:source.url},checkedAt);
      if(record)items.push(record);
    });
  } else {
    const record=campaignFromArticle({title:$('h1').first().text(),html,publishedAt:$('meta[property="article:published_time"]').attr('content'),evidenceUrl:source.url,publisher:'Cebu Pacific',discoveryUrl:source.url},checkedAt);
    if(record)items.push(record);
  }
  return [...new Map(items.map(d=>[d.id,d])).values()];
}
