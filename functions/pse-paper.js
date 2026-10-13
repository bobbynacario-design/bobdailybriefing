'use strict';
const {createHash}=require('node:crypto');
const Core=require('./pse-research-core');
function error(code,message){const e=Error(message);e.code=code;return e;}
function bookRef(db,uid){return db.collection('pse-paper-books').doc(uid);}
async function recordPick(db,uid,input,now=new Date().toISOString()){
  const requestId=String(input && input.requestId || '');
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))throw error('invalid-argument','Invalid save identifier.');
  let clean;try{clean=Core.cleanPick(input);}catch(e){throw error('invalid-argument',e.message);}
  const fingerprint=createHash('sha256').update(JSON.stringify(clean)).digest('hex');
  const book=bookRef(db,uid),ref=book.collection('picks').doc(requestId);
  return db.runTransaction(async tx=>{
    const existing=await tx.get(ref);
    if(existing.exists){if(existing.data().fingerprint!==fingerprint)throw error('already-exists','This save identifier already has another thesis.');return {id:ref.id,pick:existing.data()};}
    const [researchSnap,priceSnap,bookSnap]=await Promise.all([tx.get(db.collection('briefings-bob').doc('pse-research')),tx.get(db.collection('briefings-bob').doc('radar-ph')),tx.get(book)]);
    const research=researchSnap.exists && researchSnap.data(),ph=priceSnap.exists && priceSnap.data();
    const company=research && (research.companies || []).find(c=>c.symbol===clean.symbol);
    const row=ph && (ph.board || []).find(r=>r.symbol===clean.symbol);
    const recordedDay=new Date(Date.parse(now)+8*3600000).toISOString().slice(0,10);
    const priceAge=row && (Date.parse(recordedDay)-Date.parse(row.asOf))/86400000;
    if(!company || !row || !(row.close>0) || !(priceAge>=0 && priceAge<=4))throw error('failed-precondition','Current company research and a recent completed close are required. Refresh PSE and try again.');
    if(company.priceDate!==row.asOf || company.price!==row.close || company.version!==Core.VERSION)throw error('failed-precondition','Research and price snapshots differ. Wait for the next PSE refresh.');
    if(input.priceDate!==company.priceDate || input.price!==company.price || input.researchCheckedAt!==company.checkedAt)throw error('failed-precondition','The evidence changed while this draft was open. Reload PSE and start a new draft with the updated facts.');
    const researchAge=(Date.parse(now)-Date.parse(research.generatedAt))/86400000;
    if(!(researchAge>=0 && researchAge<=4))throw error('failed-precondition','The research snapshot is stale. Wait for the next PSE refresh.');
    const valuation=clean.lowMultiple==null ? null : Core.scenario(company,clean.lowMultiple,clean.highMultiple);
    if(clean.lowMultiple!=null && !valuation)throw error('failed-precondition','This report cannot support the chosen PHP valuation scenario.');
    const count=bookSnap.exists ? Number(bookSnap.data().count || 0) : 0;
    if(count>=500)throw error('resource-exhausted','The permanent paper record has reached 500 picks.');
    const pick={...clean,uid,recordedAt:now,recordedDay,fingerprint,version:Core.VERSION,observedClose:row.close,observedDate:row.asOf,
      valuation,research:company,entryRule:'First completed close strictly after the Manila recording day.',
      evaluationRule:'Horizon counts PSE30 trading dates after entry; exit is the first available stock close on or after that date. Price-only with recorded assumed costs; no retrospective fills.'};
    tx.create(ref,pick);tx.set(book,{uid,count:count+1,updatedAt:now},{merge:true});
    return {id:ref.id,pick};
  });
}
async function listPicks(db,uid){
  const book=bookRef(db,uid);
  const picks=await book.collection('picks').orderBy('recordedAt','desc').limit(500).get();
  const results=await book.collection('outcomes').get();
  const outcomes={};results.docs.forEach(d=>{outcomes[d.id]=d.data();});
  return {picks:picks.docs.map(d=>({id:d.id,pick:d.data(),outcome:outcomes[d.id] || {status:'waiting-entry'}}))};
}
module.exports={recordPick,listPicks};
