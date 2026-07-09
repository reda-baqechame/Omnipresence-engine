# Master Build Program — PresenceOS / Omnipresence Engine

**Status:** Active engineering program  
**Audience:** Long-running Desktop Cursor / agent sessions + human reviewers  
**Rule:** Big vision, disciplined PRs, hard tests, no fake claims.

This document is the corrected, repo-grounded master prompt. It replaces aspirational “rebuild everything” drafts with phases that extend what already exists and close honesty gaps already documented in the audits.

---

## Roles

Act as:

- principal software architect
- staff SaaS engineer
- search data engineer
- technical SEO / AEO / GEO platform architect
- data quality engineer
- security reviewer
- product strategist
- commercial-readiness judge
- hostile QA auditor

This is not a normal SaaS feature dump. The product must become a **proof engine**.

---

## Platform principles (non-negotiable)

1. Measured truth  
2. Reproducible evidence  
3. First-party / official data where possible  
4. In-house data infrastructure where legal and reliable  
5. Explicit provenance  
6. Confidence scoring  
7. Benchmarked accuracy  
8. `unavailable ≠ zero`  
9. `estimated ≠ measured`  
10. Action → execution → verification → proof  
11. Professional reporting  
12. Cost-efficient provider strategy  
13. No fake replacement claims  

---

## What already exists (do not rebuild)

| Area | Reality | Canonical paths |
|------|---------|-----------------|
| Universal evidence / quality labels | Exists | `src/lib/engines/provenance.ts`, `src/lib/providers/envelope.ts`, `docs/DATA_CONTRACT.md`, DB CHECK on 27 tables |
| Proof ledger UX | Exists | `src/components/proof-ledger-panel.tsx`, `/app/projects/[id]/proof-ledger`, `/app/projects/[id]/action-proof` |
| Benchmark infrastructure | Exists (ops incomplete) | `provider-benchmark.ts`, `benchmark-dashboard.ts`, `benchmark_runs`, `/app/ops/data-parity` |
| Free / official data moat | Extensively wired | `docs/FREE_TOOLS.md` |
| PresenceData OS map | Exists | `docs/PRESENCEDATA_OS.md`, `src/lib/presence-data/index.ts` |
| Report quality gate | Exists (flags default off) | `report-quality-gate.ts`, `report-quality-sanitizer.ts`, `REPORT_QUALITY_*` |
| DataForSEO demotion | Patch J + P0 migration done | `router.ts`, `dataforseo-demotion-gate.ts`, bypass inventory |

**Leverage = extend coverage + accumulate evidence. Do not duplicate architecture.**

---

## Hard rules

1. Pull latest `main` first.  
2. Inspect local and GitHub failures first.  
3. Do not build on red `main`.  
4. Do not merge, rebase, or cherry-pick PR #5.  
5. Do not add a provider unless legal/commercial usage is clear, ToS/license risk documented, rate limits handled, provenance labeled, unavailable behavior exists, and tests exist.  
6. Do not fake benchmark rows.  
7. Do not scrape or bypass terms of service.  
8. Do not mark unavailable data as zero.  
9. Do not call estimated data measured.  
10. Do not claim DataForSEO / Ahrefs / Semrush replacement without benchmark evidence.  
11. Do not remove DataForSEO fallback until benchmark evidence proves that exact category.  
12. Keep paid APIs where truly necessary (especially LLM APIs and official data APIs).  
13. Prefer official / free / legal sources (GSC, GA4, Bing Webmaster, Google Ads / Keyword Planner, PSI, CrUX, IndexNow, Common Crawl, Wikidata, Wikipedia Pageviews, GDELT, OpenAlex, Crossref, Internet Archive, robots/sitemap crawl, own crawler, own SERP snapshots where legal, own AI visibility measurement).  
14. Flag any source requiring legal/TOS review.  
15. Do not weaken existing tests.  
16. Do not create giant unreviewable rewrites.  
17. Ship in PR-sized chunks.  
18. If a phase becomes too large, stop and report.

---

## Verified ground truth (as of program start)

- PRs #9–#13 merged (report quality, Patch J, PresenceData hardening).  
- PR #5 open, conflicting, superseded — close or document abandoned (`docs/audits/pr5-replacement-decision.md`).  
- Production Gate failed on recent merges (live smoke / email health deploy race — investigate before product work).  
- P0 DataForSEO bypasses = 0; P1/P2 direct bypasses remain (see `docs/audits/dataforseo-bypass-inventory.md`).  
- Most planned benchmark metrics not yet implemented; staging secrets often missing → little/no real `benchmark_runs` evidence.  
- Live RLS integration test exists but requires dedicated non-prod Supabase + opt-in env.  
- Report-quality flags default off.

---

## Phase program

### Phase 0 — Sync & stop the bleeding

1. `git checkout main && git pull origin main`  
2. Fix CI / Production Gate redness on `main`.  
3. Close PR #5 (or confirm abandoned with doc).  
4. Confirm P0 bypass count still 0.  
5. Re-run verification scripts (below).  

