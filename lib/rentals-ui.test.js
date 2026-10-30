import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const at='2026-10-31T23:00:00.000Z';
const unit=o=>({id:'dot:a',source:'DotProperty',area:'ortigas',url:'https://www.dotproperty.com.ph/ads/a',price:24000,beds:1,sqm:32,building:'The Sapphire Bloc',locality:'San Antonio, Pasig',near:'MRT-3 Ortigas',seller:'Jane',verified:true,furnish:'Fully furnished',stay:'long',deposit:2,advance:1,detailAt:at,firstSeen:'2026-10-29T23:00:00.000Z',...o});
const feed=items=>({generatedAt:at,trackingSince:'2026-10-29T23:00:00.000Z',benchmarks:{ortigas:{'1br':{n:53,medianRent:28000,medianPerSqm:800,sized:42}}},sources:[],items});
function env(overrides={}){
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',checked:false});return elements.get(id);};
  ['rentals-view','rentals-sort'].forEach(id=>get(id));get('rentals-view').value='all';get('rentals-sort').value='value';
  const c={URL,Date,Intl,console,Promise,Array,Object,Math,Number,String,document:{getElementById:get},fbLoadRentals:async()=>({feed:feed([unit()]),prefs:{}}),fbSaveRentalPrefs:async()=>{},...overrides};
  c.globalThis=c;vm.createContext(c);
  for(const f of ['rentals-core.js','rentals-ui.js'])vm.runInContext(readFileSync(new URL(f,import.meta.url),'utf8'),c);
  return {c,get};
}
test('a card states rent, size, value for the area, terms and move-in cash',async()=>{
  const {c,get}=env();await c.renderRentals();const html=get('rentals-results').innerHTML;
  assert.match(html,/The Sapphire Bloc[\s\S]*₱24,000 <span>a month[\s\S]*1 bedroom · 32 m² · ₱750\/m²/);
  assert.match(html,/6% below the Ortigas 1-bedroom median \(₱800\/m², 42 listings\)/);
  assert.match(html,/Terms:<\/b> 2 months deposit · 1 month advance/);
  assert.match(html,/Move-in cash:<\/b> about ₱72,000 \(3 months as stated\)/);
  assert.doesNotMatch(html,/<span>New<\/span>/,'first day of tracking');
  assert.match(get('rentals-glance').innerHTML,/<b>1<\/b><span>Within ₱25,000 in your areas/);
  assert.match(get('rentals-glance').innerHTML,/Ortigas<\/th><td><span>too few<\/span><\/td><td>₱28,000/);
});
test('unstated terms say so, and checks flag what to ask',async()=>{
  const {c,get}=env({fbLoadRentals:async()=>({feed:feed([unit({deposit:null,advance:null,detailAt:null,textPrice:28000,stay:'both',building:null,beds:null,sqm:null})]),prefs:{}})});
  await c.renderRentals();const html=get('rentals-results').innerHTML;
  assert.match(html,/Terms:<\/b> not stated in the listing/);
  assert.match(html,/about ₱72,000 if it is the usual 2 months deposit \+ 1 month advance \(not stated\)/);
  assert.match(html,/mentions ₱28,000 a month; ask which is right\. Short stays are offered too; confirm a long lease\. Listing page not read yet/);
  assert.match(html,/<h3>Bedrooms not stated in San Antonio<\/h3>/);
});
test('listing text is escaped and only the two sites are linked',async()=>{
  const {c,get}=env({fbLoadRentals:async()=>({feed:feed([unit({building:'<img src=x onerror=alert(1)>',seller:'"><b>x'}),unit({id:'dot:evil',url:'https://evil.example/ad'})]),prefs:{}})});
  await c.renderRentals();const html=get('rentals-results').innerHTML;
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/<img src=x/);assert.doesNotMatch(html,/evil\.example/);
});
test('shortlist, stage and hide save to the account without losing the search',async()=>{
  let last;const {c,get}=env({fbLoadRentals:async()=>({feed:feed([unit()]),prefs:{budget:22000,areas:['ortigas']}}),fbSaveRentalPrefs:async p=>{last=p;}});
  await c.renderRentals();
  assert.match(get('rentals-results').innerHTML,/No condos match/,'over the saved ₱22,000 budget');
  await c.saveRentalSearch({querySelectorAll:sel=>(sel.includes('area')?['ortigas']:sel.includes('size')?['studio','1br']:[]).map(v=>({value:v})),elements:{namedItem:k=>({budget:{value:'25000'},furnish:{value:'any'},hideShortStays:{checked:true}})[k]}});
  assert.equal(last.budget,25000);assert.deepEqual([...last.areas],['ortigas']);
  await c.shortlistRental('dot:a');assert.equal(last.saved['dot:a'].status,'Shortlisted');assert.equal(last.budget,25000);
  assert.match(get('rentals-results').innerHTML,/Shortlisted · remove[\s\S]*<option selected>Shortlisted<\/option>/);
  await c.setRentalStage('dot:a','Viewing booked');assert.equal(last.saved['dot:a'].status,'Viewing booked');
  await c.hideRental('dot:a',true);assert.deepEqual([...last.hidden],['dot:a']);assert.equal(last.saved['dot:a'],undefined);
  assert.match(get('rentals-results').innerHTML,/No condos match/);
  get('rentals-view').value='hidden';c.renderRentalList();assert.match(get('rentals-results').innerHTML,/Show again/);
  await c.hideRental('dot:a',false);await c.shortlistRental('dot:a');await c.shortlistRental('dot:let');
  get('rentals-view').value='shortlist';c.renderRentalList();
  assert.match(get('rentals-summary').textContent,/^1 condo on your shortlist · 1 shortlisted listing is missing from this scout; availability unknown/);
  assert.match(get('rentals-results').innerHTML,/dot:let · Shortlisted[\s\S]*Remove from shortlist/);
  await c.shortlistRental('dot:let');assert.equal(last.saved['dot:let'],undefined);
});
test('a failed save keeps the earlier choices; sign-out clears the page',async()=>{
  const {c,get}=env({fbSaveRentalPrefs:async()=>{throw Error('denied');}});
  await c.renderRentals();await c.shortlistRental('dot:a');
  assert.match(get('rentals-status').textContent,/Could not save/);assert.doesNotMatch(get('rentals-results').innerHTML,/Shortlisted · remove/);
  c.resetRentals();assert.equal(get('rentals-results').innerHTML,'');assert.equal(get('rentals-glance').innerHTML,'');
});
test('the more-places links follow the saved areas and budget',async()=>{
  const {c,get}=env({fbLoadRentals:async()=>({feed:null,prefs:{areas:['cubao','bgc'],areaVersion:3,budget:20000}})});
  await c.renderRentals();const html=get('rentals-more').innerHTML;
  assert.match(html,/<b>Cubao<\/b>[\s\S]*lamudi\.com\.ph\/rent\/metro-manila\/quezon-city\/cubao-1\/condo\/[\s\S]*<b>BGC<\/b>/);
  assert.match(html,/maxPrice=20000/);assert.doesNotMatch(html,/Ortigas/);
  assert.match(get('rentals-status').textContent,/first daily run is at 07:00 PHT/);
});

