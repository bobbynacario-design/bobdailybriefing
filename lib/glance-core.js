(function(root) {
  'use strict';
  // At a glance: one line per source at the top of Today, each only when it
  // has something, so a quick open answers "what's on" without visiting
  // Calendar, Sports, Trips, PSE or Rentals. Each line comes from the core
  // its own page uses, so the two never disagree. Pure: no reads or writes.
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var TRIP_TODO = {entry: 'visa', arrival: 'arrival card', passport: 'passport check', tax: 'travel tax', etravel: 'eTravel', hotel: 'hotel', checkin: 'online check-in'};

  function iso(day) { return /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) && Number.isFinite(Date.parse(day + 'T00:00:00Z')); }
  function offset(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
  function dayLabel(day) { var d = new Date(day + 'T00:00:00Z'); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
  function short(v, n) { v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); n = n || 48; return v.length > n ? v.slice(0, n - 1).replace(/\s+$/, '') + '…' : v; }
  function more(list, n) { return list.slice(0, n).join(' · ') + (list.length > n ? ' · +' + (list.length - n) + ' more' : ''); }
  function peso(n) { return '₱' + Math.round(n).toLocaleString('en-PH'); }
  // Manila clock: "08:00" today, "tomorrow 06:00", else "Sun 06:00".
  function pht(ms) { var s = new Date(ms + 8 * 3600000).toISOString(); return {day: s.slice(0, 10), time: s.slice(11, 16)}; }
  function when(at, now) {
    var t = Date.parse(at);
    if (!Number.isFinite(t)) return '';
    var a = pht(t), b = pht(now);
    if (a.day === b.day) return a.time;
    if (a.day === offset(b.day, 1)) return 'tomorrow ' + a.time;
    return DAYS[new Date(a.day + 'T00:00:00Z').getUTCDay()] + ' ' + a.time;
  }

  // His own events and linked calendars (leave, holidays, meetings), built as
  // the Calendar page builds them. All-day entries first, since they frame the
  // day; a span names the day it ends. With nothing today, the next entry in
  // the coming week.
  function calendarLine(core, input, today) {
    if (!core || typeof core.build !== 'function' || !iso(today)) return null;
    var events;
    try { events = core.build(input || {}).filter(function(e) { return !e.done; }); } catch (e) { return null; }
    var label = function(e) { return (e.time ? e.time + ' ' : '') + short(e.title, 60) + (!e.time && e.end > e.start && e.end >= today ? ' (to ' + dayLabel(e.end).slice(4) + ')' : ''); };
    var order = function(a, b) { return (a.time || '').localeCompare(b.time || '') || a.start.localeCompare(b.start); };
    var on = core.onDay(events, today).sort(order);
    if (on.length) return {source: 'calendar', label: 'Today', text: more(on.map(label), 3)};
    var next = events.filter(function(e) { return e.start > today && e.start <= offset(today, 7); })
      .sort(function(a, b) { return a.start.localeCompare(b.start) || order(a, b); })[0];
    return next ? {source: 'calendar', label: 'Next', text: dayLabel(next.start) + ' · ' + label(next)} : null;
  }

  // The Sports page's "next 24 hours" list (sportsDigestItems): his teams and
  // players, Eala, and the fight cards. Items may be some hours old, so ones
  // that started over three hours ago or fall beyond the next day are dropped.
  function sportsLine(items, now) {
    var rows = (Array.isArray(items) ? items : []).filter(function(x) {
      if (!x || !x.text) return false;
      if (x.tag === 'LIVE') return true;
      var t = Date.parse(x.at);
      return Number.isFinite(t) && t >= now - 3 * 3600000 && t <= now + 24 * 3600000;
    }).sort(function(a, b) { return (b.tag === 'LIVE') - (a.tag === 'LIVE') || String(a.at).localeCompare(String(b.at)); });
    if (!rows.length) return null;
    return {source: 'sports', label: 'Sports', text: more(rows.map(function(x) { return (x.tag === 'LIVE' ? 'LIVE' : when(x.at, now)) + ' ' + short(x.text, 56); }), 2)};
  }

  // A booked trip (trips-booked-<uid>) through FlightsCore's checklist: while
  // away, the day of the trip; within a week, the countdown and what is open;
  // further out, only a to-do that is late or due within a week (a visa).
  function tripLine(core, booked, today) {
    if (!core || typeof core.cleanBooked !== 'function' || !booked || !iso(today)) return null;
    var trips = Object.keys(booked.items || {}).map(function(k) { return core.cleanBooked(booked.items[k]); }).filter(Boolean)
      .sort(function(a, b) { return a.depart.localeCompare(b.depart); });
    var soon = offset(today, 7);
    for (var i = 0; i < trips.length; i++) {
      var t = trips[i], s = core.bookedStatus(t, today);
      if (s.phase === 'away') return {source: 'flights', label: 'Trip', text: 'In ' + t.city + ', day ' + s.day + ' of ' + s.of};
      if (s.phase !== 'upcoming') continue;
      var list = core.bookedChecklist(t, today);
      var late = list.filter(function(x) { return x.state === 'late'; });
      var open = list.filter(function(x) { return x.state === 'now' && (s.days <= 7 || (x.by && x.by <= soon)); });
      if (s.days > 7 && !late.length && !open.length) continue;
      var parts = [t.city + ' ' + (s.days === 0 ? 'today' : s.days === 1 ? 'tomorrow' : 'in ' + s.days + ' days')];
      if (late.length) parts.push('late: ' + late.map(function(x) { return TRIP_TODO[x.key]; }).join(', '));
      if (open.length) parts.push('to do: ' + open.map(function(x) { return TRIP_TODO[x.key]; }).join(', '));
      if (!late.length && !open.length) parts.push('checklist done');
      return {source: 'flights', label: 'Trip', text: parts.join(' · ')};
    }
    return null;
  }

  // Fare watches (flights-watch-<uid>) at or under their target in the latest
  // scout, through FlightsCore.fareWatch, the check the Trips page runs.
  function fareLine(core, watch, flights, fx, now) {
    if (!core || typeof core.fareWatch !== 'function' || !watch || !flights) return null;
    var items = watch.items || {};
    var hits = Object.keys(items).sort().map(function(id) { return core.fareWatch(items[id], flights, fx, now); })
      .filter(function(r) { return r && r.hit; })
      .sort(function(a, b) { return (a.best.php - a.watch.target) - (b.best.php - b.watch.target); });
    if (!hits.length) return null;
    return {source: 'flights', label: 'Fares', text: more(hits.map(function(r) {
      return r.watch.city + ' ≈ ' + peso(r.best.php) + ' (' + core.tripLabel(r.best.fare, now) + '), your target ' + peso(r.watch.target);
    }), 1)};
  }

  // PSE watchlist alerts (pse-watch-<uid>) from the latest close, for stocks
  // still on his list; none once the close is over four days old (a long
  // weekend is three). Unlike the push, it stays all day.
  function pseLine(watch, today) {
    if (!watch || !iso(watch.alertsAsOf) || !iso(today) || watch.alertsAsOf < offset(today, -4)) return null;
    var items = watch.items && typeof watch.items === 'object' ? watch.items : {};
    var alerts = (Array.isArray(watch.alerts) ? watch.alerts : []).filter(function(a) {
      return a && a.text && items[a.symbol] && (a.kind !== 'exdiv' || watch.alertsCalendarVerified === true);
    });
    if (!alerts.length) return null;
    return {source: 'pse', label: 'PSE', text: more(alerts.map(function(a) { return short(a.text, 64); }), 2), note: 'close of ' + dayLabel(watch.alertsAsOf)};
  }

  // Money first (his order: money, work, health, poker). One line, three parts,
  // each opening its own page: the latest Radar Taker picks, the biggest
  // Markets move since its last run, and his PSE watchlist news. Radar and
  // Markets were each opened on about half his quiet days (15-28 Nov 2026),
  // PSE on a third. radar and markets are the small summaries the app keeps of
  // those feeds (radarSummary, marketsSummary); watch is pse-watch-<uid>.
  var MARKET_MOVE_MIN = 0.03;
  function radarSummary(doc, dateKey) {
    if (!doc || typeof doc !== 'object' || !iso(dateKey)) return null;
    var picks = ((doc.picks || {}).taker || []).filter(Boolean), signals = Array.isArray(doc.signals) ? doc.signals : [];
    return {date: dateKey, picks: picks.slice(0, 3).map(function(symbol) {
      var s = signals.filter(function(x) { return x && x.symbol === symbol; })[0] || {};
      return {symbol: String(symbol), theme: String(s.theme || '')};
    })};
  }
  function marketsSummary(doc) {
    var items = doc && doc.changes && Array.isArray(doc.changes.items) ? doc.changes.items : [];
    var move = items.filter(function(m) { return m && m.label && Number.isFinite(m.from) && Number.isFinite(m.to); })
      .sort(function(a, b) { return Math.abs(b.to - b.from) - Math.abs(a.to - a.from); })[0];
    return move ? {asOf: String(doc.asOf || ''), move: {label: String(move.label), from: move.from, to: move.to}} : {asOf: String((doc && doc.asOf) || ''), move: null};
  }
  function pct(p) { return Math.round(p * 100) + '%'; }
  function moneyLine(radar, markets, watch, today) {
    if (!iso(today)) return null;
    var parts = [];
    // Radar runs Mon, Wed and Fri: a run up to four days old is the current one.
    if (radar && iso(radar.date) && radar.date >= offset(today, -4) && (radar.picks || []).length) {
      parts.push({source: 'radar', text: 'Radar' + (radar.date === today ? '' : ' ' + dayLabel(radar.date).slice(0, 3)) + ': ' + radar.picks.map(function(p) { return p.symbol; }).join(', ')});
    }
    var m = markets && markets.move;
    if (m && Math.abs(m.to - m.from) >= MARKET_MOVE_MIN && (!iso(markets.asOf) || markets.asOf >= offset(today, -2))) {
      var pts = Math.round((m.to - m.from) * 100);
      parts.push({source: 'miro', text: short(m.label, 44) + ' ' + pct(m.to) + ' (' + (pts > 0 ? '+' : '−') + Math.abs(pts) + ' pts)'});
    }
    var pse = pseLine(watch, today);
    if (pse) parts.push({source: 'pse', text: 'PSE: ' + pse.text.split(' · ')[0] + (pse.text.indexOf(' · ') >= 0 ? ' · +more' : '')});
    if (!parts.length) return null;
    return {source: 'money', label: 'Money', parts: parts, text: parts.map(function(p) { return p.text; }).join(' · ')};
  }

  // Condos in his areas, size and budget (RentalsCore.matchItems, as Rentals
  // lists them) that are new in the last three days or dropped in price.
  function rentalsLine(core, feed, prefs) {
    if (!core || typeof core.matchItems !== 'function' || !feed || !prefs) return null;
    var all = core.matchItems(feed, prefs, {});
    var fresh = all.filter(function(i) { return core.isNew(i, feed); }).length, drops = all.filter(core.dropped).length;
    if (!fresh && !drops) return null;
    var parts = [];
    if (fresh) parts.push(fresh + ' new in your areas');
    if (drops) parts.push(drops + ' price drop' + (drops === 1 ? '' : 's'));
    return {source: 'rentals', label: 'Rentals', text: parts.join(' · ') + ' (up to ' + peso(core.cleanPrefs(prefs).budget) + ')'};
  }

  // The money line carries PSE from 28 Nov 2026, in the slot the PSE line had.
  var ORDER = ['calendar', 'sports', 'flights', 'money', 'pse', 'rentals'];
  // The rows to show, in a fixed order so a line never jumps about.
  function rows(list) {
    return (Array.isArray(list) ? list : []).filter(function(r) { return r && r.text && ORDER.indexOf(r.source) >= 0; })
      .map(function(r, i) { return {r: r, i: i}; })
      .sort(function(a, b) { return ORDER.indexOf(a.r.source) - ORDER.indexOf(b.r.source) || a.i - b.i; })
      .map(function(x) { return x.r; });
  }

  root.GlanceCore = {calendarLine: calendarLine, sportsLine: sportsLine, tripLine: tripLine, fareLine: fareLine, pseLine: pseLine, moneyLine: moneyLine, radarSummary: radarSummary, marketsSummary: marketsSummary,
    rentalsLine: rentalsLine, rows: rows, when: when};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GlanceCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
