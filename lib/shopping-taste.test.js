import {test} from 'node:test';import assert from 'node:assert/strict';import './shopping-taste.js';import './shopping-core.js';
const T=globalThis.ShoppingTaste,C=globalThis.ShoppingCore,now=Date.parse('2026-10-17T08:00:00Z');
const base={id:'polo',brand:'H&M',name:'Regular Fit Cotton Polo Shirt',color:'Navy',category:'Tops',price:790,originalPrice:990,url:'https://www2.hm.com/en_ph/productpage.123.html',checkedAt:'2026-10-17T07:00:00Z',availableSizes:null,sizeSystem:'Unverified'};
test('cold start stays honest; only named traits support taste claims',()=>{
 const p=C.cleanPrefs();assert.match(T.assess(base,p).reasons.join(' '),/No personal style match/);assert.equal(T.features(base).patterns.length,0);
 const wanted=C.cleanPrefs({taste:{fits:['Regular'],colors:['Navy'],patterns:['Plain'],materials:['Cotton']}}),a=T.assess(base,wanted);assert.equal(a.label,'Matches stated preferences');assert.match(a.reasons.join(' '),/Regular/);assert.match(a.reasons.join(' '),/Navy/);assert.doesNotMatch(a.reasons.join(' '),/Plain|comfortable|breathable/);assert.match(a.cautions.join(' '),/not stated/);
 const noDetails=T.assess({...base,name:'Brand collection',color:''},wanted);assert.equal(noDetails.label,'Brand match only');assert.equal(noDetails.score,0);
});
test('taste reorders deals of similar depth but cannot bury a much deeper markdown; budgets and stock remain hard gates',()=>{
 const p=C.cleanPrefs({taste:{fits:['Regular'],colors:['Navy'],budgets:{Tops:1000}}}),other={...base,id:'other',name:'Slim Fit Printed Polo',color:'Red'};
 // 20% off in your taste (20 + 20) beats 25% off against it (25 - 20).
 assert.deepEqual(C.matchItems({items:[{...other,price:742},base]},p,{},now).map(i=>i.id),['polo','other']);assert.match(T.assess(other,p).cautions.join(' '),/differs/);
 // 90% off against your taste (90 - 20) still leads 20% off in it (40).
 assert.deepEqual(C.matchItems({items:[base,{...other,price:500,originalPrice:5000}]},p,{},now).map(i=>i.id),['other','polo']);
 // Your size listed is worth 15 points: at the same discount it leads an unchecked size.
 assert.deepEqual(C.matchItems({items:[base,{...base,id:'sized',availableSizes:['M'],sizeSystem:'Labelled clothing'}]},C.cleanPrefs(),{},now).map(i=>i.id),['sized','polo']);
 assert.equal(C.matchItems({items:[{...base,price:1200,originalPrice:2000},{...base,id:'from',priceFrom:true},{...base,id:'wrong',availableSizes:['XL'],sizeSystem:'Labelled clothing'}]},p,{},now).length,0);
});
test('two relevant examples support cautious shared-trait explanations; price passes teach no style dislike',()=>{
 const f=n=>T.feedbackFor({...base,id:'like'+n},'like','color','2026-10-17T07:00:00Z');
 const p=C.cleanPrefs({feedback:[f(1)]});assert.doesNotMatch(T.assess(base,p).reasons.join(' '),/Shares/);
 p.feedback.push(f(2));const a=T.assess(base,p);assert.match(a.reasons.join(' '),/Shares Navy with 2 items/);assert.equal(a.label,'Similar to your feedback');
 const price=C.cleanPrefs({feedback:[1,2].map(n=>T.feedbackFor({...base,id:'pass'+n},'pass','price'))});assert.equal(T.assess(base,price).score,0);
 const colors=C.cleanPrefs({feedback:[1,2].map(n=>T.feedbackFor({...base,id:'pass'+n},'pass','color'))});assert.ok(T.assess(base,colors).score<0);assert.match(T.assess(base,colors).cautions.join(' '),/Navy/);
});
test('My style beats a saved deal; generic passes affect only the rated item',()=>{
 const liked={...base,id:'liked'},saved={...base,id:'saved'},passed={...base,id:'passed'};
 const p=C.cleanPrefs({saved:['saved'],feedback:[T.feedbackFor(liked,'like'),T.feedbackFor(passed,'pass')]});assert.deepEqual(C.matchItems({items:[passed,saved,liked]},p,{},now).map(i=>i.id),['liked','saved','passed']);
 assert.equal(T.assess(base,p).score,0);assert.match(T.assess(passed,p).reasons[0],/Not for me/);
});
test('profile cleaning bounds feedback and preserves taste through other edits',()=>{
 const raw={brands:['H&M'],saved:['polo'],needs:[{id:'work',text:'Work tops',category:'Tops'}],taste:{fits:['Regular','invented'],budgets:{Tops:'1000',Footwear:-1}},feedback:[T.feedbackFor(base,'like'),{...T.feedbackFor(base,'pass'),features:{colors:['Navy','made-up']}},...Array.from({length:110},(_,i)=>T.feedbackFor({...base,id:'item-'+i},'like'))]};
 const p=C.cleanPrefs(raw);assert.deepEqual(p.taste.fits,['Regular']);assert.equal(p.taste.budgets.Tops,1000);assert.equal(p.taste.budgets.Footwear,null);assert.equal(p.feedback.length,100);p.shoeSize=9;const q=C.cleanPrefs(p);assert.deepEqual(q.taste,p.taste);assert.deepEqual(q.feedback,p.feedback);assert.deepEqual(q.saved,['polo']);assert.equal(q.needs.length,1);
});
test('ticking every option in a group is no preference, and only the main colour counts',()=>{
 const every=C.cleanPrefs({taste:{occasions:T.OPTIONS.occasions.slice(),colors:T.OPTIONS.colors.slice()}});
 const tee={...base,id:'tee',name:'Oversized Cotton T-Shirt',color:'Cream'};
 assert.equal(T.assess(tee,every).score,0);assert.equal(T.assess(tee,every).label,'Brand match only');
 // Nike colourway as listed on 17 Oct: the trim colours no longer match a palette.
 assert.deepEqual(T.features({...base,color:'Photon Dust/Volt/White/Black'}).colors,[]);
 assert.deepEqual(T.features({...base,color:'White/Midnight Navy/Light Smoke Grey'}).colors,['White']);
 assert.deepEqual(T.features({...base,color:'Dark khaki green'}).colors,['Green']);
 assert.deepEqual(T.features({...base,name:'Bayaband Clog In Black White',color:''}).colors,['Black']);
});
