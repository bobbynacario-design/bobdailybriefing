import {test} from 'node:test';import assert from 'node:assert/strict';import './rentals-core.js';
const C=globalThis.RentalsCore;
const unit=(o)=>({id:'dot:a',source:'DotProperty',area:'ortigas',url:'https://www.dotproperty.com.ph/ads/a',price:24000,beds:1,sqm:32,furnish:'Fully furnished',stay:'long',firstSeen:'2026-10-29T23:00:00.000Z',...o});
const feed=(items,o)=>({generatedAt:'2026-10-31T23:00:00.000Z',trackingSince:'2026-10-29T23:00:00.000Z',benchmarks:{ortigas:{'1br':{n:53,medianRent:28000,medianPerSqm:800,sized:42},studio:{n:9,medianRent:25000}}},items,...o});

test('prefs start from Bob’s 29 Oct choices and drop anything unknown',()=>{
  assert.deepEqual(C.cleanPrefs({}),{budget:25000,sizes:['studio','1br'],areas:['cubao','ortigas','makati','bgc'],furnish:'any',hideShortStays:true,saved:{},hidden:[]});
  const p=C.cleanPrefs({budget:99999,sizes:['2br','studio'],areas:['ortigas','mars'],furnish:'luxury',hideShortStays:false,saved:{'dot:x':{status:'Viewed',at:'2026-10-30'},'evil:1':{}},hidden:['hop:RR1','<script>']});
  assert.equal(p.budget,25000);assert.deepEqual(p.sizes,['studio']);assert.deepEqual(p.areas,['ortigas']);assert.equal(p.furnish,'any');assert.equal(p.hideShortStays,false);
  assert.deepEqual(p.saved,{'dot:x':{status:'Viewed',at:'2026-10-30'}});assert.deepEqual(p.hidden,['hop:RR1']);
  assert.equal(C.cleanPrefs({saved:{'dot:x':{status:'Bought'}}}).saved['dot:x'].status,'Shortlisted');
});
test('budget, area, size, furnishing and short stays filter the list',()=>{
  const rows=[unit(),unit({id:'dot:dear',price:26000}),unit({id:'dot:bgc',area:'bgc'}),unit({id:'dot:2br',beds:2}),unit({id:'dot:bare',furnish:'Unfurnished'}),unit({id:'dot:bnb',stay:'short'}),unit({id:'dot:both',stay:'both'}),unit({id:'dot:nobeds',beds:null,sqm:null}),unit({id:'dot:tiny',beds:null,sqm:24})];
  const ids=(p,f)=>C.matchItems(feed(rows),p,f).map(i=>i.id).sort();
  assert.deepEqual(ids({}),['dot:a','dot:bare','dot:bgc','dot:both','dot:nobeds','dot:tiny']);
  assert.deepEqual(ids({areas:['ortigas'],furnish:'furnished',sizes:['1br']}),['dot:a','dot:both','dot:nobeds'],'a listing without a bedroom count stays in view');
  assert.deepEqual(ids({areas:['ortigas'],sizes:['studio']}),['dot:nobeds','dot:tiny'],'24 m² with no bedroom count reads as a studio');
  assert.ok(ids({hideShortStays:false}).includes('dot:bnb'));
  assert.deepEqual(ids({hidden:['dot:a']},{area:'ortigas',size:'1br'}),['dot:bare','dot:both']);
  assert.deepEqual(ids({hidden:['dot:a']},{view:'hidden'}),['dot:a']);
  assert.deepEqual(ids({saved:{'dot:dear':{status:'Messaged'}}},{view:'shortlist'}),['dot:dear'],'a shortlisted unit stays even over budget');
  assert.deepEqual(C.matchItems(feed([unit({url:'https://evil.example/a'})]),{}).length,0);
});
test('value compares rent per m² with the area median for that size',()=>{
  assert.deepEqual(C.value(unit(),feed([])),{basis:'perSqm',perSqm:750,median:800,n:42,pct:-6});
  assert.deepEqual(C.value(unit({beds:0,sqm:22,price:20000}),feed([])),{basis:'rent',median:25000,n:9,pct:-20},'no studio m² median: compare rent');
  assert.equal(C.value(unit({area:'cubao'}),feed([])),null);
  const rows=C.matchItems(feed([unit({id:'dot:dear',price:25000}),unit({id:'dot:cheap',price:20000}),unit({id:'dot:none',area:'cubao',price:15000})]),{},{sort:'value'});
  assert.deepEqual(rows.map(i=>i.id),['dot:cheap','dot:dear','dot:none'],'no benchmark sorts last on value');
  assert.deepEqual(C.matchItems(feed(rows),{},{sort:'price'}).map(i=>i.id),['dot:none','dot:cheap','dot:dear']);
});
test('new needs a run before it; drops and stale listings are marked',()=>{
  const f=feed([]);
  assert.equal(C.isNew(unit(),f),false,'first day of tracking');
  assert.equal(C.isNew(unit({firstSeen:'2026-10-31T23:00:00.000Z'}),f),true);
  assert.equal(C.isNew(unit({firstSeen:'2026-10-30T23:00:00.000Z'}),{...f,generatedAt:'2026-11-05T23:00:00.000Z'}),false,'older than three days');
  assert.equal(C.dropped(unit({previousPrice:26000})),true);assert.equal(C.dropped(unit({previousPrice:22000})),false);
  assert.equal(C.stale(unit({updatedAt:'2026-03-01T00:00:00+08:00'}),Date.parse('2026-10-29T00:00:00Z')),true);
  assert.equal(C.stale(unit(),Date.parse('2026-10-29T00:00:00Z')),false);
  const rows=feed([unit({id:'dot:old'}),unit({id:'dot:new',firstSeen:'2026-10-31T23:00:00.000Z'}),unit({id:'dot:drop',previousPrice:25000})]);
  assert.deepEqual(C.matchItems(rows,{},{view:'new'}).map(i=>i.id),['dot:new']);
  assert.deepEqual(C.matchItems(rows,{},{view:'drops'}).map(i=>i.id),['dot:drop']);
  assert.equal(C.matchItems(rows,{},{sort:'new'})[0].id,'dot:new');
});
test('terms and move-in cash say only what is stated',()=>{
  assert.deepEqual(C.terms(unit({deposit:2,advance:1,minLeaseMonths:12,duesIncluded:true,pdc:true})),['2 months deposit','1 month advance','12-month minimum','dues included','post-dated cheques']);
  assert.deepEqual(C.terms(unit({termsAsWritten:'2+1',duesIncluded:false,pdc:false})),['terms written as 2+1','dues extra','no post-dated cheques']);
  assert.deepEqual(C.terms(unit()),[]);
  assert.deepEqual(C.moveIn(unit({deposit:2,advance:1})),{amount:72000,months:3,stated:true,partial:false});
  assert.deepEqual(C.moveIn(unit({deposit:2})),{amount:48000,months:2,stated:true,partial:true});
  assert.deepEqual(C.moveIn(unit()),{amount:72000,months:3,stated:false});
});
test('manual searches open the sites the scout cannot read',()=>{
  const links=C.searchLinks('cubao',25000);
  assert.deepEqual(links.map(l=>l.site),['Lamudi','Carousell','Facebook Marketplace']);
  assert.equal(links[0].url,'https://www.lamudi.com.ph/rent/metro-manila/quezon-city/cubao-1/condo/');
  assert.match(links[2].url,/maxPrice=25000$/);
  assert.deepEqual(C.searchLinks('mars',25000),[]);
  assert.equal(C.imageUrl('https://pix.dotproperty.co.th/x'),'https://pix.dotproperty.co.th/x');assert.equal(C.imageUrl('http://pix.dotproperty.co.th/x'),'');
});

