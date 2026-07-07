# Commercialization Flip — Enable Paid Access

**Do not set `FREE_ACCESS_MODE=false` in production until every step below passes.**

While `FREE_ACCESS_MODE=true` (default), all plans and API credits are unlimited. Billing UI shows **Coming soon** on checkout buttons.

## Gate

Run the commercialization gate locally or in CI:

```bash
npm run commercialization:gate
```

Optional strict claims audit:

```bash
CLAIMS_STRICT=1 npm run commercialization:gate
# or
npm run commercialization:gate -- --claims-strict
```

The gate runs:

1. `verify:all` — full CI parity (tests, typecheck, lint, build)
2. `railway:verify` — app + OmniData health
3. `webgraph:verify` with `WEBGRAPH_REQUIRE_FULL=1` (full Common Crawl ingest required)
4. `check:claims-backed` with `CLAIMS_STRICT_PROD=1` — **optional locally**, enforced in Production Gate CI

Measured claims must be backed (11/11). `attribution_proof` is `first_party_when_connected` and passes strict when it is the only unbacked claim.

## Staging billing E2E

Complete [BILLING.md](./BILLING.md) on a staging stack with `FREE_ACCESS_MODE=false` and Stripe test keys.

## Production env changes (ordered)

1. **Stripe live keys** — `STRIPE_SECRET_KEY`, webhook secret, live price IDs.
2. **Set credit defaults** — ensure new orgs get `free` tier limits (register/setup-org routes); paid tiers via webhook only.
3. **Flip access mode** — set `FREE_ACCESS_MODE=false` on Vercel production (and Railway if mirrored).
4. **Redeploy** — trigger production deploy; confirm `/api/health` shows billing checks.
5. **Smoke billing** — one internal org completes live checkout (refund immediately if test).
6. **Monitor** — watch Stripe webhook logs + `api_usage` inserts for 24h.

## Rollback

If checkout or credit enforcement misbehaves:

1. Set `FREE_ACCESS_MODE=true` on production (immediate unlimited access restore).
2. Redeploy.
3. Pause Stripe live checkout links in dashboard if needed.

No code revert required — the flag is the kill switch.

## Post-flip UI

- `/app/settings/billing` shows active checkout + portal buttons (non-free mode branch).
- Usage page reflects real `api_credit_limit` from `getApiUsageSummary`.

## Checklist

### Production-ready (gates green — free mode stays on)

- [x] Production Gate: `verify:all` + `railway:verify` + `production:ready` green on `main`
- [x] `WEBGRAPH_REQUIRE_FULL=1` — full webgraph ingested (~1.68B edges)
- [x] Supabase migrations through 0075 applied on production
- [x] Live production readiness 100% (`npm run verify:prod:live`)
- [x] `npm run commercialization:gate` green (without local `CLAIMS_STRICT=1` unless `.env.providers` loaded)
- [x] Claims strict in CI: 11/11 measured + optional attribution connector claim
- [x] Tenant isolation tests in `verify:all`
- [x] Distributed rate limiting via OmniData Railway Redis (Upstash optional)

### Before billing flip (do not set `FREE_ACCESS_MODE=false` yet)

- [ ] SLO cron — 7 consecutive daily runs with 0 breaches (`SLACK_ALERT_WEBHOOK_URL` on Vercel)
- [ ] Staging Stripe E2E documented in [BILLING.md](./BILLING.md) completed
- [ ] Manual agency walkthrough — domain → scan → report → evidence in <15 min
- [ ] Pricing design session → update `plans/limits.ts` and agencies page
- [ ] SOC gaps reviewed (`COMPLIANCE_GAPS.md`)
- [ ] Backup drill within last quarter (`BACKUP_RESTORE.md`)
- [ ] `FREE_ACCESS_MODE=false` set in production env
- [ ] Internal smoke checkout + refund
- [ ] Customer comms / pricing page updated
