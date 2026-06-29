# OmniPresence Phase 24 — Sovereign 200x Machine

Manifest: `v24.0.0`. This phase closes the last blueprint-parity gaps and adds a
**Sovereign Provider Layer** so the platform runs the full Discover → Build →
Find gaps → Execute → Measure → Prove loop with **no paid vendor as a hard
dependency**. Everything is built to be honest by construction: every metric
carries provenance, and the claims harness refuses to advertise anything that
isn't actually backed by measured data.

## Two tracks, one loop

1. **Blueprint parity (Waves A–F)** — Source/Citation Graph, Merchant/Product AI
   visibility, grounded AI UI capture, unified War Room / Proof Ledger / agency
   cockpit, daily snapshots + data-quality scoring, and the claims/benchmark
   harness with a deterministic-only refund shield.
2. **Provider sovereignty (Waves H–L)** — a unified provider router, a sovereign
   data layer (keyless SERP, Common Crawl authority, Playwright crawl), a
   sovereign AI layer (Ollama-first generation with quality gates), sovereign
   comms + enrichment (SMTP, direct social, free IP→org), and a verified
   Zero-Paid-Keys mode.

## What we beat the vendors on (and what we don't)

- **We win:** cost (keyless/self-hosted), transparency (source + confidence +
  freshness + method on every value via `provenance.ts`), market-specific source
  graphs, and execution+proof integration (vendors stop at data; we close the
  loop).
- **We never fake:** Keyword Planner *volume precision* (Trends-extrapolated
  buckets + confidence instead) and measuring the *real commercial*
  ChatGPT/Perplexity (only the AI UI-capture service or a paid API can do this —
  open models measure a weaker, clearly-labeled thing).

## Wave summary

| Wave | Capability | Key files |
|------|------------|-----------|
| A | Source/Citation Graph | `src/lib/engines/source-graph.ts`, `/api/source-graph`, `source-graph-panel.tsx`, `0048_source_graph.sql` |
| B | Merchant/Product AI visibility | `src/lib/engines/product-visibility.ts`, `0049_product_visibility.sql`, `merchant-panel.tsx` |
| C | Grounded AI UI capture | `services/ai-ui-capture/*`, `visibility-scanner.ts` (`grounding_mode=ui_capture`) |
| D | Unified dashboards | `war-room/page.tsx`, `proof-ledger-panel.tsx`, agency cockpit `app/page.tsx`, `src/lib/time.ts` |
| E | Snapshots + data quality | `src/lib/engines/snapshots.ts`, `0050_snapshots.sql`, `daily-snapshots` cron |
| F | Claims + benchmark harness | `src/lib/config/claims.{json,ts}`, `scripts/benchmark.mjs`, `guarantee.ts` refund shield |
| H | Provider router | `src/lib/providers/router.ts`, `serp-router.ts` (delegates), `ZERO_PAID_KEYS` |
| I | Sovereign data | proxy pool + multi-SearXNG + Common Crawl `getDomainAuthority` |
| J | Sovereign AI | `src/lib/providers/generate-router.ts` (Ollama-first + quality gates) |
| K | Sovereign comms/enrichment | `src/lib/email/transport.ts` (SMTP/DKIM), `social/direct.ts`, free IP→ASN enrichment |
| L | Zero-Paid-Keys mode | zero-paid-aware claim gates, `scripts/audit-zero-paid-keys.mjs` |
| M | Docs + manifest + ship | this spec, `BUILD_MANIFEST.json` v24, loop skill, `.env.example` |

## Provider router

`src/lib/providers/router.ts` exposes a capability port — `serp`, `crawl`,
`backlinks`, `generate`, `email`, `social`, `enrich`. Each capability has ranked
adapters; ordering is **self-hosted/free first, paid optional**, then by
confidence, health (fewer recent failures), and cost. `route()` does
auto-failover and records health; `ZERO_PAID_KEYS=true` drops every paid adapter
so only sovereign engines run. `describeProviders()` and
`zeroPaidKeysReadiness()` are surfaced on `/api/capabilities`.

