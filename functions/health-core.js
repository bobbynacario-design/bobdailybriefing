(function(root) {
  'use strict';
  // Apple Health, sent by an iOS Shortcut, as one row of numbers per day.
  //
  // The Shortcut does as little as it can: for each kind of reading it sends
  // one text line per Health sample, "metric|start|end|value|unit", with the
  // dates in ISO 8601. Everything that needs care is done here, where it is
  // tested: summing steps per day, merging overlapping sleep records into one
  // night, putting that night on the day he woke up, using the time zone each
  // reading carries (so a trip abroad lands on the right local day), and
  // turning away numbers no body produces.
  //
  // Each send covers the last few days, so the first of those days is usually
  // cut short by the window. Steps and distance only grow within a day, and a
  // night only gets longer as its records sync, so the larger reading of a day
  // is kept. Weight and resting heart rate are taken as sent.
  //
  // Pure: the server passes in the stored document and the request body and
  // writes back what comes out. The app uses the same file to show the rows.
  var KEEP_DAYS = 400, BACK_DAYS = 14, MAX_LINES = 3000, MAX_LINE = 300;
  var NIGHT_GAP_MIN = 180, MIN_NIGHT_MIN = 90, MAX_NIGHT_MIN = 960;
  var MANILA_MIN = 480;
  var FIELDS = ['steps', 'distanceKm', 'sleepMin', 'weightKg', 'restingHr'];
  var LIMITS = {steps: [0, 100000], distanceKm: [0, 150], weightKg: [30, 250], restingHr: [30, 130]};
  // Health's own names as the Shortcut may write them, reduced to letters.
  var METRICS = {steps: 'steps', step: 'steps', stepcount: 'steps',
    distance: 'distance', walkingrunningdistance: 'distance', walkingandrunningdistance: 'distance',
    sleep: 'sleep', sleepanalysis: 'sleep',
    weight: 'weight', bodymass: 'weight', bodyweight: 'weight', weightbodymass: 'weight',
    restinghr: 'restingHr', restingheartrate: 'restingHr'};
  var DAY_NAMES = 'Sun Mon Tue Wed Thu Fri Sat'.split(' ');
  var MONTH_NAMES = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isDay(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
  // The local calendar day at an offset (minutes east of UTC).
  function localDay(ms, off) {
    var d = new Date(ms + off * 60000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function localTime(ms, off) {
    var d = new Date(ms + off * 60000);
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }
  function today(nowMs) { return localDay(nowMs == null ? Date.now() : nowMs, MANILA_MIN); }
  function offsetDay(day, n) {
    var d = new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  // "Thu 15 Oct".
  function dayLabel(day) {
    if (!isDay(day)) return '';
    var d = new Date(Date.parse(day + 'T00:00:00Z'));
    return DAY_NAMES[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTH_NAMES[d.getUTCMonth()];
  }

  // An ISO 8601 date and time as {ms, off}. A date with no offset is read as
  // Manila time; one in UTC (Z) is shown on Manila's day, since it says
  // nothing about where he was. Anything else (a date written out in words,
  // which is what the Shortcut sends if its date format is left alone) is null.
  function parseWhen(text) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(String(text || '').trim());
    if (!m) return null;
    var off = MANILA_MIN, zone = m[7];
    if (zone && /z/i.test(zone)) off = 0;
    else if (zone) {
      var z = zone.replace(':', '');
      off = (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)));
      if (Math.abs(off) > 14 * 60) return null;
    }
    var wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (isNaN(wall) || +m[2] > 12 || +m[3] > 31 || +m[4] > 23 || +m[5] > 59) return null;
    var ms = wall - off * 60000;
    // A UTC time says nothing about where he was, so show it on Manila's day.
    return {ms: ms, off: zone && /z/i.test(zone) ? MANILA_MIN : off};
  }
  // "6,210", "72.4 kg", "6210 count" → a number. Commas are thousands
  // separators here: the Shortcut writes numbers the way the phone's region
  // does, and his regions (Philippines, Australia) use a full stop for decimals.
  function parseNumber(text) {
    var m = /^\s*(-?[\d,\s]*\.?\d+)/.exec(String(text || ''));
    if (!m) return null;
    var n = Number(m[1].replace(/[,\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  function metricOf(text) { return METRICS[String(text || '').toLowerCase().replace(/[^a-z]/g, '')] || ''; }
  function sleepKind(value) {
    var v = String(value == null ? '' : value).toLowerCase().trim();
    // Health's own codes: 0 in bed, 1 asleep, 2 awake, 3 core, 4 deep, 5 REM.
    if (/^\d$/.test(v)) return v === '0' ? 'inBed' : v === '2' ? '' : Number(v) <= 5 ? 'asleep' : '';
    if (/awake/.test(v)) return '';
    if (/in\s*bed/.test(v)) return 'inBed';
    return /asleep|core|deep|rem|unspecified/.test(v) ? 'asleep' : '';
  }

  // Health Auto Export (an App Store app) posts {data: {metrics: [{name,
  // units, data: [...]}]}} instead of the Shortcut's lines. Each reading
  // becomes the line the Shortcut would have written, so everything after
  // this is shared. Its dates read "2026-10-19 14:30:00 +0800", or with
  // AM/PM on a phone set to a 12-hour clock.
  function fromApp(body) {
    return !!(body && typeof body === 'object' && body.data && typeof body.data === 'object' && Array.isArray(body.data.metrics));
  }
  function appWhen(text) {
    var m = /^(\d{4}-\d{2}-\d{2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(String(text || '').trim()) ||
      /^(\d{4}-\d{2}-\d{2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?()\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(String(text || '').trim());
    if (!m) return null;
    var h = Number(m[2]);
    if (m[5]) h = h % 12 + (/p/i.test(m[5]) ? 12 : 0);
    return parseWhen(m[1] + 'T' + pad(h) + ':' + m[3] + ':' + (m[4] || '00') + (m[6] || ''));
  }
  // {ms, off} → "2026-10-19T14:30:00+08:00", which parseWhen reads back.
  function isoAt(ms, off) {
    var d = new Date(ms + off * 60000), a = Math.abs(off);
    return localDay(ms, off) + 'T' + localTime(ms, off) + ':' + pad(d.getUTCSeconds()) + (off < 0 ? '-' : '+') + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
  }
  function hoursOf(v) { var n = parseNumber(v); return n != null && n > 0 ? n : 0; }
  function appLines(data) {
    var lines = [], word = {steps: 'steps', distance: 'distance', weight: 'weight', restingHr: 'restingHr'};
    var field = function(v) { return String(v == null ? '' : v).replace(/[|\r\n]/g, ' ').trim(); };
    data.metrics.forEach(function(m) {
      var metric = metricOf(m && m.name), points = m && Array.isArray(m.data) ? m.data.slice(0, MAX_LINES) : [];
      if (!metric) return; // a metric Daybook does not keep: not a fault
      if (metric === 'sleep') {
        points.forEach(function(p) {
          if (!p || typeof p !== 'object') return;
          var src = field(p.source || p.inBedSource || p.sleepSource);
          // One segment as recorded (Summarize Data off).
          if (p.startDate && p.endDate && p.value != null) {
            var s = appWhen(p.startDate), e = appWhen(p.endDate);
            lines.push(s && e ? ['sleep', isoAt(s.ms, s.off), isoAt(e.ms, e.off), field(p.value), '', src].join('|') : 'sleep|' + field(p.startDate) + '|' + field(p.endDate) + '|' + field(p.value));
            return;
          }
          // A night summed up: hours in bed and asleep, each ending at its own
          // end time and never starting before its start time.
          var add = function(hours, from, to, kind) {
            if (!hours) return;
            var a = appWhen(from), b = appWhen(to);
            if (!b) { lines.push('sleep|' + field(from) + '|' + field(to) + '|' + kind); return; }
            var start = Math.max(b.ms - hours * 3600000, a ? a.ms : -Infinity);
            lines.push(['sleep', isoAt(start, a ? a.off : b.off), isoAt(b.ms, b.off), kind, '', src].join('|'));
          };
          add(hoursOf(p.inBed), p.inBedStart, p.inBedEnd, 'In Bed');
          var asleep = hoursOf(p.totalSleep) || hoursOf(p.asleep) || hoursOf(p.core) + hoursOf(p.deep) + hoursOf(p.rem);
          add(asleep, p.sleepStart, p.sleepEnd, 'Asleep');
        });
        return;
      }
      var read = points.map(function(p) {
        return p && typeof p === 'object' ? {p: p, start: appWhen(p.date || p.startDate), end: p.endDate ? appWhen(p.endDate) : null} : null;
      }).filter(Boolean);
      // Time Grouping by day: one reading per local day, each at midnight.
      // Each is that day's whole total, so it spans the day, as the
      // Shortcut's Group By Day readings do.
      var days = {}, daily = (metric === 'steps' || metric === 'distance') && read.length > 0 && read.every(function(r) {
        if (!r.start || r.end || localTime(r.start.ms, r.start.off) !== '00:00') return false;
        var day = localDay(r.start.ms, r.start.off);
        return days[day] ? false : (days[day] = true);
      });
      read.forEach(function(r) {
        var p = r.p, src = field(p.source), end = r.end;
        if (!r.start) { lines.push(word[metric] + '|' + field(p.date || p.startDate) + '||' + field(p.qty)); return; }
        if (daily) end = parseWhen(offsetDay(localDay(r.start.ms, r.start.off), 1) + 'T00:00:00' + isoAt(r.start.ms, r.start.off).slice(19));
        end = end || r.start;
        lines.push([word[metric], isoAt(r.start.ms, r.start.off), isoAt(end.ms, end.off), field(p.qty), field(m.units), src].join('|'));
      });
    });
    return lines;
  }

  // Request body → the lines it carries. The Shortcut sends {lines: "…"}
  // (its Combine Text output) or {lines: [...]} (a list); a bare string works too.
  function linesOf(body) {
    if (fromApp(body)) return appLines(body.data);
    var raw = body && typeof body === 'object' && !Array.isArray(body) ? body.lines : body;
    if (Array.isArray(raw)) raw = raw.map(function(v) { return String(v == null ? '' : v); }).join('\n');
    return String(raw == null ? '' : raw).split(/\r?\n/).map(function(l) { return l.trim(); }).filter(Boolean);
  }

  // Lines → {samples, rejected, problems}. problems names the kinds of fault
  // seen (format, dates, metric, value), so the reply can say what to fix.
  function parseLines(lines) {
    var samples = [], seen = {}, rejected = 0, problems = {};
    var bad = function(kind) { rejected++; problems[kind] = (problems[kind] || 0) + 1; };
    (lines || []).slice(0, MAX_LINES).forEach(function(line) {
      if (line.length > MAX_LINE) { bad('value'); return; }
      var f = line.split('|').map(function(s) { return s.trim(); });
      if (f.length < 4) { bad('format'); return; }
      var metric = metricOf(f[0]);
      if (!metric) { bad('metric'); return; }
      var start = parseWhen(f[1]), end = f[2] ? parseWhen(f[2]) : start;
      if (!start || !end) { bad('dates'); return; }
      if (end.ms < start.ms) { var t = start; start = end; end = t; }
      var unit = String(f[4] || '').toLowerCase() || String(f[3] || '').replace(/^[\s\d,.\-]+/, '').toLowerCase();
      var s = {metric: metric, start: start.ms, end: end.ms, startOff: start.off, endOff: end.off, source: String(f[5] || '').toLowerCase().slice(0, 60)};
      if (metric === 'sleep') {
        s.kind = sleepKind(f[3]);
        if (!s.kind) return; // awake, or a stage it does not count: not a fault
      } else {
        var n = parseNumber(f[3]);
        if (n == null || n < 0) { bad('value'); return; }
        if (metric === 'distance') n = /^mi/.test(unit) ? n * 1.609344 : /^(m|meter|metre)s?$/.test(unit) ? n / 1000 : n;
        if (metric === 'weight' && /^(lb|lbs|pound)/.test(unit)) n = n * 0.45359237;
        s.value = n;
      }
      var key = [metric, s.start, s.end, s.kind || s.value].join('|');
      if (seen[key]) return;
      seen[key] = true;
      samples.push(s);
    });
    rejected += Math.max(0, (lines || []).length - MAX_LINES);
    return {samples: samples, rejected: rejected, problems: problems};
  }

  // The nights in a set of sleep samples: records less than three hours apart
  // are one night. A night counts its time asleep when the phone recorded any
  // (a sleep tracking app can), otherwise its time in bed, which is what an
  // iPhone on its own records from the sleep schedule. Overlaps count once.
  function nights(samples) {
    var list = samples.filter(function(s) { return s.metric === 'sleep'; }).sort(function(a, b) { return a.start - b.start; });
    var groups = [], cur = null;
    list.forEach(function(s) {
      if (cur && s.start - cur.end <= NIGHT_GAP_MIN * 60000) {
        cur.items.push(s);
        if (s.end > cur.end) { cur.end = s.end; cur.endOff = s.endOff; }
      } else {
        cur = {start: s.start, startOff: s.startOff, end: s.end, endOff: s.endOff, items: [s]};
        groups.push(cur);
      }
    });
    return groups.map(function(g) {
      var asleep = g.items.filter(function(s) { return s.kind === 'asleep'; });
      var use = asleep.length ? asleep : g.items, total = 0, upTo = -Infinity;
      use.forEach(function(s) {
        var from = Math.max(s.start, upTo);
        if (s.end > from) total += s.end - from;
        if (s.end > upTo) upTo = s.end;
      });
      return {day: localDay(g.end, g.endOff), sleepMin: Math.round(total / 60000), sleepKind: asleep.length ? 'asleep' : 'inBed',
        bed: localTime(g.start, g.startOff), wake: localTime(g.end, g.endOff)};
    }).filter(function(n) { return n.sleepMin >= MIN_NIGHT_MIN && n.sleepMin <= MAX_NIGHT_MIN; });
  }

  // Steps or distance per local day. Two sources (the iPhone and an app)
  // can record the same walk, so readings that overlap in time are one
  // cluster, and a cluster counts its largest source's total, not the sum,
  // which is close to how Health itself picks one source per moment. Without
  // a source field each reading is its own source. A single reading from
  // local midnight to midnight (Health's own daily total, Group By Day) marks
  // the day whole: {day: {value, whole}}.
  function cumulative(samples, metric) {
    var list = samples.filter(function(s) { return s.metric === metric; }).sort(function(a, b) { return a.start - b.start || b.end - a.end; });
    var clusters = [], cur = null;
    list.forEach(function(s, i) {
      if (cur && s.start < cur.end) { cur.items.push(s); if (s.end > cur.end) cur.end = s.end; }
      else { cur = {start: s.start, off: s.startOff, end: s.end, items: [s]}; clusters.push(cur); }
      s._key = s.source || 'reading-' + i;
    });
    var out = {};
    clusters.forEach(function(c) {
      var bySource = {}, best = 0;
      c.items.forEach(function(s) { bySource[s._key] = (bySource[s._key] || 0) + s.value; });
      Object.keys(bySource).forEach(function(k) { if (bySource[k] > best) best = bySource[k]; });
      var day = localDay(c.start, c.off), d = out[day] || (out[day] = {value: 0, whole: false});
      d.value += best;
      if (c.items.length === 1 && localTime(c.start, c.off) === '00:00' && c.end - c.start >= 23 * 3600000) d.whole = true;
    });
    return out;
  }

  // Samples → {day: {steps, distanceKm, sleepMin, sleepKind, bed, wake, weightKg, restingHr}}.
  function summarize(samples) {
    var days = {}, hr = {};
    var row = function(day) { return days[day] || (days[day] = {}); };
    var steps = cumulative(samples, 'steps'), distance = cumulative(samples, 'distance');
    Object.keys(steps).forEach(function(day) { row(day).steps = steps[day].value; if (steps[day].whole) row(day)._stepsWhole = true; });
    Object.keys(distance).forEach(function(day) { row(day).distanceKm = distance[day].value; if (distance[day].whole) row(day)._distanceWhole = true; });
    samples.forEach(function(s) {
      var day = localDay(s.start, s.startOff);
      if (s.metric === 'weight') {
        var r = row(day);
        if (r._weightAt == null || s.start >= r._weightAt) { r.weightKg = s.value; r._weightAt = s.start; }
      } else if (s.metric === 'restingHr') (hr[day] || (hr[day] = [])).push(s.value);
    });
    Object.keys(hr).forEach(function(day) {
      row(day).restingHr = hr[day].reduce(function(a, b) { return a + b; }, 0) / hr[day].length;
    });
    nights(samples).forEach(function(n) {
      var r = row(n.day);
      if (!r.sleepMin || n.sleepMin > r.sleepMin) { r.sleepMin = n.sleepMin; r.sleepKind = n.sleepKind; r.bed = n.bed; r.wake = n.wake; }
    });
    Object.keys(days).forEach(function(day) {
      var r = days[day];
      delete r._weightAt;
      if (r.steps != null) r.steps = Math.round(r.steps);
      if (r.distanceKm != null) r.distanceKm = Math.round(r.distanceKm * 100) / 100;
      if (r.weightKg != null) r.weightKg = Math.round(r.weightKg * 10) / 10;
      if (r.restingHr != null) r.restingHr = Math.round(r.restingHr);
      Object.keys(LIMITS).forEach(function(f) {
        if (r[f] != null && (r[f] < LIMITS[f][0] || r[f] > LIMITS[f][1])) { delete r[f]; r._outOfRange = true; }
      });
    });
    return days;
  }

  // A day's stored row, cleaned (the app reads the document as it is).
  function cleanRow(r) {
    var out = {};
    if (!r || typeof r !== 'object') return out;
    FIELDS.forEach(function(f) { if (typeof r[f] === 'number' && isFinite(r[f])) out[f] = r[f]; });
    if (out.sleepMin != null) {
      out.sleepKind = r.sleepKind === 'asleep' ? 'asleep' : 'inBed';
      if (/^\d{2}:\d{2}$/.test(r.bed || '')) out.bed = r.bed;
      if (/^\d{2}:\d{2}$/.test(r.wake || '')) out.wake = r.wake;
    }
    if (typeof r.at === 'string') out.at = r.at;
    return out;
  }

  // The stored days with one send merged in. Steps and distance only rise,
  // unless the send carries Health's whole-day total for that day. Only days from two weeks back to
  // tomorrow are taken (a phone with a wrong clock cannot write next year);
  // the newest KEEP_DAYS are kept.
  function mergeDays(stored, incoming, nowMs) {
    var out = {}, changed = {}, t = today(nowMs), from = offsetDay(t, -BACK_DAYS), to = offsetDay(t, 1), at = new Date(nowMs).toISOString();
    Object.keys(stored || {}).forEach(function(day) { if (isDay(day)) out[day] = cleanRow(stored[day]); });
    Object.keys(incoming || {}).forEach(function(day) {
      if (!isDay(day) || day < from || day > to) return;
      var old = out[day] || {}, add = incoming[day], next = Object.assign({}, old), fields = [];
      // A whole-day total from Health replaces what is stored, so a lower,
      // corrected count lands; a partial reading only ever raises it.
      ['steps', 'distanceKm'].forEach(function(f) {
        var whole = add[f === 'steps' ? '_stepsWhole' : '_distanceWhole'];
        if (add[f] != null && (old[f] == null || add[f] > old[f] || (whole && add[f] !== old[f]))) { next[f] = add[f]; fields.push(f); }
      });
      if (add.sleepMin != null && (old.sleepMin == null || add.sleepMin > old.sleepMin)) {
        next.sleepMin = add.sleepMin; next.sleepKind = add.sleepKind; next.bed = add.bed; next.wake = add.wake; fields.push('sleepMin');
      }
      ['weightKg', 'restingHr'].forEach(function(f) {
        if (add[f] != null && add[f] !== old[f]) { next[f] = add[f]; fields.push(f); }
      });
      if (fields.length) { next.at = at; out[day] = next; changed[day] = fields; }
    });
    var keep = Object.keys(out).sort().slice(-KEEP_DAYS), kept = {};
    keep.forEach(function(day) { kept[day] = out[day]; });
    return {days: kept, changed: changed};
  }

  function sleepText(min) {
    if (min == null) return '';
    return Math.floor(min / 60) + 'h' + pad(min % 60);
  }
  function stepsText(n) { return Math.round(n).toLocaleString('en-AU') + ' steps'; }

  // What the Shortcut shows him after a send: the newest steps and night it
  // has, or what to fix when nothing could be used.
  function receiptMessage(r) {
    if (r.via === 'app' && !r.used) return r.lines
      ? 'Daybook got ' + r.lines + ' readings from Health Auto Export but none it could use. Check Time Grouping is Day and the iPhone has steps or sleep for these days.'
      : 'Daybook got a send from Health Auto Export with no steps, distance or sleep in it. In the automation, Select Health Metrics: Step Count, Walking + Running Distance and Sleep Analysis.';
    if (!r.lines) return 'Daybook got an empty send. Check the Shortcut adds its lines to the Text it sends.';
    if (!r.used) {
      var p = r.problems || {};
      if (p.dates) return 'Daybook could not read the dates. In the Shortcut, set each date to ISO 8601 with time (About you → Apple Health, step 3).';
      if (p.format) return 'Daybook could not read the lines. Each must be: kind|start|end|value|unit, joined with | (About you → Apple Health).';
      if (p.metric) return 'Daybook did not recognise the readings. Each line must start with steps, distance, sleep or weight.';
      return 'Daybook got ' + r.lines + ' lines but none it could use.';
    }
    var bits = [];
    if (r.latestSteps) bits.push(stepsText(r.latestSteps.steps) + ' ' + (r.latestSteps.day === r.today ? 'today' : dayLabel(r.latestSteps.day)));
    if (r.latestSleep) bits.push(sleepText(r.latestSleep.sleepMin) + (r.latestSleep.sleepKind === 'asleep' ? ' asleep' : ' in bed') +
      (r.latestSleep.day === r.today ? ' last night' : ' to ' + dayLabel(r.latestSleep.day)));
    if (r.latestWeight) bits.push(r.latestWeight.weightKg + ' kg');
    var head = 'Daybook got: ' + (bits.length ? bits.join(' · ') : r.days.length + ' days');
    return head + (r.changedDays ? '' : ' (no change)') + (r.rejected ? '. ' + r.rejected + (r.via === 'app' ? ' readings' : ' lines') + ' skipped.' : '.');
  }

  // One send: the stored document and the request body in, the document to
  // write and the reply out.
  function ingest(stored, body, nowMs) {
    stored = stored || {};
    var via = fromApp(body) ? 'app' : 'shortcut', lines = linesOf(body), parsed = parseLines(lines), summary = summarize(parsed.samples);
    var outOfRange = 0, sent = Object.keys(summary).sort();
    Object.keys(summary).forEach(function(d) { if (summary[d]._outOfRange) { outOfRange++; delete summary[d]._outOfRange; } });
    // "The last 3 days" starts part-way through its first day, and Health may
    // still label that bucket from midnight: never let it lower a stored day.
    if (sent.length > 1) { delete summary[sent[0]]._stepsWhole; delete summary[sent[0]]._distanceWhole; }
    var merged = mergeDays(stored.days, summary, nowMs), t = today(nowMs);
    var used = Object.keys(summary).filter(function(d) { return FIELDS.some(function(f) { return summary[d][f] != null; }); }).sort();
    var latest = function(f) {
      var d = used.filter(function(day) { return summary[day][f] != null; }).pop();
      return d ? Object.assign({day: d}, summary[d]) : null;
    };
    var fields = FIELDS.filter(function(f) { return used.some(function(d) { return summary[d][f] != null; }); });
    var receipt = {at: new Date(nowMs).toISOString(), today: t, via: via, lines: lines.length, samples: parsed.samples.length, used: used.length,
      rejected: parsed.rejected + outOfRange, problems: parsed.problems, days: used, fields: fields,
      changedDays: Object.keys(merged.changed).length,
      latestSteps: latest('steps'), latestSleep: latest('sleepMin'), latestWeight: latest('weightKg')};
    receipt.message = receiptMessage(receipt);
    var last = {at: receipt.at, via: via, lines: receipt.lines, used: receipt.used, rejected: receipt.rejected, fields: fields,
      days: used, changedDays: receipt.changedDays, message: receipt.message};
    var doc = {kind: 'health', source: 'apple-health', days: merged.days, lastReceived: last, updatedAt: receipt.at};
    if (receipt.used) doc.lastUsedAt = receipt.at;
    return {doc: doc, receipt: receipt};
  }

  // The newest n days, newest first, for the table on About you.
  function recentRows(days, todayKey, n) {
    var out = [], d = todayKey || today();
    for (var i = 0; i < (n || 14); i++) {
      var key = offsetDay(d, -i), r = cleanRow(days && days[key]);
      out.push(Object.assign({day: key, label: dayLabel(key), empty: !FIELDS.some(function(f) { return r[f] != null; })}, r));
    }
    return out;
  }

  // ---- Lane 2: what the numbers do ------------------------------------------
  // A day's steps are final once a send arrived after it ended (Manila day),
  // so a day before the last send's day is complete; a night is known once
  // its wake-up day has a sleep row.
  function completeBefore(doc) {
    var at = doc && doc.lastReceived && Date.parse(doc.lastReceived.at);
    return isFinite(at) ? today(at) : '';
  }
  // Minutes after 18:00, so 00:30 counts as later than 23:30.
  function eveningMin(hm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
    if (!m) return null;
    var min = Number(m[1]) * 60 + Number(m[2]);
    return (min - 18 * 60 + 1440) % 1440;
  }
  // A commitment Apple Health can check, from its words or its "How you'll
  // know": "8,000 steps", "8k steps", "3 km", "in bed by 11:30 pm", "7 hours
  // in bed". "Walk 30 minutes" is not one: an iPhone alone does not record
  // exercise minutes, and a guess would tick days he did not earn.
  function targetOf(text) {
    var t = String(text || '').toLowerCase(), m;
    if ((m = /(\d[\d,]*(?:\.\d+)?)\s*(k\b)?\s*steps?\b/.exec(t))) {
      var n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
      if (n >= 1000 && n <= 50000) return {kind: 'steps', value: n, label: Math.round(n).toLocaleString('en-AU') + ' steps'};
    }
    if ((m = /(\d+(?:\.\d+)?)\s*(?:km|kilomet(?:er|re)s?)\b/.exec(t))) {
      var km = Number(m[1]);
      if (km > 0 && km <= 60) return {kind: 'km', value: km, label: km + ' km walked'};
    }
    // "in bed" goals are met by time in bed; "sleep" or "asleep" goals only by
    // recorded sleep (an Apple Watch or a sleep app), never by time in bed.
    if ((m = /\b(in bed|bed|asleep|sleep)\s+by\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(t))) {
      var h = Number(m[2]) % 12 + (m[4] === 'pm' || (!m[4] && Number(m[2]) >= 7 && Number(m[2]) <= 11) ? 12 : 0);
      if (!m[4] && Number(m[2]) === 12) h = 0;
      var hm = pad(h % 24) + ':' + (m[3] || '00'), asleepBy = /sleep/.test(m[1]);
      return {kind: 'bedBy', value: hm, basis: asleepBy ? 'asleep' : 'inBed', label: (asleepBy ? 'asleep by ' : 'in bed by ') + hm};
    }
    if ((m = /(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)\s*(?:of\s+)?(sleep|in bed|asleep)/.exec(t))) {
      var hours = Number(m[1]), inBed = m[2] === 'in bed';
      if (hours >= 4 && hours <= 12) return {kind: 'sleepHours', value: hours, basis: inBed ? 'inBed' : 'asleep', label: hours + (inBed ? ' h in bed' : ' h asleep')};
    }
    return null;
  }
  // Whether a day met a target, or null when the data is not in yet. Sleep
  // goals count for the evening he went to bed: the night on the next day's row.
  function metOn(days, day, target, complete) {
    if (target.kind === 'steps' || target.kind === 'km') {
      if (!complete || day >= complete) return null;
      var r = cleanRow(days && days[day]), v = target.kind === 'steps' ? r.steps : r.distanceKm;
      return v == null ? null : v >= target.value;
    }
    var night = cleanRow(days && days[offsetDay(day, 1)]);
    if (night.sleepMin == null) return null;
    // A sleep goal cannot be judged from time in bed.
    if (target.basis === 'asleep' && night.sleepKind !== 'asleep') return null;
    if (target.kind === 'sleepHours') return night.sleepMin >= target.value * 60;
    var bed = eveningMin(night.bed), by = eveningMin(target.value);
    return bed == null || by == null ? null : bed <= by;
  }
  // Ticks his commitments this week and last from the health days. A tick is
  // only ever added, never taken away; the days it adds are kept in `auto` so
  // the card can say where they came from, and a day he unticked himself
  // (`autoOff`) is never ticked again. W is the weekly review core; weeks are
  // the review doc's weeks. Returns {weeks, added: [{id, text, day}]}.
  function autoTicks(W, weeks, doc, nowMs) {
    var out = W.cleanWeeks(weeks || {}), added = [], d = W.today(nowMs), complete = completeBefore(doc), days = doc && doc.days;
    [W.offset(W.weekStart(d), -7), W.weekStart(d)].forEach(function(start) {
      var week = out[start];
      if (!week) return;
      week.commitments.forEach(function(c) {
        var target = targetOf(c.text + ' ' + (c.measure || ''));
        if (!target) return;
        W.weekDays(start).filter(function(x) { return x <= d; }).forEach(function(x) {
          if (c.ticks.indexOf(x) >= 0 || (c.autoOff || []).indexOf(x) >= 0) return;
          if (metOn(days, x, target, complete) !== true) return;
          c.ticks = c.ticks.concat(x).sort();
          c.auto = (c.auto || []).concat(x).sort();
          added.push({id: c.id, text: c.text, day: x});
        });
      });
    });
    return {weeks: out, added: added};
  }
  function ticksMessage(added) {
    if (!added || !added.length) return '';
    var byText = {};
    added.forEach(function(a) { (byText[a.text] = byText[a.text] || []).push(dayLabel(a.day).split(' ')[0]); });
    return ' Ticked from Apple Health: ' + Object.keys(byText).map(function(t) { return '“' + t + '” (' + byText[t].join(', ') + ')'; }).join('; ') + '.';
  }

  function median(list) {
    var s = list.slice().sort(function(a, b) { return a - b; }), n = s.length;
    return !n ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  var SHORT_NIGHT_MIN = 360;
  // One line about his body for Today and the morning push, from his own
  // numbers only. {text, notable, stale}: notable when the last full day's
  // steps were well under or over his usual (the median of his last 14 full
  // days, once there are 5), or when the latest night was short (under 6 h in
  // bed, which overstates sleep) and it is the second or more in 7 nights.
  // The push carries it only when notable; Today always shows it. Numbers
  // older than three days are not a line at all, only `stale`.
  function bodyLine(doc, nowMs) {
    var days = (doc && doc.days) || {}, t = today(nowMs), complete = completeBefore(doc);
    if (!complete || complete < offsetDay(t, -3)) return {text: '', notable: false, stale: !!complete, since: complete};
    var bits = [], notable = false, lastFull = offsetDay(complete, -1), row = cleanRow(days[lastFull]);
    if (row.steps != null) {
      var past = [];
      for (var i = 1; i <= 14; i++) { var r = cleanRow(days[offsetDay(lastFull, -i)]); if (r.steps != null) past.push(r.steps); }
      var usual = past.length >= 5 ? median(past) : null, s = Math.round(row.steps).toLocaleString('en-AU') + ' steps ' + (lastFull === offsetDay(t, -1) ? 'yesterday' : dayLabel(lastFull).split(' ')[0]);
      if (usual && (row.steps < usual * 0.6 || row.steps > usual * 1.4)) {
        notable = true;
        s += ' (' + (row.steps < usual ? 'well under' : 'well over') + ' your usual ' + (Math.round(usual / 100) * 100).toLocaleString('en-AU') + ')';
      }
      bits.push(s);
    }
    var nightDay = [t, offsetDay(t, -1)].filter(function(x) { return cleanRow(days[x]).sleepMin != null; })[0];
    if (nightDay) {
      var n = cleanRow(days[nightDay]), short = n.sleepMin < SHORT_NIGHT_MIN;
      var count = 0;
      for (var j = 0; j < 7; j++) { var k = cleanRow(days[offsetDay(nightDay, -j)]); if (k.sleepMin != null && k.sleepMin < SHORT_NIGHT_MIN) count++; }
      var ord = ['', '', '2nd', '3rd'][count] || count + 'th';
      var night = sleepText(n.sleepMin) + (n.sleepKind === 'asleep' ? ' asleep ' : ' in bed ') + (nightDay === t ? 'last night' : 'the night before');
      if (short && count >= 2) { notable = true; night += ' (' + ord + ' short night in 7)'; }
      bits.push(night);
    }
    return {text: bits.length ? 'Body: ' + bits.join(' · ') : '', notable: notable && !!bits.length, stale: false, since: complete};
  }

  root.HealthCore = {KEEP_DAYS: KEEP_DAYS, BACK_DAYS: BACK_DAYS, MAX_LINES: MAX_LINES, FIELDS: FIELDS, LIMITS: LIMITS,
    today: today, offsetDay: offsetDay, dayLabel: dayLabel, parseWhen: parseWhen, parseNumber: parseNumber, metricOf: metricOf,
    linesOf: linesOf, fromApp: fromApp, appLines: appLines, parseLines: parseLines, nights: nights, summarize: summarize, cleanRow: cleanRow, mergeDays: mergeDays,
    sleepText: sleepText, receiptMessage: receiptMessage, ingest: ingest, recentRows: recentRows,
    completeBefore: completeBefore, targetOf: targetOf, metOn: metOn, autoTicks: autoTicks, ticksMessage: ticksMessage, bodyLine: bodyLine};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HealthCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
