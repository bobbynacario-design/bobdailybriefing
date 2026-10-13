import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {latestSports} from './export-public.js';

function database(pointer, doc) {
  return {collection(name) {
    assert.equal(name, 'briefings-bob');
    return {doc(id) { return {async get() {
      assert.ok(id === 'sports-latest' || id === 'sports-2026-10-13');
      const data = id === 'sports-latest' ? pointer : doc;
      return {exists: !!data, data: () => data};
    }}; }};
  }};
}
test('app releases export the shared snapshot with all lanes and audit fields intact', async () => {
  const doc = {generatedAt: '2026-10-13T08:18:25Z', modules: {
    nba: {refreshStatus: 'ok'}, tennis: {projectionJournal: {timingExcluded: 82}},
    combat: {record: {timingExcluded: 44, noWinner: 5}}
  }};
  assert.deepEqual(await latestSports(database({value: '2026-10-13'}, doc)), doc);
});
test('missing pointers or feeds stop publication instead of shipping the Git fallback', async () => {
  for (const pointer of [null, {}, {value: '../private'}]) {
    await assert.rejects(latestSports(database(pointer, null)), /pointer/);
  }
  for (const doc of [null, {}, {generatedAt: 'invalid', modules: {nba: {}}},
    {generatedAt: '2026-10-13T08:18:25Z', modules: {}}]) {
    await assert.rejects(latestSports(database({value: '2026-10-13'}, doc)), /feed/);
  }
});
test('static publishing hydrates Sports before building the release artifact', () => {
  const workflow = readFileSync(new URL('../.github/workflows/publish-pages.yml', import.meta.url), 'utf8');
  assert.ok(workflow.indexOf('google-github-actions/auth@v3') < workflow.indexOf('node sports/export-public.js'));
  assert.ok(workflow.indexOf('node sports/export-public.js') < workflow.indexOf('run: npm run check:site'));
});
