const {test} = require('node:test');
const assert = require('node:assert/strict');
const {authorize,guardedGeneration} = require('./generation-guard');
function database() {
  const records = new Map(); let chain = Promise.resolve();
  const ref = key => ({key,set:async (value,opts) => records.set(key,opts && opts.merge ? {...records.get(key),...value} : value)});
  return {collection:name => ({doc:id => ref(name+'/'+id)}),runTransaction:fn => {
    const run = chain.then(() => fn({get:async r => ({exists:records.has(r.key),data:() => records.get(r.key)}),set:(r,v) => records.set(r.key,v)}));
    chain = run.catch(() => {}); return run;
  }};
}
test('only verified configured owners can generate', () => {
  assert.throws(() => authorize({token:{email:'other@example.com',email_verified:true}},['owner@example.com']));
  assert.throws(() => authorize({token:{email:'owner@example.com',email_verified:false}},['owner@example.com']));
  authorize({token:{email:'OWNER@example.com',email_verified:true}},['owner@example.com']);
});
test('concurrent requests reserve quota before starting provider work', async () => {
  const db = database(); let calls = 0;
  const run = requestId => guardedGeneration({db,uid:'owner',feature:'research',period:'2026-09',cap:1,requestId,input:{topic:'test'}},async () => { calls++; return {ok:true}; });
  const results = await Promise.allSettled([run('request01'),run('request02')]);
  assert.equal(calls,1); assert.equal(results.filter(r => r.status === 'fulfilled').length,1);
  assert.deepEqual(await run('request01'),{ok:true}); assert.equal(calls,1);
});
test('uncertain failures keep their reservation and are not retried', async () => {
  const options = {db:database(),uid:'owner',feature:'briefing',period:'today',cap:1,requestId:'request01',input:{}};
  let calls = 0; const work = async () => { calls++; throw Error('network timeout'); };
  await assert.rejects(guardedGeneration(options,work));
  await assert.rejects(guardedGeneration(options,work));
  assert.equal(calls,1);
});
