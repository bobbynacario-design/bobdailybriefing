// App-only releases must use the shared last-good feed, not the Git snapshot.
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {initializeApp, applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {loadPublicMiroSports} from './refresh-sports.js';

export async function latestSports(db) {
  const collection = db.collection('briefings-bob');
  const pointer = await collection.doc('sports-latest').get();
  const key = pointer.exists && pointer.data()?.value;
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new Error('Missing or invalid shared Sports pointer; refusing stale publication');
  }
  const snapshot = await collection.doc('sports-' + key).get();
  const doc = snapshot.exists && snapshot.data();
  if (!doc || !Number.isFinite(Date.parse(doc.generatedAt)) ||
      !doc.modules || !Object.keys(doc.modules).length) {
    throw new Error('Missing or invalid shared Sports feed; refusing stale publication');
  }
  return doc;
}

async function main() {
  initializeApp({credential: applicationDefault(), projectId: 'pokerhq-a67e4'});
  const db = getFirestore();
  const doc = await latestSports(db);
  const miro = await loadPublicMiroSports(db);
  const publicDoc = miro ? {...doc, miro} : doc;
  writeFileSync(new URL('../sports-public.json', import.meta.url), JSON.stringify(publicDoc));
  console.log('Exported shared Sports feed checked at ' + doc.generatedAt);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
