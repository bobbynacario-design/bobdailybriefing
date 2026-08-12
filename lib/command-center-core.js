(function (root) {
  'use strict';

  function arr(value) { return Array.isArray(value) ? value : []; }
  function num(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : (fallback == null ? 0 : fallback);
  }
  function text(value) { return String(value == null ? '' : value).trim(); }
  function time(value) {
    if (value == null) return null;
    var parsed = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

  function relevance(story) {
    var level = text(story && story.relevance_level).toLowerCase();
    if (level === 'medium') level = 'med';
    if (['high', 'med', 'low', 'none'].indexOf(level) >= 0) return level;
    var body = text(story && story.relevance).toLowerCase();
    if (!body || body.indexOf('no direct relevance') >= 0) return 'none';
    if (/claim|forensic|insurance|interruption|consulting|audit|reinsurance|catastrophe|bsp|supply chain|outage|typhoon|flood/.test(body)) return 'high';
    if (/market|economy|inflation|trade|rate|currency|weather|technology/.test(body)) return 'med';
    return 'low';
  }

  function addBriefing(items, briefing) {
    var sections = briefing && briefing.sections || {};
    Object.keys(sections).forEach(function (section) {
      arr(sections[section]).forEach(function (story, index) {
        var level = relevance(story);
        if (level !== 'high' && level !== 'med') return;
        items.push({
          id: 'briefing-' + section + '-' + index,
          source: 'Briefing', kind: 'intelligence', page: 'today',
          title: text(story.headline) || 'Briefing item',
          detail: text(story.relevance) || text(story.summary) || text(story.source),
          score: level === 'high' ? 90 : 68,
          urgency: level === 'high' ? 'act' : 'monitor',
          confidence: level === 'high' ? 'high' : 'medium'
        });
      });
    });
  }

  function addRadar(items, radar) {
    arr(radar && radar.signals).filter(function (signal) {
      return signal && (signal.status === 'confirmed' || signal.status === 'forming');
    }).map(function (signal) {
      var rank = num(signal.score) + (signal.status === 'confirmed' ? 10 : 0) + clamp(num(signal.relStrength20d), -10, 12) * 0.4;
      return {signal: signal, rank: rank};
    }).sort(function (a, b) { return b.rank - a.rank; }).slice(0, 6).forEach(function (row) {
      var signal = row.signal;
      items.push({
        id: 'radar-' + text(signal.symbol),
        source: 'Radar', kind: 'market', page: 'radar',
        title: text(signal.symbol) + ' / ' + (signal.status === 'confirmed' ? 'confirmed setup' : 'forming setup'),
        detail: text(signal.catalyst) || text(signal.why) || ('Score ' + num(signal.score)),
        score: clamp(52 + row.rank * 0.42, 55, 96),
        urgency: signal.status === 'confirmed' ? 'act' : 'monitor',
        confidence: signal.status === 'confirmed' ? 'high' : 'medium'
      });
    });
  }

  function addMarkets(items, markets) {
    arr(markets && markets.markets).map(function (market) {
      var delta = Math.abs(num(market.priceChange));
      var attention = num(market.attentionScore, num(market.priority));
      var gate = text(market.gate).toUpperCase() === 'GO';
      return {market: market, delta: delta, attention: attention, gate: gate,
        rank: (gate ? 26 : 0) + Math.min(delta * 100, 15) * 2 + Math.min(attention, 100) * 0.35};
    }).filter(function (row) {
      return row.gate || row.delta >= 0.005 || row.attention >= 45;
    }).sort(function (a, b) { return b.rank - a.rank; }).slice(0, 6).forEach(function (row) {
      var market = row.market;
      var deltaText = row.delta ? ((num(market.priceChange) > 0 ? '+' : '-') + (row.delta * 100).toFixed(1) + ' pts') : 'priority signal';
      items.push({
        id: 'market-' + text(market.slug || market.label),
        source: 'Markets', kind: 'event', page: 'miro',
        title: text(market.label || market.question || market.slug) || 'Event-market signal',
        detail: deltaText + (market.impliedYes == null ? '' : ' / ' + Math.round(num(market.impliedYes) * 100) + '% implied'),
        score: clamp(52 + row.rank * 0.55, 54, 94),
        urgency: row.gate ? 'act' : 'monitor',
        confidence: row.gate && market.panelN >= 3 ? 'medium' : 'low'
      });
    });
  }

  function addDecisions(items, decisions, today) {
    arr(decisions).filter(function (entry) {
      return entry && (entry.status || 'open') !== 'closed';
    }).forEach(function (entry) {
      var oldTaken = entry.action === 'took' && text(entry.createdDate) !== today;
      if (!oldTaken && text(entry.createdDate) !== today) return;
      items.push({
        id: 'decision-' + text(entry.id || entry.asset),
        source: 'Decisions', kind: 'review', page: 'decisions',
        title: oldTaken ? 'Review open call: ' + text(entry.asset || entry.subject) : 'Today: ' + text(entry.asset || entry.subject),
        detail: text(entry.reason) || text(entry.invalidator) || (oldTaken ? 'Open taken call needs review.' : 'Decision logged today.'),
        score: oldTaken ? 97 : 74,
        urgency: oldTaken ? 'act' : 'monitor',
        confidence: 'high'
      });
    });
  }

  function matchTeams(match, followed) {
    if (!followed.length) return false;
    var names = [text(match.home), text(match.away), text(match.homeTeam), text(match.awayTeam)].join(' ').toLowerCase();
    return followed.some(function (team) { return names.indexOf(text(team).toLowerCase()) >= 0; });
  }
  function addSports(items, sports, follows, now) {
    var modules = sports && sports.modules || {};
    Object.keys(modules).forEach(function (key) {
      var mod = modules[key] || {};
      var followed = arr(follows && follows[key]);
      if (!followed.length) {
        followed = arr(mod.watchlist).map(function (row) { return text(row && (row.team || row.name) || row); }).filter(Boolean);
      }
      arr(mod.upcoming).filter(function (match) { return matchTeams(match || {}, followed); }).slice(0, 3).forEach(function (match, index) {
        var kickoff = time(match.utcDate || match.date || match.startTime);
        var hours = kickoff == null ? null : (kickoff - now) / 3600000;
        var home = text(match.home || match.homeTeam) || 'TBD';
        var away = text(match.away || match.awayTeam) || 'TBD';
        items.push({
          id: 'sports-' + key + '-' + text(match.id || match.utcDate || index),
          source: 'Sports', kind: 'personal', page: 'sports',
          title: home + ' vs ' + away,
          detail: text(mod.title || key.toUpperCase()) + (kickoff == null ? '' : ' / ' + new Date(kickoff).toISOString()),
          score: hours != null && hours >= 0 && hours <= 24 ? 78 : 58,
          urgency: hours != null && hours >= 0 && hours <= 24 ? 'act' : 'monitor',
          confidence: 'high'
        });
      });
    });
  }

  function addHealth(items, health, now) {
    var specs = {radar: 30, miro: 30, ph: 30, sports: 18};
    var labels = {radar: 'Radar', miro: 'Markets', ph: 'PSE', sports: 'Sports'};
    var pages = {radar: 'radar', miro: 'miro', ph: 'pse', sports: 'sports'};
    var feeds = health && health.feeds || {};
    Object.keys(specs).forEach(function (key) {
      var rec = feeds[key];
      if (!rec) return;
      var last = time(rec.lastOkAt || rec.lastRunAt);
      var ageHours = last == null ? Infinity : Math.max(0, now - last) / 3600000;
      var failed = rec.status === 'failed';
      if (!failed && ageHours <= specs[key]) return;
      items.push({
        id: 'health-' + key,
        source: 'Reliability', kind: 'system', page: pages[key],
        title: labels[key] + (failed ? ' refresh failed' : ' feed is stale'),
        detail: failed ? text(rec.message || rec.stage || 'Latest run did not complete.') : ('Last good data is ' + Math.round(ageHours) + 'h old.'),
        score: failed || ageHours > specs[key] * 2 ? 100 : 86,
        urgency: 'act', confidence: 'high'
      });
    });
  }

  function diverseTop(items, limit) {
    var picked = [], used = {};
    items.forEach(function (item) {
      if (picked.length >= limit || used[item.source]) return;
      picked.push(item); used[item.source] = true;
    });
    items.forEach(function (item) {
      if (picked.length >= limit || picked.indexOf(item) >= 0) return;
      picked.push(item);
    });
    return picked;
  }

  function buildCommandCenter(input, now) {
    input = input || {};
    now = Number.isFinite(now) ? now : Date.now();
    var today = input.today || new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(now));
    var items = [];
    addBriefing(items, input.briefing);
    addRadar(items, input.radar);
    addMarkets(items, input.markets);
    addDecisions(items, input.decisions, today);
    addSports(items, input.sports, input.sportsFollows, now);
    addHealth(items, input.health, now);
    items.sort(function (a, b) { return b.score - a.score || a.source.localeCompare(b.source); });
    var morningFive = diverseTop(items, 5);
    return {
      generatedAt: now,
      items: items,
      morningFive: morningFive,
      counts: {
        total: items.length,
        act: items.filter(function (item) { return item.urgency === 'act'; }).length,
        review: items.filter(function (item) { return item.source === 'Decisions'; }).length,
        sources: Object.keys(items.reduce(function (set, item) { set[item.source] = true; return set; }, {})).length
      }
    };
  }

  root.CommandCenterCore = {buildCommandCenter: buildCommandCenter, relevance: relevance};
})(typeof globalThis !== 'undefined' ? globalThis : this);
