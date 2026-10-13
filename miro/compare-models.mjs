// One-off (miro-panel-test branch only, never merged): build ONE fact sheet
// with the current prompt, then run the price-blind persona panel on several
// Claude models over that same sheet. Prints each model's reads per market and,
// separately, the market price. Writes nothing.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CONFIG } from './config.js';
import { buildFactSheet, factEvidence, FACTSHEET_VERSION } from './factsheet.js';
import { runClaudePanel } from './panel-claude.js';

const MODELS = (process.env.COMPARE_MODELS || 'claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5,claude-fable-5-1').split(',');
initializeApp({ credential: applicationDefault(), projectId: 'pokerhq-a67e4' });
const db = getFirestore();
const latest = (await db.collection('briefings-bob').doc('miro-latest').get()).data().value;
const doc = (await db.collection('briefings-bob').doc('miro-' + latest).get()).data();
const markets = doc.markets.filter(m => !m.closed);
console.log('Markets doc ' + latest + ', ' + markets.length + ' open markets; fact sheet ' + FACTSHEET_VERSION);

const sheet = await buildFactSheet(markets, { apiKey: process.env.ANTHROPIC_API_KEY, now: new Date().toISOString(),
  model: CONFIG.panel.factSheetModel, maxSearches: CONFIG.panel.factSheetMaxSearches });
console.log('Fact sheet: ' + sheet.status + ' · ' + Object.keys(sheet.facts).length + '/' + markets.length + ' · ' + sheet.usage.searches + ' searches · in ' + sheet.usage.input + ' out ' + sheet.usage.output + (sheet.error ? ' · ' + sheet.error : ''));
for (const m of markets) {
  const f = sheet.facts[m.slug];
  console.log('\nFACTS ' + m.label + ':\n  ' + (f ? f.summary + (f.nextDates ? '\n  Next: ' + f.nextDates : '') + '\n  ' + f.sources.map(s => s.url).join(' ') : '(none)'));
}
const evidence = {};
markets.forEach(m => { evidence[m.slug] = [factEvidence(sheet.facts[m.slug])].filter(Boolean); });

const rows = {};
for (const model of MODELS) {
  const t0 = Date.now();
  const run = await runClaudePanel(markets, CONFIG.panel.personas, { apiKey: process.env.ANTHROPIC_API_KEY, model, evidence, log: () => {} });
  console.log('\n' + model + ': ' + run.calls + ' calls, in ' + run.usage.inputTokens + ' out ' + run.usage.outputTokens + ', ' + Math.round((Date.now() - t0) / 1000) + 's, missing ' + run.missing.length);
  for (const m of markets) {
    const r = run.reads[m.slug] || [];
    const mean = r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
    const sd = r.length ? Math.sqrt(r.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / r.length) : null;
    (rows[m.slug] = rows[m.slug] || {})[model] = { mean, sd, reads: r };
  }
}
console.log('\n===== Panel mean (±spread) per model, then the market price =====');
for (const m of markets) {
  console.log('\n' + m.label);
  for (const model of MODELS) {
    const x = rows[m.slug][model];
    console.log('  ' + model.padEnd(20) + (x.mean == null ? 'no reads' : (x.mean * 100).toFixed(1) + '% ±' + (x.sd * 100).toFixed(1) + '  [' + x.reads.map(v => Math.round(v * 100)).join(', ') + ']'));
  }
  console.log('  ' + 'market price'.padEnd(20) + (m.impliedYes == null ? 'n/a' : (m.impliedYes * 100).toFixed(1) + '%'));
}
