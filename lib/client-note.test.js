import {test} from 'node:test';
import assert from 'node:assert/strict';
import './client-note.js';
const N=globalThis.ClientNoteCore;
const plain=(v)=>JSON.parse(JSON.stringify(v));

test('the picker lists his accounts insurers first, then law firms and brokers, then a colleague',()=>{
  const kind=(a)=>a.kind;
  const list=N.recipients([{name:'Ausgrid',kind:'utility'},{name:'QBE',kind:'insurer'},{name:'Hall & Wilcox',kind:'law'},{name:'Allianz',kind:'insurer'},{name:'Sedgwick',kind:'broker'},{name:''}],kind);
  assert.deepEqual(plain(list.map((r)=>r.name)),['Allianz','QBE','Hall & Wilcox','Sedgwick','Ausgrid','A colleague']);
  assert.equal(list[list.length-1].kind,'colleague');
});

test('the email goes out with his edits and the checked links at the end',()=>{
  const mail=N.compose(' Ausgrid rates up ','Hi Sam,\nThe AER…\nKind regards,\nBob ',[{title:'AER: Ausgrid rates',url:'https://www.aer.gov.au/x'},{title:'bad',url:'javascript:1'}]);
  assert.equal(mail.subject,'Ausgrid rates up');
  assert.equal(mail.body,'Hi Sam,\nThe AER…\nKind regards,\nBob\n\nSources:\n- AER: Ausgrid rates: https://www.aer.gov.au/x');
  assert.equal(N.compose('S','Body',[]).body,'Body');
  assert.equal(N.gmailUrl({subject:'A & B',body:'Line 1\nLine 2'}),'https://mail.google.com/mail/?view=cm&fs=1&su=A%20%26%20B&body=Line%201%0ALine%202');
  assert.equal(N.outlookUrl({subject:'A',body:'B'}),'https://outlook.office.com/mail/deeplink/compose?subject=A&body=B');
});

test('how much he changed a draft: none, a little, all of it',()=>{
  const draft='Hi [Name], The AER reported that Ausgrid field worker rates rose 4.2% from 1 July. This may affect your open recovery files. Kind regards, Bob';
  assert.equal(N.changedRatio(draft,draft),0);
  const light=N.changedRatio(draft,draft.replace('[Name]','Sam').replace('may affect','could affect'));
  assert.ok(light>0 && light<0.2,'a name and one word: '+light);
  assert.equal(N.changedRatio('one two three','four five six'),1);
  assert.equal(N.changedRatio('',''),0);
});

test('the running record says what the drafts have been worth',()=>{
  const s=N.summary({a:{usedAt:'x',changed:0.1,rating:'little'},b:{usedAt:'y',changed:0.3,rating:'asis'},c:{rating:'unused'},d:{}});
  assert.equal(s.drafted,4);assert.equal(s.used,2);assert.equal(s.averageChanged,20);
  assert.equal(s.text,'4 drafted · 2 opened in your mail · on average 20% edited here first · 1 sent as is, 1 changed a little, 1 didn’t send it');
  assert.equal(N.summary({a:{usedAt:'x',changed:0}}).text,'1 drafted · 1 opened in your mail · on average 0% edited here first · 1 not rated yet');
  assert.deepEqual(plain(N.unratedNote({a:{usedAt:'2026-10-11T01:00:00Z',subject:'Old'},b:{usedAt:'2026-10-11T02:00:00Z',subject:'New'},c:{usedAt:'2026-10-11T03:00:00Z',rating:'asis'},d:{}})),{id:'b',note:{usedAt:'2026-10-11T02:00:00Z',subject:'New'}},'the latest opened and unrated');
  assert.equal(N.unratedNote({c:{usedAt:'x',rating:'asis'}}),null);
  assert.equal(N.summary({}).text,'');
});
