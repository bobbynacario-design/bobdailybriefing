(function(root) {
  'use strict';
  // Grooming and personal care kept on a rhythm: a haircut, the sauna, a
  // massage, and whatever else he adds (a barber shave, nails). Each item keeps
  // how often he wants it, the day he last went, and optionally where and with
  // whom; the list is stored whole on grooming-<uid>. A session he plans is an
  // ordinary event on his Calendar (calendar-events-<uid>), linked by eventId,
  // so moving or deleting it there is respected and the morning push's Today
  // line carries it on the day. Pure: no reads or writes here.
  var PRESETS = [
    {id: 'haircut', title: 'Haircut', every: 28, starter: true},
    {id: 'sauna', title: 'Sauna', every: 7, starter: true},
    {id: 'massage', title: 'Massage', every: 14, starter: true},
    {id: 'shave', title: 'Barber shave', every: 14},
    {id: 'nails', title: 'Nails', every: 21},
    {id: 'facial', title: 'Facial', every: 28}
  ];
  // How often, in days: the choices the box offers. A typed item starts at 4 weeks.
  var EVERY = [3, 4, 7, 10, 14, 21, 28, 35, 42, 56, 90];
  var DEFAULT_EVERY = 28, DEFAULT_TIME = '10:00', MAX = 20, CALENDAR_DAYS = 90;
  var ID = /^[a-z0-9][a-z0-9-]{1,39}$/, EVENT = /^[a-zA-Z0-9_-]{8,80}$/;
  var WEEKDAYS = 'Sun Mon Tue Wed Thu Fri Sat'.split(' '), MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

  var text = function(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); };
  function day(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return '';
    var d = new Date(v + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : '';
  }
  function offset(d, n) { return day(d) ? new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10) : ''; }
  function gap(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function clock(v) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? v : ''; }
  function dayLabel(d) {
    if (!day(d)) return '';
    var x = new Date(d + 'T00:00:00Z');
    return WEEKDAYS[x.getUTCDay()] + ' ' + x.getUTCDate() + ' ' + MONTHS[x.getUTCMonth()];
  }
  function everyLabel(n) {
    if (n === 1) return 'Every day';
    if (n === 7) return 'Every week';
    if (n % 7 === 0 && n <= 56) return 'Every ' + n / 7 + ' weeks';
    if (n === 90) return 'Every 3 months';
    return 'Every ' + n + ' days';
  }
  // How close counts as "due soon", and how late is "overdue": both grow with
  // the rhythm, so a weekly sauna is overdue after 2 days and a monthly haircut
  // after a week.
  function soonDays(every) { return Math.max(1, Math.min(7, Math.round(every / 5))); }
  function graceDays(every) { return Math.max(1, Math.round(every / 4)); }

  function cleanItem(raw, todayKey) {
    raw = raw || {};
    var id = String(raw.id || ''), title = text(raw.title, 60), every = Math.round(Number(raw.every));
    if (!ID.test(id) || !title || !(every >= 1 && every <= 365)) return null;
    var last = day(raw.last);
    if (last && todayKey && last > todayKey) last = '';
    return {id: id, title: title, every: every, last: last, where: text(raw.where, 80), with: text(raw.with, 80), time: clock(raw.time), eventId: EVENT.test(raw.eventId || '') ? raw.eventId : ''};
  }
  function starters() {
    return PRESETS.filter(function(p) { return p.starter; }).map(function(p) { return {id: p.id, title: p.title, every: p.every, last: '', where: '', with: '', time: '', eventId: ''}; });
  }
  // The stored list, or the three starters before he has saved anything
  // (fresh). A list he emptied stays empty.
  function cleanGrooming(raw, todayKey) {
    if (!raw || !Array.isArray(raw.items)) return {items: starters(), fresh: true};
    var seen = {}, items = [];
    raw.items.forEach(function(r) {
      var i = cleanItem(r, todayKey);
      if (i && !seen[i.id] && items.length < MAX) { seen[i.id] = true; items.push(i); }
    });
    return {items: items, fresh: false};
  }
  // What is written to grooming-<uid>: the items only.
  function stored(doc) { return {items: doc.items.map(function(i) { return cleanItem(i); }).filter(Boolean)}; }
  function linked(events) {
    var byId = {};
    (Array.isArray(events) ? events : []).forEach(function(e) { if (e && EVENT.test(e.id || '')) byId[e.id] = e; });
    return byId;
  }

  // Each item in his own order, with when it is next due and its status:
  //   past     a planned day went by without Done ("did you go?")
  //   overdue  later than the grace for its rhythm     due   due today, or a little late
  //   planned  a session is on his Calendar            soon  due within a few days
  //   ok       due later                               unknown  no last day yet
  // events is his Calendar list (calendar-events-<uid> items); a plan marked
  // done there counts as going that day.
  function plan(raw, events, todayKey) {
    var doc = cleanGrooming(raw, todayKey), byId = linked(events);
    return doc.items.map(function(i, n) {
      var e = i.eventId && byId[i.eventId], session = null, last = i.last;
      if (e && day(e.start)) {
        if (e.done === true) { if (e.start <= todayKey && (!last || e.start > last)) last = e.start; }
        else session = {eventId: e.id, start: e.start, time: clock(e.time), location: text(e.location, 200), updatedAt: text(e.updatedAt, 40)};
      }
      var due = last ? offset(last, i.every) : '';
      var item = Object.assign({}, i, {last: last, lastLabel: dayLabel(last), everyLabel: everyLabel(i.every), due: due, dueLabel: dayLabel(due), session: session, status: 'unknown', late: 0, order: n});
      if (session) item.status = session.start < todayKey ? 'past' : 'planned';
      else if (due) {
        var until = gap(todayKey, due);
        item.late = Math.max(0, -until);
        item.status = until < -graceDays(i.every) ? 'overdue' : until <= 0 ? 'due' : until <= soonDays(i.every) ? 'soon' : 'ok';
      }
      return item;
    });
  }
  function isDue(item) { return item.status === 'past' || item.status === 'overdue' || item.status === 'due'; }
  // The short state shown beside the name, in his words.
  function stateText(item, todayKey) {
    var tomorrow = offset(todayKey, 1), s = item.session;
    var when = function(d) { return d === todayKey ? 'today' : d === tomorrow ? 'tomorrow' : dayLabel(d); };
    if (item.status === 'past') return 'planned ' + dayLabel(s.start) + ': did you go?';
    if (item.status === 'planned') return when(s.start) + (s.time ? ' ' + s.time : '') + (s.location ? ' at ' + s.location : '');
    if (item.status === 'overdue') return 'overdue ' + item.late + ' days';
    if (item.status === 'due') return item.late ? 'due ' + item.late + (item.late === 1 ? ' day ago' : ' days ago') : 'due today';
    if (item.status === 'soon') return 'due ' + when(item.due);
    if (item.status === 'ok') return 'next ' + item.dueLabel;
    return 'no date yet';
  }

  // He went: the one tap. A plan whose day has passed counts as going that
  // day, anything else as today; the plan then leaves his Calendar.
  function markDone(raw, events, id, todayKey) {
    var doc = cleanGrooming(raw, todayKey), item = plan(raw, events, todayKey).filter(function(x) { return x.id === id; })[0];
    if (!item) return {doc: stored(doc), removeEvent: '', went: '', next: ''};
    var went = item.session && item.session.start < todayKey ? item.session.start : todayKey;
    doc.items.forEach(function(i) { if (i.id === id) { i.last = went; i.eventId = ''; } });
    return {doc: stored(doc), removeEvent: item.session ? item.session.eventId : '', went: went, next: offset(went, item.every)};
  }
  // The date and time the Plan picker starts on: the plan already made, else
  // the day it falls due (tomorrow once that has passed) at his usual time.
  function planDefault(item, todayKey) {
    if (item.session) return {date: item.session.start < todayKey ? offset(todayKey, 1) : item.session.start, time: item.session.time};
    return {date: item.due && item.due > todayKey ? item.due : offset(todayKey, 1), time: item.time || DEFAULT_TIME};
  }
  // A session on a date (and time): the Calendar event to write, and the
  // updatedAt it must still have when it replaces a plan already there.
  function planSession(raw, events, id, when, todayKey, newEventId) {
    when = when || {};
    var doc = cleanGrooming(raw, todayKey), item = plan(raw, events, todayKey).filter(function(x) { return x.id === id; })[0];
    var date = day(when.date), time = clock(when.time);
    if (!item) return {error: 'That item is no longer on your list.'};
    if (!date || date < todayKey) return {error: 'Choose today or a later date.'};
    if (when.time && !time) return {error: 'Choose a valid time, or leave it empty for any time that day.'};
    var eventId = item.session ? item.session.eventId : newEventId;
    if (!EVENT.test(eventId || '')) return {error: 'Invalid event identifier.'};
    var event = {id: eventId, title: item.title, start: date, end: date, time: time, kind: 'personal', location: item.where,
      notes: 'Grooming' + (item.with ? ', with ' + item.with : '') + '. Mark it done on Today or About you.', done: false};
    doc.items.forEach(function(i) { if (i.id === id) { i.eventId = eventId; if (time) i.time = time; } });
    return {doc: stored(doc), event: event, expected: item.session ? item.session.updatedAt : null};
  }

  function presetFor(what) {
    var key = text(what, 60).toLowerCase();
    return PRESETS.filter(function(p) { return p.id === key || p.title.toLowerCase() === key; })[0] || null;
  }
  function slug(title, taken) {
    var base = text(title, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
    if (base.length < 2) base = 'item' + (base ? '-' + base : '');
    var id = base, n = 2;
    while (taken.indexOf(id) >= 0) id = base + '-' + n++;
    return id;
  }
  // A preset (by id or name) or a name he typed, at the end of his list.
  function addItem(raw, what, todayKey) {
    var doc = cleanGrooming(raw, todayKey), preset = presetFor(what), title = preset ? preset.title : text(what, 60);
    if (!title) return {error: 'Enter a name.'};
    if (doc.items.length >= MAX) return {error: 'Your list has ' + MAX + ' items. Remove one first.'};
    if (doc.items.some(function(i) { return i.title.toLowerCase() === title.toLowerCase(); })) return {error: title + ' is already on your list.'};
    var taken = doc.items.map(function(i) { return i.id; }), id = preset && taken.indexOf(preset.id) < 0 ? preset.id : slug(title, taken);
    doc.items.push({id: id, title: title, every: preset ? preset.every : DEFAULT_EVERY, last: '', where: '', with: '', time: '', eventId: ''});
    return {doc: stored(doc), id: id};
  }
  // His edits to one item: name, how often, the day he last went (empty
  // clears it), where and with whom. Anything invalid keeps what was there.
  function updateItem(raw, id, patch, todayKey) {
    var doc = cleanGrooming(raw, todayKey);
    patch = patch || {};
    doc.items.forEach(function(i) {
      if (i.id !== id) return;
      if ('title' in patch && text(patch.title, 60)) i.title = text(patch.title, 60);
      if ('every' in patch) { var n = Math.round(Number(patch.every)); if (n >= 1 && n <= 365) i.every = n; }
      if ('last' in patch) { var d = day(patch.last); if (!patch.last) i.last = ''; else if (d && d <= todayKey) i.last = d; }
      if ('where' in patch) i.where = text(patch.where, 80);
      if ('with' in patch) i.with = text(patch.with, 80);
    });
    return {doc: stored(doc)};
  }
  // Off the list, with its plan taken off his Calendar too.
  function removeItem(raw, events, id, todayKey) {
    var doc = cleanGrooming(raw, todayKey), item = plan(raw, events, todayKey).filter(function(x) { return x.id === id; })[0];
    doc.items = doc.items.filter(function(i) { return i.id !== id; });
    return {doc: stored(doc), removeEvent: item && item.session ? item.session.eventId : ''};
  }
  function presetsToAdd(raw, todayKey) {
    var doc = cleanGrooming(raw, todayKey);
    return PRESETS.filter(function(p) { return !doc.items.some(function(i) { return i.id === p.id || i.title.toLowerCase() === p.title.toLowerCase(); }); });
  }

  // Today's line: a past plan to confirm, what is overdue or due, a session
  // planned for today or tomorrow, then what is due soon. At most three named.
  // Before any item has a day or a plan, a one-line prompt to set it up.
  function todayLine(items, todayKey) {
    items = items || [];
    if (items.length && items.every(function(i) { return i.status === 'unknown'; })) return {setup: true, items: [], more: 0, notable: false};
    var tomorrow = offset(todayKey, 1), rank = {past: 0, overdue: 1, due: 2, planned: 3, soon: 4};
    var show = items.filter(function(i) { return i.status === 'planned' ? i.session.start <= tomorrow : rank[i.status] !== undefined; });
    if (!show.length) return null;
    show.sort(function(a, b) {
      return rank[a.status] - rank[b.status] || b.late - a.late || ((a.session ? a.session.start + (a.session.time || '99:99') : a.due) || '').localeCompare((b.session ? b.session.start + (b.session.time || '99:99') : b.due) || '') || a.order - b.order;
    });
    return {setup: false, items: show.slice(0, 3), more: Math.max(0, show.length - 3), notable: show.some(isDue)};
  }
  // Calendar entries for what is not planned: due now sits on today, the next
  // due day of the rest within 90 days. A planned session is already there as
  // his own event.
  function calendarEntries(items, todayKey) {
    var until = offset(todayKey, CALENDAR_DAYS);
    return (items || []).filter(function(i) { return !i.session && i.due && (isDue(i) || i.due <= until); }).map(function(i) {
      var now = isDue(i);
      return {id: 'grooming-' + i.id, title: now ? 'Due now: ' + i.title + (i.late > 1 ? ' (' + i.late + ' days late)' : '') : i.title + ' due', start: now ? todayKey : i.due,
        detail: i.everyLabel + (i.lastLabel ? ' · last ' + i.lastLabel : '') + (i.where ? ' · ' + i.where : '') + '. Plan it or mark it done on Today or About you.'};
    });
  }

  root.GroomingCore = {PRESETS: PRESETS, EVERY: EVERY, MAX: MAX, DEFAULT_TIME: DEFAULT_TIME, cleanGrooming: cleanGrooming, stored: stored, plan: plan, isDue: isDue,
    stateText: stateText, everyLabel: everyLabel, dayLabel: dayLabel, markDone: markDone, planDefault: planDefault, planSession: planSession, addItem: addItem,
    updateItem: updateItem, removeItem: removeItem, presetsToAdd: presetsToAdd, todayLine: todayLine, calendarEntries: calendarEntries};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GroomingCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
