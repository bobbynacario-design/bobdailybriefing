import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {initializeApp,cert,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {USER_AGENT} from './config.js';
import {scoutHotels} from './hotels.js';
import {recordRunHealth} from '../lib/feed-health.js';

// Runs after the flight scout: prices hotels for the dates of each city's
// cheapest fare in briefings-bob/flights-latest and writes hotels-latest.
// --dry-run reads both documents but writes nothing; --only=Tokyo,Taipei
// limits a dry run to those cities.
const started=Date.now(), dryRun=process.argv.includes('--dry-run');
const only=(process.argv.find(a=>a.startsWith('--only='))||'').slice(7).split(',').map(s=>s.trim()).filter(Boolean);
if(only.length && !dryRun) throw Error('--only is for dry runs; a partial document would drop the other cities.');
const root=dirname(fileURLToPath(import.meta.url));
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
let db;
async function fetchJson(url) {
  const response=await fetch(url,{headers:{'user-agent':USER_AGENT,accept:'application/json'},signal:AbortSignal.timeout(25000)});
  if(!response.ok) throw Error('HTTP '+response.status);
  return response.json();
}
async function main() {
  const key=join(root,'../radar/serviceAccountKey.json');
  initializeApp({projectId:'pokerhq-a67e4',credential:existsSync(key) ? cert(JSON.parse(readFileSync(key,'utf8'))) : applicationDefault()});
  db=getFirestore();
  const [flights,prior]=await Promise.all(['flights-latest','hotels-latest'].map(id=>db.collection('briefings-bob').doc(id).get()));
  if(!flights.exists) throw Error('No flight scout to pair hotels with.');
  const doc=await scoutHotels({offers:flights.data().offers || [],prior:prior.exists ? prior.data() : null,today,fetchJson,only:only.length ? only : null});
  doc.flightsGeneratedAt=flights.data().generatedAt || null;
  console.log(JSON.stringify({bytes:Buffer.byteLength(JSON.stringify(doc)),summary:doc.summary}));
  for(const c of doc.cities.filter(c=>c.stays.length)) for(const s of c.stays)
    console.log(c.city+' '+s.checkIn+'→'+s.checkOut+' ('+s.fare.origin+'): '+s.quotes.map(q=>{const h=c.hotels.find(h=>h.key===q.key);return h.name.slice(0,28)+' '+(q.rates[0] ? q.rates[0].site+' '+q.rates[0].rate : q.checked ? 'no rates' : 'unchecked');}).join(' | '));
  if(dryRun) return;
  // A run that read no hotel list at all keeps the previous document.
  if(!doc.summary.cities || doc.summary.calls && doc.summary.failedCalls===doc.summary.calls) throw Error('Hotel rates could not be read; previous hotel scout preserved.');
  await db.collection('briefings-bob').doc('hotels-latest').set(doc);
  await recordRunHealth(db,'hotels',{status:'ok',asOf:today,durationMs:Date.now()-started,
    message:doc.summary.pricedStays+'/'+doc.summary.stays+' stays priced; '+doc.summary.calls+' calls ('+doc.summary.failedCalls+' failed); no model calls.'});
}
main().catch(async error=>{
  console.error('Hotel scout failed:',error.message);
  if(db && !dryRun) await recordRunHealth(db,'hotels',{status:'failed',stage:'scout',durationMs:Date.now()-started,message:error.message});
  process.exitCode=1;
});
