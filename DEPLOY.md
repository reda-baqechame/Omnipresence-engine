# PresenceOS — Production Deploy Guide

## Prerequisites

- [Supabase](https://supabase.com) project
- [Vercel](https://vercel.com) account
- [Stripe](https://stripe.com) account (test mode OK for staging)
- [Inngest](https://www.inngest.com) account (optional but recommended for background scans)
- [Resend](https://resend.com) for transactional email (optional)

## 1. Supabase setup

### Run migrations

In the Supabase SQL editor, run migrations **in order**:

```
supabase/migrations/0001_init.sql
...
supabase/migrations/0008_free_access.sql
supabase/migrations/0009_v2_real_results.sql   # v2: results ledger, citation sources, ops queue
```

Or run the combined file in one shot (regenerate with `npm run db:combine`):

```
supabase/migrations/combined.sql
```

### Auth configuration

1. **Authentication → Providers** — enable Email
2. **Authentication → URL Configuration**:
   - Site URL: `https://your-domain.com`
   - Redirect URLs: `https://your-domain.com/**`, `http://localhost:3000/**`

### Storage

Migration `0006` creates the public `reports` bucket. Verify it exists under **Storage**.

## 2. Vercel deploy

```bash
# Install Vercel CLI (if needed)
npm i -g vercel

# From project root
vercel link
vercel env pull .env.local   # optional: sync env locally
vercel --prod
```

Or import the GitHub repo in the Vercel dashboard.

**Live production:** [https://omnipresence-engine.vercel.app](https://omnipresence-engine.vercel.app) (GitHub-connected; set env vars below for full functionality).

## 2b. Railway deploy (recommended for the keyless data moat)

Vercel's serverless functions cap execution time, so the always-on, heavy-compute
layer (OmniData scraping, headless Chromium, transformers.js embeddings, SearXNG,
Ollama, LanguageTool) cannot run there by default. Railway runs long-lived
containers, so deploy the full 100X stack there.

Create one Railway project with these services. Each non-app service points at
`services/omnidata` as its **Root Directory**; Railway then auto-detects the
config file in that folder.

| Service | Root dir / config | Start | Notes |
| --- | --- | --- | --- |
| **app** | repo root `railway.json` | `npm run start` | Next.js. Healthcheck `/api/health`. |
| **omnidata-api** | `services/omnidata` → `railway.json` | `node dist/index.js` | Keyless SERP/backlinks/crawl/embeddings. Healthcheck `/health`. Set `OMNIDATA_ENABLE_WORKER=false`. |
| **omnidata-worker** | `services/omnidata` → set *Config Path* to `railway.worker.json` | `node dist/worker.js` | BullMQ queue consumer (crawl/webgraph jobs). |
| **redis** | Railway Redis plugin | — | Set `REDIS_URL` on omnidata-api + omnidata-worker. |
| **searxng** *(optional)* | `searxng/searxng` image | — | Keyless meta-search SERP. Set `SEARXNG_URL` on app + omnidata. |
| **ollama** *(optional)* | `ollama/ollama` image | — | Open-model AI visibility. Set `OLLAMA_BASE_URL` on app. |
| **posthog / languagetool** *(optional)* | official images | — | First-party analytics + grammar/style. |

Wire-up:

1. On **app**, set everything from `.env.example` plus `OMNIDATA_BASE_URL=http://omnidata-api.railway.internal:8787`.
2. **Security (required):** set a strong `OMNIDATA_API_KEY` (24+ chars — `openssl rand -hex 32`) and `OMNIDATA_SIGNING_SECRET` on **app**, **omnidata-api**, and **omnidata-worker**. OmniData now **refuses to boot in production** if the key is missing or still the default `dev-local-key`.
3. Add a **persistent volume** to **omnidata-api** and **omnidata-worker** mounted at `/data` (Common Crawl webgraph index). Mount the same volume on both so the worker's ingested index is queryable by the API.
4. Set `REDIS_URL` on **omnidata-api** and **omnidata-worker** (Railway Redis plugin internal URL).
5. Railway sets `PORT` automatically; `next start` and OmniData both bind to it.
6. The fail-fast env guard activates on `RAILWAY_ENVIRONMENT`, so a misconfigured deploy fails loudly at boot instead of silently serving errors.

Verify the whole stack after deploy:

```bash
# Probes app /api/health (production readiness + app↔OmniData) and
# omnidata /health (+ confirms auth is enforced).
npm run railway:verify -- https://your-app.up.railway.app https://your-omnidata.up.railway.app
```

Local all-in-one equivalent:

```bash
docker compose up -d                  # app + OmniData + worker + Redis
docker compose --profile keyless up   # also start SearXNG + Ollama
```

### Seed the Common Crawl backlink/authority moat (one-time)

After the `/data` volume is attached to **omnidata-api**, seed the host-graph once.
Pick the latest release id from [commoncrawl.org/web-graphs](https://commoncrawl.org/web-graphs):

```bash
# Runs inside the omnidata service (streams multi-GB files into DuckDB at /data)
railway run --service omnidata-api npm run webgraph:ingest -- <release-id>
```

Then set `COMMONCRAWL_WEBGRAPH_RELEASE=<release-id>` on the **app** so the monthly
cron (`monthly-webgraph-reingest`, 1st @ 04:00 UTC) keeps it fresh. Verify:
`GET {omnidata}/v3/backlinks/webgraph/status` should report `webgraph_ready: true`
with non-zero `vertex_count`/`edge_count`. Once ingested, `POST /v3/domain/authority/live`
returns real harmonic-centrality authority + referring-domain counts at $0/lookup.

### Direct social auto-posting (no Buffer/Ayrshare fees)

Posts publish natively via the platform APIs only for assets a human moved to
`approved` with a `scheduled_at` (the approval gate). Set on **app**:

- X: `X_ACCESS_TOKEN` (OAuth2 user token, `tweet.write` scope).
- LinkedIn: `LINKEDIN_ACCESS_TOKEN` **and** `LINKEDIN_AUTHOR_URN` (both required).

When a platform isn't configured, the asset is queued to the ops queue for manual
posting instead of being faked.

### Email (sovereign-first)

Set a self-hosted SMTP relay (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`SMTP_FROM`) for $0 transactional email, or `RESEND_API_KEY` as the managed
fallback. The email port tries SMTP first, then Resend.

### Required environment variables

Copy from `.env.example`. Minimum for a working deploy:

| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_APP_URL` | `https://your-domain.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | From Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only — never expose to client |
| `OAUTH_STATE_SECRET` | Random 32+ character string |

For full functionality, also set: `INNGEST_*`, `RESEND_*`, AI provider keys, `SERPER_API_KEY` or `BRAVE_SEARCH_API_KEY`, `PERPLEXITY_API_KEY`, `FIRECRAWL_API_KEY`.

**v2 live data (DIY stack — no DataForSEO required)** — set at minimum:
- `SERPER_API_KEY` (cheap) **or** `BRAVE_SEARCH_API_KEY` (2,000 free queries/mo)
- `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` and/or `GOOGLE_GENERATIVE_AI_API_KEY`
- `PERPLEXITY_API_KEY` (recommended — real citations)
- `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` (step-based scans + daily/weekly agents)

Optional paid boost: `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` (global backlink index + AI search volume only).

Validate locally: `npm run wire:diy` — checks env + remote `/api/capabilities`.

Verify after deploy: `GET /api/health` should show `version: "0.3.0"`, `production.ready`, and `GET /api/capabilities` lists configured providers.

Set `INTEGRATION_ENCRYPTION_KEY` (32+ chars) before saving CMS credentials in production.

**Free access mode** (default): `FREE_ACCESS_MODE=true` unlocks all features with no billing. Stripe keys are optional.

**Demo mode** activates when no live providers are configured (no LLM keys, no SERP keys, no Perplexity) — useful for staging without API costs.

## 3. Stripe

1. Create products/prices for Audit ($199 one-time), Tracking ($299/mo), Agency ($999/mo)
2. Set `STRIPE_PRICE_SOLO` ($29/mo), `STRIPE_PRICE_GROWTH` ($79/mo), `STRIPE_PRICE_AGENCY` ($199/mo)
3. Add webhook endpoint: `https://your-domain.com/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.deleted`
4. Enable **Customer Portal** in Stripe Dashboard → Settings → Billing

## 4. Inngest

1. Create app at [inngest.com](https://www.inngest.com)
2. Connect Vercel integration or set:
   - `INNGEST_EVENT_KEY`
   - `INNGEST_SIGNING_KEY`
3. Sync URL: `https://your-domain.com/api/inngest`

Cron jobs registered:
- **Monthly rescan** — 1st of month
- **Weekly rescan** — Mondays (all active projects in free access mode)
- **Weekly email report** — Fridays 9:00 UTC
- **Weekly attribution sync** — Mondays 07:00 UTC (GSC/Bing/GA4)
- **Monthly attribution sync** — 2nd of month

## 5. OAuth (GSC, Bing, GA4)

Google Cloud Console / Bing Webmaster:
- Redirect URI: `https://your-domain.com/api/oauth/callback`
- Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BING_CLIENT_ID`, `BING_CLIENT_SECRET`

## 6. Verify deploy

```bash
# Against production
node scripts/smoke-test.mjs https://your-domain.com

# Or locally
npm run dev
npm run smoke
```

Health check: `GET /api/health` — returns `status: "healthy"` when Supabase is reachable.

## 7. Post-deploy checklist

- [ ] Sign up → org created → dashboard loads
- [ ] Create project → scan completes (demo or live)
- [ ] Generate report → PDF downloads
- [ ] Public audit at `/audit` captures leads
- [ ] Inngest functions visible in dashboard

(Billing/Stripe checkout is disabled while `FREE_ACCESS_MODE=true`.)

## Troubleshooting

| Issue | Fix |
|-------|-----|
| All routes return 500 | Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` on Vercel |
| Health shows `supabase: error` | Check `SUPABASE_SERVICE_ROLE_KEY` and migrations |
| Scans stuck on "scanning" | Set `INNGEST_EVENT_KEY` or rely on sync fallback (`after()`) |
| OAuth fails | Set `OAUTH_STATE_SECRET` and verify redirect URI |
| 402 on project create | Upgrade plan or increase `api_credit_limit` |
| Leads page empty | Run migration `0004` — admin-only RLS |
