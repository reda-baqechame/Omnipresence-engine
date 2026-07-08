/**
 * PresenceData OS — single documented import surface.
 *
 * Patch G (PresenceData OS consolidation): the five pillars this module
 * exposes — provider registry, response envelope/provenance, cost/spend
 * guards, evidence store, and capability config — already exist as
 * independent, already-tested files scattered across `src/lib/providers/`,
 * `src/lib/engines/`, and `src/lib/config/`. This file does NOT introduce a
 * parallel system, duplicate logic, or rename anything (rule: "do not
 * duplicate existing OmniData architecture, improve it"). It is purely a
 * named re-export surface so a caller (or a new engineer) can discover the
 * whole in-house data platform from one import instead of having to already
 * know which of ~8 files owns which concern.
 *
 * Existing call sites are NOT required to migrate to this import path —
 * importing `@/lib/providers/router` directly remains correct and is what
 * most of the codebase still does. This module exists for NEW code and for
 * documentation/discoverability, not as a mandatory funnel.
 *
 * See docs/PRESENCEDATA_OS.md for the architecture this surface documents.
 */

// Pillar 1 — Provider registry: capability adapters (serp/crawl/backlinks/
// generate/email/social/enrich), free-before-paid ranking, circuit-breaker
// health, Zero-Paid-Keys mode.
export * as router from "@/lib/providers/router";

// Pillar 1b — Capability/provider configuration the router depends on
// (which provider ids exist, which are paid, Zero-Paid-Keys / benchmark-only
// overrides, and the human-readable capability summary the Trust Center reads).
export * as capabilities from "@/lib/config/capabilities";

// Pillar 2 — Response contract: the Zod envelope every provider adapter can
// attach (freshness, confidence, response_hash, provider_class, trace_id).
export * as envelope from "@/lib/providers/envelope";

// Pillar 2b — Provenance spine: the 5-value DataQuality label
// (measured|estimated|model_knowledge|simulated|unavailable) enforced by a
// DB CHECK constraint across 27 tables, plus the helpers that classify it.
export * as provenance from "@/lib/engines/provenance";

// Pillar 3 — Cost/spend guards. Two independent guards exist because they
// gate two independent kinds of spend: cost-guard.ts caps LLM token spend,
// external-api-guard.ts caps DataForSEO/Firecrawl per-call + daily/monthly
// USD spend. Both write into the same api_spend_daily ledger.
export * as costGuard from "@/lib/providers/cost-guard";
export * as externalApiGuard from "@/lib/providers/external-api-guard";

// Pillar 3b — Keyword CPC cache (Patch C.1): a 30-day TTL cache in front of
// getRealKeywordCpc()/getRealKeywordCpcDetailed(), closing the "every report
// re-fetches CPC fresh" cost/latency gap called out in the PresenceData OS
// plan (Section 4) and gating fresh lookups behind cancellation checks.
export * as keywordCpcCache from "@/lib/providers/keyword-cpc-cache";

// Pillar 4 — Evidence store: measurement_evidence / ai_capture_evidence
// writers. Refuses to persist evidence for unavailable/simulated data so the
// evidence store itself can never launder a fabricated number into something
// that looks measured.
export * as evidence from "@/lib/engines/evidence";

/**
 * Pillar 5 — Benchmark layer.
 *
 * NOT yet re-exported here: there is no importable `benchmark` module yet.
 * Today this pillar is two standalone scripts —
 * `scripts/provider-superiority.mjs` (structural/registry + golden-dataset
 * check) and `scripts/provider-live-benchmark.mjs` (capable of running
 * OmniData vs. a configured paid vendor side-by-side, but with no committed
 * scheduled run) — plus the self-reported `docs/benchmarks/scorecard.json`.
 * The in-progress follow-up patch adds a `benchmark_runs` table and a
 * nightly Inngest cron so this pillar has a real, importable surface and a
 * durable history instead of only file-based JSON snapshots; this export
 * block will be filled in then. Do not claim this pillar is "done" before
 * that lands — see docs/PRESENCEDATA_OS.md's honesty note.
 */
