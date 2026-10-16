"use strict";

const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");
const {getAuth} = require("firebase-admin/auth");
const OpenAI = require("openai");
const {researchResult} = require("./research-result");
const {missingReportAction} = require("./webhook-event");
const {buildCommandCenter} = require("./command-center-core");
const {buildEvidence, verifyGrounding, searchUrls, urlKey} = require("./briefing-evidence");
const {buildStandingContext, priorWatch, buildReaderFeedback, recentBriefingDocs} = require("./briefing-context");
const {buildBriefingPrompt, cleanAha, cleanWildcard, buildRecentBriefings, countReruns, storyDossierKey, cleanAccounts, DEFAULT_ACCOUNTS, profileBrief} = require("./briefing-prompt-core");
const {cleanStory, buildDossierPrompt, cleanDossier, keepDossiers, SYSTEM: DOSSIER_SYSTEM} = require("./story-dossier");
const {cleanTopic, cleanMaterial, buildMeetingPrompt, cleanBrief, keepBriefs, materialFromIndex, SYSTEM: MEETING_SYSTEM} = require("./meeting-brief");
const {
  parseYahooChart, parseOpenMeteo, buildFacts, applyFacts,
} = require("./market-facts");
const {authorize, daybookRole, guardedGeneration} = require("./generation-guard");
const {
  normalizeDelivery, isQuietTime, selectDeliverable, decisionAsks, todayLine, pseLine, fareWatchLine, bookedTripLine, askedAfter, urgentItems, pushKind, ledAfter, pushedAfter,
  notificationCopy, todaysSparkTitle, dueReminders, dueExperiment, reminderIds, newReminders, weeklyReadDue,
  commitmentLine, weeklyReviewDue,
} = require("./delivery-core");
const DailyBoostCore = require("./daily-boost");
const WeeklyReviewCore = require("./weekly-review-core");
// His calendar, PokerHQ picks and Flights as Ask Daybook records.
const LifeRecordsCore = require("./life-records-core");
const DaybookCalendarCore = require("./daybook-calendar-core");
const FlightsCore = require("./flights-core");
// Apple Health from an iOS Shortcut: daily rows and the private link.
const HealthCore = require("./health-core");
const HealthLink = require("./health-link");
const HealthResearch = require("./health-research");
const PsePaper = require("./pse-paper");
const {buildMirrorInput, buildMirrorPrompt, cleanMirror, keepRecent, MIRROR_SCHEMA, SYSTEM: MIRROR_SYSTEM} = require("./weekly-mirror");
const Ask = require("./ask-daybook");
const Haiku = require("./haiku");
const TripActivities = require("./trip-activities");
const ActivityLocations = require("./activity-locations");
const Note = require("./client-note");
const Calendar = require("./calendar");
const IntelligenceSearchCore = require("./intelligence-search-core");
const {dispatchFeed} = require("./news-dispatch");
const {extractUsage, webSearchCount, recordUsage, recordSearches} = require("./llm-usage");

initializeApp();

// Server-only paper books: immutable thesis snapshots, separate outcomes.
// No client writes and no order execution. Each member can access only their book.
exports.recordPsePaperPick = onCall({region:"asia-southeast1",timeoutSeconds:60},async request=>{
  await requireDaybookMember(request.auth,"saving a PSE paper pick");
  try {return await PsePaper.recordPick(getFirestore(),request.auth.uid,request.data || {});}
  catch(e){throw new HttpsError(['invalid-argument','already-exists','failed-precondition','resource-exhausted'].includes(e.code) ? e.code : 'internal',e.code ? e.message : 'Could not save the paper pick. Retry with the same draft.');}
});
exports.listPsePaperPicks = onCall({region:"asia-southeast1",timeoutSeconds:60},async request=>{
  await requireDaybookMember(request.auth,"loading PSE paper picks");
  return PsePaper.listPicks(getFirestore(),request.auth.uid);
});

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const OPENAI_WEBHOOK_SECRET = defineSecret("OPENAI_WEBHOOK_SECRET");
// Server-only key (Places API (New) + Street View Static) for activity surroundings.
const GOOGLE_MAPS_SERVER_KEY = defineSecret("GOOGLE_MAPS_SERVER_KEY");
// A fine-grained GitHub token for this repo with Actions read and write only.
const GITHUB_DISPATCH_TOKEN = defineSecret("GITHUB_DISPATCH_TOKEN");
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const GENERATION_OWNERS = (process.env.GENERATION_OWNER_EMAILS || "bobbynacario@gmail.com").split(",").map(s => s.trim().toLowerCase());
exports.activitySurroundings = onCall({region:"asia-southeast1",secrets:[GOOGLE_MAPS_SERVER_KEY],timeoutSeconds:30,memory:"256MiB"},async request=>{
  try{authorize(request.auth,GENERATION_OWNERS);return await ActivityLocations.locate({db:getFirestore(),data:request.data || {},apiKey:GOOGLE_MAPS_SERVER_KEY.value()});}
  catch(e){throw new HttpsError(['unauthenticated','permission-denied','invalid-argument'].includes(e.code)?e.code:'internal',e.code?e.message:'Place lookup is unavailable. Use the map search.');}
});
exports.tripActivities = onCall({region:"asia-southeast1",secrets:[ANTHROPIC_API_KEY,GOOGLE_MAPS_SERVER_KEY],timeoutSeconds:120,memory:"256MiB"},async request=>{
  try {
    authorize(request.auth,GENERATION_OWNERS);
    return await TripActivities.run({db:getFirestore(),uid:request.auth.uid,data:request.data || {},period:phtDateKey(),apiKey:GOOGLE_MAPS_SERVER_KEY.value(),generate:async(prompt,schema)=>{
      const answer=await Haiku.message({apiKey:ANTHROPIC_API_KEY.value(),timeoutMs:80000,
        onUsage:(model,usage)=>recordUsage(getFirestore(),"trip-activities",model,usage,phtDateKey()),
        body:{max_tokens:8000,system:"You are a practical trip planner. Ground named experiences in the provided sources and respect the user's actual constraints.",messages:[{role:"user",content:prompt}],output_config:{effort:"low",format:{type:"json_schema",schema}}}});
      return Haiku.textOf(answer);
    }});
  } catch(e) {throw new HttpsError(["unauthenticated","permission-denied","invalid-argument","failed-precondition","resource-exhausted","unavailable","aborted","internal"].includes(e.code)?e.code:"internal",e.code?e.message:"Could not build a grounded activity plan. No automatic retry was made.",e.details);}
});
function protectGeneration(feature, handler) {
  return async request => {
    try {
      authorize(request.auth, GENERATION_OWNERS);
      const data = request.data || {};
      if (feature === "briefing" && data.model && data.model !== DEFAULT_MODEL) {
        throw new HttpsError("invalid-argument", "The requested model is not enabled.");
      }
      if (feature === "research" && (typeof data.topic !== "string" || data.topic.trim().length < 8 || data.topic.length > 4000)) {
        throw new HttpsError("invalid-argument", "Enter a research topic between 8 and 4,000 characters.");
      }
      if (feature === "briefing" && String(data.date || "").length > 100) throw new HttpsError("invalid-argument", "Invalid date label.");
      if (feature === "dossier" && !cleanStory(data.story)) throw new HttpsError("invalid-argument", "Choose a briefing story to go deeper on.");
      if (feature === "meeting" && !cleanTopic(data.topic)) throw new HttpsError("invalid-argument", "Name the client, insurer or topic (at least three characters).");
      if (feature === "ask" && !Ask.cleanQuestion(data.question)) throw new HttpsError("invalid-argument", "Type a question first (at least three characters).");
      if (feature === "note" && !Note.cleanNoteRequest(data)) throw new HttpsError("invalid-argument", "Choose who the note is for.");
      if (feature === "health" && data.refresh !== undefined && typeof data.refresh !== "boolean") throw new HttpsError("invalid-argument", "Invalid request.");
      const daily = feature === "briefing" || feature === "mirror" || feature === "dossier" || feature === "meeting" || feature === "ask" || feature === "note";
      return await guardedGeneration({db:getFirestore(), uid:request.auth.uid, feature,
        period:daily ? phtDateKey() : phtDateKey().slice(0,7),
        cap:feature === "briefing" ? Number(process.env.BRIEFING_DAILY_CAP || 5) : feature === "mirror" ? MIRROR_DAILY_CAP : feature === "dossier" ? DOSSIER_DAILY_CAP :
          feature === "meeting" ? MEETING_DAILY_CAP : feature === "ask" ? ASK_DAILY_CAP : feature === "note" ? NOTE_DAILY_CAP : feature === "health" ? HEALTH_RESEARCH_MONTHLY_CAP : DEEP_RESEARCH_CAP,
        requestId:data.requestId,
        input:feature === "briefing" ? {date:data.date || "",model:DEFAULT_MODEL} : feature === "mirror" ? {week:phtDateKey()} : feature === "dossier" ? {story:storyDossierKey(cleanStory(data.story)),refresh:data.refresh === true} :
          feature === "meeting" ? {topic:cleanTopic(data.topic),items:cleanMaterial(data.material).length} :
          feature === "ask" ? {question:Ask.cleanQuestion(data.question),web:data.web === true,thread:Ask.cleanThread(data.thread).length} :
          feature === "note" ? Note.cleanNoteRequest(data) :
          feature === "health" ? {week:WeeklyReviewCore.weekStart(phtDateKey()),refresh:data.refresh === true} : {topic:data.topic.trim(),premium:!!data.premium}
      }, () => handler(request));
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      const codes = ["unauthenticated","permission-denied","invalid-argument","resource-exhausted","failed-precondition"];
      throw new HttpsError(codes.includes(error.code) ? error.code : "internal", codes.includes(error.code) ? error.message : "Generation could not complete. Check existing results before trying again.");
    }
  };
}

// Deep-research generation config (all override-able via env)
const DEEP_MODEL_DEFAULT = process.env.DEEP_MODEL_DEFAULT || "o4-mini-deep-research";
const DEEP_MODEL_PREMIUM = process.env.DEEP_MODEL_PREMIUM || "o3-deep-research";
const DEEP_RESEARCH_CAP = parseInt(process.env.DEEP_RESEARCH_CAP || "20", 10);
// Weekly mirror reads a day: enough to regenerate after writing more, not a loop.
const MIRROR_DAILY_CAP = parseInt(process.env.MIRROR_DAILY_CAP || "3", 10);
// Go deeper dossiers a day: plenty for the stories worth taking further.
const DOSSIER_DAILY_CAP = parseInt(process.env.DOSSIER_DAILY_CAP || "10", 10);
// This week's health research: the Sunday job plus his own builds and rebuilds.
const HEALTH_RESEARCH_MONTHLY_CAP = parseInt(process.env.HEALTH_RESEARCH_MONTHLY_CAP || "8", 10);
// Meeting briefs: one page before a call; five a day is plenty.
const MEETING_DAILY_CAP = parseInt(process.env.MEETING_DAILY_CAP || "5", 10);
// Meeting briefs built from his calendar the evening before (Bob chose up to 3 a day).
const MEETING_AUTO_CAP = parseInt(process.env.MEETING_AUTO_CAP || "3", 10);
// Ask Daybook questions a day (Bob chose 20 on 2026-10-01).
const ASK_DAILY_CAP = parseInt(process.env.ASK_DAILY_CAP || "20", 10);
// Draft a note (functions/client-note.js): Haiku, a cent or so each.
const NOTE_DAILY_CAP = parseInt(process.env.NOTE_DAILY_CAP || "15", 10);
const REPORTS_COLL = "reports-bob";
const REPORTS_META = "reports-bob-meta";
const WEBHOOK_EVENTS_COLL = "openai-webhook-events";
const COMMAND_PREF_PREFIX = "command-prefs-";
const BRIEFINGS_COLL = "briefings-bob";
const JOURNAL_COLL = "journal-bob";
const COMMAND_URL = "https://bobbynacario-design.github.io/bobdailybriefing/#command";
const TODAY_URL = "https://bobbynacario-design.github.io/bobdailybriefing/#today";

// ── LLM usage telemetry: functions/llm-usage.js (CJS twin of lib/llm-usage.js) ──
// Optional `at` (ms or Date) so a stored document can be placed on the PHT day
// it was actually written, not the day it is being read. Archived briefings are
// keyed by a slugified date LABEL ("Thursday--September-11--2026"), which is not
// parseable as a date, so `saved` is the only reliable clock they carry.
function phtDateKey(at) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at == null ? new Date() : new Date(at));
}

