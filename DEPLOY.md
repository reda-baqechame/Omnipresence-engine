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
supabase/migrations/0002_audit_leads.sql
supabase/migrations/0003_org_notifications.sql
supabase/migrations/0004_rls_hardening.sql
supabase/migrations/0005_webhook_events.sql
supabase/migrations/0006_storage_reports.sql
supabase/migrations/0007_directory_submissions.sql
supabase/migrations/0008_free_access.sql
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

### Required environment variables

Copy from `.env.example`. Minimum for a working deploy:

| Variable | Notes |
|----------|-------|
| `NEXT_PUBLIC_APP_URL` | `https://your-domain.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | From Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only — never expose to client |
| `OAUTH_STATE_SECRET` | Random 32+ character string |

For full functionality, also set: `INNGEST_*`, `RESEND_*`, AI provider keys, `DATAFORSEO_*`, `PERPLEXITY_API_KEY`, `FIRECRAWL_API_KEY`.

**Free access mode** (default): `FREE_ACCESS_MODE=true` unlocks all features with no billing. Stripe keys are optional.

**Demo mode** activates when `OPENAI_API_KEY`, `DATAFORSEO_LOGIN`, and `PERPLEXITY_API_KEY` are all unset — useful for staging without API costs.

## 3. Stripe

1. Create products/prices for Audit ($199 one-time), Tracking ($299/mo), Agency ($999/mo)
2. Set `STRIPE_PRICE_AUDIT`, `STRIPE_PRICE_TRACKING`, `STRIPE_PRICE_AGENCY`
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
- **Weekly rescan** — Mondays (paid plans)
- **Weekly email report** — Fridays 9:00 UTC
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
- [ ] Stripe checkout upgrades plan
- [ ] Inngest functions visible in dashboard

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Health shows `supabase: error` | Check `SUPABASE_SERVICE_ROLE_KEY` and migrations |
| Scans stuck on "scanning" | Set `INNGEST_EVENT_KEY` or rely on sync fallback (`after()`) |
| OAuth fails | Set `OAUTH_STATE_SECRET` and verify redirect URI |
| 402 on project create | Upgrade plan or increase `api_credit_limit` |
| Leads page empty | Run migration `0004` — admin-only RLS |
