(function(root) {
  'use strict';
  // Check-ups and vaccines for an adult at average risk, from Australian
  // guidelines (the RACGP Red Book and the national programs), and when each
  // is next due from the month he last had it. He fills in his birth year and
  // last-done months once, on About you; Daybook then puts what is due on
  // Calendar, on Today (with a one-tap Done) and among the weekly review's
  // ideas. It never says what a result means, and every entry says a doctor
  // may set a different schedule. Pure: no reads or writes here.
  // Each check links its source. Reviewed 16 Oct 2026 after Codex's review:
  // pneumococcal is one dose from 65 (the adult program moved from 70), and
  // shingles is a two-dose course, the second 2 to 6 months after the first.
  var CHECKS = [
    {id: 'bp', title: 'Blood pressure check', every: 24, from: 18, set: 'all', source: 'RACGP Red Book', url: 'https://www.racgp.org.au/clinical-resources/clinical-guidelines/key-racgp-guidelines/view-all-racgp-guidelines/preventive-activities-in-general-practice', why: 'At least every 2 years for adults; yearly if it has been high.'},
    {id: 'heart', title: 'Heart risk check', every: 24, from: 45, set: 'all', source: 'Australian CVD risk guideline (2023)', url: 'https://www.cvdcheck.org.au/', why: 'Cholesterol, blood pressure and a risk score from 45. Your GP sets 1 to 5 years from the result; 2 is the middle.'},
    {id: 'diabetes', title: 'Diabetes risk check', every: 36, from: 40, set: 'all', source: 'RACGP Red Book', url: 'https://www.racgp.org.au/clinical-resources/clinical-guidelines/key-racgp-guidelines/view-all-racgp-guidelines/preventive-activities-in-general-practice', why: 'A risk score (AUSDRISK) or blood test every 3 years from 40.'},
    {id: 'bowel', title: 'Bowel screening test', every: 24, from: 45, to: 74, set: 'all', source: 'National Bowel Cancer Screening Program', url: 'https://www.health.gov.au/our-work/national-bowel-cancer-screening-program', why: 'A home test kit (iFOBT) every 2 years from 45 to 74.'},
    {id: 'dental', title: 'Dental check', every: 12, from: 18, set: 'all', source: 'Australian Dental Association', url: 'https://www.teeth.org.au/', why: 'Yearly; your dentist may say every 6 months.'},
    {id: 'eyes', title: 'Eye test', every: 24, from: 18, set: 'all', source: 'Optometry Australia', url: 'https://www.optometry.org.au/', why: 'Every 2 years, and more often from 40 as eyesight and eye pressure change.'},
    {id: 'flu', title: 'Flu vaccine', every: 12, from: 18, set: 'all', source: 'Australian Immunisation Handbook', url: 'https://immunisationhandbook.health.gov.au/', why: 'Every year, ideally before flu season.'},
    {id: 'cervical', title: 'Cervical screening test', every: 60, from: 25, to: 74, set: 'female', source: 'National Cervical Screening Program', url: 'https://www.health.gov.au/our-work/national-cervical-screening-program', why: 'Every 5 years from 25 to 74.'},
    {id: 'breast', title: 'Breast screen (mammogram)', every: 24, from: 50, to: 74, set: 'female', source: 'BreastScreen Australia', url: 'https://www.health.gov.au/our-work/breastscreen-australia-program', why: 'Every 2 years from 50 to 74.'},
    {id: 'shingles', title: 'Shingles vaccine, dose 1', once: true, from: 65, set: 'all', source: 'National Immunisation Program', url: 'https://www.health.gov.au/topics/immunisation/vaccines/shingles-herpes-zoster-immunisation-service', why: 'A two-dose course (Shingrix), free from 65.'},
    {id: 'shingles2', title: 'Shingles vaccine, dose 2', once: true, from: 65, after: {id: 'shingles', from: 2, by: 6}, set: 'all', source: 'National Immunisation Program', url: 'https://www.health.gov.au/topics/immunisation/vaccines/shingles-herpes-zoster-immunisation-service', why: '2 to 6 months after dose 1.'},
    {id: 'pneumo', title: 'Pneumococcal vaccine', once: true, from: 65, set: 'all', source: 'National Immunisation Program', url: 'https://www.health.gov.au/topics/immunisation/vaccines/pneumococcal-immunisation-service', why: 'One dose, free from 65; a doctor may advise it earlier for some conditions.'}
  ];
  var SETS = ['all', 'male', 'female'];
  var MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
  var SOON_DAYS = 60;
  var NOTE = 'A general schedule from Australian guidelines; your doctor may set a different one for you.';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function month(v) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(v || ''));
    return m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1950 && +m[1] <= 2100 ? v : '';
  }
  function day(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : ''; }
  function addMonths(ym, n) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  }
  function monthLabel(ym) { return month(ym) ? MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4) : ''; }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function find(id) { for (var i = 0; i < CHECKS.length; i++) if (CHECKS[i].id === id) return CHECKS[i]; return null; }

  // The About you box as stored on health-basics-<uid>: birth year, which
  // screenings to include, last-done months, and the checks he turned off.
  function cleanBasics(raw, todayKey) {
    raw = raw || {};
    var year = Number(raw.birthYear), nowYear = Number(String(todayKey || '').slice(0, 4)) || 2100;
    var out = {birthYear: year >= 1920 && year <= nowYear - 16 ? year : null, include: SETS.indexOf(raw.include) >= 0 ? raw.include : 'all', last: {}, next: {}, off: {}};
    var thisMonth = String(todayKey || '').slice(0, 7);
    Object.keys(raw.last || {}).forEach(function(id) {
      var m = month(raw.last[id]);
      if (find(id) && m && (!thisMonth || m <= thisMonth)) out.last[id] = m;
    });
    // A next-due month his doctor gave, which overrides the schedule.
    Object.keys(raw.next || {}).forEach(function(id) {
      var m = month(raw.next[id]);
      if (find(id) && m && (!thisMonth || m <= addMonths(thisMonth, 120))) out.next[id] = m;
    });
    Object.keys(raw.off || {}).forEach(function(id) { if (find(id) && raw.off[id] === true) out.off[id] = true; });
    if (typeof raw.updatedAt === 'string') out.updatedAt = raw.updatedAt.slice(0, 40);
    return out;
  }
  function age(basics, todayKey) { return basics.birthYear ? Number(todayKey.slice(0, 4)) - basics.birthYear : null; }
  // Whether a check is for him: his screening set, his age (the year he turns
  // it counts), and not turned off. Without a birth year only the checks for
  // every adult apply.
  function applies(check, basics, todayKey) {
    if (basics.off[check.id]) return false;
    // A second dose is due only once the first is recorded.
    if (check.after && !basics.last[check.after.id]) return false;
    if (check.set !== 'all' && basics.include !== 'all' && check.set !== basics.include) return false;
    var a = age(basics, todayKey);
    if (a == null) return check.from <= 18;
    return a >= check.from && (check.to == null || a <= check.to);
  }

  // Every check that applies, soonest first, each with its status:
  //   overdue  due more than a month ago     due   due now (this month or last)
  //   soon     due in the next 60 days       ok    due later
  //   unknown  no last-done month recorded   done  a one-off he has had
  function plan(raw, todayKey) {
    var basics = cleanBasics(raw, todayKey), out = [];
    CHECKS.forEach(function(c) {
      if (!applies(c, basics, todayKey)) return;
      var last = basics.last[c.id] || '', next = basics.next[c.id] || '', item = {id: c.id, title: c.title, last: last, lastLabel: monthLabel(last), every: c.every || 0, once: !!c.once,
        after: c.after || null, source: c.source, url: c.url || '', why: c.why, due: '', status: 'unknown', byDoctor: false};
      var overdueFrom = '';
      if (next && !(c.once && last && last >= next)) { item.due = next + '-01'; item.byDoctor = true; }
      else if (c.once && last) item.status = 'done';
      else if (c.after) {
        var first = basics.last[c.after.id];
        item.due = addMonths(first, c.after.from) + '-01';
        overdueFrom = addMonths(first, c.after.by) + '-01';
        item.lastLabel = monthLabel(first);
      } else if (!c.once && last) item.due = addMonths(last, c.every) + '-01';
      if (item.due) {
        var gap = daysBetween(todayKey, item.due);
        item.status = (overdueFrom ? todayKey > overdueFrom : gap < -45) ? 'overdue' : gap <= 0 ? 'due' : gap <= SOON_DAYS ? 'soon' : 'ok';
      }
      out.push(item);
    });
    var order = {overdue: 0, due: 1, soon: 2, ok: 3, unknown: 4, done: 5};
    return out.sort(function(a, b) { return order[a.status] - order[b.status] || (a.due || '9').localeCompare(b.due || '9') || a.title.localeCompare(b.title); });
  }
  function isDue(item) { return item.status === 'overdue' || item.status === 'due'; }
  function everyText(item) {
    if (item.byDoctor) return 'the date your doctor set';
    if (item.after) return item.after.from + ' to ' + item.after.by + ' months after dose 1';
    return item.once ? 'once' : item.every % 12 === 0 ? (item.every === 12 ? 'every year' : 'every ' + item.every / 12 + ' years') : 'every ' + item.every + ' months';
  }
  function lastText(item) { return item.after ? 'Dose 1 ' + item.lastLabel : item.lastLabel ? 'Last done ' + item.lastLabel : 'No last date'; }

  // He had it this month: the one tap on Today.
  function markDone(raw, id, todayKey) {
    var basics = cleanBasics(raw, todayKey);
    if (!find(id)) return basics;
    basics.last[id] = todayKey.slice(0, 7);
    delete basics.next[id];
    delete basics.off[id];
    return basics;
  }

  // Calendar entries for the next 18 months: a due or overdue check sits on
  // today, the rest on the first day of the month they fall due.
  function calendarEntries(items, todayKey) {
    var until = addMonths(todayKey.slice(0, 7), 18) + '-01';
    return (items || []).filter(function(i) { return i.due && i.due <= until; }).map(function(i) {
      return {id: 'checkup-' + i.id, title: (isDue(i) ? 'Check-up due: ' : 'Check-up: ') + i.title, start: isDue(i) ? todayKey : i.due,
        detail: lastText(i) + ' · ' + everyText(i) + ' · ' + i.source + (i.url ? ' (' + i.url + ')' : '') + '. ' + NOTE + ' Mark it done on Today or About you.'};
    });
  }
  // Today's line: what is due now, at most two named.
  function todayLine(items) {
    var due = (items || []).filter(isDue);
    if (!due.length) return null;
    return {items: due.slice(0, 2), more: Math.max(0, due.length - 2)};
  }
  // One idea for the weekly review: the most overdue check, to book.
  function idea(items) {
    var i = (items || []).filter(isDue)[0];
    return i ? {area: 'health', text: 'Book your ' + i.title.charAt(0).toLowerCase() + i.title.slice(1), why: lastText(i) + ' · ' + everyText(i) + ' (' + i.source + ')'} : null;
  }

  root.CheckupCore = {CHECKS: CHECKS, SETS: SETS, NOTE: NOTE, cleanBasics: cleanBasics, applies: applies, plan: plan, isDue: isDue, everyText: everyText,
    monthLabel: monthLabel, lastText: lastText, markDone: markDone, calendarEntries: calendarEntries, todayLine: todayLine, idea: idea};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CheckupCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
