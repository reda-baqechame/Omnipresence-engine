# Staging benchmark runbook

**Purpose:** Accumulate **real** `benchmark_runs` evidence in a staging environment before any DataForSEO replacement or OmniData parity claim is made to customers or in marketing copy.

**Rule:** No customer-facing DataForSEO replacement claim is allowed until `benchmark_runs` contains real consecutive pass evidence. `promotionReady` must remain `false` until the configured consecutive-day threshold is reached. **`passed = null` must never count as a pass.**

---

## Prerequisites

### 1. Migrations applied (staging Supabase)

Confirm these migrations exist and are applied on staging:

| Migration | Table / purpose |
|-----------|-----------------|
| `0082_keyword_cpc_cache.sql` | `keyword_cpc_cache` — CPC cache (Patch C.1) |
| `0083_benchmark_runs.sql` | `benchmark_runs` — nightly benchmark persistence (Patch H) |

```bash
npm run db:migrate:plan   # dry-run — review SQL
npm run db:migrate        # apply against staging DATABASE_URL
```

Verify:
```sql
SELECT COUNT(*) FROM benchmark_runs;  -- may be 0 initially; table must exist
```

### 2. Required environment variables

| Variable | Purpose |
|----------|---------|
| `BENCHMARK_URLS` | Comma-separated URLs for crawl benchmark (e.g. `https://en.wikipedia.org/wiki/SEO`) |
| `BENCHMARK_DOMAINS` | Comma-separated domains for backlink benchmark (e.g. `wikipedia.org`) |
| `BENCHMARK_QUERIES` | Comma-separated SERP queries (e.g. `what is search engine optimization`) |
| `OMNIDATA_BASE_URL` | Sovereign data service base URL |
| `OMNIDATA_API_KEY` | OmniData auth |
| `OMNIDATA_SIGNING_SECRET` | Request signing (if enabled) |
| `DATAFORSEO_LOGIN` | Paid fallback for side-by-side comparison only |
| `DATAFORSEO_PASSWORD` | Paid fallback credentials |
| `BENCHMARK_SECRET` | Bearer token for `/api/admin/benchmark-runs` (optional if using owner/admin session) |

**Staging-only:** Do not point benchmark cron at production customer traffic budgets without isolating spend tags (known gap: shared `external-api-guard` budget).

### 3. Inngest function registered

Confirm `nightlyProviderBenchmark` is exported in `src/lib/inngest/functions.ts`:

- Cron: `0 2 * * *` (02:00 UTC daily)
- Function id: `nightly-provider-benchmark`
- Calls `runProviderBenchmark()` → `persistBenchmarkRun()`

Manual trigger (staging):
- Use Inngest dashboard to invoke `nightly-provider-benchmark` once.
- Or run locally: `npm run benchmark:live` (writes JSON only — does **not** persist to `benchmark_runs` unless wired separately).

### 4. Admin surfaces protected

| Surface | Guard |
|---------|-------|
| `GET /api/admin/benchmark-runs` | `isPlatformAdminAuthorized(request, "BENCHMARK_SECRET")` |
| `/app/ops/data-parity` | Fetches admin route; requires owner/admin org membership |

Verify unauthorized access returns 401.

---

## 7-day smoke benchmark process

**Goal:** Confirm the pipeline works end-to-end before committing to a 30-day promotion window.

### Day 0 — Setup verification

1. Apply migrations (above).
2. Set all env vars on staging.
3. Manually trigger one benchmark run.
4. Query:
   ```sql
   SELECT capability, metric_name, passed, threshold_note, run_at
   FROM benchmark_runs
   ORDER BY run_at DESC
   LIMIT 20;
   ```
5. Open `/app/ops/data-parity` — confirm groups render, `dataForSeoCategoryViolations` is `[]`.

### Days 1–7 — Daily collection

Each day for 7 consecutive days:

1. Ensure nightly cron fires (or manual trigger at consistent UTC time).
2. Record row count inserted per run.
3. Check dashboard:
   - `consecutivePassDays` for each metric
   - `promotionReady` — **must stay `false`** during smoke week unless you intentionally configured a lower threshold for testing
   - Any `passed: null` rows — document as **not evaluated**, not pass
4. Log failures honestly — do not delete failed rows.

### Day 7 — Smoke acceptance

