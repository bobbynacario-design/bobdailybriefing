import {test} from 'node:test';
import assert from 'node:assert/strict';
import {campaignFromArticle,parseCebuCampaigns} from './campaigns.js';
const checked='2026-10-10T02:00:00Z';
const article={title:'Cebu Pacific 10.10 Seat Sale',publishedAt:'2026-10-08T04:13:08Z',evidenceUrl:'https://hellomnl.com/cebu-sale/',publisher:'Hello Mnl',discoveryUrl:'https://hellomnl.com/tag/cebu-pacific/feed/',
  html:'<p>Cebu Pacific seat sale. From October 8 to 11, passengers may book selected international destinations from PHP 10 one-way base fare, exclusive of fees and surcharges.</p><p>The travel period starts from February 1 to June 30, 2027. Japan and Vietnam routes need checking.</p>'};
test('extracts a dated base-fare campaign without inventing a route quote',()=>{
  const d=campaignFromArticle(article,checked);
  assert.equal(d.kind,'promo');assert.equal(d.campaign,true);assert.equal(d.amount,null);assert.equal(d.baseFareAmount,10);
  assert.equal(d.bookingStart,'2026-10-08');assert.equal(d.bookingEnd,'2026-10-11');
  assert.equal(d.travelStart,'2027-02-01');assert.equal(d.travelEnd,'2027-06-30');
  assert.equal(d.origin,'ANY');assert.equal(d.destination,'ANY');assert.equal(d.departureDate,'');
  assert.match(d.fees,/excluded/);assert.equal(d.evidenceUrl,article.evidenceUrl);assert.match(d.bookingUrl,/cebupacificair.com/);
});
test('rejects expired, old, incomplete, invalid and domestic-only announcements',()=>{
  assert.equal(campaignFromArticle(article,'2026-10-11T16:00:00Z'),null,'expires at Philippine midnight after booking end');
  assert.ok(campaignFromArticle(article,'2026-10-11T15:59:59Z'));
  for(const change of [{publishedAt:'2025-10-08'},{publishedAt:'2026-10-12'},
    {html:article.html.replace('international','domestic')},{html:article.html.replace('PHP 10','PHP 0')},
    {html:article.html.replace('June 30','February 30')},{html:article.html.replace('exclusive of fees and surcharges','')},
    {html:article.html.replace('February 1 to June 30, 2027','flexible dates')}]) assert.equal(campaignFromArticle({...article,...change},checked),null);
});
test('reads feed content and ignores unsafe article links and unrelated items',()=>{
  const source={airline:'Cebu Pacific',type:'campaign-feed',url:article.discoveryUrl,publisher:article.publisher};
  const item=(link=article.evidenceUrl)=>'<item><title>'+article.title+'</title><link>'+link+'</link><pubDate>'+article.publishedAt+'</pubDate><content:encoded><![CDATA['+article.html+']]></content:encoded></item>';
  const feed='<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>'+item()+item()+item('https://hellomnl.com.evil.test/sale')+'</channel></rss>';
  assert.equal(parseCebuCampaigns(feed,source,checked).length,1);
  assert.equal(parseCebuCampaigns('<html>app shell</html>',source,checked).length,0);
});
test('extracts the backup publisher phrasing with matching sale and travel dates',()=>{
  const html='<p>Cebu Pacific has launched an international seat sale offering one-way base fares starting at PHP 10. The sale period runs from October 8 through October 11, 2026, with applicable travel dates extending from February 1 to June 30, 2027. Quoted fares do not include taxes, fees, and additional surcharges.</p>';
  const d=campaignFromArticle({...article,html,publisher:'Logistics News PH',evidenceUrl:'https://logisticsnews.ph/sale'},checked);
  assert.equal(d.baseFareAmount,10);assert.equal(d.bookingEnd,'2026-10-11');assert.equal(d.travelStart,'2027-02-01');
  const source={type:'campaign-feed',url:'https://logisticsnews.ph/tag/cebu-pacific/feed/',publisher:'Logistics News PH'};
  const feed='<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>'+article.title+'</title><link>https://logisticsnews.ph/sale</link><pubDate>'+article.publishedAt+'</pubDate><content:encoded><![CDATA['+html+']]></content:encoded></item></channel></rss>';
  assert.equal(parseCebuCampaigns(feed,source,checked).length,1);
});
