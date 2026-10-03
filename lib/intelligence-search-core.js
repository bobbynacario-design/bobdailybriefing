(function (root) {
  'use strict';

  var MAX_BODY = 12000;
  // 100 briefings alone make about 2,600 records, so the cap sits well above
  // that; the personal sources are added before the shared feeds either way.
  var MAX_INDEX_ITEMS = 5000;

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
      // Orders records a search matches equally (a Radar name's score).
      rank: Number(row.rank) || 0,
      entities: entityList(row.entities)
    };
    item.searchText = normalized([item.source, item.title, item.detail, item.body, item.meta].concat(item.entities.map(function (entry) { return entry.label; })).join(' '));
    wordsOf(item);
    seen[item.id] = true;
    index.push(item);
  }

  // ChatGPT deep-research exports carry citation markers: a private-use span
  // U+E200 kind U+E202 refs… U+E201, where the kind is cite, filecite, i (an
  // image) or entity. Seen bare too, once the glyphs are lost on a copy
  // ("citeturn12view0turn7view4", "iturn35image0"). 14 of Bob's 20 reports
  // carried them (1 Oct), and one report's whole summary was one.
  function stripCiteMarkers(value) {
    return String(value == null ? '' : value)
      .replace(/[^]*/g, '')
      .replace(/[-]/g, '')
      .replace(/\b(?:file)?cite(?:turn\d+[a-z]+\d+)+/gi, '')
      .replace(/\b(?:i|image)?(?:turn\d+(?:search|view|news|image|file|fetch)\d+)+/gi, '')
      .replace(/[ \t]+([.,;:)])/g, '$1')
      .replace(/\(\s*\)/g, '')
      .replace(/[ \t]{2,}/g, ' ');
  }

  // Words match from their start: "eth" finds ETH and Ethereum, never
  // "together" or "method", and "claim" still finds "claims". The word text is
  // cached on the record but not enumerable, so result copies and JSON stay lean.
  function wordText(value) {
    var words = normalized(value).replace(/[^a-z0-9]+/g, ' ').trim();
    return words ? ' ' + words + ' ' : ' ';
  }
  function wordsOf(item) {
    if (typeof item.words !== 'string') Object.defineProperty(item, 'words', {value: wordText(item.searchText), enumerable: false, writable: true});
    return item.words;
  }
  function hasWord(words, term) { return words.indexOf(' ' + term) >= 0; }

  // Today's Taker and Wildcard names, from the doc's picks (radar/catalysts.js
  // focusPicks). A doc written before picks existed lists the six together,
  // as catalystRun.focus, so those can only be named as one or the other.
  function radarPicks(radar) {
    var out = {}, picks = radar.picks || {};
    if (Array.isArray(picks.taker) || Array.isArray(picks.wildcard)) {
      arr(picks.taker).forEach(function (symbol) { out[text(symbol)] = 'Taker pick'; });
      arr(picks.wildcard).forEach(function (symbol) { out[text(symbol)] = 'Wildcard pick'; });
    } else {
      arr(radar.catalystRun && radar.catalystRun.focus).forEach(function (symbol) { out[text(symbol)] = 'Taker or Wildcard pick'; });
    }
    return out;
  }
  // How names in this score's band have done before, from the radar journal's
  // byScoreBucket, as the card's "Band 80-100 record" line says it. The band
  // is the bucket with the highest lower bound at or below the score, read
  // from the bucket names, so the thresholds live only in the journal.
  function radarBandFor(score, buckets) {
    var value = Number(score), best = '', low = -Infinity;
    if (score == null || !Number.isFinite(value)) return null;
    Object.keys(buckets || {}).forEach(function (key) {
      var match = /^(\d+)-\d+$/.exec(key);
      if (match && Number(match[1]) <= value && Number(match[1]) > low) { low = Number(match[1]); best = key; }
    });
    var band = best && buckets[best];
    return band && band.n && band.avgExcessReturn != null ? {key: best, band: band} : null;
  }
  // "55.7% beat their benchmark, average excess +2.23%"
  function radarBandRecord(band) {
    return (band.excessWinRate == null ? '' : band.excessWinRate + '% beat their benchmark, ') +
      'average excess ' + (band.avgExcessReturn > 0 ? '+' : '') + band.avgExcessReturn + '%';
  }
  // No clear edge: under half beat their benchmark, or the average excess is
  // inside the card's own noise line (+/-0.25 points).
  function radarNoEdge(band) {
    return (band.excessWinRate != null && band.excessWinRate < 50) || Math.abs(band.avgExcessReturn) <= 0.25;
  }
  function radarBandLine(score, buckets) {
    var found = radarBandFor(score, buckets);
    return found ? 'Score band ' + found.key + ' record over ' + found.band.n + ' past signals: ' + radarBandRecord(found.band) + '.' : '';
  }
  // One record for the Radar as a whole, computed here so an answer about the
  // picks never depends on the model counting across six records: the picks
  // with their scores, grouped by score band with each band's record (and
  // whether it has a clear edge), how many are on volume below their norm,
  // the early flags, the themes, and the whole scan by status.
  function radarOverview(radar, buckets) {
    var signals = arr(radar.signals).filter(function (s) { return s && s.symbol; });
    if (!signals.length) return null;
    var bySymbol = {};
    signals.forEach(function (s) { bySymbol[text(s.symbol)] = s; });
    var picks = radar.picks || {}, split = Array.isArray(picks.taker) || Array.isArray(picks.wildcard);
    var names = split ? arr(picks.taker).concat(arr(picks.wildcard)) : arr(radar.catalystRun && radar.catalystRun.focus);
    var chosen = names.map(function (symbol) { return bySymbol[text(symbol)]; }).filter(Boolean);
    var scored = function (list) { return list.map(function (s) { return text(s.symbol) + ' ' + s.score; }).join(', '); };
    var of = function (list) { return list.filter(function (symbol) { return bySymbol[text(symbol)]; }).map(function (symbol) { return bySymbol[text(symbol)]; }); };
    var lines = [];
    if (!chosen.length) lines.push('No Taker or Wildcard picks today.');
    else if (split) lines.push('Taker picks: ' + (scored(of(arr(picks.taker))) || 'none') + '. Wildcard picks: ' + (scored(of(arr(picks.wildcard))) || 'none') + '.');
    else lines.push('Today\'s ' + chosen.length + ' Taker and Wildcard picks (this scan does not say which is which): ' + scored(chosen) + '.');
    if (chosen.length) {
      var groups = [], byKey = {};
      chosen.forEach(function (s) {
        var found = radarBandFor(s.score, buckets), key = found ? found.key : 'no band record';
        if (!byKey[key]) { byKey[key] = {found: found, names: []}; groups.push(key); }
        byKey[key].names.push(text(s.symbol));
      });
      groups.sort(function (a, b) { return (parseInt(b, 10) || -1) - (parseInt(a, 10) || -1); });
      // With the split, each group says which picks it holds.
      var role = {};
      arr(picks.taker).forEach(function (symbol) { role[text(symbol)] = 'Taker'; });
      arr(picks.wildcard).forEach(function (symbol) { role[text(symbol)] = 'Wildcard'; });
      var held = function (list) {
        if (!split) return list.join(', ');
        var roles = list.map(function (symbol) { return role[symbol]; });
        return roles.every(function (r) { return r === roles[0]; })
          ? list.join(', ') + ' (' + (list.length > 1 ? 'all ' : '') + roles[0] + ')'
          : list.map(function (symbol) { return symbol + ' (' + role[symbol] + ')'; }).join(', ');
      };
      lines.push('By score band: ' + groups.map(function (key) {
        var group = byKey[key];
        return key + (group.found ? ' (' + radarBandRecord(group.found.band) + (radarNoEdge(group.found.band) ? '; no clear edge' : '') + ')' : '') + ': ' + held(group.names);
      }).join('. ') + '.');
      var light = chosen.filter(function (s) { return Number.isFinite(Number(s.volRatio)) && Number(s.volRatio) < 1; });
      lines.push(light.length
        ? 'Volume below its 20-day norm: ' + light.length + ' of the ' + chosen.length + ' (' + light.map(function (s) { return text(s.symbol) + ' ' + Number(s.volRatio).toFixed(2) + '×'; }).join(', ') + ').'
        : 'Volume: all ' + chosen.length + ' at or above their 20-day norm.');
      var early = chosen.filter(function (s) { return s.early === true; });
      lines.push('Early: ' + (early.length === chosen.length ? 'all ' + chosen.length : early.length + ' of the ' + chosen.length + (early.length ? ' (' + early.map(function (s) { return text(s.symbol); }).join(', ') + ')' : '')) + '.');
      var themes = [], byTheme = {};
      chosen.forEach(function (s) {
        var theme = text(s.theme) || 'no theme';
        if (!byTheme[theme]) { byTheme[theme] = []; themes.push(theme); }
        byTheme[theme].push(text(s.symbol));
      });
      themes.sort(function (a, b) { return byTheme[b].length - byTheme[a].length; });
      lines.push('Themes: ' + themes.map(function (theme) { return theme + ' ' + byTheme[theme].length + ' (' + byTheme[theme].join(', ') + ')'; }).join(', ') + '.');
    }
    var statuses = [], byStatus = {};
    signals.forEach(function (s) {
      var status = text(s.status) || 'unrated';
      if (!byStatus[status]) { byStatus[status] = 0; statuses.push(status); }
      byStatus[status]++;
    });
    statuses.sort(function (a, b) { return byStatus[b] - byStatus[a]; });
    lines.push('Whole scan: ' + signals.length + ' names; ' + statuses.map(function (status) { return byStatus[status] + ' ' + status; }).join(', ') +
      '; ' + signals.filter(function (s) { return s.early === true; }).length + ' early.');
    return {
      id: 'radar:overview', source: 'Radar', title: 'Radar overview: today\'s Taker and Wildcard picks',
      detail: lines[0], body: lines.slice(1).join(' '), meta: 'Overview · ' + signals.length + ' names · ' + chosen.length + ' picks',
      page: 'radar', ref: '', saved: radar.generatedAt || radar.asOf, rank: 1000, entities: []
    };
  }
  // A Radar name's card as text, each part labelled: the catalyst (when the
  // score's reason is the record's detail), the read, the early flag, the
  // levels, the score band's record and the tripwire.
  function radarBody(signal, buckets) {
    var read = signal.read || {};
    var sentence = function (value) { value = text(value); return value && !/[.!?…)]$/.test(value) ? value + '.' : value; };
    var hasTarget = signal.target != null && signal.target !== '';
    var upside = hasTarget && Number(signal.entry) > 0 ? (Number(signal.target) - Number(signal.entry)) / Number(signal.entry) * 100 : null;
    var levels = [
      signal.entry != null ? 'entry ' + signal.entry : '', signal.stop != null ? 'stop ' + signal.stop : '',
      hasTarget ? 'target ' + signal.target : '',
      upside != null && Number.isFinite(upside) ? 'upside ' + (upside > 0 ? '+' : '') + upside.toFixed(1) + '%' : '',
      hasTarget && signal.rr != null ? 'R:R ' + signal.rr : ''
    ].filter(Boolean);
    var accumulation = Number(signal.accumulation);
    return [
      signal.why && signal.catalyst
        ? 'Catalyst' + (signal.eventType || signal.catalystAsOf ? ' (' + [signal.eventType, signal.catalystAsOf].filter(Boolean).join(', ') + ')' : '') + ': ' + sentence(signal.catalyst)
        : '',
      read.why ? "Why it's moving: " + sentence(read.why) : '',
      read.wouldBreak ? 'What would break it: ' + sentence(read.wouldBreak) : '',
      signal.early === true
        ? 'Early: forming, with up-day volume ' + (accumulation > 0 ? accumulation.toFixed(1) + '× ' : 'well ahead of ') + 'down-day volume over 20 sessions.'
        : '',
      levels.length ? 'Radar levels: ' + levels.join(' · ') + '.' : '',
      radarBandLine(signal.score, buckets),
      sentence(signal.invalidation), sentence(signal.thesis),
      signal.sector ? 'Sector: ' + sentence(signal.sector) : '', signal.theme ? 'Theme: ' + sentence(signal.theme) : ''
    ].filter(Boolean).join(' ');
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
        title: stripCiteMarkers(report && report.title) || 'Research report', detail: stripCiteMarkers(report && report.dek),
        body: stripCiteMarkers(report && (report.md || plainHtml(report.html))),
        meta: [report && report.dateLabel, arr(report && report.tags).join(' · ')].filter(Boolean).join(' · '),
        page: 'research', ref: report && report.id, saved: report && report.saved,
        entities: arr(report && report.tags).map(function (label) { return {label:label,type:'topic'}; })
      });
    });

    arr(input.decisions).forEach(function (entry) {
      add(index, seen, {
        id: 'decision:' + text(entry && entry.id), source: 'Decisions',
        title: text(entry && (entry.asset || entry.subject)) || 'Decision journal entry',
        // Each part is labelled, so a reader (or Ask Daybook) never takes the
        // mistake type "none" for the reason; a blank reason says so.
        detail: text(entry && entry.reason) || 'No reason recorded',
        body: entry && [entry.invalidator ? 'Invalidator: ' + text(entry.invalidator) : '', entry.outcomeNote ? 'Outcome: ' + text(entry.outcomeNote) : '',
          entry.mistakeType && entry.mistakeType !== 'none' ? 'Mistake: ' + text(entry.mistakeType) : ''].filter(Boolean).join(' · '),
        meta: [entry && entry.createdDate, entry && entry.action, entry && entry.status, entry && entry.outcome,
          entry && entry.conviction ? 'conviction ' + entry.conviction + '/5' : ''].filter(Boolean).join(' · '),
        page: 'decisions', ref: entry && entry.id, saved: entry && entry.saved,
        entities: [{label:entry && (entry.asset || entry.subject),type:'asset'}]
      });
    });

    // Evidence: one row per saved item. The note is his own words; the rest is
    // the copy he kept of a story, report or page.
    arr(input.evidence && input.evidence.sets).forEach(function (set) {
      arr(set && set.items).forEach(function (item) {
        add(index, seen, {
          id: 'evidence:' + text(set.id) + ':' + text(item && (item.key || item.id)), source: 'Evidence',
          title: item && item.title, detail: item && item.detail,
          body: item && item.note ? 'Note: ' + text(item.note) : '',
          meta: ['Saved to ' + text(set.name), item && item.source].filter(Boolean).join(' · '),
          page: 'evidence', ref: set.id, saved: item && item.capturedAt, entities: []
        });
      });
    });

    // Go deeper dossiers, kept per story (AI-written from a web search).
    var dossiers = input.dossiers || {};
    Object.keys(dossiers).forEach(function (key) {
      var d = dossiers[key] || {}, story = d.story || {};
      add(index, seen, {
        id: 'dossier:' + key, source: 'Dossier', title: story.headline || 'Dossier', detail: d.summary,
        body: arr(d.background).concat(arr(d.numbers).map(function (n) { return n && [n.figure, n.what].join(' '); }),
          [d.bi_angle], arr(d.exposed), arr(d.client_questions), [d.would_change]).filter(Boolean).join(' '),
        meta: ['Go deeper', story.date, story.source].filter(Boolean).join(' · '),
        page: 'today', ref: key, saved: d.generatedAt, entities: []
      });
    });

    // Meeting briefs (AI-written from his material and a web search).
    var briefs = input.meetingBriefs || {};
    Object.keys(briefs).forEach(function (id) {
      var b = briefs[id] || {};
      add(index, seen, {
        id: 'meeting:' + id, source: 'Meeting', title: 'Meeting brief: ' + text(b.topic), detail: b.where_things_stand,
        body: arr(b.recent).map(function (r) { return r && r.what; }).concat(arr(b.his_threads), arr(b.questions), [b.watch]).filter(Boolean).join(' '),
        meta: 'Meeting brief', page: 'evidence', ref: id, saved: b.generatedAt,
        entities: [{label: b.topic, type: 'topic'}]
      });
    });

    // Weekly reads ("Your week, read back"), keyed by the Sunday they cover to.
    var mirrors = input.mirrors || {};
    Object.keys(mirrors).forEach(function (day) {
      var m = mirrors[day] || {}, range = m.range || {};
      add(index, seen, {
        id: 'weekly:' + day, source: 'Weekly read',
        title: 'Your week, read back' + (range.from ? ' · ' + text(range.from) + ' to ' + text(range.to || day) : ''),
        detail: m.week_in_a_line,
        body: arr(m.themes).map(function (t) { return t && [t.title, t.detail].join(' '); })
          .concat([m.said_vs_did, m.reading, m.decisions, m.try_next && m.try_next.action, m.question]).filter(Boolean).join(' '),
        meta: 'Weekly read', page: 'today', ref: day, saved: day, entities: []
      });
    });

    // Records a caller builds itself, in the row shape above: Ask Daybook's
    // About you rows (his profile boxes and what Daybook has picked up from him).
    arr(input.records).forEach(function (row) { add(index, seen, row); });

    // Your numbers: each published figure, and each watch (what is due when).
    arr(input.grounding && input.grounding.facts).forEach(function (fact) {
      add(index, seen, {
        id: 'numbers:' + text(fact && fact.recordId), source: 'Numbers', title: fact && fact.title, detail: fact && fact.display,
        meta: [fact && fact.jurisdiction, fact && fact.observationKey, fact && fact.lifecycle].filter(Boolean).join(' · '),
        page: 'evidence', ref: fact && fact.seriesId, saved: fact && fact.publishedAt, entities: []
      });
    });
    arr(input.grounding && input.grounding.watch).forEach(function (watch) {
      add(index, seen, {
        id: 'numbers-watch:' + text(watch && watch.watchId), source: 'Numbers', title: watch && watch.title,
        detail: [watch && watch.state, watch && watch.expectedBy ? 'expected by ' + text(watch.expectedBy).slice(0, 10) : ''].filter(Boolean).join(' · '),
        body: watch && watch.detail, meta: 'Watch', page: 'evidence', ref: watch && watch.seriesId,
        saved: watch && watch.stateChangedAt, entities: []
      });
    });

    // Radar: one record per name, carrying what its card shows, so Search and
    // Ask can answer from it. rank (the score) orders names a lookup matches
    // equally, so "the radar" reads the top names, not the alphabet.
    var radar = input.radar || {}, picks = radarPicks(radar);
    var buckets = input.radarJournal && input.radarJournal.byScoreBucket;
    // rank 1000 puts it ahead of every name a lookup matches equally.
    add(index, seen, radarOverview(radar, buckets));
    arr(radar.signals).forEach(function (signal) {
      signal = signal || {};
      var symbol = text(signal.symbol);
      add(index, seen, {
        id: 'radar:' + symbol, source: 'Radar',
        title: symbol + (signal.name ? ' · ' + text(signal.name) : ''),
        // Labelled, so the scan's computed reason is never mistaken for the
        // AI-written read that follows it.
        detail: signal.why ? 'Score reason: ' + text(signal.why) : (signal.catalyst ? 'Catalyst: ' + text(signal.catalyst) : ''),
        body: radarBody(signal, buckets),
        // "early" here is the card's early chip; the score's reason says
        // "an early, still-forming move" of any forming name.
        meta: [picks[symbol], signal.status, signal.early === true ? 'early' : '', signal.score != null ? 'score ' + signal.score : ''].filter(Boolean).join(' · '),
        page: 'radar', ref: symbol, saved: radar.generatedAt || radar.asOf, rank: signal.score,
        entities: [
          {label:signal.symbol,type:'asset'}, {label:signal.name,type:'company'},
          {label:signal.sector,type:'topic'}, {label:signal.theme,type:'topic'}
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

    // Daily Boost reflections: one row per day, found by the note's words or the
    // headlines of the briefing stories that day was about.
    arr(input.reflections).forEach(function (entry) {
      add(index, seen, {
        id: 'reflection:' + text(entry && entry.day), source: 'Reflections',
        title: [text(entry && entry.label), text(entry && entry.spark)].filter(Boolean).join(' · ') || 'Reflection',
        detail: entry && entry.note,
        body: entry && [entry.note].concat(arr(entry.stories)).filter(Boolean).join(' '),
        meta: [entry && entry.theme, entry && entry.done ? 'small win' : ''].filter(Boolean).join(' · '),
        page: 'today', ref: entry && entry.day, saved: entry && entry.day,
        entities: []
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
      if (source && normalized(item.source) !== source) return false;
      var words = wordsOf(item);
      return tokens.every(function (token) { return hasWord(words, token); });
    }).map(function (item) {
      var title = normalized(item.title), titleWords = wordText(item.title), sourceName = wordText(item.source).trim();
      var detail = normalized(item.detail), detailWords = wordText(item.detail);
      var score = title === phrase ? 120 : (title.indexOf(phrase) === 0 ? 75 : (title.indexOf(phrase) >= 0 ? 55 : 0));
      if (detail.indexOf(phrase) >= 0) score += 24;
      if (item.searchText.indexOf(phrase) >= 0) score += 14;
      tokens.forEach(function (token) {
        score += hasWord(titleWords, token) || token === sourceName ? 13 : (hasWord(detailWords, token) ? 6 : 2);
      });
      var ageDays = item.saved ? Math.max(0, now - item.saved) / 86400000 : 365;
      score += Math.max(0, 8 - Math.min(8, ageDays / 7));
      return Object.assign({}, item, {score: Math.round(score * 10) / 10, excerpt: excerpt(item, phrase)});
    }).sort(function (a, b) {
      return b.score - a.score || b.saved - a.saved || (b.rank || 0) - (a.rank || 0) || a.title.localeCompare(b.title);
    }).slice(0, limit);
  }

  // Ask Daybook's lookup: a plan of terms (any may match; a term may be a
  // phrase such as "heavy vehicle"), optionally narrowed to sources and a date
  // window. Unlike search(), a question's filler words never sink it, because
  // the plan carries only the terms that matter. Ranked by how many terms a
  // record carries, title hits next, then recency.
  var MAX_PLAN_TERMS = 8;
  function searchPlan(index, plan, options) {
    plan = plan || {};
    options = options || {};
    var terms = [];
    arr(plan.terms).forEach(function (term) {
      var clean = wordText(term).trim();
      if (clean.length >= 2 && terms.indexOf(clean) < 0 && terms.length < MAX_PLAN_TERMS) terms.push(clean);
    });
    if (!terms.length) return [];
    var sources = arr(plan.sources).map(normalized).filter(Boolean);
    var since = dateValue(plan.since), until = dateValue(plan.until);
    if (until && /^\d{4}-\d{2}-\d{2}$/.test(text(plan.until))) until += 86399999;  // the whole of that day
    var now = Number.isFinite(options.now) ? options.now : Date.now();
    var limit = Math.max(1, Math.min(40, Number(plan.limit) || 20));
    return arr(index).map(function (item) {
      if (sources.length && sources.indexOf(normalized(item.source)) < 0) return null;
      if (item.saved && ((since && item.saved < since) || (until && item.saved > until))) return null;
      var words = wordsOf(item), titleWords = wordText(item.title), sourceName = wordText(item.source).trim(), matched = [], inTitle = 0;
      terms.forEach(function (term) {
        if (!hasWord(words, term)) return;
        matched.push(term);
        // A term that names the record's source ("radar", "news") counts like a
        // title hit: the source is the record's heading in the app. Without
        // it, "radar" ranks the NBA Momentum Radar games level with the Radar.
        if (hasWord(titleWords, term) || term === sourceName) inTitle++;
      });
      if (!matched.length) return null;
      var ageDays = item.saved ? Math.max(0, now - item.saved) / 86400000 : 365;
      var score = matched.length * 20 + inTitle * 12 + Math.max(0, 8 - Math.min(8, ageDays / 7));
      return Object.assign({}, item, {score: Math.round(score * 10) / 10, matched: matched, excerpt: excerpt(item, matched[0])});
    }).filter(Boolean).sort(function (a, b) {
      return b.score - a.score || b.saved - a.saved || (b.rank || 0) - (a.rank || 0) || a.title.localeCompare(b.title);
    }).slice(0, limit);
  }

  var api = {buildIndex: buildIndex, search: search, searchPlan: searchPlan, normalized: normalized, stripCiteMarkers: stripCiteMarkers, MAX_PLAN_TERMS: MAX_PLAN_TERMS};
  root.IntelligenceSearchCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
