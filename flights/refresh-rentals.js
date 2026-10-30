import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {initializeApp,cert,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {AREAS,CAP,crawl,dedupe,benchmarks,trackHistory} from './rentals.js';
import {recordRunHealth} from '../lib/feed-health.js';
const dry=process.argv.includes('--dry-run'),started=Date.now(),checkedAt=new Date().toISOString();
const out=(process.argv.find(a=>a.startsWith('--out=')) || '').slice(6);
let db;
async function main(){
  let prior=null,priorHistory=null;
  if(!dry){
    const key=new URL('../radar/serviceAccountKey.json',import.meta.url);
    initializeApp({projectId:'pokerhq-a67e4',credential:existsSync(key)?cert(JSON.parse(readFileSync(key,'utf8'))):applicationDefault()});db=getFirestore();
    const [latest,history]=await Promise.all(['rentals-latest','rentals-history'].map(d=>db.collection('briefings-bob').doc(d).get()));
    prior=latest.exists?latest.data():null;priorHistory=history.exists?history.data():null;
  }
  const run=await crawl({checkedAt,prior,detailCap:dry?Number(process.env.RENTALS_DETAILS || 10):120,log:r=>console.error(r.site,r.loc,r.status,r.count)});
  const unique=dedupe(run.items),tracked=trackHistory(unique,priorHistory,checkedAt);
  const items=tracked.items.sort((a,b)=>a.price-b.price);
  const feed={kind:'rentals-feed',generatedAt:checkedAt,cap:CAP,areas:AREAS.map(({id,name})=>({id,name})),items,benchmarks:benchmarks(items),
    sources:run.sources,trackingSince:tracked.history.since,details:{read:run.detailRead,carried:run.detailCarried,failed:run.detailFailed},modelCalls:0,
    coverage:'Studio and 1-bedroom condos for rent up to ₱'+CAP.toLocaleString('en-PH')+' a month in Cubao, Ortigas, Makati CBD, BGC, the NAIA area (Newport/Villamor and Tambo), and the Clark area (Clark Freeport and Anunas/Friendship). DotProperty and Hoppler where available; Clark uses DotProperty. Areas are search neighbourhoods, not verified airport distances or travel times. Not every listing site: Lamudi, Rentpad, MyProperty and OnePropertee refuse automated reads.'};
  // Firestore refuses undefined values; a JSON round trip drops them.
  const doc=JSON.parse(JSON.stringify(feed)),bytes=Buffer.byteLength(JSON.stringify(doc));
  console.log(JSON.stringify({items:items.length,raw:run.items.length,details:feed.details,bytes,sources:run.sources.map(s=>s.site+' '+s.loc+' '+s.status+' '+s.count),benchmarks:feed.benchmarks,modelCalls:0}));
  if(out)writeFileSync(out,JSON.stringify(doc,null,1));
  if(dry)return;
  if(run.sources.every(s=>s.status==='unavailable'))throw Error('All rental sources unavailable; previous feed preserved.');
  if(bytes>850000)throw Error('Rentals feed exceeds size budget; previous feed preserved.');
  const batch=db.batch();batch.set(db.collection('briefings-bob').doc('rentals-latest'),doc);batch.set(db.collection('briefings-bob').doc('rentals-history'),tracked.history);await batch.commit();
  const down=run.sources.filter(s=>s.status==='unavailable').length;
  await recordRunHealth(db,'rentals',{status:'ok',durationMs:Date.now()-started,asOf:checkedAt.slice(0,10),message:items.length+' condos for rent read'+(down?', '+down+' of '+run.sources.length+' pages unavailable':'')+'; no AI calls.'});
}
main().catch(async e=>{console.error(e.message);if(db)await recordRunHealth(db,'rentals',{status:'failed',durationMs:Date.now()-started,message:e.message});process.exitCode=1;});
