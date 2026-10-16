import {test} from 'node:test';
import assert from 'node:assert/strict';
import './health-core.js';
const H=globalThis.HealthCore;
const plain=v=>JSON.parse(JSON.stringify(v));
// Fri 16 Oct 2026, 07:30 in Manila.
const NOW=Date.parse('2026-10-15T23:30:00Z');

test('dates: ISO 8601 with its own offset, Manila when none is given, words refused',()=>{
  assert.deepEqual(H.parseWhen('2026-10-15T23:10:00+08:00'),{ms:Date.parse('2026-10-15T15:10:00Z'),off:480});
  assert.deepEqual(H.parseWhen('2026-10-15T23:10:00+0700'),{ms:Date.parse('2026-10-15T16:10:00Z'),off:420});
  assert.deepEqual(H.parseWhen('2026-10-15T23:10'),{ms:Date.parse('2026-10-15T15:10:00Z'),off:480},'no offset is Manila time');
  assert.equal(H.parseWhen('2026-10-15T15:10:00Z').off,480,'UTC is shown on Manila\'s day');
  assert.equal(H.parseWhen('15 Oct 2026 at 11:10 pm'),null);
  assert.equal(H.parseWhen('2026-13-01T00:00:00+08:00'),null);
  assert.equal(H.today(NOW),'2026-10-16');
  assert.equal(H.dayLabel('2026-10-16'),'Fri 16 Oct');
});

test('numbers as the phone writes them, and Health names as the Shortcut may write them',()=>{
  assert.equal(H.parseNumber('6,210'),6210);
  assert.equal(H.parseNumber('72.4 kg'),72.4);
  assert.equal(H.parseNumber('6210 count'),6210);
  assert.equal(H.parseNumber('kg'),null);
  assert.equal(H.metricOf('Step Count'),'steps');
  assert.equal(H.metricOf('Walking + Running Distance'),'distance');
  assert.equal(H.metricOf('Sleep Analysis'),'sleep');
  assert.equal(H.metricOf('Body Mass'),'weight');
  assert.equal(H.metricOf('Heart Rate'),'','heart rate is not resting heart rate');
});

test('steps and distance sum per local day; a duplicated line counts once',()=>{
  const lines=['steps|2026-10-15T00:00:00+08:00|2026-10-16T00:00:00+08:00|8,402|count',
    'steps|2026-10-16T00:00:00+08:00|2026-10-16T07:20:00+08:00|1200|count',
    'steps|2026-10-16T07:20:00+08:00|2026-10-16T07:25:00+08:00|310|count',
    'steps|2026-10-16T07:20:00+08:00|2026-10-16T07:25:00+08:00|310|count',
    'distance|2026-10-15T00:00:00+08:00|2026-10-16T00:00:00+08:00|6.12|km',
    'distance|2026-10-16T00:00:00+08:00|2026-10-16T07:20:00+08:00|900|m'];
  const days=H.summarize(H.parseLines(lines).samples);
  assert.deepEqual(plain(days),{'2026-10-15':{steps:8402,distanceKm:6.12},'2026-10-16':{steps:1510,distanceKm:0.9}});
});

test('a trip abroad lands on the local day where he was',()=>{
  // 23:30 in Bangkok on the 15th is 00:30 on the 16th in Manila.
  const days=H.summarize(H.parseLines(['steps|2026-10-15T23:30:00+07:00|2026-10-15T23:40:00+07:00|500|count']).samples);
  assert.deepEqual(Object.keys(days),['2026-10-15']);
});

test('an iPhone night: in-bed records merge across overlaps and land on the wake-up day',()=>{
  const lines=['sleep|2026-10-15T23:05:00+08:00|2026-10-16T03:00:00+08:00|In Bed|',
    'sleep|2026-10-16T02:30:00+08:00|2026-10-16T06:40:00+08:00|In Bed|',
    'sleep|2026-10-16T06:40:00+08:00|2026-10-16T06:50:00+08:00|Awake|'];
  const p=H.parseLines(lines);
  assert.equal(p.rejected,0,'awake is skipped, not a fault');
  assert.deepEqual(plain(H.summarize(p.samples)),{'2026-10-16':{sleepMin:455,sleepKind:'inBed',bed:'23:05',wake:'06:40'}});
});

test('asleep stages beat in-bed time when both are there; a nap and a long gap are separate nights',()=>{
  const lines=['sleep|2026-10-15T23:00:00+08:00|2026-10-16T07:00:00+08:00|In Bed|',
    'sleep|2026-10-15T23:30:00+08:00|2026-10-16T03:00:00+08:00|Asleep Core|',
    'sleep|2026-10-16T03:20:00+08:00|2026-10-16T06:30:00+08:00|3|',
    'sleep|2026-10-16T13:00:00+08:00|2026-10-16T13:40:00+08:00|In Bed|'];
  const n=H.nights(H.parseLines(lines).samples);
  assert.deepEqual(plain(n),[{day:'2026-10-16',sleepMin:400,sleepKind:'asleep',bed:'23:00',wake:'07:00'}],'the 40-minute nap is under 90 minutes and dropped');
});

