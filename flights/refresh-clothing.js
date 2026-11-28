import {readFileSync,existsSync,appendFileSync} from 'node:fs';
import {initializeApp,cert,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {SOURCES} from './clothing.js';
import {collectClothingSources} from './clothing-collector.js';
import {buildClothingFeed,CLOTHING_SOURCE_IDS} from './clothing-feed.js';
import {recordRunHealth} from '../lib/feed-health.js';
import {clothingRefreshDecision} from './clothing-refresh-policy.js';
const dry=process.argv.includes('--dry-run'),checkOnly=process.argv.includes('--check-only'),ifNeeded=process.argv.includes('--if-needed'),force=process.argv.includes('--force') || process.env.CLOTHING_FORCE==='1',started=Date.now(),checkedAt=new Date().toISOString();
let db;
async function main(){
  if(dry && (checkOnly || ifNeeded))throw Error('Use --dry-run separately from freshness checks.');
  let previous=null,prior=null,decision={needed:true,mode:'full',sourceIds:CLOTHING_SOURCE_IDS,reason:'Full collection requested.'};
  if(!dry){
    const key=new URL('../radar/serviceAccountKey.json',import.meta.url);
    initializeApp({projectId:'pokerhq-a67e4',credential:existsSync(key)?cert(JSON.parse(readFileSync(key,'utf8'))):applicationDefault()});db=getFirestore();
    const [feed,health]=await Promise.all(['shopping-latest','feed-health'].map(id=>db.collection('briefings-bob').doc(id).get()));previous=feed.exists?feed.data():null;
    if(checkOnly || ifNeeded)decision=clothingRefreshDecision(previous,health.exists?health.data().feeds?.shopping:null,{force,expectedIds:CLOTHING_SOURCE_IDS});
    const browserNeeded=decision.needed && SOURCES.some(s=>decision.sourceIds.includes(s.id) && (s.browser || s.id==='nike'));
    console.log(JSON.stringify({refreshNeeded:decision.needed,mode:decision.mode,sourceIds:decision.sourceIds,browserNeeded,reason:decision.reason,modelCalls:0}));
    if(checkOnly){if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'refresh_needed='+decision.needed+'\nbrowser_needed='+browserNeeded+'\n');return;}
    if(!decision.needed)return;
    const snap=await db.collection('briefings-bob').doc('shopping-history').get();prior=snap.exists?snap.data().products:null;
  }
  const results=await collectClothingSources(decision.sourceIds,checkedAt,{browser:process.env.CLOTHING_BROWSER==='1'});
  const {feed,history}=buildClothingFeed(previous,results,prior,checkedAt,{full:decision.mode==='full'}),bytes=Buffer.byteLength(JSON.stringify(feed));
  console.log(JSON.stringify({mode:decision.mode,attempted:results.map(s=>s.id),items:feed.items.length,promos:feed.promos.length,campaigns:feed.campaigns.length,sources:feed.sources.map(s=>({brand:s.brand,status:s.status,count:s.count,lastSuccessAt:s.lastSuccessAt,retainedCount:s.retainedCount})),bytes,modelCalls:0}));
  if(dry)return;
  if(bytes>850000)throw Error('Clothing feed exceeds size budget; previous feed preserved.');
  const batch=db.batch();batch.set(db.collection('briefings-bob').doc('shopping-latest'),feed);batch.set(db.collection('briefings-bob').doc('shopping-history'),{products:history,updatedAt:checkedAt});await batch.commit();
  await recordRunHealth(db,'shopping',{status:'ok',durationMs:Date.now()-started,asOf:feed.generatedAt.slice(0,10),message:(decision.mode==='sources'?'Retried '+results.length+' sources; full scan time unchanged. ':'')+feed.items.length+' priced markdowns, '+feed.promos.length+' dated branch offers; no AI calls.'});
}
main().catch(async e=>{console.error(e.message);if(db)await recordRunHealth(db,'shopping',{status:'failed',durationMs:Date.now()-started,message:e.message});process.exitCode=1;});
