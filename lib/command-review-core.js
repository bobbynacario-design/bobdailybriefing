(function (root) {
  'use strict';

  var VALID_STATES = ['pending', 'acted', 'reviewed', 'ignored'];
  var MAX_DAYS = 35;
  var MAX_ITEMS_PER_DAY = 20;

  function arr(value) { return Array.isArray(value) ? value : []; }
  function text(value, limit) {
    var result = String(value == null ? '' : value).trim();
    return limit && result.length > limit ? result.slice(0, limit) : result;
  }
  function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }
  function validState(value) { return VALID_STATES.indexOf(value) >= 0 ? value : 'pending'; }
  function iso(value) {
    if (!value) return '';
    var parsed = new Date(value);
    return isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }
  function dateOffset(date, days) {
    var parsed = new Date(date + 'T00:00:00Z');
    if (isNaN(parsed.getTime())) return '';
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().slice(0, 10);
  }
  function normalizeItem(raw) {
    raw = raw || {};
    var id = text(raw.id, 180);
    if (!id) return null;
    var score = Number(raw.score);
    var rank = Number(raw.rank);
    return {
      id: id,
      source: text(raw.source, 40) || 'Unknown',
      title: text(raw.title, 140) || 'Untitled item',
      page: text(raw.page, 40),
      urgency: text(raw.urgency, 20),
      score: Number.isFinite(score) ? Math.round(score) : 0,
      morningFive: !!raw.morningFive,
      rank: Number.isFinite(rank) && rank > 0 ? Math.min(5, Math.round(rank)) : 0,
      state: validState(raw.state),
      handledAt: iso(raw.handledAt)
    };
  }

  function normalizeReview(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var inputDays = raw.days && typeof raw.days === 'object' ? raw.days : {};
    var keys = Object.keys(inputDays).filter(validDate).sort().slice(-MAX_DAYS);
    var days = {};
    keys.forEach(function (key) {
      var source = inputDays[key] || {};
      var seen = {};
      var items = [];
      arr(source.items).forEach(function (candidate) {
        var item = normalizeItem(candidate);
        if (!item || seen[item.id] || items.length >= MAX_ITEMS_PER_DAY) return;
        seen[item.id] = true;
        items.push(item);
      });
      days[key] = {
        date: key,
        capturedAt: iso(source.capturedAt),
        updatedAt: iso(source.updatedAt),
        completedAt: iso(source.completedAt),
        items: items
      };
    });
    return {days: days};
  }

  function snapshot(item, morningFive, rank) {
    return normalizeItem({
      id: item && item.id,
      source: item && item.source,
      title: item && item.title,
      page: item && item.page,
      urgency: item && item.urgency,
      score: item && item.score,
      morningFive: morningFive,
      rank: rank,
      state: 'pending'
    });
  }

  function ensureDay(review, date, now) {
    if (!review.days[date]) {
      review.days[date] = {date: date, capturedAt: iso(now), updatedAt: iso(now), completedAt: '', items: []};
    }
    return review.days[date];
  }

  function captureDay(raw, commandData, date, now) {
    var review = normalizeReview(raw);
    if (!validDate(date)) return {review: review, changed: false};
    var candidates = arr(commandData && commandData.morningFive).slice(0, 5).filter(function (item) { return item && item.id; });
    if (!review.days[date] && !candidates.length) return {review: review, changed: false};
    var existed = !!review.days[date];
    var day = ensureDay(review, date, now);
    var changed = !existed;
    var added = false;
    var byId = {};
    day.items.forEach(function (item) { byId[item.id] = item; });
    candidates.forEach(function (item, index) {
      if (!byId[item.id] && day.items.length < MAX_ITEMS_PER_DAY) {
        var captured = snapshot(item, true, index + 1);
        if (captured) { day.items.push(captured); byId[captured.id] = captured; changed = true; added = true; }
      } else if (byId[item.id] && !byId[item.id].morningFive) {
        byId[item.id].morningFive = true;
        byId[item.id].rank = index + 1;
        changed = true;
      }
    });
    if (added) day.completedAt = '';
    if (changed) day.updatedAt = iso(now);
    return {review: normalizeReview(review), changed: changed};
  }

  function setItemState(raw, date, item, state, now) {
    var review = normalizeReview(raw);
    if (!validDate(date) || !item || !item.id) return {review: review, changed: false};
    state = validState(state);
    var day = ensureDay(review, date, now);
    var target = day.items.find(function (entry) { return entry.id === String(item.id); });
    if (!target) {
      if (day.items.length >= MAX_ITEMS_PER_DAY) return {review: review, changed: false};
      target = snapshot(item, !!item.morningFive, item.rank);
      if (!target) return {review: review, changed: false};
      day.items.push(target);
    }
    var changed = target.state !== state;
    target.state = state;
    target.handledAt = state === 'pending' ? '' : iso(now);
    if (state === 'pending') day.completedAt = '';
    if (changed) day.updatedAt = iso(now);
    return {review: normalizeReview(review), changed: changed};
  }

  function completeDay(raw, date, now) {
    var review = normalizeReview(raw);
    if (!validDate(date) || !review.days[date]) return {review: review, changed: false};
    var day = review.days[date];
    var changed = !day.completedAt;
    day.items.forEach(function (item) {
      if (item.state === 'pending') {
        item.state = 'ignored';
        item.handledAt = iso(now);
        changed = true;
      }
    });
    day.completedAt = iso(now);
    if (changed) day.updatedAt = iso(now);
    return {review: normalizeReview(review), changed: changed};
  }

  function weeklySummary(raw, decisions, today) {
    var review = normalizeReview(raw);
    var keys = [];
    for (var offset = -6; offset <= 0; offset++) keys.push(dateOffset(today, offset));
    var days = keys.map(function (key) { return review.days[key]; }).filter(Boolean);
    var items = days.reduce(function (all, day) { return all.concat(day.items); }, []);
    var totals = {pending: 0, acted: 0, reviewed: 0, ignored: 0};
    var sources = {};
    var morningFiveTotal = 0;
    var morningFiveHandled = 0;
    items.forEach(function (item) {
      totals[item.state]++;
      if (!sources[item.source]) sources[item.source] = {source: item.source, total: 0, pending: 0, acted: 0, reviewed: 0, ignored: 0};
      sources[item.source].total++;
      sources[item.source][item.state]++;
      if (item.morningFive) {
        morningFiveTotal++;
        if (item.state !== 'pending') morningFiveHandled++;
      }
    });
    var decisionById = {};
    arr(decisions).forEach(function (entry) { if (entry && entry.id != null) decisionById[String(entry.id)] = entry; });
    var outcomeSeen = {};
    var outcomes = {sample: 0, win: 0, loss: 0, scratch: 0, beatBenchmark: 0, missedBenchmark: 0};
    items.forEach(function (item) {
      if (item.source !== 'Decisions' || item.state !== 'acted' || item.id.indexOf('decision-') !== 0) return;
      var id = item.id.slice(9);
      var entry = decisionById[id];
      if (!entry || outcomeSeen[id] || entry.status !== 'closed' || ['win', 'loss', 'scratch'].indexOf(entry.outcome) < 0) return;
      outcomeSeen[id] = true;
      outcomes.sample++;
      outcomes[entry.outcome]++;
      if (entry.beatBenchmark === true) outcomes.beatBenchmark++;
      if (entry.beatBenchmark === false) outcomes.missedBenchmark++;
    });
    var handled = totals.acted + totals.reviewed + totals.ignored;
    return {
      rangeStart: keys[0],
      rangeEnd: keys[keys.length - 1],
      capturedDays: days.length,
      completedDays: days.filter(function (day) { return !!day.completedAt; }).length,
      completionRate: days.length ? Math.round(days.filter(function (day) { return !!day.completedAt; }).length / days.length * 100) : 0,
      itemCount: items.length,
      handled: handled,
      handlingRate: items.length ? Math.round(handled / items.length * 100) : 0,
      morningFiveTotal: morningFiveTotal,
      morningFiveHandled: morningFiveHandled,
      morningFiveHandlingRate: morningFiveTotal ? Math.round(morningFiveHandled / morningFiveTotal * 100) : 0,
      totals: totals,
      sources: Object.keys(sources).map(function (key) { return sources[key]; }).sort(function (a, b) {
        return b.ignored - a.ignored || b.pending - a.pending || b.total - a.total || a.source.localeCompare(b.source);
      }),
      outcomes: outcomes
    };
  }

  var api = {
    normalizeReview: normalizeReview,
    captureDay: captureDay,
    setItemState: setItemState,
    completeDay: completeDay,
    weeklySummary: weeklySummary
  };
  root.CommandReviewCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
