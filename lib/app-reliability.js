(function(root) {
  'use strict';
  function cacheKey(uid) { return uid ? 'briefings_bob_cache:' + encodeURIComponent(uid) : null; }
  function metric(value) {
    var raw = String(value == null ? '—' : value).trim();
    var match = raw.match(/^([A-Za-z$₱€£]*\s*[+-]?[\d,]+(?:\.\d+)?(?:\s*%|\s*°?C)?)(.*)$/);
    return match ? {value:match[1].trim(),detail:match[2].trim()} : {value:raw.length > 28 ? 'See details' : raw,detail:raw.length > 28 ? raw : ''};
  }
  function rankedStories(stories) {
    var weights = {high:3,med:2,low:1,none:0};
    return (stories || []).filter(function(s) { return weights[s.score] >= 2; })
      .sort(function(a,b) { return weights[b.score] - weights[a.score] || String(a.headline || a.story && a.story.headline || '').localeCompare(String(b.headline || b.story && b.story.headline || '')); });
  }
  function readSource(loader, fallback, timeoutMs) {
    return new Promise(function(resolve) {
      var done = false;
      var timer = setTimeout(function() { finish({ok:false,value:fallback,error:'Timed out'}); }, timeoutMs || 15000);
      function finish(result) { if (done) return; done = true; clearTimeout(timer); resolve(result); }
      if (!loader) return finish({ok:false,value:fallback,error:'Unavailable'});
      Promise.resolve().then(loader).then(function(value) { finish({ok:true,value:value}); }, function(error) { finish({ok:false,value:fallback,error:error.message || 'Load failed'}); });
    });
  }
  function mergeEvidence(base, local, remote) {
    function equal(a,b) { return JSON.stringify(a) === JSON.stringify(b); }
    function merge(b,l,r,key) {
      if (equal(l,b)) return r;
      if (equal(r,b) || equal(l,r)) return l;
      if (key === 'updatedAt') return String(l) > String(r) ? l : r;
      if (Array.isArray(l) && Array.isArray(r)) {
        var id = key === 'sets' ? 'id' : 'key';
        var maps = [b || [],l,r].map(function(rows) { return new Map(rows.map(function(row) { return [row[id],row]; })); });
        return Array.from(new Set([].concat(Array.from(maps[1].keys()),Array.from(maps[2].keys())))).map(function(k) {
          return merge(maps[0].get(k),maps[1].get(k),maps[2].get(k),k);
        }).filter(function(row) { return row !== undefined; });
      }
      if (l && r && typeof l === 'object' && typeof r === 'object') {
        var result = {};
        Object.keys(Object.assign({},b,l,r)).forEach(function(k) { result[k] = merge(b && b[k],l[k],r[k],k); });
        return result;
      }
      throw new Error('Evidence changed on another device. Export your pending edits, then reload evidence before editing again.');
    }
    return merge(base || {version:1,sets:[]},local,remote || {version:1,sets:[]},'root');
  }
  root.AppReliability = {cacheKey:cacheKey,metric:metric,rankedStories:rankedStories,readSource:readSource,mergeEvidence:mergeEvidence};
})(typeof globalThis !== 'undefined' ? globalThis : this);
