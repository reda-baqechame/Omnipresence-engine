# Full-Power Deployment — Turn On Every Capability

This is the definitive runbook for deploying PresenceOS with **every feature live**
(no demo data) so your platform's users get the full power of the engine.

It is configuration only — no code changes are required. "Full power" = the main
app on Vercel + every provider key set + (optionally) the self-hosted OmniData
engine + the background-job scheduler running.

> Read top to bottom. Tiers are ordered by impact. You can stop after **Tier 2**
> and already have a real, fully-usable product for your users. Tiers 3–5 add
> distribution, attribution, and cost-optimization.

---

## Architecture in one picture

```
                +------------------------------+
   Users  --->  |  Main app (Next.js)          |  deploy to VERCEL
                |  - dashboard, audits, scans  |
                |  - free tools, PDF reports   |
                +---------------+--------------+
                                |
        +-----------------------+------------------------+
        |               |                |               |
     Supabase       AI keys          SERP key        Inngest
     (DB/auth)   (OpenAI/Claude/   (Serper/Brave)   (background
                  Gemini/Perplex)                     jobs/crons)
                                |
                                | OPTIONAL (separate server, NOT Vercel)
                                v
                    +-----------------------------+
                    |  OmniData engine (Express)  |  deploy to FLY / RAILWAY / VPS
                    |  self-hosted SEO data layer |  + Redis + disk
                    +-----------------------------+
```

The main app works on its own. OmniData is an optional cost-saver you wire in
later by setting two env vars. Everything degrades gracefully.

---

## Tier 0 — Required core (app won't really run without these)

| Variable | Where to get it | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | — | `https://your-domain.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | **server-only**, never expose |
| `OAUTH_STATE_SECRET` | generate | 32+ random chars |
| `INTEGRATION_ENCRYPTION_KEY` | generate | 32+ random chars — required before users can save CMS/social creds |
| `FREE_ACCESS_MODE` | — | set `true` to unlock all features for users with no billing |

Generate the two secrets:

```bash
openssl rand -base64 32   # run twice, one for each secret
```

**Supabase setup:**
1. Create a project (free tier is fine to start).
2. SQL editor → run `supabase/migrations/combined.sql` (or each `0001…0019` in order).
3. Authentication → Providers → enable **Email**.
4. Authentication → URL Configuration → Site URL = your domain; Redirect URLs =
   `https://your-domain.com/**` and `http://localhost:3000/**`.
5. Storage → confirm the public `reports` bucket exists (created by migration `0006`).

After this tier: signup/login, projects, technical audits, scoring, free tools,
PDF reports all work. AI-visibility/SERP features still show **demo** data until Tier 1.

---

## Tier 1 — Real AI visibility + rankings (this kills demo mode)

This is the tier that makes the core product *real* for every user. Set **all** AI
keys so all four AI engines (ChatGPT, Claude, Gemini, Perplexity) report real data,
and at least one SERP key.

| Variable | Where to get it | Unlocks | Rough cost |
|---|---|---|---|
| `OPENAI_API_KEY` | platform.openai.com | ChatGPT-engine visibility + content gen + podcast TTS | pay-per-use, ~cents/scan |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Claude-engine visibility | pay-per-use |
| `GOOGLE_GENERATIVE_AI_API_KEY` | aistudio.google.com | Gemini-engine visibility | free tier available |
| `PERPLEXITY_API_KEY` | perplexity.ai/settings/api | Perplexity engine — **real citations with URLs** | pay-per-use |
| `SERPER_API_KEY` | serper.dev | Google organic + AI Overview + rankings | 2,500 free, then cheap |
| `BRAVE_SEARCH_API_KEY` | brave.com/search/api | SERP fallback | 2,000 free/mo |
| `FIRECRAWL_API_KEY` | firecrawl.dev | Cleaner page scraping (else falls back to built-in Cheerio) | free tier |

> Demo mode turns **off** automatically the moment any AI or SERP key is present
> (`preferLiveData()` in `src/lib/config/capabilities.ts`). You do not toggle a flag.
> (To force demo for staging, set `FORCE_DEMO_MODE=true`.)

