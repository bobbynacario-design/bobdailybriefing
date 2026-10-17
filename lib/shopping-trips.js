(function(root){
  'use strict';
  // Trips meet the style guide: what each coming trip needs from the wardrobe
  // he recorded, and which deals would fill a real trip gap in time. Reads his
  // Trips tab (hotel-trips-<uid>); no AI, no weather API.
  // Typical daily low and high (°C) by month, Jan..Dec: rough climate normals
  // for packing, not a forecast. Cities are the ones the Trips tab prices.
  var year=function(lo,hi){var m=[];for(var i=0;i<12;i++)m.push([lo,hi]);return m;};
  var HK=[[14,19],[15,19],[17,22],[21,25],[24,29],[26,31],[27,32],[27,32],[26,31],[24,28],[20,25],[16,21]];
  var CLIMATE={
    'Taipei':[[13,19],[14,20],[15,22],[19,26],[22,29],[24,32],[26,34],[26,33],[25,31],[22,28],[19,24],[15,21]],
    'Kaohsiung':[[15,23],[16,24],[19,26],[22,29],[25,31],[26,32],[26,33],[26,32],[26,32],[24,31],[21,28],[17,24]],
    'Hong Kong':HK,'Macau':HK,
    'Bangkok':[[22,32],[24,33],[26,34],[27,35],[27,34],[26,33],[26,33],[26,32],[25,32],[25,32],[24,31],[22,31]],
    'Singapore':year(25,31),'Kuala Lumpur':year(23,32),'Denpasar':year(24,31),'Cebu':year(24,31),
    'Ho Chi Minh City':[[22,32],[23,33],[24,34],[26,35],[26,34],[25,33],[25,32],[25,32],[25,32],[24,31],[23,31],[22,31]],
    'Hanoi':[[14,19],[15,20],[18,23],[21,27],[24,32],[26,33],[26,33],[26,32],[25,31],[22,29],[18,26],[15,22]],
    'Tokyo':[[1,10],[2,11],[5,14],[10,19],[15,23],[19,26],[23,30],[24,31],[21,27],[15,22],[9,17],[4,12]],
    'Osaka':[[3,10],[3,11],[6,14],[11,20],[16,25],[20,28],[25,32],[26,33],[22,29],[16,23],[10,17],[5,12]],
    'Seoul':[[-6,2],[-4,5],[2,11],[8,18],[13,23],[18,27],[22,29],[23,30],[18,26],[11,20],[3,12],[-3,4]],
    'Busan':[[-1,8],[1,10],[5,14],[10,19],[14,22],[18,25],[22,28],[24,30],[20,27],[15,22],[9,17],[2,11]],
    'Manila':[[23,30],[23,31],[24,32],[25,34],[26,34],[26,32],[25,31],[25,31],[25,31],[25,31],[24,31],[24,30]],
    'Sydney':[[19,26],[19,26],[18,25],[15,23],[12,20],[9,17],[8,17],[9,18],[11,20],[14,22],[16,24],[18,25]]
  };
  // Months with frequent rain or drizzle (1 = January).
  var WET={'Taipei':[1,2,3,5,6,8,9,11,12],'Kaohsiung':[5,6,7,8],'Hong Kong':[5,6,7,8,9],'Macau':[5,6,7,8,9],'Bangkok':[5,6,7,8,9,10],'Singapore':[11,12,1],'Kuala Lumpur':[3,4,10,11],'Ho Chi Minh City':[5,6,7,8,9,10],'Hanoi':[6,7,8,9],'Tokyo':[6,9,10],'Osaka':[6,7,9],'Seoul':[7,8],'Busan':[7,8],'Denpasar':[11,12,1,2,3],'Manila':[6,7,8,9,10],'Cebu':[7,8,9,10,11,12]};
  var ORDER_DAYS=7,AHEAD_DAYS=90,MONTHS='Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  var state={windows:[],today:''};
  function iso(t){return new Date(t).toISOString().slice(0,10);}
  function phtToday(now){return iso((now || Date.now())+8*3600000);}
  function addDays(day,n){return iso(Date.parse(day+'T00:00:00Z')+n*86400000);}
  function nightsBetween(a,b){return Math.round((Date.parse(b)-Date.parse(a))/86400000);}
  function dayLabel(day){var d=new Date(day+'T00:00:00Z');return d.getUTCDate()+' '+MONTHS[d.getUTCMonth()];}
  function span(a,b){var x=new Date(a+'T00:00:00Z'),y=new Date(b+'T00:00:00Z');return x.getUTCMonth()===y.getUTCMonth()?x.getUTCDate()+'–'+y.getUTCDate()+' '+MONTHS[y.getUTCMonth()]:dayLabel(a)+' – '+dayLabel(b);}
  // Saved trips overlap when they are variants of one break (his Christmas
  // leave is saved four ways: two cities, whole break and fare dates). One
  // window per overlap, packed for its longest version.
  function windows(trips,today){
    var rows=(Array.isArray(trips)?trips:[]).filter(function(t){return t && typeof t.city==='string' && /^\d{4}-\d{2}-\d{2}$/.test(t.checkIn || '') && /^\d{4}-\d{2}-\d{2}$/.test(t.checkOut || '') && t.checkOut>t.checkIn && t.checkOut>=today && t.checkIn<=addDays(today,AHEAD_DAYS);}).sort(function(a,b){return a.checkIn.localeCompare(b.checkIn);});
    var out=[];rows.forEach(function(t){var w=out[out.length-1];if(w && t.checkIn<=w.end){if(t.checkOut>w.end)w.end=t.checkOut;}else out.push(w={start:t.checkIn,end:t.checkOut,cities:[],kinds:[],labels:[]});if(!w.cities.includes(t.city))w.cities.push(t.city);if(!w.kinds.includes(t.kind))w.kinds.push(t.kind);if(t.label && !w.labels.includes(t.label))w.labels.push(t.label);});
    return out.map(function(w){
      var poker=w.kinds.includes('poker'),christmas=w.start<=w.start.slice(0,4)+'-12-25' && w.end>=w.start.slice(0,4)+'-12-24';
      return Object.assign(w,{poker:poker,christmas:christmas,nights:nightsBetween(w.start,w.end),name:w.cities.join(' or ')+' · '+(poker?'poker trip':christmas?'Christmas leave':'leave'),dates:span(w.start,w.end),orderBy:addDays(w.start,-ORDER_DAYS),climate:climate(w)});
    });
  }
  function climate(w){
    var lows=[],highs=[],wet=false,known=[];
    w.cities.forEach(function(city){var table=CLIMATE[city];if(!table)return;known.push(city);for(var d=w.start;d<=w.end;d=addDays(d,28)){var m=Number(d.slice(5,7));lows.push(table[m-1][0]);highs.push(table[m-1][1]);if((WET[city] || []).includes(m))wet=true;}var me=Number(w.end.slice(5,7));lows.push(table[me-1][0]);highs.push(table[me-1][1]);if((WET[city] || []).includes(me))wet=true;});
    return known.length?{low:Math.min.apply(null,lows),high:Math.max.apply(null,highs),wet:wet,cities:known}:null;
  }
  // What a window asks of the wardrobe. A top a day, washing after a week;
  // trousers for evenings when it is cool or a casino; a layer for cool air
  // or casino air-con; a jacket only when nights go below ~15°C.
  function needs(w){
    var c=w.climate,cool=c?c.low<=18:false,out=[],days=Math.min(w.nights+1,7);
    out.push({key:'tops',label:'tops',pieces:['tee-light','tee-dark','polo','shirt','resort'],need:days});
    if(cool || w.poker)out.push({key:'trousers',label:'chinos or jeans for evenings',pieces:['chinos','jeans'],need:Math.max(1,Math.ceil(Math.min(w.nights,8)/4))});
    if(c && c.high>=28)out.push({key:'shorts',label:'shorts',pieces:['shorts'],need:1});
    if(cool || w.poker || c && c.low<=20)out.push({key:'layer',label:w.poker && !cool?'warm layer for casino air-con':'warm layer',pieces:['knit','hoodie','jacket'],need:c && c.low<=12?2:1});
    if(c && c.low<=15)out.push({key:'jacket',label:'light jacket',pieces:['jacket'],need:1});
    out.push({key:'shoes',label:'closed shoes',pieces:['sneakers','trainers','smart-shoes'],need:w.nights>=7?2:1});
    return out;
  }
  function owned(prefs,pieces){var w=prefs.wardrobe || {},known=pieces.filter(function(p){return Object.prototype.hasOwnProperty.call(w,p);});return known.length?known.reduce(function(n,p){return n+w[p];},0):null;}
  function plan(prefs,now){
    var today=state.today || phtToday(now);
    return state.windows.filter(function(w){return w.end>=today;}).map(function(w){
      var rows=needs(w).map(function(n){var own=owned(prefs,n.pieces);return Object.assign({},n,{own:own,short:own===null?null:Math.max(0,n.need-own)});});
      return Object.assign({},w,{needs:rows,started:today>=w.start,late:today>w.orderBy});
    });
  }
  // The first coming trip that still has a gap this piece fills, in time to arrive.
  function gapFor(piece,prefs,now){
    var trips=plan(prefs,now);
    for(var i=0;i<trips.length;i++){var t=trips[i];if(t.started)continue;var n=t.needs.find(function(x){return x.short>0 && x.pieces.includes(piece);});if(n)return {trip:t,need:n};}
    return null;
  }
  function coolTrips(prefs,now){return plan(prefs,now).filter(function(t){return !t.started && t.climate && t.climate.low<=20;});}
  function temps(t){return t.climate?'about '+t.climate.low+'–'+t.climate.high+'°C':'climate not in the guide';}
  function use(trips,today){state.today=today || '';state.windows=windows(trips,today || phtToday());return state.windows;}
  root.ShoppingTrips={CLIMATE:CLIMATE,ORDER_DAYS:ORDER_DAYS,windows:windows,needs:needs,plan:plan,gapFor:gapFor,coolTrips:coolTrips,temps:temps,dayLabel:dayLabel,use:use};
})(typeof globalThis!=='undefined'?globalThis:this);
