const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('./trip-activities');
const trip={city:'Manila',start:'2026-11-20',end:'2026-11-23',base:'Hotel in Makati',interests:'Local history and quiet walks; avoid crowded malls',pace:'relaxed',budget:1500,busy:['2026-11-21'],requestId:'activity-test-01',generate:true};
const source={id:'guide0',url:A.GUIDES.Manila[0],content:'Explore Intramuros for its historic streets and architecture. '.repeat(12)};
const activity={name:'Intramuros',sourceId:'guide0',evidence:'Explore Intramuros for its historic streets and architecture.',date:'2026-11-22',slot:'morning',whyFit:'Your interest in history makes this a focused alternative to shopping.',tradeoff:'Check the route from your Makati base before committing to the outing.',check:'Confirm visitor access and current admission on the destination website.'};
const response=()=>new Response('<html><body>'+source.content+'</body></html>',{headers:{'content-type':'text/html'}});
test('provider schema omits unsupported array bounds while the cleaner enforces three options',()=>{
  assert.equal(A.SCHEMA.properties.activities.minItems,1);
  assert.equal(Object.hasOwn(A.SCHEMA.properties.activities,'maxItems'),false);
  assert.throws(()=>A.clean({activities:[activity,activity,activity,activity]},A.normalize(trip),[source]));
});
function database(){const records=new Map();let chain=Promise.resolve();const ref=key=>({key,get:async()=>({exists:records.has(key),data:()=>records.get(key)}),set:async(value,opts)=>records.set(key,opts && opts.merge?{...records.get(key),...value}:value)});return {records,collection:name=>({doc:id=>ref(name+'/'+id)}),runTransaction:fn=>{let run=chain.then(()=>fn({get:r=>r.get(),set:(r,v)=>records.set(r.key,v)}));chain=run.catch(()=>{});return run;}};}
test('requires a real base, specific interests, valid dates and reserved days',()=>{
  for(const patch of [{base:''},{interests:'anything'},{end:'2026-02-30'},{busy:['2026-12-01']},{city:'Unknown city'},{start:'2026-99-99'}])assert.throws(()=>A.normalize({...trip,...patch}));
  assert.equal(A.normalize(trip).city,'Manila');
});
test('rejects fabricated sources, names, exact operational claims and reserved-day scheduling',()=>{
  assert.equal(A.clean({activities:[activity]},A.normalize(trip),[source]).activities[0].url,source.url);
  for(const patch of [{name:'Invented Museum'},{sourceId:'https://attacker.test'},{date:'2026-11-21'},{date:trip.start,slot:'morning'},{whyFit:'Admission costs ₱500 per person.'},{tradeoff:'Walking distance from the hotel.'},{evidence:'Intramuros has an invented exhibit.'}])assert.throws(()=>A.clean({activities:[{...activity,...patch}]},A.normalize(trip),[source]));
  assert.throws(()=>A.clean({activities:[activity,activity]},A.normalize(trip),[source]));
});
test('free time is allowed, while free admission and precise journey claims remain blocked',()=>{
  assert.equal(A.clean({activities:[{...activity,whyFit:'Use your free arrival day for a flexible history stop.'}]},A.normalize(trip),[source]).activities.length,1);
  for(const whyFit of ['This stop offers free admission to visitors.','It takes a 30-minute ride from your hotel.','Entry is guaranteed for visitors.'])assert.throws(()=>A.clean({activities:[{...activity,whyFit}]},A.normalize(trip),[source]));
});
test('opening and cache reuse incur no model/source calls; exact preferences and UID separate caches',async()=>{
  const db=database();let models=0,fetches=0;const options={db,uid:'bob',data:trip,period:'2026-10-14',fetchImpl:async()=>{fetches++;return response();},generate:async()=>{models++;return {activities:[activity]};}};
  assert.equal((await A.run({...options,data:{...trip,generate:false}})).plan,null);assert.equal(models,0);assert.equal(fetches,0);
  await A.run(options);assert.equal(models,1);
  assert.equal((await A.run({...options,data:{...trip,requestId:'activity-test-02'}})).cached,true);assert.equal(models,1);assert.equal(fetches,1);
  assert.ok((await A.run({...options,data:{city:trip.city,start:trip.start,end:trip.end,loadTrip:true}})).plan);assert.equal(fetches,1);
  assert.equal((await A.run({...options,uid:'other',data:{...trip,generate:false}})).plan,null);
  assert.equal((await A.run({...options,data:{...trip,interests:'Different preferences and interests',generate:false}})).plan,null);
  assert.equal((await A.run({...options,data:{...trip,loadTrip:true,commitments:'Poker trip'}})).plan,null);
});
test('source failures and fully reserved trips never start a paid call; refreshes stop at the daily cap',async()=>{
  const db=database();let models=0;const options={db,uid:'bob',data:trip,period:'2026-10-14',generate:async()=>{models++;return {activities:[activity]};},fetchImpl:async()=>new Response('unavailable',{status:403})};
  await assert.rejects(A.run(options),{code:'unavailable'});assert.equal(models,0);assert.equal(db.records.size,0);
  await assert.rejects(A.run({...options,data:{...trip,busy:['2026-11-20','2026-11-21','2026-11-22','2026-11-23']}}),{code:'failed-precondition'});
  for(let i=0;i<3;i++)await A.run({...options,fetchImpl:response,data:{...trip,refresh:true,requestId:'refresh-trip-'+i}});
  await assert.rejects(A.run({...options,fetchImpl:response,data:{...trip,refresh:true,requestId:'refresh-trip-4'}}),{code:'resource-exhausted'});assert.equal(models,3);
});
test('never follows guide redirects or accepts storefront/error content as travel evidence',async()=>{
  let mode;await A.sourcesFor({city:'Manila'},async(_,options)=>{mode=options.redirect;return response();});assert.equal(mode,'error');
  await assert.rejects(A.sourcesFor({city:'Manila'},async()=>new Response('The store will not work '+source.content,{headers:{'content-type':'text/html'}})),{code:'unavailable'});
});
