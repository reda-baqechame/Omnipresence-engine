# Report-quality flag rollout (Phase 4)

Feature flags (default **off** — no customer-facing change until enabled):

| Flag | Effect |
|------|--------|
| `REPORT_QUALITY_SANITIZE=1` | Strip/sanitize unsupported measured claims in report output |
| `REPORT_QUALITY_BLOCK_CRITICAL=1` | Block report finalize when critical quality violations exist |

## Rollout sequence

1. **Staging sanitize only** — set `REPORT_QUALITY_SANITIZE=1`. Leave block off.  
2. Monitor `report_quality_violations` via `/api/admin/report-quality-violations` (admin auth).  
3. Fix false positives in gate/sanitizer.  
4. **Staging block** — set `REPORT_QUALITY_BLOCK_CRITICAL=1`.  
5. Promote both flags to production only when false-positive rate is acceptable.  
6. Never enable block in production without sanitize first.

## Operator checklist

```bash
# Staging (Vercel preview / staging project)
REPORT_QUALITY_SANITIZE=1
# later:
REPORT_QUALITY_BLOCK_CRITICAL=1
```

Documented in `.env.example`. Code: `src/lib/engines/report-quality-flags.ts`.

## Staging enablement (Proof & Verification sprint)

Do **not** invent production readiness by flipping prod flags. Sequence:

1. Apply migrations through `0085_gsc_query_snapshots` on the staging Supabase project.
2. Run `node scripts/check-staging-proof-readiness.mjs` (warnings for missing secrets are expected).
3. On **staging only**, set `REPORT_QUALITY_SANITIZE=1`. Leave block off.
4. Generate reports; inspect `report_quality_violations` / admin route.
5. When false positives are acceptable, set `REPORT_QUALITY_BLOCK_CRITICAL=1` on staging.
6. Promote to production only after staging evidence — never enable block without sanitize.

`check-staging-proof-readiness.mjs` fails if block is on without sanitize.
