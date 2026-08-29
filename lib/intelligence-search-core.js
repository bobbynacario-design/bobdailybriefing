(function (root) {
  'use strict';

  var MAX_BODY = 12000;
  var MAX_INDEX_ITEMS = 3000;

  function arr(value) { return Array.isArray(value) ? value : []; }
  function text(value, limit) {
    var result = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return limit && result.length > limit ? result.slice(0, limit) : result;
  }
  function plainHtml(value) {
    return text(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '), MAX_BODY);
  }
  function normalized(value) {
    var result = text(value).toLowerCase();
    try { result = result.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (error) {}
    return result;
  }
  function dateValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    var parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function entityList(value) {
    var seen = {};
    return arr(value).map(function (entry) {
      var label = text(entry && typeof entry === 'object' ? entry.label : entry, 100);
      var type = text(entry && typeof entry === 'object' ? entry.type : '', 30) || 'topic';
      var key = normalized(label);
      if (!label || label.length < 2 || seen[key]) return null;
      seen[key] = true;
      return {label:label, type:type};
    }).filter(Boolean).slice(0, 12);
  }
  function add(index, seen, row) {
    if (!row || !row.id || !row.title || seen[row.id] || index.length >= MAX_INDEX_ITEMS) return;
    var item = {
      id: text(row.id, 220),
      source: text(row.source, 40) || 'Other',
      title: text(row.title, 220),
      detail: text(row.detail, 420),
      body: text(row.body, MAX_BODY),
      meta: text(row.meta, 120),
      page: text(row.page, 40),
      ref: text(row.ref, 220),
      saved: dateValue(row.saved),
      entities: entityList(row.entities)
    };
    item.searchText = normalized([item.source, item.title, item.detail, item.body, item.meta].concat(item.entities.map(function (entry) { return entry.label; })).join(' '));
    seen[item.id] = true;
    index.push(item);
  }

  function buildIndex(input) {
    input = input || {};
    var index = [];
    var seen = {};

    arr(input.briefings).forEach(function (entry) {
      var data = entry && entry.data || {};
      var date = text(data.date || entry.key);
      var sections = data.sections || {};
      Object.keys(sections).forEach(function (section) {
        arr(sections[section]).forEach(function (story, position) {
          add(index, seen, {
            id: 'briefing:' + text(entry.key) + ':' + section + ':' + position,
            source: 'Briefing', title: story && story.headline || 'Briefing item',
            detail: story && (story.summary || story.relevance || story.source),
            body: story && (story.body || story.relevance), meta: date + ' · ' + section,
            page: 'today', ref: entry.key, saved: entry.saved,
            entities: arr(story && story.entities).map(function (label) { return {label:label,type:'entity'}; })
              .concat(arr(story && story.assets).map(function (label) { return {label:label,type:'asset'}; }))
              .concat(arr(story && story.tags).map(function (label) { return {label:label,type:'topic'}; }))
          });
        });
      });
      if (data.watch) add(index, seen, {
        id: 'briefing:' + text(entry.key) + ':watch', source: 'Briefing', title: 'One thing to watch',
        detail: data.watch, meta: date + ' · watch', page: 'today', ref: entry.key, saved: entry.saved
      });
    });

    // Insurance news from the news/ feed.
    //
    // `saved` is the article's OWN publication date, not the snapshot's fetch
    // time. Every story in a snapshot would otherwise share one timestamp and
    // the timeline would stack a week of separately-published articles onto the
    // morning we happened to fetch them, which is exactly the false chronology
    // Entity Timelines are supposed to avoid. An article with no parseable date
    // keeps saved 0 and is counted as undated, the same as any other record.
    //
    // `ref` holds the publisher url rather than an in-app key, because the
    // source of a news record is the article itself. The front end opens it
    // directly instead of routing to a tab that merely mentions it.
    arr(input.news && input.news.items).forEach(function (item) {
      add(index, seen, {
        id: 'news:' + text(item && (item.id || item.url)),
        source: 'News',
        title: item && item.title,
        detail: item && item.summary,
        meta: [item && item.source, item && item.section,
          item && item.publishedAt ? text(item.publishedAt).slice(0, 10) : 'undated'].filter(Boolean).join(' · '),
        page: 'today', ref: item && item.url, saved: item && item.publishedAt,
        // The feed's matched keyword tiers are the structured entity field this
        // source supplies, so they are what the timeline offers as quick picks.
        // They are carried verbatim; inventing prettier labels would make the
        // catalog disagree with the feed it came from.
        entities: arr(item && item.tags).map(function (label) { return {label: label, type: 'topic'}; })
          .concat([{label: item && item.source, type: 'company'}])
      });
    });

    arr(input.reports).forEach(function (report) {
      add(index, seen, {
        id: 'report:' + text(report && report.id), source: 'Research',
        title: report && report.title || 'Research report', detail: report && report.dek,
        body: report && (report.md || plainHtml(report.html)),
        meta: [report && report.dateLabel, arr(report && report.tags).join(' · ')].filter(Boolean).join(' · '),
        page: 'research', ref: report && report.id, saved: report && report.saved,
        entities: arr(report && report.tags).map(function (label) { return {label:label,type:'topic'}; })
      });
    });

    arr(input.decisions).forEach(function (entry) {
      add(index, seen, {
        id: 'decision:' + text(entry && entry.id), source: 'Decisions',
        title: text(entry && (entry.asset || entry.subject)) || 'Decision journal entry',
        detail: entry && entry.reason,
        body: entry && [entry.invalidator, entry.outcomeNote, entry.mistakeType].filter(Boolean).join(' '),
        meta: [entry && entry.createdDate, entry && entry.action, entry && entry.status, entry && entry.outcome].filter(Boolean).join(' · '),
        page: 'decisions', ref: entry && entry.id, saved: entry && entry.saved,
        entities: [{label:entry && (entry.asset || entry.subject),type:'asset'}]
      });
    });

    arr(input.radar && input.radar.signals).forEach(function (signal) {
      add(index, seen, {
        id: 'radar:' + text(signal && signal.symbol), source: 'Radar',
        title: text(signal && signal.symbol) + (signal && signal.name ? ' · ' + text(signal.name) : ''),
        detail: signal && (signal.catalyst || signal.why),
        body: signal && [signal.thesis, signal.invalidation, signal.sector, signal.theme].filter(Boolean).join(' '),
        meta: [signal && signal.status, signal && signal.score != null ? 'score ' + signal.score : ''].filter(Boolean).join(' · '),
        page: 'radar', ref: signal && signal.symbol, saved: input.radar && (input.radar.generatedAt || input.radar.asOf),
        entities: [
          {label:signal && signal.symbol,type:'asset'}, {label:signal && signal.name,type:'company'},
          {label:signal && signal.sector,type:'topic'}, {label:signal && signal.theme,type:'topic'}
        ]
      });
    });

    arr(input.markets && input.markets.markets).forEach(function (market, position) {
      var ref = text(market && (market.slug || market.id || market.label || position));
      add(index, seen, {
        id: 'market:' + ref, source: 'Markets',
        title: market && (market.label || market.question || market.slug) || 'Event market',
        detail: market && (market.summary || market.interpretation || market.why),
        body: market && [market.rationale, market.panelSummary, market.catalyst].filter(Boolean).join(' '),
        meta: [market && market.gate, market && market.impliedYes != null ? Math.round(Number(market.impliedYes) * 100) + '% implied' : ''].filter(Boolean).join(' · '),
        page: 'miro', ref: ref, saved: input.markets && (input.markets.generatedAt || input.markets.asOf),
        entities: [{label:market && (market.label || market.question),type:'event'}]
      });
    });

    var modules = input.sports && input.sports.modules || {};
    Object.keys(modules).forEach(function (key) {
      var mod = modules[key] || {};
      arr(mod.upcoming).slice(0, 20).forEach(function (match, position) {
        var home = text(match && (match.home || match.homeTeam)) || 'TBD';
        var away = text(match && (match.away || match.awayTeam)) || 'TBD';
        add(index, seen, {
          id: 'sports:' + key + ':' + text(match && (match.id || match.utcDate || position)), source: 'Sports',
          title: home + ' vs ' + away, detail: [match && match.venue, match && match.stage].filter(Boolean).join(' · '),
          body: match && match.note, meta: [mod.title || key.toUpperCase(), match && (match.utcDate || match.date)].filter(Boolean).join(' · '),
          page: 'sports', ref: key, saved: match && (match.utcDate || match.date),
          entities: [{label:home,type:'team'},{label:away,type:'team'}]
        });
      });
      arr(mod.risingTeams).concat(arr(mod.watchTeams), arr(mod.fadingTeams)).slice(0, 30).forEach(function (team) {
        var name = text(team && (team.team || team.name));
        if (!name) return;
        add(index, seen, {
          id: 'sports-team:' + key + ':' + name, source: 'Sports', title: name,
          detail: team && team.note, body: team && [team.recentForm, team.label].filter(Boolean).join(' '),
          meta: [mod.title || key.toUpperCase(), team && team.label, team && team.score != null ? 'score ' + team.score : ''].filter(Boolean).join(' · '),
          page: 'sports', ref: key, saved: input.sports && (input.sports.generatedAt || input.sports.asOf),
          entities: [{label:name,type:'team'}]
        });
      });
    });

    return index;
  }

  function excerpt(item, phrase) {
    if (item.detail) return item.detail;
    var body = item.body || '';
    if (!body) return '';
    var at = normalized(body).indexOf(phrase);
    var start = at > 70 ? at - 70 : 0;
    var value = body.slice(start, start + 230);
    return (start ? '…' : '') + value + (start + 230 < body.length ? '…' : '');
  }

  function search(index, query, options) {
    options = options || {};
    var phrase = normalized(query);
    if (phrase.length < 2) return [];
    var tokens = phrase.split(/[^a-z0-9]+/).filter(function (token) { return token.length >= 2; });
    if (!tokens.length) return [];
    var source = normalized(options.source || '');
    var now = Number.isFinite(options.now) ? options.now : Date.now();
    var limit = Math.max(1, Math.min(100, Number(options.limit) || 30));
    return arr(index).filter(function (item) {
      return (!source || normalized(item.source) === source) && tokens.every(function (token) { return item.searchText.indexOf(token) >= 0; });
    }).map(function (item) {
      var title = normalized(item.title);
      var detail = normalized(item.detail);
      var score = title === phrase ? 120 : (title.indexOf(phrase) === 0 ? 75 : (title.indexOf(phrase) >= 0 ? 55 : 0));
      if (detail.indexOf(phrase) >= 0) score += 24;
      if (item.searchText.indexOf(phrase) >= 0) score += 14;
      tokens.forEach(function (token) {
        score += title.indexOf(token) >= 0 ? 13 : (detail.indexOf(token) >= 0 ? 6 : 2);
      });
      var ageDays = item.saved ? Math.max(0, now - item.saved) / 86400000 : 365;
      score += Math.max(0, 8 - Math.min(8, ageDays / 7));
      return Object.assign({}, item, {score: Math.round(score * 10) / 10, excerpt: excerpt(item, phrase)});
    }).sort(function (a, b) {
      return b.score - a.score || b.saved - a.saved || a.title.localeCompare(b.title);
    }).slice(0, limit);
  }

  var api = {buildIndex: buildIndex, search: search, normalized: normalized};
  root.IntelligenceSearchCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
