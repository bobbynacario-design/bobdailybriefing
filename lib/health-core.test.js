import {test} from 'node:test';
import assert from 'node:assert/strict';
import './health-core.js';
import './weekly-review-core.js';
const H=globalThis.HealthCore;
const W=globalThis.WeeklyReviewCore;
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
  assert.deepEqual(plain(days),{'2026-10-15':{steps:8402,distanceKm:6.12,_stepsWhole:true,_distanceWhole:true},'2026-10-16':{steps:1510,distanceKm:0.9}},'midnight-to-midnight totals are marked whole');
});

test('overlapping readings from two sources count once; a whole-day total corrects downwards (Codex review)',()=>{
  const two=['steps|2026-10-15T08:00:00+08:00|2026-10-15T12:00:00+08:00|4000|count|iPhone','steps|2026-10-15T08:05:00+08:00|2026-10-15T11:55:00+08:00|3900|count|Pedometer app'];
  assert.equal(H.summarize(H.parseLines(two).samples)['2026-10-15'].steps,4000,'the larger source, not 7,900');
  const noSource=['steps|2026-10-15T08:00:00+08:00|2026-10-15T12:00:00+08:00|4000|count','steps|2026-10-15T08:05:00+08:00|2026-10-15T11:55:00+08:00|3900|count'];
  assert.equal(H.summarize(H.parseLines(noSource).samples)['2026-10-15'].steps,4000);
  const chunks=['steps|2026-10-15T08:00:00+08:00|2026-10-15T09:00:00+08:00|1000|count|iPhone','steps|2026-10-15T09:00:00+08:00|2026-10-15T10:00:00+08:00|1500|count|iPhone'];
  assert.equal(H.summarize(H.parseLines(chunks).samples)['2026-10-15'].steps,2500,'back-to-back readings still add up');
  const stored={days:{'2026-10-14':{steps:9000},'2026-10-15':{steps:7900}}};
  const whole=H.ingest(stored,{lines:'steps|2026-10-15T00:00:00+08:00|2026-10-16T00:00:00+08:00|4000|count'},NOW);
  assert.equal(whole.doc.days['2026-10-15'].steps,4000,'Health\'s own daily total replaces an overcount');
  const partial=H.ingest(stored,{lines:'steps|2026-10-15T09:00:00+08:00|2026-10-15T17:00:00+08:00|4000|count'},NOW);
  assert.equal(partial.doc.days['2026-10-15'].steps,7900,'a partial reading never lowers it');
  const window3=H.ingest(stored,{lines:['steps|2026-10-14T00:00:00+08:00|2026-10-15T00:00:00+08:00|2100|count','steps|2026-10-15T00:00:00+08:00|2026-10-16T00:00:00+08:00|4000|count']},NOW);
  assert.equal(window3.doc.days['2026-10-14'].steps,9000,'the first day of a multi-day send may be cut short: it never lowers');
  assert.equal(window3.doc.days['2026-10-15'].steps,4000);
  assert.ok(!('_stepsWhole' in window3.doc.days['2026-10-15']),'flags are not stored');
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

// ---- Lane 2: auto ticks and the body line ----
const row=(steps,sleepMin,bed,wake)=>Object.assign({},steps==null?{}:{steps},sleepMin==null?{}:{sleepMin,sleepKind:'inBed',bed,wake});

test('targets Apple Health can check, from the words or the measure',()=>{
  assert.deepEqual(plain(H.targetOf('Walk 8,000 steps on four days')),{kind:'steps',value:8000,label:'8,000 steps'});
  assert.equal(H.targetOf('10k steps a day').value,10000);
  assert.equal(H.targetOf('Walk 3 km at lunch').kind,'km');
  assert.deepEqual(plain(H.targetOf('In bed by 11:30 on five nights')),{kind:'bedBy',value:'23:30',basis:'inBed',label:'in bed by 23:30'});
  assert.equal(H.targetOf('asleep by 12').value,'00:00');
  assert.equal(H.targetOf('in bed by 1 am').value,'01:00');
  assert.equal(H.targetOf('7 hours in bed on five nights').kind,'sleepHours');
  assert.equal(H.targetOf('7 hours in bed on five nights').basis,'inBed');
  assert.deepEqual(plain(H.targetOf('7 hours sleep on five nights')),{kind:'sleepHours',value:7,basis:'asleep',label:'7 h asleep'});
  assert.equal(H.targetOf('asleep by 11:30 pm').basis,'asleep');
  assert.equal(H.targetOf('Walk 30 minutes on four days'),null,'exercise minutes need a Watch');
  assert.equal(H.targetOf('Submit two reports'),null);
  assert.equal(H.targetOf('Save 5 steps'),null,'too few steps to be a walking goal');
});

test('a day counts only once its steps are final; a sleep goal counts for the evening he went to bed',()=>{
  const days={'2026-10-14':row(8200),'2026-10-15':row(9100,400,'23:10','05:50'),'2026-10-16':row(1200,430,'00:20','07:30')};
  const t=H.targetOf('8,000 steps');
  assert.equal(H.metOn(days,'2026-10-14',t,'2026-10-16'),true);
  assert.equal(H.metOn(days,'2026-10-15',t,'2026-10-16'),true);
  assert.equal(H.metOn(days,'2026-10-16',t,'2026-10-16'),null,'today is not over');
  const bed=H.targetOf('in bed by 11:30 pm');
  assert.equal(H.metOn(days,'2026-10-14',bed,'2026-10-16'),true,'Wed evening: in bed 23:10');
  assert.equal(H.metOn(days,'2026-10-15',bed,'2026-10-16'),false,'Thu evening: in bed 00:20');
  assert.equal(H.metOn(days,'2026-10-16',bed,'2026-10-16'),null,'tonight is not in yet');
  assert.equal(H.metOn(days,'2026-10-15',H.targetOf('7 hours in bed'),'2026-10-16'),true,'430 minutes');
  assert.equal(H.metOn({'2026-10-15':row(null,480,'23:00','07:00')},'2026-10-14',H.targetOf('7 hours sleep'),'2026-10-16'),null,'8 h in bed is not 7 h of sleep (Codex review)');
  const asleep={'2026-10-15':Object.assign(row(null,450,'23:00','07:00'),{sleepKind:'asleep'})};
  assert.equal(H.metOn(asleep,'2026-10-14',H.targetOf('7 hours sleep'),'2026-10-16'),true,'recorded sleep counts');
});

test('auto ticks: added only, marked as from Apple Health, never on a day he unticked',()=>{
  const weeks={'2026-10-12':{commitments:[
    {id:'c-walk01',text:'Walk 8,000 steps on four days',area:'health',ticks:['2026-10-12'],measure:'',autoOff:['2026-10-14']},
    {id:'c-bed001',text:'Lights out',area:'health',measure:'in bed by 11:30 pm',ticks:[]},
    {id:'c-work01',text:'Submit two reports',area:'work',ticks:[]}]}};
  const doc={days:{'2026-10-12':row(3000),'2026-10-13':row(8500),'2026-10-14':row(9900,420,'23:05','06:05'),'2026-10-15':row(12000,380,'00:40','07:00'),'2026-10-16':row(500)},
    lastReceived:{at:'2026-10-15T23:20:00Z'}};
  const r=H.autoTicks(W,weeks,doc,NOW);
  const [walk,bed,work]=r.weeks['2026-10-12'].commitments;
  assert.deepEqual(walk.ticks,['2026-10-12','2026-10-13','2026-10-15'],'his own Monday tick stays; Wed was unticked by him');
  assert.deepEqual(walk.auto,['2026-10-13','2026-10-15']);
  assert.deepEqual(bed.ticks,['2026-10-13'],'Tue evening 23:05 counts; Wed evening 00:40 does not');
  assert.deepEqual(work.ticks,[]);
  assert.equal(r.added.length,3);
  assert.equal(H.ticksMessage(r.added),' Ticked from Apple Health: “Walk 8,000 steps on four days” (Tue, Thu); “Lights out” (Tue).');
  assert.equal(H.autoTicks(W,r.weeks,doc,NOW).added.length,0,'a second send adds nothing');
  assert.deepEqual(plain(W.cleanWeeks(r.weeks)['2026-10-12'].commitments[0].auto),['2026-10-13','2026-10-15'],'the review core keeps auto');
});

test('the body line: notable only when steps are well off his usual or short nights repeat',()=>{
  const days={};
  for(let i=2;i<=12;i++)days[H.offsetDay('2026-10-16',-i)]=row(8000+i*10,420,'23:00','06:00');
  days['2026-10-15']=row(3100);
  days['2026-10-16']=row(400,330,'01:10','06:40');
  days['2026-10-14']=Object.assign(row(8100),{sleepMin:340,sleepKind:'inBed'});
  const doc={days,lastReceived:{at:'2026-10-15T23:20:00Z'}};
  assert.deepEqual(plain(H.bodyLine(doc,NOW)),{text:'Body: 3,100 steps yesterday (well under your usual 8,100) · 5h30 in bed last night (2nd short night in 7)',notable:true,stale:false,since:'2026-10-16'});
  const calm={days:{'2026-10-15':row(8000),'2026-10-16':row(300,450,'23:00','06:30')},lastReceived:{at:'2026-10-15T23:20:00Z'}};
  assert.deepEqual(plain(H.bodyLine(calm,NOW)),{text:'Body: 8,000 steps yesterday · 7h30 in bed last night',notable:false,stale:false,since:'2026-10-16'});
  const old={days:{'2026-10-10':row(8000)},lastReceived:{at:'2026-10-11T02:00:00Z'}};
  assert.deepEqual(plain(H.bodyLine(old,NOW)),{text:'',notable:false,stale:true,since:'2026-10-11'});
  assert.equal(H.bodyLine({},NOW).text,'');
  assert.equal(H.bodyLine({},NOW).stale,false);
});
