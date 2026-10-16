(function(root) {
  'use strict';
  // One-tap lifestyle questions for the morning check-in (lane 5): no
  // logging, no calorie counts. After the commitment question (or when there
  // is none), the check-in asks one of these about yesterday, a different one
  // each day, and the answers become a weekly tally in the Sunday review and,
  // later, something to set against his sleep and steps. Pure.
  var QUESTIONS = [
    {id: 'alcohol', q: 'How many drinks did you have yesterday?', options: [['0', 'None'], ['1-2', '1–2'], ['3+', '3 or more']], noun: 'Drinks'},
    {id: 'lateMeal', q: 'Did you eat within two hours of bed last night?', options: [['no', 'No'], ['yes', 'Yes']], noun: 'Late meal'},
    {id: 'protein', q: 'Did breakfast yesterday include protein (eggs, meat, fish, tofu, milk)?', options: [['yes', 'Yes'], ['no', 'No']], noun: 'Protein at breakfast'},
    {id: 'outdoors', q: 'Were you outside in daylight for 20 minutes or more yesterday?', options: [['yes', 'Yes'], ['no', 'No']], noun: 'Daylight 20 min+'},
    {id: 'energy', q: 'How was your energy yesterday?', options: [['low', 'Low'], ['ok', 'OK'], ['high', 'High']], noun: 'Energy'}
  ];
  var KEEP_DAYS = 400;
  function isDay(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
  function offset(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
  function find(id) { for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i].id === id) return QUESTIONS[i]; return null; }
  function valid(id, v) { var q = find(id); return !!q && q.options.some(function(o) { return o[0] === v; }); }

  // lifestyle-<uid>.days as stored: {YYYY-MM-DD (the day asked about): {question: answer}}.
  function cleanDays(raw) {
    var out = {};
    Object.keys(raw || {}).filter(isDay).sort().slice(-KEEP_DAYS).forEach(function(day) {
      var row = {};
      Object.keys(raw[day] || {}).forEach(function(id) { if (valid(id, raw[day][id])) row[id] = raw[day][id]; });
      if (Object.keys(row).length) out[day] = row;
    });
    return out;
  }
  // Today's question, about yesterday: the rotation's pick for the day, or
  // the next one along if that was already answered for yesterday. One a
  // day: once today's is answered (doc.askedOn is today) or put off on this
  // device (skipped), nothing more.
  function pick(doc, todayKey, skipped) {
    doc = doc || {};
    if (!isDay(todayKey) || skipped || doc.askedOn === todayKey) return null;
    var about = offset(todayKey, -1), have = cleanDays(doc.days)[about] || {};
    var n = Math.round(Date.parse(todayKey + 'T00:00:00Z') / 86400000), start = n % QUESTIONS.length;
    for (var i = 0; i < QUESTIONS.length; i++) {
      var q = QUESTIONS[(start + i) % QUESTIONS.length];
      if (!have[q.id]) return {id: q.id, q: q.q, options: q.options, day: about};
    }
    return null;
  }
  // The answers for a week, one line per question with any answers:
  // "Drinks: None on 3 days, 1–2 on 1, 3 or more on 1".
  function weekFacts(raw, start) {
    var days = cleanDays(raw), out = [];
    QUESTIONS.forEach(function(q) {
      var counts = {}, total = 0;
      for (var i = 0; i < 7; i++) { var v = (days[offset(start, i)] || {})[q.id]; if (v) { counts[v] = (counts[v] || 0) + 1; total++; } }
      if (!total) return;
      var parts = q.options.filter(function(o) { return counts[o[0]]; }).map(function(o, j) { return o[1] + ' on ' + counts[o[0]] + (j === 0 ? (counts[o[0]] === 1 ? ' day' : ' days') : ''); });
      out.push({id: q.id, text: q.noun + ': ' + parts.join(', ')});
    });
    return out;
  }
  root.LifestyleCore = {QUESTIONS: QUESTIONS, KEEP_DAYS: KEEP_DAYS, cleanDays: cleanDays, valid: valid, pick: pick, weekFacts: weekFacts};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LifestyleCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
