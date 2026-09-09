// Local-only visual regression fixture. Never contacts Firebase or OpenAI.
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../_site');
const fake = `<script>
window.addEventListener('DOMContentLoaded',function() {
  var date = new Date().toISOString().slice(0,10);
  var briefing = {date:date,grounding:null,markets:{psei:'6,105.99',psei_move:'+0.37% (previous close)',asx:'8,920.80',asx_move:'-1.00%',sp500:'7,673.52',sp500_move:'-0.58%'},peso:{usdphp:'62.625 (previous close, sample source)',usdphp_move:'+0.039 (sample movement)'},weather:{temp_c:'26–31°C',summary:'Cloudy with scattered thunderstorms. This is a local test fixture.',rain_chance:'70–80%; scattered rainfall'},sections:{global:[{headline:'Medium relevance context',body:'Background information for the daily briefing.',relevance:'Economic background',relevance_level:'med',source:'Fixture'}],insurance:[{headline:'Insurance outage investigation',body:'A provider-backed event with implications for business interruption review.',relevance:'Review the outage evidence and restoration timeline.',relevance_level:'high',source:'Fixture'},{headline:'Claims review update',body:'A second fixture to check reading order and source navigation.',relevance:'A relevant claims review.',relevance_level:'high',source:'Fixture',url:'https://example.com',grounded:true}]}};
  var prefs = null, evidence = {version:1,sets:[]};
  window._firebaseUid = 'audit-fixture'; window._sessionUid = 'audit-fixture';
  window._fixtureWrites = 0;
  window.fbSaveBriefing = async function() { window._fixtureWrites++; };
  window.fbSignOut = async function() { window._firebaseUid = null; };
  window.fbLoadHistory = async function() { window._briefingHistory = [{key:date,data:briefing,saved:Date.now()-3600000}]; window.renderHistory(); };
  window.fbLoadSearchBriefings = async function() { return [{key:date,data:briefing,saved:Date.now()-3600000}]; };
  ['Radar','Miro','Sports','News','FeedHealth','DecisionDrift'].forEach(function(name) { window['fbLoad'+name] = async function() { if (name === 'Radar' && location.search.includes('partial')) throw Error('Fixture network failure'); return null; }; });
  window.fbLoadReports = window.fbLoadDecisions = async function() { return []; };
  window.fbLoadCommandPrefs = async function() { return prefs; };
  window.fbSaveCommandPrefs = async function(value) { prefs = value; return value; };
  window.fbLoadEvidenceSets = async function() { return evidence; };
  window.fbSaveEvidenceSets = async function(value) { evidence = value; return value; };
  window.fbAcceptEvidenceBase = function() {};
  window.onSignedIn();
});
</script>`;
const server=createServer((req,res) => {
  const url=new URL(req.url,'http://localhost');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    let html=readFileSync(path.join(root,'index.html'),'utf8').replace(/<script type="module">[\s\S]*?<\/script>/,fake);
    html=html.replace('registerBriefingServiceWorker();','/* Disabled in isolated preview. */');
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(html);return;
  }
  const target=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if (!target.startsWith(root+path.sep)) { res.writeHead(403);res.end();return; }
  try { const bytes=readFileSync(target); res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.html':'text/html'})[path.extname(target)] || 'application/octet-stream');res.end(bytes); }
  catch { res.writeHead(404);res.end('Not found'); }
});
server.listen(4173,'127.0.0.1',() => console.log('Isolated audit fixture at http://127.0.0.1:4173; add ?partial for a failed Radar source.'));
