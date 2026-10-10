(function(root) {
  'use strict';
  var kinds=['meeting','task','travel','sale','review','personal'];
  var arr=function(v){return Array.isArray(v)?v:[];};
  var text=function(v,n){return String(v==null?'':v).trim().slice(0,n || 1000);};
  function date(v) {
    if(!/^(19|20)\d{2}-\d{2}-\d{2}$/.test(v || ''))return '';
    var d=new Date(v+'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===v?v:'';
  }
  function offset(day,n){return date(day)?new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10):'';}
  function pht(raw) {
    var d=new Date(raw===undefined?Date.now():raw);
    if(!Number.isFinite(d.getTime()))return null;
    var p={};new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).forEach(function(x){p[x.type]=x.value;});
    return {day:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};
  }
  function manual(raw) {
    raw=raw || {};
    if(!/^[a-zA-Z0-9_-]{8,80}$/.test(raw.id || ''))return {error:'Invalid event identifier.'};
    var title=text(raw.title,160),start=date(raw.start),end=date(raw.end || raw.start),time=text(raw.time,5);
    if(!title)return {error:'Enter a title.'};
    if(!start || !end || end<start)return {error:'Choose valid dates; the end must be on or after the start.'};
    if(time && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || end!==start))return {error:'Use one date for a timed event, or remove the time for a multi-day plan.'};
    return {event:{id:raw.id,title:title,start:start,end:end,time:time,kind:['meeting','task','travel','personal'].includes(raw.kind)?raw.kind:'personal',location:text(raw.location,200),notes:text(raw.notes,1000),done:raw.done===true,updatedAt:text(raw.updatedAt,40)}};
  }
  function build(input) {
    input=input || {};var events=[];
    function add(e) {if(date(e.start) && date(e.end || e.start) && (e.end || e.start)>=e.start && e.title)events.push(Object.assign({end:e.start,time:'',done:false,detail:'',page:'',ref:''},e));}
    arr(input.manual).forEach(function(r){var m=manual(r);if(m.event)add(Object.assign({},m.event,{id:'manual-'+m.event.id,ref:m.event.id,origin:'manual',detail:m.event.notes,source:'Your event'}));});
    arr(input.meetings && input.meetings.items).forEach(function(m){
      if(!m || !m.start || !text(m.title))return;
      var s=pht(m.start),end=m.end?pht(m.end):s;
      if(!s || !end)return;
      var last=end.time==='00:00' && Date.parse(m.end)>Date.parse(m.start)?offset(end.day,-1):end.day;
      add({id:'meeting-'+text(m.id,100),kind:'meeting',title:text(m.title,160),start:s.day,end:last,time:s.time,utcStart:new Date(m.start).toISOString(),utcEnd:m.end && Date.parse(m.end)>Date.parse(m.start)?new Date(m.end).toISOString():'',detail:'Imported account meeting · '+text(m.calendar,40),source:'Connected calendar',page:m.briefId?'evidence':'about',ref:text(m.briefId,120)});
    });
    arr(input.decisions).forEach(function(d){if(d && d.status!=='closed' && !d.verdict && date(d.reviewDate))add({id:'decision-'+text(d.id,100),kind:'review',title:'Review: '+text(d.asset || d.subject || 'Decision',140),start:d.reviewDate,source:'Decisions',page:'decisions',ref:text(d.id,100),detail:text(d.reason)});});
    arr(input.evidence && input.evidence.sets).forEach(function(s){var q=s && s.question;if(q && q.status!=='closed' && date(q.deadline))add({id:'question-'+text(s.id,100),kind:'task',title:'Research due: '+text(s.name || q.prompt,140),start:q.deadline,source:'Questions & Evidence',page:'evidence',ref:text(s.id,100),detail:text(q.prompt)});});
    var saved=input.saved || {};
    Object.keys(saved).forEach(function(id){var d=saved[id];
      if(!d || d.kind!=='advertised-fare' || !date(d.departureDate) || !root.FlightsCore || !root.FlightsCore.officialUrl(d.bookingUrl))return;
      add({id:'trip-'+id,kind:'travel',title:(d.originName || d.origin)+' → '+(d.destinationName || d.destination),start:d.departureDate,end:d.returnDate || d.departureDate,source:'Saved flight',page:'flights',ref:id,destination:d.destination,saved:true,detail:'Tentative saved fare · not a booked ticket. '+text(d.airline,80),tentative:true});
    });
    var seen=new Set();arr(input.flights && input.flights.offers).concat(Object.values(saved)).forEach(function(d){
      if(!d || !d.campaign || !date(d.bookingEnd) || seen.has(d.id) || !root.FlightsCore || !root.FlightsCore.officialUrl(d.bookingUrl))return;seen.add(d.id);
      add({id:'sale-'+d.id,kind:'sale',title:'Sale ends: '+text(d.airline || d.title,130),start:d.bookingEnd,source:'Flights',page:'flights',ref:d.id,saved:!!saved[d.id],detail:'Booking deadline in Philippine time; base fares and route seats need confirmation.'});
    });
    var unique=new Set();return events.filter(function(e){if(unique.has(e.id))return false;unique.add(e.id);return true;}).sort(function(a,b){return a.start.localeCompare(b.start) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title);});
  }
  function onDay(events,day){return arr(events).filter(function(e){return e.start<=day && e.end>=day;});}
  function grid(month) {
    if(!/^\d{4}-\d{2}$/.test(month) || !date(month+'-01'))return [];
    var first=new Date(month+'-01T00:00:00Z'),begin=first.getTime()-first.getUTCDay()*86400000;
    return Array.from({length:42},function(_,i){var day=new Date(begin+i*86400000).toISOString().slice(0,10);return {day:day,other:day.slice(0,7)!==month};});
  }
  function filtered(events,kind,done){return arr(events).filter(function(e){return (!kind || kind==='all' || e.kind===kind) && (done || !e.done);});}
  function conflicts(events) {
    var out=[];
    arr(events).filter(function(e){return e.kind==='travel' && !e.done;}).forEach(function(t){
      arr(events).filter(function(e){return e.kind==='meeting' && !e.done && e.start<=t.end && e.end>=t.start;}).forEach(function(m){out.push({trip:t,meeting:m});});
    });return out;
  }
  function ics(events,now) {
    var escape=function(v){return text(v,2000).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');};
    var stamp=function(v){return new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');};
    var lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Daybook//Personal Calendar//EN','CALSCALE:GREGORIAN'];
    arr(events).forEach(function(e){
      if(!date(e.start) || !date(e.end))return;
      lines.push('BEGIN:VEVENT','UID:'+encodeURIComponent(e.id)+'@daybook','DTSTAMP:'+stamp(now || Date.now()));
      if(e.utcStart) {lines.push('DTSTART:'+stamp(e.utcStart));if(e.utcEnd)lines.push('DTEND:'+stamp(e.utcEnd));}
      else if(e.time)lines.push('DTSTART:'+stamp(e.start+'T'+e.time+':00+08:00'));
      else lines.push('DTSTART;VALUE=DATE:'+e.start.replace(/-/g,''),'DTEND;VALUE=DATE:'+offset(e.end,1).replace(/-/g,''));
      lines.push('SUMMARY:'+escape(e.title),'DESCRIPTION:'+escape((e.detail || '')+'\nSource: '+e.source));
      if(e.location)lines.push('LOCATION:'+escape(e.location));
      if(e.tentative)lines.push('STATUS:TENTATIVE','TRANSP:TRANSPARENT');
      lines.push('END:VEVENT');
    });lines.push('END:VCALENDAR');
    return lines.map(function(line){var chunks=[],chunk='',bytes=0;for(var c of line){var n=new TextEncoder().encode(c).length;if(bytes+n>75){chunks.push(chunk);chunk=' ';bytes=1;}chunk+=c;bytes+=n;}chunks.push(chunk);return chunks.join('\r\n');}).join('\r\n')+'\r\n';
  }
  root.DaybookCalendarCore={date:date,offset:offset,pht:pht,manual:manual,build:build,onDay:onDay,grid:grid,filtered:filtered,conflicts:conflicts,ics:ics,kinds:kinds};
})(typeof globalThis!=='undefined'?globalThis:this);
