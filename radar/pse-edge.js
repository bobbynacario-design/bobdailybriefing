// radar/pse-edge.js
//
// Daily prices for PSE-listed stocks from PSE Edge (edge.pse.com.ph), the
// exchange's own disclosure site. Free, no key, in pesos, with about a year of
// daily bars per stock. Found 13 Oct 2026; until then the PSE tab used US OTC
// proxies because Yahoo has no `.PS` stock data.
//
// Three calls, all public pages the PSE Edge site itself uses:
//   symbol -> company id:   GET  /autoComplete/searchCompanyNameSymbol.ax?term=BDO
//   company -> security id, market cap and the page's own figures:
//                           GET  /companyPage/stockData.do?cmpy_id=260
//   daily bars:             POST /common/DisclosureCht.ax {cmpy_id, security_id, startDate, endDate}
// Requests go one at a time with a pause between them, about 60 a day.

var EDGE = 'https://edge.pse.com.ph';
var HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json, text/html' };

async function fetchRetry(url, opts, label) {
  var lastErr;
  for (var i = 0; i < 3; i++) {
    try {
      var res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(20000) }, opts));
      if (res.status >= 500) throw new Error('HTTP ' + res.status);
      return res;
    } catch (e) {
      lastErr = e;
      console.log('  ' + label + ' transient (' + ((e && e.cause && e.cause.code) || e.message) + '), retry ' + (i + 1) + '/3');
      await pause(1500 * (i + 1));
    }
  }
  throw lastErr;
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// "Oct 12, 2026 00:00:00" -> "2026-10-12"
var MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
function edgeDate(s) {
  var m = String(s || '').match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/);
  return m && MONTHS[m[1]] ? m[3] + '-' + MONTHS[m[1]] + '-' + (m[2].length === 1 ? '0' : '') + m[2] : null;
}
// 2026-10-12 -> "10-12-2026", the form the chart endpoint takes.
function edgeQueryDate(iso) { return iso.slice(5, 7) + '-' + iso.slice(8, 10) + '-' + iso.slice(0, 4); }

function num(s) {
  var t = String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/,/g, '').trim();
  return t !== '' && isFinite(Number(t)) ? Number(t) : null;
}

// Chart JSON -> ascending bars. Rows without a close are dropped.
function parseEdgeChart(json) {
  return ((json && json.chartData) || []).map(function (r) {
    return { date: edgeDate(r.CHART_DATE), open: num(r.OPEN), high: num(r.HIGH), low: num(r.LOW), close: num(r.CLOSE), value: num(r.VALUE) };
  }).filter(function (b) { return b.date && b.close != null; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

// The stock page: the security id for `symbol` (a company can list several
// securities, e.g. preferred shares) and the page's own figures, kept so the
// computed numbers can be checked against PSE's.
function parseEdgeStockPage(html, symbol) {
  var securityId = null, re = /<option value="(\d+)"[^>]*>\s*([^<\s]+)\s*<\/option>/g, m;
  while ((m = re.exec(html || ''))) {
    if (m[2].toUpperCase() === String(symbol).toUpperCase()) { securityId = m[1]; break; }
  }
  function field(label) {
    var f = new RegExp('<th>\\s*' + label + '\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>', 'i').exec(html || '');
    return f ? num(f[1]) : null;
  }
  return {
    securityId: securityId,
    marketCap: field('Market Capitalization'),
    lastPrice: field('Last Traded Price'),
    high52: field('52-Week High'),
    low52: field('52-Week Low')
  };
}

async function lookupCompanyId(symbol) {
  var res = await fetchRetry(EDGE + '/autoComplete/searchCompanyNameSymbol.ax?term=' + encodeURIComponent(symbol), { headers: HEADERS }, 'PSE Edge lookup ' + symbol);
  if (!res.ok) throw new Error('lookup HTTP ' + res.status);
  var list = await res.json();
  var hit = (list || []).find(function (c) { return String(c.symbol).toUpperCase() === symbol.toUpperCase(); });
  return hit ? String(hit.cmpyId) : null;
}

async function fetchStockPage(cmpyId, symbol) {
  var res = await fetchRetry(EDGE + '/companyPage/stockData.do?cmpy_id=' + encodeURIComponent(cmpyId), { headers: HEADERS }, 'PSE Edge page ' + symbol);
  if (!res.ok) throw new Error('page HTTP ' + res.status);
  return parseEdgeStockPage(await res.text(), symbol);
}

async function fetchBars(cmpyId, securityId, fromIso, toIso, symbol) {
  var res = await fetchRetry(EDGE + '/common/DisclosureCht.ax', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, HEADERS),
    body: JSON.stringify({ cmpy_id: cmpyId, security_id: securityId, startDate: edgeQueryDate(fromIso), endDate: edgeQueryDate(toIso) })
  }, 'PSE Edge bars ' + symbol);
  if (!res.ok) throw new Error('bars HTTP ' + res.status);
  return parseEdgeChart(await res.json());
}

// One stock: ids (reused from the last doc when known), the page, ~400 days of
// bars. Returns { cmpyId, securityId, page, bars } or throws.
async function fetchEdgeStock(symbol, known, todayIso, days) {
  var cmpyId = known && known.cmpyId;
  if (!cmpyId) { cmpyId = await lookupCompanyId(symbol); await pause(300); }
  if (!cmpyId) throw new Error('not found on PSE Edge');
  var page = await fetchStockPage(cmpyId, symbol);
  var securityId = page.securityId || (known && known.securityId);
  if (!securityId) throw new Error('no security id on the stock page');
  await pause(300);
  var from = new Date(Date.parse(todayIso + 'T00:00:00Z') - (days || 400) * 86400000).toISOString().slice(0, 10);
  var bars = await fetchBars(cmpyId, securityId, from, todayIso, symbol);
  await pause(300);
  return { cmpyId: cmpyId, securityId: securityId, page: page, bars: bars };
}

export { fetchEdgeStock, parseEdgeChart, parseEdgeStockPage, edgeDate, edgeQueryDate };
