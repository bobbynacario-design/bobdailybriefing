// radar/pse-events.js
//
// Dividends, company news and IPOs for the PSE tab, from PSE Edge pages the
// site itself uses (found 13 Oct 2026). All public, no key; about 15 requests
// a run:
//   dividends   POST /disclosureData/dividends_and_rights_info_list.ax?DividendsOrRights=Dividends
//               {pageNum} — 50 a page, newest ex-date first, ~18 months in 11 pages
//   news        POST /announcements/search.ax and /financialReports/search.ax
//               {fromDate, toDate, pageNo} — every company's filings in the window
//   IPOs        POST /listingNotices/search.ax {fromDate, toDate, pageNo}
//   documents   https://edge.pse.com.ph/openDiscViewer.do?edge_no=<id>
// Parsers and the summaries are pure (tested in pse-events.test.js); the
// fetches are below them.

var EDGE = 'https://edge.pse.com.ph';
var HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded' };

// ── parsing ──
function text(html) { return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&#039;/g, '’').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }

// Every table row: its cells' text, the company id and the document id it links.
function parseEdgeTable(html) {
  var pg = /\[\s*(\d+)\s*\/\s*(\d+)\s*\]/.exec(html || '');
  var rows = [];
  var re = /<tr[^>]*>([\s\S]*?)<\/tr>/g, m;
  while ((m = re.exec(html || ''))) {
    var cells = [], c, cre = /<td[^>]*>([\s\S]*?)<\/td>/g;
    while ((c = cre.exec(m[1]))) cells.push(text(c[1]));
    if (cells.length < 2) continue;
    var cmpy = /cmpy_id=(\d+)/.exec(m[1]), edge = /openPopup\('([0-9a-f]{16,64})'\)/.exec(m[1]);
    rows.push({ cells: cells, cmpyId: cmpy ? cmpy[1] : null, edgeNo: edge ? edge[1] : null });
  }
  return { page: pg ? Number(pg[1]) : 1, pages: pg ? Number(pg[2]) : 1, rows: rows };
}

var MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
// "Feb 08, 2027" / "Feb 9, 2027" -> "2027-02-08"; anything else (TBA, N/A) -> null
function edgeDay(s) {
  var m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})/.exec(String(s || '').trim());
  return m && MON[m[1].toLowerCase()] ? m[3] + '-' + MON[m[1].toLowerCase()] + '-' + (m[2].length === 1 ? '0' : '') + m[2] : null;
}
// "Oct 12, 2026 09:41 AM" -> "2026-10-12T09:41" (Manila time, as PSE Edge shows it)
function edgeStamp(s) {
  var day = edgeDay(s), t = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(String(s || ''));
  if (!day) return null;
  if (!t) return day + 'T00:00';
  var h = Number(t[1]) % 12 + (/p/i.test(t[3]) ? 12 : 0);
  return day + 'T' + (h < 10 ? '0' : '') + h + ':' + t[2];
}

// "Thirty", "Eighty Three", "One Hundred Twenty" -> number (under 1000), else null.
var WORD_NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordsToNumber(words) {
  var total = 0, any = false, parts = String(words || '').toLowerCase().split(/[\s-]+/).filter(Boolean);
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === 'and') continue;
    if (parts[i] === 'hundred') { total = (total || 1) * 100; continue; }
    if (!(parts[i] in WORD_NUM)) return null;
    total += WORD_NUM[parts[i]]; any = true;
  }
  return any ? total : null;
}

// Peso amount per share from PSE Edge's free-text rate: "Php 1.75 per share",
// "P0.50", "Php0.38/share", "0.1117/share", "Eighty Three Centavos (Php 0.83)",
// "Thirty Centavos", or a bare number. Several peso amounts (a regular and a
// special) are added, unless the text quotes a total. Foreign currency or a
// percentage: null.
function pesoAmount(rate) {
  var t = String(rate || '').trim();
  if (!t || /\$|usd|cad|%|percent/i.test(t)) return null;
  var bare = /^([0-9]*\.?[0-9]+)\s*(?:\/\s*share|per\s+(?:common\s+)?share)?$/i.exec(t);
  if (bare) return Number(bare[1]);
  var re = /(?:\bphp|\bp|₱)\s?([0-9][0-9,]*(?:\.[0-9]+)?)/gi, m, sum = 0, n = 0;
  while ((m = re.exec(t))) { sum += Number(m[1].replace(/,/g, '')); n++; if (/total/i.test(t)) break; }
  if (n) return Math.round(sum * 1e6) / 1e6;
  var w = /^([a-z\s-]+?)\s+(centavos?|pesos?)\b/i.exec(t), v = w ? wordsToNumber(w[1]) : null;
  return v == null ? null : /centavo/i.test(w[2]) ? v / 100 : v;
}