test('partial move-in terms show a lower bound and the benchmark explains its coverage',async()=>{
  const {c,get}=env({fbLoadRentals:async()=>({feed:feed([unit({advance:null,duesIncluded:false})]),prefs:{}})});
  await c.renderRentals();
  assert.match(get('rentals-results').innerHTML,/Move-in cash:<\/b> at least ₱48,000[\s\S]*Confirm other fees and association dues/);
  assert.match(get('rentals-glance').innerHTML,/not the full market/);
});

test('a failed stage save restores the saved stage and reload cannot race an active save',async()=>{
  let rejectSave,loads=0;
  const {c,get}=env({fbLoadRentals:async()=>{loads++;return {feed:feed([unit()]),prefs:{saved:{'dot:a':{status:'Messaged'}}}};},fbSaveRentalPrefs:()=>new Promise((_,reject)=>{rejectSave=reject;})});
  await c.renderRentals();const saving=c.setRentalStage('dot:a','Viewed');
  assert.match(get('rentals-results').innerHTML,/<select disabled/);
  await c.renderRentals();assert.equal(loads,1);
  rejectSave(Error('offline'));await saving;
  assert.match(get('rentals-results').innerHTML,/<option selected>Messaged<\/option>/);
  assert.doesNotMatch(get('rentals-results').innerHTML,/<select disabled/);
});

