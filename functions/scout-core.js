(function(root) {
  'use strict';
  var lanes={work:'Work & learning',people:'People & communities',interests:'Interests & discovery'};
  var formats={online:'Online','hybrid':'Hybrid · join online','in-person':'In person'};
  // Published timezone labels, minutes east of UTC. CST (China or US Central)
  // is ambiguous and left out; PST is Philippine time only for a place in the
  // Philippines.
  var zones={UTC:0,GMT:0,BST:60,CET:60,CEST:120,EST:-300,EDT:-240,CDT:-300,MST:-420,MDT:-360,PDT:-420,
    AEST:600,AEDT:660,ACST:570,ACDT:630,AWST:480,NZST:720,NZDT:780,PHT:480,PHST:480,SGT:480,HKT:480,MYT:480,WIB:420,ICT:420,JST:540,KST:540,IST:330};
  // At most one pick about AI or data science in a shortlist (18 Oct: four of
  // eight were), and none about poker: PokerHQ owns the tournaments.
  var AI_TAG=/\b(?:AI|A\.I\.|GenAI|LLMs?|ChatGPT)\b/,AI_WORDS=/artificial intelligence|machine learning|deep learning|generative ai|data (?:science|engineering)/i;
  var POKER_TAG=/\b(?:WSOP|WPT|APT|APPT)\b/,POKER_WORDS=/\bpoker\b|hold.?em\b/i;
  function text(v,n){return typeof v==='string'?v.trim().slice(0,n||400):'';}
  function url(v){try{var u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch(e){return '';}}
  function date(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:'';}
  function today(now){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now||Date.now()));}
  function prefs(v){v=v||{};return {interests:text(v.interests,600)||'AI, technology, art, design and cultural exhibits',geography:text(v.geography,300)||'Metro Manila, online, and selected travel-worthy opportunities'};}
  // Names organisers write out in full (18 Oct: "Philippine Standard Time"),
  // squeezed and upper-cased, to the abbreviations above.
  var zoneNames={PHILIPPINETIME:'PHT',PHILIPPINESTANDARDTIME:'PHT',AUSTRALIANEASTERNDAYLIGHTTIME:'AEDT',AUSTRALIANEASTERNDAYLIGHTSAVINGTIME:'AEDT',
    AUSTRALIANEASTERNSTANDARDTIME:'AEST',AUSTRALIANCENTRALDAYLIGHTTIME:'ACDT',AUSTRALIANCENTRALSTANDARDTIME:'ACST',AUSTRALIANWESTERNSTANDARDTIME:'AWST',
    NEWZEALANDDAYLIGHTTIME:'NZDT',NEWZEALANDSTANDARDTIME:'NZST',SINGAPORETIME:'SGT',SINGAPORESTANDARDTIME:'SGT',HONGKONGTIME:'HKT',JAPANSTANDARDTIME:'JST',COORDINATEDUNIVERSALTIME:'UTC'};
  // [minutes east of UTC, short label] for a published timezone, or null.
  // Offsets may be bare ("+0800", from an ISO time) or follow UTC/GMT.
  function zoneInfo(label,place){
    var z=text(label,40).toUpperCase().replace(/[\s.()]+/g,'');z=zoneNames[z]||z;
    if(z==='PST')return [/philippin|manila|makati|quezon|pasig|taguig|\bbgc\b|cebu|davao/i.test(place||'')?480:-480,'PST'];
    if(Object.prototype.hasOwnProperty.call(zones,z))return [zones[z],z];
    var m=/^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(z);
    if(!m||+m[2]>14||+(m[3]||0)>59)return null;
    return [(m[1]==='-'?-1:1)*(+m[2]*60+(+m[3]||0)),'UTC'+m[1]+('0'+m[2]).slice(-2)+':'+(m[3]||'00')];
  }
  // "05:30 PHT (08:30 AEDT)": the published start time moved to Manila time.
  function phtTime(day,time,zone,place){
    var t=/^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text(time,5)),zi=zoneInfo(zone,place),off=zi&&zi[0];
    if(!date(day)||!t||!zi)return '';
    var at=new Date(Date.parse(day+'T00:00:00Z')+((+t[1])*60+(+t[2])-off+480)*60000).toISOString(),local=at.slice(0,10);
    var shift=local<day?' (previous day)':local>day?' (next day)':'';
    return at.slice(11,16)+' PHT'+shift+(off===480?'':' ('+('0'+t[1]).slice(-2)+':'+t[2]+' '+zi[1]+')');
  }
  // Keep an actual instant as well as the organiser's printed date. Overnight
  // US sessions belong to the following day in Manila, including for CPE.
  function timing(v){
    v=v||{};var day=date(v.start),t=/^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text(v.time,5)),z=zoneInfo(v.timezone||v.zone,v.location);
    if(!day||!t||!z)return {startAt:'',localDate:day,localEnd:date(v.end)||day};
    var at=new Date(Date.parse(day+'T00:00:00Z')+(+t[1]*60+(+t[2])-z[0])*60000);
    var local=new Date(+at+480*60000).toISOString().slice(0,10),days=Math.round((Date.parse(date(v.end)||day)-Date.parse(day))/86400000);
    return {startAt:at.toISOString(),localDate:local,localEnd:shift(local,days)};
  }
  function sortKey(v){var t=timing(v);return t.startAt||t.localDate+'T23:59:59Z';}
  var MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'],CHECKS=['confirmed','not-found','unchecked'];
  // A page's visible words plus the ISO dates in its scripts (event data in
  // JSON-LD or app state), lower-cased with entities and dashes made plain.
  function pageText(html){
    var s=String(html||''),iso=Array.from(s.matchAll(/"(?:startDate|endDate|validFrom)"\s*:\s*"(20\d\d-\d\d-\d\d)/g),function(m){return m[1];}).join(' ');
    s=s.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]+>/g,' ')
      .replace(/&nbsp;|&#160;|&#xa0;/gi,' ').replace(/&ndash;|&mdash;/gi,'-').replace(/&amp;/gi,'&')
      .replace(/&#(\d+);/g,function(m,n){return +n<65536?String.fromCharCode(+n):' ';}).replace(/[\u2013\u2014\u2212]/g,'-').replace(/\s+/g,' ');
    return (s+' '+iso).toLowerCase();
  }
  // Does the page carry this date? Day and month in either order (ranges such
  // as "16-30 October" or "Nov. 07 -30" count), ISO, or d/m/y numbers. A match
  // followed closely by another year belongs to another year's event.
  // Where this date sits on the page, each with its year bound to it.
  function dateHits(page,iso){
    var out=[];if(!page||!date(iso))return out;
    var y=iso.slice(0,4),m=+iso.slice(5,7),d=+iso.slice(8,10),full=MONTHS[m-1];
    var mon='(?:'+full+'|'+full.slice(0,3)+(m===9?'|sept':'')+')\\.?',day='0?'+d+'(?:st|nd|rd|th)?',other='\\d{1,2}(?:st|nd|rd|th)?',join='(?:-|to|and|&)';
    var re=new RegExp(['\\b'+iso+'(?!\\d)',
      '\\b'+day+'\\s*(?:'+join+'\\s*'+other+'\\s*)?(?:of\\s+)?'+mon+'(?![a-z])',
      '(?:^|[^a-z])'+mon+'\\s*(?:'+other+'\\s*'+join+'\\s*)?'+day+'(?!\\d)(?:\\s*'+join+'\\s*'+other+')?',
      '\\b0?'+d+'[/.]0?'+m+'[/.]'+y+'\\b','\\b0?'+m+'/0?'+d+'/'+y+'\\b'].join('|'),'g'),hit;
    while((hit=re.exec(page))){
      // A year must be bound to this date, not merely somewhere on the page.
      // Prefer a trailing year, otherwise the closest preceding year in this
      // short clause ("2025 Annual conference: 10 November" is not 2026).
      var after=page.slice(re.lastIndex,re.lastIndex+16).match(/^\s*[,\s-]*\b(20\d\d)(?!\d)/);
      var before=page.slice(Math.max(0,hit.index-65),hit.index).match(/\b(20\d\d)\b[^.!?;]*$/);
      if(hit[0].includes(y)||(after&&after[1]===y)||(!after&&before&&before[1]===y))out.push(hit.index);
    }
    return out;
  }
  function dateOnPage(page,iso){return dateHits(page,iso).length>0;}
  // A pick's title as the words that identify it: short, generic and date words
  // are left out, so "–" against "-", "&" or a year in the title do not matter.
  var TITLE_STOP={the:1,and:1,for:1,with:1,from:1,your:1,our:1,this:1,that:1,into:1,about:1,are:1,how:1,what:1,why:1,who:1,its:1,all:1,new:1,part:1,webinar:1,event:1,events:1,session:1};
  function words(s){return String(s||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);}
  function titleWords(title){var seen={};return words(title).filter(function(w){if(w.length<3||TITLE_STOP[w]||/^\d+$/.test(w)||seen[w]||MONTHS.indexOf(w)>=0||MONTHS.some(function(m){return m.slice(0,3)===w;}))return false;seen[w]=true;return true;});}
  function coverage(text,list){if(!list.length)return 0;var have={};words(text).forEach(function(w){have[w]=true;});return list.filter(function(w){return have[w];}).length/list.length;}
  // What the page says it is about: its <title>, og:title and first <h1>.
  function headline(html){
    var s=String(html||''),pick=function(re){var m=re.exec(s);return m?m[1]:'';};
    return pageText([pick(/<title[^>]*>([\s\S]*?)<\/title>/i),pick(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)||pick(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i),pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i)].join(' | '));
  }
  // confirmed, not-found, or unchecked when the page could not be read (no
  // page, or too few words: an app shell that draws itself in the browser).
  // Given the pick's title, the date must also be this event's. On a page
  // about the event (its headline carries most of the title's words) any
  // year-bound date counts: on 18 Oct the exact-title rule (67c1f24) missed 5
  // of 6 genuine dates, which sat over 1,000 characters below the title. On a
  // listing, the date must follow the title's words closely, so a neighbouring
  // course's date never confirms this one.
  function dateCheck(page,iso,title,head){
    if(!date(iso))return '';
    if(typeof page!=='string'||page.length<200)return 'unchecked';
    var hits=dateHits(page,iso);if(!hits.length)return 'not-found';
    if(!title)return 'confirmed';
    var list=titleWords(title);if(!list.length)return 'unchecked';
    if(head&&coverage(head,list)>=0.7)return 'confirmed';
    var back=Math.max(200,String(title).length+120);
    return hits.some(function(p){return coverage(page.slice(Math.max(0,p-back),p+40),list)>=0.7;})?'confirmed':'unchecked';
  }
  // A community is a pick only while it meets: a meeting in the last 60 days
  // or one in the next 90 (18 Oct: one group had not met since August's end
  // and another "community" was a PHP 5,000 membership page). Join, sign-up
  // and membership pages are never the link.
  var SIGNUP=/\/(?:become-?a-?member|membership|join(?:-us|-now)?|sign-?up|register|registration|apply|pricing|plans|subscribe|checkout)(?:[\/.?#]|$)/i;
  function shift(day,n){return new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);}
  function active(v,day){return !!((v.lastActive&&v.lastActive<=day&&v.lastActive>=shift(day,-60))||(v.nextActive&&v.nextActive>=day&&v.nextActive<=shift(day,90)));}
  // A pre-release copy of a site is never the link (18 Oct: an ANZIIF webinar
  // came back on sc104-prod-cd-staging.anziif.com). Only the labels in front
  // of the site's own name are read, so dev.to stays.
  var PREVIEW_HOST=/(?:^|[.-])(?:staging|stage|stg|dev|develop|test|testing|uat|qa|preview|sandbox)(?:[.-]|$)/i;
  function previewHost(host){var labels=String(host||'').split('.');return labels.length>2&&PREVIEW_HOST.test(labels.slice(0,-2).join('.'));}
  // Who may attend. The 18 Oct AICLA webinar was for members only and its card
  // did not say; the page check also reads these phrases (membersOnly).
  var access={open:'Open to anyone',members:'Members only',invite:'By invitation or approval'};
  var MEMBERS_ONLY=/\bopen (?:only )?to (?:all )?(?:[a-z&]+ ){0,2}members\b(?! and)|\b(?:exclusive(?:ly)? (?:to|for)|available (?:only )?to|only for) (?:[a-z&]+ ){0,2}members\b|\bmembers[- ]only (?:event|webinar|session|seminar)s?\b|\bfor members only\b/;
  function membersOnly(page){return typeof page==='string'&&MEMBERS_ONLY.test(page);}
  // The model's reason sometimes recited its instructions ("The single AI
  // pick: ..."); that opening is cut.
  function why(v){var s=text(v,400).replace(/^(?:this is )?(?:the )?(?:single|one|only) (?:allowed )?AI pick\b[:;,.\s-]*/i,'');return s.charAt(0).toUpperCase()+s.slice(1);}
  // Why picks were left out, by lane, so an empty lane can say why.
  var reasons={invalid:'missing a title or link',source:'link not among the search results',duplicate:'listed twice',date:'no valid date',past:'already past or registration closed',
    host:'a staging or test copy of a site',signup:'a sign-up or membership page',inactive:'no meeting in the last 60 days or the next 90',activity:'meeting date not on its page',
    ai:'over the one AI pick',poker:'poker',limit:'over the 12-pick limit',calendar:'already in your work calendar'};
  function tally(stats,lane){stats.lanes=stats.lanes||{};return stats.lanes[lane]||(stats.lanes[lane]={returned:0,kept:0,dropped:{}});}
  function drop(stats,lane,reason){if(stats&&lanes[lane]){var l=tally(stats,lane);l.dropped[reason]=(l.dropped[reason]||0)+1;}}
  function kept(stats,items){Object.keys(lanes).forEach(function(k){if(stats.lanes&&stats.lanes[k])stats.lanes[k].kept=0;});(items||[]).forEach(function(v){tally(stats,v.lane).kept++;});return stats;}
  function laneNote(stat){
    if(!stat||!stat.returned)return 'None this week: the search found none.';
    var out=Object.keys(stat.dropped||{}).map(function(k){return stat.dropped[k]+' '+(reasons[k]||k);});
    return 'None this week: the search returned '+stat.returned+(out.length?'; left out: '+out.join(', ')+'.':'.');
  }
  function theme(v){var hay=v.title+' '+v.topic+' '+v.organizer;return POKER_TAG.test(hay)||POKER_WORDS.test(hay)?'poker':AI_TAG.test(hay)||AI_WORDS.test(hay)?'ai':'';}
  // stats, when given, collects what was returned and left out per lane.
  function clean(raw,allowed,day,stats){
    var seen={},out=[],ai=0;
    (Array.isArray(raw)?raw:[]).forEach(function(v){
      if(!v)return;
      if(!lanes[v.lane]){if(stats)stats.invalid=(stats.invalid||0)+1;return;}
      if(stats)tally(stats,v.lane).returned++;
      var no=function(reason){drop(stats,v.lane,reason);};
      var source=url(v.url),title=text(v.title,180),start=date(v.start),end=date(v.end)||start,deadline=date(v.deadline);
      if(!source||!title)return no('invalid');
      if(allowed&&!allowed.includes(source))return no('source');
      if(seen[source])return no('duplicate');
      if(previewHost(new URL(source).hostname))return no('host');
      if((v.kind!=='community'&&!start)||(start&&end<start))return no('date');
      if(day&&((end&&end<day)||(deadline&&deadline<day)))return no('past');
      var time=text(v.time,5),zone=text(v.timezone||v.zone,40),location=text(v.location,180)||'Location not listed';
      var item={id:'s'+hash(source),title:title,lane:v.lane,kind:v.kind==='community'?'community':'event',url:source,
        start:start,end:end,deadline:deadline,when:text(v.when,160),format:formats[v.format]?v.format:'',time:time,zone:zone,pht:phtTime(start,time,zone,location),location:location,
        cost:text(v.cost,140)||'Cost not listed',access:access[v.access]?v.access:'',organizer:text(v.organizer,140),why:why(v.why),topic:text(v.topic,100)};
      item.cpd=text(v.cpd,120);
      if(typeof v.cpeHours==='number'&&Number.isFinite(v.cpeHours)&&v.cpeHours>=0)item.cpeHours=Math.min(v.cpeHours,40);
      if(v.source&&v.id===calendarId(v)){item.id=v.id;item.source=text(v.source,80);}
      Object.assign(item,timing(item));
      if(date(v.firstSeen))item.firstSeen=v.firstSeen;
      if(date(v.lastSeen))item.lastSeen=v.lastSeen;
      if(start&&CHECKS.indexOf(v.dateCheck)>=0)item.dateCheck=v.dateCheck;
      if(deadline&&CHECKS.indexOf(v.deadlineCheck)>=0)item.deadlineCheck=v.deadlineCheck;
      if(item.kind==='community'){
        if(SIGNUP.test(new URL(source).pathname))return no('signup');
        item.lastActive=date(v.lastActive);item.nextActive=date(v.nextActive);
        if(CHECKS.indexOf(v.activityCheck)>=0)item.activityCheck=v.activityCheck;
        if(day&&!active(item,day))return no('inactive');
      }
      var kind=theme(item);
      if(kind==='poker')return no('poker');
      if(kind==='ai'&&++ai>1)return no('ai');
      seen[source]=true;
      out.push(item);
    });
    out.slice(12).forEach(function(v){drop(stats,v.lane,'limit');});
    return out.slice(0,12);
  }
  // Generation has a shortlist limit. Reading retained and saved items does
  // not: validate each item without silently applying the generation quota.
  function restore(raw){var seen={};return (Array.isArray(raw)?raw:[]).map(function(v){return clean([v])[0];}).filter(function(v){if(!v||seen[v.id])return false;seen[v.id]=true;return true;});}
  function calendarItem(v){return v&&clean([Object.assign({},v,{lane:'work',kind:'event',source:v.source||'calendar',id:calendarId(v)})])[0];}
  // The work calendar (functions/scout-sources.js) keeps each event from its
  // first sighting until two weeks after it ends. A source that read fine but no longer lists
  // an event twice running means it was withdrawn; a source that failed keeps
  // its events as they were.
  function calendarId(e){return 'c'+hash(String(e.url)+'|'+e.start);}
  function mergeCalendar(prev,run,day){
    var old=(prev&&prev.items)||{},items={},ok={};
    ((run&&run.sources)||[]).forEach(function(s){if(s.ok)ok[s.id]=true;});
    ((run&&run.events)||[]).forEach(function(e){var id=calendarId(e),was=old[id];
      items[id]=Object.assign({},e,timing(e),{id:id,firstSeen:(was&&was.firstSeen)||day,lastSeen:day,missed:0});});
    // An event that has ended stays two weeks, so a session attended can still be
    // logged for CPE after its organiser takes it down.
    Object.keys(old).forEach(function(id){var v=old[id],end=timing(v).localEnd;if(items[id]||end<shift(day,-14))return;
      if(end<day){items[id]=v;return;}
      var missed=(v.missed||0)+(ok[v.source]?1:0);if(missed<2)items[id]=Object.assign({},v,{missed:missed});});
    return {startedOn:(prev&&prev.startedOn)||day,items:items,sources:(run&&run.sources)||[],searched:(run&&run.searched)||[]};
  }
  // New: first seen in the last seven days, and not part of the first
  // collection (everything is "new" on the day a list starts).
  function isNew(v,startedOn,day){return !!(v&&date(v.firstSeen)&&startedOn&&v.firstSeen>startedOn&&v.firstSeen>=shift(day,-7));}
  // The weekly picks roll the same way: a pick seen again keeps its first
  // sighting; an earlier pick stays until it ends (a community, four weeks
  // after it was last returned), so a good find is not lost to next week's
  // search and the same exhibit is not "new" three times.
  function rollPicks(prev,fresh,day){
    var byId={},out=[];
    (prev||[]).forEach(function(v){if(v&&v.id)byId[v.id]=v;});
    (fresh||[]).forEach(function(v){var was=byId[v.id];out.push(Object.assign({},v,{firstSeen:(was&&was.firstSeen)||day,lastSeen:day}));delete byId[v.id];});
    Object.keys(byId).forEach(function(id){var v=byId[id];
      if(expired(v,day)||(v.kind==='community'&&(v.lastSeen||'')<shift(day,-28)))return;
      out.push(v);});
    return out.slice(0,24);
  }
  // The topics of his files (About you, 26 Sep work profile) a calendar entry's
  // title names, for its "On your work" tag. Titles only: ANZIIF's listing gave its
  // trade credit webinar the claims-inflation summary of the one before.
  var WORK_TOPICS=[['claims inflation',/claims? inflation|inflation/i],['business interruption',/business interruption|\bBI\b/],['loss of income',/loss of (?:income|use|profits?)/i],
    ['quantum',/quantum/i],['recoveries',/recover(?:y|ies)|subrogation/i],['liability',/liabilit/i],['motor',/motor|car insurance|vehicle/i],['property claims',/property|cash settlement|home insurance/i],
    ['expert evidence',/expert (?:evidence|report|witness)/i],['forensic accounting',/forensic/i],['policy wording',/utmost good faith|non-disclosure|misrepresentation|policy wording/i],['claims',/\bclaims?\b/i]];
  function workMatch(v){var hay=(v&&v.title)||'';for(var i=0;i<WORK_TOPICS.length;i++)if(WORK_TOPICS[i][1].test(hay))return WORK_TOPICS[i][0];return '';}
  // CIA CPE (the IIA): a practising CIA needs 40 hours a calendar year, at
  // least 2 on ethics, reported by 31 December. Bob is a Philippine CPA and a
  // CIA (18 Oct 2026); his PRC CPD is noted on the card, not tracked, because
  // its unit count for CPAs is not confirmed.
  var CIA={hours:40,ethics:2};
  function hrs(v,max){var n=Math.round((+v||0)*10)/10;return n>0?Math.min(n,max):0;}
  // Only explicit CPE hours prefill the log. Another body's points, or an
  // unknown duration, cannot establish CIA credit.
  function cpeDefault(v){
    v=v||{};return {hours:hrs(v.cpeHours,40),ethics:/\bethic/i.test(v.title||'')};
  }
  // An entry logged before the attendance states (the first tracker, 18 Oct)
  // has no status: one dated after today was a "Going" tap and is a plan; one
  // already past needs review. Its hours from another body's points (that
  // tracker prefilled them) are not CIA hours.
  function cpeEntry(v,day){
    var legacy=!v.status,status=['planned','attended','confirmed'].includes(v.status)?v.status:legacy&&day&&String(v.date)>day?'planned':'needs-review';
    return Object.assign({},v,{status:status,eligible:v.eligible===true},legacy&&!v.iia?{hours:0}:{});
  }
  // One change to the CPE log: start (hours already earned in a year, from his
  // IIA record), toggle (an event attended, or not), edit, remove.
  function applyCpe(doc,change,now){
    change=change||{};
    var next={uid:(doc&&doc.uid)||'',kind:'cpe',years:Object.assign({},doc&&doc.years),entries:Object.assign({},doc&&doc.entries)},id=text(change.id,40);
    var day=today(now),at=now==null?Date.now():now;
    if(change.op==='start'&&/^\d{4}$/.test(String(change.year))){
      var base=hrs(change.start,200),ethics=hrs(change.ethics,200);if(ethics>base)throw new Error('Ethics hours cannot exceed total starting hours.');
      next.years[change.year]={start:base,ethics:ethics};
    }
    else if(change.op==='toggle'&&id){
      if(next.entries[id])delete next.entries[id];
      else{var v=change.item||{},d=cpeDefault(v),t=timing(v);next.entries[id]={title:text(v.title,180)||'Untitled session',url:url(v.url),date:t.localDate||day,startAt:t.startAt,
        status:(t.startAt?Date.parse(t.startAt)>at:(t.localDate||day)>day)?'planned':'attended',hours:d.hours,ethics:d.ethics,eligible:false,evidence:'',organizer:text(v.organizer,60),iia:+v.cpeHours>0};}
    }
    else if(change.op==='edit'&&next.entries[id]){
      var entry=cpeEntry(next.entries[id],day);
      ['hours','ethics','eligible','evidence','status','date'].forEach(function(k){if(!Object.prototype.hasOwnProperty.call(change,k))return;
        if(k==='hours')entry.hours=hrs(change.hours,40);else if(k==='evidence')entry.evidence=text(change.evidence,600);
        else if(k==='date'){if(!date(change.date))throw new Error('Enter a valid session date.');if(entry.date!==change.date)entry.startAt='';entry.date=change.date;}
        else if(k==='status'){if(!['planned','attended','confirmed'].includes(change.status))throw new Error('Choose a valid attendance status.');entry.status=change.status;}
        else entry[k]=change[k]===true;});
      if(!Object.prototype.hasOwnProperty.call(change,'status')&&entry.status==='confirmed'&&(!entry.eligible||!entry.hours))entry.status='attended';
      if(entry.status!=='planned'&&(entry.date>day||(entry.startAt&&Date.parse(entry.startAt)>at)))throw new Error('This session has not started yet. Keep it planned.');
      if(entry.status==='confirmed'&&(!entry.eligible||!entry.hours))throw new Error('Enter actual hours and confirm eligibility before confirming credit.');
      entry.confirmedAt=entry.status==='confirmed'?(entry.confirmedAt||new Date(at).toISOString()):'';
      next.entries[id]=entry;
    }
    else if(change.op==='remove')delete next.entries[id];
    if(Object.keys(next.entries).length>300)throw new Error('Your CPE log is full (300). Remove an older entry first.');
    return next;
  }
  // The year so far: hours and ethics earned (his starting hours plus sessions
  // on or before today), booked (sessions still to come) and days to 31 Dec.
  function cpeSummary(doc,day,selectedYear){
    var year=/^\d{4}$/.test(selectedYear||'')?selectedYear:String(day).slice(0,4),base=((doc&&doc.years)||{})[year],entries=(doc&&doc.entries)||{};
    var list=Object.keys(entries).map(function(id){return Object.assign({id:id},cpeEntry(entries[id],day));}).filter(function(e){return String(e.date).slice(0,4)===year;}).sort(function(a,b){return String(a.date).localeCompare(String(b.date));});
    var add=function(f){return Math.round(list.filter(f).reduce(function(t,e){return t+(+e.hours||0);},0)*10)/10;};
    var start=hrs(base&&base.start,200),startEthics=Math.min(start,hrs(base&&base.ethics,200));
    var earned=function(e){return e.status==='confirmed'&&e.eligible&&e.date<=day;};
    return {year:year,hasStart:!!base,start:start,startEthics:startEthics,target:CIA.hours,ethicsTarget:CIA.ethics,
      earned:Math.round((start+add(earned))*10)/10,ethics:Math.round((startEthics+add(function(e){return earned(e)&&e.ethics;}))*10)/10,
      booked:add(function(e){return e.status==='planned'&&e.date>day;}),bookedEthics:add(function(e){return e.status==='planned'&&e.date>day&&e.ethics;}),
      pending:list.filter(function(e){return e.status!=='confirmed'&&(e.status!=='planned'||e.date<=day);}).length,
      daysLeft:Math.round((Date.parse(year+'-12-31T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000),entries:list};
  }
  function csvCell(v){var s=String(v==null?'':v);if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  function cpeCsv(doc,day,year){var s=cpeSummary(doc,day,year),rows=[['Date','Session','Status','Hours','Ethics','Eligible','Evidence / reference','Source','Credit confirmed at'],
    [s.year+'-01-01','Starting hours','baseline',s.start,s.startEthics,'User starting record','','','']];
    s.entries.forEach(function(e){rows.push([e.date,e.title,e.status,e.hours,e.ethics?'Yes':'No',e.eligible?'Yes':'No',e.evidence||'',e.url,e.confirmedAt||'']);});
    return rows.map(function(r){return r.map(csvCell).join(',');}).join('\r\n')+'\r\n';}
  function choiceItem(v){return v&&v.source?calendarItem(v):restore([v])[0];}
  function choiceDetails(v){return {note:text(v&&v.note,1000),followUp:date(v&&v.followUp)};}
  function reminders(items,choices,day){var until=shift(day,7),out=[];items.forEach(function(v){var c=choices[v.id]||{},t=timing(v);
    if(c.hidden)return;
    if(c.followUp&&c.followUp<=day)out.push({item:v,date:c.followUp,label:'Follow up',priority:0});
    if(!(c.saved||c.interested)||expired(v,day))return;
    if(v.deadline&&v.deadlineCheck!=='not-found'&&v.deadline>=day&&v.deadline<=until)out.push({item:v,date:v.deadline,label:'Register by',priority:1});
    else if(t.localDate>=day&&t.localDate<=until&&v.dateCheck!=='not-found')out.push({item:v,date:t.localDate,label:'Coming up',priority:2});
    });return out.sort(function(a,b){return a.priority-b.priority||a.date.localeCompare(b.date);}).slice(0,5);}
  function weeklyPicks(items,choices,day){var until=shift(day,7);return Object.keys(lanes).map(function(lane){return items.filter(function(v){var c=choices[v.id]||{},t=timing(v);
      return v.lane===lane&&!c.hidden&&!expired(v,day)&&v.dateCheck!=='not-found'&&(v.kind==='community'||t.localDate<=until||(v.deadline&&v.deadline<=until));
    }).sort(function(a,b){var ac=choices[a.id]||{},bc=choices[b.id]||{};return (+!!bc.interested+ +!!bc.saved)-(+!!ac.interested+ +!!ac.saved)||sortKey(a).localeCompare(sortKey(b));})[0];}).filter(Boolean);}
  function ics(v){var t=timing(v);if(!t.localDate)throw new Error('This opportunity has no scheduled date.');
    var escape=function(s){return String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');};
    var stamp=function(s){return s.replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');};
    var rows=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Daybook//Scout//EN','BEGIN:VEVENT','UID:'+escape(v.id)+'@daybook-scout','DTSTAMP:'+stamp(new Date().toISOString())];
    if(t.startAt)rows.push('DTSTART:'+stamp(t.startAt));else rows.push('DTSTART;VALUE=DATE:'+t.localDate.replace(/-/g,''),'DTEND;VALUE=DATE:'+shift(t.localEnd,1).replace(/-/g,''));
    rows.push('SUMMARY:'+escape(v.title),'LOCATION:'+escape(v.location),'DESCRIPTION:'+escape([v.url,v.when,!t.startAt?'Time not confirmed; check the source.':'End time not supplied; check the source.'].filter(Boolean).join('\n')),'URL:'+url(v.url),'END:VEVENT','END:VCALENDAR');
    // RFC 5545 lines fold at 75 UTF-8 octets, without splitting a character.
    return rows.map(function(line){var out='',n=0;for(var c of line){var bytes=unescape(encodeURIComponent(c)).length;if(n+bytes>75){out+='\r\n ';n=1;}out+=c;n+=bytes;}return out;}).join('\r\n')+'\r\n';}
  function hash(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
  function expired(v,day){var end=timing(v).localEnd;return !!((end&&end<day)||(v.deadline&&v.deadline<day));}
  function due(items,choices,day){var until=new Date(Date.parse(day+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);return items.filter(function(v){var c=choices[v.id]||{};return (c.saved||c.interested)&&!c.hidden&&!expired(v,day)&&v.deadline&&v.deadlineCheck!=='not-found'&&v.deadline>=day&&v.deadline<=until;}).sort(function(a,b){return a.deadline.localeCompare(b.deadline);}).slice(0,3);}
  var api={dateHits:dateHits,titleWords:titleWords,coverage:coverage,headline:headline,cpeEntry:cpeEntry,timing:timing,sortKey:sortKey,restore:restore,calendarItem:calendarItem,choiceItem:choiceItem,choiceDetails:choiceDetails,reminders:reminders,weeklyPicks:weeklyPicks,ics:ics,cpeCsv:cpeCsv,lanes:lanes,formats:formats,url:url,date:date,today:today,prefs:prefs,phtTime:phtTime,pageText:pageText,dateOnPage:dateOnPage,dateCheck:dateCheck,active:active,access:access,membersOnly:membersOnly,previewHost:previewHost,reasons:reasons,drop:drop,kept:kept,laneNote:laneNote,calendarId:calendarId,mergeCalendar:mergeCalendar,isNew:isNew,rollPicks:rollPicks,workMatch:workMatch,cpeDefault:cpeDefault,applyCpe:applyCpe,cpeSummary:cpeSummary,theme:theme,clean:clean,expired:expired,due:due};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ScoutCore=api;
})(typeof window!=='undefined'?window:globalThis);
