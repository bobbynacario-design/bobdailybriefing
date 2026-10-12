import {test} from 'node:test';
import assert from 'node:assert/strict';
import {aggregatePanel} from './scenario.js';
import {CONFIG} from './config.js';

test('missing quotes block research flags even with a large panel-price discrepancy',()=>{
  const market={impliedYes:.2,panelReads:[.7,.7,.7],closed:false,liquidityNum:20000};
  for(const quotes of [{},{yesBid:.19},{yesAsk:.21}]){
    const [m]=aggregatePanel([{...market,...quotes}],CONFIG);
    assert.ok(m.edge>.05);assert.equal(m.gate,'NO-GO');assert.equal(m.gateReason,'no-book');assert.equal(m.noBook,true);
  }
  const [quoted]=aggregatePanel([{...market,yesBid:.19,yesAsk:.21,mid:.2,spread:.02,depthTop:1000}],CONFIG);
  assert.equal(quoted.gate,'GO');assert.equal(quoted.noBook,false);
});
