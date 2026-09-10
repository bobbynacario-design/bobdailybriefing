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
      '- The interruptions section may also draw on the list where a story fits, using the same exact url. For anything else in that section, web-search as usual and leave url empty.',
      '- Leave url empty in every other section.'
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
      "- A STANDING CONTEXT block near the end of this prompt lists Bob's open calls, the radar setups he is tracking, and the event markets past his research gate.",
      '- It is private working state, not news. Never report any of it as a story, never echo it back as a headline, and never write as though anyone else can see it.',
      "- Where a story genuinely bears on a named call, setup or market, say so in that story's relevance field and name the asset or market explicitly.",
      '- Most stories will bear on none of it. That is the normal case and it is fine. Do not manufacture a connection — a forced link reads exactly like a real one, which makes it worse than no link at all.',
      '- Never recommend buying, selling, holding, exiting, sizing or hedging, and never tell Bob a thesis is right or wrong. Report what changed and what to watch; the call stays his.',
      '- If a story bears on the stated invalidation line of an open call, that is the single most useful thing you can surface today. Name the call and the condition, and stop there.'
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

  // options: {dateLabel, evidence, context, facts} — all optional.
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
    var date = text(opts.dateLabel) || defaultDateLabel();

    return [
      'You are an intelligence briefing analyst preparing a daily briefing for Bob.',
      'Bob is a forensic BI consultant who works with Australian insurance companies and Philippine consulting firms.',
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
      '    "global": [{"headline": "", "body": "", "source": "", "relevance": "", "relevance_level": "high"}],',
      '    "ph": [{"headline": "", "body": "", "source": "", "relevance": "", "relevance_level": "med", "market_category": "macro", "market_subject": ""}],',
      '    "insurance": [{"headline": "", "body": "", "source": "", "url": "", "relevance": "", "relevance_level": "high", "watch_metric": "", "horizon": "weeks"}],',
      '    "interruptions": [{"headline": "", "body": "", "source": "", "url": "", "relevance": "", "relevance_level": "high", "watch_metric": "", "horizon": "days"}],',
      '    "ai": [{"headline": "", "body": "", "source": "", "relevance": "", "relevance_level": "med"}],',
      '    "markets": [{"headline": "", "body": "", "source": "", "relevance": "", "relevance_level": "med", "market_category": "macro", "market_subject": ""}],',
      '    "ev": [{"headline": "", "body": "", "source": "", "relevance": "", "relevance_level": "med"}]',
      '  },',
      '  "watch": "One key development to monitor over the coming days.",',
      '  "watch_source": "Source name",',
      '  "watch_followup": {"prior": "", "status": "advanced", "note": ""}',
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
      '  - watch_metric must name ONE checkable thing — a filing, a regulator page, an index, a published figure, a court or hearing date — with who publishes it and when it is next due. "Monitor developments" and "watch for updates" are not watch_metrics.',
      '  - horizon must be exactly one of: days, weeks, months.',
      '- Do not hedge. If the most you can say is that something "could impact", "may be relevant", "bears watching" or "remains to be seen", you do not have a story: leave it out and spend the budget on one you can be specific about.',
      '- Include USD/PHP in the peso object, with whether the peso strengthened or weakened and a short driver.',
      "- Include today's Metro Manila weather forecast and an insurance/interruption impact note.",
      '- Use current or very recent news from today or yesterday where possible.',
      // Two changes to relevance_level, both about making the label mean
      // something. Sub-med items were being generated and then silently
      // discarded — command-center-core.js drops everything below med — so they
      // cost tokens and page space to reach a filter. And nothing capped `high`,
      // which let the model mark its whole output high at no cost; a priority
      // that applies to everything is not a priority. Three is the cap because
      // the Morning 5 is five items wide and Radar, Markets and Decisions also
      // compete for it.
      '- relevance_level must be either high or med. Do not return low or none items at all: anything that would earn one is not worth the space, and the budget is better spent on fewer, stronger stories.',
      '- high means directly relevant to insurance, forensic BI, claims, consulting, audit, CPA, underwriting, BSP, ASX, AUD, reinsurance, or business interruption.',
      '- med means relevant to broader economy, markets, trade, inflation, supply chain, regulation, or technology trends.',
      '- At most 3 stories in the whole briefing may be high. If more than three feel high, they are not all high — rank them and mark the rest med.',
      '- The relevance field must explain why it matters to Bob.',
      '- For the ph and markets sections ONLY, tag each story with market_category, one of: specific, macro, none.',
      '  - specific = about a particular Philippine stock-exchange-listed company or its shares (e.g. SM, Ayala, BDO, Jollibee, PLDT, Meralco, ICTSI, San Miguel). Put the company name in market_subject.',
      "  - macro = the Philippine market/economy broadly: PSEi, the peso, BSP, interest rates, inflation, GDP, trade, remittances, fiscal/policy, or a whole sector. Put the theme in market_subject (e.g. 'BSP rates', 'peso', 'PSEi').",
      '  - none = not related to the Philippine stock market or economy. Leave market_subject empty.',
      '  - Omit market_category for all other sections (global, insurance, interruptions, ai, ev).',
      '- Each story body should be 2-3 concise sentences.'
    ]
      .concat(groundingRules(evidence))
      .concat(standingRules(context))
      .concat(watchRules(context))
      .concat(factsRules(facts))
      .concat(standingBlock(context))
      .concat(watchBlock(context))
      .concat(factsBlock(facts))
      .concat(evidenceBlock(evidence))
      .join('\n');
  }

  var api = {buildBriefingPrompt: buildBriefingPrompt, defaultDateLabel: defaultDateLabel};
  root.BriefingPromptCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
