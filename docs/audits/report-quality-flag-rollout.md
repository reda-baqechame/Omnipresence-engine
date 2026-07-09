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