After this tier: every dashboard tab shows real, measured data. This is a complete
product. Tiers 2–5 are about automation, distribution, and proof.

---

## Tier 2 — Background jobs (continuous value, not one-shot)

Without this, scans run synchronously on request. With it, you get the monthly/
weekly re-scans, daily on-page agents, weekly rank/backlink monitors, scheduled
publishing, guarantee verification, and email reports — i.e. the platform *works
for users while they sleep*.

| Variable | Where | Unlocks |
|---|---|---|
| `INNGEST_EVENT_KEY` | inngest.com | Durable background scans + all 20 cron jobs |
| `INNGEST_SIGNING_KEY` | inngest.com | Same |
| `RESEND_API_KEY` | resend.com | Email reports + lead nurture |
| `RESEND_FROM_EMAIL` | — | `noreply@yourdomain.com` (verify domain in Resend) |

Then in Inngest: create an app and set the **Sync URL** to
`https://your-domain.com/api/inngest`. Confirm the functions appear in their dashboard.

Crons that will start running (UTC): monthly rescan (1st), weekly rescan (Mon 06:00),
weekly email report (Fri 09:00), daily on-page automation (02:00), daily freshness
check (03:00), guarantee verification (04:00), weekly intelligence sync (Mon 04:00),
weekly rank check (Tue 05:00), weekly internal-link scan (Tue 05:00), weekly backlink
monitor (Wed 06:00), weekly + monthly attribution sync, hourly scheduled publisher,
monthly link building (10th).

---

## Tier 3 — Distribution & execution (publish + index automatically)

Lets the platform *act*, not just report: auto-publish content to users' CMSs,
push to social, and submit URLs to search engines.

| Variable | Where | Unlocks |
|---|---|---|
| `INDEXNOW_KEY` | generate a UUID, host it at `/<key>.txt` | Bulk instant indexing (Bing/Yandex) |
| `BING_WEBMASTER_API_KEY` | Bing Webmaster Tools | Bing bulk URL submission |
| `BING_SITE_URL` | — | The verified site in Bing Webmaster |
| `AYRSHARE_API_KEY` | ayrshare.com | Social scheduling (all networks) |
| `BUFFER_ACCESS_TOKEN` | buffer.com | Social scheduling alternative |

CMS publishing (WordPress / Webflow / Shopify) needs **no platform-wide key** — each
user saves their own CMS credentials in-app, encrypted with `INTEGRATION_ENCRYPTION_KEY`
(Tier 0). Just make sure that key is set.

---

## Tier 4 — Attribution & proof (close the loop on ROI)

OAuth connectors so users can prove the visibility turned into traffic. These are
per-user connections; you provide the app-level OAuth client credentials once.

| Variable | Where | Unlocks |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console | GSC, GA4, Google Business Profile connect |
| `BING_CLIENT_ID` / `BING_CLIENT_SECRET` | Microsoft Azure / Bing | Bing Webmaster connect |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | reddit.com/prefs/apps | Richer community-mention coverage (HN is keyless already) |
| `REDDIT_USER_AGENT` | — | e.g. `web:omnipresence-engine:v1.0 (by /u/yourname)` |
| `PAGESPEED_API_KEY` | Google Cloud (free) | Reliable real-user CrUX Core Web Vitals |
| `CLEARBIT_REVEAL_KEY` | clearbit.com | De-anonymize site visitors (optional) |
| `NEXT_PUBLIC_POSTHOG_KEY` | posthog.com | Product analytics |

**OAuth redirect URI** to register with Google/Bing/Microsoft:
`https://your-domain.com/api/oauth/callback`

---

## Tier 5 — OmniData self-hosted data engine (cost optimization)

Optional. This replaces paid SEO-data vendors (DataForSEO etc.) with your own
server, so per-call data costs drop as you scale. It is a **separate deployment**
(it needs a long-running process, Redis, and disk — none of which Vercel provides).