## Claims harness + refund shield

`claims.json` is the single source of truth (read by both the app and
`scripts/benchmark.mjs`). Each claim maps to a capability gate; the UI only
advertises backed claims (`getBackedClaims`/`canRenderClaim`), and a
forbidden-claim guard blocks outcome promises. The benchmark runs inside
`verify:all` (offline/zero-paid safe) and as `--strict` for the keyed audit. The
guarantee is **deterministic-only**: refund eligibility derives purely from
controllable deliverables we auto-evidence from the results ledger — never
rankings.

## Phase 24.1 — executable ports + superiority proof

- **Crawl + backlinks are now executable through the router.**
  `src/lib/providers/capability-runners.ts` attaches sovereign-first runners
  (keyless fetch crawler before Firecrawl; Common Crawl webgraph before
  DataForSEO) and exposes `crawlContent(url)` / `fetchBacklinks(domain)` with the
  same failover + health as `serp`/`generate`.
- **`compareCapabilities()`** (router) returns, per capability, the best
  sovereign vs paid adapter with cost/confidence/freshness — surfaced on
  `/api/capabilities` and asserted by `npm run audit:superiority`.
- **Honest "outperform" scope:** the sovereign adapters win on cost (free),
  provenance, freshness and integration (e.g. free DR-style authority on
  backlinks, inline AEO passages on crawl, gated generation). We do **not** claim
  to beat paid indexes on raw breadth — the claims harness forbids it.
- **Live measured proof:** `/api/admin/provider-benchmark` (bearer-guarded,
  no service client) runs the real engines; `npm run benchmark:live` prints a
  sovereign-vs-paid report and writes dated evidence to `docs/benchmarks/`.
  Measured with the keyless stack (SearXNG up, no paid keys):
  - **Crawl** — real page in ~370ms: 7,399 words, 336 AEO passages, 16 headings,
    schema, at **$0**.
  - **SERP** — **~20 real organic results via SearXNG in ~1s at $0/query**
    through the sovereign router.
  - **Generate** — sovereign **Ollama (llama3.2:1b) PASSED the editorial +
    structural-AEO quality gates** (AEO 50, 80 words) at **$0**; weaker output is
    honestly flagged `degraded` and would auto-upgrade to a paid LLM if a key
    were set (the gate, not marketing, decides).
  - **Backlinks / authority** — real keyless **domain authority** resolves live
    (e.g. wikipedia.org = **79/100, Tranco rank 29, $0**) via Tranco -> rank.to,
    and is folded into every referring-domain row as free DR (the concrete win
    over DataForSEO/Ahrefs, which bill for it). The full referring-domains *list*
    still needs a webgraph index (the one genuine data dependency), but the
    capability delivers professional authority intelligence at $0 right now.
  All 4 capabilities now return real data live + keyless at $0. The
  referring-domains list is the only provisioning-bound (data ingestion) item.
  Bring up the keyless stack with `docker compose --profile keyless up`
  (SearXNG + Ollama + LanguageTool) to light up SERP + generation locally.
- **No dead adapters:** every *enabled* adapter in the router has an executable
  runner (crawl/backlinks/enrich/email/social via `capability-runners.ts`,
  generate via `generate-router.ts`); `route()` skips any without one. The
  misleading single-page `omnidata-crawl` entry was removed.

### Phase 24.2 — claims honesty hardening (refund protection)

- **Claim split (no overclaim):** the old `backlink_intelligence` claim was
  advertised with `requires: ["always"]`, i.e. it promised "referring domains"
  even with no index. It is now split into two honest claims: `domain_authority`
  (keyless Tranco/rank.to, **always backed** — we deliver 0-100 DR at $0) and
  `backlink_intelligence` (the referring-domains *list*, gated on a real index
  via `backlinksIndex` → OmniData web graph or DataForSEO). With no index the
  referring-domains claim auto-hides instead of becoming a promise we can't keep.