| Check | Pass criteria |
|-------|---------------|
| Cron reliability | ≥6 of 7 days produced rows (1 miss acceptable for infra debugging) |
| Failure rate metric | `passed` is `true` or `false`, never coerced from `null` |
| Cost metric | Sovereign cost ≤ paid when both sides ran |
| Patch J invariant | `dataForSeoCategoryViolations: []` on admin route |
| No fake rows | Every row traceable to `runProviderBenchmark()` output |

If smoke fails, **fix infra** — do not fabricate rows.

---

## 30-day promotion evidence process

**Goal:** Satisfy Patch J / Section 9 bar for considering further DataForSEO demotion review.

### Configuration

- `PROMOTION_STREAK_DAYS = 30` (in `benchmark-dashboard.ts`)
- `MIN_SAMPLES_FOR_STATISTICAL_PASS = 10` (in `benchmark-writer.ts`) — failure-rate `passed` stays `null` below 10 samples

### Daily checklist (days 8–37)

1. Cron ran and inserted rows.
2. Expand `BENCHMARK_URLS` / `DOMAINS` / `QUERIES` lists toward ≥10 samples per capability (required for statistical failure-rate pass).
3. Monitor `/app/ops/data-parity`:
   - **Consecutive pass days** increment only on days where `passed === true`
   - A single `passed === false` day resets streak to 0
   - A `passed === null` day resets streak (not evaluated = not pass)
   - Same-day re-runs collapse to latest row per UTC day

### Promotion readiness (informational only)

`evidenceSupportsFurtherDemotion: true` means:

- Every tracked metric for that capability has `promotionReady: true` (30 consecutive UTC days of `passed: true`)
- A human must still review before any router.ts change
- **This does not auto-demote or remove DataForSEO**

---

## Benchmark acceptance table

Metrics from PresenceData OS plan Section 9. **Bold** = derived today by `benchmark-writer.ts`. Others require extending `provider-benchmark.ts` (not fabricated in writer).

| Metric | Derived today? | Pass threshold (plan) | `benchmark_runs` metric_name | Notes |
|--------|---------------|----------------------|------------------------------|-------|
| SERP top-10 overlap | No | ≥ 80% | — | Requires SERP overlap in `provider-benchmark.ts` |
| Position delta | No | ≤ 2 avg | — | Not implemented |
| SERP feature match | No | ≥ 70% | — | Not implemented |
| AI Overview detection | No | TBD | — | Not implemented |
| Keyword volume availability | No | ≥ 70% when Ads connected | — | Not implemented |
| CPC availability | No | ≥ 70% | — | Not implemented |
| CPC delta | No | median ≤ 25% | — | Not implemented |
| Rank repeatability | No | ≥ 90% | — | Not implemented |
| Backlink referring-domain correlation | **Proxy only** | ≥ 0.65 | `backlink_referring_domain_overlap` | Set overlap ≠ Spearman correlation — labeled in `threshold_note` |
| **Failure rate** | **Yes** | ≤ 5% | `failure_rate` | `passed: null` if n < 10 |
| **Cost per successful result** | **Yes** | sovereign ≤ paid | `cost_per_successful_result` | Requires paid side to run |
| PageSpeed/CrUX parity | No | TBD | — | Not implemented |

---

## Forbidden claims during benchmark accumulation

Do **not** state or imply:

- "OmniData replaces DataForSEO" (any capability)
- "Benchmark-proven parity" (until 30-day streak + human review)
- "Promotion-ready" (while `promotionReady` is false)
- That `passed: null` means "passing" or "neutral"

Allowed:

- "Benchmark infrastructure is deployed; evidence collection in progress"
- "Patch J registry invariant holds (`fallback_only` adapters)"
- Per-metric honest status from `/app/ops/data-parity`

---

## Commands reference

```bash
# Live benchmark (JSON output, manual)
npm run benchmark:live

# Full verification (includes all gates)
node scripts/verify-all.mjs

# DataForSEO bypass inventory (non-blocking)
node scripts/audit-dataforseo-bypasses.mjs

# Admin API (staging)
curl -H "Authorization: Bearer $BENCHMARK_SECRET" \
  "https://<staging-host>/api/admin/benchmark-runs?lookbackDays=45"
```

---

## Related documents

- `docs/PRESENCEDATA_OS.md` — architecture and honesty notes
- `docs/audits/dataforseo-bypass-inventory.md` — direct bypass paths Patch J does not cover
- `docs/audits/patch-f-report-wide-quality-gate-plan.md` — report quality (separate from benchmark)
