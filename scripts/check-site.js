import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
// Scheduled publishers replace the entire site too. Every publishing path must
// build the same complete artifact before uploading it.
const workflowDir = new URL('../.github/workflows/',import.meta.url);
for (const file of readdirSync(workflowDir).filter(name => /\.ya?ml$/.test(name))) {
  const workflow = readFileSync(new URL(file,workflowDir),'utf8');
  // A job chosen by `github.event.schedule == '<cron>'` silently stops when
  // its cron line changes and the condition does not (Radar moved to Mon, Wed
  // and Fri on 28 Nov 2026), so every cron must be named by a condition.
  if (workflow.includes('github.event.schedule ==')) {
    for (const [,cron] of workflow.matchAll(/- cron: "([^"]+)"/g)) assert.ok(workflow.includes("github.event.schedule == '"+cron+"'"),file+': no job runs on cron "'+cron+'"');
  }
  if (!workflow.includes('actions/deploy-pages@')) continue;
  const build = workflow.indexOf('run: npm run check:site');
  const upload = workflow.indexOf('actions/upload-pages-artifact@');
  assert.ok(build >= 0 && upload > build,file+' must verify the complete site before upload');
  assert.match(workflow,/path: _site\s/,file+' must upload the verified artifact');
  // GitHub can list a fresh artifact a few seconds late (11 of 60 sports runs,
  // 18-27 Nov 2026), so the first deploy may fail and one retry follows it.
  assert.equal((workflow.match(/actions\/deploy-pages@/g) || []).length,2,file+' must retry the Pages deploy once');
  assert.match(workflow,/id: deployment\s+continue-on-error: true/,file+' first deploy must let the retry run');
  assert.match(workflow,/if: steps\.deployment\.outcome == 'failure'\s+uses: actions\/deploy-pages@/,file+' retry must run only after a failed deploy');
}
const html=readFileSync(new URL('../_site/index.html',import.meta.url),'utf8');
assert.ok(!/<script src="\.\/lib\//.test(html),'shared application code must be bundled');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
for (const [,attributes,code] of scripts) if (!attributes.includes('type="module"')) new vm.Script(code);
const context=vm.createContext({});
for (const [,attributes,code] of scripts) if (attributes.includes('data-bundled=') && !attributes.includes('ui-shell')) vm.runInContext(code,context);
for (const name of ['CommandCenterCore','CommandReviewCore','IntelligenceSearchCore','EvidenceSetsCore','EntityTimelineCore','RadarAssistantCore','ScoutCore','FlightsCore','DaybookCalendarCore','WeeklyReviewCore','AppReliability']) assert.ok(context[name],name+' must initialize');
const briefing={date:'2026-09-09',sections:{insurance:[{headline:'Insurance outage investigation',body:'Source fixture',relevance_level:'high'}]}};
assert.equal(context.CommandCenterCore.buildCommandCenter({briefing}).morningFive[0].title,'Insurance outage investigation');
const index=context.IntelligenceSearchCore.buildIndex({briefings:[{key:'fixture',saved:Date.now(),data:briefing}]});
assert.equal(context.IntelligenceSearchCore.search(index,'insurance').length,1);
for (const file of ['lib/command-center-core.js','lib/intelligence-search-core.js','lib/ui-shell.js','lib/app-reliability.js','version.json']) assert.ok(existsSync(new URL('../_site/'+file,import.meta.url)));
console.log('Release artifact initializes Command and Search with a known fixture.');
