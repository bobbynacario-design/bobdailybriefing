'use strict';
// NSW distributors' quoted-service labour rates, field worker (R4), excl GST
// (docs/grounding-phase-h.md, H-7b; Bob's D-H7b-1 to D-H7b-4). The AER sets
// maximum labour rates for alternative control services in each network's
// 2024-29 determination; each network publishes the year's in its price list.
// The figures are captured by hand into reviewed files in grounding/manual/,
// one per series, FY2025-26 and FY2026-27. This module is the automated WATCH,
// one per network, because each publishes differently:
//   - Ausgrid: its Network prices page carries the documents in its JSON, each
//     with a title, a link and a modify date. A new year, a new link or a
//     later date turns the series stale.
//   - Endeavour Energy: its Connection costs page links "<year> Ancillary
//     Network Services Price List". A new year or a new file (the version is
//     in the name) turns the series stale.
//   - Essential Energy: its pages are behind a Cloudflare challenge, which is
//     not bypassed, but its PDFs answer directly under a predictable name. The
//     watch asks for the captured file's headers (a later Last-Modified is a
//     revision) and for next year's name (a PDF there is a new schedule).
//     A wrong name answers 200 with an HTML page, so only a PDF counts.
// Nothing captured: "awaiting publication". A page or file that does not read
// as expected: "blocked", and the capture stands.
// No network licenses its price list; Ausgrid's website terms reserve
// reproduction. Bob chose short quotes with attribution (D-H7b-4), as for SA
// Power Networks, and no copy of any PDF is kept.

const fs = require('fs');
const path = require('path');

const NETWORKS = Object.freeze({
  ausgrid: {
    publisher: 'Ausgrid', name: 'Ausgrid',
    listingUrl: 'https://www.ausgrid.com.au/about-us/regulation-and-compliance/network-prices',
  },
  endeavour: {
    publisher: 'Endeavour Energy', name: 'Endeavour Energy',
    listingUrl: 'https://www.endeavourenergy.com.au/for-your-business/request-a-connection-or-upgrade/connection-costs',
  },
  essential: {
    publisher: 'Essential Energy', name: 'Essential Energy',
    listingUrl: 'https://www.essentialenergy.com.au/our-network/network-pricing-and-regulatory-reporting/network-pricing',
    fileBase: 'https://www.essentialenergy.com.au/-/media/Project/EssentialEnergy/Website/Files/Our-Network/AncillaryNetworkServicesPriceList',
  },
});
// The short names (title up to " (") differ within each network, so Your
// numbers tells the two Endeavour and the two Essential rows apart.
const SERIES = Object.freeze([
  { network: 'ausgrid', seriesId: 'ausgrid_quoted_labour_field_worker_ordinary', row: 'Field worker R4', when: 'ordinary',
    title: 'Ausgrid Field worker R4 labour rate, business hours (quoted services, excl GST)' },
  { network: 'endeavour', seriesId: 'endeavour_quoted_labour_field_worker_outdoor_ordinary', row: 'Field Worker R4 (Outdoor)', when: 'ordinary',
    title: 'Endeavour Energy outdoor Field Worker R4 labour rate, business hours (quoted services, excl GST)' },
  { network: 'endeavour', seriesId: 'endeavour_quoted_labour_field_worker_outdoor_after_hours', row: 'Field Worker R4 (Outdoor)', when: 'after hours',
    title: 'Endeavour Energy outdoor Field Worker R4 labour rate, after hours (quoted services, excl GST)' },
  { network: 'essential', seriesId: 'essential_quoted_labour_field_worker_ordinary', row: 'Field Worker (R4)', when: 'ordinary',
    title: 'Essential Energy Field Worker R4 labour rate, normal time (quoted services, excl GST)' },
  { network: 'essential', seriesId: 'essential_quoted_labour_field_worker_overtime', row: 'Field Worker (R4)', when: 'overtime',
    title: 'Essential Energy Field Worker R4 labour rate, overtime (quoted services, excl GST)' },
]);

function licenceFor(network, url) {
  const n = NETWORKS[network];
  return '© ' + n.publisher + '. Quoted in part for citation only (Copyright Act 1968); no licence to reproduce is given. Full document: ' + url;
}

