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

## Verification & ship gates

- Every iteration: `npm run verify:all` (now includes `claims-benchmark`) and
  `npm run omnidata:parity` when `services/omnidata` changes.
- Keyless guarantee: `npm run audit:zero-paid-keys`.
- Final: `npm run production:ready` → `npm run audit:live` (real keys) →
  `npm run audit:zero-paid-keys`.

## New environment variables

See `.env.example`. Highlights: `ZERO_PAID_KEYS`, `AI_UI_CAPTURE_URL` /
`ENABLE_AI_UI_CAPTURE`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` +
`SMTP_DKIM_*`, `OMNIDATA_PROXIES`, `SEARXNG_URLS`, `OLLAMA_BASE_URL`,
`X_ACCESS_TOKEN`, `LINKEDIN_ACCESS_TOKEN`/`LINKEDIN_AUTHOR_URN`.
