import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
test('Daily Boost account writes merge against the transaction snapshot', async()=>{
  let written;
  const day='2026-09-25';
  const remote={[day]:{spark:1,note:'Laptop reflection',updatedAt:200,fieldClocks:{note:200}},'2026-09-24':{spark:2,note:'Yesterday',updatedAt:100}};
  const context={Date,db:{},COLL:'briefings-bob',getUid:()=> 'alice',doc:()=>({}),runTransaction:async(db,work)=>work({get:async()=>({exists:()=>true,data:()=>({entries:remote})}),set:(ref,body)=>{written=body;}})};
  context.window=context; vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../lib/daily-boost.js',import.meta.url),'utf8'),context);
  const start=html.indexOf('window.fbSaveDailyBoost = async function(');
  vm.runInContext(html.slice(start,html.indexOf('\n};',start)+3),context);
  const result=await context.fbSaveDailyBoost('alice',{[day]:{spark:1,note:'Older reflection',updatedAt:300,fieldClocks:{note:100},reminders:[{headline:'Release',metric:'Check',due:day}]}},['2026-09-24']);
  assert.equal(written.entries[day].note,'Laptop reflection');
  assert.equal(written.entries[day].reminders.length,1);
  assert.equal(written.entries['2026-09-24'].note,'Yesterday','stale deletion requests cannot delete the latest snapshot');
  assert.equal(result[day].note,'Laptop reflection');
});
// Execute actual application handlers in a tiny DOM/data adapter. These tests
// cover behavior; artifact presence is checked separately by check-site.js.
function handler(name) {
  const found=html.indexOf('function '+name+'(');
  assert.ok(found>=0,name);
  // Keep the async keyword, so an extracted async function can still await.
  const start=html.slice(found-6,found)==='async '?found-6:found;
  return html.slice(start,html.indexOf('\n}',found)+2);
}
function environment(names, extra={}) {
  const elements=new Map();
  const element=id => {
    if(!elements.has(id)) elements.set(id,{id,textContent:'',innerHTML:'',style:{},className:'',value:'',parentNode:{}});
    return elements.get(id);
  };
  const context={console,Date,Promise,document:{getElementById:element},setText:(id,value)=>{element(id).textContent=value;},...extra};
  context.window=context; vm.createContext(context);
  names.forEach(name=>vm.runInContext(handler(name),context));
  return {context,element};
}