// The prompt itself now lives in lib/briefing-prompt-core.js, synced here as a
// CJS twin by sync-shared-core.js. It was duplicated across this file and two
// functions in index.html, and the three had drifted far enough apart that the
// prompt Bob could read in the app was not the prompt that ran. See that file.
function extractText(responseJson) {
  if (typeof responseJson.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }
  const chunks = [];
  (responseJson.output || []).forEach((item) => {
    (item.content || []).forEach((content) => {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      if (content.type === "text" && content.text) chunks.push(content.text);
    });
  });
  return chunks.join("").trim();
}

function parseBriefing(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return a JSON object");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

// Load the day's fetched insurance headlines so the briefing can be grounded in
// them. NEVER throws: if the news feed is unreachable, stale or empty, the
// briefing still generates on the pre-grounding prompt and records why, rather
// than a news outage taking down briefing generation entirely.
async function loadNewsEvidence(db) {
  try {
    const pointer = await db.collection(BRIEFINGS_COLL).doc("news-latest").get();
    const value = pointer.exists && pointer.data() && pointer.data().value;
    if (!value) return {evidence: null, reason: "no-pointer"};

    const snap = await db.collection(BRIEFINGS_COLL).doc("news-" + value).get();
    if (!snap.exists) return {evidence: null, reason: "no-doc"};

    const evidence = buildEvidence(snap.data());
    if (!evidence) return {evidence: null, reason: "no-doc"};
    if (evidence.unavailable) {
      return {evidence: null, reason: evidence.unavailable, ageDays: evidence.ageDays || null};
    }
    return {evidence, reason: null};
  } catch (error) {
    logger.warn("news evidence unavailable", {message: error.message});
    return {evidence: null, reason: "error"};
  }
}

// Load Bob's own open state and his last watch item. Like loadNewsEvidence this
// NEVER throws: standing context makes a briefing sharper, but a Firestore
// hiccup on the decisions query must not be able to stop the day's briefing
// being generated at all. Each read is caught individually so one missing feed
// costs only its own section — a failed radar pointer should not also silence
// the open calls, which are the part that matters most.
//
// The 100-decision window matches userCommandInputs(); buildStandingContext then
// filters to live calls and keeps the newest ten.
// Bob's recent "more like this / less like this" votes, from his synced Daily
// Boost doc. Best effort: without them the briefing is built as before.
async function loadReaderFeedback(db, uid) {
  if (!uid) return null;
  try {
    const doc = await db.collection(BRIEFINGS_COLL).doc("daily-boost-" + uid).get();
    return buildReaderFeedback(doc.exists ? doc.data().entries : {}, phtDateKey());
  } catch (error) {
    logger.warn("reader feedback unavailable", {message: error.message});
    return null;
  }
}

async function loadStandingContext(db, uid) {
  if (!uid) return {standing: null, watch: null, reason: "no-uid"};
  try {
    const [radar, markets, decisionsSnap, briefingSnap, accountsSnap] = await Promise.all([
      pointedDocument(db, "radar-latest", "radar-").catch(() => null),
      pointedDocument(db, "miro-latest", "miro-").catch(() => null),
      db.collection(JOURNAL_COLL).where("uid", "==", uid)
        .orderBy("saved", "desc").limit(100).get().catch(() => null),
      recentBriefingDocs(db.collection(BRIEFINGS_COLL), uid, 5).catch(() => null),
      db.collection(BRIEFINGS_COLL).doc("accounts-" + uid).get().catch(() => null),
    ]);
    // His accounts (Evidence, Your accounts), or the starter list until he keeps his own.
    const kept = accountsSnap && accountsSnap.exists ? cleanAccounts((accountsSnap.data() || {}).accounts) : [];

    const decisions = decisionsSnap ?
      decisionsSnap.docs.map((doc) => Object.assign({id: doc.id}, doc.data())) : [];

    // recentBriefingDocs keeps only documents with a briefing payload; the
    // trip and snapshot documents beside them in briefings-bob are skipped.
    const archive = briefingSnap ? briefingSnap.map((doc) => {
      const value = doc.data() || {};
      let briefing = null;
      try {
        briefing = JSON.parse(value.data);
      } catch (error) {
        briefing = null;
      }
      return {dateKey: phtDateKey(value.saved), briefing};
    }) : [];

    return {
      standing: buildStandingContext({decisions, radar, markets}),
      watch: priorWatch(archive, phtDateKey()),
      // The last three briefings' headlines and watch lines, so a story only
      // comes back as an "Update:" that says what changed (briefing-prompt-core).
      recent: buildRecentBriefings(archive, phtDateKey()),
      accounts: kept.length ? kept : DEFAULT_ACCOUNTS,
      accountsSource: kept.length ? "his" : "starter",
      reason: null,
    };
  } catch (error) {
    logger.warn("standing context unavailable", {message: error.message});
    return {standing: null, watch: null, recent: null, accounts: DEFAULT_ACCOUNTS, accountsSource: "starter", reason: "error"};
  }
}

// Metro Manila. radar/ph-snapshot.js already fetches PSEi and USD/PHP into
// briefings-bob/radar-ph, so only the two remaining indices and the forecast
// need a call of their own.
const MANILA = {latitude: 14.5995, longitude: 120.9842};
const FACTS_TIMEOUT_MS = 8000;

// One bounded GET returning parsed JSON, or null. Never throws: a figure that
// cannot be fetched becomes a blank in the briefing, which is a worse briefing
// but still a briefing. Nothing here is allowed to fail generation.
async function fetchJson(url, label) {
  try {
    const response = await fetch(url, {
      headers: {"User-Agent": "Mozilla/5.0 (bobdailybriefing)"},
      signal: AbortSignal.timeout(FACTS_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn("market fact fetch failed", {label, status: response.status});
      return null;
    }
    return await response.json();
  } catch (error) {
    logger.warn("market fact fetch error", {label, message: error.message});
    return null;
  }
}

function yahooChartUrl(symbol) {
  return "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) + "?interval=1d&range=5d";
}

function openMeteoUrl() {
  return "https://api.open-meteo.com/v1/forecast" +
    "?latitude=" + MANILA.latitude + "&longitude=" + MANILA.longitude +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code" +
    "&timezone=Asia%2FManila&forecast_days=1";
}

// The real numbers for the top of the briefing. Every source is independent and
// individually caught, so a Yahoo outage costs the ASX and S&P figures and
// nothing else — PSEi, the peso and the forecast still arrive.
async function loadMarketFacts(db) {
  try {
    const [ph, asxJson, spJson, weatherJson] = await Promise.all([
      db.collection(BRIEFINGS_COLL).doc("radar-ph").get()
        .then((snap) => (snap.exists ? snap.data() : null)).catch(() => null),
      fetchJson(yahooChartUrl("^AXJO"), "ASX 200"),
      fetchJson(yahooChartUrl("^GSPC"), "S&P 500"),
      fetchJson(openMeteoUrl(), "Metro Manila forecast"),
    ]);
    return buildFacts({
      ph,
      asx: parseYahooChart(asxJson),
      sp500: parseYahooChart(spJson),
      weather: parseOpenMeteo(weatherJson),
    });
  } catch (error) {
    logger.warn("market facts unavailable", {message: error.message});
    return null;
  }
}

exports.generateBobDailyBriefing = onCall(
  {
    region: "asia-southeast1",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [OPENAI_API_KEY],
  },
  protectGeneration("briefing", async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in before generating a briefing.");
    }

    const db = getFirestore();
    const [{evidence, reason: groundingReason}, context, facts, feedback, profile] = await Promise.all([
      loadNewsEvidence(db),
      loadStandingContext(db, request.auth.uid),
      loadMarketFacts(db),
      loadReaderFeedback(db, request.auth.uid),
      loadProfile(db, request.auth.uid),
    ]);
    const prompt = buildBriefingPrompt({
      dateLabel: String((request.data && request.data.date) || "").trim(),
      evidence, context, facts, feedback, profile,
    });
    const model = String((request.data && request.data.model) || DEFAULT_MODEL);

    const body = {
      model,
      input: [
        {
          role: "system",
          content: "You produce factual, concise JSON intelligence briefings. Return strict JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      tools: [
        {
          type: "web_search",
          // Medium, like the dossier and the meeting brief: at "low" the search
          // rarely surfaced utility, road-asset or trucking stories at all.
          search_context_size: "medium",
          user_location: {
            type: "approximate",
            country: "PH",
            timezone: "Asia/Manila",
          },
        },
      ],
      tool_choice: "auto",
      // The full list of pages the search tool returned, so each story's url can
      // be checked against what was really fetched (verifyGrounding).
      include: ["web_search_call.action.sources"],
    };

    let response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + OPENAI_API_KEY.value(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(480000),
      });
    } catch (err) {
      logger.error("OpenAI network error", err);
      throw new HttpsError("unavailable", "OpenAI request failed before receiving a response.");
    }

    const responseText = await response.text();
    let json;
    try {
      json = JSON.parse(responseText);
    } catch (err) {
      json = {error: {message: responseText || "Non-JSON OpenAI response"}};
    }

    if (!response.ok) {
      const msg = json && json.error && json.error.message ? json.error.message : "OpenAI request failed.";
      logger.error("OpenAI API error", {status: response.status, message: msg});
      throw new HttpsError("internal", msg);
    }

    let raw;
    let briefing;
    try {
      raw = extractText(json);
      briefing = parseBriefing(raw);
    } catch (err) {
      logger.error("OpenAI JSON parse error", err);
      throw new HttpsError("internal", "OpenAI returned invalid briefing JSON.");
    }

    // Check the returned citations against what was actually supplied, and
    // record the outcome on the briefing so the app can show provenance —
    // including when grounding did not happen, and why.
    const searched = searchUrls(json);
    const verified = verifyGrounding(briefing, evidence, undefined, searched);
    briefing = verified.briefing;
    // Links outside the feed: how many pages the search returned, and how many
    // story links matched one (kept) or did not (removed).
    briefing.links = {
      searched: verified.stats.links.searched,
      verified: verified.stats.links.verified,
      removed: verified.stats.links.removed,
      bySection: verified.stats.links.bySection,
    };
    briefing.grounding = evidence ? {
      mode: "grounded",
      snapshot: "news-" + evidence.date,
      snapshotDate: evidence.date,
      snapshotAgeDays: evidence.ageDays,
      offered: evidence.itemCount,
      pool: evidence.poolCount,
      feedsOk: evidence.feedsOk,
      feedsTotal: evidence.feedsTotal,
      sources: evidence.sources,
      grounded: verified.stats.grounded,
      ungrounded: verified.stats.ungrounded,
      unmatchedUrls: verified.stats.unmatched,
      bySection: verified.stats.bySection,
    } : {mode: "ungrounded", reason: groundingReason || "unavailable"};

    // What the model could actually see of Bob's own state, recorded next to
    // the grounding provenance for the same reason: a briefing that failed to
    // mention an open call should be readable as "it had none to see" rather
    // than leaving him to guess whether the feature ran.
    briefing.context = {
      standing: context && context.standing ? context.standing.stats :
        {decisions: 0, radar: 0, markets: 0},
      priorWatch: context && context.watch ? {
        dateKey: context.watch.dateKey || "",
        dateLabel: context.watch.dateLabel || "",
      } : null,
      reason: (context && context.reason) || null,
      // How much of Bob's feedback shaped this briefing (null when none).
      feedback: feedback ? feedback.stats : null,
      accounts: context && context.accounts ? {count: context.accounts.length, source: context.accountsSource || ""} : null,
    };
    // A follow-up is only meaningful about a watch item that was actually
    // supplied. Anything returned without one is invention, not a grade.
    if (!(context && context.watch)) briefing.watch_followup = null;

    // Overwrite the model's figures with the fetched ones, and blank any field
    // no source could confirm. Same reasoning as verifyGrounding: being told to
    // copy a value is a request, not a guarantee, and an unverified number in
    // the ticker looks exactly like a verified one.
    const applied = applyFacts(briefing, facts);
    briefing = applied.briefing;
    briefing.facts = facts ? {
      mode: "verified",
      applied: applied.stats.applied,
      corrected: applied.stats.corrected,
      blanked: applied.stats.blanked,
      changedFields: applied.stats.fields,
      missing: facts.missing,
    } : {mode: "unverified", reason: "unavailable"};

    if (applied.stats.corrected) {
      logger.warn("briefing figures disagreed with fetched values", {
        corrected: applied.stats.corrected, fields: applied.stats.fields,
      });
    }

    if (verified.stats.unmatched) {
      logger.warn("briefing cited urls that were not supplied", {
        count: verified.stats.unmatched, snapshot: evidence && evidence.date,
      });
    }
    if (verified.stats.links.removed) {
      logger.warn("briefing story links did not match any searched page", {
        removed: verified.stats.links.removed, searched: verified.stats.links.searched,
      });
    }

    // The aha is checked last, after grounding and link checks may have dropped
    // stories, so its link chips only name stories the briefing still has.
    briefing.aha = cleanAha(briefing.aha, briefing.sections);
    // The wildcard's link is held to a story's standard, but a wildcard without
    // one is dropped rather than shown bare: it comes from outside Bob's beats,
    // where he has the least to judge a story by.
    const wildcard = cleanWildcard(briefing.wildcard, String((request.data && request.data.date) || "").trim());
    const wildcardUrl = wildcard && wildcard.url ? searched.find((url) => urlKey(url) === urlKey(wildcard.url)) || "" : "";
    briefing.wildcard = wildcard && wildcardUrl ? Object.assign(wildcard, {url: wildcardUrl, grounded: true}) : null;
    briefing.context.wildcard = !wildcard ? "none" : wildcardUrl ? "kept" : "dropped: link not a searched page";
    if (wildcard && !wildcardUrl) logger.warn("wildcard dropped: its link was not a searched page", {url: wildcard.url});
    // Whether the no-rerun rule held: declared updates, and stories that look
    // like a recent headline without saying so. Counted after the checks above.
    const recent = context && context.recent;
    briefing.context.recent = recent ? Object.assign({}, recent.stats, countReruns(briefing, recent)) : null;

    // Record token usage, and the web searches billed per use, to the shared
    // LLM cost ledger (no-throw).
    await recordUsage(db, "briefing", model, extractUsage(json), phtDateKey());
    await recordSearches(db, "briefing", webSearchCount(json), phtDateKey());

    return {
      model,
      raw: JSON.stringify(briefing, null, 2),
      briefing,
    };
  })
);

