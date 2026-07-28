// lib/story-tagger.js
//
// PURE — no I/O, no network. Classifies a briefing story for the PSE tab's
// market-story panel: is it a Philippine MARKET story, and if so is it about a
// named listed company (`specific`) or the wider economy (`macro`)?
//
// WHY THIS EXISTS: index.html's phStoryCat prefers a model-written
// `market_category` tag and falls back to a keyword heuristic when there isn't
// one. A survey of the archive found 601 ph/markets stories across 81 briefings
// and ZERO tags — so the PSE tab has always run on the fallback. This module is
// the shared brain for a local re-tagger that fills them in.
//
// The keyword fallback below is a DELIBERATE MIRROR of phStoryCat in index.html.
// If they drift, the same story is categorised one way in the app and another way
// by the tagger, which is worse than having no tagger. Any change to one must be
// made to the other.
//
// The tagger writing a tag makes the front end STOP using its fallback, so a bad
// tag is worse than no tag. That is why an unparseable or invalid model answer
// falls back to the heuristic rather than being written as a guess, and why every
// tag records which source produced it.

var PH_CO = ['sm investments','sm prime',' sm ','ayala','acen','ac energy','bdo','bpi','metrobank','security bank','union bank','china bank','pnb','jollibee','jfc','pldt','globe','converge','dito','meralco','ictsi','san miguel',' smc','aboitiz','gt capital','jg summit','universal robina','urc','megaworld','monde nissin','nickel asia','semirara','dmci','robinsons','puregold','wilcon','century pacific','emperador','bloomberry','manila water','maynilad','cebu pacific','first gen','alliance global','maya','gcash'];
var PH_GEO = ['philippine','manila','psei','pse ','peso','bsp',' ph ','filipino','bangko sentral'];
var PH_MKT = ['stock','share','market','index','peso','inflation','rate','earnings','ipo','listed','listing','economy','gdp','investor','trading','bourse','equit','bond','yield','dividend','tariff','remittance'];

var VALID = { specific: 1, macro: 1, none: 1 };

function storyText(st) {
  return ((st.headline || '') + ' ' + (st.body || '') + ' ' + (st.relevance || '')).toLowerCase();
}
function hasCompany(t) { return PH_CO.some(function (k) { return t.indexOf(k) !== -1; }); }

// Mirror of index.html phStoryCat's fallback branch. Returns 'specific' | 'macro'
// | 'none' ('none' where the front end returns null — same meaning, excluded).
function heuristicCategory(st, section) {
  var t = storyText(st);
  var geo = PH_GEO.some(function (k) { return t.indexOf(k) !== -1; }) || hasCompany(t);
  var mkt = PH_MKT.some(function (k) { return t.indexOf(k) !== -1; }) || hasCompany(t);
  // The `markets` section is global, so a story must be PH-relevant AND
  // market-relevant to belong on the PSE tab. The `ph` section is already PH
  // news, so it only has to be market-relevant.
  var include = section === 'markets' ? (geo && mkt) : mkt;
  if (!include) return 'none';
  return hasCompany(t) ? 'specific' : 'macro';
}