### Deploy OmniData (pick one)

```bash
# Docker (any VPS)
cd services/omnidata
cp .env.example .env        # fill values below
docker compose up -d
curl http://localhost:8787/health
```

- **Fly.io:** `fly launch --copy-config`, `fly volumes create omnidata_data --size 20`,
  set secrets, `fly deploy` (uses `services/omnidata/fly.toml`).
- **Railway:** Dockerfile build with `/health` healthcheck (`railway.json`); add the
  Redis plugin and a volume mounted at `/data`.

### OmniData host env (set on the OmniData server, not Vercel)

| Variable | Required | Purpose |
|---|---|---|
| `OMNIDATA_API_KEY` | yes | Bearer token the main app uses |
| `OMNIDATA_SIGNING_SECRET` | recommended | HMAC between app and engine |
| `REDIS_URL` | yes (prod) | `redis://redis:6379` |
| `SERPER_API_KEY` / `BING_SEARCH_API_KEY` / `BRAVE_SEARCH_API_KEY` | one | SERP source |
| `OPENPAGERANK_API_KEY` | optional | Real 0–100 domain rating for backlinks |
| `GOOGLE_ADS_*` (dev token, client id/secret, refresh token, customer id) | optional | Real keyword volume/CPC via Keyword Planner |
| `WEBGRAPH_DB_PATH` | optional | Common Crawl webgraph DuckDB index for real backlinks |
| `OMNIDATA_ENABLE_SCRAPE` | optional | `true` + Chromium build enables keyless SERP/Maps scraping |

Real backlinks need the Common Crawl index built once per release:
```bash
npm run webgraph:ingest -- cc-main-2024-aug-sep-oct   # several GB disk
```
Until built, backlinks fall back to OpenPageRank, clearly labeled. Check readiness:
`GET /v3/backlinks/webgraph/status`.

### Wire it into the main app (set on Vercel)

```env
OMNIDATA_BASE_URL=https://your-omnidata-host
OMNIDATA_API_KEY=same-secret-as-the-host
OMNIDATA_SIGNING_SECRET=same-hmac-as-the-host
```

The app auto-routes SERP/backlink/keyword calls to OmniData once these are set
(`getActiveSerpProvider()` in `src/lib/providers/serp-router.ts`). No code change.

**Paid alternative / fallback:** instead of OmniData you can set
`DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` for the global backlink index + AI search
volume.

---

## Deploy the main app

```bash
npm i -g vercel
vercel link
# set all env vars in the Vercel dashboard (Project → Settings → Environment Variables)
vercel --prod
```

Or import the GitHub repo in the Vercel dashboard and add env vars there.

---

## Verify full power is on

```bash
node scripts/smoke-test.mjs https://your-domain.com
npm run wire:diy            # validates the DIY data stack against /api/capabilities
```

Then check the live endpoints:

- `GET /api/health` → `status: "healthy"`, production ready, schema checks pass
- `GET /api/capabilities` → every provider you configured shows `configured: true`,
  `liveData: true`, `activeSerpProvider` set

In-app sanity pass:
- [ ] Sign up → org + dashboard load
- [ ] Create a project → scan completes with **measured** (not simulated) data
- [ ] Visibility tab shows real AI engine results with citation URLs
- [ ] Rankings tab returns real SERP positions
- [ ] Generate report → PDF downloads
- [ ] Inngest dashboard lists the cron functions
- [ ] (If OmniData) `/api/capabilities` shows `activeSerpProvider: "omnidata"`

---

## Recommended sequencing (fastest path to real value)

1. **Tier 0 + Tier 1** → real product, demo mode off. *Stop here if you just want it live.*
2. **Tier 2** → continuous automation and email.
3. **Tier 3 + Tier 4** → distribution, indexing, attribution/proof.
4. **Tier 5 (OmniData)** → only once data costs justify self-hosting.

There is no source of free unlimited SEO/AI data — "full power" means the operator
(you) provisions the data layer. Once these keys are set, every user of your
platform gets the full, real engine.