// ─────────────────────────────────────────────────────────────
// Weekly mirror — "Your week, read back" (functions/weekly-mirror.js)
// ─────────────────────────────────────────────────────────────
// Everything the mirror reads, each read caught on its own: a failed journal
// query costs the decisions paragraph, not the whole read-back.
async function loadMirrorSources(db, uid) {
  const [boost, journal, stored, goals, review] = await Promise.all([
    db.collection(BRIEFINGS_COLL).doc("daily-boost-" + uid).get()
      .then((snap) => (snap.exists ? snap.data().entries || {} : {})).catch(() => ({})),
    db.collection(JOURNAL_COLL).where("uid", "==", uid).orderBy("saved", "desc").limit(100).get()
      .then((snap) => snap.docs.map((doc) => doc.data())).catch(() => []),
    db.collection(BRIEFINGS_COLL).doc("weekly-mirror-" + uid).get()
      .then((snap) => (snap.exists ? snap.data().mirrors || {} : {})).catch(() => ({})),
    db.collection(BRIEFINGS_COLL).doc("goals-" + uid).get()
      .then((snap) => (snap.exists ? snap.data().goals || [] : [])).catch(() => []),
    db.collection(BRIEFINGS_COLL).doc("review-" + uid).get()
      .then((snap) => (snap.exists ? snap.data().weeks || {} : {})).catch(() => ({})),
  ]);
  return {entries: boost, decisions: journal, mirrors: stored, goals, review};
}

exports.generateWeeklyMirror = onCall(
  {
    region: "asia-southeast1",
    timeoutSeconds: 180,
    memory: "256MiB",
    secrets: [ANTHROPIC_API_KEY],
  },
  protectGeneration("mirror", async (request) => {
    const db = getFirestore();
    const uid = request.auth.uid;
    const todayKey = phtDateKey();
    const sources = await loadMirrorSources(db, uid);
    const input = buildMirrorInput(Object.assign({todayKey, core: DailyBoostCore, reviewCore: WeeklyReviewCore, now: Date.now()}, sources));
    // Nothing recorded this week: say so without paying for a model call.
    if (!input) return {mirror: null, reason: "empty"};

    const model = Haiku.MODEL;
    let raw;
    try {
      raw = await Haiku.mirror({apiKey: ANTHROPIC_API_KEY.value(), system: MIRROR_SYSTEM,
        prompt: buildMirrorPrompt(input, await loadProfile(db, uid)), schema: MIRROR_SCHEMA, timeoutMs: 150000,
        onUsage: (billingModel, usage) => recordUsage(db, "weekly-mirror", billingModel, usage, todayKey)});
    } catch (err) {
      throw new HttpsError(err.code || "internal", err.message);
    }

    let mirror;
    try {
      mirror = cleanMirror(parseBriefing(raw));
    } catch (err) {
      mirror = null;
    }
    if (!mirror) {
      logger.error("mirror JSON unusable");
      throw new HttpsError("internal", "The read-back came back unusable. Try again in a minute.");
    }
    mirror.weekKey = todayKey;
    mirror.range = {from: input.window.from, to: input.window.to};
    mirror.stats = input.stats;
    mirror.followedUp = input.previous;
    mirror.model = model;
    mirror.generatedAt = new Date().toISOString();
    // A second read today replaces the first, but never Bob's written answer to
    // it: the answer keeps the question it answered, so the app can say so.
    const earlier = sources.mirrors[todayKey];
    if (earlier && earlier.answer && earlier.answer.text) mirror.answer = earlier.answer;

    // Latest twelve reads, one per day (a second read today replaces the first).
    // Written with the uid field, so the shared rules let the app read it back.
    await db.collection(BRIEFINGS_COLL).doc("weekly-mirror-" + uid).set({
      uid, kind: "weekly-mirror", mirrors: keepRecent(sources.mirrors, todayKey, mirror), updatedAt: mirror.generatedAt,
    });
    return {mirror};
  })
);

// ─────────────────────────────────────────────────────────────
// Go deeper — a working dossier on one briefing story (functions/story-dossier.js)
// ─────────────────────────────────────────────────────────────
// Kept per account (latest forty) on briefings-bob/dossiers-<uid>, keyed by the
// shared storyDossierKey, so a story already read returns without a second call.
exports.generateStoryDossier = onCall(
  {
    region: "asia-southeast1",
    timeoutSeconds: 240,
    memory: "512MiB",
    secrets: [OPENAI_API_KEY],
  },
  protectGeneration("dossier", async (request) => {
    const db = getFirestore();
    const uid = request.auth.uid;
    const story = cleanStory(request.data.story);
    const key = storyDossierKey(story);
    const ref = db.collection(BRIEFINGS_COLL).doc("dossiers-" + uid);
    const stored = await ref.get().then((snap) => (snap.exists ? snap.data().items || {} : {})).catch(() => ({}));
    // A saved dossier comes back free, unless he asked for it to be rebuilt.
    if (stored[key] && request.data.refresh !== true) return {key, dossier: stored[key], saved: true};

    const model = DEFAULT_MODEL;
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {"Authorization": "Bearer " + OPENAI_API_KEY.value(), "Content-Type": "application/json"},
        body: JSON.stringify({
          model,
          input: [{role: "system", content: DOSSIER_SYSTEM}, {role: "user", content: buildDossierPrompt(story, await loadProfile(db, uid))}],
          tools: [{type: "web_search", search_context_size: "medium"}],
          tool_choice: "auto",
          // Every page the search returned, so the dossier's sources can be checked.
          include: ["web_search_call.action.sources"],
        }),
        signal: AbortSignal.timeout(220000),
      });
    } catch (err) {
      logger.error("OpenAI network error (dossier)", err);
      throw new HttpsError("unavailable", "OpenAI request failed before receiving a response.");
    }
    const responseText = await response.text();
    let json;
    try {
      json = JSON.parse(responseText);
    } catch (err) {
      json = {error: {message: responseText || "Non-JSON OpenAI response"}};
    }
    if (!response.ok) {
      const msg = json && json.error && json.error.message ? json.error.message : "OpenAI request failed.";
      logger.error("OpenAI API error (dossier)", {status: response.status, message: msg});
      throw new HttpsError("internal", msg);
    }
    await recordUsage(db, "story-dossier", model, extractUsage(json), phtDateKey());
    await recordSearches(db, "story-dossier", webSearchCount(json), phtDateKey());

    let dossier;
    try {
      dossier = cleanDossier(parseBriefing(extractText(json)), searchUrls(json));
    } catch (err) {
      dossier = null;
    }
    if (!dossier) {
      logger.error("dossier JSON unusable");
      throw new HttpsError("internal", "The dossier came back unusable. Try again in a minute.");
    }
    dossier.story = {headline: story.headline, source: story.source, url: story.url, section: story.section, date: story.date};
    dossier.model = model;
    dossier.generatedAt = new Date().toISOString();
    await ref.set({uid, kind: "dossiers", items: keepDossiers(stored, key, dossier), updatedAt: dossier.generatedAt});
    return {key, dossier};
  })
);