- **Generation honesty gate:** `evaluateQuality` now hard-fails any generated
  copy containing a forbidden outcome promise (rank #1, guaranteed traffic,
  "appear everywhere in AI"). Forbidden output is never returned — not even as a
  `degraded` fallback — so the engine cannot auto-publish a claim we refuse to make.
- Both the runtime registry (`claims.ts`) and the offline harness
  (`benchmark.mjs`) share the same capability keys, kept in sync.

### Phase 24.3 — Common Crawl moat, quality-first generation, native social

- **Real backlink/authority moat (Common Crawl webgraph).** OmniData now exposes
  `POST /v3/domain/authority/live` returning harmonic-centrality authority (0-100)
  + the true distinct referring-domain count straight from the ingested webgraph.
  Backlink rows score DR from Common Crawl first (`getDomainAuthorityBatch`, one
  SQL pass), falling back to OpenPageRank only for uncovered hosts, and surface a
  `dr_source` (`commoncrawl`/`openpagerank`/`none`). The main app prefers this CC
  authority ahead of Tranco/rank.to in `resolveDomainAuthority` and threads the
  real referring-domain count + provenance through `authority-rating.ts`. This is
  the genuine referring-domains *list* dependency from 24.1, now closed: after a
  one-time `npm run webgraph:ingest`, backlinks deliver real referring domains at
  $0, re-ingested monthly by the `monthly-webgraph-reingest` cron
  (`COMMONCRAWL_WEBGRAPH_RELEASE`). DuckDB load is sanity-checked at image build.
- **Quality-first generation.** When paid frontier-LLM keys are present, the
  generate router tries them BEFORE the open model so customer-facing copy uses
  the best model (`GENERATION_SOVEREIGN_FIRST=true` flips back to free-Ollama-first
  as a cost lever; `ZERO_PAID_KEYS` forces sovereign-only). `generateStructured`
  is now provider-agnostic (OpenAI → Anthropic → Google) instead of OpenAI-only.
- **Native social auto-posting.** Approved + scheduled `linkedin_post`/`x_thread`
  assets post directly via the platform APIs in `processScheduledContent` — the
  `status="approved"` filter is the human gate, unconfigured platforms queue for
  manual posting, and nothing is faked. `LINKEDIN_AUTHOR_URN` is now required
  alongside the LinkedIn token (router + capability checks).
- **Router truth-up.** Dead catalog entries with no runner (Buffer/Ayrshare
  social, standalone Clearbit enrich) were removed; `resend-email` gained a real
  runner so email routes on Resend-only deploys; `hasSerpCapability()` now counts
  SearXNG/OmniData so health/setup stop under-reporting keyless SERP.

## Verification & ship gates

- Every iteration: `npm run verify:all` (now includes `claims-benchmark`) and
  `npm run omnidata:parity` when `services/omnidata` changes.
- Keyless guarantee: `npm run audit:zero-paid-keys`.
- Superiority proof: `npm run audit:superiority`.
- Final: `npm run production:ready` → `npm run audit:live` (real keys) →
  `npm run audit:zero-paid-keys`.

## New environment variables

See `.env.example`. Highlights: `ZERO_PAID_KEYS`, `GENERATION_SOVEREIGN_FIRST`,
`COMMONCRAWL_WEBGRAPH_RELEASE`, `AI_UI_CAPTURE_URL` / `ENABLE_AI_UI_CAPTURE`,
`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` + `SMTP_DKIM_*`,
`OMNIDATA_PROXIES`, `SEARXNG_URLS`, `OLLAMA_BASE_URL`, `X_ACCESS_TOKEN`,
`LINKEDIN_ACCESS_TOKEN`/`LINKEDIN_AUTHOR_URN`.