test('area and size filters work on saved and hidden views without applying the search budget',()=>{
  const f=feed([unit({price:29000}),unit({id:'hop:b',area:'bgc',beds:0})]);
  const p={budget:20000,saved:{'dot:a':{},'hop:b':{}},hidden:['dot:a','hop:b']};
  for(const view of ['shortlist','hidden']){
    assert.deepEqual(C.matchItems(f,p,{view,area:'ortigas'}).map(i=>i.id),['dot:a']);
    assert.deepEqual(C.matchItems(f,p,{view,size:'studio'}).map(i=>i.id),['hop:b']);
  }
});

test('malformed listing ids and prices cannot become action buttons or results',()=>{
  const f=feed([unit({id:"dot:x');alert(1)//"}),unit({id:'dot:infinite',price:Infinity}),unit({id:'dot:text',price:'20000'}),unit()]);
  assert.deepEqual(C.matchItems(f,{}).map(i=>i.id),['dot:a']);
  assert.equal(C.isNew(unit({firstSeen:'2026-11-01T23:00:00Z'}),f),false);
});

test('agent enquiry asks about the actual price, costs and viewing without assuming availability',()=>{
  const text=C.enquiry(unit({building:'Sapphire Bloc',textPrice:28000}));
  assert.match(text,/Sapphire Bloc in Ortigas still available/);
  assert.match(text,/₱24,000[\s\S]*₱28,000/);
  assert.match(text,/association dues included[\s\S]*total move-in cash[\s\S]*view the unit/);
  assert.ok(text.endsWith('https://www.dotproperty.com.ph/ads/a'));
});
