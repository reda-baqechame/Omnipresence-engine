# Manual-only mode — operator checklist

> **Status 2026-07-17: automation RE-ENABLED.** `MANUAL_ONLY_MODE=false` is set
> on Vercel (production + preview), Inngest re-synced with the full function set
> (crons included), and the weekly Production Gate + nightly benchmark schedules
> are restored. Idle spend is bounded by the LLM cost guard ($5/day, $50/mo),
> the paid external-API guard ($10/day, $150/mo), per-tenant observation caps,
> the shared probe cache, and UI-capture sampling. The checklist below is kept
> for when someone needs to flip manual-only back ON.

After deploying code with `MANUAL_ONLY_MODE=true`, complete these steps so idle API spend stays near zero.

## Already done in this change

- GitHub scheduled workflows disabled (`benchmark-live`, `production-gate` weekly cron)
- Code: `MANUAL_ONLY_MODE` flag, Inngest registry split, `asset/deployed` skip
- Env set on **Vercel** (production + preview): `MANUAL_ONLY_MODE=true`, `SCAN_TRIGGER_MODE=inngest`
- Env set on **Railway** app service `omnipresence-engine`: same two vars
- **Vercel production deployed** with the new code (`https://omnipresence-engine.vercel.app`)
- Railway: `MANUAL_ONLY_MODE` / `SCAN_TRIGGER_MODE` env vars are set. A full Railway image redeploy may still fail until `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, and `OAUTH_STATE_SECRET` are present on that service (pre-existing gap). **Inngest should sync to the Vercel URL**, which already has the manual-only build.

## You must do once (cannot be automated from here)

### 1. Pause Inngest crons (immediate — do this now)

1. Open [Inngest dashboard](https://app.inngest.com) → PresenceOS / your app
2. **Functions** → pause or cancel every **cron** function, including:
   - `weekly-rescan`, `monthly-rescan`
   - `nightly-provider-benchmark`, `daily-rank-check`, `weekly-rank-check`
   - `ops-queue-drain`, `deploy-verification-sweep`, `scheduled-content-publish`
   - `daily-brand-news-monitor`, `daily-freshness-check`, `weekly-panel-run`
   - and any other schedule-triggered function
3. Leave **event** functions enabled: `run-full-scan`, `generate-report`, `panel-run-requested`, `ops-execute-requested`, `sync-attribution`, `geo-rewrite-loop`

### 2. Re-sync Inngest against production

1. Inngest → **Apps** → Sync / redeploy against your production URL (Vercel: `https://omnipresence-engine.vercel.app/api/inngest`)
2. Confirm only ~7 event handlers remain registered; cron schedules should drop after sync

### 3. Verify after 24–48h idle

- [ ] Inngest: no cron runs; only event runs when you click buttons
- [ ] App → Settings → Usage: flat spend on days you did not use the app
- [ ] OpenAI / Serper / Firecrawl dashboards: no Mon/nightly spikes
- [ ] Smoke: Rescan, Generate report, Run panel each work once
- [ ] Settings → Setup / production readiness shows "Manual-only: event handlers…"

## Rollback

Set `MANUAL_ONLY_MODE=false` on Vercel + Railway, redeploy, re-sync Inngest.
