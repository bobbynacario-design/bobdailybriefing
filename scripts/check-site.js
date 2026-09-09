import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
// Scheduled publishers replace the entire site too. Every publishing path must
// build the same complete artifact before uploading it.
const workflowDir = new URL('../.github/workflows/',import.meta.url);
for (const file of readdirSync(workflowDir).filter(name => /\.ya?ml$/.test(name))) {
  const workflow = readFileSync(new URL(file,workflowDir),'utf8');
  if (!workflow.includes('actions/deploy-pages@')) continue;
  const build = workflow.indexOf('run: npm run check:site');
  const upload = workflow.indexOf('actions/upload-pages-artifact@');
  assert.ok(build >= 0 && upload > build,file+' must verify the complete site before upload');
  assert.match(workflow,/path: _site\s/,file+' must upload the verified artifact');
}
const html=readFileSync(new URL('../_site/index.html',import.meta.url),'utf8');
assert.ok(!/<script src="\.\/lib\//.test(html),'shared application code must be bundled');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
for (const [,attributes,code] of scripts) if (!attributes.includes('type="module"')) new vm.Script(code);
const context=vm.createContext({});
for (const [,attributes,code] of scripts) if (attributes.includes('data-bundled=') && !attributes.includes('ui-shell')) vm.runInContext(code,context);
for (const name of ['CommandCenterCore','CommandReviewCore','IntelligenceSearchCore','EvidenceSetsCore','EntityTimelineCore','AppReliability']) assert.ok(context[name],name+' must initialize');
const briefing={date:'2026-09-09',sections:{insurance:[{headline:'Insurance outage investigation',body:'Source fixture',relevance_level:'high'}]}};
assert.equal(context.CommandCenterCore.buildCommandCenter({briefing}).morningFive[0].title,'Insurance outage investigation');
const index=context.IntelligenceSearchCore.buildIndex({briefings:[{key:'fixture',saved:Date.now(),data:briefing}]});
assert.equal(context.IntelligenceSearchCore.search(index,'insurance').length,1);
for (const file of ['lib/command-center-core.js','lib/intelligence-search-core.js','lib/ui-shell.js','lib/app-reliability.js','version.json']) assert.ok(existsSync(new URL('../_site/'+file,import.meta.url)));
console.log('Release artifact initializes Command and Search with a known fixture.');
