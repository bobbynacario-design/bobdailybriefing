"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const {initializeApp} = require("firebase-admin/app");

initializeApp();

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";

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

    return {
      model,
      raw: JSON.stringify(briefing, null, 2),
      briefing,
    };
  }
);