function parseDividends(html) {
  var t = parseEdgeTable(html);
  return {
    page: t.page, pages: t.pages,
    items: t.rows.filter(function (r) { return r.cells.length >= 8; }).map(function (r) {
      var c = r.cells;
      return {
        cmpyId: r.cmpyId, company: c[0], security: c[1], type: c[2], rate: c[3],
        amount: /cash/i.test(c[2]) ? pesoAmount(c[3]) : null,
        exDate: edgeDay(c[4]), recordDate: edgeDay(c[5]), payDate: edgeDay(c[6]), circular: c[7], edgeNo: r.edgeNo
      };
    })
  };
}

// Announcements and financial reports share a layout:
// company | template | form number | announced | circular.
function parseFilings(html) {
  var t = parseEdgeTable(html);
  return {
    page: t.page, pages: t.pages,
    items: t.rows.filter(function (r) { return r.cells.length >= 5 && r.cmpyId; }).map(function (r) {
      var c = r.cells;
      return { cmpyId: r.cmpyId, company: c[0], template: c[1], form: c[2], at: edgeStamp(c[3]), circular: c[4], edgeNo: r.edgeNo };
    })
  };
}

// Listing notices: subject | announced | notice number.
function parseNotices(html) {
  var t = parseEdgeTable(html);
  return {
    page: t.page, pages: t.pages,
    items: t.rows.filter(function (r) { return r.cells.length >= 3; }).map(function (r) {
      return { subject: r.cells[0], at: edgeStamp(r.cells[1]), notice: r.cells[2], edgeNo: r.edgeNo };
    })
  };
}

// The filings worth a beginner's attention, by template ("[Amend-2]" prefixes
// ignored). Director share trades, share-count changes and the like are left out.
var NEWS_KINDS = [
  ['results', /^(quarterly|annual) report/i, 'Quarterly or annual report'],
  ['dividend', /declaration of (cash|stock|property) dividend/i, 'Dividend declared'],
  ['material', /material information/i, 'Material information'],
  ['buyback', /buy-?back/i, 'Share buyback'],
  ['clarify', /clarification of news/i, 'Clarification of news reports'],
  ['meeting', /stockholders.{0,3} meeting/i, 'Stockholders’ meeting'],
  ['press', /press release/i, 'Press release']
];
function newsKind(template) {
  var t = String(template || '').replace(/^\s*\[amend-\d+\]\s*/i, '');
  for (var i = 0; i < NEWS_KINDS.length; i++) if (NEWS_KINDS[i][1].test(t)) return { kind: NEWS_KINDS[i][0], label: NEWS_KINDS[i][2], amended: t !== String(template || '').trim() };
  return null;
}

// ── summaries ──
function isoAdd(iso, days) { return new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10); }
// The nth weekday after `iso` (PSE holidays aside).
function addSessions(iso, n) {
  var d = iso, k = 0;
  while (k < n) { d = isoAdd(d, 1); var wd = new Date(d + 'T00:00:00Z').getUTCDay(); if (wd !== 0 && wd !== 6) k++; }
  return d;
}
function isCommon(div) { return /common/i.test(div.security || ''); }

