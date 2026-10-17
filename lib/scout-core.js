(function(root) {
  'use strict';
  var lanes={work:'Work & learning',people:'People & communities',interests:'Interests & discovery'};
  function text(v,n){return typeof v==='string'?v.trim().slice(0,n||400):'';}
  function url(v){try{var u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch(e){return '';}}
  function date(v){return /^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:'';}
  function today(now){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now||Date.now()));}
  function prefs(v){v=v||{};return {interests:text(v.interests,600)||'AI, technology, art, design and cultural exhibits',geography:text(v.geography,300)||'Metro Manila, online, and selected travel-worthy opportunities'};}
  function clean(raw,allowed,day){
    var seen={},out=[];
    (Array.isArray(raw)?raw:[]).forEach(function(v){
      if(!v||!lanes[v.lane])return;
      var source=url(v.url),title=text(v.title,180),start=date(v.start),end=date(v.end)||start,deadline=date(v.deadline);
      if(!source||!title||seen[source]||(allowed&&!allowed.includes(source)))return;
      if(v.kind!=='community'&&!start)return;
      if(start&&end<start)return;
      if(day&&((end&&end<day)||(deadline&&deadline<day)))return;
      seen[source]=true;
      out.push({id:'s'+hash(source),title:title,lane:v.lane,kind:v.kind==='community'?'community':'event',url:source,
        start:start,end:end,deadline:deadline,when:text(v.when,160),location:text(v.location,180)||'Location not listed',
        cost:text(v.cost,140)||'Cost not listed',organizer:text(v.organizer,140),why:text(v.why,400),topic:text(v.topic,100)});
    });
    return out.slice(0,12);
  }
  function hash(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
  function expired(v,day){return !!((v.end&&v.end<day)||(v.deadline&&v.deadline<day));}
  function due(items,choices,day){var until=new Date(Date.parse(day+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);return items.filter(function(v){var c=choices[v.id]||{};return (c.saved||c.interested)&&!c.hidden&&!expired(v,day)&&v.deadline&&v.deadline>=day&&v.deadline<=until;}).sort(function(a,b){return a.deadline.localeCompare(b.deadline);}).slice(0,3);}
  var api={lanes:lanes,url:url,date:date,today:today,prefs:prefs,clean:clean,expired:expired,due:due};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ScoutCore=api;
})(typeof window!=='undefined'?window:globalThis);
