# Bob Daily Briefing

Private daily intelligence briefing desk for Bob.

## Features

- **Daily briefing** — OpenAI-generated intelligence desk (see below).
- **📡 Market Radar** — daily ranking of ~30 assets across 11 themes, with a
  performance journal. Docs: [`radar/README.md`](radar/README.md).
- **🎲 Markets** — daily "scenario read" over curated Polymarket event markets:
  market price vs an independent AI panel, executable edge, GO/NO-GO, and a
  Brier-score journal. The honest version of "MiroFish" — research framing, never
  a bet or execution. Docs: [`miro/README.md`](miro/README.md).

Each market feature is a **local Node refresh script** that writes Firestore docs
the front end reads — no Cloud Functions, no build step.

## OpenAI generation

The browser app does not call OpenAI directly. It calls the Firebase callable
function `generateBobDailyBriefing`, which keeps the API key server-side.

Setup:

```powershell
cd C:\Users\AO\projects\bobdailybriefing\functions
npm install
firebase functions:secrets:set OPENAI_API_KEY --project pokerhq-a67e4
npm run deploy
```

After deploy, sign in to the app and use `OPENAI GENERATE`.

Notes:

- ChatGPT Pro is a ChatGPT subscription, not the API endpoint.
- This app uses the OpenAI API through Firebase Functions.
- The default model is `gpt-5.5`; override with `OPENAI_MODEL` if needed.
