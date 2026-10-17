(function(root) {
  'use strict';
  // His life data as search records, for Ask Daybook (and any Search that
  // wants them): his calendar (own events, account meetings, all-day entries
  // such as leave and holidays), his weekly commitments, the tournaments he
  // starred in PokerHQ, the Flights scout and his own Trips (booked trips,
  // flight and hotel prices for his trips, fare watches). Each part also gets an overview
  // computed here across all its records, so a planning question is answered
  // from figures the app worked out rather than ones a model pieced together.
  // Pure: the caller reads the documents and passes the cores in.
  //
  // PokerHQ's bankroll is used only to apply PokerHQ's own grade; no amount
  // is ever written into a record.
  var arr=function(v){return Array.isArray(v)?v:[];};
  var text=function(v,n){return String(v==null?'':v).replace(/\s+/g,' ').trim().slice(0,n || 400);};
  var OVERVIEW_IDS=['calendar:overview','commitments:overview','poker:overview','flights:overview','trips:overview','pse:overview'];
  var SOURCES=['Calendar','Commitments','Poker','Flights','Trips','PSE'];
  var POKERHQ_URL='https://bobbynacario-design.github.io/pokerhq/';
  var ORIGIN_CITY={MNL:'Manila',CEB:'Cebu',CRK:'Clark'};
  var MONTH_NAMES='Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  var MONTH_WORDS='January February March April May June July August September October November December'.split(' ');

  function peso(n){return 'PHP '+Math.round(n).toLocaleString('en-PH');}
  // His own words end as a sentence, whatever punctuation he left off.
  function sentence(v){v=text(v);return v && !/[.!?…)]$/.test(v)?v+'.':v;}
  function slug(v){return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);}
  function monthOf(day){return MONTH_NAMES[Number(day.slice(5,7))-1]+' '+day.slice(0,4);}
  // The months a record falls in, written out ("December 2026"), so a lookup
  // for "December" finds it: lookups match words from their start, and the
  // day labels only say "Dec".
  function months(start,end) {
    var out=[],y=Number(start.slice(0,4)),m=Number(start.slice(5,7)),last=(end || start).slice(0,7);
    for(var i=0;i<14;i++){var key=y+'-'+String(m).padStart(2,'0');if(key>last)break;out.push(MONTH_WORDS[m-1]+' '+y);m++;if(m>12){m=1;y++;}}
    return out.join(', ');
  }
    // "Mon 21 Dec", or "Mon 21 Dec – Thu 24 Dec" for a span.
  function labeller(F,now) {
    var one=function(d){return (F && F.dayLabel && F.dayLabel(d,now)) || d;};
    return {day:one,span:function(s,e){return one(s)+(e && e!==s?' – '+one(e):'');}};
  }
  function guarded(fn) {
    try { return fn() || []; } catch (_) { return []; }
  }

  // ---- Calendar -----------------------------------------------------------
  function kindLabel(e) {
    if(e.kind==='allday')return /\bleave\b/i.test(e.title)?'Leave':'All-day entry';
    return {meeting:'Meeting',task:'Task',travel:'Travel',personal:'Personal',poker:'Poker plan',review:'Review',sale:'Sale'}[e.kind] || 'Entry';
  }
  function calendarRecords(input,K,F,today,now) {
    var cal=input.calendar;
    if(!cal || !K)return [];
    var L=labeller(F,now),from=K.offset(today,-14),to=K.offset(today,365);
    var events=K.build({manual:cal.manual,meetings:cal.meetings}).filter(function(e){return e.end>=from && e.start<=to;});
    var out=events.map(function(e) {
      var parts=[L.span(e.start,e.end)+(e.time?' at '+e.time+' Manila time':''),kindLabel(e),e.source];
      if(e.location)parts.push(e.location);
      if(e.done)parts.push('marked done');
      return {id:'calendar:'+e.id,source:'Calendar',title:e.title,detail:parts.filter(Boolean).join(' · '),body:text(e.detail,600),
        meta:'Calendar · '+kindLabel(e)+' · '+e.source+' · '+months(e.start,e.end),page:'calendar',
        // The day the calendar opens on. An entry under way counts as today's,
        // so a lookup from today finds it.
        ref:e.start<today && e.end>=today?today:e.start,saved:e.start<today && e.end>=today?today:e.start,rank:0,entities:[]};
    });
    var windows=K.offWindows({manual:cal.manual,meetings:cal.meetings},today);
    var ahead=events.filter(function(e){return e.end>=today;});
    var soon=ahead.filter(function(e){return e.start<=K.offset(today,56);});
    var leave=ahead.filter(function(e){return e.kind==='allday' && /\bleave\b/i.test(e.title);});
    var leaveDays=0;leave.forEach(function(e){for(var d=e.start<today?today:e.start,n=0;d<=e.end && n<62;d=K.offset(d,1),n++)if(!K.weekend(d))leaveDays++;});
    var counts={own:0,meeting:0,account:0,allday:0};
    events.forEach(function(e){if(e.origin==='manual')counts.own++;else if(/^meeting-/.test(e.id)){counts.meeting++;if(e.source==='Connected calendar')counts.account++;}else if(/^day-/.test(e.id))counts.allday++;});
    // A repeating meeting is named once, on its next date, with how often it
    // comes up, so a twice-weekly catch-up does not fill the list.
    var listedSoon=[],series={};
    soon.forEach(function(e) {
      var key=e.recurring?e.title.toLowerCase():'';
      if(key && series[key]){series[key].n++;return;}
      var row={e:e,n:1};listedSoon.push(row);if(key)series[key]=row;
    });
    var lines=[];
    if(windows.length) {
      lines.push('Time off ahead (leave joined with the weekends and all-day entries next to it; a public holiday counts only when your linked calendars list it): '+windows.map(function(w) {
        var clashes=events.filter(function(e){return K.clashes(e) && e.start<=w.end && e.end>=w.start;});
        return L.span(w.start,w.end)+' ('+months(w.start,w.end)+'): '+w.days+' days off for '+w.leave+' leave '+(w.leave===1?'day':'days')+(w.holidays.length?', includes '+w.holidays.join(', '):'')+
          ', back at work '+L.day(w.back)+(clashes.length?'; overlaps '+clashes.map(function(e){return e.title+' ('+L.span(e.start,e.end)+')';}).join(', '):'');
      }).join('. ')+'.');
    } else lines.push('Time off ahead: no upcoming leave on your calendar.');
    if(leave.length)lines.push('Leave booked from today: '+leaveDays+' weekday'+(leaveDays===1?'':'s')+' ('+leave.map(function(e){return L.span(e.start,e.end);}).join(', ')+').');
    lines.push(listedSoon.length?'Next 8 weeks: '+listedSoon.slice(0,16).map(function(r){var e=r.e;return L.span(e.start,e.end)+' '+e.title+' ('+kindLabel(e)+(r.n>1?'; next of '+r.n+' in these 8 weeks':'')+')';}).join('; ')+(listedSoon.length>16?'; and '+(listedSoon.length-16)+' more':'')+'.'
      :'Next 8 weeks: nothing on your calendar.');
    var later=ahead.filter(function(e){return e.start>K.offset(today,56);});
    if(later.length)lines.push('After that: '+later.length+' more '+(later.length===1?'entry':'entries')+', the last on '+L.day(later[later.length-1].start)+'.');
    // Before the 12 Oct read change the linked calendars gave only the account
    // meetings of the next 36 hours; a record without events is still that.
    lines.push(cal.meetings && Array.isArray(cal.meetings.events)
      ?'What this calendar holds: your own Daybook events ('+counts.own+'), the meetings in your linked Google and Outlook calendars for the next 90 days ('+counts.meeting+', '+counts.account+' naming your accounts), and all-day entries from those calendars, such as leave and holidays from Zoho People ('+counts.allday+'). Linked calendars are read 90 days ahead, so a later day with nothing listed is not necessarily free.'
      :'What this calendar holds: your own Daybook events ('+counts.own+'), meetings matched to your accounts from your linked calendars ('+counts.meeting+'), and all-day entries from those calendars, such as leave and holidays from Zoho People ('+counts.allday+'). It does not hold every appointment, so a day with nothing listed is not necessarily free.');
    // checkedAt is UTC; the 06:00 read is still the day before there.
    var checked=cal.meetings && cal.meetings.checkedAt && K.pht(cal.meetings.checkedAt);
    if(checked)lines.push('Linked calendars last checked '+L.day(checked.day)+' at '+checked.time+' Manila time.');
    var next=windows[0];
    out.push({id:'calendar:overview',source:'Calendar',title:'Calendar overview: your time off, leave, holidays and what is coming up',
      detail:'As of '+L.day(today)+': '+ahead.length+' upcoming '+(ahead.length===1?'entry':'entries')+(next?'; next time off '+L.span(next.start,next.end)+' ('+next.days+' days for '+next.leave+' leave '+(next.leave===1?'day':'days')+')':'; no upcoming leave')+'.',
      body:lines.join(' '),meta:'Computed from your calendar · as of '+today,page:'calendar',ref:next?next.start:today,saved:'',rank:1000,entities:[]});
    return out;
  }

  // ---- Commitments --------------------------------------------------------
  function commitmentsRecords(input,W,F,today,now,K) {
    if(!W || !input.review)return [];
    var L=labeller(F,now),weeks=W.cleanWeeks(input.review.weeks),start=W.weekStart(today);
    var keys=Object.keys(weeks).filter(function(k){return weeks[k].commitments.length && k<=start;}).sort().reverse();
    var line=function(c,w,current) {
      var p=W.progress(c,current?today:w.end);
      return W.areaLabel(c.area)+': '+c.text+(c.measure?' (measure: '+c.measure+')':'')+' — ticked on '+p.ticked+' of '+(current?p.elapsed+' days so far'+(p.today?', including today':', not yet today'):'7 days')+
        (c.result?', you marked it '+c.result:current?'':', not marked');
    };
    var out=keys.slice(0,8).map(function(k) {
      var w=weeks[k],current=k===start;
      return {id:'commitments:'+k,source:'Commitments',title:'Your commitments, week of '+L.day(k)+(current?' (this week)':''),
        detail:w.commitments.map(function(c){return line(c,w,current);}).join('; '),
        body:[w.reflection?'Your reflection: '+sentence(w.reflection):'',w.reviewedAt?'Reviewed '+text(w.reviewedAt,10)+'.':current?'':'Not reviewed.'].filter(Boolean).join(' '),
        meta:'Weekly review · '+w.commitments.length+' commitment'+(w.commitments.length===1?'':'s'),page:'today',ref:k,
        saved:current?today:w.end,rank:0,entities:[]};
    });
    var lines=['Your focus order (as you set it): money, then work, then health, then poker.'];
    var thisWeek=weeks[start],lastWeek=weeks[W.offset(start,-7)],nextWeek=weeks[W.offset(start,7)];
    lines.push(thisWeek && thisWeek.commitments.length?'This week ('+L.span(start,W.offset(start,6))+'): '+W.byFocus(thisWeek.commitments).map(function(c){return line(c,thisWeek,true);}).join('; ')+'.'
      :'This week: no commitments set.');
    if(lastWeek && lastWeek.commitments.length)lines.push('Last week: '+W.byFocus(lastWeek.commitments).map(function(c){return line(c,lastWeek,false);}).join('; ')+'.'+(lastWeek.reflection?' Your reflection: '+sentence(lastWeek.reflection):''));
    if(nextWeek && nextWeek.commitments.length)lines.push('Already set for next week: '+W.byFocus(nextWeek.commitments).map(function(c){return W.areaLabel(c.area)+': '+c.text;}).join('; ')+'.');
    var all=keys.map(function(k){return weeks[k];}),results={done:0,partly:0,missed:0};
    all.forEach(function(w){w.commitments.forEach(function(c){if(results[c.result]!==undefined)results[c.result]++;});});
    if(all.length)lines.push('Weeks with commitments: '+all.length+' since '+L.day(keys[keys.length-1])+', '+all.filter(function(w){return w.reviewedAt;}).length+' reviewed; results you marked: '+results.done+' done, '+results.partly+' partly, '+results.missed+' missed.');
    var plan=W.plan(weeks,today);
    if(plan.review)lines.push('Due now: the review of the week of '+L.day(plan.review)+'.');
    if(plan.set)lines.push('Due now: setting the commitments for the week of '+L.day(plan.set)+'.');
    if(!all.length)lines.push('You have not set any weekly commitments yet. The weekly review on Today sets up to three a week, in your focus order.');
    var ideaWeek=plan.set || start,ideas=ideasFor(input,W,K,L,weeks,ideaWeek);
    if(ideas.length)lines.push('Ideas for the week of '+L.day(ideaWeek)+' from your records, in your focus order (the weekly review offers the same): '+
      ideas.map(function(s){return W.areaLabel(s.area)+': '+s.text+' ('+s.why+')';}).join('; ')+'.');
    out.push({id:'commitments:overview',source:'Commitments',title:'Commitments overview: this week\'s commitments, progress and your focus order',
      detail:thisWeek && thisWeek.commitments.length?'This week: '+thisWeek.commitments.length+' commitment'+(thisWeek.commitments.length===1?'':'s')+', '+thisWeek.commitments.filter(function(c){return c.ticks.length;}).length+' ticked at least once so far.'
        :'No commitments set for this week.',
      body:lines.join(' '),meta:'Computed from your weekly review · as of '+today,page:'today',ref:'',saved:'',rank:1000,entities:[]});
    return out;
  }

  // The weekly review's ideas (WeeklyReviewCore.suggestions) from the same
  // records the review reads: decisions, working questions, calendar tasks and
  // leave, ★ picks, goals and the last weekly read's suggestion.
  function ideasFor(input,W,K,L,weeks,week) {
    if(typeof W.suggestions!=='function')return [];
    var extra=input.extra || {},cal=input.calendar || {};
    var events=K?K.build({manual:cal.manual,meetings:cal.meetings}):[];
    var windows=K && cal.meetings?K.offWindows({manual:cal.manual,meetings:cal.meetings},week).map(function(w){return Object.assign({},w,{label:L.span(w.start,w.end)});}):[];
    var starred=K && input.poker?arr(input.poker.tourneys).filter(function(t){return t && t.planning===true;}).map(function(t) {
      var d=K.pokerDate(t.date);
      return d?{day:d,name:text(t.name,100) || 'Tournament',venue:text(t.venue,160).split(',')[0].trim().slice(0,60),label:L.day(d)}:null;
    }).filter(Boolean):[];
    return W.suggestions({weeks:weeks,decisions:arr(extra.decisions),evidenceSets:arr(extra.evidenceSets),events:events,windows:windows,pokerStarred:starred,
      goals:arr(extra.goals),tryNext:text(extra.tryNext,200)},week);
  }

  // ---- PokerHQ ------------------------------------------------------------
  function pokerRecords(input,K,F,today,now) {
    var poker=input.poker;
    if(!poker || !K || !Array.isArray(poker.tourneys))return [];
    var L=labeller(F,now),bankroll=poker.bankroll && Number(poker.bankroll.amount)>0?poker.bankroll:null;
    var seen={},picks=[];
    poker.tourneys.forEach(function(t) {
      if(!t || t.planning!==true)return;
      var day=K.pokerDate(t.date);
      if(!day || day<today)return;
      var key=day+'|'+slug(t.name);
      if(seen[key])return;seen[key]=true;
      picks.push({day:day,name:text(t.name,140),venue:text(t.venue,160).split(',')[0].trim(),buyin:Number(t.buyin)>0?Math.round(Number(t.buyin)):0,
        structure:text(t.structure,60),type:text(t.category || t.type,40),gtd:text(t.gtd,40),notes:text(t.notes,200),
        grade:bankroll?K.pokerGrade(t.buyin,bankroll):'',url:/^https:\/\/[^\s"<>]+$/.test(t.url || '')?t.url:'',key:key});
    });
    picks.sort(function(a,b){return a.day.localeCompare(b.day) || a.name.localeCompare(b.name);});
    var out=picks.slice(0,60).map(function(p) {
      return {id:'poker:'+p.key.replace('|',':'),source:'Poker',title:p.name,
        detail:[L.day(p.day),p.venue,p.buyin?'buy-in '+peso(p.buyin):'',p.structure,p.type,p.gtd?'guarantee '+p.gtd:'','★ starred in PokerHQ (Playing These)',
          p.grade?'PokerHQ grade for your bankroll now: '+p.grade:''].filter(Boolean).join(' · '),
        body:p.notes,meta:'PokerHQ ★ pick · '+months(p.day),page:'pokerhq',ref:POKERHQ_URL,saved:p.day,rank:0,entities:[]};
    });
    var upcoming=poker.tourneys.filter(function(t){var d=t && K.pokerDate(t.date);return d && d>=today;});
    var month={},lines=[];
    picks.forEach(function(p){var m=monthOf(p.day);month[m]=month[m] || {n:0,spend:0,first:p.day,last:p.day};month[m].n++;month[m].spend+=p.buyin;month[m].last=p.day;});
    var total=picks.reduce(function(n,p){return n+p.buyin;},0);
    if(picks.length) {
      lines.push('Your ★ picks in PokerHQ (Playing These: your decision to play), upcoming: '+picks.length+' events from '+L.day(picks[0].day)+' to '+L.day(picks[picks.length-1].day)+', '+peso(total)+' in buy-ins in all; by month: '+
        Object.keys(month).map(function(m){return m+': '+month[m].n+(month[m].n===1?' event on '+L.day(month[m].first):' events, '+L.span(month[m].first,month[m].last))+', '+peso(month[m].spend);}).join('; ')+'.');
      lines.push('Next: '+picks.slice(0,6).map(function(p){return L.day(p.day)+' '+p.name+' at '+p.venue+(p.buyin?' ('+peso(p.buyin)+')':'');}).join('; ')+(picks.length>6?'; and '+(picks.length-6)+' more':'')+'.');
      if(bankroll) {
        var by={target:[],stretch:[],skip:[]};picks.forEach(function(p){by[p.grade].push(p);});
        lines.push('PokerHQ grades your picks for your bankroll now: '+by.target.length+' target, '+by.stretch.length+' stretch, '+by.skip.length+' skip'+
          (by.stretch.length?'; stretch: '+by.stretch.slice(0,4).map(function(p){return p.name+' ('+L.day(p.day)+')';}).join(', '):'')+
          (by.skip.length?'; skip: '+by.skip.slice(0,4).map(function(p){return p.name+' ('+L.day(p.day)+')';}).join(', '):'')+'.');
      } else lines.push('PokerHQ\'s bankroll could not be read, so there is no live grade for your picks.');
    } else lines.push('No upcoming tournaments are starred (★ Playing These) in PokerHQ.');
    lines.push('A grade (target, stretch, skip) is PokerHQ\'s check of a buy-in against your bankroll rule: whether you can afford it, not whether you will play. A ★ is your decision to play.');
    var festivals=K.pokerFestivals(poker.tourneys,today,bankroll);
    if(festivals.length)lines.push('Series abroad in PokerHQ: '+festivals.slice(0,6).map(function(f) {
      return f.label+' in '+f.city+', '+L.span(f.start,f.end)+', '+f.events+(f.events===1?' event':' events')+(f.buyinMin?', buy-ins '+peso(f.buyinMin)+(f.buyinMax>f.buyinMin?' to '+peso(f.buyinMax):''):'')+
        (f.main && f.main.buyin?', main event '+peso(f.main.buyin)+' on '+L.day(f.main.day):'')+'; your ★ picks: '+(f.picks.length?f.picks.map(function(p){return p.name;}).slice(0,3).join(', '):'none')+
        '; within your bankroll ('+(f.gradeSource==='bankroll'?'PokerHQ grade now':'grade saved at import')+'): '+f.affordable.length;
    }).join('. ')+'.');
    lines.push('PokerHQ lists '+upcoming.length+' upcoming tournaments in all, '+upcoming.filter(function(t){return K.pokerDate(t.date)<=K.offset(today,30);}).length+' in the next 30 days.');
    var sessions=arr(poker.sessions).filter(function(s){return s && K.pokerDate(s.date);}).sort(function(a,b){return K.pokerDate(b.date).localeCompare(K.pokerDate(a.date));});
    lines.push(sessions.length?'Sessions logged in PokerHQ: '+sessions.length+'; the latest on '+L.day(K.pokerDate(sessions[0].date))+(text(sessions[0].name)?' ('+text(sessions[0].name,80)+(text(sessions[0].venue)?', '+text(sessions[0].venue,80).split(',')[0]:'')+')':'')+'.'
      :'No sessions logged in PokerHQ.');
    out.push({id:'poker:overview',source:'Poker',title:'Poker overview: your ★ PokerHQ picks, buy-ins and series abroad',
      detail:picks.length?picks.length+' upcoming ★ picks, '+peso(total)+' in buy-ins; next '+picks[0].name+' on '+L.day(picks[0].day)+'.':'No upcoming ★ picks in PokerHQ.',
      body:lines.join(' '),meta:'Computed from PokerHQ · as of '+today,page:'pokerhq',ref:POKERHQ_URL,saved:'',rank:1000,entities:[]});
    return out;
  }

  // ---- Flights ------------------------------------------------------------
  function flightsRecords(input,K,F,today,now) {
    var flights=input.flights;
    if(!flights || !F)return [];
    var L=labeller(F,now),latest=flights.latest,saved=flights.saved || {},fx=flights.fx || null;
    var php=function(d){var p=d.currency==='PHP'?{amount:d.amount}:F.phpEstimate(d,fx,now);return p && !p.stale?Math.round(p.amount):null;};
    var price=function(d){return d.php!=null?'≈ '+peso(d.php):d.currency+' '+Number(d.amount).toLocaleString('en-PH');};
    var fare=function(d){return (d.destinationName || d.destination)+' from '+(ORIGIN_CITY[d.origin] || d.origin)+' '+price(d)+' ('+F.tripLabel(d,now)+', '+d.airline+')';};
    var out=Object.keys(saved).map(function(id) {
      var d=saved[id];
      if(!d || typeof d!=='object')return null;
      if(d.campaign)return {id:'flights:'+id,source:'Flights',title:'Saved sale: '+text(d.airline || d.title,120),
        detail:[text(d.title,160),d.bookingEnd?'book by '+L.day(d.bookingEnd):'',d.travelStart?'travel '+L.span(d.travelStart,d.travelEnd):'','base fares only; route seats not verified'].filter(Boolean).join(' · '),
        body:text(d.terms,400),meta:'Saved on Flights · sale',page:'flights',ref:id,saved:d.bookingEnd || '',rank:0,entities:[]};
      if(d.kind!=='advertised-fare' || !K || !K.date(d.departureDate))return null;
      var row=Object.assign({},d,{php:php(d)});
      return {id:'flights:'+id,source:'Flights',title:'Saved flight: '+(d.originName || d.origin)+' → '+(d.destinationName || d.destination),
        detail:[F.tripLabel(d,now),d.airline,price(row),d.tripType,d.cabin,d.departureDate<today?'dates have passed':'','an advertised sample you saved, not a booking'].filter(Boolean).join(' · '),
        body:[text(d.baggage,200),text(d.fees,200)].filter(Boolean).join(' '),meta:'Saved on Flights · '+months(d.departureDate,d.returnDate),page:'flights',ref:id,saved:d.departureDate,rank:0,entities:[]};
    }).filter(Boolean);
    if(!latest || !Array.isArray(latest.offers))return out;
    var live=function(market){return F.select({offers:latest.offers},{market:market,cabin:'economy',tripType:'All'},now).filter(function(d){return d.kind==='advertised-fare' && !d.expired;}).map(function(d){return Object.assign({},d,{php:php(d)});});};
    var byPrice=function(a,b){return (a.php==null)-(b.php==null) || (a.php!=null?a.php-b.php:a.amount-b.amount) || a.departureDate.localeCompare(b.departureDate);};
    // The cheapest fare to each city, cheapest city first.
    var cheapestEach=function(rows){var best={};rows.forEach(function(d){var n=d.destinationName || d.destination;if(!best[n] || byPrice(d,best[n])<0)best[n]=d;});return Object.keys(best).map(function(n){return best[n];}).sort(byPrice);};
    var intl=live('international'),domestic=live('domestic');
    var asOf=text(latest.asOf,10),stale=intl.length && intl.every(function(d){return d.stale;});
    var lines=['These are airlines\' advertised economy sample fares on the airlines\' own dates, from Manila, Cebu and Clark, checked by the scout on '+(asOf || 'its last run')+(stale?' (more than a day ago)':'')+'; seats and the final total need confirming on the airline. Exact dates, budget airlines included, are searched through the Google Flights links on Flights; Daybook does not price those itself.'];
    var windows=K && input.calendar?K.offWindows({manual:input.calendar.manual,meetings:input.calendar.meetings},today):[];
    windows.slice(0,3).forEach(function(w) {
      var fits=cheapestEach(intl.filter(function(d){return d.departureDate>=w.start && d.returnDate && d.returnDate<=w.end;}));
      lines.push('Your time off '+L.span(w.start,w.end)+' ('+months(w.start,w.end)+'; '+w.days+' days, '+w.leave+' leave '+(w.leave===1?'day':'days')+'): '+(fits.length?'scouted fares inside these dates: '+fits.slice(0,5).map(fare).join('; ')+(fits.length>5?'; and '+(fits.length-5)+' more cities':'')+'.':'no scouted fare fits these dates.'));
    });
    var top=cheapestEach(intl).slice(0,6);
    if(top.length)lines.push('Cheapest cities abroad on any dates: '+top.map(fare).join('; ')+'.');
    var isles=cheapestEach(domestic);
    if(isles.length)lines.push('Island trips at home: '+isles.map(fare).join('; ')+'.');
    var memory=flights.history?F.memoryIndex(flights.history):null;
    var lows=memory?intl.concat(domestic).filter(function(d){var m=F.priceMemory(d,memory,asOf);return m && m.newLow;}):[];
    lows=cheapestEach(lows);
    if(lows.length)lines.push('Below every earlier day the scout recorded for the same route: '+lows.slice(0,4).map(fare).join('; ')+'.');
    var sales=F.select({offers:latest.offers},{market:'international',tripType:'campaigns'},now).filter(function(d){return d.campaign && !d.expired;});
    if(sales.length)lines.push('Seat sales on: '+sales.slice(0,4).map(function(d){return text(d.airline || d.title,80)+', book by '+L.day(d.bookingEnd)+', travel '+L.span(d.travelStart,d.travelEnd);}).join('; ')+' (base fares only).');
    var poker=input.poker,bankroll=poker && poker.bankroll && Number(poker.bankroll.amount)>0?poker.bankroll:null;
    var festivals=K && poker && Array.isArray(poker.tourneys)?K.pokerFestivals(poker.tourneys,today,bankroll).filter(function(f){return f.picks.length || f.affordable.length;}):[];
    festivals.slice(0,4).forEach(function(f) {
      var starred=f.picks.length>0,targets=f.affordable.filter(function(r){return r.grade==='target';}),basis=starred?f.picks:targets.length?targets:f.affordable;
      var first=basis[0].day,last=basis[basis.length-1].day,start=K.offset(first,-1),end=K.offset(last,1);
      var inside=windows.some(function(w){return w.start<=first && w.end>=last;}),need=K.leaveNeeded(first,last,windows);
      var toCity=intl.filter(function(d){return f.airports.indexOf(d.destination)>=0;}).sort(byPrice);
      var near=toCity.filter(function(d){return d.departureDate>=K.offset(start,-2) && d.departureDate<=last;});
      lines.push('Poker trip, '+f.label+' in '+f.city+' ('+(starred?'for your ★ picks':'for the events PokerHQ grades within your bankroll; nothing starred')+'): '+L.span(start,end)+', '+
        (inside?'inside your time off':need+' leave '+(need===1?'day':'days')+' needed')+'; '+
        (near.length?'flight '+fare(near[0]):toCity.length?'no scouted fare near these dates; '+f.city+' '+price(toCity[0])+' on '+F.tripLabel(toCity[0],now):'no scouted fare to '+f.city)+'.');
    });
    lines.push(Object.keys(saved).length?'Your saved shortlist: '+Object.keys(saved).length+' on Flights.':'Your saved shortlist on Flights is empty.');
    var next=windows[0],fits=next?cheapestEach(intl.filter(function(d){return d.departureDate>=next.start && d.returnDate && d.returnDate<=next.end;})):[];
    out.push({id:'flights:overview',source:'Flights',title:'Flights overview: fares for your time off, cheapest destinations and poker trips',
      detail:'Scout of '+(asOf || 'its last run')+': '+intl.length+' economy fares abroad and '+domestic.length+' island fares at home'+(next?'; for your time off '+L.span(next.start,next.end)+', '+(fits.length?'from '+fare(fits[0]):'no scouted fare fits'):'')+'.',
      body:lines.join(' '),meta:'Computed from the Flights scout · as of '+(asOf || today),page:'flights',ref:'',saved:'',rank:1000,entities:[]});
    return out;
  }

  // ---- Trips --------------------------------------------------------------
  // His own trips on the Trips tab: trips he booked (with what is left to do
  // before going), the trips Trips prices for him (time off and poker trips:
  // the exact-date Google Flights price and the cheapest hotel room), and his
  // fare watches against the scout's fares. The overview lines them up, with
  // the trip totals worked out the way Trips works them out (tripTotal).
  var TRIP_KIND={leave:'Time off','leave-fare':'Time off, fare dates',poker:'Poker trip'};
  function tripsRecords(input,K,F,today,now) {
    var trips=input.trips;
    if(!trips || !F || !K)return [];
    var L=labeller(F,now),fx=trips.fx || null,out=[],lines=[];
    var nightsOf=function(a,b){return Math.round((Date.parse(b)-Date.parse(a))/86400000);};
    var range=function(lo,hi){return 'PHP '+Math.round(lo).toLocaleString('en-PH')+'–'+Math.round(hi).toLocaleString('en-PH');};
    var checkedDay=function(at){var t=Date.parse(at || '');return Number.isFinite(t)?L.day(K.pht(t).day):'';};
    // The exact-date Google Flights prices (one adult, economy, return).
    var exact=Object.keys((trips.exact && trips.exact.items) || {}).map(function(k){return trips.exact.items[k];})
      .filter(function(e){return e && e.result && e.result.price>0 && K.date(e.depart) && K.date(e.ret);});
    var exactFor=function(airports,depart,ret){return exact.filter(function(e){return airports.indexOf(e.destination)>=0 && e.depart===depart && e.ret===ret;})
      .sort(function(a,b){return a.result.price-b.result.price;})[0] || null;};
    var flightText=function(e){var r=e.result;return peso(r.price)+' per traveller on Google Flights ('+[r.airline,r.stops===0?'nonstop':r.stops>0?r.stops+(r.stops===1?' stop':' stops'):''].filter(Boolean).join(', ')+
      ' from '+(ORIGIN_CITY[e.origin] || e.origin)+(r.level?'; Google rates this price '+text(r.level,20)+(r.typical && r.typical.low>0 && r.typical.high>0?', the usual range being '+range(r.typical.low,r.typical.high):''):'')+(checkedDay(e.checkedAt)?'; checked '+checkedDay(e.checkedAt):'')+')';};
    // The cheapest current hotel room for one of his priced trips.
    var stays=trips.hotelStays && Array.isArray(trips.hotelStays.trips)?trips.hotelStays.trips:[];
    var hotelFor=function(id){
      var s=stays.filter(function(x){return x && x.id===id && Array.isArray(x.hotels);})[0];if(!s)return null;
      var q=F.stayQuotes({city:s.city,hotels:s.hotels,stays:[s]},s.checkIn,s.checkOut,{currency:trips.hotelStays.currency || 'USD',adults:trips.hotelStays.adults || 2},fx,now);
      return q && q.cheapest && q.cheapest.php>0?{name:text(q.cheapest.hotel.name,80),php:q.cheapest.php,site:q.cheapest.best && q.cheapest.best.site,adults:trips.hotelStays.adults || 2}:null;
    };
    // Trips he booked.
    var booked=Object.keys(trips.booked || {}).map(function(id){var t=F.cleanBooked(trips.booked[id]);return t?{id:id,t:t}:null;}).filter(Boolean)
      .sort(function(a,b){return a.t.depart.localeCompare(b.t.depart);});
    booked.forEach(function(b) {
      var t=b.t,end=t.ret || t.depart,st=F.bookedStatus(t,today),list=F.bookedChecklist(t,today),done=list.filter(function(i){return i.done;}).length;
      var when=st.phase==='upcoming'?'in '+st.days+(st.days===1?' day':' days'):st.phase==='away'?'away now, day '+st.day+' of '+st.of:'trip over';
      var todo=list.map(function(i){return i.text+' ('+(i.done?'done':i.state==='late'?'overdue since '+L.day(i.by):i.by?'by '+L.day(i.by):'any time')+')';});
      out.push({id:'trips:booked:'+slug(b.id),source:'Trips',title:'Booked trip: '+t.city+', '+L.span(t.depart,end),
        detail:[when,'from '+(ORIGIN_CITY[t.origin] || t.origin),text([t.airline,t.flight].filter(Boolean).join(' '),120),t.hotel?'staying at '+t.hotel:'no hotel entered',
          t.travellers+(t.travellers===1?' traveller':' travellers'),done+' of '+list.length+' things done before going'].filter(Boolean).join(' · '),
        body:'Before you go: '+todo.join('; ')+'.',meta:'Trips · booked · '+months(t.depart,end),page:'flights',ref:b.id,saved:t.depart,rank:0,entities:[]});
      if(st.phase!=='done')lines.push('Booked: '+t.city+' '+L.span(t.depart,end)+', '+when+'; '+done+' of '+list.length+' things done before going'+
        (list.some(function(i){return !i.done && i.state==='late';})?', with '+list.filter(function(i){return !i.done && i.state==='late';}).map(function(i){return i.text.split(/[(:.]/)[0].trim();}).join(', ')+' overdue':'')+'.');
    });
    if(!booked.length)lines.push('No booked trips are saved on Trips.');
    // The trips Trips prices for him: his time off and his poker trips.
    var planned=(trips.hotelTrips && Array.isArray(trips.hotelTrips.trips)?trips.hotelTrips.trips:[])
      .filter(function(t){return t && typeof t.id==='string' && K.date(t.checkIn) && K.date(t.checkOut) && t.checkOut>=today && Array.isArray(t.airports);})
      .sort(function(a,b){return a.checkIn.localeCompare(b.checkIn) || String(a.city).localeCompare(String(b.city));});
    planned.forEach(function(t) {
      var e=exactFor(t.airports,t.checkIn,t.checkOut),h=hotelFor(t.id),nights=nightsOf(t.checkIn,t.checkOut),kind=TRIP_KIND[t.kind] || 'Trip';
      var total=e && h?F.tripTotal(e.result.price,h.php,nights):null;
      var parts=[nights+(nights===1?' night':' nights'),e?'flight '+flightText(e):'no exact flight price checked yet',
        h?'cheapest room '+peso(h.php)+' a night at '+h.name+' (one room, '+h.adults+' adults'+(h.site?', '+h.site:'')+')':'no current hotel price',
        total?'together about '+peso(total.one)+' for one traveller, '+peso(total.two)+' for two sharing the room':''];
      out.push({id:'trips:plan:'+slug(t.id),source:'Trips',title:kind+': '+text(t.city,60)+', '+L.span(t.checkIn,t.checkOut)+(t.label?' ('+text(t.label,80)+')':''),
        detail:parts.filter(Boolean).join(' · '),body:t.venue?'Venue: '+text(t.venue,80)+'.':'',meta:'Trips · '+kind.toLowerCase()+' · '+months(t.checkIn,t.checkOut),
        page:'flights',ref:t.id,saved:t.checkIn,rank:0,entities:[]});
      lines.push(kind+' '+text(t.city,60)+' '+L.span(t.checkIn,t.checkOut)+(t.label?' ('+text(t.label,80)+')':'')+': '+parts.filter(Boolean).join('; ')+'.');
    });
    // His fare watches: the best scouted fare that fits, and Google's price on the dates the app chose.
    var watches=Object.keys(trips.watches || {}).map(function(id) {
      var r=trips.latest?F.fareWatch(trips.watches[id],trips.latest,fx,now):null,w=r?r.watch:F.cleanWatch(trips.watches[id]);
      return w?{id:id,w:w,r:r,e:exact.filter(function(x){return x.reason==='watch' && x.ref===id;}).sort(function(a,b){return a.result.price-b.result.price;})[0] || null}:null;
    }).filter(Boolean).sort(function(a,b){return a.w.city.localeCompare(b.w.city);});
    watches.forEach(function(x) {
      var w=x.w,best=x.r && x.r.best,vs=function(php){return php<=w.target?'at or under your target':peso(php-w.target)+' over your target';};
      var parts=['target '+peso(w.target)+' per traveller','leaving '+L.span(w.from,w.to)+', '+w.minNights+'–'+w.maxNights+' nights'+(w.origin!=='All'?', from '+(ORIGIN_CITY[w.origin] || w.origin):''),
        best?'best scouted fare ≈ '+peso(best.php)+' ('+[F.tripLabel(best.fare,now),text(best.fare.airline,60)].filter(Boolean).join(', ')+'), '+vs(best.php):'no scouted fare fits yet',
        x.e?'for '+L.span(x.e.depart,x.e.ret)+': '+flightText(x.e)+', '+vs(x.e.result.price):''];
      out.push({id:'trips:watch:'+slug(x.id),source:'Trips',title:'Fare watch: '+text(w.city,60)+' at '+peso(w.target)+' or less',detail:parts.filter(Boolean).join(' · '),body:'',
        meta:'Trips · fare watch · '+months(w.from,w.to),page:'flights',ref:x.id,saved:w.from,rank:0,entities:[]});
      lines.push('Fare watch '+text(w.city,60)+': '+parts.filter(Boolean).join('; ')+'.');
    });
    if(!watches.length)lines.push('No fare watches are set.');
    out.push({id:'trips:overview',source:'Trips',title:'Trips overview: booked trips, flight and hotel prices for your trips, and fare watches',
      detail:booked.length+' booked; '+planned.length+' planned '+(planned.length===1?'trip':'trips')+' priced for time off and poker; '+watches.length+' fare '+(watches.length===1?'watch':'watches')+
        ' ('+watches.filter(function(x){return (x.r && x.r.hit) || (x.e && x.e.result.price<=x.w.target);}).length+' at or under target).',
      body:lines.join(' '),meta:'Computed from Trips · as of '+today,page:'flights',ref:'',saved:'',rank:1000,entities:[]});
    return out;
  }

  // ---- PSE ----------------------------------------------------------------
  // His PSE watchlist and paper picks. Closes and returns come as the PSE job
  // wrote them after the close (radar-ph's board for PSEi stocks, the
  // watchlist's own rows for the rest), never live prices; company notices
  // are PSE Edge filings for the stocks he watches; a paper pick's figures are
  // the server's price-only paper record, with its own caveat.
  function psePrice(n){return 'PHP '+Number(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function pct(n){return (n>0?'+':n<0?'−':'')+Math.abs(n).toFixed(2)+'%';}
  function pseRecords(input,K,F,today,now) {
    var pse=input.pse;
    if(!pse || !K)return [];
    var L=labeller(F,now),watch=pse.watch || {},board=(pse.board && Array.isArray(pse.board.board))?pse.board.board:[],rows=watch.rows || {};
    var num=function(v){return typeof v==='number' && Number.isFinite(v);};
    var out=[],lines=[],items=watch.items && typeof watch.items==='object'?watch.items:{};
    var symbols=Object.keys(items).filter(function(s){return /^[A-Z0-9]{1,8}$/.test(s);}).sort();
    symbols.forEach(function(sym) {
      var r=board.filter(function(b){return b && b.symbol===sym;})[0] || rows[sym] || null,target=Number(items[sym] && items[sym].target);
      if(!r || !num(r.close) || !K.date(r.asOf)) {
        out.push({id:'pse:watch:'+slug(sym),source:'PSE',title:'PSE watchlist: '+sym,detail:'no completed close on record yet',body:'',meta:'PSE · your watchlist',page:'pse',ref:sym,saved:'',rank:0,entities:[sym]});
        lines.push(sym+': no completed close on record yet.');
        return;
      }
      var name=text(r.name || sym,80),parts=['close '+psePrice(r.close)+' on '+L.day(r.asOf)+(num(r.dayChangePct)?' ('+pct(r.dayChangePct)+' on the day)':'')];
      var rets=[['1 week',r.ret1w],['1 month',r.ret1m],['3 months',r.ret3m],['this year',r.retYtd]].filter(function(x){return num(x[1]);});
      if(rets.length)parts.push(rets.map(function(x){return x[0]+' '+pct(x[1]);}).join(', '));
      if(num(r.low52) && num(r.high52))parts.push('52-week range '+psePrice(r.low52)+'–'+psePrice(r.high52).slice(4)+(num(r.pctFromHigh)?', '+Math.abs(r.pctFromHigh).toFixed(2)+'% below the high':''));
      if(num(r.yield12m))parts.push('dividend yield over 12 months '+r.yield12m.toFixed(2)+'%');
      if(r.nextEx && K.date(r.nextEx.exDate || r.nextEx))parts.push('next ex-dividend date '+L.day(r.nextEx.exDate || r.nextEx));
      if(target>0)parts.push('your buy-below '+psePrice(target)+': '+(r.close<=target?'at or below it':psePrice(r.close-target)+' above it'));
      out.push({id:'pse:watch:'+slug(sym),source:'PSE',title:'PSE watchlist: '+name+' ('+sym+')',detail:parts.join(' · '),body:'',
        meta:'PSE · your watchlist · close of '+r.asOf,page:'pse',ref:sym,saved:r.asOf,rank:0,entities:[sym]});
      lines.push(name+' ('+sym+'): '+parts.join('; ')+'.');
    });
    if(!symbols.length)lines.push('Your PSE watchlist is empty.');
    // PSE Edge notices for the stocks he watches, and the watchlist's own alerts.
    (Array.isArray(watch.news)?watch.news:[]).filter(function(n){return n && symbols.indexOf(n.symbol)>=0;}).slice(0,10).forEach(function(n) {
      var day=/^\d{4}-\d{2}-\d{2}/.test(n.at || '')?n.at.slice(0,10):'';
      out.push({id:'pse:news:'+slug(n.edgeNo || n.symbol+'-'+n.at),source:'PSE',title:n.symbol+': '+text(n.label || n.template,120),
        detail:[text(n.company,100),day?'filed on PSE Edge '+L.day(day):'filed on PSE Edge',text(n.template,120)].filter(Boolean).join(' · '),body:'',
        meta:'PSE · company notice',page:'pse',ref:n.symbol,saved:day,rank:0,entities:[n.symbol]});
      lines.push('Notice for '+n.symbol+': '+text(n.label || n.template,120)+(day?', filed '+L.day(day):'')+'.');
    });
    (Array.isArray(watch.alerts)?watch.alerts:[]).slice(0,10).forEach(function(a){if(a && (a.text || a.line))lines.push('Watchlist alert: '+text(a.text || a.line,200)+'.');});
    // His paper picks: the thesis is his; the return is the server's paper record.
    var picks=(pse.paper && Array.isArray(pse.paper.picks))?pse.paper.picks:[];
    picks.forEach(function(p) {
      var k=p && p.pick,o=(p && p.outcome) || {};
      if(!k || !k.symbol || !K.date(k.recordedDay))return;
      var status={tracking:'open, tracking','waiting-entry':'waiting for its entry close',closed:'closed'}[o.status] || text(o.status || 'no result yet',40);
      var parts=['recorded '+L.day(k.recordedDay)+(num(k.observedClose)?' when the last close was '+psePrice(k.observedClose)+(K.date(k.observedDate)?' ('+L.day(k.observedDate)+')':''):''),status];
      if(num(o.entryPrice) && K.date(o.entryDate))parts.push('entered '+L.day(o.entryDate)+' at '+psePrice(o.entryPrice));
      if(num(o.markPrice) && K.date(o.asOf))parts.push('marked '+psePrice(o.markPrice)+' on '+L.day(o.asOf)+(num(o.sessions)?' after '+o.sessions+(o.sessions===1?' session':' sessions'):''));
      if(num(o.netPriceReturn))parts.push('net '+pct(o.netPriceReturn)+' after assumed costs'+(num(o.benchmarkPriceReturn)?', PSE30 '+pct(o.benchmarkPriceReturn):'')+(num(o.netExcessReturn)?', '+Math.abs(o.netExcessReturn).toFixed(2)+' points '+(o.netExcessReturn<0?'behind':'ahead of')+' it':''));
      if(num(o.maxCloseDrawdown) && o.maxCloseDrawdown!==0)parts.push('worst drawdown on a close '+Math.abs(o.maxCloseDrawdown).toFixed(2)+'%');
      var title='Paper pick: '+k.symbol+(k.approach?' ('+text(k.approach,30)+(num(k.horizon)?', '+k.horizon+' trading days':'')+')':'');
      out.push({id:'pse:paper:'+slug(p.id),source:'PSE',title:title,detail:parts.join(' · '),
        body:['Your thesis: '+sentence(text(k.thesis,600)),k.invalidation?'What would prove it wrong: '+sentence(text(k.invalidation,300)):'',o.caveat?'Caveat: '+sentence(text(o.caveat,300)):''].filter(Boolean).join(' '),
        meta:'PSE · paper pick · '+monthOf(k.recordedDay),page:'pse',ref:p.id,saved:k.recordedDay,rank:0,entities:[k.symbol]});
      lines.push(title+': '+parts.join('; ')+'.');
    });
    if(!picks.length)lines.push('No paper picks are recorded.');
    // The closes' own session date (the snapshot is dated the day it was written).
    var asOf=symbols.map(function(s){var r=board.filter(function(b){return b && b.symbol===s;})[0] || rows[s];return r && K.date(r.asOf)?r.asOf:'';}).filter(Boolean).sort().pop() || '';
    out.push({id:'pse:overview',source:'PSE',title:'PSE overview: your watchlist, its company notices and your paper picks',
      detail:symbols.length+' on your watchlist; '+picks.length+' paper '+(picks.length===1?'pick':'picks')+(asOf?'; closes as of '+L.day(asOf):'')+'.',
      body:['Closes are completed PSE sessions written after the close, not live prices; paper returns are price-only, before dividends.'].concat(lines).join(' '),
      meta:'Computed from the PSE job and your paper record · as of '+(asOf || today),page:'pse',ref:'',saved:'',rank:1000,entities:symbols});
    return out;
  }

  // Every record, each part on its own so one unreadable document never
  // costs the others. input.today is the Manila date and input.now the time
  // (ms) fares are judged fresh at. cores: {calendar, flights, review}; in the
  // app they default to the page's globals.
  function records(input,cores) {
    input=input || {};cores=cores || {};
    var K=cores.calendar || root.DaybookCalendarCore,F=cores.flights || root.FlightsCore,W=cores.review || root.WeeklyReviewCore;
    var now=Number.isFinite(input.now)?input.now:Date.now();
    var today=K && K.date(input.today)?input.today:K?K.pht(now).day:'';
    if(!today)return [];
    return [].concat(
      guarded(function(){return calendarRecords(input,K,F,today,now);}),
      guarded(function(){return commitmentsRecords(input,W,F,today,now,K);}),
      guarded(function(){return pokerRecords(input,K,F,today,now);}),
      guarded(function(){return flightsRecords(input,K,F,today,now);}),
      guarded(function(){return tripsRecords(input,K,F,today,now);}),
      guarded(function(){return pseRecords(input,K,F,today,now);}));
  }

  var api={records:records,OVERVIEW_IDS:OVERVIEW_IDS,SOURCES:SOURCES,POKERHQ_URL:POKERHQ_URL};
  root.LifeRecordsCore=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
