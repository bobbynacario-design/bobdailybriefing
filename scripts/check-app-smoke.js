import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sports = readFileSync(new URL('../sports.html', import.meta.url), 'utf8');
const pagesWorkflow = readFileSync(new URL('../.github/workflows/publish-pages.yml', import.meta.url), 'utf8');
const functionsIndex = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function ids(source) {
  return Array.from(source.matchAll(/\bid=["']([^"']+)["']/g), function (match) { return match[1]; });
}

function duplicateIds(source) {
  const seen = new Set();
  const duplicates = new Set();
  ids(source).forEach(function (id) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  });
  return Array.from(duplicates);
}

assert.deepEqual(duplicateIds(html), [], 'index.html must not contain duplicate ids');
assert.deepEqual(duplicateIds(sports), [], 'sports.html must not contain duplicate ids');

[
  'page-today', 'page-history', 'page-trends', 'page-research', 'page-radar',
  'page-command', 'page-evidence', 'page-timeline', 'page-journal', 'page-pse', 'page-miro', 'page-sports', 'page-help', 'page-decisions'
].forEach(function (id) {
  assert.ok(html.includes('id="' + id + '"'), 'missing application page #' + id);
});

assert.ok(html.includes('type="module"'), 'Firebase application script must remain a module');
assert.ok(html.includes('manifest.webmanifest'), 'PWA manifest link is required');
assert.ok(html.includes('./lib/command-center-core.js'), 'Command Center core must load before the app script');
assert.ok(html.includes('./lib/command-review-core.js'), 'Command review core must load before the app script');
assert.ok(html.includes('./lib/intelligence-search-core.js'), 'Unified search core must load before the app script');
assert.ok(html.includes('./lib/evidence-sets-core.js'), 'Evidence sets core must load before the app script');
assert.ok(html.includes('./lib/entity-timeline-core.js'), 'Entity timeline core must load before the app script');
assert.ok(html.includes("if (id==='command') renderCommandCenter()"), 'navigation must render Command Center');
assert.ok(html.includes('fbLoadCommandPrefs') && html.includes('fbSaveCommandPrefs'),
  'Command Center preferences must load and save through the signed-in account');
assert.ok(html.includes('Why this rank?'), 'Command Center must explain item ranking');
assert.ok(html.includes('fbEnableBriefingDelivery') && html.includes('command-delivery-audit'),
  'Command Center must expose device delivery and its audit trail');
assert.ok(html.includes('completeCommandReviewDay') && html.includes('command-review-week'),
  'Command Center must expose the daily review checklist and weekly discipline view');
assert.ok(html.includes('openIntelligenceSearch') && html.includes('intelligenceSearchKey') && html.includes('fbLoadSearchBriefings'),
  'App must expose lazy unified search with keyboard navigation and archive loading');
assert.ok(html.includes('fbLoadEvidenceSets') && html.includes('fbSaveEvidenceSets') && html.includes('openEvidencePicker'),
  'App must load, save, and populate account-synced evidence sets');
assert.ok(html.includes('renderEntityTimeline') && html.includes('openEntityTimelineItem') && html.includes('saveEntityTimelineItem'),
  'App must build source-linked entity timelines and allow evidence capture');
assert.ok(functionsIndex.includes('exports.deliverMorningFive = onSchedule') &&
  functionsIndex.includes('exports.registerBriefingDevice = onCall') &&
  functionsIndex.includes('exports.muteBriefingDelivery = onCall'),
  'Functions must schedule Morning 5 delivery and manage authenticated devices');
assert.ok(serviceWorker.includes('onBackgroundMessage') && serviceWorker.includes("action: 'mute'"),
  'service worker must receive background delivery and expose a mute action');
assert.ok(pagesWorkflow.includes('cp lib/command-center-core.js') && pagesWorkflow.includes('_site/lib/'),
  'Pages artifact must include the Command Center core');
assert.ok(pagesWorkflow.includes('lib/command-review-core.js') && pagesWorkflow.includes('_site/lib/'),
  'Pages artifact must include the Command review core');
assert.ok(pagesWorkflow.includes('lib/intelligence-search-core.js') && pagesWorkflow.includes('_site/lib/'),
  'Pages artifact must include the unified search core');
assert.ok(pagesWorkflow.includes('lib/evidence-sets-core.js') && pagesWorkflow.includes('_site/lib/'),
  'Pages artifact must include the evidence sets core');
assert.ok(pagesWorkflow.includes('lib/entity-timeline-core.js') && pagesWorkflow.includes('_site/lib/'),
  'Pages artifact must include the entity timeline core');
assert.ok(sports.includes('sports-public.json'), 'public sports page must load its public data mirror');
assert.ok(!/function\s+getGeminiPrompt\s*\([^)]*\)[\s\S]*function\s+getGeminiPrompt\s*\(/.test(html),
  'getGeminiPrompt must have only one declaration');

const inlineScripts = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
  function (match) { return match[1]; });
assert.ok(inlineScripts.length >= 2, 'expected Firebase module and application scripts');
assert.doesNotThrow(function () { new vm.Script(inlineScripts.at(-1), {filename: 'index-inline.js'}); },
  'main application script must parse');

console.log('application smoke checks passed');
