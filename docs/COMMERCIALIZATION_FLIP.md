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
3. `webgraph:verify` with `WEBGRAPH_REQUIRE_FULL=0` (auth OK; full CC ingest tracked separately)
4. `check:claims-backed` with `CLAIMS_STRICT_PROD=1` — **optional**, only when `CLAIMS_STRICT=1`

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

- [ ] `commercialization:gate` green
- [ ] Staging Stripe E2E documented in BILLING.md completed
- [ ] SOC gaps reviewed (`COMPLIANCE_GAPS.md`)
- [ ] Backup drill within last quarter (`BACKUP_RESTORE.md`)
- [ ] `FREE_ACCESS_MODE=false` set in production env
- [ ] Internal smoke checkout + refund
- [ ] Customer comms / pricing page updated
