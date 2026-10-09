(function (root) {
  'use strict';
  var DAY = 86400000;
  var STATUS = {invalidated:0, forming:1, confirmed:2};
  var CHIPS = {AMD:1, NVDA:1, AVGO:1, MU:1, SOXX:1, SMH:1};
  function number(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
  function date(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return null;
    var t = Date.parse(v + 'T00:00:00Z');
    return Number.isFinite(t) && new Date(t).toISOString().slice(0,10) === v ? t : null;
  }
  function source(s) {
    try { var u = new URL(s.catalystUrl); return /^https?:$/.test(u.protocol) ? u.href : ''; }
    catch (_) { return ''; }
  }
  function group(s) { return CHIPS[s.symbol] || /semis|semiconductor/i.test(s.theme || '') ? 'Semiconductors' : (s.theme || s.symbol); }
  function plan(s, data, now) {
    var c = number(s.close), stop = number(s.stop), target = number(s.target);
    var dataDate = s.dataAsOf || data.asOf || '', dt = date(dataDate);
    var generated = Date.parse(data.generatedAt || '');
    var expires = Number.isFinite(generated) ? generated + 36*3600000 : null;
    var stale = dt === null || dt > now || now-dt > (/crypto/i.test(s.theme || '') ? 2 : 4)*DAY ||
      expires === null || generated > now+300000 || now >= expires;
    var valid = c !== null && stop !== null && target !== null && stop > 0 && stop < c && c < target;
    var broken = s.status === 'invalidated' || (c !== null && stop !== null && c <= stop);
    var reached = c !== null && target !== null && c >= target;
    var confirmation = [];
    if (number(s.sma20) !== null && number(s.sma50) !== null) confirmation.push('a daily close above both the 20-day average (' + s.sma20 + ') and 50-day average (' + s.sma50 + '), with the 20-day average at least as high as the 50-day');
    else confirmation.push('updated trend averages');
    confirmation.push('volume at least 1.2× its 20-day norm');
    confirmation.push('positive 20-day relative strength versus ' + (s.benchmark || 'the benchmark'));
    confirmation.push('a theme backdrop score of at least 60');
    var missing = [];
    if (number(s.sma20) === null || number(s.sma50) === null || c === null || c <= s.sma20 || c <= s.sma50 || s.sma20 < s.sma50) missing.push('trend alignment');
    if (number(s.volRatio) === null || s.volRatio < 1.2) missing.push('volume ≥1.2× normal');
    if (number(s.relStrength20d) === null || s.relStrength20d <= 0) missing.push('positive benchmark lead');
    if (number(s.regimeScore) === null || s.regimeScore < 60) missing.push('supportive theme backdrop');
    return {
      dataDate:dataDate, assetDateKnown:!!s.dataAsOf, stale:stale, valid:valid, broken:broken, reached:reached,
      expiresAt:expires === null ? '' : new Date(expires).toISOString(), close:c, pendingChecks:missing,
      thesis: s.read && s.read.why || s.catalyst || s.why || 'No supported thesis in this snapshot.',
      condition: stale ? 'Refresh the evidence before reassessing this setup.' : broken ? 'The stored setup is invalidated; wait for a new plan.' : reached ? 'The snapshot has reached the stored target; reassess rather than reuse this plan.' : !valid ? 'Usable stop/target levels are missing; wait for a new plan.' :
        'If the next daily snapshot shows ' + confirmation.join(', ') + ', then reassess the setup while price remains between ' + stop + ' and ' + target + '.',
      breaks: stop === null ? 'No verified invalidation level in this snapshot.' : 'A daily close at or below ' + stop + ' breaks this stored plan.',
      evidence: s.read && s.read.wouldBreak || s.forecast && s.forecast.wouldChange || '',
      event:'No verified upcoming event date in the saved evidence.',
      sourceUrl:source(s), sourceDate:source(s) && date(s.catalystAsOf) !== null ? s.catalystAsOf : ''
    };
  }
  function changes(data, previous, now) {
    var currentDate = date(data.asOf), oldDate = previous ? date(previous.asOf) : null;
    var out = {status:'unavailable', from:previous && previous.asOf || '', to:data.asOf || '', items:[]};
    if (currentDate === null || oldDate === null || oldDate >= currentDate || currentDate-oldDate > 8*DAY) return out;
    out.status = 'ok';
    var old = {};
    (previous.signals || []).forEach(function (s) { old[s.symbol] = s; });
    (data.signals || []).forEach(function (s) {
      var p = old[s.symbol], reasons = [], severity = 0, basis = [];
      if (!p) return; // A newly fetched asset is not evidence of a new setup.
      var sd = date(s.dataAsOf || data.asOf), pd = date(p.dataAsOf || previous.asOf);
      if (sd !== null && pd !== null && sd > pd) {
        if (number(s.close) !== null && number(p.close) !== null && p.close > 0) {
          var move = (s.close/p.close-1)*100;
          if (Math.abs(move) >= 2) { reasons.push('Snapshot price ' + p.close + ' → ' + s.close + ' (' + (move >= 0 ? '+' : '') + move.toFixed(1) + '%).'); severity = 1; }
        }
        if (number(s.close) !== null && number(p.stop) !== null && number(p.close) !== null && p.close > p.stop && s.close <= p.stop) {
          reasons.push('Snapshot close ' + s.close + ' crossed the previous stop ' + p.stop + '.'); severity = 4;
        }
        if (s.status in STATUS && p.status in STATUS && s.status !== p.status) {
          reasons.push('Structure ' + p.status + ' → ' + s.status + '.');
          severity = Math.max(severity, STATUS[s.status] < STATUS[p.status] ? 3 : 2);
        }
        if (number(s.score) !== null && number(p.score) !== null && Math.abs(s.score-p.score) >= 5) {
          reasons.push('Technical score ' + p.score + ' → ' + s.score + '.'); severity = Math.max(severity,1);
        }
        if (number(s.relStrength20d) !== null && number(p.relStrength20d) !== null && Math.abs(s.relStrength20d-p.relStrength20d) >= 2) {
          reasons.push('20-day lead versus ' + (s.benchmark || 'benchmark') + ' ' + p.relStrength20d + ' → ' + s.relStrength20d + ' percentage points.'); severity = Math.max(severity,1);
        }
        if (number(s.close) !== null && number(p.target) !== null && number(p.close) !== null && p.close < p.target && s.close >= p.target) {
          reasons.push('Snapshot close reached the previous target ' + p.target + '.'); severity = Math.max(severity,2);
        }
        if (reasons.length) basis.push('price / technical');
      }
      var url = source(s), newsDate = date(s.catalystAsOf);
      if (s.catalyst && url && newsDate !== null && newsDate <= now && now-newsDate <= 7*DAY &&
          (url !== source(p) || s.catalystAsOf !== p.catalystAsOf)) {
        reasons.push('New sourced update: ' + s.catalyst); basis.push('news'); severity = Math.max(severity,1);
      }
      if (reasons.length) out.items.push({symbol:s.symbol, reasons:reasons, severity:severity, basis:basis.join(' + '),
        sourceUrl:basis.indexOf('news') >= 0 ? url : '', sourceDate:basis.indexOf('news') >= 0 ? s.catalystAsOf : ''});
    });
    out.items.sort(function (a,b) { return b.severity-a.severity || a.symbol.localeCompare(b.symbol); });
    return out;
  }
  function build(data, previous, options) {
    data = data || {};
    var now = options && options.now !== undefined ? Number(new Date(options.now)) : Date.now();
    if (!Number.isFinite(now)) now = Date.now();
    var plans = {}, excluded = [], candidates = [], groups = {};
    (data.signals || []).forEach(function (s) {
      var p = plan(s,data,now); plans[s.symbol] = p;
      var reason = p.stale ? 'Evidence needs a refresh' : p.broken ? 'Setup invalidated' : p.reached ? 'Stored target already reached' : !p.valid ? 'No usable stop/target plan' :
        !['confirmed','forming'].includes(s.status) ? 'Unknown structure' : number(s.score) === null || s.score < 70 ? 'Technical score below 70' :
        number(s.relStrength20d) === null || s.relStrength20d <= 0 ? 'No positive benchmark lead' :
        number(s.regimeScore) === null || s.regimeScore < 60 ? 'Theme backdrop missing or weak' : '';
      if (reason) excluded.push({symbol:s.symbol,reason:reason});
      else candidates.push(s);
    });
    candidates.sort(function (a,b) { return (b.score+(b.status === 'confirmed' ? 6 : 0))- (a.score+(a.status === 'confirmed' ? 6 : 0)) || a.symbol.localeCompare(b.symbol); });
    var items = [];
    candidates.forEach(function (s) {
      var g = group(s);
      if (groups[g]) excluded.push({symbol:s.symbol,reason:'Same exposure group as ' + groups[g]});
      else if (items.length >= 3) excluded.push({symbol:s.symbol,reason:'Below the three highest eligible priorities'});
      else {
        groups[g] = s.symbol;
        items.push({symbol:s.symbol, group:g, reason:s.status + ' structure; score ' + s.score + '; +' + s.relStrength20d + ' pts versus ' + s.benchmark + ' over 20 days.',
          confirmation:s.status === 'forming' ? 'Forming: confirmation still required.' : 'Confirmed in the saved snapshot; check follow-through in the next update.'});
      }
    });
    return {changes:changes(data,previous,now), priorities:items, excluded:excluded, plans:plans};
  }
  root.RadarAssistantCore = {build:build};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RadarAssistantCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
