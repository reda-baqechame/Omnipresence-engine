# Commercial Claim Policy

**Purpose:** Define exactly what PresenceOS / Omnipresence Engine may claim in product UI, marketing, sales, and reports — and what is forbidden until real evidence exists.

**Enforcement:** Static phrases are guarded by `scripts/verify-output-quality.mjs` and `scripts/benchmark.mjs` / `scripts/check-claims-backed.mjs`. Runtime report claims are gated by `report-quality-gate.ts` (flags default off until staged rollout).

---

## Allowed (only when true)

| Claim | Condition |
|-------|-----------|
| Evidence-backed AI visibility measurement | Probes return real LLM/SERP responses with provenance |
| First-party GSC / GA4 / Bing reporting when connected | OAuth connected and sync succeeded; otherwise unavailable |
| Data provenance and confidence labels | `DataQuality` + envelope fields present on customer metrics |
| Benchmark infrastructure for provider comparison | `benchmark_runs` + `/app/ops/data-parity` exist |
| In-house technical crawling | OmniData / fetch-crawl sovereign path |
| DataForSEO fallback paths are demoted behind router/guards | Patch J `fallback_only` / `benchmark_only` in `router.ts` |
| Benchmark evidence collection in progress | Staging cron producing real rows; no promotion claim |

## Forbidden unless benchmark evidence exists

Do **not** state or imply any of the following until `promotionReady` / 30 consecutive UTC days of `passed === true` for the relevant capability/metric **and** human review:

- We replaced DataForSEO
- Better than Ahrefs
- Better than Semrush
- Most accurate SEO platform
- Commercial-grade backlink replacement
- Benchmark-proven provider parity
- 30-day proven replacement
- OmniData replaces DataForSEO (any capability)
- Industry standard / market leader (as a measured accuracy claim)

## Honesty rules (always)

1. `unavailable ≠ 0`
2. `estimated ≠ measured`
3. `passed = null` never counts as a pass
4. No synthetic `passed=true` benchmark rows
5. No customer-facing claim without evidence or an explicit unavailable state

## Related

- `docs/DATA_CONTRACT.md`
- `docs/MASTER_BUILD_PROGRAM.md`
- `docs/audits/staging-benchmark-runbook.md`
- `docs/FREE_TOOLS.md`
