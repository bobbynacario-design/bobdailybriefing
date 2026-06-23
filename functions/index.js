"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp();

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";

// Deep-research generation config (all override-able via env)
const DEEP_MODEL_DEFAULT = process.env.DEEP_MODEL_DEFAULT || "o4-mini-deep-research";
const DEEP_MODEL_PREMIUM = process.env.DEEP_MODEL_PREMIUM || "o3-deep-research";
const DEEP_RESEARCH_CAP = parseInt(process.env.DEEP_RESEARCH_CAP || "20", 10);
const REPORTS_COLL = "reports-bob";
const REPORTS_META = "reports-bob-meta";

// ── LLM usage telemetry (CJS twin of lib/llm-usage.js) ──
// Writes token usage to the shared ledger briefings-bob/llm-usage (no uid).
// Never throws — telemetry must not break generation.
function phtDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function extractUsage(json) {
  const u = (json && json.usage) || {};
  let cached = 0;
  if (u.input_tokens_details && u.input_tokens_details.cached_tokens != null) {
    cached = _num(u.input_tokens_details.cached_tokens);
  } else if (u.cached_tokens != null) {
    cached = _num(u.cached_tokens);
  }
  return {
    inputTokens: _num(u.input_tokens != null ? u.input_tokens : u.inputTokens),
    outputTokens: _num(u.output_tokens != null ? u.output_tokens : u.outputTokens),
    cachedTokens: cached,
  };
}
async function recordUsage(db, feature, model, usage, dateKey) {
  try {
    if (!usage) return;
    const ref = db.collection("briefings-bob").doc("llm-usage");
    const key = feature + "|" + model;
    const nowIso = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? (snap.data() || {}) : {};
      d.entries = d.entries || {};
      d.byDay = d.byDay || {};
      const e = d.entries[key] || {
        feature, model, calls: 0,
        inputTokens: 0, outputTokens: 0, cachedTokens: 0,
        firstSeen: nowIso, lastSeen: nowIso,
      };
      e.calls += 1;
      e.inputTokens += _num(usage.inputTokens);
      e.outputTokens += _num(usage.outputTokens);
      e.cachedTokens += _num(usage.cachedTokens);
      e.lastSeen = nowIso;
      if (!e.firstSeen) e.firstSeen = nowIso;
      d.entries[key] = e;
      if (dateKey) {
        const dd = d.byDay[dateKey] || {calls: 0, inputTokens: 0, outputTokens: 0};
        dd.calls += 1;
        dd.inputTokens += _num(usage.inputTokens);
        dd.outputTokens += _num(usage.outputTokens);
        d.byDay[dateKey] = dd;
      }
      d.updated = nowIso;
      tx.set(ref, d);
    });
  } catch (err) {
    logger.warn("recordUsage failed", err);
  }
}

function buildBriefingPrompt(dateLabel) {
  const date = dateLabel || new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Asia/Manila",
  });

  return [
    "You are an intelligence briefing analyst preparing a daily briefing for Bob.",
    "Bob is a forensic BI consultant who works with Australian insurance companies and Philippine consulting firms.",
    "",
    "Generate today's briefing (" + date + ") as a single JSON object with this exact schema:",
    "{",
    '  "date": "' + date + '",',
    '  "markets": {',
    '    "psei": "6,450.23",',
    '    "psei_move": "+0.8% Up",',
    '    "asx": "8,102.50",',
    '    "asx_move": "-0.3% Down",',
    '    "sp500": "5,890.12",',
    '    "sp500_move": "+0.5% Up"',
    "  },",
    '  "peso": {',
    '    "usdphp": "58.42",',
    '    "usdphp_move": "+0.18% Peso weaker",',
    '    "driver": "Short explanation of the peso move"',
    "  },",
    '  "weather": {',
    '    "location": "Metro Manila",',
    '    "summary": "Scattered thunderstorms",',
    '    "temp_c": "27-32C",',
    '    "rain_chance": "70%",',
    '    "impact": "Claims/interruption relevance for the day"',
    "  },",
    '  "sections": {',
    '    "global": [{"headline": "", "body": "", "source": "", "relevance": "", "relevance_level": "high"}],',
    '    "ph": [{"headline": "", "body": "", "source": "", "relevance": "", "relevance_level": "med"}],',
    '    "insurance": [{"headline": "", "body": "", "source": "", "relevance": "", "relevance_level": "high"}],',
    '    "interruptions": [{"headline": "", "body": "", "source": "", "relevance": "", "relevance_level": "high"}],',
    '    "ai": [{"headline": "", "body": "", "source": "", "relevance": "", "relevance_level": "low"}],',
    '    "markets": [{"headline": "", "body": "", "source": "", "relevance": "", "relevance_level": "none"}],',
    '    "ev": [{"headline": "", "body": "", "source": "", "relevance": "", "relevance_level": "low"}]',
    "  },",
    '  "watch": "One key development to monitor over the coming days.",',
    '  "watch_source": "Source name"',
    "}",
    "",
    "Rules:",
    "- Output only valid JSON. No markdown fences. No prose before or after.",
    "- Include 3-5 real, current stories per section: global, ph, insurance, interruptions, ai, markets, ev.",
    "- The insurance section must be rich in Australian insurance, reinsurance, claims inflation, underwriting, catastrophe exposure, regulatory, audit, and forensic BI implications.",
    "- The interruptions section must focus on business interruption, supply chain disruption, transport/port/power outages, weather events, strikes, cyber outages, plant closures, and events that could affect insured losses or consulting work.",
    "- Every insurance and interruptions story must include a specific Bob-facing insight: likely claim/BI angle, data to monitor, affected industries, or consulting opportunity.",
    "- Include USD/PHP in the peso object, with whether the peso strengthened or weakened and a short driver.",
    "- Include today's Metro Manila weather forecast and an insurance/interruption impact note.",
    "- Use current or very recent news from today or yesterday where possible.",
    "- relevance_level must be one of: high, med, low, none.",
    "- high means directly relevant to insurance, forensic BI, claims, consulting, audit, CPA, underwriting, BSP, ASX, AUD, reinsurance, or business interruption.",
    "- med means relevant to broader economy, markets, trade, inflation, supply chain, regulation, or technology trends.",
    "- low means tangentially useful.",
    "- none means no direct relevance to Bob's work.",
    "- The relevance field must explain why it matters to Bob, or say No direct relevance.",
    "- Each story body should be 2-3 concise sentences.",
    "- Market values should be current and realistic.",
  ].join("\n");
}

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

