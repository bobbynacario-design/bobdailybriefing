import {test} from 'node:test';
import assert from 'node:assert/strict';
import {offerDates,parseUniqlo,parseAdidas,parseZalora,parseCrocsCollection} from './clothing-rendered.js';
const at='2026-10-17T03:00:00Z';
test('UNIQLO requires current published dates and an actual crossed-out price; printed size ranges are not stock',()=>{
 const tile=(dates,original='<s>PHP 2,990.00</s>')=>`<a class="product-tile__link" href="/ph/en/products/E488726-000/00" aria-label="Denim Jacket, PHP 2,490.00, ${dates}"><h2>Denim Jacket</h2><p>Men S-3XL</p>${original}</a>`;
 const current='Limited Offer from 16 Oct - 22 Oct 2026';
 const r=parseUniqlo(tile(current),at);assert.equal(r.items.length,1);assert.equal(r.items[0].price,2490);assert.equal(r.items[0].availableSizes,null);
 for(const dates of ['','Limited Offer from 1 Oct - 15 Oct 2026','Limited Offer from 18 Oct - 22 Oct 2026'])assert.equal(parseUniqlo(tile(dates),at).items.length,0);
 assert.equal(parseUniqlo(tile(current,''),at).campaigns.length,1);
 assert.equal(parseUniqlo(tile(current),'2026-10-22T16:00:00Z').items.length,0);
 assert.equal(offerDates('Limited Offer from 31 Feb - 5 Mar 2026'),null);
 assert.deepEqual(offerDates('Limited Offer from 28 Dec - 5 Jan 2027'),{validFrom:'2026-12-28',validTo:'2027-01-05'});
});
test('Adidas accepts PHP markdowns on official mens product cards and does not infer stock',()=>{
 const card=(subtitle='Men Sportswear',name='Training Shorts',url='https://www.adidas.com.ph/shorts/JZ1095.html')=>`<article data-testid="plp-product-card"><a data-testid="product-card-description-link" href="${url}"><footer><div data-testid="main-price">₱750</div><div data-testid="original-price">₱1,500 Original price -50%</div><p data-testid="product-card-title">${name}</p><p data-testid="product-card-subtitle">${subtitle}</p></footer></a></article>`;
 const r=parseAdidas(card(),at);assert.equal(r.items[0].price,750);assert.equal(r.items[0].availableSizes,null);
 assert.equal(parseAdidas(card('Women'),at).items.length,0);assert.equal(parseAdidas(card('Men','Crew Socks'),at).items.length,0);assert.equal(parseAdidas(card('Men','Shorts','https://evil.test/x/JZ1095.html'),at).items.length,0);
});
test('ZALORA separates voucher and member prices from unconditional markdowns and keeps retailer identity',()=>{
 const card=(price,extra='')=>`<a data-test-id="productLink" href="https://www.zalora.com.ph/p/adidas-shoes-1"><h3 data-test-id="productBrandName">ADIDAS</h3><h3 data-test-id="productTitle">Adizero Shoes</h3>${extra}${price}<div data-test-id="originalPrice">Php 8,500.00</div></a>`;
 const special='<div data-test-id="specialPrice">From Php 6,630.00</div>';
 const r=parseZalora('<header>Coupon Php 100</header>'+card(special),at);assert.equal(r.items[0].price,6630);assert.equal(r.items[0].brand,'Adidas');assert.equal(r.items[0].retailer,'ZALORA');assert.equal(r.items[0].priceFrom,true);assert.equal(r.items[0].availableSizes,null);
 for(const extra of ['<div data-test-id="voucherPill">Php 5,000</div>','<i class="vip-icon"></i>']){const conditional=parseZalora(card(special,extra),at);assert.equal(conditional.items.length,0);assert.equal(conditional.campaigns.length,1);}
 assert.equal(parseZalora(card(''),at).items.length,0);
 assert.equal(parseZalora(card(special).replace('https://www.zalora.com.ph/p/','https://evil.test/p/'),at).items.length,0);
});
test('Crocs collection titles never manufacture dated offers or item reductions',()=>{
 const r=parseCrocsCollection('<h1>10.10 sale</h1>','https://crocs.com.ph/collections/sale',at);assert.equal(r.items.length,0);assert.equal(r.campaigns[0].validTo,'');assert.match(r.campaigns[0].terms,/not been verified/);
});
