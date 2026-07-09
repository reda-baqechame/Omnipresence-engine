# Live RLS operator checklist (Phase 3)

The integration test `tests/security/rls-live-integration.test.ts` **skips safely** unless a dedicated non-production Supabase project is configured. This checklist is the operational work required for real proof.

## Status

| Item | Status |
|------|--------|
| Test scaffold + production URL blocklist | Done (`rls-live-guard.ts`) |
| Dedicated test Supabase project | **Operator action required** |
| Opt-in env vars set | **Operator action required** |
| Live proof executed | Pending credentials |

## Steps for Reda / ops

1. Create Supabase project named e.g. `omnipresence-test` (never production).  
2. Apply migrations through at least `0084_report_quality_violations.sql`.  
3. Set env (local or CI secret store — **not** default CI):

```bash
export SUPABASE_TEST_URL="https://<test-ref>.supabase.co"
export SUPABASE_TEST_ANON_KEY="..."
export SUPABASE_TEST_SERVICE_ROLE_KEY="..."
export SUPABASE_TEST_ALLOW_LIVE_RLS=1
export SUPABASE_TEST_CONFIRM_NON_PROD=1
export SUPABASE_TEST_ENV=staging
```

4. Run:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --experimental-strip-types \
  --import ./tests/_lib/register-loader.mjs \
  --test tests/security/rls-live-integration.test.ts
```

5. If any cross-tenant SELECT succeeds → **stop all feature work** and fix RLS policies.

Full detail: `docs/audits/live-rls-test-setup.md`.