test('numbers no body produces are turned away and counted',()=>{
  const r=H.ingest({},{lines:'steps|2026-10-16T00:00:00+08:00|2026-10-16T07:00:00+08:00|250000|count\nweight|2026-10-16T07:00:00+08:00||72.4|kg'},NOW);
  assert.equal(r.doc.days['2026-10-16'].steps,undefined);
  assert.equal(r.doc.days['2026-10-16'].weightKg,72.4);
  assert.equal(r.receipt.rejected,1);
});

test('one send: the larger reading of a day wins for steps and sleep; weight is taken as sent',()=>{
  const stored={days:{'2026-10-14':{steps:9000,at:'x'},'2026-10-15':{steps:3000,weightKg:73}}};
  const body={lines:['steps|2026-10-14T10:00:00+08:00|2026-10-15T00:00:00+08:00|4100|count', // the window cut this day short
    'steps|2026-10-15T00:00:00+08:00|2026-10-16T00:00:00+08:00|8402|count',
    'weight|2026-10-15T07:00:00+08:00||72.6|kg',
    'sleep|2026-10-15T23:05:00+08:00|2026-10-16T06:40:00+08:00|In Bed|']};
  const r=H.ingest(stored,body,NOW);
  assert.equal(r.doc.days['2026-10-14'].steps,9000,'a cut-short day does not overwrite the full count');
  assert.equal(r.doc.days['2026-10-14'].at,'x','an unchanged day keeps its stamp');
  assert.equal(r.doc.days['2026-10-15'].steps,8402);
  assert.equal(r.doc.days['2026-10-15'].weightKg,72.6);
  assert.equal(r.doc.days['2026-10-16'].sleepMin,455);
  assert.equal(r.receipt.changedDays,2);
  assert.equal(r.receipt.message,'Daybook got: 8,402 steps Thu 15 Oct · 7h35 in bed last night · 72.6 kg.');
  assert.deepEqual(r.receipt.fields,['steps','sleepMin','weightKg']);
  const again=H.ingest(r.doc,body,NOW+60000);
  assert.equal(again.receipt.changedDays,0);
  assert.match(again.receipt.message,/\(no change\)\.$/);
});

test('days outside two weeks back to tomorrow are not written; only the newest 400 are kept',()=>{
  const r=H.ingest({},{lines:['steps|2026-09-01T00:00:00+08:00|2026-09-02T00:00:00+08:00|5000|count','steps|2027-01-01T00:00:00+08:00|2027-01-02T00:00:00+08:00|5000|count']},NOW);
  assert.deepEqual(r.doc.days,{});
  const many={};for(let i=0;i<450;i++)many[H.offsetDay('2025-01-01',i)]={steps:i};
  const kept=H.mergeDays(many,{},NOW).days;
  assert.equal(Object.keys(kept).length,400);
  assert.equal(Object.keys(kept).sort()[0],H.offsetDay('2025-01-01',50));
});

test('the reply says what to fix when nothing could be used',()=>{
  assert.match(H.ingest({},{lines:''},NOW).receipt.message,/empty send/);
  assert.match(H.ingest({},{lines:'steps|16 Oct 2026 at 7:00 am|16 Oct 2026 at 7:05 am|300|count'},NOW).receipt.message,/ISO 8601/);
  assert.match(H.ingest({},{lines:'Steps 300'},NOW).receipt.message,/could not read the lines/);
  assert.match(H.ingest({},{lines:'Heart Rate|2026-10-16T07:00:00+08:00||62|count/min'},NOW).receipt.message,/did not recognise/);
  assert.equal(H.ingest({},'steps|2026-10-16T00:00:00+08:00|2026-10-16T07:00:00+08:00|1,200|count',NOW).receipt.message,'Daybook got: 1,200 steps today.','a bare string body works');
  assert.equal(H.ingest({},{lines:['steps|2026-10-16T00:00:00+08:00|2026-10-16T07:00:00+08:00|1200|count']},NOW).receipt.used,1,'a list works');
});

test('the About you rows: the newest days first, cleaned, with gaps marked',()=>{
  const rows=H.recentRows({'2026-10-16':{steps:1200,junk:1},'2026-10-14':{sleepMin:420,sleepKind:'odd',bed:'23:00',wake:'nope'}},'2026-10-16',3);
  assert.deepEqual(plain(rows),[{day:'2026-10-16',label:'Fri 16 Oct',empty:false,steps:1200},{day:'2026-10-15',label:'Thu 15 Oct',empty:true},
    {day:'2026-10-14',label:'Wed 14 Oct',empty:false,sleepMin:420,sleepKind:'inBed',bed:'23:00'}]);
  assert.equal(H.sleepText(455),'7h35');
});
