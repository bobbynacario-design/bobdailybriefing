import {readFileSync,existsSync} from 'node:fs';
import {initializeApp,cert,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {SOURCES,readSource,parseMall,priceHistory} from './clothing.js';
import {browserSources} from './clothing-browser.js';
import {recordRunHealth} from '../lib/feed-health.js';
const dry=process.argv.includes('--dry-run'),started=Date.now(),checkedAt=new Date().toISOString();
let db;
async function main(){
  let prior=null;
  if(!dry){
    const key=new URL('../radar/serviceAccountKey.json',import.meta.url);
    initializeApp({projectId:'pokerhq-a67e4',credential:existsSync(key)?cert(JSON.parse(readFileSync(key,'utf8'))):applicationDefault()});db=getFirestore();
    const snap=await db.collection('briefings-bob').doc('shopping-history').get();prior=snap.exists?snap.data().products:null;
  }
  const results=[];
  for(let i=0;i<SOURCES.length;i+=2)results.push(...await Promise.all(SOURCES.slice(i,i+2).map(s=>readSource(s,checkedAt))));
  if(process.env.CLOTHING_BROWSER==='1'){
    const rendered=await browserSources(SOURCES.filter(s=>s.browser),checkedAt);
    for(const r of rendered){const index=results.findIndex(s=>s.id===r.id),old=results[index];
      if(r.items.length || r.campaigns.length)results[index]={...r,items:r.items.length?r.items:old.items,candidates:old.candidates || []};
      else if(!old.items.length)results[index]={...r,candidates:old.candidates || []};
    }
  }
  const campaigns=results.flatMap(r=>r.campaigns || []).filter((r,i,all)=>all.findIndex(x=>x.id===r.id)===i).slice(0,40);
  const promos=[];
  for(const url of results.flatMap(r=>r.candidates).slice(0,8)){
    try{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(r.ok){const html=await r.text();if(html.length<4000000)promos.push(...parseMall(html,url,checkedAt));}}catch{/* Do not invent a branch offer when a detail page is unavailable. */}
  }
  const tracked=priceHistory(results.flatMap(r=>r.items).slice(0,240),prior,checkedAt);
  const sources=results.map(({items,candidates,campaigns,fetchUrl,browser,...row})=>row);
  const feed={kind:'shopping-feed',generatedAt:checkedAt,items:tracked.items,promos,campaigns,sources,modelCalls:0,coverage:'A bounded sample of official Philippine sale pages; not a complete catalogue or live branch inventory. Shipping and vouchers are unverified unless explicitly shown.'};
  console.log(JSON.stringify({items:feed.items.length,promos:promos.length,campaigns:campaigns.length,sources:sources.map(s=>({brand:s.brand,status:s.status,count:s.count})),bytes:Buffer.byteLength(JSON.stringify(feed)),modelCalls:0}));
  if(dry)return;
  if(results.every(r=>r.status==='unavailable'))throw Error('All clothing sources unavailable; previous feed preserved.');
  if(Buffer.byteLength(JSON.stringify(feed))>850000)throw Error('Clothing feed exceeds size budget; previous feed preserved.');
  const batch=db.batch();batch.set(db.collection('briefings-bob').doc('shopping-latest'),feed);batch.set(db.collection('briefings-bob').doc('shopping-history'),{products:tracked.history,updatedAt:checkedAt});await batch.commit();
  await recordRunHealth(db,'shopping',{status:'ok',durationMs:Date.now()-started,asOf:checkedAt.slice(0,10),message:feed.items.length+' priced markdowns, '+promos.length+' dated branch offers; no AI calls.'});
}
main().catch(async e=>{console.error(e.message);if(db)await recordRunHealth(db,'shopping',{status:'failed',durationMs:Date.now()-started,message:e.message});process.exitCode=1;});
