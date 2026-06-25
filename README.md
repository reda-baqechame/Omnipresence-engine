# PresenceOS — OmniPresence Engine

The Organic Visibility Engine that helps businesses get discovered, cited, mentioned, and recommended across Google, AI chatbots, social platforms, directories, and communities.

## Features

### Phase 1 — Audit Engine (MVP)
- **OmniPresence Score** — Weighted composite of 8 visibility sub-scores
- **Technical Readiness Audit** — robots.txt, sitemap, schema, AI bot access, on-page SEO
- **Brand Intelligence Extraction** — AI-powered brand profile from website
- **Prompt Universe Generator** — 100+ buyer-intent prompts across 10 categories
- **AI/Search Visibility Scanner** — ChatGPT, Perplexity, Gemini, Claude, Google AI Overview
- **Platform Coverage Checker** — 15+ social, directory, review, and local platforms
- **Authority Opportunity Finder** — Competitor backlink gaps, listicles, podcasts
- **90-Day Execution Roadmap** — Prioritized by revenue impact
- **White-Label PDF Reports** — Shareable audit reports

### Phase 2 — Tracking Engine
- Monthly automated re-scans via Inngest cron
- Competitor movement and citation tracking
- Historical trend charts and MoM deltas
- Weekly email + Slack summaries

### Phase 3 — Content Domination Engine
- Brand-aware content generators (18 asset types)
- Anti-spam guardrails and human-review workflow
- Distribution status board

### Phase 4 — Distribution Engine
- CMS publishing integrations (WordPress, Webflow, Shopify)
- Social scheduling (Ayrshare/Buffer) and IndexNow bulk indexing
- Local listing drafts (GBP, Bing Places, Apple Business Connect)

### Phase 5 — Authority & Outreach Engine
- Backlink/listicle/podcast opportunity finders
- Outreach CRM with AI-generated emails

### Phase 6 — Attribution Engine
- GSC / Bing / GA4 / Plausible connectors
- AI-referral tracking and paid-ads-equivalent calculator

## Tech Stack

- **Frontend:** Next.js 16, TypeScript, Tailwind CSS 4
- **Database:** Supabase (Postgres + RLS + Auth + Storage)
- **Jobs:** Inngest (durable background processing)
- **Payments:** Stripe
- **AI:** Vercel AI SDK + OpenAI / Gemini / Claude
- **Data:** Serper / Brave Search (SERP), Perplexity, direct LLM APIs, Firecrawl. DataForSEO optional fallback.
- **Analytics:** PostHog
- **Deploy:** Vercel

## Getting Started

```bash
npm install
cp .env.example .env.local
# Fill in your API keys (see .env.example)

npm run dev
```

## Database Migrations

Apply migrations in order in your Supabase SQL editor (or via Supabase CLI):

| Migration | Purpose |
|-----------|---------|
| `0001_init.sql` | Core schema + RLS |
| `0002_audit_leads.sql` | Public audit lead capture |
| `0003_org_notifications.sql` | Slack webhook + notification prefs |
| `0004_rls_hardening.sql` | Tighter audit leads + OAuth policies |
| `0005_webhook_events.sql` | Stripe webhook idempotency |
| `0006_storage_reports.sql` | Public `reports` storage bucket |
| `0007_directory_submissions.sql` | Directory submission status tracking |
| `0008_free_access.sql` | Remove API credit caps on organizations |

After migrations, enable **Email auth** in Supabase and configure redirect URLs for your app domain.

## Environment Variables

See `.env.example` for the full list. Production-critical vars:

| Variable | Required for |
|----------|--------------|
| `NEXT_PUBLIC_SUPABASE_*` | Auth + database |
| `SUPABASE_SERVICE_ROLE_KEY` | Background jobs, webhooks |
| `OAUTH_STATE_SECRET` | Google/Bing OAuth (32+ char random) |
| `STRIPE_*` | Billing + webhooks |
| `INNGEST_*` | Background scans + reports |
| `RESEND_*` | Email reports + lead nurture |
| `SERPER_API_KEY` or `BRAVE_SEARCH_API_KEY` | Google SERP + rankings (DIY stack) |
| `PERPLEXITY_API_KEY` | AI citations with real URLs |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Direct LLM visibility |

Demo mode activates when no live providers are configured — technical audits still run against real domains.

Validate your DIY stack: `npm run wire:diy`

## Security

- Multi-tenant isolation via Supabase RLS
- Project-scoped API access (`verifyProjectAccess`)
- SSRF guards on public domain/URL inputs
- Rate limiting on public audit + free tools
- Signed OAuth state (HMAC + expiry)
- Per-tenant API credit metering
- Security headers (X-Frame-Options, nosniff, etc.)

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── app/                # Authenticated dashboard
│   ├── api/                # API routes
│   ├── tools/              # Free public tools
│   └── report/             # Shareable reports
├── components/             # UI components
├── lib/
│   ├── engines/            # Core business logic
│   ├── providers/          # External API adapters
│   ├── security/           # Auth guards, rate limits, SSRF
│   ├── scoring/            # OmniPresence Score formulas
│   ├── inngest/            # Background job functions
│   └── supabase/           # Database clients
└── types/                  # TypeScript types
```

## Production Deploy (Vercel)

See **[DEPLOY.md](./DEPLOY.md)** for the full step-by-step guide.

Quick verify after deploy:

```bash
npm run smoke -- https://your-domain.com
```

## Pricing

**Currently free** — all features are unlocked for every account (unlimited projects, full scans, white-label, content, attribution). Set `FREE_ACCESS_MODE=false` in env to re-enable paid plans later.

## License

Private — All rights reserved.
