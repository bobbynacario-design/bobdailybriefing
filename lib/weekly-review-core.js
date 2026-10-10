(function(root) {
  'use strict';
  // The weekly loop: up to three commitments for a Monday-to-Sunday week
  // (Philippine time), a daily tick when he did something toward one, and a
  // Sunday review that scores the week and sets the next. Facts and
  // suggestions come from his own records only; nothing here calls a model.
  // Bob's order of focus (10 Oct 2026): money, work, health, then poker.
  // Areas, facts and ideas are listed in this order.
  var AREAS=[['money','Money'],['work','Work'],['health','Health'],['poker','Poker'],['time','Time & leave'],['learning','Learning'],['life','Life']];
  var FOCUS=['money','work','health','poker'];
  // A starter for a top area his records cannot speak to, labelled as such.
  var STARTERS={money:'Write one line in Decisions for every money move this week',work:'Block two hours of focused report writing on three days',health:'Walk 30 minutes on four days'};
  var RESULTS=['done','partly','missed'];
  var MAX=3, KEEP_WEEKS=26, ID=/^[a-z0-9-]{6,40}$/;
  var arr=function(v){return Array.isArray(v)?v:[];};
  var text=function(v,n){return String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,n);};
  function day(v) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(v || ''))return '';
    var d=new Date(v+'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===v?v:'';
  }
  function offset(d,n){return day(d)?new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10):'';}
  function today(now) {
    var p={};new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now===undefined?Date.now():now)).forEach(function(x){p[x.type]=x.value;});
    return p.year+'-'+p.month+'-'+p.day;
  }
  // Monday of the week holding d.
  function weekStart(d){if(!day(d))return '';var w=new Date(d+'T00:00:00Z').getUTCDay();return offset(d,-((w+6)%7));}
  function weekDays(start){var out=[];for(var i=0;i<7;i++)out.push(offset(start,i));return out;}
  function rank(area){for(var i=0;i<AREAS.length;i++)if(AREAS[i][0]===area)return i;return AREAS.length;}
  function byFocus(list){return list.map(function(x,i){return {x:x,i:i};}).sort(function(a,b){return rank(a.x.area)-rank(b.x.area) || a.i-b.i;}).map(function(o){return o.x;});}
  function areaLabel(id){for(var i=0;i<AREAS.length;i++)if(AREAS[i][0]===id)return AREAS[i][1];return 'Life';}
  function cleanCommitment(raw,start) {
    raw=raw || {};
    var t=text(raw.text,140);
    if(!t || !ID.test(raw.id || ''))return null;
    var days=weekDays(start),ticks=arr(raw.ticks).filter(function(x,i,a){return days.indexOf(x)>=0 && a.indexOf(x)===i;}).sort();
    return {id:raw.id,text:t,area:AREAS.some(function(a){return a[0]===raw.area;})?raw.area:'life',measure:text(raw.measure,100),ticks:ticks,result:RESULTS.indexOf(raw.result)>=0?raw.result:''};
  }
  function cleanWeek(raw,start) {
    raw=raw || {};start=weekStart(start || raw.start);
    if(!start)return null;
    var seen={},list=arr(raw.commitments).map(function(c){return cleanCommitment(c,start);}).filter(function(c){if(!c || seen[c.id])return false;seen[c.id]=true;return true;}).slice(0,MAX);
    return {start:start,end:offset(start,6),commitments:list,reflection:text(raw.reflection,400),setAt:text(raw.setAt,40),reviewedAt:text(raw.reviewedAt,40)};
  }
  function cleanWeeks(raw) {
    var out={};
    Object.keys(raw || {}).filter(day).sort().slice(-KEEP_WEEKS).forEach(function(k){var w=cleanWeek(raw[k],k);if(w && w.start===k)out[k]=w;});
    return out;
  }
  // Which step the review is on, from the weeks saved and today's date.
  // Sunday reviews the current week and sets the next. Earlier in the week it
  // first finishes an unreviewed last week, then sets this week if empty.
  function plan(weeks,d) {
    weeks=weeks || {};d=day(d) || today();
    var start=weekStart(d),prev=offset(start,-7),next=offset(start,7),dow=new Date(d+'T00:00:00Z').getUTCDay();
    var has=function(k){return !!(weeks[k] && weeks[k].commitments.length);},open=function(k){return has(k) && !weeks[k].reviewedAt;};
    var review='',set='';
    if(dow===0){review=open(start)?start:'';set=has(next)?'':next;}
    else if(open(prev)){review=prev;set=has(start)?'':start;}
    // With nothing set by Saturday, plan the coming week rather than one day.
    else if(!has(start))set=dow===6?(has(next)?'':next):start;
    return {review:review,set:set,due:!!(review || set)};
  }
  function progress(c,d) {
    var start=weekStart(d),days=weekDays(start).filter(function(x){return x<=d;});
    return {ticked:c.ticks.length,elapsed:days.length,today:c.ticks.indexOf(d)>=0};
  }
  // What his records show for a week. Each fact names where it comes from;
  // a week with little recorded is called thin rather than padded.
  function lookback(input,start) {
    input=input || {};start=weekStart(start);
    var end=offset(start,6),days=weekDays(start),facts=[];
    var w=input.weeks && input.weeks[start];
    if(w && w.commitments.length) {
      w.commitments.forEach(function(c){facts.push({area:c.area,source:'Commitment',text:'“'+c.text+'” — ticked on '+c.ticks.length+' of 7 days'+(c.result?' · you marked it '+c.result:'')});});
    }
    var opened=days.filter(function(x){var u=input.usage && input.usage[x];return u && Object.keys(u).some(function(k){return /^page_/.test(k);});}).length;
    if(input.usage)facts.push({area:'life',source:'Daybook',text:'Opened Daybook on '+opened+' of 7 days'});
    var leave=arr(input.calendarDays).filter(function(e){return /\bleave\b/i.test(e.title || '') && e.start<=end && e.end>=start;});
    if(leave.length)facts.push({area:'time',source:'Calendar',text:'Leave this week: '+leave.map(function(e){return e.title;}).join(', ')});
    var done=arr(input.events).filter(function(e){return e.origin==='manual' && e.kind==='task' && e.start>=start && e.start<=end;});
    if(done.length)facts.push({area:'work',source:'Calendar',text:done.filter(function(e){return e.done;}).length+' of '+done.length+' calendar tasks marked done'});
    var due=arr(input.decisions).filter(function(x){return x && x.reviewDate>=start && x.reviewDate<=end;});
    if(due.length)facts.push({area:'money',source:'Decisions',text:due.length+' decision review'+(due.length===1?'':'s')+' due · '+due.filter(function(x){return x.verdict;}).length+' with a verdict'});
    var played=arr(input.pokerStarred).filter(function(t){return t.day>=start && t.day<=end;});
    if(played.length)facts.push({area:'poker',source:'PokerHQ',text:'Starred to play: '+played.map(function(t){return t.name;}).join(', ')});
    return {start:start,end:end,facts:byFocus(facts),thin:facts.filter(function(f){return f.source!=='Daybook';}).length<2};
  }
  // Ideas for next week's commitments, each with the record it comes from.
  function suggestions(input,start) {
    input=input || {};start=weekStart(start);
    var end=offset(start,6),out=[],seen={};
    var add=function(area,t,why){t=text(t,140);if(!t || seen[t.toLowerCase()])return;seen[t.toLowerCase()]=true;out.push({area:area,text:t,why:text(why,120)});};
    var prev=input.weeks && input.weeks[offset(start,-7)];
    arr(prev && prev.commitments).filter(function(c){return c.result==='missed' || c.result==='partly' || (!c.result && c.ticks.length<3);}).forEach(function(c){add(c.area,c.text,'Carry over from last week');});
    arr(input.pokerStarred).filter(function(t){return t.day>=start && t.day<=end;}).forEach(function(t){add('poker','Play '+t.name+(t.venue?' at '+t.venue:''),'Starred in PokerHQ for '+t.label);});
    arr(input.windows).filter(function(w){return w.start>=start && w.start<=offset(end,21);}).slice(0,1).forEach(function(w){add('time','Decide and book what to do with '+w.label,'Leave coming up ('+w.days+' days off)');});
    arr(input.decisions).filter(function(x){return x && !x.verdict && x.reviewDate>=start && x.reviewDate<=end;}).forEach(function(x){add('money','Review the '+(x.asset || 'decision')+' call and record a verdict','Review date '+x.reviewDate);});
    var undated=arr(input.decisions).filter(function(x){return x && !x.verdict && x.status!=='closed' && !day(x.reviewDate);});
    if(undated.length)add('money','Give '+(undated.length===1?'your '+(undated[0].asset || 'open')+' call':'your open calls ('+undated.slice(0,3).map(function(x){return x.asset || 'call';}).join(', ')+')')+' a review date and one line on what would prove '+(undated.length===1?'it':'them')+' wrong',undated.length+' open '+(undated.length===1?'call has':'calls have')+' no review date in Decisions');
    arr(input.events).filter(function(e){return e && e.origin==='manual' && e.kind==='task' && !e.done && e.start>=start && e.start<=end;}).forEach(function(e){add('work','Finish: '+e.title,'Calendar task on '+e.start);});
    arr(input.evidenceSets).filter(function(s){var q=s && s.question;return q && q.status!=='closed' && day(q.deadline) && q.deadline>=start && q.deadline<=offset(end,7);}).forEach(function(s){add('work','Answer your working question: '+(s.name || s.question.prompt),'Deadline '+s.question.deadline);});
    arr(input.goals).filter(function(g){return g && !g.archived && g.nextMove;}).forEach(function(g){add('life',g.nextMove,'Next move for your goal “'+g.text+'”');});
    if(input.tryNext)add('learning',input.tryNext,'Suggested by your last weekly read');
    FOCUS.slice(0,3).forEach(function(a){if(!out.some(function(s){return s.area===a;}))add(a,STARTERS[a],'Starter idea · nothing in your records for '+areaLabel(a).toLowerCase()+' yet');});
    // Your focus order first, at most two ideas from any one area.
    var per={};
    return byFocus(out).filter(function(s){per[s.area]=(per[s.area] || 0)+1;return per[s.area]<=2;}).slice(0,7);
  }
  function newId(){return 'c-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);}
  root.WeeklyReviewCore={AREAS:AREAS,FOCUS:FOCUS,RESULTS:RESULTS,MAX:MAX,day:day,offset:offset,today:today,weekStart:weekStart,weekDays:weekDays,areaLabel:areaLabel,byFocus:byFocus,
    cleanCommitment:cleanCommitment,cleanWeek:cleanWeek,cleanWeeks:cleanWeeks,plan:plan,progress:progress,lookback:lookback,suggestions:suggestions,newId:newId};
  if(typeof module!=='undefined' && module.exports)module.exports=root.WeeklyReviewCore;
})(typeof globalThis!=='undefined'?globalThis:this);
