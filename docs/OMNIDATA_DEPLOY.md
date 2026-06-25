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
| `OPENPAGERANK_API_KEY` | Optional | Domain rank for backlinks |

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
- `POST /v3/backlinks/summary/live`
- `POST /v3/keywords/suggestions/live`
- `POST /v3/rank_tracker/check/live`
- `POST /v3/on_page/crawl` — multi-page technical crawl

## VPS sizing

- Minimum: 1 vCPU, 2GB RAM, Redis
- Recommended: 2 vCPU, 4GB RAM for Playwright pool (future)

## Compliance

Official APIs (Bing, Serper, Brave) are tried first. Headless scraping is fallback-only with rate limits.
