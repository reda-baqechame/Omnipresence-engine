# OmniPresence Engine — Phase 10: Real Results, Real Data, Autonomous Finish

Phase 10 converts the remaining **heuristic/stub** data points into **real measured
data**, gates the guarantee on real KPI movement, hardens the OmniData data engine
for deployment, and documents an autonomous finish loop.

The guiding principle is honesty: open-source/free data first, cheap APIs as a
reliability fallback, and every data point labeled `real` vs `estimated`. We never
promise a specific ChatGPT rank — the guarantee stays on the **measured aggregate
delta + deterministic deliverables**.

## What was real vs. heuristic before Phase 10

| Signal | Before | After Phase 10 |
|--------|--------|----------------|
| Backlinks | `link:` operator / own-page CDX, invented rank | Common Crawl webgraph referring domains + real OpenPageRank DR; `link:` only as labeled `estimated` fallback |
| Keyword volume / CPC | autocomplete heuristic | Google Ads Keyword Planner (real), heuristic kept but stamped `estimated` |
| SERP/Maps without API key | empty | keyless Playwright fallback (env-gated), labeled `playwright` |
| Community mentions | CSV import only | real Reddit API + Quora SERP |
| Local listings | draft text only | real Google Business verification via Serper Places + Apple manual status |
| Guarantee | KPI compare only | real Tier-2 KPI delta + Tier-1 deterministic deliverables + ledger evidence |

## Tasks (see `docs/BUILD_MANIFEST.json` v10)

### 1. `cc-webgraph-backlinks` — Real backlinks
- `services/omnidata/src/engines/webgraph.ts`: Common Crawl Host/Domain Web Graph
  ingested into a DuckDB index (optional `@duckdb/node-api`), querying true inbound
  edges → real referring domains. Ingest once via `npm run webgraph:ingest -- <release>`.
- `backlinks.ts` uses the webgraph for referring domains + batched OpenPageRank for
  real per-domain DR; deprecated `link:` is fallback-only with `data_source:"estimated"`.
- `src/lib/providers/backlinks-free.ts` prefers the real index, flags `estimated` rows.
- Real DR flows into `link-building.ts` via each backlink's `domain_rank`.
- **Acceptance:** `GET /v3/backlinks/webgraph/status` reports readiness; backlinks
  return real referring domains once ingested.

### 2. `keyword-planner-real` — Real volume/CPC
- `services/omnidata/src/engines/keyword-planner.ts`: Google Ads Keyword Planner
  (OAuth) → real `avg_monthly_searches`, CPC, competition; chunked to 1000/call.
- `keywords.ts` upgrades suggestions/related with real metrics when configured
  (`data_source:"keyword_planner"`), else `estimated`.
- `getRealKeywordCpc` (app) feeds `ads-equivalent.ts` (`cpcSource:"real"`).
- **Acceptance:** `/v3/keywords/metrics/live` returns real metrics when OAuth set.

### 3. `serp-scrape-fallback` — Keyless SERP/Maps
- `services/omnidata/src/engines/scrape.ts`: Playwright (Chromium) Google SERP +
  local results, OFF by default (`OMNIDATA_ENABLE_SCRAPE=true`).
- Wired as the last fallback in `serp.ts`/`maps-serp.ts`; `source:"playwright"`.
- Removed aspirational `simulated` source label.

### 4. `community-local-real` — Community + local
- `community-mentions.ts`: real Reddit API (read-only OAuth) + Quora via SERP;
  CSV import retained and labeled `import`.
- `api/community` POST `action:"fetch_live"` persists deduped real mentions.
- `local-listings.ts` `verifyLocalPresence` confirms Google Business via Serper
  Places; Bing/Apple reported as manual (no public lookup API).

### 5. `guarantee-real-loop` — Guarantee on real movement
- `guarantee.ts`: `gatherTier1Deliverables` (from AEO readiness levers) +
  `gatherLedgerEvidence` (completed `results_ledger`); `verifyGuaranteeContract`
  records Tier-1 status + evidence alongside the real Tier-2 KPI delta.
- Cron (`inngest/functions.ts`) computes Tier-2 KPIs from real scores/visibility +
  AI referrals and passes Tier-1 + evidence.

### 6. `tech-probes` — Technical depth
- `technical-audit.ts`: JS-render audit (raw vs rendered word ratio),
  Perplexity-User live bot check, Apple Business Connect manual status.

### 7. `aeo-parity-extras` — Parity features
- `authority-finder.ts`: HARO/journalist source-request finder (SERP) +
  `buildOutreachSequence` (3-touch CRM cadence).
- `attribution.ts` + attribution page: first/last/linear/position-based models.
- `blog-pipeline.ts`: `generateFeaturedImage` (OpenAI Images) + `translateContent`
  / `generateMultiLanguageVersions`.
- `programmatic-seo.ts`: matrices up to `PSEO_MAX_PAGES=10000` + `selectPagesToRefresh`
  from real per-page GSC performance (`gsc-queries.fetchGscPagePerformance`).

### 8. `omnidata-deploy` — Deploy the data engine
- Hardened `Dockerfile` (optional Chromium, prod prune, `/data` volume),
  `docker-compose.yml` (persistent DuckDB volume + healthchecks), `fly.toml`,
  `railway.json`, shared `dfsResponse` envelope, and `omnidata:parity` test.
- **You provision:** a host (Fly/Railway/VPS) + Redis. **Then wire:**
  `OMNIDATA_BASE_URL` / `OMNIDATA_API_KEY` / `OMNIDATA_SIGNING_SECRET` and verify via
  `/api/health` + `npm run audit:live`.

### 9. `phase10-loop` — Autonomous finish
- This spec + manifest v10 + `omnipresence-loop` skill pointing at v10.

## You provision (cannot be automated); the engine wires the rest
- Host for `services/omnidata` (Fly.io / Railway / VPS) + Redis.
- Google Ads developer token + OAuth client (free) — real keyword volume/CPC.
- Reddit API app credentials — real community mentions.
- OpenPageRank API key (free tier) — real DR.
- Optional: proxy pool (only if enabling Playwright scrape at scale).

## Verification gates
- `npm run verify:all`
- OmniData changes: `npm run omnidata:test` + `npm run omnidata:parity`
- Final: `npm run production:ready` + live `npm run audit:full` showing real
  (non-empty) backlinks/keywords/SERP once the host + keys exist.

## Notes / decisions
- Single TS stack: webgraph via DuckDB instead of a Python/Spark sidecar.
- Scraping stays off by default behind an env flag (ToS/fragility); cheap APIs are
  the reliable default.
- DuckDB (`@duckdb/node-api`) is an optional dependency; the service builds and runs
  without it (backlinks degrade to labeled `estimated`).
