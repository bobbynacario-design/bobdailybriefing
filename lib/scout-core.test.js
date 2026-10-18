import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={URL,Intl,Date};vm.createContext(context);vm.runInContext(readFileSync(new URL('./scout-core.js',import.meta.url),'utf8'),context);
const C=context.ScoutCore;
const event={title:'Claims seminar',lane:'work',url:'https://organiser.example/event',start:'2026-10-25',deadline:'2026-10-21'};
test('Scout rejects unsourced links, invalid dates and closed registration while retaining ongoing exhibits and communities',()=>{
  const rows=C.clean([event,{...event,url:'javascript:alert(1)'},{...event,url:'https://other.example'},
    {...event,url:'https://organiser.example/old',deadline:'2026-10-17'},
    {...event,url:'https://organiser.example/bad',start:'2026-02-30'},
    {...event,url:'https://organiser.example/exhibit',start:'2026-10-01',end:'2026-11-01',deadline:''},
    {...event,url:'https://organiser.example/group',kind:'community',start:'',deadline:'',lastActive:'2026-10-01'}],null,'2026-10-18');
  assert.equal(rows.length,4);assert.equal(C.clean([event],['https://other.example'],'2026-10-18').length,0);
  assert.equal(C.clean([event,event],null,'2026-10-18').length,1);
  assert.equal(rows[0].cost,'Cost not listed');assert.equal(rows[3].start,'');
});
test('Today only surfaces saved or interested opportunities with an open deadline in the next seven days',()=>{
  const rows=C.clean([event,{...event,url:'https://organiser.example/later',deadline:'2026-11-01'},{...event,url:'https://organiser.example/hidden'}]);
  const choices=Object.fromEntries(rows.map(v=>[v.id,{saved:true}]));choices[rows[2].id].hidden=true;
  assert.equal(C.due(rows,choices,'2026-10-18').length,1);
  assert.equal(C.due(rows,choices,'2026-10-22').length,0);
  assert.equal(C.today(Date.parse('2026-10-17T18:00:00Z')),'2026-10-18');
});
test('Scout UI keeps saved cards after refresh, escapes source text, and clears private content on reset',async()=>{
  const elements={};const el=id=>elements[id]||(elements[id]={value:'',innerHTML:'',textContent:'',hidden:false});
  const item=C.clean([{...event,title:'<img onerror=bad>'}])[0];
  const ctx={URL,Intl,Date,console,document:{getElementById:el,addEventListener(){}},fbLoadScout:async()=>({feed:{items:[]},choices:{[item.id]:{saved:true,item}}})};ctx.window=ctx;
  vm.createContext(ctx);vm.runInContext(readFileSync(new URL('./scout-core.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('./scout-ui.js',import.meta.url),'utf8'),ctx);
  el('scout-view').value='saved';await ctx.renderScout();assert.match(el('scout-results').innerHTML,/&lt;img/);assert.doesNotMatch(el('scout-results').innerHTML,/<img/);
  ctx.resetScout();assert.equal(el('scout-results').innerHTML,'');assert.equal(el('scout-interests').value,'');
  let resolve;ctx.fbLoadScout=()=>new Promise(r=>resolve=r);const pending=ctx.renderScout();ctx.resetScout();resolve({feed:{items:[item]},choices:{}});await pending;
  assert.equal(el('scout-results').innerHTML,'','late old-account reads cannot repopulate Scout');
});
test('Scout shows published start times in PHT and keeps at most one AI pick and no poker',()=>{
  assert.equal(C.phtTime('2026-11-17','08:30','AEDT'),'05:30 PHT (08:30 AEDT)');
  assert.equal(C.phtTime('2026-11-17','08:30','UTC+11'),'05:30 PHT (08:30 UTC+11:00)');
  assert.equal(C.phtTime('2026-11-17','19:00','EST'),'08:00 PHT (next day) (19:00 EST)');
  assert.equal(C.phtTime('2026-11-17','01:00','AEDT'),'22:00 PHT (previous day) (01:00 AEDT)');
  assert.equal(C.phtTime('2026-11-04','09:00','PHT'),'09:00 PHT');
  assert.equal(C.phtTime('2026-11-04','09:00','PST','Makati City'),'09:00 PHT');
  assert.equal(C.phtTime('2026-11-04','09:00','CST'),'','ambiguous zones are not converted');
  assert.equal(C.phtTime('2026-11-04','9am','AEDT'),'');
  const base={lane:'work',start:'2026-11-17',kind:'event'};
  const rows=C.clean([{...base,title:'Australian Liability Conference',url:'https://anziif.example/liability',format:'hybrid',time:'08:30',timezone:'AEDT',location:'Sydney & Online'},
    {...base,title:'AI Pilipinas community',url:'https://ai.example/one',topic:'AI community'},{...base,title:'Lead through AI',url:'https://ai.example/two'},
    {...base,title:'Data Engineering Pilipinas',url:'https://ai.example/three',topic:'data engineering'},{...base,title:'Manila Poker Series',url:'https://poker.example/'},
    {...base,lane:'interests',title:'Ai Weiwei retrospective',url:'https://art.example/ai-weiwei',format:'onsite'}],null,'2026-10-18');
  assert.deepEqual(Array.from(rows,v=>v.title),['Australian Liability Conference','AI Pilipinas community','Ai Weiwei retrospective']);
  assert.equal(rows[0].pht,'05:30 PHT (08:30 AEDT)');assert.equal(rows[0].format,'hybrid');assert.equal(rows[2].format,'');
  assert.equal(C.clean([rows[0]])[0].pht,rows[0].pht,'a saved card keeps its PHT time');
});
test('Scout card shows the PHT start and whether you can join online',async()=>{
  const elements={};const el=id=>elements[id]||(elements[id]={value:'',innerHTML:'',textContent:'',hidden:false});
  const item=C.clean([{...event,format:'hybrid',time:'08:30',timezone:'AEDT',location:'Sydney & Online'}])[0];
  const ctx={URL,Intl,Date,console,document:{getElementById:el,addEventListener(){}},fbLoadScout:async()=>({feed:{items:[item]},choices:{}})};ctx.window=ctx;
  vm.createContext(ctx);vm.runInContext(readFileSync(new URL('./scout-core.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('./scout-ui.js',import.meta.url),'utf8'),ctx);
  el('scout-view').value='all';ctx.ScoutCore.today=()=>'2026-10-18';await ctx.renderScout();
  assert.match(el('scout-results').innerHTML,/05:30 PHT \(08:30 AEDT\)/);assert.match(el('scout-results').innerHTML,/Sydney &amp; Online · Hybrid · join online/);
});
test('Scout finds a start date on its page in the forms organisers publish, and not another year',()=>{
  const pad=' '+'programme details '.repeat(15);
  const arp=C.pageText('<main><h3>Catastrophe Modeling for Underwriters and Risk Managers</h3><p>&nbsp;10 November 2026Open</p></main>'+pad);
  assert.equal(C.dateCheck(arp,'2026-11-10'),'confirmed');assert.equal(C.dateCheck(arp,'2026-10-22'),'not-found','the 18 Oct build gave this course as 22 Oct');
  const mmb=C.pageText('<p>16&ndash;30 October 2026 &ndash; Polytechnic University of the Philippines</p>'+pad);
  assert.ok(C.dateOnPage(mmb,'2026-10-16'));assert.ok(C.dateOnPage(mmb,'2026-10-30'));
  const finale=C.pageText('<div>UPCOMING SHOWS</div><div>Nov. 07 -30,</div><div>2026</div>');
  assert.ok(C.dateOnPage(finale,'2026-11-07'));assert.ok(C.dateOnPage(finale,'2026-11-30'));assert.ok(!C.dateOnPage(finale,'2026-11-03'));
  assert.ok(C.dateOnPage(C.pageText('Start: Wednesday 4 November 2026 09:00'),'2026-11-04'));
  assert.ok(C.dateOnPage(C.pageText('Tuesday, 17 November 2026'),'2026-11-17'));assert.ok(C.dateOnPage(C.pageText('Thu 15 Oct 2026, 8:30 am'),'2026-10-15'));
  assert.ok(!C.dateOnPage(C.pageText('Sept 9th'),'2026-09-09'),'a day and month without a year are not confirmed');assert.ok(C.dateOnPage(C.pageText('on 17/11/2026'),'2026-11-17'));
  assert.ok(C.dateOnPage(C.pageText('<script type="application/ld+json">{"startDate":"2026-11-17T08:00:00+11:00"}</script><p>Liability</p>'),'2026-11-17'),'event data in scripts counts');
  assert.ok(!C.dateOnPage(C.pageText('<script>var x="22 October 2026"</script>held 22 October 2025'),'2026-10-22'),'last year\'s edition is not this one');
  assert.ok(!C.dateOnPage(C.pageText('November 2026 programme'),'2026-11-02'));assert.ok(!C.dateOnPage(C.pageText('117 November'),'2026-11-17'));
  assert.equal(C.dateCheck(null,'2026-11-10'),'unchecked');assert.equal(C.dateCheck('short page','2026-11-10'),'unchecked');assert.equal(C.dateCheck(arp,''),'');
});
test('Scout keeps date checks on saved cards, flags a date not on its page, sorts it last, and keeps its deadline off Today',async()=>{
  const good=C.clean([{...event,url:'https://organiser.example/good',start:'2026-11-20',dateCheck:'confirmed'}])[0];
  const bad=C.clean([{...event,url:'https://organiser.example/bad',title:'Wrong date course',start:'2026-10-22',deadline:'2026-10-21',dateCheck:'not-found',deadlineCheck:'not-found'}])[0];
  assert.equal(bad.dateCheck,'not-found');assert.equal(C.clean([{...event,dateCheck:'confirmed-by-ai'}])[0].dateCheck,undefined,'only known check states pass');
  assert.equal(C.due([bad],{[bad.id]:{saved:true}},'2026-10-18').length,0);
  const elements={};const el=id=>elements[id]||(elements[id]={value:'',innerHTML:'',textContent:'',hidden:false});
  const ctx={URL,Intl,Date,console,document:{getElementById:el,addEventListener(){}},fbLoadScout:async()=>({feed:{items:[bad,good]},choices:{}})};ctx.window=ctx;
  vm.createContext(ctx);vm.runInContext(readFileSync(new URL('./scout-core.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('./scout-ui.js',import.meta.url),'utf8'),ctx);
  el('scout-view').value='all';ctx.ScoutCore.today=()=>'2026-10-18';await ctx.renderScout();
  const html=el('scout-results').innerHTML;
  assert.match(html,/not found on its page, check before you plan/);assert.match(html,/2026-10-21 · not found on its page/);
  assert.ok(html.indexOf('Claims seminar')<html.indexOf('Wrong date course'),'a contradicted date sorts after a confirmed one');
});
test('Scout keeps a community only while it meets and never links a sign-up page',()=>{
  const group={title:'Data Engineering Pilipinas',lane:'people',kind:'community',url:'https://www.meetup.com/data-engineering-pilipinas/'};
  const day='2026-10-18',keep=rows=>Array.from(rows,v=>v.url);
  assert.equal(C.clean([{...group,lastActive:'2026-08-31'}],null,day).length,1,'met 48 days ago');
  assert.equal(C.clean([{...group,lastActive:'2026-08-01'}],null,day).length,0,'78 days is not recent');
  assert.equal(C.clean([{...group,nextActive:'2026-11-12'}],null,day).length,1);
  assert.equal(C.clean([{...group,nextActive:'2026-10-01'}],null,day).length,0,'a "next" meeting in the past');
  assert.equal(C.clean([{...group,lastActive:'2026-11-01'}],null,day).length,0,'a "last" meeting in the future');
  assert.equal(C.clean([group],null,day).length,0,'no meeting dates at all');
  assert.equal(C.clean([group]).length,1,'a saved card without dates still shows in the app');
  assert.deepEqual(keep(C.clean(['https://www.paiba.org/becomeamember','https://example.org/join','https://example.org/membership/','https://example.org/sign-up?x=1','https://aipilipinas.ph/community/','https://example.org/events/joint-session']
    .map((url,i)=>({...group,title:'Group '+i,url,lastActive:'2026-10-01'})),null,day)),['https://aipilipinas.ph/community/','https://example.org/events/joint-session']);
  assert.equal(C.clean([{...event,url:'https://organiser.example/register'}],null,day).length,1,'an event may link its registration page');
});
test('Scout community card says when the group last met or meets next',async()=>{
  const item=C.clean([{title:'AI Pilipinas',lane:'people',kind:'community',url:'https://aipilipinas.ph/community/',lastActive:'2026-08-31',nextActive:'2026-11-12',activityCheck:'unchecked'}])[0];
  const elements={};const el=id=>elements[id]||(elements[id]={value:'',innerHTML:'',textContent:'',hidden:false});
  const ctx={URL,Intl,Date,console,document:{getElementById:el,addEventListener(){}},fbLoadScout:async()=>({feed:{items:[item]},choices:{}})};ctx.window=ctx;
  vm.createContext(ctx);vm.runInContext(readFileSync(new URL('./scout-core.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('./scout-ui.js',import.meta.url),'utf8'),ctx);
  el('scout-view').value='all';await ctx.renderScout();
  assert.match(el('scout-results').innerHTML,/Community · Next meets 2026-11-12 · Last met 2026-08-31 · its page could not be read to check/);
});
test('Scout reads timezones written out in full or as bare offsets',()=>{
  assert.equal(C.phtTime('2026-10-24','09:00','Philippine Standard Time'),'09:00 PHT','the 18 Oct Intramuros tour');
  assert.equal(C.phtTime('2026-11-14','15:00','+0800'),'15:00 PHT','the 18 Oct Ayala Museum talk');
  assert.equal(C.phtTime('2026-11-17','08:30','Australian Eastern Daylight Time'),'05:30 PHT (08:30 AEDT)');
  assert.equal(C.phtTime('2026-11-17','19:00','-05:00'),'08:00 PHT (next day) (19:00 UTC-05:00)');
  assert.equal(C.phtTime('2026-11-17','09:00','+15'),'');assert.equal(C.phtTime('2026-11-17','09:00','Eastern Time'),'');
  assert.equal(C.clean([{...event,time:'09:00',timezone:'Philippine Standard Time'}])[0].zone,'Philippine Standard Time','long names are kept whole');
});
test('Scout refuses staging copies of a site, says who may attend, and drops a reason that recites its rules',()=>{
  const rows=C.clean([{...event,url:'https://sc104-prod-cd-staging.anziif.com/webinars/ai'},{...event,url:'https://uat.example.org/e'},{...event,url:'https://dev.to/events/1'},
    {...event,url:'https://anziif.com/webinars/ai',access:'members',why:'The single AI pick: it is claims-specific.'},{...event,url:'https://organiser.example/vip',access:'vip',why:'Fits his liability files.'}],null,'2026-10-18');
  assert.deepEqual(Array.from(rows,v=>v.url),['https://dev.to/events/1','https://anziif.com/webinars/ai','https://organiser.example/vip']);
  assert.equal(rows[1].access,'members');assert.equal(rows[2].access,'');assert.equal(rows[1].why,'It is claims-specific.');assert.equal(rows[2].why,'Fits his liability files.');
  assert.ok(C.membersOnly(C.pageText('<p>Open to all AICLA members</p><p>No cost to attend</p>')),'the 18 Oct AICLA webinar page');
  assert.ok(C.membersOnly('this is a members-only webinar'));assert.ok(C.membersOnly('available only to institute members'));
  assert.ok(!C.membersOnly('open to members and non-members'));assert.ok(!C.membersOnly('member: $669 non-member: $803'));assert.ok(!C.membersOnly('members only area login'));
});
test('Scout counts what each lane returned and why picks were left out',()=>{
  const stats={},day='2026-10-18',group={lane:'people',kind:'community'};
  const rows=C.clean([{...event,url:'https://a.example/1'},{...event,url:'https://a.example/1'},{...event,url:'https://a.example/2',start:''},{...event,url:'https://a.example/3',deadline:'2026-10-01'},
    {...event,url:'https://b.example/x'},{...event,url:'https://test.a.example/4'},{...group,title:'G1',url:'https://g.example/join'},{...group,title:'G2',url:'https://g.example/quiet',lastActive:'2026-06-01'},
    {...event,lane:'interests',title:'Manila Poker Series',url:'https://a.example/5'},{...event,lane:'elsewhere',url:'https://a.example/6'}],['https://a.example/1','https://a.example/2','https://a.example/3','https://test.a.example/4','https://g.example/join','https://g.example/quiet','https://a.example/5'],day,stats);
  C.kept(stats,rows);
  assert.equal(stats.invalid,1);
  assert.deepEqual(JSON.parse(JSON.stringify(stats.lanes)),{work:{returned:6,kept:1,dropped:{duplicate:1,date:1,past:1,source:1,host:1}},people:{returned:2,kept:0,dropped:{signup:1,inactive:1}},interests:{returned:1,kept:0,dropped:{poker:1}}});
  assert.equal(C.laneNote(stats.lanes.people),'None this week: the search returned 2; left out: 1 a sign-up or membership page, 1 no meeting in the last 60 days or the next 90.');
  assert.equal(C.laneNote(undefined),'None this week: the search found none.');
  const many=Array.from({length:14},(_,i)=>({...event,lane:'interests',url:'https://m.example/'+i})),s2={};
  assert.equal(C.clean(many,null,day,s2).length,12);assert.equal(s2.lanes.interests.dropped.limit,2);
});
test('Scout card says who may attend, and an empty lane says why',async()=>{
  const item=C.clean([{...event,access:'members'}])[0];
  const elements={};const el=id=>elements[id]||(elements[id]={value:'',innerHTML:'',textContent:'',hidden:false});
  const checks={lanes:{work:{returned:3,kept:1,dropped:{}},people:{returned:2,kept:0,dropped:{inactive:2}}}};
  const ctx={URL,Intl,Date,console,document:{getElementById:el,addEventListener(){}},fbLoadScout:async()=>({feed:{items:[item],checks},choices:{}})};ctx.window=ctx;
  vm.createContext(ctx);vm.runInContext(readFileSync(new URL('./scout-core.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('./scout-ui.js',import.meta.url),'utf8'),ctx);
  el('scout-view').value='all';el('scout-lane').value='';ctx.ScoutCore.today=()=>'2026-10-18';await ctx.renderScout();
  const html=el('scout-results').innerHTML;
  assert.match(html,/<dt>Who<\/dt><dd>Members only<\/dd>/);
  assert.match(html,/People &amp; communities<\/h2><p class="flights-note scout-empty">None this week: the search returned 2; left out: 2 no meeting in the last 60 days or the next 90\.<\/p>/);
  assert.match(html,/Interests &amp; discovery<\/h2><p class="flights-note scout-empty">None this week: the search found none\.<\/p>/);
  el('scout-lane').value='work';ctx.paintScout();assert.doesNotMatch(el('scout-results').innerHTML,/scout-empty/,'a lane filter shows only that lane');
  el('scout-lane').value='';el('scout-view').value='saved';ctx.paintScout();assert.doesNotMatch(el('scout-results').innerHTML,/scout-empty/,'notes belong to the latest build view');
});
test('Scout shows the working ring, timer and "Scouting…" while a build runs, and clears them after',async()=>{
  const elements={};const el=id=>elements[id]||(elements[id]={value:'',innerHTML:'',textContent:'',hidden:false,disabled:false});
  let finish,calls=[];
  const ctx={URL,Intl,Date,console,document:{getElementById:el,addEventListener(){}},fbLoadScout:async()=>({feed:{items:[]},choices:{}}),fbSaveScoutPrefs:async()=>{},
    fbBuildScout:()=>new Promise(r=>finish=r),aiWorkingHtml:(text,opts)=>{calls.push(opts);return '<working>'+text;}};ctx.window=ctx;
  vm.createContext(ctx);vm.runInContext(readFileSync(new URL('./scout-core.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('./scout-ui.js',import.meta.url),'utf8'),ctx);
  el('scout-view').value='all';await ctx.renderScout();
  const run=ctx.buildScout();await new Promise(r=>setTimeout(r,0));
  assert.match(el('scout-status').innerHTML,/^<working>Searching organiser pages, then checking each date on its own page/);
  assert.equal(el('scout-build').textContent,'Scouting…');assert.equal(el('scout-build').disabled,true);
  assert.equal(calls[0].slow,180);assert.ok(Math.abs(calls[0].since-Date.now())<5000,'the timer counts from the press');
  finish({items:[],generatedAt:new Date().toISOString()});await run;
  assert.equal(el('scout-build').textContent,'Scout opportunities');assert.equal(el('scout-build').disabled,false);
  assert.match(el('scout-status').textContent,/Shortlist updated/);
});
test('Scout keeps a work calendar event until it ends, drops one withdrawn twice, and marks only later arrivals New',()=>{
  const ev=(url,start,source='anziif-webinars')=>({url,start,end:start,source,title:url});
  const ok=[{id:'anziif-webinars',ok:true},{id:'aicla',ok:true}];
  const d1=C.mergeCalendar(null,{events:[ev('https://a/1','2026-10-22'),ev('https://a/2','2026-10-29'),ev('https://b/1','2026-10-21','aicla')],sources:ok},'2026-10-18');
  assert.equal(d1.startedOn,'2026-10-18');assert.equal(Object.keys(d1.items).length,3);
  assert.ok(Object.values(d1.items).every(v=>!C.isNew(v,d1.startedOn,'2026-10-18')),'the first collection is not all new');
  const d2=C.mergeCalendar(d1,{events:[ev('https://a/1','2026-10-22'),ev('https://a/3','2026-11-05')],sources:[{id:'anziif-webinars',ok:true},{id:'aicla',ok:false}]},'2026-10-19');
  const byUrl=u=>Object.values(d2.items).find(v=>v.url===u);
  assert.equal(byUrl('https://a/1').firstSeen,'2026-10-18');assert.equal(byUrl('https://a/3').firstSeen,'2026-10-19');
  assert.ok(C.isNew(byUrl('https://a/3'),d2.startedOn,'2026-10-19'));assert.ok(!C.isNew(byUrl('https://a/3'),d2.startedOn,'2026-10-27'),'New lasts a week');
  assert.equal(byUrl('https://a/2').missed,1,'missing once from a source that read fine');assert.equal(byUrl('https://b/1').missed,0,'its source failed, so it is kept as it was');
  const d3=C.mergeCalendar(d2,{events:[ev('https://a/1','2026-10-22'),ev('https://a/3','2026-11-05')],sources:ok},'2026-10-20');
  assert.equal(Object.values(d3.items).find(v=>v.url==='https://a/2'),undefined,'withdrawn: missing twice running');
  const d4=C.mergeCalendar(d3,{events:[],sources:ok},'2026-11-06');
  assert.deepEqual(Object.values(d4.items).map(v=>v.url).sort(),['https://a/3'],'ended yesterday: kept two weeks for logging, though no longer listed; ended 15 days ago: dropped');
  assert.deepEqual(Object.keys(C.mergeCalendar(d4,{events:[],sources:ok},'2026-11-20').items),[],'two weeks after it ended');
  assert.equal(C.calendarId(ev('https://a/1','2026-10-22')),C.calendarId({url:'https://a/1',start:'2026-10-22'}));
});
test('Scout rolls weekly picks on: a pick seen again keeps its first sighting, earlier picks stay until they end',()=>{
  const day='2026-10-25',pick=(id,extra)=>({id,title:id,lane:'interests',kind:'event',start:'2026-10-20',end:'2026-11-15',...extra});
  const prev=[pick('olafur',{firstSeen:'2026-10-18',lastSeen:'2026-10-18'}),pick('walk',{start:'2026-10-24',end:'2026-10-24',firstSeen:'2026-10-18'}),
    pick('group',{kind:'community',start:'',end:'',lastSeen:'2026-09-20'}),pick('aicla',{lane:'people',kind:'community',start:'',end:'',lastSeen:'2026-10-18'})];
  const out=C.rollPicks(prev,[pick('olafur'),pick('fresh')],day);
  assert.deepEqual(Array.from(out,v=>v.id),['olafur','fresh','aicla']);
  assert.equal(out[0].firstSeen,'2026-10-18','not new a third time');assert.equal(out[0].lastSeen,day);assert.equal(out[1].firstSeen,day);
  assert.equal(C.rollPicks([],Array.from({length:30},(_,i)=>pick('p'+i)),day).length,24);
  assert.equal(C.clean([{...event,firstSeen:'2026-10-18',lastSeen:'nope'}])[0].firstSeen,'2026-10-18');assert.equal(C.clean([{...event,lastSeen:'nope'}])[0].lastSeen,undefined);
});
test('Scout balances its overview before the full work calendar: joinable events by date in PHT, CPD points, New and On your work, in-person folded',async()=>{
  const cal={startedOn:'2026-10-18',refreshedAt:'2026-10-18T21:40:00Z',searched:['CA ANZ','CPA Australia'],
    sources:[{id:'anziif-webinars',label:'ANZIIF webinars',ok:true},{id:'aicla',label:'AICLA events',ok:false}],items:{
    a:{title:'Thursday Thought-Leaders: The Affordability Pincer | How Inflation and Cost-of-Living Pressures are Reshaping Australia GI',summary:'claims inflation pressures',url:'https://anziif.com/w/pincer',start:'2026-10-29',end:'2026-10-29',time:'12:00',zone:'AEDT',pht:'09:00 PHT (12:00 AEDT)',format:'online',organizer:'ANZIIF',cpd:'1 CIP point',firstSeen:'2026-10-18'},
    b:{title:'AICLA NSW/ACT Webinar - Utmost Good Faith',url:'https://aicla.org/e/ugf',start:'2026-10-21',end:'2026-10-21',time:'13:00',zone:'AEDT',pht:'10:00 PHT (13:00 AEDT)',format:'online',organizer:'AICLA',cpd:'AICLA CPD 1 point',access:'members',firstSeen:'2026-10-18'},
    c:{title:'Thursday Thought-Leaders: Trade Credit <b>',url:'https://anziif.com/w/credit',start:'2026-11-05',end:'2026-11-05',pht:'09:00 PHT (12:00 AEDT)',format:'online',organizer:'ANZIIF',cpd:'1 CIP point',firstSeen:'2026-10-19'},
    d:{title:'Australian Liability Conference 2026',url:'https://anziif.com/e/liability',start:'2026-11-17',end:'2026-11-17',time:'08:00',zone:'AEDT',pht:'05:00 PHT (08:00 AEDT)',format:'hybrid',organizer:'ANZIIF',cpd:'6 CIP points',firstSeen:'2026-10-18'},
    e:{title:'QLD Member Networking Drinks',url:'https://aicla.org/e/drinks',start:'2026-10-21',end:'2026-10-21',pht:'15:00 PHT (17:00 AEST)',format:'in-person',organizer:'AICLA',location:'Tattersalls Club, Brisbane',firstSeen:'2026-10-18'},
    f:{title:'Ended webinar',url:'https://anziif.com/w/old',start:'2026-10-15',end:'2026-10-15',format:'online',organizer:'ANZIIF',firstSeen:'2026-10-18'}}};
  const pick=C.clean([{...event,firstSeen:'2026-10-19'}])[0];
  const elements={};const el=id=>elements[id]||(elements[id]={value:'',innerHTML:'',textContent:'',hidden:false});
  const ctx={URL,Intl,Date,console,document:{getElementById:el,addEventListener(){}},fbLoadScout:async()=>({feed:{items:[pick],startedOn:'2026-10-18'},choices:{},calendar:cal})};ctx.window=ctx;
  vm.createContext(ctx);vm.runInContext(readFileSync(new URL('./scout-core.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('./scout-ui.js',import.meta.url),'utf8'),ctx);
  ctx.ScoutCore.today=()=>'2026-10-20';el('scout-view').value='all';el('scout-lane').value='';await ctx.renderScout();
  const html=el('scout-results').innerHTML,cal0=html.slice(html.indexOf('<section class="scout-calendar">'));
  assert.ok(html.startsWith('<section class="scout-overview">'),'the weekly overview comes first');
  const order=['Utmost Good Faith','Affordability Pincer','Trade Credit','Australian Liability'].map(t=>cal0.indexOf(t));
  assert.ok(order.every((v,i)=>v>0&&(i===0||v>order[i-1])),'by date');assert.doesNotMatch(cal0.slice(0,cal0.indexOf('<details')),/Ended webinar/);assert.match(cal0,/1 session ended in the last two weeks: log any you attended<\/summary>.*Ended webinar/s);
  assert.match(cal0,/Wed 21 Oct<br>10:00 PHT \(13:00 AEDT\)/);assert.match(cal0,/AICLA · Online · AICLA CPD 1 point \(not your CPD\) · Members only/);
  assert.match(cal0,/Reshaping Australia GI<\/a> <span class="scout-topic">On your work: claims inflation<\/span>/);
  assert.match(cal0,/Trade Credit &lt;b&gt;<\/a> <span class="scout-new">New<\/span>/,'first seen after the list started, escaped');
  assert.doesNotMatch(cal0.slice(cal0.indexOf('Affordability'),cal0.indexOf('Trade Credit')),/scout-new/,'on the first collection: not New');
  assert.match(cal0,/ANZIIF · Hybrid · join online · ANZIIF CIP: 6 points \(not your CPD\)/);assert.match(cal0,/ANZIIF · Online · ANZIIF CIP: 1 point \(not your CPD\)/);
  assert.match(cal0,/<summary class="flights-note">1 in-person event in Australia and New Zealand<\/summary>/);
  assert.match(cal0,/AICLA events could not be read then; their events are from the last good read\./);assert.match(cal0,/The weekly search covers CA ANZ, CPA Australia\./);
  assert.match(html,/<span class="scout-new">New<\/span> Work &amp; learning/,'a weekly pick first found after the list started');
  el('scout-lane').value='people';ctx.paintScout();assert.doesNotMatch(el('scout-results').innerHTML,/scout-calendar/,'the calendar belongs to Work & learning');
  el('scout-lane').value='';el('scout-view').value='saved';ctx.paintScout();assert.doesNotMatch(el('scout-results').innerHTML,/scout-calendar/);
  assert.equal(C.workMatch({title:'Securing Growth | Trade Credit Insurance',summary:'claims inflation pressures squeezing'}),'','titles only');assert.equal(C.workMatch({title:'Recovery 101'}),'recoveries');
});
test('Scout requires explicit attendance and credit confirmation and keeps old entries for review',()=>{
  const now=Date.parse('2026-10-18T04:00:00Z');
  assert.equal(C.cpeDefault({cpd:'8 CIP points'}).hours,0);assert.equal(C.cpeDefault({}).hours,0);assert.equal(C.cpeDefault({organizer:'IIA',cpeHours:3}).hours,3);
  let d=C.applyCpe(null,{op:'start',year:'2026',start:'12.5',ethics:'1'},now);
  d=C.applyCpe(d,{op:'toggle',id:'past',item:{title:'ASIC review',start:'2026-10-15',cpd:'1 CIP point'}},now);
  d=C.applyCpe(d,{op:'toggle',id:'future',item:{title:'Ethical culture',start:'2026-12-10',cpeHours:1,organizer:'IIA',url:'javascript:alert(1)'}},now);
  assert.equal(d.entries.future.url,'');assert.equal(d.entries.past.status,'attended');assert.equal(d.entries.future.status,'planned');
  let summary=C.cpeSummary(d,'2026-10-18');assert.deepEqual([summary.earned,summary.ethics,summary.booked,summary.pending],[12.5,1,1,1]);
  assert.throws(()=>C.applyCpe(d,{op:'edit',id:'past',status:'confirmed'},now),/actual hours and confirm eligibility/);
  d=C.applyCpe(d,{op:'edit',id:'past',hours:1.5,ethics:true,eligible:true,evidence:'Certificate 123',status:'confirmed'},now);
  summary=C.cpeSummary(d,'2026-10-18');assert.deepEqual([summary.earned,summary.ethics],[14,2.5]);assert.equal(d.entries.past.evidence,'Certificate 123');
  assert.throws(()=>C.applyCpe(d,{op:'edit',id:'future',status:'attended'},now),/not started/);
  d=C.applyCpe(d,{op:'edit',id:'past',eligible:false},now);assert.equal(C.cpeSummary(d,'2026-10-18').earned,12.5);
  const legacy={entries:{old:{date:'2026-10-10',hours:8,ethics:true}}};assert.equal(C.cpeSummary(legacy,'2026-10-18').earned,0);assert.equal(C.cpeSummary(legacy,'2026-10-18').pending,1);
  assert.throws(()=>C.applyCpe(null,{op:'start',year:'2026',start:1,ethics:2},now),/Ethics hours/);
  assert.equal(C.cpeSummary(null,'2026-12-31').daysLeft,0);
  const full={entries:Object.fromEntries(Array.from({length:300},(_,i)=>['e'+i,{date:'2026-01-01',hours:1}]))};
  assert.throws(()=>C.applyCpe(full,{op:'toggle',id:'new',item:{title:'x',start:'2026-10-20'}},now),/full \(300\)/);
});

test('Scout CPE controls plan, record attendance, edit evidence and confirm eligible hours',async()=>{
  const elements={},listeners={},now=Date.parse('2026-10-20T12:00:00Z');const el=id=>elements[id]||(elements[id]={value:'',innerHTML:'',textContent:'',hidden:false});
  const future={title:'Ethical Culture Starts With Us',url:'https://www.theiia.org/w/ethics',start:'2026-12-10',end:'2026-12-10',time:'12:00',zone:'EST',format:'online',organizer:'IIA',cpeHours:1};
  const past={title:'ASIC review findings',url:'https://anziif.com/w/asic',start:'2026-10-19',end:'2026-10-19',format:'online',organizer:'ANZIIF',cpd:'1 CIP point'};
  const futureId=C.calendarId(future),pastId=C.calendarId(past);const cal={sources:[],items:{[futureId]:future,[pastId]:past}};
  const changes=[];let cpe=null;
  const ctx={URL,Intl,Date,console,document:{getElementById:el,addEventListener(type,fn){(listeners[type]=listeners[type]||[]).push(fn);}},fbLoadScout:async()=>({feed:{items:[]},choices:{},calendar:cal,cpe:null}),fbUpdateCpe:async change=>{changes.push(change);cpe=ctx.ScoutCore.applyCpe(cpe,change,now);return cpe;}};ctx.window=ctx;
  vm.createContext(ctx);vm.runInContext(readFileSync(new URL('./scout-core.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('./scout-ui.js',import.meta.url),'utf8'),ctx);ctx.ScoutCore.today=()=>'2026-10-20';el('scout-view').value='all';await ctx.renderScout();
  assert.match(el('scout-cpe').innerHTML,/<b>0<\/b> of 40 hours/);assert.match(el('scout-results').innerHTML,/Going<\/button>/);assert.match(el('scout-results').innerHTML,/Attended<\/button>/);
  el('scout-cpe-start').value='12';await ctx.saveCpeStart();
  const tap=async id=>{for(const fn of listeners.click)await fn({target:{closest:sel=>sel.includes('data-cpe-id')?{dataset:{cpeId:id}}:null}});await new Promise(r=>setTimeout(r,0));};
  await tap(futureId);await tap(pastId);assert.match(el('scout-cpe').innerHTML,/<b>12<\/b> of 40 hours/);assert.match(el('scout-cpe').innerHTML,/Planned: 1 published CPE hour/);
  const change=async target=>{for(const fn of listeners.change)await fn({target});await new Promise(r=>setTimeout(r,0));};
  await change({dataset:{cpeHours:pastId},value:'1.5'});await change({dataset:{cpeField:'evidence',cpeEntry:pastId},value:'Certificate #123'});await change({dataset:{cpeField:'eligible',cpeEntry:pastId},checked:true});
  assert.match(el('scout-cpe').innerHTML,/<b>12<\/b> of 40 hours/,'attendance alone is not earned credit');
  await change({dataset:{cpeField:'status',cpeEntry:pastId},value:'confirmed'});assert.match(el('scout-cpe').innerHTML,/<b>13.5<\/b> of 40 hours/);assert.equal(cpe.entries[pastId].evidence,'Certificate #123');
  assert.match(el('scout-cpe').innerHTML,/Export 2026 CPE record/);
});
test('Scout reads a CPE entry logged before the attendance states as a plan when it is still ahead',async()=>{
  // Bob's two real "Going" taps from the first tracker (18 Oct): no status.
  const ai={title:'Thursday Thought-Leaders: How to Accelerate with AI | Part 1',url:'https://anziif.com/w/ai1',start:'2026-11-12',end:'2026-11-12',time:'12:00',zone:'AEDT',format:'online',organizer:'ANZIIF',cpd:'1 CIP point'};
  const ethics={title:'Ethical Culture Starts With Us',url:'https://www.theiia.org/w/ethics',start:'2026-12-10',end:'2026-12-10',time:'12:00',zone:'EST',format:'online',organizer:'IIA',cpeHours:1};
  const aiId=C.calendarId(ai),ethicsId=C.calendarId(ethics);
  const legacy={entries:{[aiId]:{title:ai.title,url:ai.url,date:'2026-11-12',hours:1,ethics:false,organizer:'ANZIIF',iia:false},
    [ethicsId]:{title:ethics.title,url:ethics.url,date:'2026-12-10',hours:1,ethics:true,organizer:'IIA',iia:true},
    past:{title:'Earlier',date:'2026-10-10',hours:8,ethics:true,iia:true}}};
  const s=C.cpeSummary(legacy,'2026-10-18');
  assert.deepEqual(Array.from(s.entries,e=>[e.id,e.status,e.hours]),[['past','needs-review',8],[aiId,'planned',0],[ethicsId,'planned',1]],'ahead: planned; past: needs review; another body\'s points are not CIA hours');
  assert.deepEqual([s.earned,s.booked,s.bookedEthics,s.pending],[0,1,1,1]);
  assert.equal(C.cpeSummary(legacy,'2026-12-11').entries.find(e=>e.id===ethicsId).status,'needs-review','once its day has passed it needs review');
  const later=C.applyCpe(legacy,{op:'edit',id:ethicsId,evidence:'Registered'},Date.parse('2026-10-18T04:00:00Z'));
  assert.equal(later.entries[ethicsId].status,'planned','an edit keeps it planned and stores the state');
  const elements={},listeners={};const el=id=>elements[id]||(elements[id]={value:'',innerHTML:'',textContent:'',hidden:false});
  const ctx={URL,Intl,Date,console,document:{getElementById:el,addEventListener(type,fn){(listeners[type]=listeners[type]||[]).push(fn);}},
    fbLoadScout:async()=>({feed:{items:[]},choices:{},calendar:{sources:[],items:{[aiId]:ai,[ethicsId]:ethics}},cpe:{entries:{[aiId]:legacy.entries[aiId],[ethicsId]:legacy.entries[ethicsId]}}})};ctx.window=ctx;
  vm.createContext(ctx);vm.runInContext(readFileSync(new URL('./scout-core.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('./scout-ui.js',import.meta.url),'utf8'),ctx);
  ctx.ScoutCore.today=()=>'2026-10-18';el('scout-view').value='all';el('scout-lane').value='';await ctx.renderScout();
  const html=el('scout-results').innerHTML;
  assert.equal((html.match(/aria-pressed="true" >Going ✓<\/button>/g)||[]).length,2,'both taps read Going ✓, not Review CPE record');assert.doesNotMatch(html,/Review CPE record/);
  assert.match(el('scout-cpe').innerHTML,/Planned: 1 published CPE hour\./);assert.doesNotMatch(el('scout-cpe').innerHTML,/awaiting attendance/);
});
