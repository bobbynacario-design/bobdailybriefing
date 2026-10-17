import {test} from 'node:test';import assert from 'node:assert/strict';import './shopping-taste.js';import './shopping-style.js';import './shopping-core.js';
const S=globalThis.ShoppingStyle,C=globalThis.ShoppingCore,now=Date.parse('2026-10-17T08:00:00Z');
const at='2026-10-17T07:00:00Z',base={brand:'H&M',price:500,originalPrice:1000,checkedAt:at,url:'https://www2.hm.com/en_ph/productpage.1.html',availableSizes:['M'],sizeSystem:'Labelled clothing'};
const mine=C.cleanPrefs({taste:{colors:['Black','White','Grey','Navy','Blue','Beige','Brown','Burgundy'],patterns:['Plain']},wardrobe:{polo:0,'tee-dark':2,chinos:1,shorts:2,jeans:1,sneakers:1,knit:1}});
test('the verdict and taste explanation agree on cream, fit and graphic evidence',()=>{
 const p=C.cleanPrefs({...mine,taste:{colors:['White'],fits:['Regular'],patterns:['Plain']}}),cream={...base,id:'cream',name:'Regular-Fit Plain Polo Shirt',category:'Tops',color:'Cream'};
 assert.equal(S.verdict(cream,p).kind,'wear');assert.doesNotMatch(globalThis.ShoppingTaste.assess(cream,p).cautions.join(' '),/Cream differs/);
 const oversized={...cream,name:'Oversized Plain Polo Shirt'};assert.equal(S.verdict(oversized,p).kind,'check');assert.match(S.verdict(oversized,p).reasons.join(' '),/Oversized differs/);
 const printed={...cream,name:'Regular-Fit Plain T-shirt',color:'Cream/OutKast'};assert.equal(S.verdict(printed,p).kind,'check');assert.match(globalThis.ShoppingTaste.assess(printed,p).cautions.join(' '),/design choices/);
});
test('unknown stock, variant minimums and only one outfit cannot earn Worth it',()=>{
 const polo={...base,id:'polo',name:'Plain Polo Shirt',category:'Tops',color:'Navy'};
 const uncertain=S.verdict({...polo,availableSizes:null,priceFrom:true},mine);assert.equal(uncertain.kind,'promising');assert.match(uncertain.label,/check size and price/);
 const blazer={...base,id:'blazer',name:'Cotton Blazer',category:'Outerwear',color:'Navy'},p=C.cleanPrefs({wardrobe:{blazer:0,shirt:1,chinos:1,'smart-shoes':1}});
 assert.equal(S.outfitsWith('blazer',p).length,1);assert.equal(S.verdict(blazer,p).kind,'promising');assert.match(S.verdict(blazer,p).reasons.join(' '),/requires at least two/);
});
test('blank and explicit zero counts differ; a short-sleeved shirt is the resort piece, not a button shirt',()=>{
 assert.deepEqual(S.cleanWardrobe({polo:'',shirt:0,chinos:null}),{shirt:0});
 const item={...base,id:'polo',name:'Plain Polo Shirt',category:'Tops',color:'Navy'},p=C.cleanPrefs({...mine,wardrobe:{chinos:1,sneakers:1}});
 const v=S.verdict(item,p);assert.equal(v.kind,'promising');assert.match(v.reasons.join(' '),/count is not recorded/);assert.doesNotMatch(v.reasons.join(' '),/Fills a gap/);
 assert.equal(S.classify({name:'Short-Sleeved Cotton Shirt',category:'Tops'}).piece,'resort');
 assert.equal(S.classify({name:'Regular-Fit Linen Shirt',category:'Tops'}).piece,'shirt');
 assert.equal(S.classify({name:'Camp Collar Shirt',category:'Tops'}).piece,'resort');
});
test('Bought it confirms a wardrobe total, demotes the purchased item and safely undoes the update',()=>{
 const item={...base,id:'polo',name:'Plain Polo Shirt',category:'Tops',color:'Navy'},p=C.cleanPrefs({...mine,saved:['polo']});
 const next=C.cleanPrefs(S.bought(p,item,'polo',1,at));assert.equal(next.wardrobe.polo,1);assert.equal(next.purchases.length,1);assert.deepEqual(next.saved,['polo']);assert.equal(p.wardrobe.polo,0);assert.equal(S.verdict(item,next).kind,'owned');
 assert.throws(()=>S.bought(next,item,'polo',2,at),/already recorded/);
 assert.deepEqual(C.matchItems({items:[item,{...item,id:'unbought'}]},next,{},now).map(i=>i.id),['unbought','polo']);
 const undone=S.undoBought(next,'polo');assert.equal(undone.prefs.wardrobe.polo,0);assert.equal(undone.prefs.purchases.length,0);
 const changed=C.cleanPrefs({...next,wardrobe:{...next.wardrobe,polo:7}}),safe=S.undoBought(changed,'polo');assert.equal(safe.review,true);assert.equal(safe.prefs.wardrobe.polo,7);
 const unknown=C.cleanPrefs({wardrobe:{chinos:1}});assert.throws(()=>S.bought(unknown,item,'polo','',at),/how many/);const confirmed=S.bought(unknown,item,'polo',3,at);assert.equal(confirmed.wardrobe.polo,3);assert.equal(Object.hasOwn(S.undoBought(confirmed,'polo').prefs.wardrobe,'polo'),false);
});
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
 const polo={...base,id:'polo',name:'Regular-Fit Plain Polo Shirt',category:'Tops',color:'Navy'},v=S.verdict(polo,mine);
 assert.equal(v.kind,'wear');assert.match(v.reasons[0],/Fills a gap: you own 0 of the 2 your guide suggests \(polos\)/);assert.match(v.reasons[1],/Supports 4 outfit formulas with recorded pieces: Camera-ready, Casino night/);
 const covered=S.verdict({...polo,name:'Oversized Fit T-shirt',color:'Black'},C.cleanPrefs({...mine,wardrobe:{...mine.wardrobe,'tee-dark':3}}));
 assert.equal(covered.kind,'check');assert.match(covered.reasons[0],/Already covered: you own 3, your guide suggests 3 \(dark tees\)/);
});
test('track spikes, warm or formal pieces, off-palette colours and patterns are flagged before money is spent',()=>{
 assert.equal(S.verdict({...base,name:'Nike Victory 2 · Athletics Distance Spikes',category:'Footwear'},mine).kind,'skip');
 const tux=S.verdict({...base,name:'Relaxed-Fit Wool-Blend Tuxedo Jacket',category:'Outerwear',color:'Black'},mine);
 assert.equal(tux.kind,'check');assert.match(tux.reasons.join(' '),/Warm fabric/);assert.match(tux.reasons.join(' '),/black-tie only/);
 assert.match(S.verdict({...base,name:'Relaxed-Fit Double-Breasted Jacket',category:'Outerwear',color:'Dark khaki green'},mine).reasons.join(' '),/Green differs from your colour choices/);
 assert.match(S.verdict({...base,name:'Regular-Fit Fine-Knit Polo Shirt',category:'Tops',color:'Burgundy/striped'},mine).reasons.join(' '),/Printed|Striped|Patterned/);
 assert.doesNotMatch(S.verdict({...base,name:'Button-Down Oxford Shirt',category:'Tops',color:'White'},mine).reasons.join(' '),/Warm fabric/);
});
test('before a wardrobe is entered, only real flags get a verdict',()=>{
 const p=C.cleanPrefs({taste:mine.taste});
 assert.equal(S.verdict({...base,name:'Regular-Fit Plain Polo Shirt',category:'Tops',color:'Navy'},p).kind,'none');
 assert.equal(S.verdict({...base,name:'Nike Victory 2 · Athletics Distance Spikes',category:'Footwear'},p).kind,'skip');
 assert.equal(S.verdict({...base,name:'Slim Fit Wool-Blend Pants',category:'Trousers',color:'Dark grey'},p).kind,'check');
});
test('ranking: Worth it leads, then the rest by discount, and Likely to sit unworn sorts last',()=>{
 const polo={...base,id:'polo',name:'Regular-Fit Plain Polo Shirt',category:'Tops',color:'Navy'},spikes={...base,id:'spikes',brand:'Nike',url:'https://www.nike.com/ph/t/x/FZ9315-100',name:'Nike Dragonfly 2 Elite · Athletics Distance Spikes',category:'Footwear',price:100};
 // A 90%-off dark tee he already has three of (Check first) still follows the 50%-off polo that fills a gap.
 const covered={...base,id:'tee',name:'Oversized Fit T-shirt',category:'Tops',color:'Black',price:100},deeper={...covered,id:'tee2',price:50},p=C.cleanPrefs({...mine,wardrobe:{...mine.wardrobe,'tee-dark':3}});
 assert.deepEqual(C.matchItems({items:[spikes,covered,deeper,polo]},p,{},now).map(i=>i.id),['polo','tee2','tee','spikes']);
 assert.equal(C.rankValue(polo,mine,null),C.rankValue(polo,C.cleanPrefs({taste:mine.taste}),null));
 assert.deepEqual(C.matchItems({items:[spikes,polo,{...polo,id:'tux',name:'Wool-Blend Tuxedo Jacket',category:'Outerwear'}]},mine,{wear:true},now).map(i=>i.id),['polo']);
});
test('the wardrobe is bounded and survives other profile edits',()=>{
 assert.deepEqual(S.cleanWardrobe({polo:'2',chinos:0,invented:4,jeans:99,shorts:1.5}),{polo:2,chinos:0});
 const p=C.cleanPrefs({...mine,shoeSize:9});assert.deepEqual(p.wardrobe,mine.wardrobe);
});
test('UNIQLO UT tees, sweat pants, Crocband clogs and cream map the way a stylist would read them',()=>{
 // Names as the 17 Oct feed and UNIQLO import listed them.
 assert.deepEqual(S.classify({name:'PEANUTS UT',category:'Tops'}),{candidates:['tee-light','tee-dark']});
 assert.match(S.verdict({...base,name:'NY POP ART UT',category:'Tops'},mine).reasons.join(' '),/Printed|Striped|Patterned/);
 assert.deepEqual(S.classify({name:'Sweat Pants',category:'Trousers'}),{piece:'joggers'});
 assert.deepEqual(S.classify({name:'Crocband In White',category:'Footwear',brand:'Crocs'}),{piece:'sandals'});
 assert.deepEqual(S.classify({name:'Nike SB Zoom Janoski OG+ · Skate Shoes',category:'Footwear',brand:'Nike'}),{piece:'sneakers'});
 assert.doesNotMatch(S.verdict({...base,name:'Regular-Fit Short-Sleeved Shirt',category:'Tops',color:'Cream'},mine).reasons.join(' '),/outside your colours/);
 assert.match(S.verdict({...base,name:'Regular-Fit Short-Sleeved Shirt',category:'Tops',color:'Cream'},C.cleanPrefs({...mine,taste:{colors:['Black','Navy']}})).reasons.join(' '),/Cream differs/);
 // H&M prints carry a capitalised name in the colour; patterns are lower case.
 assert.match(S.verdict({...base,name:'Oversized Fit T-shirt',category:'Tops',color:'Cream/OutKast'},mine).reasons.join(' '),/Printed|Striped|Patterned/);
 assert.doesNotMatch(S.verdict({...base,brand:'Nike',name:'Nike Dri-FIT Tee',category:'Tops',color:'Black/White'},mine).reasons.join(' '),/Printed|Striped|Patterned/);
 // A word "ut" in ordinary text is not the UT line.
 assert.deepEqual(S.classify({name:'Cut and sew shirt',category:'Tops'}),{piece:'shirt'});
});
test('a trait the listing does not state neither blocks nor earns Worth it',()=>{
 // Most listings never say "plain" or name a fit; that is unknown, not a conflict.
 const polo={...base,id:'p',name:'Polo Shirt',category:'Tops',color:'Navy'},p=C.cleanPrefs({...mine,taste:{...mine.taste,fits:['Regular','Relaxed']}});
 const v=S.verdict(polo,p);assert.equal(v.kind,'wear');assert.doesNotMatch(v.reasons.join(' '),/Confirm the preferred traits/);
 assert.equal(S.verdict({...polo,name:'Oversized Polo Shirt'},p).kind,'check');
});
test('Pair it with: colour partners for the main colour in your palette, and the pieces you own',()=>{
 // Today's deals and Bob's recorded wardrobe (17 Oct 2026).
 const bob=C.cleanPrefs({taste:{colors:['Black','White','Grey','Navy','Blue','Beige','Brown','Burgundy'],patterns:['Plain']},wardrobe:{'tee-light':2,'tee-dark':6,polo:5,shirt:5,resort:0,chinos:0,jeans:1,shorts:5,joggers:2,sneakers:1,trainers:1,'smart-shoes':1,sandals:1,'active-shorts':3,knit:2,blazer:1}});
 const pair=(name,category,color='')=>S.pairWith({...base,name,category,color},bob);
 assert.equal(pair('Regular-Fit Short-Sleeved Shirt','Tops','Cream').text,'navy, brown, grey or blue-denim bottoms (you have dark jeans or casual shorts) · white or brown shoes (you have everyday sneakers, smart shoes or sandals)');
 const tux=pair('Relaxed-Fit Wool-Blend Tuxedo Jacket','Outerwear','Black');assert.match(tux.text,/^white tops underneath/);assert.match(tux.text,/black bottoms \(none recorded yet\)/);assert.equal(tux.tip,'Black tie: white shirt, black trousers, black shoes.');
 assert.equal(pair('Regular-Fit Fine-Knit Polo Shirt','Tops','Burgundy/striped').tip,'It carries the pattern, so keep the rest plain.');
 assert.match(pair('Oversized Cotton T-Shirt','Tops','White').tip,/Roomy cut/);assert.match(pair('Slim Fit Wool-Blend Pants','Trousers','Dark grey').tip,/Slim trousers/);
 // No readable main colour: the pieces only.
 assert.equal(S.pairWith({...base,brand:'Nike',name:'Nike Pegasus 42 · Men\'s Road Running Shoes',category:'Footwear',color:'Photon Dust/Volt/White/Black'},bob).text,'your joggers, dark jeans or casual shorts');
 // Colours stay inside the palette; white shoes are always fine.
 assert.doesNotMatch(S.pairWith({...base,name:'Regular Fit Chinos',category:'Trousers',color:'Navy'},C.cleanPrefs({...bob,taste:{colors:['Navy','Grey']}})).text,/beige|blue|burgundy/);
 assert.equal(S.pairWith({...base,name:'Nike Victory 2 · Athletics Distance Spikes',category:'Footwear'},bob),null);
});
