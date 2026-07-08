# PresenceData OS

**PresenceData OS is a name, not a new system.** Every pillar described below
already existed as an independent, already-tested file before this document
was written (see `src/lib/presence-data/index.ts`'s commit history / Patch G).
This document ties five existing subsystems together behind one map so a
reader can find the whole in-house data platform without already knowing
which of ~8 files owns which concern — it does not describe aspirational
architecture, and every file path below is real and importable today unless
explicitly marked "planned."

Import surface: `@/lib/presence-data` (re-exports only — see that file's
header comment for why existing direct imports of `@/lib/providers/router`
etc. are still correct and don't need to migrate).

## Why this exists

The PresenceOS mission is to minimize dependence on paid third-party SEO
providers (DataForSEO) by building an owned, defensible data platform using
official/free APIs, sovereign engines (OmniData), and honest provenance —
without ever faking a number or claiming a replacement that hasn't been
benchmark-proven. PresenceData OS is the name for the five pillars that make
that possible:

```mermaid
flowchart TB
    subgraph Registry [1. Provider Registry — router.ts]
        Router["rankedAdapters(): free-before-paid, confidence-ranked,\ncircuit-breaker-aware, per-capability adapter selection"]
        Caps["capabilities.ts: provider ids, paid/free flags,\nZero-Paid-Keys + benchmark-only overrides"]
    end
    subgraph Contract [2. Response Contract]
        Env["envelope.ts: Zod ProviderEnvelopeMeta\n(freshness, confidence, response_hash, provider_class, trace_id)"]
        Prov["provenance.ts: 5-value DataQuality spine\n(measured/estimated/model_knowledge/simulated/unavailable)"]
    end
    subgraph Cost [3. Cost / Spend Guards]
        CostGuard["cost-guard.ts: LLM token $ budget"]
        ExtGuard["external-api-guard.ts: DataForSEO/Firecrawl\nper-call + daily/monthly $ budget"]
        CpcCache["keyword-cpc-cache.ts: 30-day TTL cache,\ncancellation-gated fresh lookups (Patch C.1)"]
        Spend[("api_spend_daily")]
    end
    subgraph Evidence [4. Evidence Store]
        Ev["evidence.ts: recordMeasurementEvidence()\nrefuses to persist unavailable/simulated data"]
        MEvidence[("measurement_evidence")]
        AiEvidence[("ai_capture_evidence")]
    end
    subgraph Bench [5. Benchmark Layer — PARTIAL]
        Golden["tests/golden/*.accuracy.test.ts:\nsovereign output vs fixed ground truth"]
        Scorecard["docs/benchmarks/scorecard.json:\nself-reported, sovereign-only"]
        LiveBench["scripts/provider-live-benchmark.mjs:\ncan run sovereign vs paid, no committed schedule yet"]
        BenchDB[("benchmark_runs — planned, see below")]
    end

    Router --> Env
    Env --> Prov
    Router --> CostGuard
    Router --> ExtGuard
    ExtGuard --> CpcCache
    CostGuard --> Spend
    ExtGuard --> Spend
    Router --> Ev
    Ev --> MEvidence
    Env --> AiEvidence
    Router --> Golden
    Golden --> Scorecard
    LiveBench -.->|planned| BenchDB
```

## Pillar 1 — Provider registry

**File**: `src/lib/providers/router.ts` (+ `src/lib/config/capabilities.ts`
for provider/capability metadata).

- `rankedAdapters(capability)` returns every adapter for a capability
  (`serp | crawl | backlinks | generate | email | social | enrich`), sorted
  free-before-paid, then higher-confidence-first, filtered by circuit-breaker
  health, then cheapest.
- `ZERO_PAID_KEYS` mode (`isZeroPaidKeysMode()` in `capabilities.ts`) drops
  every paid adapter from the ranking entirely — verified in CI by
  `scripts/audit-zero-paid-keys.mjs`, which proves every capability still has
  at least one sovereign (free) adapter.
- `describeProviders()` returns the live status of every adapter (usable now
  or not, and why) — this is what powers the Data Trust Center
  (`/api/projects/[id]/trust`).

## Pillar 2 — Response contract & provenance

**Files**: `src/lib/providers/envelope.ts`, `src/lib/engines/provenance.ts`.

- `buildProviderEnvelope()` produces a `ProviderEnvelopeMeta` (Zod-validated):
  `freshness` (`live|recent|cached|none`), `confidence` (0–1), a
  `response_hash` for reproducibility, `provider_class`, and `trace_id`.
- `DataQuality` is the 5-value spine every measured field on the platform
  carries: `measured | estimated | model_knowledge | simulated | unavailable`.
  Enforced at the DB layer by a `CHECK` constraint across 27 tables
  (`supabase/migrations/0068_fix_data_source_constraints.sql`), not just by
  application convention — see `docs/DATA_CONTRACT.md` for the customer-facing
  meaning of each label.

## Pillar 3 — Cost / spend guards

**Files**: `src/lib/providers/cost-guard.ts` (LLM budget),
`src/lib/providers/external-api-guard.ts` (DataForSEO/Firecrawl budget),
`src/lib/providers/keyword-cpc-cache.ts` (CPC cache, Patch C.1).

- Two independent guards exist because they gate two independent kinds of
  spend, both rolling up into the same `api_spend_daily` ledger:
  `assertWithinBudget()`/`recordSpend()` (LLM tokens) and
  `assertWithinExternalApiBudget()`/`recordExternalApiSpend()` (per-call rate
  limit + daily/monthly USD cap on external paid APIs).
- `keyword_cpc_cache` (30-day TTL, `supabase/migrations/0082_keyword_cpc_cache.sql`)
  sits in front of `getRealKeywordCpc()`/`getRealKeywordCpcDetailed()` so a
  cache hit never touches the network, and `gatherReportData()` checks
  cancellation before ever reaching this block — closing the pre-cancellation
  paid-call gap that Patch C.1 fixed.

## Pillar 4 — Evidence store

**File**: `src/lib/engines/evidence.ts`.

- `recordMeasurementEvidence()` writes to `measurement_evidence`;
  `ai_capture_evidence` rows are written by the AI visibility probe pipeline.
  Both are readable via `GET /api/evidence` (project-access-gated — see
  `tests/security/cross-tenant-evidence.test.ts`, Patch E).
- Refuses to write evidence for `unavailable`/`simulated` data quality — a
  pinned test (`src/lib/engines/__tests__/measurement-evidence.test.ts`)
  proves the evidence store cannot be used to launder a fabricated number
  into something that looks measured.

## Pillar 5 — Benchmark layer (honesty note: partial today)

**Files that exist today**: `tests/golden/**/*.accuracy.test.ts` (sovereign
output vs. a fixed ground-truth fixture — proves internal consistency, NOT
parity with a paid vendor), `scripts/provider-superiority.mjs` (structural
registry + golden-dataset presence check, runnable with `--strict`),
`scripts/provider-live-benchmark.mjs` (`npm run benchmark:live` — has the
plumbing to run OmniData and a paid vendor side-by-side on the same query set
when both are configured, but **no committed run has ever done so** — see
`docs/benchmarks/scorecard.json`, where every capability's `"paid"` field is
`null`).

**Not yet built** (tracked as a separate follow-up patch, not part of this
consolidation): a `benchmark_runs` table giving that live-comparison harness
a durable, queryable history instead of only file-based JSON snapshots, and a
scheduled nightly cron that actually runs it. Until that lands and has
accumulated ≥30 days of passing data per capability, **no claim that OmniData
replaces DataForSEO for any capability is true**, and `router.ts` must not be
changed to reflect one. This is the enforcement gate the plan calls "Patch J"
— it is evidence-gated, not date-gated.

## What NOT to do with this module

- Do not add new detection/scoring/cost logic to `src/lib/presence-data/`.
  If a pillar needs a new capability, add it to the real owning file (e.g.
  `router.ts`) and it will be visible here automatically via the re-export.
- Do not require existing call sites to migrate their imports to
  `@/lib/presence-data`. This module is for discoverability and for new code
  that wants the whole surface at a glance, not a mandatory funnel.
- Do not describe the benchmark pillar as complete in customer-facing copy
  until it has a `benchmark_runs` table with ≥30 days of real comparisons
  meeting the thresholds in this repo's PresenceData OS plan (Section 9).
