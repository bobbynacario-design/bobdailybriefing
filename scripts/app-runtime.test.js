import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
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