exports.generateBobDailyBriefing = onCall(
  {
    region: "asia-southeast1",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [OPENAI_API_KEY],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in before generating a briefing.");
    }

    const prompt = buildBriefingPrompt(String((request.data && request.data.date) || "").trim());
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
          search_context_size: "low",
          user_location: {
            type: "approximate",
            country: "PH",
            timezone: "Asia/Manila",
          },
        },
      ],
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

    // Record token usage to the shared LLM cost ledger (no-throw).
    await recordUsage(getFirestore(), "briefing", model, extractUsage(json), phtDateKey());

    return {
      model,
      raw: JSON.stringify(briefing, null, 2),
      briefing,
    };
  }
);

// ─────────────────────────────────────────────────────────────
// Deep-research report generation (long-running, async)
// ─────────────────────────────────────────────────────────────
function buildDeepResearchPrompt(topic) {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila",
  });

  return [
    "You are a deep-research analyst preparing a long-form intelligence report for Bob,",
    "a forensic business-interruption (BI) consultant who works with Australian insurance",
    "companies and Philippine consulting firms. Today is " + today + " (Asia/Manila).",
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
  ].join("\n");
}

exports.generateDeepResearchReport = onCall(
  {
    region: "asia-southeast1",
    timeoutSeconds: 60,
    memory: "256MiB",
    secrets: [OPENAI_API_KEY],
  },
  async (request) => {
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
        {role: "user", content: buildDeepResearchPrompt(topic)},
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
    const docRef = db.collection(REPORTS_COLL).doc("rpt-" + now);
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
    await metaRef.set({month, count: count + 1, updated: now}, {merge: true});

    return {docId: docRef.id, openaiId, model, remaining: DEEP_RESEARCH_CAP - (count + 1)};
  }
);

exports.pollDeepResearchReports = onSchedule(
  {
    schedule: "every 1 minutes",
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
        const res = await fetch("https://api.openai.com/v1/responses/" + d.openaiId, {
          headers: {"Authorization": "Bearer " + OPENAI_API_KEY.value()},
        });
        json = JSON.parse(await res.text());
      } catch (err) {
        logger.warn("Poll fetch failed for " + doc.id, err);
        continue; // retry next tick
      }

      const status = json && json.status;
      if (status === "completed") {
        let md = "";
        try {
          md = extractText(json);
        } catch (err) {
          md = "";
        }
        if (md && md.trim()) {
          await doc.ref.update({md, status: "ready", completedAt: now});
          // Record deep-research token usage to the shared LLM cost ledger (no-throw).
          await recordUsage(db, "deep-research", d.model || DEEP_MODEL_DEFAULT, extractUsage(json), phtDateKey());
        } else {
          await doc.ref.update({status: "error", error: "Completed with empty output.", completedAt: now});
        }
      } else if (status === "failed" || status === "cancelled" || status === "incomplete" || status === "expired") {
        const msg = (json.error && json.error.message) || ("Job " + status + ".");
        await doc.ref.update({status: "error", error: msg, completedAt: now});
      }
      // queued / in_progress → leave for the next tick
    }
  }
);