// The Today-tab section selectors: every section belongs to one that has a chip,
// so no section (Insurance, Interruptions) is reachable only under All.
const secMetaSource=()=>{const s=html.indexOf('var SEC_META = {');return html.slice(s,html.indexOf('\n};',s)+3)+'\n'+html.slice(html.indexOf('var SEC_GROUP_LABELS'),html.indexOf('\n',html.indexOf('var SEC_GROUP_LABELS')));};
test('every briefing section has a section selector, and each selector counts its own stories',()=>{
  const {context}=environment(['sectionGroupCounts']);
  vm.runInContext(secMetaSource(),context);
  const chips=[...html.matchAll(/<button class="secgroup-chip[^"]*" data-group="([a-z]+)"/g)].map(m=>m[1]);
  assert.deepEqual(chips,['all','insurance','global','ph','ai']);
  const groups=vm.runInContext('Object.keys(SEC_META).filter(function(id){return id!=="watch";}).map(function(id){return SEC_META[id].group;})',context);
  groups.forEach(g=>assert.ok(chips.includes(g),'a section in group "'+g+'" has no selector chip'));
  chips.filter(g=>g!=='all').forEach(g=>assert.ok(groups.includes(g),'the "'+g+'" chip selects no section'));
  // The 30 September briefing: 9 stories, 7 of them Insurance and Interruptions.
  const counts=context.sectionGroupCounts({sections:{global:[1],ph:[],insurance:[1,2,3,4],interruptions:[1,2,3],ai:[],markets:[1],ev:[]}});
  assert.deepEqual({...counts},{all:9,insurance:7,global:1,ph:0,ai:1});
  assert.deepEqual({...context.sectionGroupCounts(null)},{all:0,insurance:0,global:0,ph:0,ai:0});
  // Section blocks are tagged by selector, and an empty selector is disabled, not a blank page.
  assert.ok(html.includes(`todayHTML += '<div data-group="'+esc(meta.group)+'"`));
  assert.match(html,/chip\.disabled = empty;/);
});

// The invite-only sign-in page (Enclave-style) and the owner's Invites panel.
test('sign-in messages are plain, the denied card is escaped, and the form says what to fix',()=>{
  const {context}=environment(['authMessageFor','authDeniedHtml','authFormProblem'],{esc:v=>String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),AUTH_MIN_PASSWORD:8,AUTH_CONTACT:'bobbynacario@gmail.com'});
  assert.match(context.authMessageFor('auth/invalid-credential'),/Email or password is incorrect\. If you usually continue with Google, you don’t have a password yet/);
  assert.match(context.authMessageFor('auth/email-already-in-use'),/already an account for this email\. Sign in instead/);
  assert.match(context.authMessageFor('auth/operation-not-allowed'),/Email sign-in isn’t switched on yet/);
  assert.equal(context.authMessageFor('auth/weak-password'),'Use at least 8 characters for your password.');
  assert.equal(context.authMessageFor('something/else'),'Couldn’t sign in. Please try again.');
  const denied=context.authDeniedHtml('no-invite','<eve>@example.com');
  assert.match(denied,/No invite found/); assert.ok(!denied.includes('<eve>')); assert.match(denied,/&lt;eve>@example\.com is not on the invite list/);
  assert.match(denied,/href="mailto:bobbynacario@gmail\.com\?subject=Daybook%20access%20request">Request access<\/a>/);
  assert.match(context.authDeniedHtml('rules-error'),/Couldn’t check access/);
  assert.equal(context.authDeniedHtml('ok'),'');
  assert.equal(context.authFormProblem('register','','a@b.co','longenough'),'Enter your name.');
  assert.equal(context.authFormProblem('signin','','not-an-email','x'),'Enter the email address your invitation was sent to.');
  assert.equal(context.authFormProblem('register','Ann','a@b.co','short'),'Use at least 8 characters for your password.');
  assert.equal(context.authFormProblem('signin','','a@b.co','short'),'',"a short password is only refused when creating one");
  // The page and the access gate are wired: nothing loads until the check passes.
  assert.match(html,/if \(access === 'ok'\) \{\n    window\._firebaseUid = user\.uid;/);
  assert.match(html,/const DAYBOOK_OWNER = 'bobbynacario@gmail\.com';/);
  ['auth-signin-view','auth-verify-view','auth-form','auth-denied','auth-btn','login-install-btn'].forEach(id=>assert.ok(html.includes('id="'+id+'"'),id));
  // Controls that set their own display (.login-link) must still obey `hidden`.
  assert.match(html,/\.login-card \[hidden\],#invites-card\[hidden\]\{display:none!important\}/);
});
test('invites: addresses are normalised, and the list puts the owner first with no Remove',()=>{
  const {context}=environment(['normalizeInviteEmail','inviteRowsHtml','groundingDay'],{esc:v=>String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')});
  assert.equal(context.normalizeInviteEmail('  Alice@Example.COM '),'alice@example.com');
  ['','alice','alice@','@example.com','a b@example.com','alice@example','a/b@example.com'].forEach(v=>assert.equal(context.normalizeInviteEmail(v),'',v));
  const rows=context.inviteRowsHtml([
    {email:'alice@example.com',role:'member',name:'Alice <A>',invitedAt:'2026-09-30T09:00:00Z'},
    {email:'bobbynacario@gmail.com',role:'owner',name:'Bob',invitedAt:'2026-09-30T08:28:49Z'},
  ]);
  assert.ok(rows.indexOf('Bob')<rows.indexOf('Alice'),'owner first');
  assert.equal((rows.match(/data-invite-remove=/g)||[]).length,1,'only the member can be removed');
  assert.match(rows,/data-invite-remove="alice@example\.com"/);
  assert.match(rows,/Alice &lt;A>/); assert.match(rows,/alice@example\.com · invited 30 Sep 2026/);
  assert.equal(context.inviteRowsHtml([]),'<p class="invite-empty">No invites yet.</p>');
});
// An invited member shares the feeds but not the AI features (GENERATION_OWNERS).
test('a member gets the member view: the AI controls hide, the notes show, nothing owner-only loads',()=>{
  const root={attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}};
  let owner=false, usageReads=0;
  const {context,element}=environment(['applyDaybookRole','accountOpensLabel','renderLlmUsage'],{fbIsDaybookOwner:()=>owner,fbLoadLlmUsage:async()=>{usageReads++;return null;}});
  context.document.documentElement=root;
  context.applyDaybookRole();
  assert.equal(root.attrs['data-daybook-role'],'member'); assert.equal(context.daybookMember,true);
  assert.equal(context.accountOpensLabel(),'the timeline','an account badge opens the timeline, not a meeting brief');
  element('llm-usage-out').innerHTML='untouched'; context.renderLlmUsage();
  assert.equal(usageReads,0,'the owner’s AI spend is not read'); assert.equal(element('llm-usage-out').innerHTML,'untouched');
  owner=true; context.applyDaybookRole();
  assert.equal(root.attrs['data-daybook-role'],'owner'); assert.equal(context.daybookMember,false);
  assert.equal(context.accountOpensLabel(),'a meeting brief');
  context.renderLlmUsage(); assert.equal(usageReads,1);
  // Every control the server refuses for a member is marked owner-only.
  ['btn-sec owner-only" id="openai-generate-btn"','tool-chip owner-only" id="boost-compact-week"','boost-mirror owner-only" id="boost-mirror-panel"',
    'meeting-panel owner-only" id="meeting-panel"','paste-zone owner-only" id="research-gen"','btn-primary owner-only" onclick="toggleResearchGen()"',
    'help-card help-wide owner-only">\n      <div class="help-h"><svg class="ico" aria-hidden="true"><use href="#i-coins"/></svg> LLM usage'].forEach(s=>assert.ok(html.includes(s),s));
  assert.ok(html.includes('html[data-daybook-role="member"] .owner-only,html[data-daybook-role="member"] [data-card-act="deeper"],html[data-daybook-role="member"] .acct-row [data-account]{display:none!important}'));
  assert.ok(html.includes('html:not([data-daybook-role="member"]) .member-only{display:none!important}'));
  assert.ok(html.includes('class="help-card help-wide member-only" id="member-access-card"'));
  assert.match(html,/var TODAY_EMPTY_HTML = '<div class="empty-state">AWAITING BRIEFING INPUT<\/div><p class="member-only member-note">/);
  assert.equal((html.match(/'today-out'\)\.innerHTML ?= ?TODAY_EMPTY_HTML;/g)||[]).length,2,'sign-out and Clear both restore the member note');
  // The role is set before anything renders, and cleared with the session.
  assert.match(html,/function onSignedIn\(\) \{\n  applyDaybookRole\(\);/);
  assert.match(html,/function clearPrivateSession\(\) \{\n  window\.daybookMember = false;\n  document\.documentElement\.removeAttribute\('data-daybook-role'\);/);
});
test('Command: the Morning push switch shows the delivery state, and waits for preferences to load',async()=>{
  const calls=[];
  const {context,element}=environment(['renderCommandDeliveryControls','toggleCommandDelivery'],{esc:v=>String(v ?? ''),commandSources:['Radar'],commandAuditTime:()=>'',commandPrefsAvailable:false,
    commandPreferences:{delivery:{enabled:false,quietStart:'22:00',quietEnd:'06:00',sourceThresholds:{}},deliveryState:{audit:[]}}});
  context.enableCommandDelivery=async()=>{calls.push('enable');context.commandPreferences.delivery.enabled=true;};
  context.muteCommandDelivery=async()=>{calls.push('mute');context.commandPreferences.delivery.enabled=false;};
  const quick=element('command-delivery-quick'); quick.attrs={}; quick.setAttribute=(k,v)=>{quick.attrs[k]=v;}; quick.hidden=true;
  context.renderCommandDeliveryControls();
  assert.equal(quick.hidden,true,'hidden until preferences load, so a save cannot overwrite them');
  context.commandPrefsAvailable=true; context.renderCommandDeliveryControls();
  assert.equal(quick.hidden,false); assert.equal(quick.textContent,'Morning push · off'); assert.equal(quick.attrs['aria-pressed'],'false');
  assert.match(quick.title,/^Tap to get the Morning 5 as a notification on this device/);
  await context.toggleCommandDelivery(quick);
  assert.deepEqual(calls,['enable']); assert.equal(quick.textContent,'Morning push · on'); assert.equal(quick.attrs['aria-pressed'],'true'); assert.equal(quick.disabled,false);
  assert.match(quick.title,/Tap to mute/);
  await context.toggleCommandDelivery(quick);
  assert.deepEqual(calls,['enable','mute']); assert.equal(quick.textContent,'Morning push · off');
  assert.ok(html.includes('<button type="button" class="tool-chip" id="command-delivery-quick" hidden aria-pressed="false" onclick="toggleCommandDelivery(this)">Morning push · off</button><button class="tool-chip" onclick="renderCommandCenter()">Refresh</button>'),'next to Refresh on the Morning 5 panel');
});
test('feed health: a member sees no Briefing pill, since their account has no briefings',()=>{
  const specStart=html.indexOf('var FEED_SPEC = [');
  const {context,element}=environment(['feedAge','feedAgeText','briefingHealthRec','feedStatus','renderFeedHealth'],{esc:v=>String(v ?? ''),_briefingHistory:[]});
  vm.runInContext(html.slice(specStart,html.indexOf('\n];',specStart)+3),context);
  const health={feeds:{radar:{lastOkAt:new Date().toISOString(),status:'ok'}}};
  context.renderFeedHealth(health);
  assert.match(element('feed-health').innerHTML,/Briefing <span/); assert.match(element('feed-health').innerHTML,/Briefing has no run recorded yet/);
  context.daybookMember=true; context.renderFeedHealth(health);
  assert.doesNotMatch(element('feed-health').innerHTML,/Briefing/); assert.match(element('feed-health').innerHTML,/Radar <span/);
});

const NUMBERS=['groundingShortName','groundingDay','groundingPeriod','groundingStatus','groundingNumbersHtml'];
const escHtml=v=>String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
test('numbers escape source content and separate fact trust from watch states',()=>{
  const {context}=environment(NUMBERS,{esc:escHtml});
  assert.match(context.groundingNumbersHtml(null),/No release published/);
  const out=context.groundingNumbersHtml({schema:'daybook-grounding-mirror/1',sequence:2,facts:[
    {seriesId:'cpi',kind:'index',title:'<script>bad</script>',display:'3.1%',observationKey:'2026-08',publishedAt:'2026-09-01',url:'javascript:alert(1)',publisher:'Test',checks:{factVerified:true,sourceLinked:true,crossChecked:false}}
  ],watch:[{seriesId:'award',state:'awaiting_publication',detail:'Not yet',url:'https://example.org'}]});
  assert.ok(!out.includes('<script>'));
  assert.ok(!out.includes('javascript:'));
  assert.match(out,/Fact-verified/);
  assert.match(out,/Not cross-checked/);
  assert.match(out,/Watch state, not evidence/);
  assert.match(out,/<details class="gn-row" open><summary>.*Awaiting/, 'a series that needs attention opens by itself, with a chip');
});
test('numbers read as one row per series, grouped, with earlier periods inside the latest',()=>{
  const {context}=environment(NUMBERS,{esc:escHtml});
  const fact=(o)=>Object.assign({checks:{sourceLinked:true,factVerified:true,crossChecked:false},publisher:'Fair Work Ombudsman',url:'https://example.org'},o);
  const out=context.groundingNumbersHtml({schema:'daybook-grounding-mirror/1',sequence:9,updatedAt:'2026-09-29T02:00:00Z',facts:[
    fact({seriesId:'award',kind:'award_wage',title:'Building award, CW/ECW 2 (civil, weekly hire), ordinary hourly rate',display:'$30.39/hour',observationKey:'2026-07-01',publishedAt:'2026-07-02',effectiveFrom:'2026-07-01',effectiveTo:'2027-06-30'}),
    fact({seriesId:'rba',kind:'rate',title:'RBA cash rate target',display:'4.35% p.a.',observationKey:'2026-08-12',publishedAt:'2026-08-11',effectiveFrom:'2026-08-12',effectiveTo:null,publisher:'Reserve Bank of Australia'}),
    fact({seriesId:'award',kind:'award_wage',title:'Building award, CW/ECW 2 (civil, weekly hire), ordinary hourly rate',display:'$29.01/hour',observationKey:'2025-07-01',publishedAt:'2025-07-17',effectiveFrom:'2025-07-01',effectiveTo:'2026-06-30'}),
  ],watch:[
    {seriesId:'award',state:'published',detail:'Latest: $30.39/hour (2026-07-01), published 2026-07-02.'},
    {seriesId:'rba',state:'published',expectedBy:'2026-09-29',detail:'Latest: 4.35% p.a. (2026-08-12), published 2026-08-11. Next: a Monetary Policy Board decision, scheduled by the RBA for 2026-09-29.'},
    {seriesId:'sg',title:'Superannuation guarantee charge percentage (the Act)',state:'published',detail:'Reviewed 2026-09-28: compilation 78. More words.',url:'https://example.org/sg'},
  ]});
  assert.equal((out.match(/class="gn-row"/g)||[]).length,3,'the award is one row, not two');
  assert.deepEqual([...out.matchAll(/class="gn-group">([^<]*)</g)].map(m=>m[1]),['Economy','Wages','Reminders · reviewed by hand, not figures']);
  assert.match(out,/All up to date/);
  assert.match(out,/2 figures · 1 reminder/);
  assert.match(out,/<span class="gn-name">Building award, CW\/ECW 2<\/span><span class="gn-sub">FY2026-27 · Fair Work Ombudsman · 1 earlier period<\/span><\/span><span class="gn-value">\$30\.39\/hour</);
  assert.match(out,/Earlier: <b>\$29\.01\/hour<\/b> · FY2025-26 · published 17 Jul 2025/);
  assert.match(out,/from 12 Aug 2026 · Reserve Bank of Australia · next 29 Sep/);
  assert.match(out,/Next: a Monetary Policy Board decision/);
  assert.match(out,/<span class="gn-sub">Reviewed 2026-09-28: compilation 78\.<\/span>/);
  assert.ok(!/ open>/.test(out),'nothing opens by itself when all is well');
  // Periods read as words: a quarter, a month, a financial year, an open start.
  assert.equal(context.groundingPeriod({observationKey:'2026-Q2'}),'Jun qtr 2026');
  assert.equal(context.groundingPeriod({observationKey:'2026-Q4'}),'Dec qtr 2026');
  assert.equal(context.groundingPeriod({observationKey:'2026-07'}),'Jul 2026');
  assert.equal(context.groundingPeriod({effectiveFrom:'2025-07-01',effectiveTo:'2026-06-30'}),'FY2025-26');
  assert.equal(context.groundingPeriod({effectiveFrom:'2026-09-30',effectiveTo:null}),'from 30 Sep 2026');
  // A one-day price (diesel, H-8) reads as its date.
  assert.equal(context.groundingPeriod({observationKey:'2026-09-25',effectiveFrom:null,effectiveTo:null}),'25 Sep 2026');
});
test('diesel terminal gate prices sit together under Fuel, one row per capital',()=>{
  const {context}=environment(NUMBERS,{esc:escHtml});
  const city=(key,name,display)=>({seriesId:'aip_tgp_diesel_'+key,kind:'rate',unitCode:'aud_cents_per_litre',title:'Diesel terminal gate price, '+name+' (AIP average of four wholesalers, incl GST)',
    display,observationKey:'2026-09-25',publishedAt:'2026-09-25',effectiveFrom:null,effectiveTo:null,publisher:'Australian Institute of Petroleum',url:'https://aip.com.au/pricing/terminal-gate-prices/',
    checks:{sourceLinked:true,factVerified:true,crossChecked:false}});
  const out=context.groundingNumbersHtml({schema:'daybook-grounding-mirror/1',sequence:14,updatedAt:'2026-10-01T00:00:00Z',facts:[
    {seriesId:'rba',kind:'rate',unitCode:'pct_pa',title:'RBA cash rate target',display:'4.6% p.a.',observationKey:'2026-09-30',publishedAt:'2026-09-29',effectiveFrom:'2026-09-30',effectiveTo:null,publisher:'Reserve Bank of Australia',url:'https://example.org',checks:{sourceLinked:true,factVerified:true,crossChecked:true}},
    city('sydney','Sydney','271.5 c/L'),city('melbourne','Melbourne','269.5 c/L')],watch:[]});
  assert.deepEqual([...out.matchAll(/class="gn-group">([^<]*)</g)].map(m=>m[1]),['Economy','Fuel']);
  assert.match(out,/<span class="gn-name">Diesel terminal gate price, Sydney<\/span><span class="gn-sub">25 Sep 2026 · Australian Institute of Petroleum<\/span><\/span><span class="gn-value">271\.5 c\/L</);
});
test('aha actions preserve sources and invalidation when saved or scheduled',()=>{
  const data={date:'2026-09-26',aha:{title:'A useful connection',insight:'A provisional reading',chain:['First observation'],wrong_if:'The delay is temporary',links:['Source headline']}};
  let evidence, check, trial, decision;
  const {context,element}=environment(['ahaSnapshot','handleAhaAction'],{_currentData:data,DailyBoostCore:{dateKey:()=> '2026-09-26'},getAllStories:()=>[{story:{headline:'Other headline',source:'X',url:'https://example.com/other'}},{story:{headline:'Source headline',source:'Publisher',url:'https://example.com/source'}}],currentBriefingKey:()=> '2026-09-26',openEvidencePicker:item=>evidence=item,
    addDailyBoostCheck:item=>{check=item;return {ok:true,message:'Added to To check for Sat 3 Oct.'};},createDailyBoostExperiment:(...args)=>{trial=args;return {ok:true,message:'Saved'};},openDecisionFromInsight:value=>{decision=value;}});
  context.handleAhaAction('save');
  assert.equal(evidence.id,'briefing:2026-09-26:aha');
  assert.match(evidence.detail,/Wrong if: The delay is temporary/); assert.match(evidence.detail,/https:\/\/example.com\/source/);
  context.handleAhaAction('decision');
  assert.equal(decision.title,'A useful connection'); assert.equal(decision.source,'briefing');
  assert.equal(decision.invalidator,'The delay is temporary'); assert.match(decision.detail,/https:\/\/example.com\/source/);
  element('aha-review-date').value='2026-10-03'; context.handleAhaAction('confirm-check');
  // A dated check in To check, not the day's one experiment.
  assert.equal(trial,undefined);
  assert.equal(check.metric,'Check whether: The delay is temporary'); assert.equal(check.headline,'A useful connection');
  assert.equal(check.due,'2026-10-03'); assert.equal(check.url,'https://example.com/source','the link of a story the read is built on');
  assert.equal(check.source,'Today’s aha · 2026-09-26');
  assert.match(element('aha-action-status').textContent,/To check/);
  assert.equal(element('aha-review').hidden,true);
});
test('a dossier opens as a compact decision draft: the read, the BI angle, the first question',()=>{
  const {context}=environment(['dossierDecisionDetail']);
  const text=context.dossierDecisionDetail({summary:'A claim escalated.',bi_angle:'Loss of use.',client_questions:['Who owns the delay?','Q2','Q3'],background:['Long background that stays out'],story:{headline:'Strata storm claim'}});
  assert.equal(text,'A claim escalated.\nBI angle: Loss of use.\nFirst question: Who owns the delay?\nFull dossier: Go deeper on the story “Strata storm claim”.');
  assert.ok(!text.includes('Long background'));
});
test('a hand-typed ticker is still uppercased; an insight subject keeps its case',async()=>{
  const saved=[];
  const run=async(fields)=>{
    const {context}=environment(['saveDecisionForm'],{getDecisionField:id=>fields[id]||'',showToast:()=>{},fbSaveDecision:async entry=>{saved.push(entry);},decisionEditingId:null,decisionEditingSaved:null,decisionEditingCreatedDate:'',
      decisionEditingVerdict:fields.was||'',decisionEditingVerdictDate:fields.wasDate||'',
      manilaDateKey:()=> '2026-09-26',decisionNum:v=>v?Number(v):null,decisionLinkedSignal:null,decisionBeatFromForm:()=>null,closeDecisionForm:()=>{},decisionRefPrice:{},renderDecisions:()=>{}});
    await context.saveDecisionForm();
    return saved[saved.length-1];
  };
  assert.equal((await run({'decision-asset':'nvda','decision-source':'manual'})).asset,'NVDA');
  assert.equal((await run({'decision-asset':'brk.b','decision-source':'manual'})).asset,'BRK.B');
  assert.equal((await run({'decision-asset':'A claims documentation gap','decision-source':'manual'})).asset,'A claims documentation gap');
  assert.equal((await run({'decision-asset':'client question','decision-source':'briefing','decision-review-date':'2026-10-03'})).asset,'client question');
  assert.equal(saved[saved.length-1].reviewDate,'2026-10-03');
  assert.equal((await run({'decision-asset':'sol','decision-source':'radar'})).asset,'SOL');
  const kept=await run({'decision-asset':'x','decision-verdict':'held',was:'held',wasDate:'2026-09-20'});
  assert.equal(kept.verdictDate,'2026-09-20','an unchanged verdict keeps its day');
  assert.equal((await run({'decision-asset':'x','decision-verdict':'broke',was:'held',wasDate:'2026-09-20'})).verdictDate,'2026-09-26','a changed one is dated today');
  assert.equal((await run({'decision-asset':'x'})).verdictDate,'','no verdict, no date');
});
// Called it?: verdicts graded against the conviction each read was written with.
test('Called it? compares how reads held, band by conviction, and says what it shows',()=>{
  const names=['decisionIsInsight','calledItSummary','calledItHtml','esc'];
  const {context}=environment(names,{VERDICT_LABELS:{held:'held',broke:'broke',unclear:'unclear'}});
  const e=(conviction,verdict,extra)=>Object.assign({conviction,verdict,status:'open'},extra||{});
  const few=context.calledItSummary([e(5,'held'),e(4,'broke')],'2026-09-26');
  assert.match(few.read,/after five held-or-broke verdicts/);
  const overconfident=context.calledItSummary([e(5,'broke'),e(4,'broke'),e(5,'held'),e(4,'broke'),e(1,'held'),e(2,'held'),e(1,'held'),e(2,'broke'),e(3,'unclear',{source:'briefing'})],'2026-09-26');
  assert.equal(overconfident.bands.high.rate,25); assert.equal(overconfident.bands.low.rate,75);
  assert.match(overconfident.read,/Your confident reads held less often than your tentative ones \(25% against 75%\)/);
  assert.equal(overconfident.insights.unclear,1,'an insight decision counts as an insight');
  const earned=context.calledItSummary([e(5,'held'),e(4,'held'),e(5,'held'),e(1,'broke'),e(2,'broke'),e(1,'held')],'2026-09-26');
  assert.match(earned.read,/earning its keep: high-conviction reads held 100% of the time, tentative ones 33%/);
  const murky=context.calledItSummary([e(3,'held'),e(3,'broke'),e(3,'held'),e(3,'held'),e(3,'broke'),e(3,'unclear'),e(3,'unclear'),e(3,'unclear'),e(3,'unclear'),e(3,'unclear')],'2026-09-26');
  assert.match(murky.read,/Grade reads at both ends/); assert.match(murky.read,/Many verdicts are unclear/);
  const waiting=context.calledItSummary([{status:'open',reviewDate:'2026-09-25'},{status:'open',reviewDate:'2026-10-01'},{status:'closed',reviewDate:'2026-09-20'}],'2026-09-26');
  assert.equal(waiting.waiting,1);
  const html=context.calledItHtml(overconfident);
  assert.ok(html.includes('Very sure (4–5)') && html.includes('<b>25%</b>') && html.includes('Tentative (1–2)'));
  assert.equal(context.calledItHtml(context.calledItSummary([],'2026-09-26')),'','nothing graded or waiting, no panel');
});
test('a read due for review gets one-tap verdicts; an insight is settled by its verdict, a market call is not',async()=>{
  const saved=[]; let rendered=0;
  const decisions=[{id:'q1',asset:'A claims documentation gap',source:'briefing',status:'open',conviction:4,reviewDate:'2026-09-26',invalidator:'The record is produced',linkedSignal:{kind:'insight'}},
    {id:'c1',asset:'NVDA',source:'radar',action:'took',status:'open',conviction:3,reviewDate:'2026-09-20'}];
  const {context}=environment(['decisionIsInsight','decisionVerdictHtml','setDecisionVerdict','esc'],{VERDICT_LABELS:{held:'held',broke:'broke',unclear:'unclear'},decisionEntries:decisions,
    manilaDateKey:()=> '2026-09-26',decisionPill:(t,c)=>'<pill '+(c||'')+'>'+t+'</pill>',fbSaveDecision:async entry=>{saved.push(entry);},showToast:()=>{},decisionRefPrice:{},renderDecisions:()=>{rendered++;}});
  const due=context.decisionVerdictHtml(decisions[0]);
  assert.ok(due.includes('wrong if The record is produced') && due.includes("setDecisionVerdict('q1','held')") && due.includes('Check in a week'));
  assert.equal(context.decisionVerdictHtml({id:'x',status:'open',source:'radar',reviewDate:'2026-10-09'}),'','a market call not yet due has no buttons');
  assert.ok(context.decisionVerdictHtml({id:'x',verdict:'broke',verdictDate:'2026-09-24'}).includes('<pill rel-low>broke</pill>'));
  await context.setDecisionVerdict('q1','held');
  assert.equal(saved[0].verdict,'held'); assert.equal(saved[0].verdictDate,'2026-09-26');
  assert.equal(saved[0].status,'closed','a question opened from an insight is settled'); assert.equal(saved[0].closedDate,'2026-09-26');
  await context.setDecisionVerdict('c1','broke');
  assert.equal(saved[1].verdict,'broke'); assert.equal(saved[1].status,'open','the position stays open');
  await context.setDecisionVerdict('q1','later');
  assert.equal(saved[2].reviewDate,'2026-10-03'); assert.equal(saved[2].verdict,undefined);
  await context.setDecisionVerdict('q1','nonsense');
  assert.equal(saved.length,3); assert.equal(rendered,3);
});
test('an insight opens a reviewable decision form without saving it',()=>{
  let page, draft, saved=0, scrolled=0;
  const {context}=environment(['openDecisionFromInsight'],{document:{getElementById:()=>null,querySelector:()=>({})},switchPage:name=>{page=name;},openDecisionForm:value=>{draft=value;},manilaDateKey:()=> '2026-09-26',scrollTo:()=>{scrolled++;},fbSaveDecision:()=>{saved++;}});
  context.openDecisionFromInsight({title:'A claims documentation gap',source:'briefing',detail:'Two sources point to a missing record.',invalidator:'The record is produced',reviewDate:'2026-10-03',label:'Today’s aha',url:'https://example.com/source'});
  assert.equal(page,'decisions'); assert.equal(saved,0); assert.equal(scrolled,1);
  assert.equal(draft.asset,'A claims documentation gap'); assert.equal(draft.reviewDate,'2026-10-03');
  assert.equal(draft.invalidator,'The record is produced'); assert.equal(draft.linkedSignal.kind,'insight');
});
test('absent Command dependency produces a recovery action, not initial placeholders', () => {
  const {context,element}=environment(['renderCommandCenter']);
  context.renderCommandCenter();
  assert.match(element('command-five').innerHTML,/Reload app/);
  assert.match(element('command-queue').textContent,/source tabs remain available/);
});
// The phone header pins only its section row by sticking at minus the top row's
// height. That offset is plain CSS arithmetic, so it breaks silently if the
// padding, the row height or the row gap changes without it, or if the rule
// moves above the older phone rule that would then override it.
test('the phone header offset matches the top row it hides', () => {
  const block=html.indexOf('/* Phones: the brand and the controls share the top row');
  assert.ok(block>0,'phone header block');
  const rules=html.slice(block,html.indexOf('\n}',block));
  const sticky=/\.nav\{row-gap:([^;]+);top:calc\(-([^ ]+) - (\d+)px - ([^)]+)\)\}/.exec(rules);
  assert.ok(sticky,'the nav sticks at a calculated negative offset');
  const [,rowGap,pad,height,gap]=sticky;
  assert.equal(gap,rowGap,'the offset uses the row gap');
  assert.match(rules,new RegExp('\\.nav-brand\\{[^}]*height:'+height+'px'),'the brand row is the height the offset hides');
  assert.match(rules,new RegExp('\\.nav-right\\{[^}]*height:'+height+'px'),'and so are the controls');
  assert.match(rules,/\.nav-center\{flex-wrap:nowrap\}/,'the sections stay on one row');
  const older=/@media\(max-width:768px\)\{\.nav-center\{display:flex\}\.nav-brand\{font-size:13px\}\.nav\{padding:([^;}]+)\}/.exec(html);
  assert.ok(older,'the older phone rule');
  assert.equal(pad,older[1],'the offset uses the nav padding');
  assert.ok(block>older.index,'the block comes after the older phone rule, so it wins');
});
test('each Command item shows once, and marks itself where it is shown', () => {
  const day='2026-09-27', now='2026-09-27T01:00:00.000Z';
  const mk=(i,source)=>({id:'n-'+i,source,title:'Item '+i,detail:'Detail '+i,urgency:'act',confidence:'high',score:90-i,scoreBreakdown:['base'],kind:'signal'});
  const items=[mk(1,'Briefing'),mk(2,'News'),mk(3,'Radar'),mk(4,'Decisions'),mk(5,'Markets'),mk(6,'News'),mk(7,'Sports'),mk(8,'Radar')];
  const {context,element}=environment(['commandStateButtons','commandReviewItem','commandItemHtml','paintCommandCenter','renderCommandReview'],{
    esc:s=>String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    manilaDateKey:()=>day,renderCommandControls:()=>{},commandFilter:'all',commandCenterInputs:null});
  vm.runInContext(readFileSync(new URL('../lib/command-review-core.js',import.meta.url),'utf8'),context);
  const core=context.CommandReviewCore;
  // Captured this morning: 1, 2, 3, 7 and 9. Item 7 has since dropped out of the
  // top five into the queue, and item 9 is gone from today's feeds.
  let review=core.captureDay({days:{}},{morningFive:[items[0],items[1],items[2],items[6],mk(9,'Radar')]},day,now).review;
  review=core.setItemState(review,day,items[0],'acted',now).review;
  review=core.setItemState(review,day,items[6],'reviewed',now).review;
  context.commandPreferences={review};
  context.commandCenterData={items,morningFive:items.slice(0,5),counts:{act:8,review:0,total:8,sources:5,hidden:0},generatedAt:now};
  element('command-review-today').querySelector=()=>null;
  context.paintCommandCenter();
  const five=element('command-five').innerHTML, queue=element('command-queue').innerHTML, rest=element('command-review-today').innerHTML;
  assert.equal(five.match(/command-five-item/g).length,5);
  assert.equal(five.match(/command-review-state /g).length,15,'every Morning 5 card carries Acted / Reviewed / Ignored');
  assert.match(five,/command-five-item handled/); assert.match(five,/aria-pressed="true"[^>]*>Acted/);
  ['Item 1<','Item 5<'].forEach(title=>assert.ok(!queue.includes(title),'the queue leaves out the Morning 5'));
  assert.equal(queue.match(/command-queue-item/g).length,3);
  assert.equal(element('command-queue-meta').textContent,'3 of 3 beyond the Morning 5');
  const seven=queue.slice(queue.indexOf('n-7'),queue.indexOf('n-8')), eight=queue.slice(queue.indexOf('n-8'));
  const oneTap=/command-item-btn[^"]*" onclick="event\.stopPropagation\(\);setCommandReviewState/;
  assert.match(seven,/aria-pressed="true"[^>]*>Reviewed/,'a marked queue item carries its state');
  assert.doesNotMatch(seven,oneTap,'and no separate one-tap button');
  assert.match(eight,oneTap,'an unmarked queue item keeps its one tap'); assert.doesNotMatch(eight,/command-review-state/);
  assert.ok(rest.includes('Item 9') && !rest.includes('Item 7<'),'the rest of today’s list is only what is not on screen');
  assert.match(rest,/was Morning 5 #5/); assert.match(rest,/2 of 5 handled · closing marks the rest ignored/);
  assert.equal(element('command-review-week-line').textContent,'0/1 days closed · 40% of Morning 5 handled');
});
test('missing verification metadata renders an explicit unknown state', () => {
  const {context,element}=environment(['renderGroundingLine']);
  context.renderGroundingLine({grounding:null},{parentNode:{}});
  assert.match(element('grounding-line').textContent,/source links unknown/i);
  assert.equal(element('grounding-line').className,'qa-line warn');
});
test('opening an archived briefing asks for a read-only render', () => {
  let options;
  const {context}=environment(['loadBriefing'],{_briefingHistory:[{key:'archive',data:{date:'test'}}],renderBriefing:value=>{options=value;},switchPage:()=>{}});
  context.document.querySelector=()=>null;
  context.loadBriefing('archive');
  assert.equal(options.readOnly,true);
});
test('search shows partial source coverage and retry can recover', async () => {
  const {context,element}=environment(['intelligenceSearchRead','loadIntelligenceSearchData'],{setTimeout,clearTimeout,intelligenceSearchState:{loading:false},runIntelligenceSearch:()=>{}});
  vm.runInContext(readFileSync(new URL('../lib/app-reliability.js',import.meta.url),'utf8'),context);
  vm.runInContext(readFileSync(new URL('../lib/intelligence-search-core.js',import.meta.url),'utf8'),context);
  ['SearchBriefings','Reports','Decisions','Miro','Sports','News'].forEach(name=>{context['fbLoad'+name]=async()=>[];});
  context.fbLoadRadar=async()=>{throw Error('Denied');};
  await context.loadIntelligenceSearchData();
  assert.match(element('intel-search-coverage').textContent,/Unavailable: Radar/);
  context.fbLoadRadar=async()=>null;
  await context.loadIntelligenceSearchData();
  assert.match(element('intel-search-coverage').textContent,/All sources loaded/);
});
test('a search response from a signed-out session cannot repopulate the index', async () => {
  let complete;
  const {context}=environment(['intelligenceSearchRead','loadIntelligenceSearchData'],{setTimeout,clearTimeout,intelligenceSearchState:{loading:false},runIntelligenceSearch:()=>{}});
  vm.runInContext(readFileSync(new URL('../lib/app-reliability.js',import.meta.url),'utf8'),context);
  context.IntelligenceSearchCore={buildIndex:()=>{throw Error('Must not build an old account index');}};
  context.fbLoadSearchBriefings=()=>new Promise(resolve=>{complete=resolve;});
  const pending=context.loadIntelligenceSearchData();
  await Promise.resolve();
  context.intelligenceSearchState={loading:false,index:[]};
  complete([]); await pending;
  assert.equal(context.intelligenceSearchState.index.length,0);
});
test('local history fallback never reads another account cache', () => {
  const saved=new Map();
  const {context}=environment(['briefingCacheKey'],{localStorage:{getItem:k=>saved.get(k) || null,setItem:(k,v)=>saved.set(k,v)},_firebaseUid:'account-a'});
  vm.runInContext(readFileSync(new URL('../lib/app-reliability.js',import.meta.url),'utf8'),context);
  for(const name of ['lsSaveBriefing','lsLoadHistory']) {
    const start=html.indexOf('window.'+name+' = function(');
    vm.runInContext(html.slice(start,html.indexOf('\n};',start)+3),context);
  }
  context.lsSaveBriefing('date',{private:'A'});
  context._firebaseUid='account-b'; context.lsLoadHistory();
  assert.equal(context._briefingHistory.length,0);
  context._firebaseUid='account-a'; context.lsLoadHistory();
  assert.equal(context._briefingHistory[0].data.private,'A');
  context._firebaseUid=null; context.lsSaveBriefing('other',{private:'No account'});
  assert.equal(saved.size,1);
});
test('secondary text palette meets 4.5:1 against each standard surface', () => {
  function luminance(hex) {
    const channels=hex.replace('#','').match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
    return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
  }
  for(const selector of [':root','body.light']) {
    const block=html.slice(html.indexOf(selector+'{')).split('}')[0];
    const variable=name=>block.match(new RegExp('--'+name+':(#[0-9A-Fa-f]{6})'))[1];
    for(const text of ['txt2','txt3']) for(const background of ['bg','bg2','bg3','bg4']) {
      const values=[luminance(variable(text)),luminance(variable(background))].sort((a,b)=>b-a);
      assert.ok((values[0]+0.05)/(values[1]+0.05)>=4.5,selector+' '+text+' on '+background);
    }
  }
});
test('a card citation carries headline, source, the briefing date and a web link only', () => {
  const {context}=environment(['briefingCitation']);
  assert.equal(context.briefingCitation({headline:'Port strike halts Botany terminal',source:'Lloyd’s List',url:'https://lloydslist.com/port'},'Friday, September 25, 2026'),
    '“Port strike halts Botany terminal” — Lloyd’s List, 25 September 2026. https://lloydslist.com/port');
  assert.equal(context.briefingCitation({headline:' H ',source:'',url:'javascript:alert(1)'},'2026-09-05'),'“H” — 5 September 2026.');
  assert.equal(context.briefingCitation({headline:'H',source:'S'},'Friday, 25 September 2026'),'“H” — S, 25 September 2026.');
  assert.equal(context.briefingCitation({headline:'H',source:'S'},'Late edition'),'“H” — S, Late edition.');
  assert.equal(context.briefingCitation({headline:'H'},''),'“H”.');
});
// The copied prompt is the one an outside AI sees, so it has to carry Bob's
// story votes the same way the server generator does, and nothing when there are none.
test('the copied AI prompt carries the reader feedback from synced votes', () => {
  let entries={};
  const {context}=environment(['getBriefingFeedback','getRecentBriefings','getGeminiPrompt','activeAccounts'],{_accounts:null,getTodayBriefingDateLabel:()=> 'Friday, September 25, 2026',
    DailyBoostCore:{dateKey:()=> '2026-09-25'},dailyBoostFeedbackEntries:()=>entries});
  vm.runInContext(readFileSync(new URL('../lib/briefing-prompt-core.js',import.meta.url),'utf8'),context);
  assert.doesNotMatch(context.getGeminiPrompt(),/READER FEEDBACK/);
  entries={'2026-09-24':{feedback:[{headline:'Insurer lifts BI reserves again',source:'Insurance News',section:'insurance',vote:1},{headline:'Rates hold again',section:'markets',vote:-1}]},
    '2026-09-25':{feedback:[{headline:'Rates hold again',section:'markets',vote:0}]}};
  const prompt=context.getGeminiPrompt();
  assert.match(prompt,/READER FEEDBACK:\n- A READER FEEDBACK block near the end of this prompt/);
  assert.match(prompt,/More like this:\n- \[insurance\] Insurer lifts BI reserves again \(Insurance News\)/);
  assert.doesNotMatch(prompt,/Less like this/,'a vote taken back is no vote');
  assert.equal(prompt,context.BriefingPromptCore.buildBriefingPrompt({dateLabel:'Friday, September 25, 2026',feedback:context.BriefingPromptCore.buildReaderFeedback(entries,'2026-09-25'),
    context:{recent:context.getRecentBriefings(),accounts:context.BriefingPromptCore.DEFAULT_ACCOUNTS}}),'the same prompt the server builds, with the starter accounts');
  assert.match(prompt,/HIS ACCOUNTS — private context, not news:\nQBE \(QBE Insurance\)/);
  delete context.dailyBoostFeedbackEntries;
  assert.doesNotMatch(context.getGeminiPrompt(),/READER FEEDBACK/,'no Daily Boost, no block');
});
test('stories are marked new or by how many briefings in a row they have run', () => {
  const {context}=environment(['runWords','runUrl','sameStory','briefingWhen','briefingStories','briefingStoryRuns']);
  const day=(date,sections)=>({key:date,saved:Date.parse(date),data:{date,sections}});
  const current={date:'Friday, September 25, 2026',sections:{
    interruptions:[{headline:'Botany port strike enters third day',url:'https://lloydslist.com/day3'}],
    insurance:[{headline:'Insurer lifts BI reserves after flood',url:'https://insurancenews.com.au/reserves?utm=x'},{headline:'APRA consults on claims handling'}],
    watch:[{headline:'Port strike halts Botany terminal'}]
  }};
  const history=[
    day('Thursday, September 24, 2026',{interruptions:[{headline:'Port strike halts Botany terminal'}],insurance:[{headline:'Flood reserves rise at two insurers',url:'https://insurancenews.com.au/reserves'}]}),
    day('Wednesday, September 23, 2026',{interruptions:[{headline:'Stevedores plan Botany port strike'}]}),
    day('Monday, September 21, 2026',{insurance:[{headline:'APRA consults on claims handling'}]}),
    day('Friday, September 25, 2026',{insurance:[{headline:'Same-day earlier version',url:'https://x.example/a'}]}),
    day('Saturday, September 26, 2026',{insurance:[{headline:'APRA consults on claims handling'}]})
  ];
  const runs=context.briefingStoryRuns(current,history);
  assert.equal(runs['interruptions:0'].days,3,'reworded headline matched on wording, two briefings back');
  assert.deepEqual([...runs['interruptions:0'].seen],['Thursday, September 24, 2026','Wednesday, September 23, 2026']);
  assert.equal(runs['insurance:0'].days,2,'matched by link although the headline changed');
  assert.equal(runs['insurance:1'].days,1,'missing from the previous briefing is new, even if it ran earlier');
  assert.equal(runs['watch:0'],undefined,'the watch item is not a story card');
  assert.deepEqual({...context.briefingStoryRuns(current,[])},{},'nothing to compare: nothing marked');
  assert.equal(context.sameStory({headline:'Claims inflation rises'},{headline:'Claims backlog grows'}),false,'one shared word is not the same story');
});
test('a save that pushes a day out of the window archives it in the same transaction', async()=>{
  const writes=[];
  const remote={};
  for (let i=0;i<90;i++) { const day=new Date(Date.UTC(2026,5,20+i)).toISOString().slice(0,10); remote[day]={spark:1,note:'Day '+i,updatedAt:10,opened:[{headline:'x',url:'https://x.example'}]}; }
  const context={Date,db:{},COLL:'briefings-bob',getUid:()=> 'alice',doc:(db,coll,id)=>({id}),
    runTransaction:async(db,work)=>work({get:async()=>({exists:()=>true,data:()=>({entries:remote})}),set:(ref,body,options)=>writes.push({id:ref.id,body,options})})};
  context.window=context; vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../lib/daily-boost.js',import.meta.url),'utf8'),context);
  const start=html.indexOf('window.fbSaveDailyBoost = async function(');
  vm.runInContext(html.slice(start,html.indexOf('\n};',start)+3),context);
  await context.fbSaveDailyBoost('alice',{'2026-09-18':{spark:2,note:'A new day',updatedAt:20}},[]);
  assert.deepEqual(writes.map(w=>w.id),['daily-boost-archive-alice-2026','daily-boost-alice'],'archive first, then the day doc');
  const archive=writes[0];
  assert.deepEqual({...archive.options},{merge:true},'a merge write, which needs no read of a doc that may not exist');
  assert.equal(archive.body.uid,'alice'); assert.equal(archive.body.kind,'daily-boost-archive');
  assert.deepEqual(Object.keys(archive.body.entries),['2026-06-20']);
  assert.equal(archive.body.entries['2026-06-20'].note,'Day 0');
  assert.equal(archive.body.entries['2026-06-20'].opened,undefined);
  assert.equal(Object.keys(writes[1].body.entries).length,90);
  assert.ok(!writes[1].body.entries['2026-06-20']);
});
test('a card saved to Evidence points at the saved briefing, or the key autoSave would give it', () => {
  const {context}=environment(['currentBriefingKey'],{_currentData:{date:'Friday, September 25, 2026'},_briefingHistory:[]});
  assert.equal(context.currentBriefingKey(),'Friday--September-25--2026');
  context._briefingHistory=[{key:'stored-key',data:{date:'Friday, September 25, 2026'}}];
  assert.equal(context.currentBriefingKey(),'stored-key');
});
test('the verification line says when the reader\'s feedback shaped the briefing', () => {
  const {context,element}=environment(['renderGroundingLine']);
  context.renderGroundingLine({grounding:{mode:'grounded',grounded:2,ungrounded:0},context:{feedback:{up:4,down:2,days:3}}},{parentNode:{}});
  assert.match(element('grounding-line').textContent,/Tuned by your feedback: 4 more, 2 less\./);
  context.renderGroundingLine({grounding:{mode:'grounded',grounded:2,ungrounded:0},context:{feedback:null}},{parentNode:{}});
  assert.doesNotMatch(element('grounding-line').textContent,/Tuned by your feedback/);
});
// Today's aha: the card shows the read escaped, with its steps, link chips and
// wrong-if; nothing at all when there is no aha; and normalise() keeps it,
// cleaned against the briefing's own stories, so it survives the save.
test('the aha card renders the read, and nothing when there is none', () => {
  const {context}=environment(['esc','uiIcon','ahaHtml'],{AHA_KIND_LABELS:{'connection':'Connection','second-order':'Second-order','contrarian':'Contrarian'}});
  const html=context.ahaHtml({kind:'connection',title:'Grid alerts are a <reinsurance> story',insight:'Two stories, one exposure.',chain:['Reserves are thin.','Retentions went up.'],links:['Visayas grid on yellow alert anew','Tower renews reinsurance program'],wrong_if:'NGCP margin above 300 MW.'});
  assert.match(html,/TODAY’S AHA/);
  assert.match(html,/<span class="aha-kind">Connection<\/span>/);
  assert.match(html,/Grid alerts are a &lt;reinsurance&gt; story/,'escaped');
  assert.match(html,/<ol class="aha-chain"><li>Reserves are thin\.<\/li><li>Retentions went up\.<\/li><\/ol>/);
  assert.match(html,/data-aha-link="1"[^>]*>↓ Tower renews reinsurance program<\/button>/);
  assert.match(html,/<strong>Wrong if:<\/strong> NGCP margin above 300 MW\./);
  assert.match(context.ahaHtml({title:'T',insight:'I',kind:''}),/<span class="aha-kind">Read<\/span>/);
  assert.doesNotMatch(context.ahaHtml({title:'T',insight:'I'}),/aha-chain|aha-links|aha-wrong/,'empty parts are left out');
  assert.equal(context.ahaHtml(null),'');
  assert.equal(context.ahaHtml({title:'Only a title'}),'');
});
test('normalise keeps a cleaned aha, so it is saved with the briefing', () => {
  const {context}=environment(['normalise']);
  vm.runInContext(readFileSync(new URL('../lib/briefing-prompt-core.js',import.meta.url),'utf8'),context);
  const data=context.normalise({date:'Saturday, September 26, 2026',sections:{interruptions:[{headline:'Visayas grid on yellow alert anew',body:'b'}]},
    aha:{kind:'second-order',title:'Cold chains carry the grid risk',insight:'Spoilage, not outage.',chain:['a','b'],links:['Visayas grid on yellow alert anew','Not in this briefing'],wrong_if:'x',extra:1}});
  assert.equal(data.aha.kind,'second-order');
  assert.deepEqual([...data.aha.links],['Visayas grid on yellow alert anew']);
  assert.equal(data.aha.extra,undefined);
  assert.equal(context.normalise({date:'d',sections:{global:[]}}).aha,null,'an older briefing without one');
});
// The PDF parses section pip colours; markets uses var(--amber), which parsed
// as NaN and failed every export with a markets story.
test('every section colour resolves to numbers for the PDF', () => {
  const {context}=environment(['pdfRgb'],{document:{body:{},getElementById:()=>({})},getComputedStyle:()=>({getPropertyValue:name=>name==='--amber'?' #7F4F00':''})});
  const start=html.indexOf('var SEC_META = {');
  vm.runInContext(html.slice(start,html.indexOf('};',start)+2),context);
  vm.runInContext('this.SEC_META_ = SEC_META;',context);
  Object.entries(context.SEC_META_).forEach(([id,meta])=>{
    const rgb=[...context.pdfRgb(meta.pip)];
    assert.equal(rgb.length,3,id);
    rgb.forEach(v=>assert.ok(Number.isInteger(v)&&v>=0&&v<=255,id+' '+meta.pip+' → '+rgb));
  });
  assert.deepEqual([...context.pdfRgb('var(--amber)')],[127,79,0]);
  assert.deepEqual([...context.pdfRgb('#fff')],[255,255,255]);
  assert.deepEqual([...context.pdfRgb('var(--unknown)')],[201,168,76],'an unresolved colour falls back to gold, never NaN');
});
// The copied prompt gets the last briefings from the loaded history, so an
// outside AI is held to the same no-rerun rule as the generator.
test('the copied AI prompt carries the last briefings, and the verification line reports reruns', () => {
  const {context,element}=environment(['getBriefingFeedback','getRecentBriefings','getGeminiPrompt','renderGroundingLine','activeAccounts'],{_accounts:null,getTodayBriefingDateLabel:()=> 'Saturday, September 26, 2026',
    DailyBoostCore:{dateKey:d=>d?new Date(d).toISOString().slice(0,10):'2026-09-26'},dailyBoostFeedbackEntries:()=>({}),
    _briefingHistory:[{key:'t',saved:Date.parse('2026-09-26T02:00:00Z'),data:{date:'Today',sections:{global:[{headline:'Today story'}]}}},
      {key:'f',saved:Date.parse('2026-09-25T02:00:00Z'),data:{date:'Friday, September 25, 2026',watch:'NGCP alerts',sections:{interruptions:[{headline:'Visayas grid on yellow alert anew'}]}}}]});
  vm.runInContext(readFileSync(new URL('../lib/briefing-prompt-core.js',import.meta.url),'utf8'),context);
  const prompt=context.getGeminiPrompt();
  assert.match(prompt,/RECENT BRIEFINGS — already given to Bob, newest first:\nFriday, September 25, 2026:\n- \[interruptions\] Visayas grid on yellow alert anew\n  Watch: NGCP alerts/);
  assert.doesNotMatch(prompt,/Today story/,'today’s own briefing is not old news');
  context._briefingHistory=undefined;
  assert.doesNotMatch(context.getGeminiPrompt(),/RECENT BRIEFINGS/,'no history loaded, no block');
  const line={parentNode:{}};
  context.renderGroundingLine({grounding:{mode:'ungrounded',reason:'x'},context:{recent:{briefings:3,headlines:30,updates:2,reruns:0}}},line);
  assert.match(element('grounding-line').textContent,/Nothing re-run from your last 3 briefings \(2 updates\)\./);
  context.renderGroundingLine({grounding:{mode:'ungrounded',reason:'x'},context:{recent:{briefings:3,headlines:30,updates:1,reruns:2}}},line);
  assert.match(element('grounding-line').textContent,/2 stories look like a recent one; 1 marked Update\./);
});
// Keyboard reading: J/K move a visible ring through the briefing, O opens the
// current story's source, M marks it read, and nothing fires while typing.
test('J and K move through the stories, O opens the source, M marks read, typing is left alone', () => {
  const clicks=[];
  const card=(name,withLink=true)=>{
    const classes=new Set(), attrs={};
    return {name,offsetParent:{},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),has:c=>classes.has(c)},
      hasAttribute:a=>a in attrs,setAttribute:(a,v)=>{attrs[a]=v;},focus(){},scrollIntoView(){},
      querySelector:sel=>sel.includes('a.src')?(withLink?{click:()=>clicks.push('open:'+name)}:null):sel.includes('card-act')?{click:()=>clicks.push('read:'+name)}:null};
  };
  const cards=[card('aha',false),card('first'),card('second')];
  const page={querySelectorAll:()=>cards};
  const {context}=environment(['readingCards','focusReadingCard','readingKey'],{_kbCard:null});
  context.document.querySelector=sel=>sel==='.page.active'?page:null;
  const press=(key,extra={})=>{ let prevented=false; context.readingKey(Object.assign({key,target:{tagName:'BODY'},preventDefault(){prevented=true;}},extra)); return prevented; };
  assert.equal(press('j'),true); assert.equal(context._kbCard.name,'aha');
  press('j'); assert.equal(context._kbCard.name,'first');
  assert.equal(cards[0].classList.has('is-kb'),false,'the ring moves'); assert.equal(cards[1].classList.has('is-kb'),true);
  press('o'); press('m'); assert.deepEqual(clicks,['open:first','read:first']);
  press('j'); press('j'); assert.equal(context._kbCard.name,'second','stops at the last story');
  press('k'); assert.equal(context._kbCard.name,'first');
  assert.equal(press('j',{target:{tagName:'TEXTAREA'}}),false,'not while typing');
  assert.equal(press('j',{ctrlKey:true}),false,'not with a modifier');
  assert.equal(press('o',{repeat:true}),false,'a held O does not open tab after tab');
  context._kbCard=null; press('k'); assert.equal(context._kbCard.name,'second','K starts from the bottom');
  press('o'); assert.equal(clicks.length,3);
});
// Display: Auto follows the device, a saved Light/Dark choice wins, text size
// steps 90-125% and is written to the page zoom variable, all kept on the device.
test('display settings: Auto follows the device, Light and Dark stick, text size steps within bounds', () => {
  const store=new Map(), classes=new Set(), vars={}, attrs={};
  const el=id=>({id,textContent:'',title:'',disabled:false,setAttribute:(a,v)=>{attrs[id+':'+a]=v;}});
  const nodes={'theme-btn':el('theme-btn'),'text-size-label':el('text-size-label'),'text-smaller':el('text-smaller'),'text-larger':el('text-larger')};
  const options=['auto','light','dark'].map(choice=>({getAttribute:()=>choice,setAttribute:(a,v)=>{attrs['opt-'+choice]=v;}}));
  const system={matches:false};
  const {context}=environment(['displayRead','displayWrite','themeChoice','textSize','applyDisplay','setTheme','stepTextSize','applyThemeChrome','toggleTheme'],{
    THEME_KEY:'briefing_theme',SIZE_KEY:'briefing_text_size',TEXT_SIZES:[0.9,1,1.1,1.25],systemLight:system,
    localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}});
  Object.assign(context.document,{body:{classList:{toggle:(c,on)=>{on?classes.add(c):classes.delete(c);},contains:c=>classes.has(c)}},
    documentElement:{style:{setProperty:(k,v)=>{vars[k]=v;}}},querySelector:()=>null,querySelectorAll:()=>options,getElementById:id=>nodes[id]||null});
  context.applyDisplay();
  assert.equal(classes.has('light'),false,'Auto on a dark device'); assert.match(nodes['theme-btn'].innerHTML,/#i-contrast/); assert.equal(attrs['opt-auto'],'true');
  system.matches=true; context.applyDisplay();
  assert.equal(classes.has('light'),true,'Auto follows the device to light');
  context.setTheme('dark'); assert.equal(classes.has('light'),false); assert.equal(store.get('briefing_theme'),'dark'); assert.match(nodes['theme-btn'].innerHTML,/#i-moon/);
  context.setTheme('auto'); assert.equal(store.has('briefing_theme'),false,'Auto is the default, nothing stored');
  store.set('briefing_theme','light'); context.applyDisplay(); assert.match(nodes['theme-btn'].innerHTML,/#i-sun/,'a choice made with the old toggle is kept');
  context.toggleTheme(); assert.equal(store.get('briefing_theme'),'dark','the old toggle still works');
  assert.equal(vars['--reading-zoom'],'1');
  context.stepTextSize(1); context.stepTextSize(1); context.stepTextSize(1);
  assert.equal(vars['--reading-zoom'],'1.25'); assert.equal(nodes['text-size-label'].textContent,'125%'); assert.equal(nodes['text-larger'].disabled,true);
  context.stepTextSize(-1); context.stepTextSize(-1); context.stepTextSize(-1); context.stepTextSize(-1);
  assert.equal(vars['--reading-zoom'],'0.9'); assert.equal(nodes['text-smaller'].disabled,true);
  context.stepTextSize(1); assert.equal(store.has('briefing_text_size'),false,'100% stores nothing');
  store.set('briefing_text_size','3'); context.applyDisplay(); assert.equal(vars['--reading-zoom'],'1','an odd stored value falls back to 100%');
});
// Anything waiting on a model shows a turning ring and a timer counting up; past
// the usual time it says so, and it never claims a stage the server did not report.
test('the working indicator counts up from when the work started and flags a long wait', () => {
  const now = Date.parse('2026-09-26T05:00:00Z');
  const {context} = environment(['esc', 'aiElapsed', 'aiWorkingHtml', 'aiTickSoon'], {Date: class extends Date { static now() { return now; } }, AI_SLOW_NOTE: 'longer than usual', _aiTicker: 1});
  assert.equal(context.aiElapsed(0), '0:00'); assert.equal(context.aiElapsed(65999), '1:05'); assert.equal(context.aiElapsed(-5), '0:00');
  const fresh = context.aiWorkingHtml('Reading <this> story.', {slow: 180});
  assert.ok(fresh.includes('data-ai-since="' + now + '"') && fresh.includes('data-ai-slow="180"'));
  assert.ok(fresh.includes('Reading &lt;this&gt; story.'), 'escaped');
  assert.ok(fresh.includes('<span class="ai-time" aria-hidden="true">0:00</span><span class="ai-slow"></span>'), 'no note yet');
  const started = context.aiWorkingHtml('Generating', {since: '2026-09-26T04:40:00Z', slow: 1200});
  assert.ok(started.includes('>20:00</span>') && !started.includes('longer than usual'), 'an ISO start time, exactly at the limit');
  const late = context.aiWorkingHtml('Generating', {since: now - 1201000, slow: 1200});
  assert.ok(late.includes('>20:01</span><span class="ai-slow">longer than usual</span>'), 'past the limit on first paint');
  assert.ok(!context.aiWorkingHtml('Checking', {since: 'junk'}).includes('data-ai-slow'), 'no limit, no note; a bad start time counts from now');
});

// The wildcard: one story from outside the beats, with its lens, its checked
// link, a bridge back to Bob's work, and the story actions (but no votes).
test('the wildcard card shows its lens, link, bridge and story actions, all escaped', () => {
  const {context}=environment(['esc','uiIcon','srcHTML','wildcardLensLabel','wildcardHtml'],{BriefingPromptCore:{WILDCARD_LENSES:[{id:'far-field',label:'Far field'}]}});
  const html=context.wildcardHtml({lens:'far-field',headline:'Bacteria <eat> plastic',body:'Reported.',source:'Nature',url:'https://nature.com/x',bridge:'Worth asking whether',grounded:true});
  assert.ok(html.includes('Bacteria &lt;eat&gt; plastic'),'escaped');
  assert.ok(html.includes('Far field') && html.includes('From outside your usual beats'));
  assert.ok(html.includes('Linked · found by search') && html.includes('href="https://nature.com/x"'));
  assert.ok(!/verified/i.test(html),'a chip never claims more than a real link');
  assert.ok(html.includes('→ Back to your work:</strong> Worth asking whether'));
  ['note','cite','evidence','deeper'].forEach(a=>assert.ok(html.includes('data-card-act="'+a+'" data-sec="wildcard" data-idx="0"'),a));
  assert.ok(!html.includes('data-card-act="more"'),'no votes on the wildcard');
  assert.ok(html.includes('class="card wildcard-card"'),'a card, so Go deeper opens under it');
  assert.ok(context.wildcardHtml({lens:'x',headline:'H',body:'B',bridge:'Br'}).includes('No checked link'));
  assert.equal(context.wildcardLensLabel('gone'),'Wildcard');
  assert.equal(context.wildcardHtml(null),'');
});

// A saved dossier in Evidence reads as a document, including one saved before
// line breaks were kept: its parts are found again from the snapshot's markers.
test('a saved dossier reads as a document in Evidence, even an old flattened copy', () => {
  const {context}=environment(['esc','evidenceDetailLines','evidenceDetailHtml'],{_evidenceOpen:{},EVIDENCE_LABEL:/^(BI angle|Exposed|Would change the read|Wrong if|Built on):\s*/});
  const flat='Dossier · Strata storm claim turns toxic A claim escalated after rain. - Rain in March. - Mould followed. A$3.98bn — declared events (ICA) 12% — premium rise (APRA) '+
    'BI angle: Loss of use. Exposed: Strata insurers; Landlords Q1. Who owns the delay? Q2. How are mould <claims> reserved? Would change the read: AFCA ruling next month. '+
    'Source: Strata claims - insuranceNEWS — https://insurancenews.com.au/strata Source: AFCA — https://afca.org.au/d/1';
  const item={key:'k1',id:'briefing:2026-09-26:insurance:0:dossier',title:'Dossier: Strata storm claim turns toxic',detail:flat};
  assert.deepEqual([...context.evidenceDetailLines(item)],['A claim escalated after rain.','- Rain in March.','- Mould followed.','A$3.98bn — declared events (ICA)','12% — premium rise (APRA)',
    'BI angle: Loss of use.','Exposed: Strata insurers; Landlords','Q1. Who owns the delay?','Q2. How are mould <claims> reserved?','Would change the read: AFCA ruling next month.',
    'Source: Strata claims - insuranceNEWS — https://insurancenews.com.au/strata','Source: AFCA — https://afca.org.au/d/1']);
  const multi=Object.assign({},item,{detail:'Dossier · Strata storm claim turns toxic\nA claim escalated.\n- Rain in March.\nA$3.98bn — declared events (ICA)\nQ1. Who owns the delay?\nSource: AFCA — https://afca.org.au/d/1'});
  assert.deepEqual([...context.evidenceDetailLines(multi)],['A claim escalated.','- Rain in March.','A$3.98bn — declared events (ICA)','Q1. Who owns the delay?','Source: AFCA — https://afca.org.au/d/1'],'a new copy splits on its own lines');
  const html=context.evidenceDetailHtml(item);
  assert.ok(html.includes('<div class="evidence-doc-label">How it came about</div><ul><li>Rain in March.</li><li>Mould followed.</li></ul>'));
  ['The numbers','Questions to ask','Sources'].forEach(label=>assert.ok(html.includes('<div class="evidence-doc-label">'+label+'</div>'),label));
  assert.ok(html.includes('<li><strong>A$3.98bn</strong> — declared events (ICA)</li>'));
  assert.ok(html.includes('<p><strong>BI angle:</strong> Loss of use.</p>'));
  assert.ok(html.includes('<ol><li>Who owns the delay?</li><li>How are mould &lt;claims&gt; reserved?</li></ol>'),'escaped');
  assert.ok(html.includes('<a href="https://insurancenews.com.au/strata" target="_blank" rel="noopener noreferrer">Strata claims - insuranceNEWS ↗</a>'));
  assert.ok(!html.includes('Dossier · Strata storm'),'the lead repeats the title, so it goes');
  assert.ok(html.includes('is-folded') && html.includes('data-evidence-more="k1" aria-expanded="false">Show all'),'long, so it opens folded');
  context._evidenceOpen.k1=true;
  assert.ok(context.evidenceDetailHtml(item).includes('is-folded is-open') && context.evidenceDetailHtml(item).includes('Show less'),'stays open across a repaint');
  const aha={key:'k2',id:'briefing:2026-09-26:aha',title:'Alert counts understate exposure',detail:'Analytical insight · 2026-09-26\nAlert counts understate exposure\nWrong if: ASD data shows otherwise.\nSource: Cyber alerts — insuranceNEWS — https://x.com/a'};
  const ahaHtml=context.evidenceDetailHtml(aha);
  assert.ok(ahaHtml.includes('<p><strong>Wrong if:</strong> ASD data shows otherwise.</p>') && ahaHtml.includes('>Cyber alerts — insuranceNEWS ↗</a>'));
  assert.ok(!ahaHtml.includes('evidence-more'),'short, so no fold');
  assert.equal(context.evidenceDetailHtml({id:'briefing:2026-09-26:insurance:0',detail:'One <line>.'}),'<div class="evidence-item-detail">One &lt;line&gt;.</div>','an ordinary story is unchanged');
});

// Open source on a saved briefing item lands on its card: a story by position,
// a dossier on its story's card (not a "Dossier: …" headline no card has).
test('Open source finds the card a saved briefing item came from', () => {
  const {context}=environment(['evidenceBriefingTarget']);
  const plain=o=>JSON.parse(JSON.stringify(o));
  assert.deepEqual(plain(context.evidenceBriefingTarget({id:'briefing:Saturday--September-26--2026:ai:0:dossier',title:'Dossier: Australia steps up response to AI'})),
    {title:'Australia steps up response to AI',commandId:'briefing-ai-0',section:'ai',index:'0',dossier:true});
  assert.deepEqual(plain(context.evidenceBriefingTarget({id:'briefing:Saturday--September-26--2026:insurance:2',title:'Strata storm claim'})),
    {title:'Strata storm claim',commandId:'briefing-insurance-2',section:'insurance',index:'2',dossier:false});
  const wild=context.evidenceBriefingTarget({id:'briefing:Sunday--September-27--2026:wildcard:0:dossier',title:'Dossier: Fog into water'});
  assert.equal(wild.commandId,'','the wildcard card is found by headline'); assert.equal(wild.title,'Fog into water'); assert.equal(wild.dossier,true);
  const aha=context.evidenceBriefingTarget({id:'briefing:Saturday--September-26--2026:aha',title:'Alert counts understate exposure'});
  assert.equal(aha.commandId,''); assert.equal(aha.dossier,false); assert.equal(aha.title,'Alert counts understate exposure');
});

// Go deeper: the dossier renders escaped, leaves out empty parts, links only its
// checked sources, and gives Evidence a plain-text copy.
test('the dossier renders escaped, skips empty parts, and copies to Evidence as text', () => {
  const {context}=environment(['esc','uiIcon','capFirst','dossierHtml','dossierSnapshot','dossierError']);
  const d={summary:'A claim <escalated>.',background:['Rain in March.'],numbers:[{figure:'A$3.98bn',what:'declared events',source:'ICA'}],bi_angle:'Loss of use.',exposed:['Strata insurers'],
    client_questions:['How are mould claims reserved?','Who owns the delay?','What about accommodation?'],would_change:'AFCA ruling next month.',sources:[{title:'insuranceNEWS',url:'https://insurancenews.com.au/strata'}],
    story:{headline:'Strata storm claim turns toxic',source:'insuranceNEWS'},model:'gpt-5.5',generatedAt:'2026-09-26T02:00:00Z'};
  const html=context.dossierHtml(d);
  assert.ok(html.includes('A claim &lt;escalated&gt;.'),'escaped');
  ['How it came about','The numbers','The BI and claims angle','Who is exposed','Questions to ask a client','What would change this read','Sources'].forEach(t=>assert.ok(html.includes(t),t));
  assert.ok(html.includes('<strong>A$3.98bn</strong> — declared events'));
  assert.ok(html.includes('href="https://insurancenews.com.au/strata" target="_blank" rel="noopener noreferrer"'));
  assert.ok(html.includes('data-dossier-act="save"') && html.includes('data-dossier-act="rebuild"') && html.includes('data-dossier-act="close"'));
  const bare=context.dossierHtml({summary:'Only this.'});
  ['How it came about','The numbers','Who is exposed','Sources'].forEach(t=>assert.ok(!bare.includes(t),'no empty '+t));
  assert.equal(context.dossierHtml(null),'');
  const text=context.dossierSnapshot(d);
  assert.ok(text.startsWith('Dossier · Strata storm claim turns toxic'));
  assert.ok(text.includes('Q3. What about accommodation?') && text.includes('Source: insuranceNEWS — https://insurancenews.com.au/strata'));
  assert.ok(text.includes('A claim <escalated>.') && !text.includes('&lt;'),'plain text, not escaped HTML');
  assert.ok(context.dossierError({code:'functions/resource-exhausted'}).includes('ten dossiers today'));
  assert.ok(context.dossierError({code:'functions/internal',message:'internal'}).includes('needs a functions deploy'));
  const tags=context.dossierHtml({summary:'S',exposed:['Australian health insurers','government service providers','iPhone makers','eBay sellers','3PL operators']});
  ['Australian health insurers','Government service providers','iPhone makers','eBay sellers','3PL operators'].forEach(t=>assert.ok(tags.includes('<span>'+t+'</span>'),t));
  assert.equal(context.capFirst(''),'');
});

// Your accounts: a badge on each story that names one of his accounts or open
// calls, the accounts named in a briefing, and the list's one-line text form.
function promptCore(){
  const context={}; vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../lib/briefing-prompt-core.js',import.meta.url),'utf8'),context);
  return context.BriefingPromptCore;
}
test('stories that name an account or an open call get badges; the rest get none',()=>{
  const core=promptCore();
  const {context}=environment(['esc','storyText','activeAccounts','accountBadgesHtml','accountHitsIn'],{BriefingPromptCore:core,_accounts:null});
  const st={headline:'SAPN lifts pole replacement charges',body:'Essential Energy follows.',relevance:'Flows into every pole-strike invoice.'};
  const html=context.accountBadgesHtml(st,['NVDA']);
  assert.ok(html.includes('data-account="SA Power Networks"') && html.includes('data-account="Essential Energy"'),'the starter list, by alias too');
  assert.ok(!html.includes('data-call'),'no call named');
  const call=context.accountBadgesHtml({headline:'NVDA slides after earnings'},['NVDA']);
  assert.ok(call.includes('data-call="NVDA"') && call.includes('>Your call: NVDA</button>'));
  assert.equal(context.accountBadgesHtml({headline:'A quiet day in retail'},[]),'');
  // An account named only in the model's commentary never makes a badge.
  assert.equal(context.accountBadgesHtml({headline:'Court backs AIG over double cover dispute',body:'The Federal Court ruled for AIG.',relevance:'Allianz-style liability programs lose contribution recovery.'},[]),'',
    'a badge comes from what the story is about, never from the relevance line');
  assert.equal(context.accountBadgesHtml({headline:'Fog into drinking water',body:'A Chilean project.',bridge:'Worth asking what QBE would make of it.'},[]),'','nor from the wildcard bridge');
  const hits=context.accountHitsIn({sections:{insurance:[st,{headline:'QBE flags storm claims'}],global:[{headline:'Nothing relevant'}]}});
  assert.deepEqual([...hits.map(h=>h.name)],['QBE','SA Power Networks','Essential Energy'],'in list order');
  assert.deepEqual([...hits[1].headlines],['SAPN lifts pole replacement charges']);
});
test('the accounts list edits as one line per account, keeping each kind',()=>{
  const core=promptCore();
  const {context}=environment(['accountsToText','accountsFromText','guessAccountKind','accountKind'],{BriefingPromptCore:core,
    ACCOUNT_KIND_WORDS:{utility:'utility',utilities:'utility',law:'law',client:'client',insurer:'insurer',broker:'broker',other:'other'}});
  const text=context.accountsToText([{name:'QBE',aliases:['QBE Insurance'],kind:'insurer'},{name:'Optus',aliases:[],kind:'telco'}]);
  assert.equal(text,'QBE | QBE Insurance\nOptus');
  const back=context.accountsFromText('QBE | QBE Insurance, QBE AU\nOptus\n\nCebu Cold Chain Co | CCC',[{name:'QBE',aliases:[],kind:'insurer'},{name:'Optus',aliases:[],kind:'telco'}]);
  assert.deepEqual([...back.map(a=>a.name+'/'+a.kind+'/'+a.aliases.join(','))],['QBE/insurer/QBE Insurance,QBE AU','Optus/telco/','Cebu Cold Chain Co/other/CCC']);
  // A new name is grouped by its words; the third part sets it; a grouped name keeps its group.
  const more=context.accountsFromText('Western Power\nChubb\nGallagher | Arthur J. Gallagher\nDouglas Transport Pty Ltd\nKMF Haulage | | client\nAusgrid\nHall & Wilcox | | law',[{name:'Ausgrid',aliases:[],kind:'utility'}]);
  assert.deepEqual([...more.map(a=>a.name+'/'+a.kind)],['Western Power/utility','Chubb/insurer','Gallagher/broker','Douglas Transport Pty Ltd/other','KMF Haulage/client','Ausgrid/utility','Hall & Wilcox/law'],
    'a transport operator is not mistaken for a road authority');
  assert.equal(context.accountKind({name:'Western Power',aliases:[],kind:'other'}),'utility','a name saved under Others shows in its group without re-saving');
  assert.equal(context.accountKind({name:'Transport for NSW',aliases:[],kind:'road'}),'road');
  assert.equal(context.guessAccountKind({name:'SA DIT',aliases:['Department for Infrastructure and Transport']}),'road','aliases count');
});

// Meeting brief: his own material on a topic, gathered from the search index,
// saved evidence and dossiers; then a brief rendered, copied and saved.
function searchCore(){
  const context={Date,Intl}; vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../lib/intelligence-search-core.js',import.meta.url),'utf8'),context);
  return context.IntelligenceSearchCore;
}
test('a meeting brief gathers his own recent material on the topic, capped per kind',async()=>{
  const now=Date.parse('2026-09-27T01:00:00Z'), day=n=>new Date(now-n*86400000).toISOString();
  const core=searchCore();
  const index=core.buildIndex({decisions:[{id:'d1',asset:'Suncorp reserving call',reason:'BI reserves look light',status:'open',createdDate:'2026-09-20',saved:now-7*86400000}]})
    .concat(Array.from({length:9},(_,i)=>({id:'n'+i,source:'News',title:'Suncorp story '+i,detail:'d',searchText:core.normalized('News Suncorp story '+i),saved:now-i*86400000,entities:[]})))
    .concat([{id:'old',source:'News',title:'Suncorp ancient',detail:'',searchText:core.normalized('News Suncorp ancient'),saved:now-90*86400000,entities:[]}]);
  const {context}=environment(['meetingTokens','meetingMatches','meetingMaterial'],{IntelligenceSearchCore:core,MEETING_DAYS:42,MEETING_MAX:24,Date:class extends Date{static now(){return now;}},
    intelligenceSearchState:{loaded:true,loadedAt:now,index},loadIntelligenceSearchData:async()=>{},dailyBoostSearchEntries:()=>[],
    evidenceSetState:{data:{sets:[{items:[{title:'Suncorp lifts reserves',detail:'Summary line.\n- bullet',note:'check the APRA data',url:'https://example.com/s',capturedAt:day(2)},{title:'Unrelated',detail:'Nothing here',capturedAt:day(1)},
      {id:'briefing:x:insurance:0:dossier',title:'Dossier: Storm claims test Suncorp',detail:'Dossier · Storm claims test Suncorp\nClaims rise.',note:'Raise this with the broker',url:'https://abc.net.au/x',capturedAt:day(3)}]}]}},
    savedDossiers:async()=>({k1:{story:{headline:'Storm claims test Suncorp',url:'https://abc.net.au/x'},summary:'Claims rise.',bi_angle:'Loss of use.',generatedAt:day(3)},k2:{story:{headline:'Other insurer'},summary:'No match',generatedAt:day(1)}})});
  const found=await context.meetingMaterial('Suncorp');
  assert.equal(found.counts.News,6,'no more than six of one kind');
  assert.equal(found.counts.Decisions,1); assert.equal(found.counts.Evidence,1);
  assert.equal(found.counts.Dossier,1,'a dossier and its Evidence copy are one item');
  const kept=found.items.find(item=>item.kind==='Dossier');
  assert.equal(kept.title,'Storm claims test Suncorp'); assert.match(kept.text,/His note: Raise this with the broker/,'the copy with his note wins');
  assert.ok(!found.items.some(item=>/ancient/.test(item.title)),'older than six weeks stays out');
  const ev=found.items.find(item=>item.kind==='Evidence');
  assert.match(ev.text,/Summary line\..*His note: check the APRA data/); assert.equal(ev.url,'https://example.com/s');
  assert.equal(kept.url,'https://abc.net.au/x');
  assert.ok(found.items.every((item,i,all)=>!i||all[i-1].date>=item.date),'newest first');
});
test('a meeting brief renders escaped, copies as text, and says what it used',()=>{
  const {context}=environment(['esc','uiIcon','meetingBriefHtml','meetingBriefSnapshot','meetingCountsText','meetingError']);
  const b={topic:'Suncorp <Q3>',where_things_stand:'Reserves lifted.',recent:[{when:'20 Sep',what:'Reserves up',source:'insuranceNEWS',url:'https://x.com/a'},{what:'No link'}],
    his_threads:['On 18 Sep you noted the wording.'],questions:['Q one?','Q two?','Q three?'],watch:'APRA data, 30 Nov.',sources:[{title:'S',url:'https://x.com/a'}],materialCount:4,generatedAt:'2026-09-27T01:00:00Z'};
  const html=context.meetingBriefHtml(b);
  assert.ok(html.includes('Meeting brief · Suncorp &lt;Q3&gt;') && html.includes('4 of your items'));
  ['Lately','Your threads','Ask in the meeting','Watch afterwards','Sources'].forEach(t=>assert.ok(html.includes(t),t));
  assert.ok(html.includes('<strong>20 Sep</strong> — Reserves up <a class="dossier-src" href="https://x.com/a" target="_blank" rel="noopener noreferrer">(insuranceNEWS ↗)</a>'),'the text is plain; the source is the link');
  assert.ok(html.includes('<li>No link</li>'));
  assert.equal(context.meetingBriefHtml(null),'');
  const snap=context.meetingBriefSnapshot(b);
  assert.equal(snap.split('\n')[0],'Meeting brief · Suncorp <Q3>');
  assert.ok(snap.includes('- 20 Sep: Reserves up (insuranceNEWS)') && snap.includes('Thread: On 18 Sep you noted the wording.') && snap.includes('Q3. Q three?') && snap.includes('Watch: APRA data, 30 Nov.') && snap.includes('Source: S — https://x.com/a'));
  assert.equal(context.meetingCountsText({News:2,Dossier:1,Decisions:1}),'Using 4 of your items: 2 news stories, 1 dossier, 1 decision.');
  assert.match(context.meetingCountsText({}),/leans on the web search/);
  assert.match(context.meetingError({code:'functions/resource-exhausted'}),/five meeting briefs today/);
});
test('a saved meeting brief reads as a document in Evidence',()=>{
  const {context}=environment(['esc','evidenceDetailLines','evidenceDetailHtml'],{_evidenceOpen:{},EVIDENCE_LABEL:/^(BI angle|Exposed|Would change the read|Wrong if|Built on|Watch):\s*/});
  const item={key:'k',id:'meeting:m1:brief',title:'Meeting brief: Suncorp',detail:'Meeting brief · Suncorp\nReserves lifted.\n- 20 Sep: Reserves up (insuranceNEWS)\nThread: On 18 Sep you noted the wording.\nQ1. Q one?\nWatch: APRA data.\nSource: S — https://x.com/a'};
  const html=context.evidenceDetailHtml(item);
  assert.ok(!html.includes('Meeting brief · Suncorp'),'the title line is not repeated');
  assert.ok(html.includes('<div class="evidence-doc-label">Lately</div><ul><li>20 Sep: Reserves up (insuranceNEWS)</li></ul>'));
  assert.ok(html.includes('<div class="evidence-doc-label">Your threads</div><ul><li>On 18 Sep you noted the wording.</li></ul>'));
  assert.ok(html.includes('<p><strong>Watch:</strong> APRA data.</p>') && html.includes('<ol><li>Q one?</li></ol>'));
});

// What you use: counts only. A button is named by a data attribute, its inline
// handler or its id, never by its text; counts batch and survive a failed save.
function fakeEl(attrs, tag){
  return {tagName:tag||'BUTTON',id:attrs.id||'',parentElement:attrs.parent||null,
    getAttribute:n=>attrs[n]==null?null:attrs[n],hasAttribute:n=>attrs[n]!=null};
}
test('usage names come from attributes, handlers or ids, never from text',()=>{
  const names=['usageKey','usageNameFor'];
  const {context}=environment(names,{USAGE_ATTRS:[['data-card-act','card_'],['data-aha-act','aha_'],['data-account','account_brief',true],['data-track','']]});
  assert.equal(context.usageNameFor(fakeEl({'data-card-act':'deeper'})),'card_deeper');
  assert.equal(context.usageNameFor(fakeEl({'data-account':'QBE'})),'account_brief','the account name is not recorded');
  assert.equal(context.usageNameFor(fakeEl({onclick:"openEvidenceItem('a','b')"})),'fn_openevidenceitem');
  assert.equal(context.usageNameFor(fakeEl({onclick:"event.stopPropagation();commandTogglePin('n-1')"})),'fn_commandtogglepin','a handler that first stops the tap is still named');
  assert.equal(context.usageNameFor(fakeEl({onclick:'event.stopPropagation()'})),'','stopping the tap alone names nothing');
  assert.equal(context.usageNameFor(fakeEl({id:'meeting-run'})),'btn_meeting-run');
  assert.equal(context.usageNameFor(fakeEl({'data-track':'mirror_try'})),'mirror_try');
  assert.equal(context.usageNameFor(fakeEl({},'SUMMARY')),'','nothing to name it by: not counted');
  assert.equal(context.usageNameFor(fakeEl({parent:{id:'boost-library'}},'SUMMARY')),'open_boost-library');
  assert.equal(context.usageNameFor(null),'');
});
test('usage counts batch into one save per window, and a failed save keeps them',async()=>{
  const saves=[]; let failNext=false, timer=null;
  const {context}=environment(['usageKey','trackUse','flushUsage'],{_usage:{day:'',counts:{},timer:null,pruned:false},_firebaseUid:'alice',manilaDateKey:()=> '2026-09-26',
    setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{},fbAddUsage:async(uid,day,counts,drop)=>{if(failNext){failNext=false;throw new Error('offline');} saves.push({day,counts:{...counts},drop:[...drop]});}});
  context.trackUse('card_deeper'); context.trackUse('card_deeper'); context.trackUse('page_today');
  assert.equal(saves.length,0,'nothing saved yet');
  timer(); await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(saves[0].counts,{card_deeper:2,page_today:1});
  assert.equal(saves[0].drop.length,60,'old days dropped once a session'); assert.equal(saves[0].drop[0],'2026-07-27');
  failNext=true; context.trackUse('aha_save'); context.flushUsage(); await new Promise(r=>setTimeout(r,0));
  context.trackUse('aha_save'); context.flushUsage(); await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(saves[1].counts,{aha_save:2},'the failed count is carried into the next save');
  context._firebaseUid=null; context.trackUse('card_more'); context.flushUsage(); await new Promise(r=>setTimeout(r,0));
  assert.equal(saves.length,2,'not signed in: nothing saved'); assert.equal(context._usage.counts.card_more,1,'but the count is kept');
  context._firebaseUid='alice'; context.flushUsage(); await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(saves[2].counts,{card_more:1},'saved after sign-in');
});
test('the usage summary ranks the last 30 days and names what has gone unused',()=>{
  const {context}=environment(['usageSummary'],{USAGE_LABELS:{card_deeper:'Go deeper',page_today:'Today',account_brief:'Account: meeting brief'},USAGE_WATCH:['card_deeper','account_brief']});
  const s=context.usageSummary({'2026-09-26':{page_today:3,card_deeper:1},'2026-09-20':{page_today:2},'2026-07-01':{account_brief:9},'2026-09-25':{x:0}},'2026-09-26',30);
  assert.equal(s.activeDays,2,'a day with only zero counts is not active');
  assert.deepEqual([...s.used.map(u=>u.label+':'+u.count+':'+u.days)],['Today:5:2','Go deeper:1:1']);
  assert.deepEqual([...s.unused],['Account: meeting brief'],'older than 30 days does not count');
});