// ─────────────────────────────────────────────────────────────
// This week's health research (functions/health-research.js)
// ─────────────────────────────────────────────────────────────
// Up to three recent, well-evidenced findings, kept per week (latest twelve)
// on briefings-bob/health-research-<uid>, keyed by the week's Monday. Only his
// age band goes to the model, never his Apple Health numbers or answers.
async function makeHealthResearch(db, uid, now, refresh) {
  const todayKey = phtDateKey(now), weekKey = WeeklyReviewCore.weekStart(todayKey);
  const ref = db.collection(BRIEFINGS_COLL).doc("health-research-" + uid);
  const stored = await ref.get().then((snap) => (snap.exists ? snap.data().weeks || {} : {})).catch(() => ({}));
  if (stored[weekKey] && !refresh) return {weekKey, research: stored[weekKey], saved: true};
  const basics = await db.collection(BRIEFINGS_COLL).doc("health-basics-" + uid).get()
    .then((snap) => (snap.exists ? snap.data() : {})).catch(() => ({}));
  const model = DEFAULT_MODEL;
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {"Authorization": "Bearer " + OPENAI_API_KEY.value(), "Content-Type": "application/json"},
      body: JSON.stringify({
        model,
        input: [{role: "system", content: HealthResearch.SYSTEM},
          {role: "user", content: HealthResearch.buildResearchPrompt({todayKey, ageBand: HealthResearch.ageBand(basics.birthYear, todayKey)})}],
        tools: [{type: "web_search", search_context_size: "medium"}],
        tool_choice: "auto",
        include: ["web_search_call.action.sources"],
      }),
      signal: AbortSignal.timeout(220000),
    });
  } catch (err) {
    logger.error("OpenAI network error (health research)", err);
    throw new HttpsError("unavailable", "OpenAI request failed before receiving a response.");
  }
  const responseText = await response.text();
  let json;
  try { json = JSON.parse(responseText); } catch (err) { json = {error: {message: responseText || "Non-JSON OpenAI response"}}; }
  if (!response.ok) {
    const msg = json && json.error && json.error.message ? json.error.message : "OpenAI request failed.";
    logger.error("OpenAI API error (health research)", {status: response.status, message: msg});
    throw new HttpsError("internal", msg);
  }
  await recordUsage(db, "health-research", model, extractUsage(json), todayKey);
  await recordSearches(db, "health-research", webSearchCount(json), todayKey);
  let research;
  try {
    research = HealthResearch.cleanResearch(parseBriefing(extractText(json)), searchUrls(json), todayKey);
  } catch (err) {
    research = null;
  }
  if (!research) {
    logger.error("health research JSON unusable");
    throw new HttpsError("internal", "This week's health research came back unusable. Try again in a minute.");
  }
  Object.assign(research, {weekKey, model, generatedAt: new Date(now).toISOString()});
  await ref.set({uid, kind: "health-research", weeks: HealthResearch.keepWeeks(stored, weekKey, research), updatedAt: research.generatedAt});
  logger.info("Health research built", {uid, items: research.items.length, dropped: research.dropped});
  return {weekKey, research};
}
exports.generateHealthResearch = onCall(
  {region: "asia-southeast1", timeoutSeconds: 240, memory: "512MiB", secrets: [OPENAI_API_KEY]},
  protectGeneration("health", async (request) => makeHealthResearch(getFirestore(), request.auth.uid, Date.now(), request.data.refresh === true))
);
// Sunday 05:15 Manila, for the owner, so it is there when he opens Today.
exports.buildHealthResearch = onSchedule(
  {schedule: "15 5 * * 0", timeZone: "Asia/Manila", region: "asia-southeast1", timeoutSeconds: 300, memory: "512MiB", secrets: [OPENAI_API_KEY]},
  async () => {
    const db = getFirestore();
    for (const email of GENERATION_OWNERS) {
      try {
        const user = await getAuth().getUserByEmail(email);
        await makeHealthResearch(db, user.uid, Date.now(), false);
      } catch (error) {
        logger.warn("Sunday health research not built", {code: error.code, message: error.message});
      }
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Draft a note (functions/client-note.js): from a stored Go deeper dossier, a
// short email to an instructing party or a colleague, for Bob to edit and send
// himself. Written only from the dossier (no web search), traced figure by
// figure, kept per account (latest thirty) with what he did with it.
// ─────────────────────────────────────────────────────────────
exports.draftClientNote = onCall(
  {
    region: "asia-southeast1",
    timeoutSeconds: 120,
    memory: "256MiB",
    secrets: [ANTHROPIC_API_KEY],
  },
  protectGeneration("note", async (request) => {
    const db = getFirestore();
    const uid = request.auth.uid;
    const req = Note.cleanNoteRequest(request.data);
    const dossierSnap = await db.collection(BRIEFINGS_COLL).doc("dossiers-" + uid).get().catch(() => null);
    const dossier = dossierSnap && dossierSnap.exists ? ((dossierSnap.data() || {}).items || {})[req.key] : null;
    if (!dossier || !dossier.summary) throw new HttpsError("failed-precondition", "Build the Go deeper dossier first: the note is written from it.");
    const today = new Intl.DateTimeFormat("en-AU", {timeZone: "Asia/Manila", weekday: "long", day: "numeric", month: "long", year: "numeric"}).format(new Date()) + " (" + phtDateKey() + ")";
    const extra = [today, req.recipient.name, req.angle];
    const call = (prompt) => Haiku.mirror({apiKey: ANTHROPIC_API_KEY.value(), system: Note.SYSTEM, prompt, schema: Note.SCHEMA, timeoutMs: 60000,
      onUsage: (billingModel, u) => recordUsage(db, "client-note", billingModel, u, phtDateKey())});
    const prompt = Note.buildNotePrompt({dossier, recipient: req.recipient, angle: req.angle, profile: await loadProfile(db, uid)});
    let note;
    try {
      note = Note.cleanNote(parseBriefing(await call(prompt)));
      let untraced = note ? Note.traceNote(note, dossier, extra) : [];
      // One correction for a figure or date the dossier does not state, or for
      // the instructions showing through, or for length.
      const problems = note ? Note.noteProblems(note, dossier) : [];
      if (note && (untraced.length || problems.length)) {
        const fixed = Note.cleanNote(parseBriefing(await call(prompt + "\n\nYOUR FIRST DRAFT:\n" + JSON.stringify(note) + "\n\n" + Note.correctionPrompt(untraced, problems))));
        if (fixed) { note = fixed; untraced = Note.traceNote(note, dossier, extra); }
      }
      if (note && untraced.length) note.unverified = untraced;
    } catch (err) {
      if (err && err.code && ["unavailable", "failed-precondition", "aborted"].includes(err.code)) throw new HttpsError(err.code, err.message);
      logger.error("Client note failed", {message: err && err.message});
      note = null;
    }
    if (!note) throw new HttpsError("internal", "The note came back unusable. Try again in a minute.");
    Object.assign(note, {key: req.key, headline: (dossier.story || {}).headline || "", recipient: req.recipient, angle: req.angle,
      sources: Note.noteSources(dossier), model: Haiku.MODEL, generatedAt: new Date().toISOString()});
    const id = "n" + Date.now().toString(36);
    const ref = db.collection(BRIEFINGS_COLL).doc("client-notes-" + uid);
    const stored = await ref.get().then((snap) => (snap.exists ? snap.data().items || {} : {})).catch(() => ({}));
    await ref.set({uid, kind: "client-notes", items: Note.keepNotes(stored, id, note), updatedAt: note.generatedAt});
    return {id, note};
  })
);

// ─────────────────────────────────────────────────────────────
// Meeting brief (functions/meeting-brief.js): one page before a call, built
// from Bob's own material on the topic plus a web search. Kept per account,
// latest twenty.
// ─────────────────────────────────────────────────────────────
exports.generateMeetingBrief = onCall(
  {
    region: "asia-southeast1",
    timeoutSeconds: 240,
    memory: "512MiB",
    secrets: [OPENAI_API_KEY],
  },
  protectGeneration("meeting", async (request) => makeMeetingBrief(getFirestore(), request.auth.uid, {
    topic: cleanTopic(request.data.topic), material: cleanMaterial(request.data.material),
    dateLabel: String(request.data.dateLabel || "").slice(0, 60), usageFeature: "meeting-brief",
  }))
);

// One meeting brief: the web-searched prompt, the honesty checks, and the
// latest-twenty store. Build brief on Evidence and his calendar both use it;
// extra carries what a calendar brief adds (the meeting it was built for).
async function makeMeetingBrief(db, uid, {topic, material, dateLabel, usageFeature, extra}) {
    const model = DEFAULT_MODEL;
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {"Authorization": "Bearer " + OPENAI_API_KEY.value(), "Content-Type": "application/json"},
        body: JSON.stringify({
          model,
          input: [{role: "system", content: MEETING_SYSTEM}, {role: "user", content: buildMeetingPrompt(topic, material, dateLabel, await loadProfile(db, uid))}],
          tools: [{type: "web_search", search_context_size: "medium"}],
          tool_choice: "auto",
          include: ["web_search_call.action.sources"],
        }),
        signal: AbortSignal.timeout(220000),
      });
    } catch (err) {
      logger.error("OpenAI network error (meeting brief)", err);
      throw new HttpsError("unavailable", "OpenAI request failed before receiving a response.");
    }
    const responseText = await response.text();
    let json;
    try {
      json = JSON.parse(responseText);
    } catch (err) {
      json = {error: {message: responseText || "Non-JSON OpenAI response"}};
    }
    if (!response.ok) {
      const msg = json && json.error && json.error.message ? json.error.message : "OpenAI request failed.";
      logger.error("OpenAI API error (meeting brief)", {status: response.status, message: msg});
      throw new HttpsError("internal", msg);
    }
    await recordUsage(db, usageFeature || "meeting-brief", model, extractUsage(json), phtDateKey());
    await recordSearches(db, usageFeature || "meeting-brief", webSearchCount(json), phtDateKey());

    let brief;
    try {
      brief = cleanBrief(parseBriefing(extractText(json)), searchUrls(json), material);
    } catch (err) {
      brief = null;
    }
    if (!brief) {
      logger.error("meeting brief JSON unusable");
      throw new HttpsError("internal", "The brief came back unusable. Try again in a minute.");
    }
    brief.topic = topic;
    brief.materialCount = material.length;
    brief.model = model;
    brief.generatedAt = new Date().toISOString();
    Object.assign(brief, extra || {});
    const id = "m" + Date.now().toString(36);
    const ref = db.collection(BRIEFINGS_COLL).doc("meeting-briefs-" + uid);
    const stored = await ref.get().then((snap) => (snap.exists ? snap.data().items || {} : {})).catch(() => ({}));
    await ref.set({uid, kind: "meeting-briefs", items: keepBriefs(stored, id, brief), updatedAt: brief.generatedAt});
    return {id, brief};
}

// ─────────────────────────────────────────────────────────────
// Ask Daybook (functions/ask-daybook.js): a question answered from his own
// material. The model looks things up with search_daybook, at most three
// times, and each lookup runs on the same index as the app's Search box.
// ─────────────────────────────────────────────────────────────
// A follow-up within a few minutes reuses the index instead of re-reading
// about 150 documents.
const ASK_INDEX_TTL_MS = 3 * 60 * 1000;
let askIndexCache = null;
async function loadAskIndex(db, uid) {
  if (askIndexCache && askIndexCache.uid === uid && Date.now() - askIndexCache.at < ASK_INDEX_TTL_MS) return askIndexCache.index;
  const coll = db.collection(BRIEFINGS_COLL);
  const get = (id) => coll.doc(id).get().then((snap) => (snap.exists ? snap.data() : null)).catch(() => null);
  const latest = async (prefix) => {
    const pointer = await get(prefix + "-latest");
    return pointer && pointer.value ? get(prefix + "-" + pointer.value) : null;
  };
  // His own documents, newest first, as the app's Search reads them.
  const own = (name, n) => db.collection(name).where("uid", "==", uid).orderBy("saved", "desc").limit(n).get()
    .then((snap) => snap.docs.map((doc) => Object.assign({id: doc.id}, doc.data()))).catch(() => []);
  const pokerhq = (id) => db.collection("pokerhq-bob").doc(id).get().then((snap) => (snap.exists ? snap.data() : null)).catch(() => null);
  const [briefings, reports, decisions, prefs, dossiers, meetings, mirrors, dailyBoost, grounding, news, radar, markets, sports,
    profile, accounts, usage, goals, radarJournal,
    calendarEvents, calendarMeetings, review, pokerTourneys, pokerBankroll, pokerSessions, flights, flightsSaved, flightsHistory, fx] = await Promise.all([
    own(BRIEFINGS_COLL, 100), own(REPORTS_COLL, 50), own(JOURNAL_COLL, 100),
    get(COMMAND_PREF_PREFIX + uid), get("dossiers-" + uid), get("meeting-briefs-" + uid), get("weekly-mirror-" + uid), get("daily-boost-" + uid),
    get("grounding-latest"), latest("news"), latest("radar"), latest("miro"), latest("sports"),
    // About you: his profile, and what the app has picked up from him.
    get("profile-" + uid), get("accounts-" + uid), get("usage-" + uid), get("goals-" + uid),
    // How each Radar score band has done before (the card's "Band record").
    get("radar-journal"),
    // His life data: calendar (own events; linked meetings and all-day
    // entries), weekly review, PokerHQ (same project), Flights and the FX
    // snapshot that turns a foreign fare into pesos.
    get("calendar-events-" + uid), get("meetings-" + uid), get("review-" + uid),
    pokerhq("tourneys"), pokerhq("bankroll"), pokerhq("sessions"),
    get("flights-latest"), get("flights-saved-" + uid), get("flights-history"), get("radar-ph"),
  ]);
  const index = IntelligenceSearchCore.buildIndex(Ask.askIndexInput(
    {briefings, reports, decisions, prefs, dossiers, meetings, mirrors, dailyBoost, grounding, news, radar, markets, sports,
      profile, accounts, usage, goals, radarJournal, todayKey: phtDateKey(), now: Date.now(),
      calendarEvents, calendarMeetings, review, pokerTourneys, pokerBankroll, pokerSessions, flights, flightsSaved, flightsHistory, fx}, DailyBoostCore,
    {core: LifeRecordsCore, calendar: DaybookCalendarCore, flights: FlightsCore, review: WeeklyReviewCore}));
  askIndexCache = {uid, at: Date.now(), index};
  return index;
}

// His profile (About you), or null for the starting profile. Never throws: a
// failed read gives the starting profile, which is what every feature used before.
async function loadProfile(db, uid) {
  try {
    const snap = await db.collection(BRIEFINGS_COLL).doc("profile-" + uid).get();
    return snap.exists ? (snap.data().profile || null) : null;
  } catch (error) {
    logger.warn("Profile read failed; using the starting profile", {message: error.message});
    return null;
  }
}

