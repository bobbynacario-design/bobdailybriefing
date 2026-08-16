(function (root) {
  'use strict';

  var MAX_RESULTS = 150;
  var MAX_CATALOG = 100;

  function arr(value) { return Array.isArray(value) ? value : []; }
  function text(value, limit) {
    var result = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return limit && result.length > limit ? result.slice(0, limit) : result;
  }
  function normalized(value) {
    var result = text(value).toLowerCase();
    try { result = result.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (error) {}
    return result;
  }
  function entityRows(item) {
    return arr(item && item.entities).map(function (entry) {
      return {
        label: text(entry && typeof entry === 'object' ? entry.label : entry, 100),
        type: text(entry && typeof entry === 'object' ? entry.type : '', 30) || 'topic'
      };
    }).filter(function (entry) { return entry.label.length >= 2; });
  }
  function tokens(query) {
    return normalized(query).split(/[^a-z0-9]+/).filter(function (token) { return token.length >= 2; });
  }
  function matches(item, phrase, queryTokens) {
    if (entityRows(item).some(function (entry) { return normalized(entry.label) === phrase; })) return true;
    var haystack = item && item.searchText ? normalized(item.searchText) : normalized([
      item && item.source, item && item.title, item && item.detail, item && item.body, item && item.meta,
      entityRows(item).map(function (entry) { return entry.label; }).join(' ')
    ].join(' '));
    return queryTokens.every(function (token) { return haystack.indexOf(token) >= 0; });
  }

  function catalog(index, options) {
    options = options || {};
    var grouped = {};
    arr(index).forEach(function (item) {
      entityRows(item).forEach(function (entry) {
        var key = normalized(entry.label);
        if (!key || key.length < 2) return;
        if (!grouped[key]) grouped[key] = {key:key,label:entry.label,type:entry.type,records:0,sources:{},lastSeen:0};
        grouped[key].records++;
        grouped[key].sources[text(item && item.source, 40) || 'Other'] = true;
        grouped[key].lastSeen = Math.max(grouped[key].lastSeen, Number(item && item.saved) || 0);
      });
    });
    var limit = Math.max(1, Math.min(MAX_CATALOG, Number(options.limit) || 30));
    return Object.keys(grouped).map(function (key) {
      var row = grouped[key];
      return {key:row.key,label:row.label,type:row.type,records:row.records,sources:Object.keys(row.sources).sort(),lastSeen:row.lastSeen};
    }).sort(function (a, b) {
      return b.records - a.records || b.sources.length - a.sources.length || b.lastSeen - a.lastSeen || a.label.localeCompare(b.label);
    }).slice(0, limit);
  }

  function build(index, query, options) {
    options = options || {};
    var label = text(query, 100);
    var phrase = normalized(label);
    var queryTokens = tokens(label);
    var selectedSource = normalized(options.source || '');
    if (label.length < 2 || !queryTokens.length) return {query:label,entries:[],sources:[],firstSeen:0,lastSeen:0,undated:0,total:0};
    var limit = Math.max(1, Math.min(MAX_RESULTS, Number(options.limit) || 100));
    var entries = arr(index).filter(function (item) {
      return (!selectedSource || normalized(item && item.source) === selectedSource) && matches(item,phrase,queryTokens);
    }).map(function (item) { return Object.assign({}, item); }).sort(function (a, b) {
      return (Number(b.saved) || 0) - (Number(a.saved) || 0) || text(a.source).localeCompare(text(b.source)) || text(a.title).localeCompare(text(b.title));
    }).slice(0, limit);
    var dated = entries.map(function (item) { return Number(item.saved) || 0; }).filter(Boolean);
    var sources = Array.from(new Set(entries.map(function (item) { return text(item.source, 40) || 'Other'; }))).sort();
    return {
      query:label, entries:entries, sources:sources,
      firstSeen:dated.length ? Math.min.apply(Math,dated) : 0,
      lastSeen:dated.length ? Math.max.apply(Math,dated) : 0,
      undated:entries.length - dated.length, total:entries.length
    };
  }

  var api = {catalog:catalog, build:build, normalized:normalized, limits:{results:MAX_RESULTS,catalog:MAX_CATALOG}};
  root.EntityTimelineCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
