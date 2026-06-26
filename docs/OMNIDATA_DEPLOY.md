# OmniData Engine — Deploy Guide

Self-hosted DataForSEO-compatible data engine for PresenceOS.

## Quick start (Docker)

```bash
cd services/omnidata
cp .env.example .env   # set API keys
docker compose up -d
curl http://localhost:8787/health
```

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `OMNIDATA_API_KEY` | Yes | Bearer token for API auth |
| `OMNIDATA_SIGNING_SECRET` | Recommended | HMAC signing between app and engine |
| `REDIS_URL` | Yes (prod) | `redis://redis:6379` in Docker |
| `SERPER_API_KEY` | One of SERP | Primary SERP source |
| `BING_SEARCH_API_KEY` | One of SERP | Bing Web Search API |
| `BRAVE_SEARCH_API_KEY` | One of SERP | Brave Search fallback |
| `OPENPAGERANK_API_KEY` | Optional | Real 0-100 domain rating for backlinks |
| `WEBGRAPH_DB_PATH` | Optional | DuckDB path for the Common Crawl webgraph index (default `/data/webgraph.duckdb`) |
| `OMNIDATA_ENABLE_SCRAPE` | Optional | `true` enables the keyless Playwright SERP/Maps fallback (off by default) |
| `GOOGLE_ADS_DEVELOPER_TOKEN` + `GOOGLE_ADS_CLIENT_ID/SECRET` + `GOOGLE_ADS_REFRESH_TOKEN` + `GOOGLE_ADS_CUSTOMER_ID` | Optional | Real keyword volume/CPC via the Keyword Planner API |

## Real backlinks — Common Crawl webgraph index

Backlinks use the Common Crawl Host/Domain Web Graph for real referring domains
(not the deprecated `link:` operator). Build the index once per crawl release on
the host (needs the optional `@duckdb/node-api` dependency + several GB disk):

```bash
# inside the container or host
npm run webgraph:ingest -- <crawl-release-id>   # e.g. cc-main-2024-aug-sep-oct
```

Find release ids at https://commoncrawl.org/web-graphs. Until the index is built,
backlinks fall back to OpenPageRank DR + an "estimated" `link:` result, clearly
labeled `data_source`. Check readiness: `GET /v3/backlinks/webgraph/status`.

## Deploy targets

- **Docker Compose** (above) — Redis + engine + worker + persistent `/data` volume.
- **Fly.io** — `fly launch --copy-config`, `fly volumes create omnidata_data --size 20`, set secrets, `fly deploy` (see `fly.toml`).
- **Railway** — Dockerfile build with `/health` healthcheck (see `railway.json`); attach a Redis plugin and a volume mounted at `/data`.

To enable the keyless scrape fallback, build with Chromium:
`docker build --build-arg INSTALL_CHROMIUM=true .` and set `OMNIDATA_ENABLE_SCRAPE=true`.

## Wire PresenceOS

```env
OMNIDATA_BASE_URL=http://your-vps:8787
OMNIDATA_API_KEY=your-secret-key
OMNIDATA_SIGNING_SECRET=shared-hmac-secret
```

The app provider at `src/lib/providers/dataforseo.ts` routes to OmniData when `OMNIDATA_BASE_URL` is set.

## Endpoints (DataForSEO-compatible)

- `POST /v3/serp/google/organic/live/advanced` — live SERP
- `POST /v3/serp/google/organic/task_post` — async SERP
- `GET /v3/serp/google/organic/tasks_ready`
- `POST /v3/serp/google/organic/task_get/:id`
- `POST /v3/backlinks/summary/live` — real referring domains (webgraph) + DR
- `GET /v3/backlinks/webgraph/status` — whether the webgraph index is built
- `POST /v3/keywords/suggestions/live`
- `POST /v3/keywords/metrics/live` — real volume/CPC (Keyword Planner)
- `POST /v3/rank_tracker/check/live`
- `POST /v3/on_page/crawl` — multi-page technical crawl
- `POST /v3/keywords/trends/live` — keyless Google Trends demand index + related/rising (Phase 11)
- `POST /v3/tech/detect` — best-effort tech-stack fingerprint (Phase 11)
- `POST /v3/domain/popularity/live` — relative Popularity Index, not absolute traffic (Phase 11)

## VPS sizing

- Minimum: 1 vCPU, 2GB RAM, Redis
- Recommended: 2 vCPU, 4GB RAM (and 20GB+ disk for the webgraph index / Playwright)

## Tests

- `npm run omnidata:test` — engine unit tests
- `npm run omnidata:parity` — DataForSEO response-shape parity (offline)

## Compliance

Official APIs (Bing, Serper, Brave) are tried first. Headless scraping is
fallback-only, env-gated (`OMNIDATA_ENABLE_SCRAPE`), and rate-limited.