// One company's dividend picture on `asOf`: cash paid per common share with
// ex-dates in the last 365 days, the yield that is on `close`, and the next
// ex-date. Duplicate circulars (re-posted rows) count once.
function dividendStats(divs, cmpyId, asOf, close) {
  var seen = {}, mine = (divs || []).filter(function (d) {
    if (d.cmpyId !== cmpyId || !isCommon(d) || !d.exDate) return false;
    var key = d.circular || (d.exDate + d.rate);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
  var from = isoAdd(asOf, -365);
  var paid = mine.filter(function (d) { return d.exDate > from && d.exDate <= asOf && /cash/i.test(d.type); });
  var known = paid.filter(function (d) { return d.amount != null; });
  var total = known.reduce(function (a, d) { return a + d.amount; }, 0);
  var upcoming = mine.filter(function (d) { return d.exDate > asOf; }).sort(function (a, b) { return a.exDate < b.exDate ? -1 : 1; });
  var next = upcoming[0] || null;
  return {
    div12m: known.length ? Math.round(total * 1e4) / 1e4 : null,
    div12mCount: paid.length,
    div12mPartial: known.length < paid.length,        // a rate we could not read
    yield12m: known.length && close ? Math.round(total / close * 1e4) / 100 : null,
    nextEx: next ? { exDate: next.exDate, payDate: next.payDate, type: next.type, rate: next.rate, amount: next.amount, edgeNo: next.edgeNo } : null
  };
}

// IPO notices grouped by company ("Mynt, Inc.: Initial Public Offering – Final
// Prospectus"), newest company first, only those with a notice in 90 days.
function ipoGroups(notices, today) {
  var groups = {}, from = isoAdd(today, -90);
  (notices || []).forEach(function (n) {
    if (!/initial public offering|\bipo\b/i.test(n.subject || '')) return;
    var subject = String(n.subject).replace(/^\s*\[amend-\d+\]\s*/i, '');
    var m = /^(.+?)\s*[:–—-]\s*(?:initial public offering|ipo)\b\s*[–—:-]?\s*(.*)$/i.exec(subject);
    var company = m ? m[1].trim() : subject, title = (m && m[2] ? m[2].trim() : subject) + (subject !== String(n.subject).trim() ? ' (amended)' : '');
    (groups[company] = groups[company] || []).push({ title: title, at: n.at, notice: n.notice, edgeNo: n.edgeNo });
  });
  return Object.keys(groups).map(function (k) {
    var list = groups[k].sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    return { company: k, latestAt: list[0].at, notices: list.slice(0, 8) };
  }).filter(function (g) { return g.latestAt && g.latestAt.slice(0, 10) >= from; })
    .sort(function (a, b) { return a.latestAt < b.latestAt ? 1 : -1; });
}

// Company news for a set of company ids, newest first. A company buying back
// its shares files a report most days; only its latest one is kept.
function newsFor(filings, cmpyIds, sinceIso, cap) {
  var want = {}, seen = {};
  (cmpyIds || []).forEach(function (id) { if (id) want[id] = true; });
  return (filings || []).filter(function (f) {
    return want[f.cmpyId] && f.at && f.at > sinceIso && newsKind(f.template);
  }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }).filter(function (f) {
    var k = newsKind(f.template);
    var key = k.kind === 'buyback' ? 'buyback:' + f.cmpyId : (f.circular || f.edgeNo || (f.cmpyId + f.at + f.template));
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).map(function (f) {
    var k = newsKind(f.template);
    return { cmpyId: f.cmpyId, company: f.company, kind: k.kind, label: k.label + (k.amended ? ' (amended)' : ''), template: f.template, at: f.at, edgeNo: f.edgeNo };
  }).slice(0, cap || 40);
}

// Adds the dividend picture to each board row and returns the doc's `events`:
// upcoming ex-dates among the board (45 days), the board's news (14 days), IPOs.
function applyEvents(board, raw, asOf, today) {
  raw = raw || {};
  var bySym = {}, cmpyIds = [];
  (board || []).forEach(function (s) {
    bySym[s.cmpyId] = s;
    cmpyIds.push(s.cmpyId);
    if (raw.dividends) Object.assign(s, dividendStats(raw.dividends, s.cmpyId, asOf, s.close));
  });
  var horizon = isoAdd(asOf, 45);
  var upcoming = (board || []).filter(function (s) { return s.nextEx && s.nextEx.exDate <= horizon; })
    .map(function (s) { return Object.assign({ symbol: s.symbol, name: s.name, yield12m: s.yield12m }, s.nextEx); })
    .sort(function (a, b) { return a.exDate < b.exDate ? -1 : 1; });
  var news = newsFor(raw.filings, cmpyIds, isoAdd(today, -14) + 'T23:59', 40).map(function (n) {
    return Object.assign({ symbol: bySym[n.cmpyId] ? bySym[n.cmpyId].symbol : null }, n);
  });
  return {
    dividends: raw.dividends ? upcoming : null,
    news: raw.filings ? news : null,
    ipos: raw.notices ? ipoGroups(raw.notices, today) : null,
    failed: raw.failed || [],
    checkedAt: new Date().toISOString()
  };
}

// Event alerts for one watchlist, after the price alerts (pse-watch.js):
//   exdiv  the next session is the last day to buy and still get a declared
//          cash dividend (the ex-date is the session after it)
//   news   a filing worth reading since the list was last refreshed
// One of each per stock at most.
function watchEventAlerts(items, rows, raw, asOf, sinceIso) {
  raw = raw || {};
  var out = [], lastBuy = addSessions(asOf, 1), exDay = addSessions(asOf, 2);
  Object.keys(items || {}).sort().forEach(function (sym) {
    var r = rows && rows[sym];
    if (!r || !r.cmpyId) return;
    var d = raw.dividends ? dividendStats(raw.dividends, r.cmpyId, asOf, r.close).nextEx : null;
    if (d && d.exDate === exDay && /cash/i.test(d.type || '')) {
      out.push({ symbol: sym, kind: 'exdiv', text: sym + ' goes ex-dividend ' + shortDay(exDay) + ': own it by the ' + shortDay(lastBuy) + ' close to get ' +
        (d.amount != null ? '₱' + d.amount + ' a share' : 'the ' + d.rate + ' dividend') });
    }
    // Daily buyback reports are not news worth a push.
    var n = raw.filings ? newsFor(raw.filings, [r.cmpyId], sinceIso, 10).filter(function (x) { return x.kind !== 'buyback'; })[0] : null;
    if (n) out.push({ symbol: sym, kind: 'news', text: sym + ': ' + n.label.toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }) + ' (' + shortDay(n.at.slice(0, 10)) + ')', edgeNo: n.edgeNo });
  });
  return out;
}
var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDay(iso) { return Number(iso.slice(8, 10)) + ' ' + MONTH_NAMES[Number(iso.slice(5, 7)) - 1]; }