async function openaiResponse(body, label, timeoutMs) {
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {"Authorization": "Bearer " + OPENAI_API_KEY.value(), "Content-Type": "application/json"},
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    logger.error("OpenAI network error (" + label + ")", err);
    throw new HttpsError("unavailable", "OpenAI request failed before receiving a response.");
  }
  const responseText = await response.text();
  let json;
  try {
    json = JSON.parse(responseText);
  } catch (err) {
    json = {error: {message: responseText || "Non-JSON OpenAI response"}};
  }
  if (!response.ok) {
    const msg = json && json.error && json.error.message ? json.error.message : "OpenAI request failed.";
    const told = Ask.providerError(response.status, msg);
    logger.error("OpenAI API error (" + label + ")", {status: response.status, message: told.message});
    throw new HttpsError(told.code, told.message);
  }
  return json;
}

exports.askDaybook = onCall(
  {
    region: "asia-southeast1",
    timeoutSeconds: 240,
    memory: "512MiB",
    secrets: [OPENAI_API_KEY, ANTHROPIC_API_KEY],
  },
  protectGeneration("ask", async (request) => {
    const db = getFirestore();
    const uid = request.auth.uid;
    const question = Ask.cleanQuestion(request.data.question);
    const web = request.data.web === true;
    const thread = Ask.cleanThread(request.data.thread);
    const model = web ? DEFAULT_MODEL : Haiku.MODEL;
    const now = Date.now();
    const [index, accountsSnap] = await Promise.all([
      loadAskIndex(db, uid),
      db.collection(BRIEFINGS_COLL).doc("accounts-" + uid).get().catch(() => null),
    ]);
    // His accounts give the model the other names to look up (AAMI for Suncorp…).
    const kept = accountsSnap && accountsSnap.exists ? cleanAccounts((accountsSnap.data() || {}).accounts) : [];
    const accounts = kept.length ? kept : DEFAULT_ACCOUNTS;
    const today = new Intl.DateTimeFormat("en-AU", {timeZone: "Asia/Manila", weekday: "long", day: "numeric", month: "long", year: "numeric"})
      .format(new Date(now)) + " (" + phtDateKey(now) + ")";
    const tools = [Ask.SEARCH_TOOL].concat(web ? [{type: "web_search", search_context_size: "medium"}] : []);
    const include = web ? ["web_search_call.action.sources"] : undefined;
    const registry = Ask.newRegistry();
    // Besides the records, an answer may repeat figures from today's date and
    // the thread; the figure check counts those as stated.
    const traceExtra = [today].concat(thread.map((turn) => turn.q + " " + turn.a));
    const usage = {inputTokens: 0, outputTokens: 0, cachedTokens: 0};
    const searched = [];
    let webSearches = 0;
    const track = (json) => {
      const u = extractUsage(json);
      usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; usage.cachedTokens += u.cachedTokens;
      webSearches += webSearchCount(json);
      searchUrls(json).forEach((url) => searched.push(url));
      return json;
    };
    const deadline = now + 210000;
    let json;
    let raw;
    let lookups = 0;
    let revise;
    try {
      if (!web) {
        const result = await Haiku.ask({apiKey: ANTHROPIC_API_KEY.value(),
          input: Ask.buildAskInput({question, thread, today, accounts, web}),
          tool: Ask.SEARCH_TOOL, maxLookups: Ask.MAX_LOOKUPS, deadline,
          lookup: (plan) => Ask.lookupOutput(Ask.lookupRecords(index, Ask.cleanPlan(plan), IntelligenceSearchCore, now), registry),
          onUsage: (billingModel, u) => recordUsage(db, "ask-daybook", billingModel, u, phtDateKey())});
        raw = result.raw;
        lookups = result.lookups;
        revise = result.revise;
      } else {
        const result = await Ask.runLookups({
          firstBody: {input: Ask.buildAskInput({question, thread, today, accounts, web}), tool_choice: "auto"},
          call: async (body) => track(await openaiResponse(Object.assign({model, tools, include}, body), "ask", Math.max(20000, Math.min(120000, deadline - Date.now())))),
          lookup: (plan) => Ask.lookupOutput(Ask.lookupRecords(index, plan, IntelligenceSearchCore, now), registry),
        });
        json = result.json;
        lookups = result.lookups;
        raw = extractText(json);
        revise = async (prompt) => {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new HttpsError("unavailable", "The answer timed out. Try again.");
          const fixed = track(await openaiResponse({model, tools, include, previous_response_id: json.id,
            input: [{role: "user", content: prompt}], tool_choice: "none"}, "ask-correction", Math.min(120000, remaining)));
          return extractText(fixed);
        };
      }
      raw = await Ask.refineAnswer({raw, revise, question, registry, searched, web, extra: traceExtra});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(err.code || "internal", err.message);
    } finally {
      // Every call is paid for, answer or not, so the ledger counts them all.
      if (web) {
        await recordUsage(db, "ask-daybook", model, usage, phtDateKey());
        await recordSearches(db, "ask-daybook", webSearches, phtDateKey());
      }
    }

    let answer;
    try {
      answer = Ask.cleanAnswer(parseBriefing(raw), registry, searched, web, question, traceExtra);
    } catch (err) {
      answer = null;
    }
    if (!answer) {
      logger.error("Ask Daybook answer unusable", {lookups});
      throw new HttpsError("internal", "The answer came back unusable. Try again in a minute.");
    }
    Object.assign(answer, {question, web, lookups, model, generatedAt: new Date().toISOString()});
    const id = "a" + Date.now().toString(36);
    const ref = db.collection(BRIEFINGS_COLL).doc("ask-" + uid);
    const stored = await ref.get().then((snap) => (snap.exists ? snap.data().items || {} : {})).catch(() => ({}));
    await ref.set({uid, kind: "ask", items: Ask.keepAnswers(stored, id, answer), updatedAt: answer.generatedAt});
    return {id, answer};
  })
);

// ─────────────────────────────────────────────────────────────
// Deep-research report generation (long-running, async)
// ─────────────────────────────────────────────────────────────
function buildDeepResearchPrompt(topic, profile) {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila",
  });

  return [
    "You are a deep-research analyst preparing a long-form intelligence report for Bob. Today is " + today + " (Asia/Manila).",
  ].concat(profileBrief(profile), [
    "",
    "RESEARCH TOPIC:",
    topic,
    "",
    "Produce a comprehensive, decision-useful report in GitHub-Flavored Markdown.",
    "",
    "OUTPUT FORMAT — follow exactly:",
    "1) Begin with a YAML front-matter block delimited by lines containing only '---', with keys:",
    "   title: a concise report title",
    "   dek: a one-sentence editorial summary (<= 240 characters)",
    "   date: " + today,
    "   tags: 3-5 comma-separated topic tags",
    "   ticker: a YAML list of up to 6 headline stats, each line as '  - Label | Value | Sub'",
    "     (Value is a short number/figure; Sub is a brief qualifier). Use real figures found",
    "     during research; omit the ticker key entirely if you have no solid figures.",
    "2) After the closing '---', write the body using '##' for each main section and '###' for sub-sections.",
    "",
    "CONTENT REQUIREMENTS:",
    "- Lead with an Executive summary section; end with a recommendations section.",
    "- Clearly separate OFFICIAL FACTS (with sources) from ANALYTICAL ESTIMATES; label assumptions explicitly.",
    "- Use Markdown tables for structured data (metrics, comparisons, exposure lists).",
    "- Where a process, timeline, or relationship helps, add a Mermaid diagram in a ```mermaid code block.",
    "  In timelines, do NOT put ':' inside time labels (write 0737H, not 07:37).",
    "- Tie findings to Bob's angle: insurance/reinsurance, claims, business interruption, underwriting,",
    "  catastrophe exposure, forensic accounting, audit, or consulting opportunities.",
    "- Cite reputable, current, primary sources inline. Be thorough but precise; do not pad.",
  ]).join("\n");
}

exports.generateDeepResearchReport = onCall(
  {
    region: "asia-southeast1",
    timeoutSeconds: 60,
    memory: "256MiB",
    secrets: [OPENAI_API_KEY],
  },
  protectGeneration("research", async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in before generating a report.");
    }
    const uid = request.auth.uid;
    const topic = String((request.data && request.data.topic) || "").trim();
    if (topic.length < 8) {
      throw new HttpsError("invalid-argument", "Describe the research topic in at least a sentence.");
    }
    const premium = !!(request.data && request.data.premium);
    const model = premium ? DEEP_MODEL_PREMIUM : DEEP_MODEL_DEFAULT;

    const db = getFirestore();
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const metaRef = db.collection(REPORTS_META).doc(uid);

    // Monthly cap — server-authoritative
    const metaSnap = await metaRef.get();
    let count = 0;
    if (metaSnap.exists && metaSnap.data().month === month) count = metaSnap.data().count || 0;
    if (count >= DEEP_RESEARCH_CAP) {
      throw new HttpsError("resource-exhausted",
        "Monthly report limit reached (" + DEEP_RESEARCH_CAP + "). Try again next month or raise the cap.");
    }

    // Kick off the deep-research job in background mode
    const body = {
      model,
      background: true,
      store: true,
      input: [
        {
          role: "developer",
          content: "You are a meticulous deep-research analyst. Produce a thorough, well-sourced Markdown report that begins with the requested YAML front-matter.",
        },
        {role: "user", content: buildDeepResearchPrompt(topic, await loadProfile(db, uid))},
      ],
      tools: [{type: "web_search"}],
      tool_choice: "auto",
    };

    let response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + OPENAI_API_KEY.value(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
    } catch (err) {
      logger.error("Deep research kickoff network error", err);
      throw new HttpsError("unavailable", "Could not reach OpenAI to start the report.");
    }

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      json = {error: {message: text || "Non-JSON OpenAI response"}};
    }
    if (!response.ok) {
      const msg = json && json.error && json.error.message ? json.error.message : "OpenAI request failed.";
      logger.error("Deep research kickoff error", {status: response.status, message: msg});
      throw new HttpsError("internal", msg);
    }
    const openaiId = json.id;
    if (!openaiId) {
      throw new HttpsError("internal", "OpenAI did not return a job id.");
    }

    // Placeholder report doc + usage increment
    const now = Date.now();
    const docRef = db.collection(REPORTS_COLL).doc();
    await docRef.set({
      title: topic.length > 90 ? topic.slice(0, 87) + "…" : topic,
      dateLabel: "",
      dek: "",
      tags: [],
      format: "md",
      md: "",
      status: "generating",
      openaiId,
      model,
      requestedAt: now,
      saved: now,
      uid,
    });
    const savedCount = await db.runTransaction(async tx => {
      const latest = await tx.get(metaRef);
      const current = latest.exists && latest.data().month === month ? latest.data().count || 0 : 0;
      tx.set(metaRef, {month, count:current + 1, updated:now}, {merge:true});
      return current + 1;
    });

    return {docId: docRef.id, openaiId, model, remaining: Math.max(0, DEEP_RESEARCH_CAP - savedCount)};
  })
);

