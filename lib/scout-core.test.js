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
    {...event,url:'https://organiser.example/group',kind:'community',start:'',deadline:''}],null,'2026-10-18');
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
  assert.equal(C.phtTime('2026-11-17','08:30','UTC+11'),'05:30 PHT (08:30 UTC+11)');
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