test('agent drafts are escaped, editable, copied on request and cleared on sign-out',async()=>{
  let copied='';
  const {c,get}=env({navigator:{clipboard:{writeText:async text=>{copied=text;}}},fbLoadRentals:async()=>({feed:feed([unit({building:'</textarea><script>x</script>'})]),prefs:{}})});
  get('rentals-enquiry').scrollIntoView=()=>{};
  get('rentals-enquiry-text').focus=()=>{};
  await c.renderRentals();c.prepareRentalEnquiry('dot:a');
  assert.equal(get('rentals-enquiry').hidden,false);
  assert.match(get('rentals-enquiry').innerHTML,/&lt;\/textarea&gt;&lt;script&gt;/);
  assert.doesNotMatch(get('rentals-enquiry').innerHTML,/<script>/);
  get('rentals-enquiry-text').value='My edited enquiry';await c.copyRentalEnquiry();assert.equal(copied,'My edited enquiry');
  c.resetRentals();assert.equal(get('rentals-enquiry').hidden,true);assert.equal(get('rentals-enquiry').innerHTML,'');
});

test('clipboard failure selects the draft for manual copy',async()=>{
  const {c,get}=env();let selected=false;get('rentals-enquiry-text').focus=()=>{};get('rentals-enquiry-text').select=()=>{selected=true;};
  await c.copyRentalEnquiry();assert.equal(selected,true);assert.match(get('rentals-status').textContent,/Ctrl\+C/);
});

test('a late load or save after sign-out cannot restore private choices',async()=>{
  let finishLoad;
  const {c,get}=env({fbLoadRentals:()=>new Promise(resolve=>{finishLoad=resolve;})});
  const loading=c.renderRentals();c.resetRentals();finishLoad({feed:feed([unit()]),prefs:{saved:{'dot:a':{}}}});await loading;
  assert.equal(get('rentals-results').innerHTML,'');
  c.fbLoadRentals=async()=>({feed:feed([unit()]),prefs:{}});await c.renderRentals();
  let finishSave;c.fbSaveRentalPrefs=()=>new Promise(resolve=>{finishSave=resolve;});
  const saving=c.shortlistRental('dot:a');c.resetRentals();finishSave();await saving;
  assert.equal(get('rentals-results').innerHTML,'');assert.equal(get('rentals-status').textContent,'');
});

test('an existing search includes airport areas and renders their filters, terms and manual links',async()=>{
  const {c,get}=env({fbLoadRentals:async()=>({feed:feed([unit({id:'dot:airport',area:'naia',building:'Newport unit'}),unit({id:'dot:clark',area:'clark',building:'Anunas unit'})]),prefs:{budget:25000,areas:['cubao','bgc']}})});
  await c.renderRentals();
  assert.match(get('rentals-search').innerHTML,/value="naia" checked[\s\S]*value="clark" checked/);
  assert.match(get('rentals-results').innerHTML,/Newport unit[\s\S]*Anunas unit/);
  get('rentals-area').value='clark';c.renderRentalList();
  assert.match(get('rentals-results').innerHTML,/Clark area[\s\S]*Anunas unit/);assert.doesNotMatch(get('rentals-results').innerHTML,/Newport unit/);
  assert.match(get('rentals-more').innerHTML,/Clark%20Pampanga/);
});

test('Entertainment City view shows a shared NAIA listing once with both area labels',async()=>{
  const {c,get}=env({fbLoadRentals:async()=>({feed:feed([unit({area:'naia',areas:['naia','entertainment'],building:'Bay unit'})]),prefs:{areas:['entertainment'],areaVersion:3}})});
  get('rentals-area').value='entertainment';await c.renderRentals();
  assert.match(get('rentals-results').innerHTML,/NAIA area \/ Entertainment City area/);
  assert.equal((get('rentals-results').innerHTML.match(/<article /g)||[]).length,1);
  assert.match(get('rentals-search').innerHTML,/value="entertainment" checked/);
});
