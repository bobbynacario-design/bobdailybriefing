const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('./trip-activities');
const trip={city:'Manila',start:'2026-11-20',end:'2026-11-23',base:'Hotel in Makati',interests:'Local history and quiet walks; avoid crowded malls',pace:'relaxed',budget:1500,busy:['2026-11-21'],requestId:'activity-test-01',generate:true};
const source={id:'guide0',url:A.GUIDES.Manila[0],content:'Explore Intramuros for its historic streets and architecture. '.repeat(12)};
const activity={name:'Intramuros',role:'plan',kind:'heritage',effort:'light',sourceId:'guide0',evidence:'Explore Intramuros for its historic streets and architecture.',date:'2026-11-22',slot:'morning',whyFit:'Your interest in history makes this a focused alternative to shopping.',tradeoff:'Check the route from your Makati base before committing to the outing.',check:'Confirm visitor access and current admission on the destination website.'};
const response=()=>new Response('<html><body>'+source.content+'</body></html>',{headers:{'content-type':'text/html'}});
test('Ximen arrival day keeps one local sight and one local food pick, never a remote market or departure outing',()=>{
  const context=A.normalize({...trip,city:'Taipei',base:'Fictional hotel in Ximen',busy:['2026-11-21','2026-11-22']});
  const make=(name,date,kind='night-market',effort='light')=>({...activity,name,date,kind,effort,slot:'flexible',evidence:name+' is listed in the destination guide.'});
  const rows=[make('Huaxi Street Tourist Night Market',trip.start),make('Shilin Night Market',trip.end),make('The Red House',trip.start,'culture')];
  const sources=[{...source,content:rows.map(a=>a.evidence).join(' ')}];
  const plan=A.clean({activities:rows},context,sources);
  assert.deepEqual(plan.activities.map(a=>a.name),['The Red House','Huaxi Street Tourist Night Market']);
  assert.match(plan.activities[0].areaFit,/Ximen/);assert.match(plan.notes.join(' '),/Departure day/);
  assert.equal(A.availableDays(context).length,1);
});
test('different market names cannot fill multiple slots; seasonal titles and heavy arrival outings are excluded',()=>{
  const make=(name,date,kind='food',effort='light')=>({...activity,name,date,kind,effort,slot:'flexible',evidence:name+' is listed in the destination guide.'});
  const rows=[make('First Night Market',trip.start),make('Second Night Market','2026-11-22'),make('Lunar New Year Shopping Area','2026-11-22','shopping')];
  const sources=[{...source,content:rows.map(a=>a.evidence).join(' ')}];
  assert.equal(A.clean({activities:rows},A.normalize(trip),sources).activities.length,1);
  const heavy=make('Full Day Boat Tour',trip.start,'nature','full-day');
  assert.equal(A.clean({activities:[heavy]},A.normalize(trip),[{...source,content:heavy.evidence}]).activities.length,0);
});
test('no arrival/interior availability stops before any model call, even if departure day is free',async()=>{
  let calls=0;await assert.rejects(A.run({db:database(),uid:'bob',data:{...trip,busy:['2026-11-20','2026-11-21','2026-11-22']},period:'2026-10-14',generate:async()=>{calls++;},fetchImpl:response}),{code:'failed-precondition'});assert.equal(calls,0);
});
test('provider schema omits unsupported array bounds while the cleaner enforces three options',()=>{
  assert.equal(A.SCHEMA.properties.activities.minItems,0);
  assert.equal(Object.hasOwn(A.SCHEMA.properties.activities,'maxItems'),false);
  const plan=A.clean({activities:[activity,activity,activity,activity]},A.normalize(trip),[source]);
  assert.equal(plan.activities.length,1);assert.match(plan.notes.join(' '),/3 suggestions were left out/);
});
function database(){const records=new Map();let chain=Promise.resolve();const ref=key=>({key,get:async()=>({exists:records.has(key),data:()=>records.get(key)}),set:async(value,opts)=>records.set(key,opts && opts.merge?{...records.get(key),...value}:value)});return {records,collection:name=>({doc:id=>ref(name+'/'+id)}),runTransaction:fn=>{let run=chain.then(()=>fn({get:r=>r.get(),set:(r,v)=>records.set(r.key,v)}));chain=run.catch(()=>{});return run;}};}
test('requires a real base, specific interests, valid dates and reserved days',()=>{
  for(const patch of [{base:''},{interests:'anything'},{end:'2026-02-30'},{busy:['2026-12-01']},{city:'Unknown city'},{start:'2026-99-99'}])assert.throws(()=>A.normalize({...trip,...patch}));
  assert.equal(A.normalize(trip).city,'Manila');
});
test('rejects fabricated sources, names, exact operational claims and reserved-day scheduling',()=>{
  assert.equal(A.clean({activities:[activity]},A.normalize(trip),[source]).activities[0].url,source.url);
  for(const patch of [{name:'Invented Museum'},{sourceId:'https://attacker.test'},{date:'2026-11-21'},{whyFit:'Admission costs ₱500 per person.'},{tradeoff:'Walking distance from the hotel.'},{evidence:'Intramuros has an invented exhibit.'}])assert.throws(()=>A.clean({activities:[{...activity,...patch}]},A.normalize(trip),[source]));
  const once=A.clean({activities:[activity,activity]},A.normalize(trip),[source]);assert.equal(once.activities.length,1);assert.match(once.notes.join(' '),/1 suggestion was left out/);
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
test('the page offers the activity button for exactly the cities that have guides',()=>{
  assert.deepEqual([...require('./flights-core').activityCities].sort(),Object.keys(A.GUIDES).sort());
});
test('one failed option is left out while the verified ones are kept; all failing saves nothing',()=>{
  const ok={...activity},bad={...activity,name:'Invented Museum'},priced={...activity,date:'2026-11-20',slot:'flexible',name:'Explore Intramuros',whyFit:'Admission costs ₱500 per person.'};
  const plan=A.clean({activities:[bad,ok]},A.normalize(trip),[source]);
  assert.deepEqual(plan.activities.map(a=>a.name),['Intramuros']);assert.match(plan.notes.join(' '),/1 suggestion was left out/);
  assert.throws(()=>A.clean({activities:[bad,priced]},A.normalize(trip),[source]),/could not be verified/);
  assert.equal(A.clean({activities:[]},A.normalize(trip),[source]).activities.length,0);
});
test('guide text decodes hex and named entities so quoted evidence with real punctuation matches',()=>{
  assert.equal(A.htmlText('<p>the country&#x27;s culture &hellip; Manila&rsquo;s parks &amp;quot; &#39;x&#39; &bogus;</p>'),"the country's culture … Manila’s parks &quot; 'x' &bogus;");
  const content=A.htmlText('<p>'+'Visit Rizal Park for Manila&rsquo;s greenest open space today. '.repeat(10)+'</p>');
  const park={...activity,name:'Rizal Park',evidence:"Visit Rizal Park for Manila's greenest open space today."};
  assert.equal(A.clean({activities:[park]},A.normalize(trip),[{...source,content}]).activities.length,1);
});
test('the scout spelling Macao reaches the Macau guide',()=>{
  assert.equal(A.normalize({...trip,city:'Macao'}).city,'Macau');assert.equal(A.normalize({...trip,city:'macau'}).city,'Macau');
});
test('a morning on arrival day is filtered by the day rules, not counted as a failed check',()=>{
  const plan=A.clean({activities:[{...activity,date:trip.start,slot:'morning'}]},A.normalize(trip),[source]);
  assert.equal(plan.activities.length,0);assert.doesNotMatch(plan.notes.join(' '),/left out/);
});
test('poker days get one light local morning before play and up to three backups anywhere; departure stays empty',()=>{
  const context=A.normalize({...trip,city:'Taipei',start:'2026-11-12',end:'2026-11-15',base:'Muzik Hotel - Ximen Station Branch',busy:[],pokerDays:['2026-11-13','2026-11-14']});
  assert.deepEqual(A.tripDays(context),[{date:'2026-11-12',type:'arrival'},{date:'2026-11-13',type:'poker'},{date:'2026-11-14',type:'poker'}]);
  const make=(name,role,date,kind,effort='light',slot='flexible')=>({...activity,name,role,date,kind,effort,slot,evidence:name+' is listed in the destination guide.'});
  const rows=[
    make('The Red House','plan','2026-11-12','culture'),
    make('Huaxi Street Tourist Night Market','plan','2026-11-12','night-market'),
    make('Lungshan Temple','before-play','2026-11-13','heritage','light','morning'),
    make('Bopiliao Old Street','before-play','2026-11-13','walk','light','morning'),
    make('Shilin Night Market','if-you-bust','2026-11-13','night-market','moderate','evening'),
    make('National Palace Museum','if-you-bust','2026-11-14','culture','full-day','afternoon'),
    make('Elephant Mountain','if-you-bust','2026-11-14','nature','moderate','afternoon'),
    make('Dihua Street','if-you-bust','2026-11-13','shopping','moderate','afternoon'),
    make('Raohe Street','if-you-bust','2026-11-14','walk','moderate','evening'),
    make('Taipei Zoo','plan','2026-11-13','nature','moderate','afternoon'),
    make('Xinyi Shopping','plan','2026-11-15','shopping')
  ];
  const plan=A.clean({activities:rows},context,[{...source,content:rows.map(a=>a.evidence).join(' ')}]);
  const by=role=>plan.activities.filter(a=>a.role===role).map(a=>a.name);
  assert.deepEqual(by('plan'),['The Red House','Huaxi Street Tourist Night Market']);
  assert.deepEqual(by('before-play'),['Lungshan Temple']);
  assert.deepEqual(by('if-you-bust'),['National Palace Museum','Elephant Mountain','Dihua Street']);
  assert.match(plan.notes.join(' '),/backups if you bust early/);
});
test('poker days must fall inside the trip and are never also reserved days',()=>{
  assert.throws(()=>A.normalize({...trip,pokerDays:['2026-12-01']}));
  assert.deepEqual(A.normalize({...trip,pokerDays:['2026-11-21','2026-11-22']}).pokerDays,['2026-11-22']);
});