async function retrieveOpenAIResponse(openaiId) {
  const response = await fetch("https://api.openai.com/v1/responses/" + encodeURIComponent(openaiId), {
    headers: {"Authorization": "Bearer " + OPENAI_API_KEY.value()},
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error("OpenAI returned a non-JSON research response.");
  }
  if (!response.ok) {
    throw new Error("OpenAI research retrieval failed with HTTP " + response.status + ".");
  }
  return json;
}

async function finalizeResearchReport(db, reportDoc, responseJson, source) {
  const result = researchResult(responseJson, Date.now());
  if (!result.terminal) return false;
  const applied = await db.runTransaction(async (tx) => {
    const current = await tx.get(reportDoc.ref);
    if (!current.exists || current.data().status !== "generating") return false;
    tx.update(reportDoc.ref, Object.assign({}, result.update, {completionSource: source}));
    return true;
  });
  if (applied && result.update.status === "ready") {
    const d = reportDoc.data();
    await recordUsage(db, "deep-research", d.model || DEEP_MODEL_DEFAULT,
      extractUsage(responseJson), phtDateKey());
    await recordSearches(db, "deep-research", webSearchCount(responseJson), phtDateKey());
  }
  return applied;
}

async function findResearchReport(db, openaiId) {
  const snap = await db.collection(REPORTS_COLL).where("openaiId", "==", openaiId).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

exports.openaiWebhook = onRequest(
  {
    region: "asia-southeast1",
    timeoutSeconds: 30,
    memory: "256MiB",
    secrets: [OPENAI_API_KEY, OPENAI_WEBHOOK_SECRET],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST").status(405).send("Method not allowed");
      return;
    }
    let event;
    try {
      const client = new OpenAI({apiKey: OPENAI_API_KEY.value()});
      const rawBody = request.rawBody.toString("utf8");
      event = await client.webhooks.unwrap(rawBody, request.headers, OPENAI_WEBHOOK_SECRET.value());
    } catch (error) {
      logger.warn("Rejected OpenAI webhook", {message: error.message});
      response.status(400).send("Invalid webhook signature");
      return;
    }

    if (!event || typeof event.type !== "string" || !event.type.startsWith("response.")) {
      response.status(204).send();
      return;
    }
    const openaiId = event.data && event.data.id;
    if (!openaiId) {
      response.status(204).send();
      return;
    }

    const eventId = String(request.get("webhook-id") || event.id || (event.type + "-" + openaiId));
    try {
      await getFirestore().collection(WEBHOOK_EVENTS_COLL).doc(eventId).create({
        eventId,
        type: event.type,
        openaiId,
        receivedAt: Date.now(),
        status: "queued",
      });
    } catch (error) {
      // ALREADY_EXISTS means OpenAI retried a webhook we already accepted.
      if (error.code !== 6 && error.code !== "already-exists") throw error;
    }
    response.status(202).send("Accepted");
  }
);

exports.processOpenAIWebhook = onDocumentCreated(
  {
    document: WEBHOOK_EVENTS_COLL + "/{eventId}",
    region: "asia-southeast1",
    timeoutSeconds: 120,
    memory: "256MiB",
    retry: true,
    secrets: [OPENAI_API_KEY],
  },
  async (event) => {
    const eventRef = event.data && event.data.ref;
    const queued = event.data && event.data.data();
    if (!eventRef || !queued || !queued.openaiId) return;
    const db = getFirestore();
    const reportDoc = await findResearchReport(db, queued.openaiId);
    if (!reportDoc) {
      if (missingReportAction(queued.receivedAt) === "retry") {
        throw new Error("Research report not yet available for " + queued.openaiId);
      }
      await eventRef.set({
        status: "ignored",
        reason: "untracked-response",
        processedAt: Date.now(),
      }, {merge: true});
      logger.info("Ignored untracked OpenAI response event", {
        eventId: queued.eventId,
        type: queued.type,
      });
      return;
    }
    const json = await retrieveOpenAIResponse(queued.openaiId);
    const applied = await finalizeResearchReport(db, reportDoc, json, "webhook");
    await eventRef.set({
      status: applied ? "processed" : "ignored",
      processedAt: Date.now(),
      responseStatus: json.status || "unknown",
    }, {merge: true});
  }
);

exports.pollDeepResearchReports = onSchedule(
  {
    schedule: "every 15 minutes",
    region: "asia-southeast1",
    timeoutSeconds: 120,
    memory: "256MiB",
    secrets: [OPENAI_API_KEY],
  },
  async () => {
    const db = getFirestore();
    const snap = await db.collection(REPORTS_COLL).where("status", "==", "generating").limit(10).get();
    if (snap.empty) return;

    const now = Date.now();
    const STUCK_MS = 45 * 60 * 1000;

    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.requestedAt && (now - d.requestedAt) > STUCK_MS) {
        await doc.ref.update({status: "error", error: "Timed out before completion.", completedAt: now});
        continue;
      }
      if (!d.openaiId) {
        await doc.ref.update({status: "error", error: "Missing job id."});
        continue;
      }

      let json;
      try {
        json = await retrieveOpenAIResponse(d.openaiId);
      } catch (err) {
        logger.warn("Poll fetch failed for " + doc.id, err);
        continue; // retry next tick
      }

      await finalizeResearchReport(db, doc, json, "recovery-poller");
      // queued / in_progress → leave for the next tick
    }
  }
);

// ── MORNING 5 WEB-PUSH DELIVERY ───────────────────────────────────────────
// Delivery uses Firebase Cloud Messaging and the same deterministic Command
// Center core as the browser. No LLM call is made. The scheduler runs through
// the morning so quiet hours can delay a digest. Since 11 Oct one push goes
// each morning (state.morningDay), and after it only a meeting about to start;
// an open call rides one push (state.asked), a reminder one (lastReminderIds).

function phtParts(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now == null ? Date.now() : now));
  const out = {};
  parts.forEach((part) => { if (part.type !== "literal") out[part.type] = part.value; });
  return {date: out.year + "-" + out.month + "-" + out.day, time: out.hour + ":" + out.minute};
}

async function pointedDocument(db, pointerId, prefix) {
  const pointer = await db.collection(BRIEFINGS_COLL).doc(pointerId).get();
  if (!pointer.exists || !pointer.data().value) return null;
  const snap = await db.collection(BRIEFINGS_COLL).doc(prefix + pointer.data().value).get();
  return snap.exists ? snap.data() : null;
}

async function sharedCommandInputs(db) {
  const [radar, markets, sports, news, health, grounding] = await Promise.all([
    pointedDocument(db, "radar-latest", "radar-"),
    pointedDocument(db, "miro-latest", "miro-"),
    pointedDocument(db, "sports-latest", "sports-"),
    pointedDocument(db, "news-latest", "news-"),
    db.collection(BRIEFINGS_COLL).doc("feed-health").get().then((snap) => snap.exists ? snap.data() : null),
    db.collection(BRIEFINGS_COLL).doc("grounding-latest").get().then((snap) => snap.exists ? snap.data() : null),
  ]);
  return {radar, markets, sports, news, health, grounding};
}

async function userCommandInputs(db, uid, prefs, shared, now) {
  const [briefingSnap, decisionsSnap, meetingsSnap] = await Promise.all([
    recentBriefingDocs(db.collection(BRIEFINGS_COLL), uid, 5),
    db.collection(JOURNAL_COLL).where("uid", "==", uid).orderBy("saved", "desc").limit(100).get(),
    db.collection(BRIEFINGS_COLL).doc("meetings-" + uid).get().catch(() => null),
  ]);
  let briefing = null, briefingDay = "";
  briefingSnap.some((doc) => {
    const value = doc.data();
    if (!value.data) return false;
    try { briefing = JSON.parse(value.data); } catch (error) { briefing = null; }
    const saved = Number(value.saved && value.saved.toMillis ? value.saved.toMillis() : value.saved);
    if (briefing && Number.isFinite(saved)) briefingDay = phtParts(saved < 1e12 ? saved * 1000 : saved).date;
    return !!briefing;
  });
  // Only today's briefing: at 06:00 the latest is usually yesterday's, which he
  // has read, and he builds today's himself when he opens the app.
  if (briefingDay !== phtParts(now).date) briefing = null;
  const decisions = decisionsSnap.docs.map((doc) => Object.assign({id: doc.id}, doc.data()));
  return Object.assign({}, shared, {
    briefing,
    decisions,
    meetings: meetingsSnap && meetingsSnap.exists ? meetingsSnap.data() : null,
    preferences: prefs,
    today: phtParts(now).date,
  });
}

function invalidMessagingToken(error) {
  const code = error && error.code;
  return code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token" ||
    code === "messaging/invalid-argument";
}

async function updateDeliveryState(db, prefRef, updater) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(prefRef);
    if (!snap.exists) throw new Error("Command preferences no longer exist.");
    const current = snap.data().deliveryState || {};
    const next = updater(Object.assign({}, current)) || current;
    tx.set(prefRef, {deliveryState: next, updatedAt: new Date().toISOString()}, {merge: true});
    return next;
  });
}

function auditEntry(type, detail) {
  return Object.assign({type, at: new Date().toISOString()}, detail || {});
}

function withAudit(state, entry) {
  state.audit = [entry].concat(Array.isArray(state.audit) ? state.audit : []).slice(0, 20);
  return state;
}

// Today's spark and due watch-metric reminders, from one read of the account's
// synced Daily Boost doc, and on Sundays whether the weekly read is still to do
// (one more read, that day only). Best effort: a failed read leaves it off the push.
// The weekly read is owner-only AI, so only an owner's push announces it.
async function dailyBoostFor(db, uid, now, lastWeeklyNudge, weeklyAllowed) {
  const dayKey = phtDateKey(now);
  // His weekly commitments (Today's "This week" card): one line in the push,
  // and Sunday's review counts as the weekly nudge.
  const review = await db.collection(BRIEFINGS_COLL).doc("review-" + uid).get()
    .then((snap) => (snap.exists ? snap.data().weeks || {} : {}))
    .catch((error) => { logger.warn("Weekly review lookup failed", {message: error.message}); return {}; });
  const commitment = commitmentLine(WeeklyReviewCore, review, dayKey);
  let weekly = lastWeeklyNudge !== dayKey && weeklyReviewDue(WeeklyReviewCore, review, dayKey);
  if (!weekly && weeklyAllowed && weeklyReadDue(dayKey, {}, lastWeeklyNudge)) {
    try {
      const reads = await db.collection(BRIEFINGS_COLL).doc("weekly-mirror-" + uid).get();
      weekly = weeklyReadDue(dayKey, reads.exists ? reads.data().mirrors : {}, lastWeeklyNudge);
    } catch (error) {
      logger.warn("Weekly read lookup failed", {message: error.message});
    }
  }
  try {
    const [doc, lean] = await Promise.all([
      db.collection(BRIEFINGS_COLL).doc("daily-boost-" + uid).get(),
      // The themes of his goals: the app leans the spark towards them, so the push must too.
      db.collection(BRIEFINGS_COLL).doc("goals-" + uid).get()
        .then((snap) => (snap.exists ? (snap.data().goals || []).filter((goal) => goal && !goal.archived).slice(0, 3).map((goal) => goal.theme) : []))
        .catch(() => []),
    ]);
    const entries = doc.exists ? doc.data().entries : {};
    return {spark: todaysSparkTitle(DailyBoostCore, entries, dayKey, lean), reminders: dueReminders(DailyBoostCore, entries, dayKey), experiment: dueExperiment(DailyBoostCore, entries, dayKey), weekly, commitment};
  } catch (error) {
    logger.warn("Daily Boost lookup failed", {message: error.message});
    return {spark: "", reminders: [], experiment: null, weekly, commitment};
  }
}

// Today's plan for the push: his own calendar events, the linked calendars'
// all-day entries (read already, as meetings) and, for the owner only, his ★
// PokerHQ picks: pokerhq-bob is Bob's, never a member's. Best effort: a failed
// read leaves the line off.
async function todayFor(db, uid, meetings, dayKey, owner) {
  try {
    const [events, tourneys] = await Promise.all([
      db.collection(BRIEFINGS_COLL).doc("calendar-events-" + uid).get().then((snap) => (snap.exists ? snap.data().items || [] : [])),
      owner ? db.collection("pokerhq-bob").doc("tourneys").get().then((snap) => {
        const value = snap.exists ? snap.data().value : null;
        const list = typeof value === "string" ? JSON.parse(value) : value;
        return Array.isArray(list) ? list : [];
      }) : [],
    ]);
    return todayLine(DaybookCalendarCore, {manual: events, meetings, tourneys}, dayKey);
  } catch (error) {
    logger.warn("Today line failed", {message: error.message});
    return "";
  }
}

// His body line (lib/health-core.js bodyLine), only when it is worth a push:
// steps well off his usual or short nights repeating. Owner only, since
// Apple Health is. Best effort: a failed read leaves it off.
async function bodyFor(db, uid, now) {
  try {
    const snap = await db.collection(BRIEFINGS_COLL).doc(HealthLink.HEALTH_PREFIX + uid).get();
    const line = snap.exists ? HealthCore.bodyLine(snap.data(), now) : null;
    return line && line.notable ? line.text : "";
  } catch (error) {
    logger.warn("Body line failed", {message: error.message});
    return "";
  }
}

// His next booked trip's countdown and open to-dos. Best effort.
async function bookedTripFor(db, uid, dayKey) {
  try {
    const snap = await db.collection(BRIEFINGS_COLL).doc("trips-booked-" + uid).get();
    return snap.exists ? bookedTripLine(FlightsCore, snap.data(), dayKey) : null;
  } catch (error) {
    logger.warn("Booked trip line failed", {message: error.message});
    return null;
  }
}

