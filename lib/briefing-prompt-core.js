(function (root) {
  'use strict';

  // lib/briefing-prompt-core.js
  //
  // THE briefing prompt. One copy, shared by the server generator
  // (functions/index.js, via the synced CJS twin) and the front end's copy-prompt
  // button — which is the whole reason this file exists.
  //
  // WHY: there used to be three. functions/index.js held the live one; index.html
  // held getGeminiPrompt() behind the copy button and getGeminiPromptLegacy()
  // behind nothing at all. They drifted, as duplicated prompts do: the legacy one
  // had no insurance section, no interruptions section, no peso and no weather,
  // and the copy button's version was missing every rule added after it was
  // written. So the prompt Bob could actually read was never the prompt that ran,
  // and there was no way to tell from inside the app.
  //
  // The optional blocks are how one prompt serves both callers. The server passes
  // evidence / context / facts and gets the full instrument; the front end passes
  // none of them and gets exactly the server's degraded path — the same prompt the
  // server would send on a morning when every feed is down. That is the honest
  // thing for the copy button to show, because it is a prompt Bob can paste
  // somewhere else and have work.
  //
  // Everything here is pure text assembly. No I/O, no clock beyond the date
  // default, no model call.

  function text(value) { return String(value == null ? '' : value).trim(); }

  // ── optional rule blocks ──────────────────────────────────────────────────
  //
  // Each returns [] when its input is absent, so a prompt built without it is
  // byte-identical to the version from before that feature existed. The fallback
  // path stays the known-good one rather than becoming a second thing to test.

  // The insurance section becomes CLOSED — only the supplied stories — because
  // that is the whole point: a section whose every item can be re-opened from the
  // app. Interruptions stays OPEN, because the feed is Australian insurance trade
  // press and a Philippine port closure or a regional supply-chain failure will
  // not be in it; forcing that section closed would trade real coverage for a
  // tidier rule.
  function groundingRules(evidence) {
    if (!evidence || evidence.unavailable || !evidence.block) return [];
    return [
      '',
      'GROUNDING — this overrides the instructions above where they conflict:',
      '- A list of real, already-fetched Australian insurance stories appears at the end of this prompt.',
      '- Build the insurance section ONLY from that list. Do not web-search for it and do not add stories from your own knowledge.',
      '- Choose the 4 stories most relevant to Bob. If fewer than 4 are genuinely relevant, return fewer. Never pad.',
      '- For each chosen story: copy its headline as the headline, copy its publisher as the source, and copy its url EXACTLY as written.',
      '- Never invent, guess, shorten or tidy a url. A url that is not in the list is worse than no url at all.',
      '- body remains your own 2-3 sentence summary, and relevance remains the Bob-facing insight. Those are yours to write; the headline, publisher and url are not.',
      '- The interruptions section may also draw on the list where a story fits, using the same exact url. For anything else in that section, web-search as usual and give the search result url under the url rule above.',
      '- Every other section follows the url rule above: the exact url of the search result the story came from, or empty.'
    ];
  }

  // Rules for Bob's own open state. They exist because the block alone is not
  // safe: handing a model a list of positions and no instructions is how a
  // briefing turns into either a tip sheet or a pile of invented connections.
  // Both failures are worse than the generic briefing this replaces, so the two
  // prohibitions below are load-bearing, not boilerplate.
  //
  // The last rule is the actual payoff. An open call's invalidation line is the
  // one thing Bob wrote down in advance as "this is what would make me wrong";
  // news that touches it is the highest-value sentence the briefing can contain,
  // and it can be surfaced without recommending anything.
  function standingRules(context) {
    var standing = context && context.standing;
    if (!standing || !standing.block) return [];
    return [
      '',
      "STANDING CONTEXT — this is what makes the briefing Bob's rather than generic:",
      "- A STANDING CONTEXT block near the end of this prompt lists Bob's open calls, the questions he is testing, the radar setups he is tracking, and the event markets past his research gate.",
      '- It is private working state, not news. Never report any of it as a story, never echo it back as a headline, and never write as though anyone else can see it.',
      "- Where a story genuinely bears on a named call, setup or market, say so in that story's relevance field and name the asset or market explicitly.",
      '- Most stories will bear on none of it. That is the normal case and it is fine. Do not manufacture a connection — a forced link reads exactly like a real one, which makes it worse than no link at all.',
      '- Never recommend buying, selling, holding, exiting, sizing or hedging, and never tell Bob a thesis is right or wrong. Report what changed and what to watch; the call stays his.',
      '- If a story bears on the stated invalidation line of an open call or an open question, that is the single most useful thing you can surface today. Name the call or question and the condition, and stop there.'
    ];
  }

  // Rules for grading the previous briefing's watch item. The status vocabulary is
  // closed and includes no_news on purpose: without an explicit way to say "I
  // could not verify anything", the cheapest way to fill this field is to restate
  // yesterday's line in the present tense, which would read as a confirmed update.
  function watchRules(context) {
    var watch = context && context.watch;
    if (!watch || !watch.text) return [];
    return [
      '',
      'WATCH FOLLOW-UP:',
      "- The PREVIOUS WATCH block near the end of this prompt is the watch item from Bob's last briefing.",
      '- Fill watch_followup. Copy that line verbatim into prior, and set status to exactly one of: advanced, stalled, resolved, dead, no_news.',
      '-   advanced = it moved materially in the direction it was flagged for; stalled = still live, nothing moved; resolved = it happened or was settled; dead = no longer a live question; no_news = you could find nothing either way today.',
      '- note is one or two sentences on what actually happened, carrying the date, figure or filing that shows it.',
      '- If you cannot verify movement, use no_news and say so plainly. Do not guess, and do not restate the original line in the present tense as though it were an update.',
      '- Grade only that prior item. The watch field you write today is a fresh call and may be about something else entirely.'
    ];
  }

  // Rules for Bob's "more like this / less like this" votes. They steer what is
  // worth his attention, and nothing else: the block is examples of taste, not
  // news, so it must never be reported back, and it sits below every rule that
  // keeps the briefing honest (grounding, the budget, the relevance levels).
  // ── The aha: one non-obvious read a day ──
  //
  // Every story is the same unit — news, then its first-order consequence — and
  // the rules above reward being correct and specific, never being insightful.
  // Fourteen briefings in a row came out the same shape with the same kind of
  // "why it matters" line, and none of them ever put two stories together. The
  // aha is the one slot whose job is surprise: a connection across sections, a
  // consequence further downstream than any source goes, or a reason the
  // consensus read is wrong. Bob wants the early read, not the safe one, so it
  // is asked to lean early — but it has to be falsifiable, it has to be built
  // on stories actually in the briefing, and null is a real answer.
  function ahaRules() {
    return [
      '',
      'AHA — the one non-obvious read of the day:',
      '- aha is the single insight a well-read insurance and markets professional would NOT get from skimming today\'s headlines. It is not a story and does not count toward the item budget.',
      '- kind is exactly one of: connection (two stories from different sections share a cause, feed each other, or collide), second-order (a consequence two or more steps downstream of a story that no source states), contrarian (the consensus reading of a story is likely wrong, and the story itself carries the evidence).',
      // The first real aha (26 Sep) titled itself with the point one of its own
      // linked stories already made, and buried the genuinely new step in the
      // insight. The title has to be that step.
      '- title: the read itself in at most 12 words — a claim, not a topic, and the step BEYOND what the linked stories say. If a linked story\'s body or relevance line already makes a point, that point is where the aha starts, not the aha: the title is what follows from it. Test: would the author of either linked story already say this? If yes, go one step further, or return null.',
      '- insight: 2-3 sentences on what the connection or consequence is, and why it is not the obvious read.',
      '- chain: 2 to 4 short steps from what was reported to the conclusion. Each step either restates a fact from one of the linked stories or is plainly marked as inference ("so", "which means").',
      '- links: the exact headlines, copied from the sections above, of the one to three stories it is built on. A connection links at least two stories from different sections.',
      // Its wrong_if leaned on an annual report two months out that may not
      // break the figure out at all — a test that might never answer.
      '- wrong_if: ONE checkable signal that would show the read is wrong — what it is, who publishes it, and when it is next due. Prefer the nearest one (days or weeks, not months) that bears directly on the linked stories, and only something that will actually be published in a form that answers the question — never a report that may not break the figure out. Same standard as watch_metric.',
      '- It must not restate any story\'s relevance line, and it must not be a first-order consequence ("higher rates hurt borrowers", "storms raise claims"). Prefer the read that would be early rather than safe.',
      '- If nothing today clears that bar, set aha to null. A missing aha is honest; a manufactured one is noise.',
      '- It is an analytical read, not news: never present an inference as reported fact, and never recommend buying, selling, holding, exiting, sizing or hedging anything.'
    ];
  }

  // What the app shows and stores of an aha: known fields, bounded, and links
  // kept only when they name a story in this briefing (a model that tidies a
  // headline would otherwise leave a chip that jumps nowhere). Null when the
  // two fields the card exists for are missing. Shared by the server generator
  // and the app, so a briefing pasted from an outside AI is held to the same.
  var AHA_KINDS = ['connection', 'second-order', 'contrarian'];
  function clipText(value, max) {
    var flat = text(value).replace(/\s+/g, ' ');
    return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
  }
  function headlineKey(value) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function cleanAha(aha, sections) {
    if (!aha || typeof aha !== 'object' || Array.isArray(aha)) return null;
    var title = clipText(aha.title, 140), insight = clipText(aha.insight, 700);
    if (!title || !insight) return null;
    var headlines = [];
    Object.keys(sections && typeof sections === 'object' ? sections : {}).forEach(function(id) {
      (Array.isArray(sections[id]) ? sections[id] : []).forEach(function(story) {
        if (story && text(story.headline)) headlines.push(text(story.headline));
      });
    });
    var links = [];
    (Array.isArray(aha.links) ? aha.links : []).forEach(function(link) {
      var key = headlineKey(link);
      if (!key) return;
      var match = headlines.filter(function(headline) { var other = headlineKey(headline); return other === key || (key.length > 24 && (other.indexOf(key) >= 0 || key.indexOf(other) >= 0)); })[0];
      if (match && links.indexOf(match) < 0 && links.length < 3) links.push(match);
    });
    return {
      kind: AHA_KINDS.indexOf(aha.kind) >= 0 ? aha.kind : '',
      title: title,
      insight: insight,
      chain: (Array.isArray(aha.chain) ? aha.chain : []).map(function(step) { return clipText(step, 260); }).filter(Boolean).slice(0, 4),
      links: links,
      wrong_if: clipText(aha.wrong_if, 320)
    };
  }

  // ── The wildcard: one story from outside the beats ──
  //
  // Every section is one of Bob's beats, so every story arrives in a shape he
  // could predict. The wildcard is the one that does not: real news from outside
  // insurance, markets, the two economies, AI and EVs, picked through a lens that
  // turns with the weekday so the kind of surprise changes too. It is held to the
  // story rules (a searched page, checked like any link) and earns its place
  // with a bridge back to his work, offered as an inference for him to test.
  // Sunday first, as Date#getDay counts.
  var WILDCARD_LENSES = [
    {id: 'slow-change', label: 'Slow change', ask: 'a long, quiet trend (demographic, climate, cultural or technological) that a recent report or data release has just made visible'},
    {id: 'number', label: 'A number that matters', ask: 'one striking, recently published figure from any field, and what it measures'},
    {id: 'history', label: 'History rhymes', ask: 'a current event that closely echoes a past episode: name the episode and how it played out'},
    {id: 'against', label: 'Against the grain', ask: 'a story whose evidence cuts against what most people assume'},
    {id: 'far-field', label: 'Far field', ask: 'a finding in science, engineering or medicine that changes what is possible'},
    {id: 'solved', label: 'How it was solved', ask: 'a person, team or organisation that solved a hard, practical problem in an unusual way'},
    {id: 'elsewhere', label: 'Somewhere else', ask: 'a significant story from a country or region Bob does not follow (not Australia, the Philippines or the United States)'}
  ];
  var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  // The lens for a briefing's date label ("Sunday, September 27, 2026"), read
  // from its weekday so the server and the copied prompt always agree.
  function wildcardLens(dateLabel) {
    var word = text(dateLabel).toLowerCase().match(/^[a-z]+/), day = word ? WEEKDAYS.indexOf(word[0]) : -1;
    if (day < 0) { var parsed = Date.parse(text(dateLabel)); day = isFinite(parsed) ? new Date(parsed).getDay() : new Date().getDay(); }
    return WILDCARD_LENSES[day];
  }
  function lensById(id) { return WILDCARD_LENSES.filter(function(lens) { return lens.id === text(id); })[0] || null; }
  function wildcardRules(lens) {
    return [
      '',
      'WILDCARD — one story from outside the beats:',
      '- wildcard is ONE real, recent news story from outside every section above: not insurance, business interruption, markets, the Philippine or Australian economy, AI or EVs. It does not count toward the item budget.',
      '- Today\'s lens is "' + lens.label + '": ' + lens.ask + '. Set lens to "' + lens.id + '".',
      '- Pick it for surprise and quality: the story a curious professional would forward to a friend. Not weird news, not a listicle, not a celebrity item.',
      '- headline, body (2-3 sentences of what was reported), source and url follow the story rules. The url is copied exactly from a web search result for this briefing; without one, set wildcard to null.',
      '- bridge: 1-2 sentences on how it might connect to Bob\'s work (forensic BI, claims, audit, consulting, or how he reasons about risk and evidence). It is an inference for him to test, so frame it that way ("worth asking whether", "which suggests"). Never force it: a light bridge beats a strained one.',
      '- If no real story fits the lens today, set wildcard to null. Never recommend buying, selling, holding or sizing anything.'
    ];
  }
  // What the app shows and stores of a wildcard: known fields, bounded, the
  // lens it was asked for, and a url only when it is a web address. Null
  // without the three fields the card exists for. The server additionally
  // drops it unless the search returned its page.
  function cleanWildcard(raw, dateLabel) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var headline = clipText(raw.headline, 200), body = clipText(raw.body, 700), bridge = clipText(raw.bridge, 400);
    if (!headline || !body || !bridge) return null;
    var lens = lensById(raw.lens) || (text(dateLabel) ? wildcardLens(dateLabel) : null), url = text(raw.url);
    return {lens: lens ? lens.id : '', headline: headline, body: body, source: clipText(raw.source, 120),
      url: /^https?:\/\//i.test(url) ? url.slice(0, 600) : '', bridge: bridge, grounded: raw.grounded === true};
  }

  // ── His work, and his accounts ──
  //
  // Measured on his own files (Jun–Sep 2026, about 190 claims): half are
  // third-party property damage claims for QBE (vehicles striking utility and
  // road assets), argued over how the asset owner built its invoice; about one
  // in six is loss of income for heavy-vehicle operators; most of the rest is
  // first-party BI for small businesses, mostly for Allianz. The generic
  // "insurance and BI" steer produced generic stories and "insurers are
  // exposed" lines. This names the numbers his work turns on, so a story is
  // judged by whether it moves one. Themes only: no claim, person or amount.
  function workRules() {
    return [
      '',
      'HIS WORK — what the insurance, interruptions and global sections are for:',
      "- Most of his files are third-party property damage claims for QBE: vehicles striking utility and road assets (power and Stobie poles, streetlights, traffic signals, bridge rails, telco cable, awnings). The argument is over how the asset owner built its invoice: betterment and the asset's age, overheads and margins, labour and contractor rates, traffic control, incident response and plant hire.",
      '- The next biggest share is loss of income for heavy-vehicle operators (prime movers, haulage, couriers) after an accident: downtime, parts and repair lead times, replacement hire, idle fleet and saved costs.',
      '- Then first-party business interruption for small businesses (food, health clinics, retail, trades), mostly for Allianz, after power outages or surges, storms and hail, refrigeration failure or impact damage.',
      '- A story earns its place when it moves one of those numbers or triggers: electricity network costs and labour agreements (AER determinations, linesworker and contractor rates, pole replacement programmes), road-authority repair and incident-cost recovery, traffic-management rules and rates, truck parts and repair times, prime-mover hire and freight rates, fuel and driver wages, court rulings on betterment, overheads, loss of use or expert accounting evidence, grid outages and severe weather that stop small businesses trading, and how QBE and Allianz handle claims.',
      '- Say in the relevance line which of his numbers it moves, in plain words (for example: a linesworker pay rise flows into every pole-strike invoice the network sends). If the best you can say is that insurers are exposed, the story has not earned its place.',
      '- This steers priority only. It never overrides grounding, the item budget or the relevance definitions above.'
    ];
  }

  // The organisations his files involve, as a starter list until he keeps his
  // own (Evidence, Your accounts). Names only.
  var ACCOUNT_KINDS = ['insurer', 'broker', 'utility', 'road', 'telco', 'law', 'client', 'other'];
  var DEFAULT_ACCOUNTS = [
    {name: 'QBE', aliases: ['QBE Insurance'], kind: 'insurer'},
    {name: 'Allianz', aliases: ['TIO', 'Territory Insurance Office'], kind: 'insurer'},
    {name: 'SA Power Networks', aliases: ['SAPN'], kind: 'utility'},
    {name: 'Essential Energy', aliases: [], kind: 'utility'},
    {name: 'Powercor', aliases: ['CitiPower', 'United Energy'], kind: 'utility'},
    {name: 'AusNet', aliases: ['AusNet Services'], kind: 'utility'},
    {name: 'Energex', aliases: [], kind: 'utility'},
    {name: 'Ergon Energy', aliases: ['Ergon'], kind: 'utility'},
    {name: 'Endeavour Energy', aliases: [], kind: 'utility'},
    {name: 'Ausgrid', aliases: [], kind: 'utility'},
    {name: 'Jemena', aliases: [], kind: 'utility'},
    {name: 'Transport for NSW', aliases: ['TfNSW'], kind: 'road'},
    {name: 'SA DIT', aliases: ['Department for Infrastructure and Transport'], kind: 'road'},
    {name: 'VicRoads', aliases: ['Department of Transport and Planning'], kind: 'road'},
    {name: 'Transport and Main Roads', aliases: ['TMR'], kind: 'road'},
    {name: 'Optus', aliases: [], kind: 'telco'},
    {name: 'NBN Co', aliases: ['NBN'], kind: 'telco'},
    {name: 'Telstra', aliases: [], kind: 'telco'},
    {name: 'SMD Lawyers', aliases: [], kind: 'law'},
    {name: 'Hall & Wilcox', aliases: [], kind: 'law'},
    {name: 'Hoyle Da Silva', aliases: [], kind: 'law'},
    {name: 'DWF', aliases: [], kind: 'law'},
    {name: 'Sedgwick', aliases: [], kind: 'broker'}
  ];
  // Known fields, bounded: at most 40 accounts of six aliases, no duplicates.
  function cleanAccounts(raw) {
    var seen = {};
    return (Array.isArray(raw) ? raw : []).filter(function(item) { return item && typeof item === 'object' && text(item.name); }).map(function(item) {
      return {name: clipText(item.name, 60), aliases: (Array.isArray(item.aliases) ? item.aliases : []).map(function(alias) { return clipText(alias, 60); }).filter(Boolean).slice(0, 6),
        kind: ACCOUNT_KINDS.indexOf(item.kind) >= 0 ? item.kind : 'other'};
    }).filter(function(item) { var key = item.name.toLowerCase(); if (seen[key]) return false; seen[key] = true; return true; }).slice(0, 40);
  }
  function accountKey(value) { return text(value).toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim(); }
  // The accounts a piece of text names, in list order: whole words or phrases
  // only, so "Ergon" never matches inside another word.
  function accountsInText(value, accounts) {
    var hay = ' ' + accountKey(value) + ' ';
    return cleanAccounts(accounts).filter(function(account) {
      return [account.name].concat(account.aliases).some(function(term) { var key = accountKey(term); return key.length >= 2 && hay.indexOf(' ' + key + ' ') >= 0; });
    }).map(function(account) { return account.name; });
  }
  function accountsRules(context) {
    if (!context || !cleanAccounts(context.accounts).length) return [];
    return [
      '',
      'HIS ACCOUNTS:',
      '- A HIS ACCOUNTS block near the end of this prompt names the organisations his files involve: the insurers he works for, the utilities, road authorities and telcos whose claims he assesses, and the firms that instruct him.',
      '- Search for news on them. A story that names one and is otherwise worth his attention should be preferred, and its relevance line names the account and what it changes for his files.',
      '- A passing mention does not earn a story its place, and a quiet day for his accounts is normal. It is private context: never report the list, and never write as though anyone else can see it.'
    ];
  }
  function accountsBlock(context) {
    var accounts = context ? cleanAccounts(context.accounts) : [];
    if (!accounts.length) return [];
    return ['', 'HIS ACCOUNTS — private context, not news:', accounts.map(function(account) {
      return account.name + (account.aliases.length ? ' (' + account.aliases.join(', ') + ')' : '');
    }).join('; ')];
  }

  function feedbackRules(feedback) {
    if (!feedback || !feedback.block) return [];
    return [
      '',
      'READER FEEDBACK:',
      '- A READER FEEDBACK block near the end of this prompt lists recent stories Bob marked "more like this" or "less like this".',
      '- Use it to judge what kind of story is worth his attention today: favour the topics, angles and sections of the "more" list, and give the "less" kind lower priority or leave it out unless it bears directly on insurance, claims, business interruption or one of his open calls.',
      '- It is feedback, not news. Never report those stories again as new, and never mention the feedback itself in the briefing.',
      '- It adjusts priority only. It never overrides grounding, the item budget or the relevance definitions above.'
    ];
  }

  function feedbackBlock(feedback) {
    return feedback && feedback.block ? ['', feedback.block] : [];
  }

  // ── Reader feedback, from the votes ──
  //
  // Bob marks briefing stories "more like this" or "less like this" on Today
  // (lib/daily-boost.js keeps them on his synced Daily Boost days). Recent votes
  // become a short block of examples plus a per-section tally, so the model can
  // generalise the kind of story he finds useful without another model call.
  // Only the latest vote on each story counts, and a vote taken back (0) is none.
  // It lives here so the server generator and the copy button build the same
  // block from the same votes (functions/briefing-context.js re-exports it).
  var FEEDBACK_DAYS = 30, FEEDBACK_EXAMPLES = 10, DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
  function feedbackKey(item) {
    var url = String(item.url || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
    return url ? 'u:' + url : 'h:' + String(item.headline || '').trim().toLowerCase();
  }
  function shiftDayKey(dayKey, days) {
    return new Date(Date.parse(dayKey + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  }
  // entries: the Daily Boost entries map. todayKey: PHT day key.
  // Returns {block, stats:{up, down, days}} or null when there is nothing to say.
  function buildReaderFeedback(entries, todayKey) {
    if (!entries || typeof entries !== 'object' || !DAY_KEY.test(String(todayKey || ''))) return null;
    var since = shiftDayKey(todayKey, -FEEDBACK_DAYS), latest = {}, order = [];
    Object.keys(entries).filter(function(key) { return DAY_KEY.test(key) && key > since && key <= todayKey; }).sort().forEach(function(key) {
      var list = entries[key] && Array.isArray(entries[key].feedback) ? entries[key].feedback : [];
      list.forEach(function(item) {
        if (!item || typeof item.headline !== 'string' || !item.headline.trim() || [1, -1, 0].indexOf(item.vote) < 0) return;
        var id = feedbackKey(item), at = order.indexOf(id);
        if (at >= 0) order.splice(at, 1);
        order.push(id); // most recently voted last
        latest[id] = {headline:item.headline.trim().slice(0, 160), source:String(item.source || '').slice(0, 60), section:String(item.section || '').slice(0, 20), vote:item.vote, day:key};
      });
    });
    var votes = order.map(function(id) { return latest[id]; }).filter(function(item) { return item.vote !== 0; }).reverse();
    var up = votes.filter(function(item) { return item.vote === 1; }), down = votes.filter(function(item) { return item.vote === -1; });
    if (!up.length && !down.length) return null;
    function line(item) { return '- ' + (item.section ? '[' + item.section + '] ' : '') + item.headline + (item.source ? ' (' + item.source + ')' : ''); }
    function tally(list) {
      var counts = {};
      list.forEach(function(item) { if (item.section) counts[item.section] = (counts[item.section] || 0) + 1; });
      return Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a] || a.localeCompare(b); }).map(function(name) { return name + ' ' + counts[name]; }).join(', ');
    }
    var lines = ["READER FEEDBACK — Bob's reactions to recent briefing stories (last " + FEEDBACK_DAYS + ' days):'];
    if (up.length) lines = lines.concat(['More like this:'], up.slice(0, FEEDBACK_EXAMPLES).map(line));
    if (down.length) lines = lines.concat(['Less like this:'], down.slice(0, FEEDBACK_EXAMPLES).map(line));
    var bySection = [tally(up) && 'more useful — ' + tally(up), tally(down) && 'less useful — ' + tally(down)].filter(Boolean);
    if (bySection.length) lines.push('By section: ' + bySection.join('; ') + '.');
    var days = {};
    votes.forEach(function(item) { days[item.day] = true; });
    return {block:lines.join('\n'), stats:{up:up.length, down:down.length, days:Object.keys(days).length}};
  }

  // Rules for supplied market and weather numbers.
  //
  // WHY: the rule this replaces read "Market values should be current and
  // realistic", which is a request for plausible fiction — and these numbers sit
  // at the very top of the page, so a wrong PSEi print discredits every story
  // under it. The model is now given the real figures and told not to produce
  // any of its own. The server overwrites them afterwards regardless
  // (market-facts.applyFacts), for the same reason grounded URLs are verified
  // rather than trusted: an instruction is a request, not a guarantee.
  //
  // The prose stays the model's job. It is being handed arithmetic it cannot do
  // and asked for the explanation it can.
  function factsRules(facts) {
    if (!facts || !facts.lines || !facts.lines.length) return [];
    var rules = [
      '',
      'MARKET AND WEATHER FACTS — these override the example values in the schema:',
      '- A VERIFIED FIGURES block near the end of this prompt carries real, already-fetched numbers with the date each was observed.',
      '- Copy those figures verbatim into the matching fields. Do not recalculate, re-round, refresh or "update" them, and do not substitute a number you believe is more current.',
      '- Do not produce a market, FX or weather figure of your own for any field the block covers. These fields are not yours to estimate.',
      '- The prose around them IS yours: the peso driver and the weather impact note still need writing, and should be consistent with the supplied numbers.'
    ];
    if (facts.missing && facts.missing.length) {
      rules.push('- No verified figure was available for: ' + facts.missing.join(', ') +
        '. Leave those fields as empty strings. Do not fill them from your own knowledge or from a web search — a blank is honest and a guess is not.');
    }
    return rules;
  }

  // ── optional content blocks ───────────────────────────────────────────────

  function factsBlock(facts) {
    if (!facts || !facts.lines || !facts.lines.length) return [];
    return ['', 'VERIFIED FIGURES:'].concat(facts.lines);
  }

  // ── Recent briefings: no reruns ──
  //
  // Fourteen briefings (7–26 Sep) had up to 5–7 of ~13 stories re-running from
  // the three before, and the same watch event two days in a row: the model was
  // never shown what it had already told Bob. The last three briefings'
  // headlines and watch lines now come with the prompt, so a repeat has to earn
  // its place as an update and say what changed.
  var RECENT_SHOWN = 3, RECENT_HEADLINES = 14;
  var SECTION_ORDER = ['global', 'ph', 'insurance', 'interruptions', 'ai', 'markets', 'ev'];
  function shortText(value, max) {
    var flat = text(value).replace(/\s+/g, ' ');
    return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
  }
  // archive: [{dateKey, briefing}] in any order; todayKey: PHT day. Same-day
  // briefings are skipped, as the watch follow-up does, so a regenerated
  // briefing is not told its own stories from an hour ago are old news.
  // Returns {days:[{dateKey, dateLabel, items:[{section, headline}], watch}], stats} or null.
  function buildRecentBriefings(archive, todayKey) {
    if (!DAY_KEY.test(String(todayKey || ''))) return null;
    var byDay = {};
    (Array.isArray(archive) ? archive : []).forEach(function(row) {
      var key = row && String(row.dateKey || '');
      if (!DAY_KEY.test(key) || key >= todayKey || byDay[key] || !row.briefing || typeof row.briefing.sections !== 'object' || !row.briefing.sections) return;
      byDay[key] = row.briefing;
    });
    var days = Object.keys(byDay).sort().reverse().slice(0, RECENT_SHOWN).map(function(key) {
      var briefing = byDay[key], items = [];
      SECTION_ORDER.forEach(function(section) {
        (Array.isArray(briefing.sections[section]) ? briefing.sections[section] : []).forEach(function(story) {
          if (story && text(story.headline) && items.length < RECENT_HEADLINES) items.push({section: section, headline: shortText(story.headline, 160)});
        });
      });
      var wildcard = briefing.wildcard && typeof briefing.wildcard === 'object' ? shortText(briefing.wildcard.headline, 160) : '';
      return {dateKey: key, dateLabel: shortText(briefing.date, 60), items: items, watch: shortText(briefing.watch, 220), wildcard: wildcard};
    }).filter(function(day) { return day.items.length || day.watch || day.wildcard; });
    if (!days.length) return null;
    return {days: days, stats: {briefings: days.length, headlines: days.reduce(function(sum, day) { return sum + day.items.length; }, 0)}};
  }
  function recentRules(context) {
    var recent = context && context.recent;
    if (!recent || !recent.days || !recent.days.length) return [];
    return [
      '',
      'RECENT BRIEFINGS — no reruns:',
      '- A RECENT BRIEFINGS block near the end of this prompt lists the headlines and watch lines Bob was given in his last briefings.',
      '- Do not run a story on the same event again unless something material changed since: a new figure, decision, filing, date, count or reversal. If it did, the headline must start with "Update: " and the body must open with what changed. Never retell the earlier story.',
      '- If nothing material changed, leave it out and spend the budget on something new. A shorter briefing beats a rerun.',
      '- watch must not repeat either of the last two watch lines unless that event is decided or due today, and then it says what was decided or is due.',
      '- wildcard must not be a story, or a subject, listed as a Wildcard in the block.'
    ];
  }
  function recentBlock(context) {
    var recent = context && context.recent;
    if (!recent || !recent.days || !recent.days.length) return [];
    var lines = ['', 'RECENT BRIEFINGS — already given to Bob, newest first:'];
    recent.days.forEach(function(day) {
      lines.push((day.dateLabel || day.dateKey) + ':');
      day.items.forEach(function(item) { lines.push('- [' + item.section + '] ' + item.headline); });
      if (day.watch) lines.push('  Watch: ' + day.watch);
      if (day.wildcard) lines.push('  Wildcard: ' + day.wildcard);
    });
    return lines;
  }
  // How many of a new briefing's stories were declared updates, and how many
  // look like a recent headline without saying so — recorded on the briefing so
  // whether the rule holds can be read, not guessed. Similar means two or more
  // shared content words covering at least 60% of the shorter headline, the
  // same test the app uses for its New / Day N badges.
  var STOP = {the:1, and:1, for:1, with:1, from:1, into:1, over:1, after:1, amid:1, says:1, said:1, will:1, than:1, that:1, this:1, update:1};
  function contentWords(headline) {
    var out = {};
    text(headline).toLowerCase().replace(/[^a-z0-9$%.]+/g, ' ').split(' ').forEach(function(word) {
      word = word.replace(/^\.+|\.+$/g, '');
      if (word.length > 2 && !STOP[word]) out[word] = true;
    });
    return Object.keys(out);
  }
  function similarHeadline(a, b) {
    var wa = contentWords(a), wb = contentWords(b), shared = wa.filter(function(word) { return wb.indexOf(word) >= 0; }).length;
    return shared >= 2 && shared >= 0.6 * Math.min(wa.length, wb.length);
  }
  function countReruns(briefing, recent) {
    var seen = [], updates = 0, reruns = 0;
    ((recent && recent.days) || []).forEach(function(day) { day.items.forEach(function(item) { seen.push(item.headline); }); });
    var sections = briefing && briefing.sections && typeof briefing.sections === 'object' ? briefing.sections : {};
    Object.keys(sections).forEach(function(section) {
      (Array.isArray(sections[section]) ? sections[section] : []).forEach(function(story) {
        var headline = text(story && story.headline);
        if (!headline) return;
        if (/^update\s*:/i.test(headline)) updates++;
        else if (seen.some(function(old) { return similarHeadline(headline, old); })) reruns++;
      });
    });
    return {updates: updates, reruns: reruns};
  }

  // A short, stable id for one story, used to keep "Go deeper" dossiers: its
  // link without scheme, www, query or fragment (else its headline), hashed
  // twice with FNV-1a so the app and the server compute the same key.
  function storyDossierKey(story) {
    var url = text(story && story.url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
    var basis = url ? 'u:' + url : 'h:' + text(story && story.headline).toLowerCase().replace(/\s+/g, ' ');
    if (basis.length < 4) return '';
    function fnv(seed) {
      var hash = seed >>> 0;
      for (var i = 0; i < basis.length; i++) { hash ^= basis.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0; }
      return hash.toString(36);
    }
    return 'd' + fnv(2166136261) + fnv(33554467);
  }

  function standingBlock(context) {
    var standing = context && context.standing;
    return standing && standing.block ? ['', standing.block] : [];
  }

  function watchBlock(context) {
    var watch = context && context.watch;
    if (!watch || !watch.text) return [];
    var when = watch.dateLabel || watch.dateKey || 'the previous briefing';
    return [
      '',
      'PREVIOUS WATCH — what Bob was told to watch on ' + when + ':',
      watch.text + (watch.source ? ' (source given: ' + watch.source + ')' : '')
    ];
  }

  function evidenceBlock(evidence) {
    if (!evidence || evidence.unavailable || !evidence.block) return [];
    return ['', evidence.block];
  }

  function defaultDateLabel() {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'Asia/Manila'
    });
  }

  // options: {dateLabel, evidence, context, facts, feedback} — all optional.
  //
  // The evidence block stays LAST because the grounding rules address it as the
  // list "at the end of this prompt". Everything else is referenced by heading
  // instead, so those blocks can sit between the rules and it without any rule
  // having to know the running order.
  function buildBriefingPrompt(options) {
    var opts = options || {};
    var evidence = opts.evidence;
    var context = opts.context;
    var facts = opts.facts;
    var feedback = opts.feedback;
    var date = text(opts.dateLabel) || defaultDateLabel();
    var lens = wildcardLens(date);

    return [
      'You are an intelligence briefing analyst preparing a daily briefing for Bob.',
      'Bob is a forensic business-interruption and claims-quantum specialist working for Australian insurers (mainly QBE and Allianz) and their solicitors, and with Philippine consulting firms.',
      '',
      "Generate today's briefing (" + date + ') as a single JSON object with this exact schema:',
      '{',
      '  "date": "' + date + '",',
      '  "markets": {',
      '    "psei": "6,450.23",',
      '    "psei_move": "+0.8% Up",',
      '    "asx": "8,102.50",',
      '    "asx_move": "-0.3% Down",',
      '    "sp500": "5,890.12",',
      '    "sp500_move": "+0.5% Up"',
      '  },',
      '  "peso": {',
      '    "usdphp": "58.42",',
      '    "usdphp_move": "+0.18% Peso weaker",',
      '    "driver": "Short explanation of the peso move"',
      '  },',
      '  "weather": {',
      '    "location": "Metro Manila",',
      '    "summary": "Scattered thunderstorms",',
      '    "temp_c": "27-32C",',
      '    "rain_chance": "70%",',
      '    "impact": "Claims/interruption relevance for the day"',
      '  },',
      '  "sections": {',
      '    "global": [{"headline": "", "body": "", "source": "", "url": "", "relevance": "", "relevance_level": "med"}],',
      '    "ph": [{"headline": "", "body": "", "source": "", "url": "", "relevance": "", "relevance_level": "med", "market_category": "macro", "market_subject": ""}],',
      '    "insurance": [{"headline": "", "body": "", "source": "", "url": "", "relevance": "", "relevance_level": "high", "watch_metric": "", "horizon": "weeks"}],',
      '    "interruptions": [{"headline": "", "body": "", "source": "", "url": "", "relevance": "", "relevance_level": "med", "watch_metric": "", "horizon": "days"}],',
      '    "ai": [{"headline": "", "body": "", "source": "", "url": "", "relevance": "", "relevance_level": "med"}],',
      '    "markets": [{"headline": "", "body": "", "source": "", "url": "", "relevance": "", "relevance_level": "med", "market_category": "macro", "market_subject": ""}],',
      '    "ev": [{"headline": "", "body": "", "source": "", "url": "", "relevance": "", "relevance_level": "med"}]',
      '  },',
      '  "watch": "One key development to monitor over the coming days.",',
      '  "watch_source": "Source name",',
      '  "watch_followup": {"prior": "", "status": "advanced", "note": ""},',
      '  "aha": {"kind": "connection", "title": "", "insight": "", "chain": ["", ""], "links": [""], "wrong_if": ""},',
      '  "wildcard": {"lens": "' + lens.id + '", "headline": "", "body": "", "source": "", "url": "", "bridge": ""}',
      '}',
      '',
      'Rules:',
      '- Output only valid JSON. No markdown fences. No prose before or after.',
      '- The sections are: global, ph, insurance, interruptions, ai, markets, ev. Every one must be present as an array, and any of them may be empty.',
      '- Item budget: at most 14 stories across the whole briefing, and at most 4 in any one section.',
      "- Never pad. A section with nothing genuinely worth Bob's attention today returns []. An empty section is a real answer, and a quiet day should produce a short briefing rather than a padded one.",
      '- Spend the budget in priority order: insurance and interruptions first, then global, ph and markets, then ai and ev. Include an ai or ev item only if it would survive being cut for space.',
      '- watch_followup must be null unless a PREVIOUS WATCH block appears in this prompt.',
      '- The insurance section must be rich in Australian insurance, reinsurance, claims inflation, underwriting, catastrophe exposure, regulatory, audit, and forensic BI implications.',
      '- The interruptions section must focus on business interruption, supply chain disruption, transport/port/power outages, weather events, strikes, cyber outages, plant closures, and events that could affect insured losses or consulting work.',
      // This replaces "must include a specific Bob-facing insight: likely
      // claim/BI angle, data to monitor, affected industries, or consulting
      // opportunity" — four alternatives joined by OR, which a model satisfies
      // by picking the cheapest. The result was reliably a sentence like "watch
      // for claims impact": true, unfalsifiable, and no use on a Tuesday.
      //
      // Splitting it into fields with different failure modes is what forces
      // specificity. A loss mechanism has to name someone exposed; a
      // watch_metric has to name something that can actually be looked up and
      // found to have moved or not; a horizon has to commit to when. The hedge
      // ban then closes the last exit, and points it at the budget: a story you
      // can only hedge about is one to drop, not one to pad with.
      '- Every insurance and interruptions story carries two extra fields and a stricter relevance:',
      '  - relevance must state the loss mechanism in one sentence: WHO is exposed and THROUGH WHAT. Name the industry, the class of insured, or the cover in question.',
      '    Build that sentence around whatever is sharpest (the mechanism, the figure, the cover wording, the timing), not a set frame. Do not write "... are exposed through ...".',
      '  - watch_metric must name ONE checkable thing — a filing, a regulator page, an index, a published figure, a court or hearing date — with who publishes it and when it is next due. "Monitor developments" and "watch for updates" are not watch_metrics.',
      '  - horizon must be exactly one of: days, weeks, months.',
      '- Do not hedge. If the most you can say is that something "could impact", "may be relevant", "bears watching" or "remains to be seen", you do not have a story: leave it out and spend the budget on one you can be specific about.',
      '- Include USD/PHP in the peso object, with whether the peso strengthened or weakened and a short driver.',
      "- Include today's Metro Manila weather forecast and an insurance/interruption impact note.",
      '- Use current or very recent news from today or yesterday where possible.',
      // Measured 12-26 Sep 2026: two to four stories a day only restated the
      // PSEi, ASX 200 or peso close, which the markets and peso objects already
      // show, and the cause they named was often its own story the same day.
      '- A daily index or currency close (PSEi, ASX 200, S&P 500, the peso) is not a story: the markets and peso objects already carry those numbers, and a peso record belongs in peso.driver.',
      '  A market move earns a story only when the story is about its cause (a policy decision, a named company, a fund flow, a forecast change) and that cause is not already a story in this briefing. Lead with the cause, not the close.',
      // Two changes to relevance_level, both about making the label mean
      // something. Sub-med items were being generated and then silently
      // discarded — command-center-core.js drops everything below med — so they
      // cost tokens and page space to reach a filter. And nothing capped `high`,
      // which let the model mark its whole output high at no cost; a priority
      // that applies to everything is not a priority. Three is the cap because
      // the Morning 5 is five items wide and Radar, Markets and Decisions also
      // compete for it.
      '- relevance_level must be either high or med. Do not return low or none items at all: anything that would earn one is not worth the space, and the budget is better spent on fewer, stronger stories.',
      '- high means Bob would act on it or raise it this week: it changes a claim, a reserve, a cover position, an engagement, a client conversation or a call he holds. Being about insurance, BI or his markets is what earns a story its place; it does not make it high.',
      '- med means worth knowing: it bears on his field, his clients or the economy they work in (insurance, forensic BI, claims, audit, BSP, ASX, AUD, trade, inflation, supply chain, regulation, technology), but asks nothing of him this week.',
      '- At most 3 stories in the whole briefing may be high, and high is earned, not allotted: most days have one or two, and a day with none is a real answer. Never mark a story high to reach three. If more than three qualify, they are not all high — rank them and mark the rest med.',
      '- The relevance field says why the story matters, starting with the substance. The card already labels it "Why it matters" and the whole briefing is for Bob, so do not name him or announce it:',
      '  never open with "This matters to Bob", "For Bob", "Bob should", "This matters because" or "This is relevant". No two relevance lines in the briefing may open with the same three words.',
      '- For the ph and markets sections ONLY, tag each story with market_category, one of: specific, macro, none.',
      '  - specific = about a particular Philippine stock-exchange-listed company or its shares (e.g. SM, Ayala, BDO, Jollibee, PLDT, Meralco, ICTSI, San Miguel). Put the company name in market_subject.',
      "  - macro = the Philippine market/economy broadly: PSEi, the peso, BSP, interest rates, inflation, GDP, trade, remittances, fiscal/policy, or a whole sector. Put the theme in market_subject (e.g. 'BSP rates', 'peso', 'PSEi').",
      '  - none = not related to the Philippine stock market or economy. Leave market_subject empty.',
      '  - Omit market_category for all other sections (global, insurance, interruptions, ai, ev).',
      '- Each story body should be 2-3 concise sentences.',
      // Every story used to leave url empty outside the grounded sections, so
      // most cards had nothing to click through to. A link is only worth having
      // if it is the real page: the server checks each one against the URLs the
      // search tool actually returned and strips any it cannot match, so a
      // remembered or tidied url is removed rather than shown.
      '- Every story carries url: the address of the article page it came from, copied exactly from a web search result you retrieved for this briefing.',
      '  - Never type a url from memory, and never shorten, tidy or rebuild one. Do not use a homepage, section page, tag page or search page; it must be the story itself.',
      '  - If the story did not come from a search result, leave url empty. A missing link is honest; a wrong one looks citable and is not.'
    ]
      .concat(ahaRules())
      .concat(wildcardRules(lens))
      .concat(groundingRules(evidence))
      .concat(workRules())
      .concat(accountsRules(context))
      .concat(standingRules(context))
      .concat(watchRules(context))
      .concat(recentRules(context))
      .concat(feedbackRules(feedback))
      .concat(factsRules(facts))
      .concat(standingBlock(context))
      .concat(accountsBlock(context))
      .concat(watchBlock(context))
      .concat(recentBlock(context))
      .concat(feedbackBlock(feedback))
      .concat(factsBlock(facts))
      .concat(evidenceBlock(evidence))
      .join('\n');
  }

  var api = {buildBriefingPrompt: buildBriefingPrompt, defaultDateLabel: defaultDateLabel, buildReaderFeedback: buildReaderFeedback, cleanAha: cleanAha, buildRecentBriefings: buildRecentBriefings, countReruns: countReruns, storyDossierKey: storyDossierKey,
    cleanWildcard: cleanWildcard, wildcardLens: wildcardLens, WILDCARD_LENSES: WILDCARD_LENSES,
    DEFAULT_ACCOUNTS: DEFAULT_ACCOUNTS, ACCOUNT_KINDS: ACCOUNT_KINDS, cleanAccounts: cleanAccounts, accountsInText: accountsInText};
  root.BriefingPromptCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
