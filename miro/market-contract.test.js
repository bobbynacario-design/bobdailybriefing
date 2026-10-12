import {test} from 'node:test';
import assert from 'node:assert/strict';
import {confirmedResolutions, resolutionContext} from './market-contract.js';
import {buildMiroJournal} from './journal-miro.js';
import {CONFIG} from './config.js';

test('settlement requires confirmed resolution and an exact binary terminal price',()=>{
  const base={slug:'m',closed:true,umaResolutionStatus:'resolved',impliedYes:1,resolutionSource:'Official source'};
  for(const patch of [{closed:false},{umaResolutionStatus:'proposed'},{umaResolutionStatus:'disputed'},{umaResolutionStatus:''},{umaResolutionStatus:undefined},{impliedYes:.5},{impliedYes:.999},{impliedYes:.001},{impliedYes:null},{impliedYes:'1'}])
    assert.deepEqual(confirmedResolutions([{...base,...patch}],'2026-10-12'),[]);
  const resolved=confirmedResolutions([base,{...base,slug:'no',impliedYes:0}],'2026-10-12');
  assert.deepEqual(resolved.map(r=>r.outcome),[1,0]);assert.equal(resolved[0].resolutionStatus,'resolved');
  assert.equal(resolved[0].method,'confirmed-uma-terminal-price');
});

test('pending and disputed markets stay open in the forecast journal',()=>{
  const snapshots=['pending','disputed','yes','no'].map(slug=>({slug,asOf:'2026-10-11',impliedYes:.4,haircutProb:.5}));
  const prior=buildMiroJournal(null,snapshots,[],[],CONFIG);
  const markets=[{slug:'pending',closed:true,umaResolutionStatus:'proposed',impliedYes:1},
    {slug:'disputed',closed:true,umaResolutionStatus:'disputed',impliedYes:0},
    {slug:'yes',closed:true,umaResolutionStatus:'resolved',impliedYes:1},
    {slug:'no',closed:true,umaResolutionStatus:'resolved',impliedYes:0}];
  const next=buildMiroJournal(prior,[],[],confirmedResolutions(markets,'2026-10-12'),CONFIG);
  assert.equal(next.stats.nResolved,2);assert.deepEqual(Object.keys(next.open).sort(),['disputed','pending']);
});

test('contract context preserves rules and named sources without market prices',()=>{
  const context=resolutionContext({resolutionRules:'YES only after an official vote, by 31 December.',resolutionSource:'Senate',impliedYes:.8,yesAsk:.9});
  assert.deepEqual(JSON.parse(context),{resolutionRules:'YES only after an official vote, by 31 December.',resolutionSource:'Senate'});
});
