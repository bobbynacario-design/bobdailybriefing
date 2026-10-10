import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkAnnouncementLinks,preferAnnouncement} from './announcement-links.js';
const primary={id:'same',campaign:true,airline:'Cebu Pacific',publisher:'Hello Mnl',evidenceUrl:'https://hellomnl.com/sale'};
const backup={...primary,publisher:'Logistics News PH',evidenceUrl:'https://logisticsnews.ph/sale'};
test('prefers a reachable report when the original publisher resets the connection',async()=>{
  const rows=await checkAnnouncementLinks([primary,backup],async url=>{
    if(url.includes('hellomnl'))throw Error('ECONNRESET');
    return {ok:true,url,headers:new Headers({'content-type':'text/html'})};
  });
  assert.equal(rows[0].evidenceStatus,'unavailable');assert.equal(rows[1].evidenceStatus,'ok');
  assert.equal(preferAnnouncement(rows[0],rows[1]).publisher,'Logistics News PH');
  assert.equal(preferAnnouncement(rows[1],rows[0]).publisher,'Logistics News PH');
});
test('rejects failed, non-HTML and off-domain links without failing the scout',async()=>{
  for(const response of [{ok:false,url:backup.evidenceUrl,headers:new Headers({'content-type':'text/html'})},
    {ok:true,url:'https://evil.test',headers:new Headers({'content-type':'text/html'})},
    {ok:true,url:backup.evidenceUrl,headers:new Headers({'content-type':'application/json'})}]) {
    assert.equal((await checkAnnouncementLinks([backup],async()=>response))[0].evidenceStatus,'unavailable');
  }
  let fetched=false;await checkAnnouncementLinks([{...primary,evidenceUrl:'javascript:alert(1)'}],async()=>{fetched=true;});assert.equal(fetched,false);
});
