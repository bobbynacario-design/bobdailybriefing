// Which markets the panel reads today, and which keep a stored read. PURE.
//
// The panel runs without web search, so asking it again tomorrow with the same
// question gives the same information and only re-rolls noise; the journal
// also locks each market's first read. A stored read is therefore kept until
// it is a week old, the model changes, or the move explanations find dated,
// sourced news after it. Today's edge is still recomputed from today's price.

var DAY = 86400000;

// Dated, sourced news the move explanations found for one market. The driver
// sentence only: the mechanism is inferred from the price move, so passing it
// on would leak the market's direction into a price-blind panel.
function newsEvidence(market) {
  var x = market && market.moveExplanation;
  if (!x || (x.status !== 'reported' && x.status !== 'plausible')) return [];
  var date = String(x.eventDate || '');
  var urls = Array.isArray(x.sourceUrls) ? x.sourceUrls : (Array.isArray(x.sources) ? x.sources.map(function (s) { return s && s.url; }) : []);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !x.driver || !urls.filter(Boolean).length) return [];
  var host = '';
  try { host = new URL(urls.filter(Boolean)[0]).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
  return [{ date: date, text: String(x.driver).slice(0, 300), source: host }];
}

// opts: {model, provider, now (ms or ISO), rereadDays}
// Returns {read: [slug], keep: {slug: panelRead}, reasons: {slug: reason},
// evidence: {slug: [news]}} where reason is new | model | weekly | news.
function planReads(markets, previousDoc, opts) {
  opts = opts || {};
  var now = typeof opts.now === 'number' ? opts.now : Date.parse(opts.now || new Date().toISOString());
  var maxAge = (opts.rereadDays || 7) * DAY;
  var prior = {};
  ((previousDoc && previousDoc.markets) || []).forEach(function (m) { if (m && m.slug) prior[m.slug] = m.panelRead; });
  var plan = { read: [], keep: {}, reasons: {}, evidence: {} };
  (markets || []).forEach(function (m) {
    var p = prior[m.slug], fresh = newsEvidence(m), readAt = p && Date.parse(p.readAt);
    var olderNews = (p && Array.isArray(p.evidence) ? p.evidence : []).filter(function (e) {
      return e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && now - Date.parse(e.date + 'T00:00:00Z') <= 14 * DAY;
    });
    var news = fresh.filter(function (e) { return !(p && p.readAt && e.date < String(p.readAt).slice(0, 10)); });
    var reason = !p || !Array.isArray(p.reads) || !p.reads.length || !isFinite(readAt) ? 'new'
      : p.model !== opts.model || p.provider !== opts.provider ? 'model'
      : (p.resolutionRules || '') !== (m.resolutionRules || '') || (p.resolutionSource || '') !== (m.resolutionSource || '') ? 'rules'
      : now - readAt >= maxAge || readAt > now + 300000 ? 'weekly'
      : news.some(function (e) { return !olderNews.some(function (o) { return o.text === e.text; }); }) ? 'news'
      : '';
    if (!reason) { plan.keep[m.slug] = p; return; }
    plan.read.push(m.slug);
    plan.reasons[m.slug] = reason;
    // What the panel sees: fresh news first, then the last fortnight's.
    var seen = {};
    plan.evidence[m.slug] = fresh.concat(olderNews).filter(function (e) { if (seen[e.text]) return false; seen[e.text] = true; return true; }).slice(0, 3);
  });
  return plan;
}

export { planReads, newsEvidence };