// "2026-27" or "2025-2026" -> "2026-27", or null.
function editionOf(text) {
  const m = /(\d{4})\s*[-–]\s*(\d{2,4})/.exec(String(text || ''));
  if (!m) return null;
  const next = String(Number(m[1]) + 1);
  return m[2] === next || m[2] === next.slice(2) ? m[1] + '-' + next.slice(2) : null;
}
const editionFrom = (effectiveFrom) => {
  const y = Number(String(effectiveFrom || '').slice(0, 4));
  return y ? y + '-' + String(y + 1).slice(2) : null;
};
const nextEdition = (edition) => { const y = Number(edition.slice(0, 4)) + 1; return y + '-' + String(y + 1).slice(2); };

// Ausgrid's page: [{ text, href, date, edition }] for its alternative control
// services documents, newest edition first; null when there are none.
function parseAusgrid(html) {
  if (typeof html !== 'string') return null;
  const entries = [];
  const seen = {};
  for (const m of html.matchAll(/\{[^{}]*"href":"[^"]+"[^{}]*\}/g)) {
    const obj = m[0];
    const text = (/"text":"([^"]+)"/.exec(obj) || [])[1];
    const href = (/"href":"([^"]+)"/.exec(obj) || [])[1];
    const when = /"history-modify-date":"(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(obj);
    if (!text || !href || !/Alternative control services (Price List|fee schedule)/i.test(text)) continue;
    const edition = editionOf(text);
    if (!edition || !when || seen[href]) continue;
    seen[href] = true;
    entries.push({ text, href, edition, date: when[3] + '-' + when[1].padStart(2, '0') + '-' + when[2].padStart(2, '0') });
  }
  return entries.length ? entries.sort((a, b) => (a.edition < b.edition ? 1 : -1)) : null;
}

// Endeavour's page: the one "<year> Ancillary Network Services Price List" link
// (not the Summary): { text, href, edition }, or null.
function parseEndeavour(html) {
  if (typeof html !== 'string') return null;
  const links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }))
    .filter((l) => /^\d{4}-\d{2} Ancillary Network Services Price List$/.test(l.text));
  const unique = [...new Set(links.map((l) => l.href))];
  if (unique.length !== 1) return null;
  const link = links[0];
  return Object.assign({}, link, { edition: editionOf(link.text) });
}

// What a reviewed capture was read from: [{ edition, url, asOf }].
function capturedEditions(file) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; }
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((o) => o && Array.isArray(o.evidence)).map((o) => {
    const ev = o.evidence.find((e) => e.role === 'release') || o.evidence[0] || {};
    return { edition: editionFrom(o.effectiveFrom), url: ev.url, asOf: ev.asOf };
  });
}
const latestOf = (captured) => captured.reduce((a, b) => (!a || b.edition > a.edition ? b : a), null);

const header = (res, name) => (res && res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null) || '';
const isPdf = (res) => /application\/pdf/i.test(header(res, 'content-type'));
const httpDay = (text) => { const t = Date.parse(text); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null; };

// Each network's source is read once per publisher run, for its series.
const runs = new WeakMap();
function once(ctx, key, read) {
  let byKey = runs.get(ctx.fetch);
  if (!byKey || byKey.now !== ctx.now) { byKey = { now: ctx.now, results: {} }; runs.set(ctx.fetch, byKey); }
  if (!byKey.results[key]) byKey.results[key] = read();
  return byKey.results[key];
}
async function pageText(ctx, url) { return Buffer.from(await (await ctx.fetch(url)).arrayBuffer()).toString('utf8'); }

const status = (state, url, detail) => ({ observations: [], status: { state, url, detail } });

