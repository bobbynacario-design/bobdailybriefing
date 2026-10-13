// The public holiday table used by PSE's Investing page, plus dated non-trading
// announcements on its home page (Eid dates are announced separately).
export const CALENDAR_SOURCE = 'https://www.pse.com.ph/investing-at-pse/';
const NOTICES_SOURCE = 'https://www.pse.com.ph/';
const AJAX = 'https://www.pse.com.ph/wp-admin/admin-ajax.php';
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
// PSE's annual table omits the separately proclaimed Eid dates. Reviewed
// supplements must be renewed each year; do not assume next year's coverage.
const SUPPLEMENTS = [
  {date:'2026-03-20',source:'https://www.pse.com.ph/news-and-announcement-archive/'},
  {date:'2026-05-27',source:'https://documents.pse.com.ph/CircularOPSPDF/CN-2026-0023.pdf'}
];
function plain(s) { return String(s || '').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim(); }
function day(s) {
  const m=plain(s).match(/([a-z]+)\s+(\d{1,2}),\s*(\d{4})/i);
  if(!m) return null;
  const month=MONTHS.indexOf(m[1].slice(0,3).toLowerCase())+1;
  const iso=m[3]+'-'+String(month).padStart(2,'0')+'-'+m[2].padStart(2,'0');
  return month && Number.isFinite(Date.parse(iso)) && new Date(iso+'T00:00:00Z').toISOString().slice(0,10)===iso ? iso : null;
}
export function calendarRequest(html) {
  const table=String(html).match(/<table id="([^"]+)"[^>]*data-config="[^"]*col-holiday_title/);
  const settings=String(html).match(/var posts_table_params = (\{[^\n]+\});/);
  if(!table || !/^ptp_[a-f0-9]+_\d+$/.test(table[1]) || !settings) throw Error('Holiday table configuration missing');
  const config=JSON.parse(settings[1]);
  if(config.ajax_action!=='ptp_load_posts' || typeof config.ajax_nonce!=='string') throw Error('Holiday table configuration changed');
  const body=new URLSearchParams({table_id:table[1],action:config.ajax_action,_ajax_nonce:config.ajax_nonce,draw:'1',start:'0',length:'100'});
  ['content','cf:holiday_title','categories','hf:categories'].forEach((c,i)=>{
    body.set('columns['+i+'][data]',c);body.set('columns['+i+'][name]',c);
    body.set('columns['+i+'][searchable]','true');body.set('columns['+i+'][orderable]','false');body.set('columns['+i+'][search][value]','');
  });
  return body.toString();
}
export function parseCalendar(table, notices, checkedAt) {
  if(!table || !Array.isArray(table.data) || !table.data.length || table.recordsTotal!==table.data.length || table.recordsFiltered!==table.data.length) throw Error('Holiday table incomplete');
  const dates=new Set(),counts={},eid={};
  for(const row of table.data){
    const iso=day(row.content),year=plain(row.categories);
    if(!iso || year!==iso.slice(0,4)) throw Error('Holiday date or year unreadable');
    dates.add(iso);counts[year]=(counts[year] || 0)+1;
    const title=plain(row['cf:holiday_title'] || row.holiday_title);
    if(/fitr/i.test(title)) (eid[year] ||= {}).fitr=true;
    if(/adha/i.test(title)) (eid[year] ||= {}).adha=true;
  }
  SUPPLEMENTS.forEach(s=>dates.add(s.date));
  const years=Object.keys(counts).filter(y=>counts[y]>=10 && (y==='2026' || eid[y]?.fitr && eid[y]?.adha)).sort();
  if(!years.length) throw Error('Annual holiday coverage unavailable');
  for(const m of plain(notices).matchAll(/NON-TRADING DAYS?\s*\(([^)]+)\)/gi)){
    const iso=day(m[1]);if(iso)dates.add(iso);
  }
  return {verified:true,years,closedDays:[...dates].sort(),checkedAt,source:CALENDAR_SOURCE,noticesSource:NOTICES_SOURCE,supplements:SUPPLEMENTS};
}
export async function fetchPseCalendar(fetcher=fetch) {
  const get=async (url,opts)=>{
    const res=await fetcher(url,{...opts,signal:AbortSignal.timeout(25000)});
    if(!res.ok)throw Error('Holiday feed HTTP '+res.status);return res;
  };
  const html=await(await get(CALENDAR_SOURCE)).text();
  const table=await(await get(AJAX,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:calendarRequest(html)})).json();
  const notices=await(await get(NOTICES_SOURCE)).text();
  return parseCalendar(table,notices,new Date().toISOString());
}
// null means there is no verified calendar for at least one crossed date.
export function addSessions(iso,n,calendar) {
  if(!calendar || !calendar.verified || !Array.isArray(calendar.years) || !Array.isArray(calendar.closedDays) || !Number.isInteger(n) || n<0) return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso || '') || !Number.isFinite(Date.parse(iso)) || new Date(iso+'T00:00:00Z').toISOString().slice(0,10)!==iso || !calendar.years.includes(iso.slice(0,4))) return null;
  let date=iso,k=0;
  const closed=new Set(calendar.closedDays);
  for(let i=0;i<370 && k<n;i++){
    date=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    if(!calendar.years.includes(date.slice(0,4))) return null;
    const wd=new Date(date+'T00:00:00Z').getUTCDay();
    if(wd!==0 && wd!==6 && !closed.has(date))k++;
  }
  return k===n ? date : null;
}
