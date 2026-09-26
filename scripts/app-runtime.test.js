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
  const start=html.indexOf('function '+name+'(');
  assert.ok(start>=0,name);
  return html.slice(start,html.indexOf('\n}',start)+2);
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
test('aha actions preserve sources and invalidation when saved or scheduled',()=>{
  const data={date:'2026-09-26',aha:{title:'A useful connection',insight:'A provisional reading',chain:['First observation'],wrong_if:'The delay is temporary',links:['Source headline']}};
  let evidence, trial;
  const {context,element}=environment(['ahaSnapshot','handleAhaAction'],{_currentData:data,getAllStories:()=>[{story:{headline:'Source headline',source:'Publisher',url:'https://example.com/source'}}],currentBriefingKey:()=> '2026-09-26',openEvidencePicker:item=>evidence=item,createDailyBoostExperiment:(...args)=>{trial=args;return {ok:true,message:'Saved'};}});
  context.handleAhaAction('save');
  assert.equal(evidence.id,'briefing:2026-09-26:aha');
  assert.match(evidence.detail,/Wrong if: The delay is temporary/); assert.match(evidence.detail,/https:\/\/example.com\/source/);
  element('aha-review-date').value='2026-10-03'; context.handleAhaAction('confirm-check');
  assert.equal(trial[0],'Check whether: The delay is temporary'); assert.equal(trial[1],'2026-10-03'); assert.match(trial[2],/https:\/\/example.com\/source/);
});
test('absent Command dependency produces a recovery action, not initial placeholders', () => {
  const {context,element}=environment(['renderCommandCenter']);
  context.renderCommandCenter();
  assert.match(element('command-five').innerHTML,/Reload app/);
  assert.match(element('command-queue').textContent,/source tabs remain available/);
});
test('missing verification metadata renders an explicit unknown state', () => {
  const {context,element}=environment(['renderGroundingLine']);
  context.renderGroundingLine({grounding:null},{parentNode:{}});
  assert.match(element('grounding-line').textContent,/verification unknown/i);
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
  const {context}=environment(['getBriefingFeedback','getGeminiPrompt'],{getTodayBriefingDateLabel:()=> 'Friday, September 25, 2026',
    DailyBoostCore:{dateKey:()=> '2026-09-25'},dailyBoostFeedbackEntries:()=>entries});
  vm.runInContext(readFileSync(new URL('../lib/briefing-prompt-core.js',import.meta.url),'utf8'),context);
  assert.doesNotMatch(context.getGeminiPrompt(),/READER FEEDBACK/);
  entries={'2026-09-24':{feedback:[{headline:'Insurer lifts BI reserves again',source:'Insurance News',section:'insurance',vote:1},{headline:'Rates hold again',section:'markets',vote:-1}]},
    '2026-09-25':{feedback:[{headline:'Rates hold again',section:'markets',vote:0}]}};
  const prompt=context.getGeminiPrompt();
  assert.match(prompt,/READER FEEDBACK:\n- A READER FEEDBACK block near the end of this prompt/);
  assert.match(prompt,/More like this:\n- \[insurance\] Insurer lifts BI reserves again \(Insurance News\)/);
  assert.doesNotMatch(prompt,/Less like this/,'a vote taken back is no vote');
  assert.equal(prompt,context.BriefingPromptCore.buildBriefingPrompt({dateLabel:'Friday, September 25, 2026',feedback:context.BriefingPromptCore.buildReaderFeedback(entries,'2026-09-25')}));
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
  const {context}=environment(['esc','ahaHtml'],{AHA_KIND_LABELS:{'connection':'Connection','second-order':'Second-order','contrarian':'Contrarian'}});
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