function watcherFor(series) {
  const net = NETWORKS[series.network];
  const fix = ' Check the ' + series.row + ' ' + (series.when === 'ordinary' ? '' : series.when + ' ') + 'rate and capture it in grounding/manual/' + series.seriesId + '.json.';
  return async function watchNswLabour(ctx) {
    const manualDir = ctx.manualDir || path.join(__dirname, '..', 'manual');
    const captured = capturedEditions(path.join(manualDir, series.seriesId + '.json'));
    const latest = latestOf(captured);

    if (series.network === 'ausgrid') {
      const entries = await once(ctx, 'ausgrid', async () => parseAusgrid(await pageText(ctx, net.listingUrl)));
      if (!entries) return status('blocked', net.listingUrl, 'Ausgrid\'s Network prices page lists no alternative control services document Daybook can read, so a new fee schedule cannot be checked.');
      const top = entries[0];
      const name = '"' + top.text + '" (modified ' + top.date + ')';
      if (!latest) return status('awaiting_publication', top.href, 'Ausgrid lists ' + name + '; no figure has been captured from it yet.');
      const cap = captured.find((c) => c.edition === top.edition);
      const why = !cap ? 'Ausgrid now lists ' + name + ', which has not been captured.'
        : top.href !== cap.url ? 'Ausgrid has replaced its ' + top.edition + ' fee schedule: ' + name + ' is a new file.'
          : top.date > cap.asOf ? 'Ausgrid has revised its ' + top.edition + ' fee schedule: ' + name + ', after the capture of ' + cap.asOf + '.'
            : null;
      return why ? status('stale', top.href, why + fix) : { observations: [] };
    }

    if (series.network === 'endeavour') {
      const link = await once(ctx, 'endeavour', async () => parseEndeavour(await pageText(ctx, net.listingUrl)));
      if (!link || !link.edition) return status('blocked', net.listingUrl, 'Endeavour Energy\'s Connection costs page has no single Ancillary Network Services Price List link Daybook can read, so a new price list cannot be checked.');
      const file = decodeURIComponent(link.href.split('/').pop());
      if (!latest) return status('awaiting_publication', link.href, 'Endeavour Energy lists its ' + link.edition + ' price list (' + file + '); no figure has been captured from it yet.');
      const cap = captured.find((c) => c.edition === link.edition);
      const why = !cap ? 'Endeavour Energy now lists its ' + link.edition + ' price list (' + file + '), which has not been captured.'
        : link.href !== cap.url ? 'Endeavour Energy has issued a new version of its ' + link.edition + ' price list: ' + file + '.'
          : null;
      return why ? status('stale', link.href, why + fix) : { observations: [] };
    }

    // Essential Energy: headers only, of the captured file and of next year's name.
    if (!latest) return status('awaiting_publication', net.listingUrl, 'No Essential Energy figure has been captured yet.');
    const heads = await once(ctx, 'essential:' + latest.url, async () => {
      const current = await ctx.fetch(latest.url, { method: 'HEAD' });
      const nextUrl = net.fileBase + nextEdition(latest.edition) + '.pdf';
      let next = null;
      try { next = await ctx.fetch(nextUrl, { method: 'HEAD' }); } catch (e) { if (e.status !== 404) throw e; }
      return { current, next, nextUrl };
    });
    if (!isPdf(heads.current)) return status('blocked', latest.url, 'Essential Energy\'s ' + latest.edition + ' schedule no longer answers as a PDF at the captured address, so a revision cannot be checked.');
    if (heads.next && isPdf(heads.next)) {
      return status('stale', heads.nextUrl, 'Essential Energy has published its ' + nextEdition(latest.edition) + ' schedule (' + heads.nextUrl.split('/').pop() + ').' + fix);
    }
    const modified = httpDay(header(heads.current, 'last-modified'));
    if (modified && modified > latest.asOf) {
      return status('stale', latest.url, 'Essential Energy has revised its ' + latest.edition + ' schedule: last modified ' + modified + ', after the capture of ' + latest.asOf + '.' + fix);
    }
    return { observations: [] };
  };
}

// The registry entries (grounding/series.js).
function registryEntries() {
  return SERIES.map((s) => ({
    seriesId: s.seriesId,
    title: s.title,
    capture: 'manual',
    publisher: NETWORKS[s.network].publisher,
    urls: { listing: NETWORKS[s.network].listingUrl },
    licence: licenceFor(s.network, NETWORKS[s.network].listingUrl),
    streams: ['tp_utility'],
    // Annual, from 1 July; the watch turns a series stale on a new schedule.
    freshnessDays: 400,
    // FY26 to FY27 moved 4.6% (about $9 ordinary, $13 to $16 after hours).
    bounds: s.when === 'ordinary' ? { min: 120, max: 300, maxChange: 25 } : { min: 200, max: 550, maxChange: 40 },
    cadenceHours: 12,
    fetch: watcherFor(s),
  }));
}

module.exports = {
  NETWORKS, SERIES, licenceFor, editionOf, parseAusgrid, parseEndeavour, capturedEditions, registryEntries,
};
