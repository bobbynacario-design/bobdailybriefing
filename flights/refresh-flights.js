import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {initializeApp,cert,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {SOURCES,ORIGINS,USER_AGENT,MAX_OFFERS} from './config.js';
import {parseSource} from './parse.js';
import {checkAnnouncementLinks,preferAnnouncement} from './announcement-links.js';
import {trackChanges} from './changes.js';
import {trimOffers} from './trim.js';
import {recordRunHealth} from '../lib/feed-health.js';

const started=Date.now(), dryRun=process.argv.includes('--dry-run'), force=process.argv.includes('--force');
const root=dirname(fileURLToPath(import.meta.url));
const checkedAt=new Date().toISOString();
const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let db;
async function fetchSource(source) {
  try {
    const response=await fetch(source.url,{headers:{'user-agent':USER_AGENT,accept:'text/html'},signal:AbortSignal.timeout(25000)});
    if(!response.ok) return {...source,status:'unavailable',checkedAt,items:[],message:'Airline returned HTTP '+response.status};
    const html=await response.text();
    if(html.length>4000000) throw Error('Page exceeded the reader size limit');
    return {...source,checkedAt,...parseSource(html,source,checkedAt)};
  } catch(error) {
    return {...source,status:'unavailable',checkedAt,items:[],message:error.name==='TimeoutError' ? 'Airline page timed out.' : 'Airline page could not be read.'};
  }
}
async function main() {
  let prior=null;
  if(!dryRun) {
    const key=join(root,'../radar/serviceAccountKey.json');
    initializeApp({projectId:'pokerhq-a67e4',credential:existsSync(key) ? cert(JSON.parse(readFileSync(key,'utf8'))) : applicationDefault()});
    db=getFirestore();
    const snap=await db.collection('briefings-bob').doc('flights-latest').get();
    prior=snap.exists ? snap.data() : null;
    if(!force && prior && Date.now()-Date.parse(prior.generatedAt)<6*3600000) {
      await recordRunHealth(db,'flights',{status:'skipped',asOf:prior.asOf,durationMs:Date.now()-started,message:'Recent scout reused; no model calls.'});
      console.log('Recent flight scout already available.');return;
    }
  }
  const results=[];
  // Two at a time, bounded timeout per public page. No anti-bot bypass or retries.
  for(let i=0;i<SOURCES.length;i+=2) results.push(...await Promise.all(SOURCES.slice(i,i+2).map(fetchSource)));
  const fresh=await checkAnnouncementLinks(results.flatMap(r=>r.items)), byId=new Map();
  for(const offer of fresh) {
    const existing=byId.get(offer.id);
    byId.set(offer.id,preferAnnouncement(existing,offer));
  }
  const failed=new Set(results.filter(r=>r.status!=='ok').map(r=>r.url));
  for(const offer of prior?.offers || []) {
    if(failed.has(offer.discoveryUrl || offer.sourceUrl) && !byId.has(offer.id) && Date.now()-Date.parse(offer.checkedAt)<48*3600000 &&
      (!offer.departureDate || offer.departureDate>=checkedAt.slice(0,10))) byId.set(offer.id,offer);
  }
  // Leave headroom under the 1 MiB document limit; trim harder if a page grows.
  let limit=MAX_OFFERS, offers=trackChanges(trimOffers([...byId.values()],limit),prior,checkedAt);
  while(limit>60 && Buffer.byteLength(JSON.stringify(offers))>850000) offers=trackChanges(trimOffers([...byId.values()],limit-=40),prior,checkedAt);
  const sources=results.map(({items,...row})=>({...row,offerCount:items.length}));
  const successful=results.filter(r=>r.status==='ok').length;
  const doc={asOf,generatedAt:checkedAt,origins:ORIGINS,offers,sources,
    summary:{successfulSources:successful,totalSources:SOURCES.length,fareCount:offers.filter(d=>d.kind==='advertised-fare').length,promoCount:offers.filter(d=>d.kind==='promo').length},
    changes:{newOffers:offers.filter(d=>d.change.status==='new').length,priceDrops:offers.filter(d=>d.change.status==='dropped').length,priceRises:offers.filter(d=>d.change.status==='rose').length,comparedWith:prior?.generatedAt || null},
    coverage:'Airline fares and labelled sale announcements; not an exhaustive worldwide fare search or live seat inventory.',modelCalls:0};
  sources.forEach(s=>console.log(s.id+': '+s.status+' · '+s.message));
  console.log(JSON.stringify({bytes:Buffer.byteLength(JSON.stringify(doc)),offersFound:byId.size,summary:doc.summary,origins:ORIGINS,airlines:[...new Set(offers.map(d=>d.airline))],destinations:[...new Set(offers.map(d=>d.destination))]}));
  if(dryRun) return;
  if(!successful) throw Error('No airline source produced readable offers; previous scout preserved.');
  const batch=db.batch();
  batch.set(db.collection('briefings-bob').doc('flights-latest'),doc);
  batch.set(db.collection('briefings-bob').doc('flights-'+asOf),doc);
  await batch.commit();
  await recordRunHealth(db,'flights',{status:'ok',asOf,durationMs:Date.now()-started,message:offers.length+' offers; '+successful+'/'+SOURCES.length+' sources readable; no model calls.'});
}
main().catch(async error=>{
  console.error('Flight scout failed:',error.message);
  if(db) await recordRunHealth(db,'flights',{status:'failed',stage:'scout',durationMs:Date.now()-started,message:error.message});
  process.exitCode=1;
});
