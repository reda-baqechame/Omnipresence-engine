# OmniPresence — Wiring Guide

What the platform **automates** vs what **you must create and connect manually**.

## Fully automated (once env vars are set)

| Integration | Env vars | What it does |
|-------------|----------|--------------|
| OmniData engine | `OMNIDATA_BASE_URL`, `OMNIDATA_API_KEY`, `OMNIDATA_SIGNING_SECRET` | SERP, rank, backlinks, crawl — replaces DataForSEO |
| DIY SERP stack | `SERPER_API_KEY`, `BRAVE_SEARCH_API_KEY`, `BING_SEARCH_API_KEY` | Fallback SERP when OmniData unavailable |
| AI visibility | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `PERPLEXITY_API_KEY` | Multi-engine visibility scans |
| Site scrape | `FIRECRAWL_API_KEY` | Schema tool, brand extraction |
| Email | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Audit leads, weekly reports |
| Jobs | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Scans, rescans, guarantee verify |
| Payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price IDs | Subscriptions + guarantee credits |
| App URL | `NEXT_PUBLIC_APP_URL` | Links in emails/reports |

## OAuth — you create the app, we handle the flow

| Provider | You create | Env vars | Console URL |
|----------|-----------|----------|-------------|
| Google (GSC + GA4) | OAuth client | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | https://console.cloud.google.com/apis/credentials |
| Bing Webmaster | App registration | `BING_CLIENT_ID`, `BING_CLIENT_SECRET` | https://www.bing.com/webmasters/ |
| Supabase Auth | Project | `NEXT_PUBLIC_SUPABASE_URL`, keys | https://supabase.com/dashboard |

Redirect URIs must include: `{NEXT_PUBLIC_APP_URL}/api/oauth/callback`

## Manual paste in UI (no OAuth yet)

| Feature | What to paste | Where to get it |
|---------|--------------|-----------------|
| Google Business Profile | Account ID, Location ID, OAuth token | Google Business Profile API |
| WordPress | Site URL, app password | WP Admin → Users → Application Passwords |
| Webflow | API token, collection ID | Webflow project settings |
| Shopify | Store URL, access token | Shopify Admin → Apps |
| Buffer | Access token, channel IDs | https://buffer.com/developers/api |
| Ayrshare | API key, profile key | https://www.ayrshare.com/docs |
| Slack alerts | Incoming webhook URL | Slack app → Incoming Webhooks |

## Infrastructure you deploy

```bash
# OmniData on VPS (recommended for production SERP volume)
cd services/omnidata
docker compose up -d
# Set OMNIDATA_BASE_URL=https://your-vps:8787 in Vercel

# Database migrations
npm run db:migrate
```

## Recommended API budget (monthly)

| Service | Est. cost | Purpose |
|---------|-----------|---------|
| Serper | $50–200 | SERP + AI Overview parsing |
| OpenAI | $100–500 | Visibility + content |
| Firecrawl | $20–100 | Crawl/schema |
| VPS for OmniData | $20–40 | Unlimited internal SERP routing |
| **Total DIY stack** | **~$200–800** | vs DataForSEO $500–2000+ |

## Quick start checklist

- [ ] Supabase project + run `npm run db:migrate`
- [ ] Copy `.env.example` → `.env.local`, fill required keys
- [ ] `npm run dev` — create org + project, run first scan
- [ ] Deploy OmniData: `docs/OMNIDATA_DEPLOY.md`
- [ ] Set `OMNIDATA_BASE_URL` in production
- [ ] Connect Stripe webhook to `/api/webhooks/stripe`
- [ ] Register Inngest app pointing to `/api/inngest`
- [ ] Add Serper + OpenAI keys minimum for live results
- [ ] Connect GSC OAuth for attribution (optional but recommended)

## What still needs your action after Phase 2

1. **GBP OAuth** — connect from Distribution tab (`google_business_profile` provider)
2. **OmniData VPS** — required for keyword intelligence, content gaps, backlink gaps at scale
3. **INTEGRATION_ENCRYPTION_KEY** — before saving CMS credentials in production

## Intelligence Spine (Phase 6 — real data architecture)

How state-of-the-art SEO/AEO platforms operate (reverse-engineered into OmniPresence):

| Layer | What leaders do | OmniPresence implementation |
|-------|-----------------|------------------------------|
| **SERP** | Live Google/Bing results, AI Overviews, PAA | OmniData `serp.js` → Serper/Bing/Brave (no fake fallback) |
| **Keywords** | Autocomplete + volume signals + difficulty | `/api/keywords` + OmniData `keywords.ts`, `keyword-difficulty.ts` |
| **Rank tracking** | Position + SERP features + striking distance | `rank-tracker-service` + weekly cron |
| **Content gaps** | Competitor ranks, you don't | OmniData `content-gaps.ts` → `/api/keywords` action `content_gaps` |
| **Backlink gaps** | Competitor referring domains you lack | OmniData `backlink-gaps.ts` + Common Crawl |
| **AEO metrics** | Share of voice, citation rate, drift | `aeo-metrics.ts` + `/api/intelligence` from live visibility probes |
| **pSEO** | Matrix × real keyword data | pSEO campaigns + keyword research seed |
| **Programmatic** | Location × service × keyword pages | `programmatic-seo.ts` + `matrixCsv` import |

Minimum for **real intelligence** (not demo):
- `OMNIDATA_BASE_URL` + `OMNIDATA_API_KEY` on Vercel
- `SERPER_API_KEY` on OmniData VPS (or Vercel for app-only SERP)
- At least one LLM key for AEO visibility probes
- `npm run db:migrate` through `0015_intelligence.sql`

## Phase 8 — Execution engines (on-page, distribution, authority)

| Feature | Cron / trigger | Manual setup |
|---------|----------------|--------------|
| On-page automation | Daily 02:00 UTC (`daily-on-page-automation`) | `OMNIDATA_BASE_URL` for instant page audit; WordPress app password for apply |
| Internal links | Tuesday 05:00 UTC (`weekly-internal-link-scan`) | Approve in Internal Links tab; WordPress for auto-inject |
| Link building orders | 10th of month 06:00 UTC (`monthly-link-building`) | Backlink snapshots + keyword opportunities feed campaigns |
| Bulk indexing | Manual on Distribution tab | IndexNow key optional; Bing Webmaster OAuth helps |
| Maps/local SERP | OmniData `POST /v3/serp/google/maps/live` | `SERPER_API_KEY` on OmniData VPS |
| Rank history API | OmniData `GET /v3/rank_tracker/history/:key` | Redis on OmniData VPS recommended |
| Community mentions | CSV import on Authority tab | Export from Reddit/Quora monitoring tools |
| Free tools hub | `/tools` — canonical, sitemap, citation, ROI | No auth required (rate limited) |

Open-source report alignment (what we adopted vs skipped):
- **Adopted patterns:** SEOnaut/python-seo-analyzer (in-app on-page agents), Serper places (maps), pSEO matrix (existing), Common Crawl (backlinks), SerpBear-style rank history (Redis)
- **Skipped (stack mismatch):** Scrapy/Crawlee/scrapy-playwright (OmniData crawler), advertools (Python), Apache Superset (use built-in reports), SerpBear/OpenSERP deploy (Serper + OmniData suffice)

Run `npm run db:migrate` through `0016_phase8.sql` for indexing log, link orders, and community mentions tables.

