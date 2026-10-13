'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {recordPick,listPicks}=require('./pse-paper');
const now='2026-10-13T02:00:00Z';
const company={symbol:'BDO',version:'pse-research-v1',type:'bank',priceDate:'2026-10-12',price:112,checkedAt:now,
  interimFresh:true,interim:{periodEnd:'2026-06-30',currency:'PHP'},metrics:{bookValue:121.78},brief:{view:'Research incomplete',risks:['Cash flow missing']}};
const input={requestId:'same-save-123',symbol:'BDO',approach:'quality',horizon:20,thesis:'Recurring earnings can support this valuation.',invalidation:'Credit costs rise and recurring earnings decline.',
  feePct:0.3,slippagePct:0.1,priceDate:company.priceDate,price:112,researchCheckedAt:now};
function mock(){
  const store=new Map([['briefings-bob/pse-research',{generatedAt:now,companies:[company]}],['briefings-bob/radar-ph',{board:[{symbol:'BDO',asOf:'2026-10-12',close:112}]}]]);
  const clone=x=>JSON.parse(JSON.stringify(x));
  const snap=path=>({exists:store.has(path),data:()=>clone(store.get(path))});
  function collection(path){return {doc:id=>({id,path:path+'/'+id,collection:n=>collection(path+'/'+id+'/'+n)}),orderBy:()=>collection(path),limit:()=>collection(path),get:async()=>({docs:[...store.keys()].filter(k=>k.startsWith(path+'/') && k.split('/').length===path.split('/').length+1).map(k=>({id:k.split('/').pop(),data:()=>clone(store.get(k))}))})};}
  const db={collection,runTransaction:async fn=>{
    const writes=[];
    const result=await fn({get:async ref=>snap(ref.path),create:(ref,data)=>{assert.equal(store.has(ref.path),false);writes.push([ref.path,clone(data)]);},set:(ref,data)=>writes.push([ref.path,clone(data)])});
    writes.forEach(([p,d])=>store.set(p,d));return result;
  }};
  return {db,store};
}
test('recording captures server evidence and time, ignores submitted snapshots and supports identical retries',async()=>{
  const {db,store}=mock();
  const r=await recordPick(db,'u1',{...input,uid:'other',research:{fake:true},recordedAt:'2000-01-01',lowMultiple:0.8,highMultiple:1.2},now);
  assert.equal(r.pick.uid,'u1');assert.equal(r.pick.recordedDay,'2026-10-13');assert.equal(r.pick.recordedAt,now);
  assert.deepEqual(r.pick.research,company);assert.equal(r.pick.valuation.low,97.42);
  const again=await recordPick(db,'u1',{...input,lowMultiple:0.8,highMultiple:1.2},'2026-10-14T02:00:00Z');assert.deepEqual(again,r);
  assert.equal(store.get('pse-paper-books/u1').count,1);
  await assert.rejects(()=>recordPick(db,'u1',{...input,thesis:'A different thesis with changed reasoning.'},now),e=>e.code==='already-exists');
});
test('changed, stale or mismatched evidence cannot be silently recorded',async()=>{
  for(const mutate of [s=>s.set('briefings-bob/radar-ph',{board:[{symbol:'BDO',asOf:'2026-09-01',close:112}]}),
    s=>s.set('briefings-bob/pse-research',{generatedAt:now,companies:[{...company,price:113}]}),
    s=>s.set('briefings-bob/pse-research',{generatedAt:'2026-09-01',companies:[company]})]){
    const {db,store}=mock();mutate(store);await assert.rejects(()=>recordPick(db,'u1',input,now),e=>e.code==='failed-precondition');assert.equal(store.has('pse-paper-books/u1'),false);
  }
  const {db}=mock();await assert.rejects(()=>recordPick(db,'u1',{...input,researchCheckedAt:'old'},now),/evidence changed/);
});
test('books are scoped by authenticated uid, keep losing outcomes and enforce the permanent capacity',async()=>{
  const {db,store}=mock();await recordPick(db,'u1',input,now);await recordPick(db,'u2',input,now);
  store.set('pse-paper-books/u1/outcomes/'+input.requestId,{status:'completed',netPriceReturn:-20});
  const a=await listPicks(db,'u1'),b=await listPicks(db,'u2');assert.equal(a.picks.length,1);assert.equal(a.picks[0].pick.uid,'u1');assert.equal(a.picks[0].outcome.netPriceReturn,-20);
  assert.equal(b.picks[0].outcome.status,'waiting-entry');assert.equal(b.picks[0].pick.uid,'u2');
  store.set('pse-paper-books/u3',{count:500});await assert.rejects(()=>recordPick(db,'u3',input,now),e=>e.code==='resource-exhausted');
});
