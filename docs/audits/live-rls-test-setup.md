# Live RLS integration test setup

This document explains how to run `tests/security/rls-live-integration.test.ts` safely against a **dedicated test or staging Supabase project** — never production.

---

## Why this exists

Patch E cross-tenant tests (`tests/security/cross-tenant-*.test.ts`) exercise **real route handlers** but use **mocked Supabase clients**. They prove route-level access checks work when mocks enforce isolation, but they **do not prove** live Postgres RLS policies block cross-tenant reads.

This live integration scaffold closes that gap when a test Supabase project is available.

---

## Safety requirements (mandatory)

The test file refuses to run unless **all** of the following are true:

| Guard | Purpose |
|-------|---------|
| `SUPABASE_TEST_URL` set | Points to test/staging project |
| `SUPABASE_TEST_ANON_KEY` set | Anon key for user-scoped clients |
| `SUPABASE_TEST_SERVICE_ROLE_KEY` set | Service role for setup/teardown only |
| `SUPABASE_TEST_ALLOW_LIVE_RLS=1` set | Explicit opt-in — prevents accidental CI runs |
| `SUPABASE_TEST_CONFIRM_NON_PROD=1` set | Second explicit confirmation — not production |
| Safe environment marker (one of) | `SUPABASE_TEST_ENV=staging` or `test`, OR `SUPABASE_TEST_PROJECT_REF` matching URL, OR `SUPABASE_TEST_URL_CONFIRM=I_UNDERSTAND_THIS_IS_NOT_PRODUCTION` |
| URL blocklist | Rejects URLs containing `prod`, `production`, `live`, or `primary`; also blocks when test URL matches a production-looking `NEXT_PUBLIC_SUPABASE_URL` |

**Never set these variables to production credentials.**

Recommended: create a Supabase project named `omnipresence-test` or use a staging branch database isolated from customer data.

---

## Required environment variables

```bash
# Dedicated test project only
export SUPABASE_TEST_URL="https://<test-ref>.supabase.co"
export SUPABASE_TEST_ANON_KEY="eyJ..."
export SUPABASE_TEST_SERVICE_ROLE_KEY="eyJ..."

# Explicit opt-in
export SUPABASE_TEST_ALLOW_LIVE_RLS=1
export SUPABASE_TEST_CONFIRM_NON_PROD=1

# Safe environment marker (pick one approach)
export SUPABASE_TEST_ENV=staging
# OR: export SUPABASE_TEST_PROJECT_REF="<test-ref>"
# OR: export SUPABASE_TEST_URL_CONFIRM=I_UNDERSTAND_THIS_IS_NOT_PRODUCTION

# Optional: pre-created test users (skips auth.admin user creation)
export SUPABASE_TEST_USER_A_EMAIL="rls-test-a@example.test"
export SUPABASE_TEST_USER_A_PASSWORD="..."
export SUPABASE_TEST_USER_B_EMAIL="rls-test-b@example.test"
export SUPABASE_TEST_USER_B_PASSWORD="..."
```

If user email/password pairs are omitted, the test attempts to create ephemeral users via the service-role Auth Admin API and deletes them during teardown.

---

## Database prerequisites

1. Apply all migrations through `0083_benchmark_runs.sql` on the test project:
   ```bash
   npm run db:migrate
   ```
   (with test project's `DATABASE_URL` / Supabase connection configured)

2. Tables exercised by the scaffold:
   - `organizations`
   - `memberships`
   - `projects`
   - `reports`
   - `visibility_runs`
   - `measurement_evidence` (if insert path available)

3. RLS must be **enabled** on tenant tables (verified by `scripts/verify-rls-coverage.mjs` on migration files).

---

## Running the test

```bash
# From repo root — will SKIP if env not configured (safe default)
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --experimental-strip-types \
  --import ./tests/_lib/register-loader.mjs \
  --test tests/security/rls-live-integration.test.ts
```

Expected outcomes:

| Environment | Result |
|-------------|--------|
| No test env vars | All tests **skipped** with explicit reason |
| Test env configured | Creates Org A/B, projects, report rows; proves User B cannot `SELECT` Org A rows via anon client |
| Partial setup failure | Skip with TODO explaining missing prerequisite |

---

## What the test proves (when not skipped)

1. **Service role** can insert setup rows (orgs, projects, reports).
2. **User A's authenticated client** can read Org A project rows.
3. **User B's authenticated client** cannot read Org A project/report rows (RLS or equivalent policy blocks).
4. **Cleanup** removes all rows created by the test run.

---

## What it does not prove

- Every table's RLS policy (only scaffold tables).
- Route-level auth (covered by Patch E mocks).
- Write/update/delete cross-tenant attempts (future extension).
- Production deployment configuration.

---

## CI guidance

**Do not** add live RLS credentials to default CI. Keep the test skipped in CI unless a dedicated test Supabase secret store is provisioned.

When skipped, CI remains green — the skip message must be explicit (implemented in the test file).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| All tests skipped | Set all four required env vars including `SUPABASE_TEST_ALLOW_LIVE_RLS=1` |
| "Refusing to run against production URL" | Use a dedicated test project URL |
| Auth user creation fails | Pre-create users and set `SUPABASE_TEST_USER_*` email/password |
| RLS leak detected (test fails) | **Stop** — fix migration policies before continuing feature work |

---

## Related documents

- `docs/audits/dataforseo-bypass-inventory.md` — provider bypass audit
- `docs/audits/staging-benchmark-runbook.md` — benchmark evidence accumulation
- `tests/security/cross-tenant-*.test.ts` — mock-level route isolation tests (Patch E)