// Prompt for one briefing's worth of stories. Numbered so the model returns a
// small keyed object rather than restating the text — short output is what keeps
// this fast on CPU-only local hardware.
// SPLIT OF LABOUR, and it is evidence-led rather than tidy.
//
// Measured on qwen2.5:7b over the archive, the two components fail at different
// things:
//
//   INCLUSION (is this a PH market story at all?) — the heuristic is decent,
//   because PH keyword matching is a genuinely lexical question. The model is
//   NOT: it excluded a story whose headline says "PSEi Retreats", and gave the
//   identical headline "Opening Market Snapshot" two different answers in two
//   documents. Hardening the prompt against foreign-market leakage fixed that
//   one case and broke three others.
//
//   SPECIFIC vs MACRO — the heuristic is bad, because it only asks "does a
//   company name appear", so a BSP rate story reads as `specific` when BSP is
//   the central bank, not a listed company. The model gets this right and
//   reliably.
//
// So the heuristic decides WHETHER a story appears, and the model decides only
// HOW it is grouped once it is in. Each does the half it is good at, and the
// inclusion behaviour is therefore identical to what the app already does today
// — this pass can sharpen the grouping but cannot start hiding stories.
function buildPrompt(items) {
  var list = items.map(function (it, i) {
    return (i + 1) + '. ' + (it.story.headline || '') +
      (it.story.body ? ' — ' + String(it.story.body).slice(0, 300) : '');
  }).join('\n');
  return 'Each news item below is already known to be relevant to Philippine markets. ' +
    'Decide only HOW to group each one.\n\n' +
    '- "specific": the story is about a NAMED Philippine listed company — SM Investments, Ayala, BDO, BPI, ' +
    'PLDT, Globe, Jollibee, Meralco, ICTSI, San Miguel, Aboitiz and the like.\n' +
    '- "macro": the story is about the Philippine economy or market as a whole — BSP policy, inflation, ' +
    'the peso, the PSEi index, GDP, interest rates, foreign fund flows.\n\n' +
    'The central bank (BSP) is a regulator, NOT a listed company: BSP stories are "macro".\n' +
    'An index or market-wide move (PSEi up/down, foreign outflows) is "macro" even when companies are ' +
    'mentioned in passing. Choose "specific" only when ONE named company is the subject of the story.\n\n' +
    'Also give "subject": the company or topic in at most 4 words.\n\n' +
    'Items:\n' + list + '\n\n' +
    'Return STRICT JSON only: an object whose keys are the item numbers as strings, ' +
    'each value {"category": "specific"|"macro", "subject": "..."}. ' +
    'Include every item number. No prose, no code fences.';
}

// Validate ONE model answer. Returns a normalised tag or null when unusable —
// null is the signal to fall back, never to guess.
//
// `none` is rejected here on purpose: the model is only ever asked to group
// stories the heuristic already included, so a "none" is out of scope and must
// not be allowed to remove a story the app currently shows.
function normalizeAnswer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var cat = String(raw.category == null ? '' : raw.category).toLowerCase().trim();
  if (cat !== 'specific' && cat !== 'macro') return null;
  if (!VALID[cat]) return null;
  var subj = raw.subject == null ? '' : String(raw.subject).trim();
  if (subj.length > 60) subj = subj.slice(0, 60);
  if (cat === 'none') subj = '';
  return { category: cat, subject: subj };
}

// Merge a model response over the items, falling back per-item. Never throws.
// `answers` is the parsed model object keyed by "1", "2", ... — anything missing
// or invalid degrades to the heuristic that the app already uses today.
function resolveTags(items, answers) {
  answers = answers && typeof answers === 'object' ? answers : {};
  return items.map(function (it, i) {
    var got = normalizeAnswer(answers[String(i + 1)]);
    if (got) return { category: got.category, subject: got.subject, source: 'model' };
    return { category: heuristicCategory(it.story, it.section), subject: '', source: 'heuristic' };
  });
}

// How often the model agreed with the heuristic. Not a correctness measure —
// the heuristic is crude, which is the whole reason for tagging — but a large
// disagreement rate is a reason to eyeball the output before writing it.
function agreementStats(items, tags) {
  var n = 0, agree = 0, byModel = 0;
  items.forEach(function (it, i) {
    var t = tags[i];
    if (!t) return;
    n++;
    if (t.source === 'model') byModel++;
    if (t.category === heuristicCategory(it.story, it.section)) agree++;
  });
  return { n: n, fromModel: byModel, fromHeuristic: n - byModel,
           agreed: agree, agreementPct: n ? Math.round((agree / n) * 1000) / 10 : null };
}

export { buildPrompt, heuristicCategory, normalizeAnswer, resolveTags, agreementStats, storyText, hasCompany };