// His fare watches met by the latest flight scout, once each. Best effort:
// a failed read leaves the line off.
async function fareWatchFor(db, uid, alerted, now) {
  try {
    const [watch, latest, ph] = await Promise.all(["flights-watch-" + uid, "flights-latest", "radar-ph"].map((id) => db.collection(BRIEFINGS_COLL).doc(id).get()));
    if (!watch.exists || !latest.exists) return null;
    return fareWatchLine(FlightsCore, watch.data(), latest.data(), ph.exists ? ph.data() : null, alerted, now);
  } catch (error) {
    logger.warn("Fare watch line failed", {message: error.message});
    return null;
  }
}

// His PSE watchlist alerts from the last close (pse-watch-<uid>), once.
// Best effort: a failed read leaves the line off.
async function pseFor(db, uid, lastAsOf, dayKey) {
  try {
    const snap = await db.collection(BRIEFINGS_COLL).doc("pse-watch-" + uid).get();
    return pseLine(snap.exists ? snap.data() : null, lastAsOf, dayKey);
  } catch (error) {
    logger.warn("PSE line failed", {message: error.message});
    return null;
  }
}

async function deliverMorningFiveForUser(db, prefDoc, options) {
  options = options || {};
  const prefs = prefDoc.data();
  const config = normalizeDelivery(prefs.delivery);
  const state = prefs.deliveryState || {};
  const tokens = Array.isArray(state.tokens) ? state.tokens.filter(Boolean).slice(0, 500) : [];
  if (!options.test && !config.enabled) return {status: "muted"};
  if (!tokens.length) return {status: "no-device"};

  const now = options.now == null ? Date.now() : options.now;
  const local = phtParts(now);
  if (!options.test && isQuietTime(local.time, config.quietStart, config.quietEnd)) {
    return {status: "quiet-hours"};
  }
  // An account whose invite was removed stops getting the Morning 5 at once.
  const role = options.role !== undefined ? options.role : await daybookRoleForUid(prefs.uid);
  if (!role) return {status: "not-member"};

  const shared = options.shared || await sharedCommandInputs(db);
  const inputs = await userCommandInputs(db, prefs.uid, prefs, shared, now);
  const command = buildCommandCenter(inputs, now);
  const dayKey = local.date;
  // The whole ranked list: the top work item leads, feed failures stay out, and
  // open calls not yet asked about get their own "Due:" line.
  const items = selectDeliverable(command.items, config, state.led);
  const asks = decisionAsks(command.items, state.asked);
  const boost = await dailyBoostFor(db, prefs.uid, now, state.lastWeeklyNudge, role === "owner");
  const today = await todayFor(db, prefs.uid, inputs.meetings, dayKey, role === "owner");
  // A test push shows the latest alerts even if a morning push already carried them.
  const pse = await pseFor(db, prefs.uid, options.test ? null : state.lastPseAlertsAsOf, dayKey);
  // A test push shows met fare watches even if a morning push carried them.
  const fares = await fareWatchFor(db, prefs.uid, options.test ? [] : state.fareAlerted, now);
  const trip = await bookedTripFor(db, prefs.uid, dayKey);
  // Rides only on a push already going out, like this week's commitment.
  const body = role === "owner" ? await bodyFor(db, prefs.uid, now) : "";
  // Only reminders no push has carried yet.
  const reminders = newReminders(boost.reminders, state.lastReminderIds);
  // One morning push a day; after it, only a meeting about to start.
  const urgent = urgentItems(items, state.pushed, dayKey);
  const kind = options.test ? "test" : pushKind(state, dayKey, {items, asks, today, reminders, weekly: boost.weekly, experiment: boost.experiment, commitment: boost.commitment, pse: pse && pse.line, fares: fares && fares.line, trip}, urgent);
  if (!kind) return {status: state.morningDay === dayKey ? "already-sent" : "nothing-to-send"};
  const sentItems = kind === "urgent" ? urgent : items;
  const alone = kind !== "urgent" && !items.length && !asks.length && !today && !pse && !fares && !trip;
  const remindersOnly = alone && reminders.length > 0;
  const weeklyOnly = alone && !reminders.length && !!boost.weekly;

  // No spark line since 11 Oct: Daily Boost was done on 0 of 13 days, and the
  // push he chose reads lead, today, this week.
  const copy = kind === "urgent" ? notificationCopy(urgent, false, {urgent: true}) :
    notificationCopy(items, kind === "test", {today, asks, pse: pse && pse.line, fares: fares && fares.line, trip, reminders, experiment: boost.experiment, remindersOnly, weekly: boost.weekly, weeklyOnly, commitment: boost.commitment, body});
  const response = await getMessaging().sendEachForMulticast({
    tokens,
    data: {
      type: kind === "test" ? "morning-digest-test" : kind === "urgent" ? "starting-soon" : remindersOnly ? "watch-reminders" : weeklyOnly ? "weekly-read" : "morning-digest",
      title: copy.title,
      body: copy.body,
      // The Morning 5 lists the due experiment, so the push still opens there.
      url: remindersOnly || weeklyOnly ? TODAY_URL : COMMAND_URL,
      // The notification tag (sw.js): a later push the same day replaces the morning one.
      signature: kind === "urgent" ? "soon-" + urgent.map((item) => item.id).join("|") : kind === "test" ? "test-" + dayKey : "morning-" + dayKey,
    },
    webpush: {headers: {Urgency: "high"}},
  });
  const invalid = [];
  response.responses.forEach((result, index) => {
    if (!result.success && invalidMessagingToken(result.error)) invalid.push(tokens[index]);
  });
  const validTokens = tokens.filter((token) => invalid.indexOf(token) < 0);
  const type = options.test ? "test" : (response.successCount ? "sent" : "failed");
  await updateDeliveryState(db, prefDoc.ref, (next) => {
    next.tokens = validTokens;
    if (!options.test && response.successCount) {
      if (kind === "morning") {
        next.morningDay = dayKey;
        next.led = ledAfter(next.led, items[0], dayKey);
        // Every reminder now due counts as announced, so only new ones ride the next push.
        next.lastReminderIds = reminderIds(boost.reminders);
        if (boost.weekly) next.lastWeeklyNudge = dayKey;
        // These PSE alerts are announced; the next close's alerts ride the next push.
        if (pse) next.lastPseAlertsAsOf = pse.asOf;
        // These fare-watch hits are announced; a new price or fare is news again.
        if (fares) next.fareAlerted = (Array.isArray(next.fareAlerted) ? next.fareAlerted : []).concat(fares.keys).slice(-60);
      }
      next.asked = askedAfter(next.asked, kind === "morning" ? asks : [], dayKey);
      next.pushed = pushedAfter(next.pushed, sentItems, dayKey);
      delete next.lastSignature;
      next.lastSentAt = new Date(now).toISOString();
    }
    return withAudit(next, auditEntry(type, {
      kind,
      itemCount: sentItems.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      lead: remindersOnly ? "To check: " + reminders[0].metric : weeklyOnly ? "Weekly read" : (sentItems[0] ? sentItems[0].source + ": " + sentItems[0].title : "No items above threshold"),
      reminders: reminders.length,
      pse: pse ? pse.asOf : null,
      fares: fares ? fares.keys.length : 0,
      // What the phone showed, so a push can be checked without the phone.
      title: copy.title,
      body: String(copy.body || "").slice(0, 500),
    }));
  });
  return {status: type, successCount: response.successCount, failureCount: response.failureCount};
}

// Delivery is for Daybook's members only (daybookRole in generation-guard.js).
// Email sign-up is open on the shared project, so "signed in" is not enough.
const inviteExists = (email) => getFirestore().collection("daybook-invites").doc(email).get().then((snap) => snap.exists);
async function requireDaybookMember(auth, action) {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in before " + action + ".");
  const role = await daybookRole(auth.token, GENERATION_OWNERS, inviteExists);
  if (!role) throw new HttpsError("permission-denied", "This account is not on Daybook's invite list.");
  return role;
}
// The scheduled run has only the uid, so it reads the account's email from Auth.
async function daybookRoleForUid(uid) {
  try {
    const user = await getAuth().getUser(uid);
    return await daybookRole({email: user.email, email_verified: user.emailVerified}, GENERATION_OWNERS, inviteExists);
  } catch (error) {
    logger.warn("Daybook membership lookup failed", {uid, code: error.code, message: error.message});
    return null;
  }
}

exports.registerBriefingDevice = onCall(
  {region: "asia-southeast1", timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    await requireDaybookMember(request.auth, "enabling delivery");
    const token = String(request.data && request.data.token || "").trim();
    if (token.length < 20 || token.length > 4096) {
      throw new HttpsError("invalid-argument", "The browser returned an invalid delivery token.");
    }
    const uid = request.auth.uid;
    const db = getFirestore();
    const ref = db.collection(BRIEFINGS_COLL).doc(COMMAND_PREF_PREFIX + uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      const state = Object.assign({}, data.deliveryState || {});
      state.tokens = [token].concat(Array.isArray(state.tokens) ? state.tokens.filter((item) => item !== token) : []).slice(0, 5);
      state.tokenUpdatedAt = new Date().toISOString();
      withAudit(state, auditEntry("enabled", {lead: "Notifications enabled on a browser device"}));
      tx.set(ref, {uid, deliveryState: state, updatedAt: new Date().toISOString()}, {merge: true});
    });
    return {registered: true};
  }
);

exports.muteBriefingDelivery = onCall(
  {region: "asia-southeast1", timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    await requireDaybookMember(request.auth, "muting delivery");
    const uid = request.auth.uid;
    const db = getFirestore();
    const ref = db.collection(BRIEFINGS_COLL).doc(COMMAND_PREF_PREFIX + uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : {};
      const state = withAudit(Object.assign({}, data.deliveryState || {}),
        auditEntry("muted", {lead: "Morning delivery muted"}));
      tx.set(ref, {
        uid,
        delivery: Object.assign({}, data.delivery || {}, {enabled: false}),
        deliveryState: state,
        updatedAt: new Date().toISOString(),
      }, {merge: true});
    });
    return {muted: true};
  }
);

exports.testBriefingDelivery = onCall(
  {region: "asia-southeast1", timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const role = await requireDaybookMember(request.auth, "testing delivery");
    const uid = request.auth.uid;
    const db = getFirestore();
    const doc = await db.collection(BRIEFINGS_COLL).doc(COMMAND_PREF_PREFIX + uid).get();
    if (!doc.exists) throw new HttpsError("failed-precondition", "Save delivery preferences first.");
    try {
      const result = await deliverMorningFiveForUser(db, doc, {test: true, role});
      if (result.status === "no-device") throw new HttpsError("failed-precondition", "Enable notifications on this device first.");
      return result;
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error("Test Morning 5 delivery failed", error);
      throw new HttpsError("internal", "The test notification could not be sent.");
    }
  }
);

// ─────────────────────────────────────────────────────────────
// Calendars (functions/calendar.js): his secret iCal links, read twice a day,
// keeping 90 days of meetings and all-day entries (leave, holidays) for the
// Calendar page, and apart from those the next 36 hours of meetings that name
// one of his accounts, for briefs. The owner's only: the briefs they lead to
// are owner-only AI.
// ─────────────────────────────────────────────────────────────
async function fetchCalendar(url) {
  let response;
  try {
    response = await fetch(url, {headers: {"Accept": "text/calendar"}, redirect: "follow", signal: AbortSignal.timeout(20000)});
  } catch (error) {
    throw new Error("could not reach the calendar");
  }
  if (!response.ok) throw new Error("the calendar answered HTTP " + response.status + (response.status === 404 ? " (was the link reset?)" : ""));
  const length = Number(response.headers.get("content-length") || 0);
  if (length > Calendar.MAX_ICS_BYTES) throw new Error("the calendar file is too large");
  const body = await response.text();
  if (body.length > Calendar.MAX_ICS_BYTES) throw new Error("the calendar file is too large");
  if (!/BEGIN:VCALENDAR/.test(body.slice(0, 2000))) throw new Error("the link did not return a calendar");
  return body;
}

