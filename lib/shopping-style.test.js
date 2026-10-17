import {test} from 'node:test';import assert from 'node:assert/strict';import './shopping-taste.js';import './shopping-style.js';import './shopping-core.js';
const S=globalThis.ShoppingStyle,C=globalThis.ShoppingCore,now=Date.parse('2026-10-17T08:00:00Z');
const at='2026-10-17T07:00:00Z',base={brand:'H&M',price:500,originalPrice:1000,checkedAt:at,url:'https://www2.hm.com/en_ph/productpage.1.html',availableSizes:null,sizeSystem:'Unverified'};
const mine=C.cleanPrefs({taste:{colors:['Black','White','Grey','Navy','Blue','Beige','Brown','Burgundy'],patterns:['Plain']},wardrobe:{'tee-dark':2,chinos:1,shorts:2,jeans:1,sneakers:1,knit:1}});
// Names as today's feed listed them (17 Oct 2026).
test('listings map to the core pieces of the guide',()=>{
 const kind=(name,category,color='')=>S.classify({name,category,color});
 assert.deepEqual(kind('Regular-Fit Fine-Knit Polo Shirt','Tops'),{piece:'polo'});
 assert.deepEqual(kind('Oversized Cotton T-Shirt','Tops','White'),{piece:'tee-light'});
 assert.deepEqual(kind('Oversized Fit T-shirt','Tops','Black'),{piece:'tee-dark'});
 assert.deepEqual(kind('Regular-Fit Short-Sleeved Shirt','Tops'),{piece:'resort'});
 assert.deepEqual(kind('Regular-Fit Linen Shirt','Tops'),{piece:'shirt'});
 assert.deepEqual(kind('Nike Pegasus 42 · Men\'s Road Running Shoes','Footwear'),{piece:'trainers'});
 assert.deepEqual(kind('Nike Air Max Bia · Men\'s Shoes','Footwear'),{piece:'sneakers'});
 assert.deepEqual(kind('Bayaband Clog In Black White','Footwear'),{piece:'sandals'});
 assert.deepEqual(kind('Oversized-Fit Hooded Jacket','Outerwear'),{piece:'hoodie'});
 assert.deepEqual(kind('Relaxed-Fit Cotton Joggers','Trousers'),{piece:'joggers'});
 assert.match(kind('Nike Zoom Superfly Elite 2 · Athletics Sprinting Spikes','Footwear').skip,/running tracks/);
 assert.match(kind('Relaxed-Fit Wool-Blend Tuxedo Jacket','Outerwear').formal,/black-tie/);
});
test('a deal is Worth it when it fills a gap and makes outfits with what you own',()=>{
 const polo={...base,id:'polo',name:'Regular-Fit Polo Shirt',category:'Tops',color:'Navy'},v=S.verdict(polo,mine);
 assert.equal(v.kind,'wear');assert.match(v.reasons[0],/Fills a gap: you own 0 of the 2 your guide suggests \(polos\)/);assert.match(v.reasons[1],/Makes 4 outfits with what you own: Camera-ready, Casino night/);
 const covered=S.verdict({...polo,name:'Oversized Fit T-shirt',color:'Black'},C.cleanPrefs({...mine,wardrobe:{...mine.wardrobe,'tee-dark':3}}));
 assert.equal(covered.kind,'check');assert.match(covered.reasons[0],/Already covered: you own 3, your guide suggests 3 \(dark tees\)/);
});
test('track spikes, warm or formal pieces, off-palette colours and patterns are flagged before money is spent',()=>{
 assert.equal(S.verdict({...base,name:'Nike Victory 2 · Athletics Distance Spikes',category:'Footwear'},mine).kind,'skip');
 const tux=S.verdict({...base,name:'Relaxed-Fit Wool-Blend Tuxedo Jacket',category:'Outerwear',color:'Black'},mine);
 assert.equal(tux.kind,'check');assert.match(tux.reasons.join(' '),/Warm fabric/);assert.match(tux.reasons.join(' '),/black-tie only/);
 assert.match(S.verdict({...base,name:'Relaxed-Fit Double-Breasted Jacket',category:'Outerwear',color:'Dark khaki green'},mine).reasons.join(' '),/Green is outside your colours/);
 assert.match(S.verdict({...base,name:'Regular-Fit Fine-Knit Polo Shirt',category:'Tops',color:'Burgundy/striped'},mine).reasons.join(' '),/Patterned/);
 assert.doesNotMatch(S.verdict({...base,name:'Button-Down Oxford Shirt',category:'Tops',color:'White'},mine).reasons.join(' '),/Warm fabric/);
});
test('before a wardrobe is entered, only real flags get a verdict',()=>{
 const p=C.cleanPrefs({taste:mine.taste});
 assert.equal(S.verdict({...base,name:'Regular-Fit Polo Shirt',category:'Tops',color:'Navy'},p).kind,'none');
 assert.equal(S.verdict({...base,name:'Nike Victory 2 · Athletics Distance Spikes',category:'Footwear'},p).kind,'skip');
 assert.equal(S.verdict({...base,name:'Slim Fit Wool-Blend Pants',category:'Trousers',color:'Dark grey'},p).kind,'check');
});
test('ranking: Worth it adds 10 and Likely to sit unworn sorts last, whatever the discount',()=>{
 const polo={...base,id:'polo',name:'Regular-Fit Polo Shirt',category:'Tops',color:'Navy'},spikes={...base,id:'spikes',brand:'Nike',url:'https://www.nike.com/ph/t/x/FZ9315-100',name:'Nike Dragonfly 2 Elite · Athletics Distance Spikes',category:'Footwear',price:100};
 assert.equal(C.rankValue(polo,mine,null)-C.rankValue(polo,C.cleanPrefs({taste:mine.taste}),null),10);
 assert.deepEqual(C.matchItems({items:[spikes,polo]},mine,{},now).map(i=>i.id),['polo','spikes']);
 assert.deepEqual(C.matchItems({items:[spikes,polo,{...polo,id:'tux',name:'Wool-Blend Tuxedo Jacket',category:'Outerwear'}]},mine,{wear:true},now).map(i=>i.id),['polo']);
});
test('the wardrobe is bounded and survives other profile edits',()=>{
 assert.deepEqual(S.cleanWardrobe({polo:'2',chinos:0,invented:4,jeans:99,shorts:1.5}),{polo:2});
 const p=C.cleanPrefs({...mine,shoeSize:9});assert.deepEqual(p.wardrobe,mine.wardrobe);
});