// ── fetching ──
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function q(iso) { return iso.slice(5, 7) + '-' + iso.slice(8, 10) + '-' + iso.slice(0, 4); }
async function post(path, body, label) {
  var lastErr;
  for (var i = 0; i < 3; i++) {
    try {
      var res = await fetch(EDGE + path, { method: 'POST', headers: HEADERS, body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      lastErr = e;
      console.log('  ' + label + ' transient (' + ((e && e.cause && e.cause.code) || e.message) + '), retry ' + (i + 1) + '/3');
      await pause(1500 * (i + 1));
    }
  }
  throw lastErr;
}
// Pages until `enough(items)` says stop or `cap` pages, one at a time.
async function pages(path, body, parse, label, cap, enough) {
  var all = [];
  for (var p = 1; p <= cap; p++) {
    var got = parse(await post(path, Object.assign({}, body, { pageNo: String(p), pageNum: String(p) }), label));
    all = all.concat(got.items);
    if (p >= got.pages || !got.items.length || (enough && enough(got.items))) break;
    await pause(400);
  }
  return all;
}

// Everything the summaries need. Each source can fail alone; `failed` names it.
async function fetchEvents(today) {
  var raw = { failed: [] }, base = { sortType: '', dateSortType: 'DESC', cmpySortType: 'ASC', keyword: '', companyId: '', tmplNm: '' };
  try {
    var oldest = isoAdd(today, -380);
    raw.dividends = await pages('/disclosureData/dividends_and_rights_info_list.ax?DividendsOrRights=Dividends',
      { sortMode: 'date', dateSortType: 'DESC', cmpySortType: 'ASC' }, parseDividends, 'PSE Edge dividends', 12,
      function (items) { var last = items[items.length - 1]; return last && last.exDate && last.exDate < oldest; });
  } catch (e) { raw.failed.push('dividends'); }
  try {
    var win = Object.assign({}, base, { fromDate: q(isoAdd(today, -15)), toDate: q(today) });
    var ann = await pages('/announcements/search.ax', win, parseFilings, 'PSE Edge announcements', 8);
    await pause(400);
    var fin = await pages('/financialReports/search.ax', win, parseFilings, 'PSE Edge reports', 4);
    raw.filings = ann.concat(fin);
  } catch (e) { raw.failed.push('news'); }
  try {
    raw.notices = await pages('/listingNotices/search.ax', Object.assign({}, base, { fromDate: q(isoAdd(today, -100)), toDate: q(today) }),
      parseNotices, 'PSE Edge listing notices', 4);
  } catch (e) { raw.failed.push('ipos'); }
  return raw;
}

export {
  parseEdgeTable, edgeDay, edgeStamp, pesoAmount, parseDividends, parseFilings, parseNotices, newsKind,
  addSessions, dividendStats, ipoGroups, newsFor, applyEvents, watchEventAlerts, fetchEvents
};
