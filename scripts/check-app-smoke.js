import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sports = readFileSync(new URL('../sports.html', import.meta.url), 'utf8');

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
  'page-command', 'page-journal', 'page-pse', 'page-miro', 'page-sports', 'page-help', 'page-decisions'
].forEach(function (id) {
  assert.ok(html.includes('id="' + id + '"'), 'missing application page #' + id);
});

assert.ok(html.includes('type="module"'), 'Firebase application script must remain a module');
assert.ok(html.includes('manifest.webmanifest'), 'PWA manifest link is required');
assert.ok(html.includes('./lib/command-center-core.js'), 'Command Center core must load before the app script');
assert.ok(html.includes("if (id==='command') renderCommandCenter()"), 'navigation must render Command Center');
assert.ok(sports.includes('sports-public.json'), 'public sports page must load its public data mirror');
assert.ok(!/function\s+getGeminiPrompt\s*\([^)]*\)[\s\S]*function\s+getGeminiPrompt\s*\(/.test(html),
  'getGeminiPrompt must have only one declaration');

const inlineScripts = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
  function (match) { return match[1]; });
assert.ok(inlineScripts.length >= 2, 'expected Firebase module and application scripts');
assert.doesNotThrow(function () { new vm.Script(inlineScripts.at(-1), {filename: 'index-inline.js'}); },
  'main application script must parse');

console.log('application smoke checks passed');
