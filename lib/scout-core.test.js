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