// Read every saved link and keep, in meetings-<uid>: the matched meetings
// (items), every meeting for 90 days (events: title and times only) and the
// all-day entries (days: title and dates only). The link itself never
// appears in a result or a log.
async function readCalendars(db, uid, now) {
  const coll = db.collection(BRIEFINGS_COLL);
  const [calendarSnap, accountsSnap] = await Promise.all([
    coll.doc("calendar-" + uid).get(), coll.doc("accounts-" + uid).get().catch(() => null),
  ]);
  const links = Calendar.cleanLinks(calendarSnap.exists ? calendarSnap.data().links : []);
  const kept = accountsSnap && accountsSnap.exists ? cleanAccounts((accountsSnap.data() || {}).accounts) : [];
  const accounts = kept.length ? kept : DEFAULT_ACCOUNTS;
  const from = now, to = now + Calendar.WINDOW_HOURS * 3600000, span = Calendar.dayWindow(now);
  const priorSnap = await coll.doc("meetings-" + uid).get().catch(() => null);
  const prior = priorSnap && priorSnap.exists ? priorSnap.data() : {};
  const results = await Promise.all(links.map(async (link) => {
    try {
      const read = Calendar.readCalendar(await fetchCalendar(link.url), from, to, span.fromDay, span.toDay);
      const meetings = Calendar.matchMeetings(read.events, accounts, link.service);
      const days = Calendar.matchDays(read.days, link.service);
      const listed = Calendar.listEvents(read.listed, accounts, link.service);
      return {meetings, days, listed, source: Calendar.readResult(link.service, read.events, meetings, "", days, listed)};
    } catch (error) {
      logger.warn("Calendar read failed", {uid, service: link.service, message: error.message});
      // A failed read keeps that calendar's meetings, leave and holidays from
      // the last good read, rather than blanking 90 days until the next run.
      const kept = (prior.days || []).filter((d) => d && d.calendar === link.service && d.end >= span.fromDay);
      const keptEvents = (prior.events || []).filter((e) => e && e.calendar === link.service && Date.parse(e.end || e.start) >= now);
      return {meetings: [], days: kept, listed: keptEvents, source: Calendar.readResult(link.service, [], [], error.message)};
    }
  }));
  const built = {};
  (prior.items || []).forEach((m) => { if (m && m.id && m.briefId) built[m.id] = m.briefId; });
  const record = {
    uid, kind: "meetings", checkedAt: new Date(now).toISOString(),
    items: Calendar.mergeMeetings(results.map((r) => r.meetings)).map((m) => (built[m.id] ? Object.assign({}, m, {briefId: built[m.id]}) : m)),
    days: Calendar.mergeDays(results.map((r) => r.days)),
    events: Calendar.mergeEvents(results.map((r) => r.listed)),
    sources: results.map((r) => r.source),
  };
  await coll.doc("meetings-" + uid).set(record);
  return record;
}

// Briefs for his matched meetings in the next 30 hours that have none yet:
// tomorrow's at 18:00, today's at 06:00. Up to MEETING_AUTO_CAP a day; the
// meeting's id is the request id, so a meeting is never paid for twice.
async function prepareMeetingBriefs(db, uid, record, now) {
  const due = Calendar.dueForBriefs(record.items, now);
  if (!due.length) return record;
  const [index, accountsSnap] = await Promise.all([loadAskIndex(db, uid), db.collection(BRIEFINGS_COLL).doc("accounts-" + uid).get().catch(() => null)]);
  const kept = accountsSnap && accountsSnap.exists ? cleanAccounts((accountsSnap.data() || {}).accounts) : [];
  const accounts = kept.length ? kept : DEFAULT_ACCOUNTS;
  const today = new Intl.DateTimeFormat("en-AU", {timeZone: "Asia/Manila", weekday: "long", day: "numeric", month: "long", year: "numeric"}).format(new Date(now));
  for (const meeting of due) {
    const named = accounts.filter((a) => (meeting.accounts || []).indexOf(a.name) >= 0);
    const terms = [].concat(...named.map((a) => [a.name].concat(a.aliases || []))).filter((t, i, all) => t && all.indexOf(t) === i).slice(0, 8);
    const when = new Intl.DateTimeFormat("en-AU", {timeZone: "Asia/Manila", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(new Date(meeting.start));
    try {
      const result = await guardedGeneration({db, uid, feature: "meeting-auto", period: phtDateKey(now), cap: MEETING_AUTO_CAP, requestId: meeting.id, input: {meeting: meeting.id}},
        () => makeMeetingBrief(db, uid, {
          topic: cleanTopic(meeting.title + " (" + when + " Manila)"), material: materialFromIndex(index, terms, now, IntelligenceSearchCore.searchPlan),
          dateLabel: today, usageFeature: "meeting-brief-auto",
          extra: {fromCalendar: true, meetingId: meeting.id, meetingStart: meeting.start, meetingTitle: meeting.title},
        }));
      meeting.briefId = result && result.id;
    } catch (error) {
      logger.warn("Calendar brief not built", {uid, meeting: meeting.id, code: error.code, message: error.message});
      if (error.code === "resource-exhausted") break;
    }
  }
  await db.collection(BRIEFINGS_COLL).doc("meetings-" + uid).set(record);
  return record;
}

// Saving a link on About you reads it at once, so he sees what it found.
exports.checkCalendarNow = onCall(
  {region: "asia-southeast1", timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const role = await requireDaybookMember(request.auth, "reading your calendar");
    if (role !== "owner") throw new HttpsError("permission-denied", "Calendars are on the owner's account only.");
    return readCalendars(getFirestore(), request.auth.uid, Date.now());
  }
);

// ── Apple Health (lib/health-core.js, health-link.js) ──
// Connect makes a new private code for the iOS Shortcut and shows it once;
// any earlier code stops working. Owner only, like the calendars.
async function deleteHealthLinks(db, uid) {
  const snap = await db.collection(HealthLink.LINKS_COLL).where("uid", "==", uid).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  return snap.size;
}
exports.createHealthLink = onCall(
  {region: "asia-southeast1", timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const role = await requireDaybookMember(request.auth, "connecting Apple Health");
    if (role !== "owner") throw new HttpsError("permission-denied", "Apple Health is on the owner's account only.");
    const uid = request.auth.uid, db = getFirestore(), now = Date.now();
    const token = HealthLink.newToken(), info = HealthLink.linkInfo(token, now, process.env.GCLOUD_PROJECT);
    const replaced = await deleteHealthLinks(db, uid);
    await db.collection(HealthLink.LINKS_COLL).doc(HealthLink.tokenHash(token)).create({uid, createdAt: info.connectedAt, lastUsedAt: null});
    await db.collection(BRIEFINGS_COLL).doc(HealthLink.HEALTH_PREFIX + uid).set({uid, kind: "health", link: info}, {merge: true});
    logger.info("Health link made", {uid, replaced});
    return {token, endpoint: info.endpoint, link: info};
  }
);
exports.revokeHealthLink = onCall(
  {region: "asia-southeast1", timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const role = await requireDaybookMember(request.auth, "disconnecting Apple Health");
    if (role !== "owner") throw new HttpsError("permission-denied", "Apple Health is on the owner's account only.");
    const uid = request.auth.uid, db = getFirestore();
    const removed = await deleteHealthLinks(db, uid);
    await db.collection(BRIEFINGS_COLL).doc(HealthLink.HEALTH_PREFIX + uid).set({uid, kind: "health", link: FieldValue.delete()}, {merge: true});
    logger.info("Health link removed", {uid, removed});
    return {removed};
  }
);
// The Shortcut's send. The reply is one plain sentence, so the Shortcut can
// show it as a notification as it is.
exports.healthIngest = onRequest(
  {region: "asia-southeast1", timeoutSeconds: 30, memory: "256MiB", maxInstances: 2},
  async (request, response) => {
    const say = (status, text) => response.status(status).set("Content-Type", "text/plain; charset=utf-8").send(text);
    if (request.method !== "POST") { response.set("Allow", "POST"); say(405, "Send with the POST method."); return; }
    if (request.rawBody && request.rawBody.length > HealthLink.MAX_BODY) { say(413, "Daybook got too much at once. Send the last 3 days only."); return; }
    const token = HealthLink.bearer(request.get("authorization"));
    if (!token) { say(401, "Daybook needs your link code in the Authorization header (About you → Apple Health)."); return; }
    const db = getFirestore(), linkRef = db.collection(HealthLink.LINKS_COLL).doc(HealthLink.tokenHash(token));
    const link = await linkRef.get();
    if (!link.exists) { say(401, "This link code is not connected any more. Connect again on About you → Apple Health and paste the new code."); return; }
    const uid = link.data().uid, ref = db.collection(BRIEFINGS_COLL).doc(HealthLink.HEALTH_PREFIX + uid), now = Date.now();
    const reviewRef = db.collection(BRIEFINGS_COLL).doc("review-" + uid);
    const body = HealthLink.bodyOf(request.body, request.rawBody);
    const receipt = await db.runTransaction(async (tx) => {
      const [snap, review] = await Promise.all([tx.get(ref), tx.get(reviewRef)]);
      const stored = snap.exists ? snap.data() : {};
      const out = HealthCore.ingest(stored, body, now);
      const next = Object.assign({}, stored, out.doc, {uid});
      // His weekly commitments that name steps, distance or a bedtime tick
      // themselves (lib/health-core.js autoTicks): only ever added, in the same
      // transaction, so a tap on Today cannot be lost.
      const ticked = review.exists ? HealthCore.autoTicks(WeeklyReviewCore, review.data().weeks, next, now) : {added: []};
      // The whole document, so days past the keep limit really go.
      tx.set(ref, next);
      tx.update(linkRef, {lastUsedAt: out.receipt.at});
      if (ticked.added.length) tx.set(reviewRef, {uid, weeks: ticked.weeks, updatedAt: out.receipt.at}, {merge: true});
      return Object.assign({}, out.receipt, {ticked: ticked.added.length, message: out.receipt.message + HealthCore.ticksMessage(ticked.added)});
    });
    logger.info("Health send", {uid, lines: receipt.lines, used: receipt.used, rejected: receipt.rejected, changedDays: receipt.changedDays, ticked: receipt.ticked});
    say(200, receipt.message);
  }
);
// ── end health

// 06:00 and 18:00 Manila: the morning catches today's meetings, the evening
// tomorrow's (so a brief can be ready the night before).
exports.checkCalendars = onSchedule(
  {schedule: "0 6,18 * * *", timeZone: "Asia/Manila", region: "asia-southeast1", timeoutSeconds: 540, memory: "512MiB", secrets: [OPENAI_API_KEY]},
  async () => {
    const db = getFirestore();
    const docs = await db.collection(BRIEFINGS_COLL).where("kind", "==", "calendar").limit(20).get();
    for (const doc of docs.docs) {
      const uid = doc.data().uid;
      if (!uid || (await daybookRoleForUid(uid)) !== "owner") continue;
      try {
        const now = Date.now();
        await prepareMeetingBriefs(db, uid, await readCalendars(db, uid, now), now);
      } catch (error) {
        logger.error("Calendar check failed", {uid, message: error.message});
      }
    }
  }
);

// 05:30 Manila: start the news job on time, so the day's news snapshot is in
// before the briefing is generated (functions/news-dispatch.js says why).
// A refused dispatch throws, and the scheduler retries it.
exports.dispatchMorningNews = onSchedule(
  {schedule: "30 5 * * *", timeZone: "Asia/Manila", region: "asia-southeast1", timeoutSeconds: 60, retryCount: 2, secrets: [GITHUB_DISPATCH_TOKEN]},
  async () => {
    const result = await dispatchFeed(fetch, GITHUB_DISPATCH_TOKEN.value(), "news");
    logger.info("Morning news dispatched", result);
  }
);

exports.deliverMorningFive = onSchedule(
  {
    schedule: "0,30 6-11 * * *",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async () => {
    const db = getFirestore();
    const prefs = await db.collection(BRIEFINGS_COLL).where("delivery.enabled", "==", true).limit(100).get();
    if (prefs.empty) return;
    const shared = await sharedCommandInputs(db);
    for (const doc of prefs.docs) {
      if (!doc.id.startsWith(COMMAND_PREF_PREFIX) || !doc.data().uid) continue;
      try {
        await deliverMorningFiveForUser(db, doc, {shared});
      } catch (error) {
        logger.error("Morning 5 delivery failed", {uid: doc.data().uid, message: error.message});
        await updateDeliveryState(db, doc.ref, (next) => withAudit(next,
          auditEntry("failed", {message: String(error.message || error).slice(0, 180)})));
      }
    }
  }
);
