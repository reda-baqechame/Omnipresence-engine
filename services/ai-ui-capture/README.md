# ai-ui-capture

Grounded AI **UI** capture microservice (Profound-style). Captures what a user
actually sees in live AI product surfaces — Perplexity, Google AI Overviews,
and (with a logged-in session) ChatGPT / Gemini — using a real headless browser,
then returns brand/competitor visibility signals.

This is the only honest way to measure **grounded** visibility for engines with
no public API. API answers reflect the model's *parametric knowledge*
(`model_knowledge`); this service measures the *retrieved, cited* surface
(`measured`, grounding_mode `ui_capture`).

## Why it's separate

It needs a browser (Chromium) and must respect each platform's Terms of Service,
so it runs as an opt-in, self-hosted service rather than inside the Next.js app.
The app talks to it only when `ENABLE_AI_UI_CAPTURE=true` and `AI_UI_CAPTURE_URL`
point here; otherwise the app falls back to API/SERP paths and labels results
honestly.

## API

- `GET /health` → `{ ok: true }` (no auth)
- `POST /capture` (auth required)
  - body: `{ surface, prompt, brandName, brandDomain, competitors }`
  - `surface` ∈ `perplexity | google_ai_overview | chatgpt | gemini`
  - `200` → `{ brandMentioned, brandCited, competitorMentions, sourceDomains, citedUrls, answer }`
  - `204` → could not ground (e.g. login required, platform blocked) — never faked

Auth: `Authorization: Bearer $AI_UI_CAPTURE_KEY`, or a signed request
(`x-aiuicapture-signature` = HMAC-SHA256(`${timestamp}.${body}`),
`x-aiuicapture-timestamp`).

## Run

```bash
npm install
npm run install:browser   # one-time: chromium + deps
cp .env.example .env       # set AI_UI_CAPTURE_KEY
npm run dev
```

### Docker

```bash
docker build -t ai-ui-capture .
docker run -p 8788:8788 -e AI_UI_CAPTURE_KEY=$(openssl rand -hex 32) ai-ui-capture
```

### Wire into the app

```
ENABLE_AI_UI_CAPTURE=true
AI_UI_CAPTURE_URL=https://your-host:8788/capture
AI_UI_CAPTURE_KEY=<same strong key>
```

## Logged-in surfaces

ChatGPT and Gemini require a session. Provide a Playwright `storageState` JSON via
`AI_UI_CAPTURE_STORAGE_STATE`; without it those surfaces return `204` instead of a
logged-out (and therefore misleading) answer.

## Compliance

You are responsible for complying with each platform's ToS and robots policy in
your jurisdiction. Keep request volumes reasonable.
