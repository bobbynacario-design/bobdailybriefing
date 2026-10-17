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
  function zoneOffset(label,place){
    var z=text(label,20).toUpperCase().replace(/\s+/g,'');
    if(z==='PST')return /philippin|manila|makati|quezon|pasig|taguig|\bbgc\b|cebu|davao/i.test(place||'')?480:-480;
    if(Object.prototype.hasOwnProperty.call(zones,z))return zones[z];
    var m=/^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(z);
    return m&&+m[2]<=14?(m[1]==='-'?-1:1)*(+m[2]*60+(+m[3]||0)):null;
  }
  // "05:30 PHT (08:30 AEDT)": the published start time moved to Manila time.
  function phtTime(day,time,zone,place){
    var t=/^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text(time,5)),off=zoneOffset(zone,place);
    if(!date(day)||!t||off===null)return '';
    var at=new Date(Date.parse(day+'T00:00:00Z')+((+t[1])*60+(+t[2])-off+480)*60000).toISOString(),local=at.slice(0,10);
    var shift=local<day?' (previous day)':local>day?' (next day)':'';
    return at.slice(11,16)+' PHT'+shift+(off===480?'':' ('+('0'+t[1]).slice(-2)+':'+t[2]+' '+text(zone,20).toUpperCase().replace(/\s+/g,'')+')');
  }
  function theme(v){var hay=v.title+' '+v.topic+' '+v.organizer;return POKER_TAG.test(hay)||POKER_WORDS.test(hay)?'poker':AI_TAG.test(hay)||AI_WORDS.test(hay)?'ai':'';}
  function clean(raw,allowed,day){
    var seen={},out=[],ai=0;
    (Array.isArray(raw)?raw:[]).forEach(function(v){
      if(!v||!lanes[v.lane])return;
      var source=url(v.url),title=text(v.title,180),start=date(v.start),end=date(v.end)||start,deadline=date(v.deadline);
      if(!source||!title||seen[source]||(allowed&&!allowed.includes(source)))return;
      if(v.kind!=='community'&&!start)return;
      if(start&&end<start)return;
      if(day&&((end&&end<day)||(deadline&&deadline<day)))return;
      var time=text(v.time,5),zone=text(v.timezone||v.zone,20),location=text(v.location,180)||'Location not listed';
      var item={id:'s'+hash(source),title:title,lane:v.lane,kind:v.kind==='community'?'community':'event',url:source,
        start:start,end:end,deadline:deadline,when:text(v.when,160),format:formats[v.format]?v.format:'',time:time,zone:zone,pht:phtTime(start,time,zone,location),location:location,
        cost:text(v.cost,140)||'Cost not listed',organizer:text(v.organizer,140),why:text(v.why,400),topic:text(v.topic,100)};
      var kind=theme(item);
      if(kind==='poker'||(kind==='ai'&&++ai>1))return;
      seen[source]=true;
      out.push(item);
    });
    return out.slice(0,12);
  }
  function hash(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
  function expired(v,day){return !!((v.end&&v.end<day)||(v.deadline&&v.deadline<day));}
  function due(items,choices,day){var until=new Date(Date.parse(day+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);return items.filter(function(v){var c=choices[v.id]||{};return (c.saved||c.interested)&&!c.hidden&&!expired(v,day)&&v.deadline&&v.deadline>=day&&v.deadline<=until;}).sort(function(a,b){return a.deadline.localeCompare(b.deadline);}).slice(0,3);}
  var api={lanes:lanes,formats:formats,url:url,date:date,today:today,prefs:prefs,phtTime:phtTime,theme:theme,clean:clean,expired:expired,due:due};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ScoutCore=api;
})(typeof window!=='undefined'?window:globalThis);