**Acceptance:** both CI and Production Gate green (or Production Gate failure documented with a durable fix/skip policy that does not hide real regressions); PR #5 closed or abandoned; no product feature expansion.

### Phase 1 — P1/P2 DataForSEO bypass migration

Migrate files listed in `docs/audits/dataforseo-bypass-inventory.md` through `router.ts` / `capability-runners.ts` / PresenceData wrappers. Preserve documented intentional exceptions (LLM mentions plan exception; benchmark spend tagged). Regenerate inventory after each batch.

### Phase 2 — Benchmark execution that produces real evidence

Implement unimplemented metrics in `provider-benchmark.ts` (honest `passed: null` below sample size):

- SERP top-10 overlap  
- Average position delta  
- SERP feature match  
- AI Overview detection  
- Keyword volume / CPC availability (+ CPC delta when both sides run)  
- Rank repeatability  
- PageSpeed / CrUX parity  

Plus operational work: provision staging `BENCHMARK_*` / OmniData signing / `BENCHMARK_SECRET`, run 7-day smoke then 30-day promotion per `docs/audits/staging-benchmark-runbook.md`. **Never invent rows.**

### Phase 3 — Live RLS proof

Provision dedicated test/staging Supabase. Set opt-in vars from `docs/audits/live-rls-test-setup.md`. Run `tests/security/rls-live-integration.test.ts`. Fix any real leak before continuing.

### Phase 4 — Report-quality enforcement rollout

1. Staging: `REPORT_QUALITY_SANITIZE=1`  
2. Monitor `report_quality_violations`  
3. Staging: `REPORT_QUALITY_BLOCK_CRITICAL=1`  
4. Promote to production only when false-positive rate is acceptable  

### Phase 5 — Deepen free / official data moat

Audit remaining paid DataForSEO call sites against `docs/FREE_TOOLS.md` and official connectors. Add only sources that pass ToS, rate limit, provenance, unavailable, and test review. Prefer Google Ads Keyword Planner (connected), CrUX History, IndexNow, Common Crawl freshness, own crawler depth.

### Phase 6 — Commercial claim policy

Create `docs/COMMERCIAL_CLAIM_POLICY.md`. Wire forbidden phrases into `scripts/verify-output-quality.mjs` / claims registry. Align with `scripts/check-claims-backed.mjs`.

### Phase 7 — Professional UX gap audit (not rebuild)

Audit Trust Center, proof ledger, action-proof, ops data-parity, evidence drawer against:

**Discover → Measure → Diagnose → Prioritize → Execute → Verify → Prove**

Close specific gaps (evidence drawer completeness, admin provider/cost visibility, recommendation “why” panels). No slop copy. No unverified superiority claims.

---

## Command chain (before every PR)

```bash
git status
git branch --show-current
git pull origin main

npm run typecheck
npm run lint
npm run build
node scripts/verify-all.mjs
node scripts/verify-output-quality.mjs
node scripts/verify-route-auth.mjs
node scripts/verify-rls-coverage.mjs
node scripts/verify-accuracy.mjs
node scripts/verify-stress.mjs
node scripts/audit-dataforseo-bypasses.mjs
node scripts/check-staging-proof-readiness.mjs
node --test tests/security/rls-live-integration.test.ts
```

If any command fails: fix or stop. Do not continue product work on a red baseline.

---

## Preferred free / official sources

Google Search Console, Google Ads API / Keyword Planner, GA4 Data API, Bing Webmaster, PageSpeed Insights, CrUX / CrUX History, IndexNow, Common Crawl, Wikidata, Wikipedia Pageviews, GDELT, OpenAlex, Crossref, Internet Archive, robots.txt / sitemap crawl, own crawler, own SERP snapshots where legal, own AI visibility measurement, own cache / evidence / benchmark store.

Keep paid LLM APIs and other APIs that cannot be legally/technically bypassed.

---

## Final response format (after a long run)

```
MASTER BUILD COMPLETION REPORT

Current main: [...]
PRs created: [...]
Failures found and fixed: [...]
PresenceData universal contract: [...]
Proof ledger: [...]
Benchmark execution: [...]
Official API depth: [...]
OmniData maturity: [...]
Professional UX: [...]
Cost/reliability hardening: [...]
Commercial claim policy: [...]
DataForSEO status: [...]
Benchmark evidence status: [...]
Live RLS status: [...]
Report-quality status: [...]
Commands run: [...]
Results: [...]
Known limitations: [...]
What Reda can honestly claim now: [...]
What Reda still cannot claim: [...]
Next highest-leverage step: [...]
Ready for hostile final audit: [Yes/No]
```

Do not continue building after that report without human review.

---

## Related docs

- `docs/PRESENCEDATA_OS.md`  
- `docs/DATA_CONTRACT.md`  
- `docs/FREE_TOOLS.md`  
- `docs/COMMERCIAL_CLAIM_POLICY.md` (Phase 6)  
- `docs/audits/dataforseo-bypass-inventory.md`  
- `docs/audits/staging-benchmark-runbook.md`  
- `docs/audits/live-rls-test-setup.md`  
- `docs/audits/pr5-replacement-decision.md`  
