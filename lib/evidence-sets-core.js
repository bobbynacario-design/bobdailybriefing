(function (root) {
  'use strict';

  var MAX_SETS = 12;
  var MAX_ITEMS = 30;

  function arr(value) { return Array.isArray(value) ? value : []; }
  function text(value, limit) {
    var result = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return limit && result.length > limit ? result.slice(0, limit) : result;
  }
  function iso(value) {
    var date = new Date(value || 0);
    return isNaN(date.getTime()) ? '' : date.toISOString();
  }
  function makeKey(item) {
    return text([item && item.source, item && (item.id || item.ref || item.title)].filter(Boolean).join(':'), 260).toLowerCase();
  }
  function normalizeItem(raw) {
    raw = raw || {};
    var key = text(raw.key || makeKey(raw), 260);
    var title = text(raw.title, 220);
    if (!key || !title) return null;
    return {
      key: key,
      id: text(raw.id, 220),
      source: text(raw.source, 40) || 'Other',
      title: title,
      detail: text(raw.detail, 420),
      meta: text(raw.meta, 140),
      page: text(raw.page, 40),
      ref: text(raw.ref, 220),
      capturedAt: iso(raw.capturedAt),
      note: text(raw.note, 500)
    };
  }
  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var seenSets = {};
    var sets = [];
    arr(raw.sets).forEach(function (candidate) {
      if (sets.length >= MAX_SETS) return;
      var id = text(candidate && candidate.id, 120);
      var name = text(candidate && candidate.name, 80);
      if (!id || !name || seenSets[id]) return;
      var seenItems = {};
      var items = [];
      arr(candidate.items).forEach(function (rawItem) {
        var item = normalizeItem(rawItem);
        if (!item || seenItems[item.key] || items.length >= MAX_ITEMS) return;
        seenItems[item.key] = true;
        items.push(item);
      });
      seenSets[id] = true;
      sets.push({
        id: id,
        name: name,
        createdAt: iso(candidate.createdAt),
        updatedAt: iso(candidate.updatedAt),
        items: items
      });
    });
    sets.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    return {version: 1, sets: sets};
  }
  function copy(raw) { return normalize(JSON.parse(JSON.stringify(raw || {}))); }
  function findSet(state, id) { return state.sets.find(function (set) { return set.id === id; }); }
  function result(state, changed, id, error) { return {state: normalize(state), changed: !!changed, id: id || '', error: error || ''}; }

  function createSet(raw, name, now, id) {
    var state = copy(raw);
    name = text(name, 80);
    if (!name) return result(state, false, '', 'Name the evidence set first');
    if (state.sets.length >= MAX_SETS) return result(state, false, '', 'Evidence set limit reached');
    var duplicate = state.sets.find(function (set) { return set.name.toLowerCase() === name.toLowerCase(); });
    if (duplicate) return result(state, false, duplicate.id, 'A set with that name already exists');
    id = text(id, 120) || ('set-' + new Date(now || Date.now()).getTime().toString(36));
    if (findSet(state, id)) return result(state, false, id, 'Evidence set ID already exists');
    var at = iso(now || Date.now());
    state.sets.unshift({id: id, name: name, createdAt: at, updatedAt: at, items: []});
    return result(state, true, id, '');
  }

  function renameSet(raw, id, name, now) {
    var state = copy(raw);
    var set = findSet(state, id);
    name = text(name, 80);
    if (!set) return result(state, false, '', 'Evidence set not found');
    if (!name) return result(state, false, id, 'Name the evidence set first');
    var duplicate = state.sets.find(function (candidate) { return candidate.id !== id && candidate.name.toLowerCase() === name.toLowerCase(); });
    if (duplicate) return result(state, false, id, 'A set with that name already exists');
    if (set.name === name) return result(state, false, id, '');
    set.name = name;
    set.updatedAt = iso(now || Date.now());
    return result(state, true, id, '');
  }

  function deleteSet(raw, id) {
    var state = copy(raw);
    var before = state.sets.length;
    state.sets = state.sets.filter(function (set) { return set.id !== id; });
    return result(state, state.sets.length !== before, '', state.sets.length === before ? 'Evidence set not found' : '');
  }

  function addItem(raw, setId, rawItem, now) {
    var state = copy(raw);
    var set = findSet(state, setId);
    if (!set) return result(state, false, setId, 'Evidence set not found');
    var item = normalizeItem(Object.assign({}, rawItem, {capturedAt: rawItem && rawItem.capturedAt || now || Date.now()}));
    if (!item) return result(state, false, setId, 'Evidence item is incomplete');
    if (set.items.some(function (candidate) { return candidate.key === item.key; })) return result(state, false, setId, 'Item is already in this set');
    if (set.items.length >= MAX_ITEMS) return result(state, false, setId, 'This evidence set is full');
    set.items.unshift(item);
    set.updatedAt = iso(now || Date.now());
    return result(state, true, setId, '');
  }

  function updateNote(raw, setId, key, note, now) {
    var state = copy(raw);
    var set = findSet(state, setId);
    var item = set && set.items.find(function (candidate) { return candidate.key === key; });
    if (!item) return result(state, false, setId, 'Evidence item not found');
    note = text(note, 500);
    if (item.note === note) return result(state, false, setId, '');
    item.note = note;
    set.updatedAt = iso(now || Date.now());
    return result(state, true, setId, '');
  }

  function removeItem(raw, setId, key, now) {
    var state = copy(raw);
    var set = findSet(state, setId);
    if (!set) return result(state, false, setId, 'Evidence set not found');
    var before = set.items.length;
    set.items = set.items.filter(function (item) { return item.key !== key; });
    if (set.items.length === before) return result(state, false, setId, 'Evidence item not found');
    set.updatedAt = iso(now || Date.now());
    return result(state, true, setId, '');
  }

  var api = {
    normalize: normalize,
    createSet: createSet,
    renameSet: renameSet,
    deleteSet: deleteSet,
    addItem: addItem,
    updateNote: updateNote,
    removeItem: removeItem,
    limits: {sets: MAX_SETS, itemsPerSet: MAX_ITEMS}
  };
  root.EvidenceSetsCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
