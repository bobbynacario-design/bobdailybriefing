// lib/weekly-mirror.js — "Your week, read back" on Today.
//
// Once a week (or whenever Bob asks) the server reads his last seven days —
// notes, quests, the stories he noted, opened and voted on, experiments and
// journal decisions — and reflects back what keeps coming up, where what he
// said and what he did part ways, one new thing to try and one question
// (functions/weekly-mirror.js). This file only shows it: it asks for a read,
// loads the stored reads for the account, and renders them with textContent.
// Nothing is sent anywhere until he taps the button.
(function(root) {
  'use strict';
  var WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
  function dayLabel(key) {
    var date = new Date(key + 'T00:00:00Z');
    return WEEKDAYS[date.getUTCDay()] + ' ' + date.getUTCDate() + ' ' + MONTHS[date.getUTCMonth()];
  }
  function todayKey() {
    return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Manila', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  // What the read covered, in one line: only the counts that are not zero.
  function coverage(mirror) {
    var s = mirror.stats || {}, bits = [plural(s.days || 0, 'day', 'days') + ' of 7 with something recorded'];
    if (s.notes) bits.push(plural(s.notes, 'note', 'notes'));
    if (s.done) bits.push(plural(s.done, 'quest done', 'quests done'));
    if (s.opened) bits.push(plural(s.opened, 'story opened', 'stories opened'));
    if (s.votes) bits.push(plural(s.votes, 'vote', 'votes'));
    if (s.decisions) bits.push(plural(s.decisions, 'decision', 'decisions'));
    return 'Week to ' + dayLabel(mirror.weekKey) + ' · ' + bits.join(' · ');
  }
  // A callable error, in words Bob can act on.
  function errorText(error) {
    var code = String(error && error.code || '').replace(/^functions\//, '');
    if (code === 'resource-exhausted') return 'That is three reads today. It will be ready again tomorrow.';
    if (code === 'unauthenticated' || code === 'permission-denied') return 'Sign in with your own account to read your week back.';
    if (code === 'deadline-exceeded' || code === 'unavailable') return 'It took too long to answer. Try again in a minute.';
    if (code === 'not-found' || (code === 'internal' && String(error && error.message || '').toLowerCase() === 'internal')) {
      return 'Could not reach the weekly mirror. If it was just added it needs a functions deploy; otherwise try again in a minute.';
    }
    return (error && error.message) || 'Could not read your week back. Try again in a minute.';
  }
  function evidenceDay(value, mirror) {
    if (!mirror || !DAY_KEY.test(mirror.weekKey || '')) return '';
    var end = Date.parse(mirror.weekKey + 'T00:00:00Z'), needle = String(value || '').trim().toLowerCase();
    var long = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    for (var i = 0; i < 7; i++) {
      var date = new Date(end-i*86400000), key = date.toISOString().slice(0,10);
      if ([key,dayLabel(key).toLowerCase(),WEEKDAYS[date.getUTCDay()].toLowerCase(),long[date.getUTCDay()]].indexOf(needle) >= 0) return key;
    }
    return '';
  }
  root.WeeklyMirrorView = {dayLabel:dayLabel, coverage:coverage, errorText:errorText,evidenceDay:evidenceDay};
  if (!root.document) return;

  var state = {uid:null, mirrors:{}, loadedAt:0, loading:false, running:false, status:'', shown:'', openedFor:''};
  function el(id) { return document.getElementById('boost-mirror-' + id); }
  function keys() { return Object.keys(state.mirrors).filter(function(key) { return DAY_KEY.test(key); }).sort(); }
  function node(tag, cls, text) {
    var out = document.createElement(tag);
    if (cls) out.className = cls;
    if (text != null) out.textContent = text;
    return out;
  }
  function part(title, text) {
    if (!text) return null;
    var out = node('section', 'boost-mirror-part');
    var paragraph = node('p'); appendCitations(paragraph,text);
    out.append(node('h4', '', title), paragraph);
    return out;
  }
  function list(title, items) {
    if (!items || !items.length) return null;
    var out = node('section', 'boost-mirror-part'), ul = node('ul');
    items.forEach(function(item) { var li = node('li'); appendCitations(li,item); ul.appendChild(li); });
    out.append(node('h4', '', title), ul);
    return out;
  }
  var shownMirror = null;
  function cite(value) {
    var key = evidenceDay(value,shownMirror);
    if (!key) return document.createTextNode(value);
    var button = node('button','tool-chip',value); button.type = 'button';
    button.title = 'Open the entry for ' + dayLabel(key);
    button.addEventListener('click',function() {
      if (!root.openDailyBoostDay || !root.openDailyBoostDay(key)) {
        state.status = 'No saved daily entry is available for ' + dayLabel(key) + '. This reference may concern the decision journal.';
        el('status').textContent = state.status;
      }
    });
    return button;
  }
  function appendCitations(parent, text) {
    // Free prose may say "last Monday" or discuss next week. Link only exact
    // dates there; weekday labels are resolved only in the theme's citations.
    var pattern = /\b20\d{2}-\d{2}-\d{2}\b/g, start = 0, match;
    while ((match = pattern.exec(text))) {
      parent.appendChild(document.createTextNode(text.slice(start,match.index)));
      parent.appendChild(cite(match[0])); start = pattern.lastIndex;
    }
    parent.appendChild(document.createTextNode(text.slice(start)));
  }
  function body(mirror) {
    shownMirror = mirror;
    var parts = [node('div', 'boost-kicker', coverage(mirror)), node('h3', 'boost-mirror-line', mirror.week_in_a_line)];
    if (mirror.confidence === 'thin') parts.push(node('p', 'boost-mirror-thin', 'A light week of notes, so this read is tentative. A sentence a day gives it more to work with.'));
    if ((mirror.themes || []).length) {
      var themes = node('section', 'boost-mirror-part'), ul = node('ul');
      mirror.themes.forEach(function(theme) {
        var li = node('li'), title = node('strong', '', theme.title);
        li.append(title, document.createTextNode(' — ')); appendCitations(li,theme.detail);
        if ((theme.days || []).length) li.appendChild(document.createTextNode(' ('));
        (theme.days || []).forEach(function(day,i) { if (i) li.appendChild(document.createTextNode(', ')); li.appendChild(cite(day)); });
        if ((theme.days || []).length) li.appendChild(document.createTextNode(')'));
        ul.appendChild(li);
      });
      // A theme seen on one day is what stood out, not a pattern.
      var recurs = mirror.themes.some(function(theme) { return (theme.days || []).length >= 2; });
      themes.append(node('h4', '', recurs ? 'What kept coming up' : 'What stood out'), ul);
      parts.push(themes);
    }
    var energy = mirror.energy || {};
    if ((energy.gave || []).length || (energy.drained || []).length) {
      var pair = node('div', 'boost-mirror-energy');
      [list('Gave you energy', energy.gave), list('Took energy', energy.drained)].forEach(function(item) { if (item) pair.appendChild(item); });
      parts.push(pair);
    }
    parts.push(part('Said and did', mirror.said_vs_did), part('Where your attention went', mirror.reading),
      part('How you decided', mirror.decisions), part('Last read’s question', mirror.last_week));
    var tryNext = mirror.try_next || {};
    if (tryNext.action) {
      var box = node('div', 'boost-mirror-try');
      box.append(node('h4', '', 'Try this week · something new'), node('p', 'boost-mirror-action', tryNext.action));
      if (tryNext.why) box.appendChild(node('p', 'boost-mirror-why', tryNext.why));
      var controls = node('div','boost-library-controls'), label = node('label','','Revisit on'), due = node('input'), choose = node('button','tool-chip','Try this'), feedback = node('p','boost-kicker');
      due.type = 'date'; due.min = todayKey(); due.value = new Date(Date.parse(todayKey() + 'T00:00:00Z') + 7*86400000).toISOString().slice(0,10);
      label.appendChild(due); controls.append(label,choose); box.append(controls,feedback);
      choose.addEventListener('click',function() {
        var result = root.createDailyBoostExperiment && root.createDailyBoostExperiment(tryNext.action,due.value,'Weekly read-back · ' + mirror.weekKey + '\n' + (tryNext.why || ''));
        feedback.textContent = result ? result.message : 'Open Today and sign in to save this experiment.';
      });
      parts.push(box);
    }
    parts.push(node('blockquote', 'boost-mirror-question', mirror.question));
    var at = new Date(mirror.generatedAt), when = isNaN(at) ? '' : ', ' + at.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
    parts.push(node('p', 'boost-kicker', 'Read ' + dayLabel(mirror.weekKey) + when + (mirror.model ? ' · ' + mirror.model : '') +
      (mirror.followedUp ? ' · follows up the read from ' + dayLabel(mirror.followedUp) : '') +
      ' · It only sees what you recorded here, so a quiet day reads as quiet.'));
    return parts.filter(Boolean);
  }
  function render() {
    if (!el('panel')) return;
    var all = keys(), latest = all[all.length - 1] || '', today = todayKey();
    if (!state.shown || !state.mirrors[state.shown]) state.shown = latest;
    el('summary').textContent = 'Your week, read back' + (latest ? ' · last read ' + dayLabel(latest) : '');
    // Sundays open it once, alongside the look-back; after that it stays as left.
    if (state.openedFor !== today && new Date(today + 'T00:00:00Z').getUTCDay() === 0) { state.openedFor = today; el('panel').open = true; }
    var run = el('run');
    run.disabled = state.running || !state.uid;
    run.textContent = state.running ? 'Reading your week…' : state.mirrors[today] ? 'Read it again' : 'Read my week back';
    el('status').textContent = state.saving ? 'Saving your latest notes…' : state.running ? 'This takes about half a minute. Your notes go to OpenAI for this read only.' : state.status;
    var select = el('week');
    select.hidden = all.length < 2;
    select.replaceChildren();
    all.slice().reverse().forEach(function(key) {
      var option = node('option', '', 'Week to ' + dayLabel(key));
      option.value = key; option.selected = key === state.shown;
      select.appendChild(option);
    });
    var out = el('body'), mirror = state.mirrors[state.shown];
    out.replaceChildren();
    out.hidden = !mirror;
    if (mirror) body(mirror).forEach(function(item) { out.appendChild(item); });
  }
  function load() {
    var uid = state.uid, session = state;
    if (!uid || state.loading || typeof root.fbLoadWeeklyMirror !== 'function' || Date.now() - state.loadedAt < 300000) return;
    state.loading = true;
    root.fbLoadWeeklyMirror(uid).then(function(mirrors) {
      if (session !== state || uid !== root._firebaseUid) return;
      state.loading = false; state.loadedAt = Date.now();
      Object.keys(mirrors || {}).forEach(function(key) {
        var current = state.mirrors[key], incoming = mirrors[key];
        if (!current || Date.parse(incoming.generatedAt) > Date.parse(current.generatedAt)) state.mirrors[key] = incoming;
      });
      render(); startHereChanged();
    }, function() { if (session === state) { state.loading = false; state.loadedAt = Date.now(); } });
  }
  async function run() {
    var uid = state.uid, session = state;
    if (!uid || state.running || typeof root.fbGenerateWeeklyMirror !== 'function') return;
    state.running = true; state.status = ''; state.saving = typeof root.flushDailyBoost === 'function'; render();
    try {
      if (state.saving) await root.flushDailyBoost();
      if (session !== state || uid !== root._firebaseUid) return;
      state.saving = false; render();
      var result = await root.fbGenerateWeeklyMirror();
      if (session !== state || uid !== root._firebaseUid) return;
      state.running = false;
      var mirror = result && result.mirror;
      if (!mirror || !mirror.weekKey) {
        state.status = 'Nothing recorded in the last seven days yet. Write a note or finish a quest, then try again.';
      } else {
        state.mirrors[mirror.weekKey] = mirror; state.shown = mirror.weekKey; state.status = ''; startHereChanged();
        el('panel').open = true;
      }
      render();
    } catch(error) {
      if (session !== state || uid !== root._firebaseUid) return;
      state.running = false; state.saving = false; state.status = errorText(error); render();
    }
  }
  // Today rendered (arrived, signed in, account switched).
  // Start here (lib/daily-boost.js) suggests the Sunday read until one exists.
  root.weeklyMirrorReadOn = function(day) { return !!(state.uid && state.uid === root._firebaseUid && state.mirrors[day]); };
  function startHereChanged() { if (typeof root.refreshDailyBoost === 'function') root.refreshDailyBoost(); }
  root.renderWeeklyMirror = function() {
    var uid = root._firebaseUid || null;
    if (uid !== state.uid) state = {uid:uid, mirrors:{}, loadedAt:0, loading:false, running:false, status:'', shown:'', openedFor:state.openedFor};
    render(); load();
  };
  document.addEventListener('DOMContentLoaded', function() {
    if (!el('panel')) return;
    el('run').addEventListener('click', run);
    el('week').addEventListener('change', function() { state.shown = el('week').value; render(); });
    render();
  });
})(typeof window !== 'undefined' ? window : globalThis);
