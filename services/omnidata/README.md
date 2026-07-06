# OmniData Service

Self-hosted sovereign data spine for PresenceOS: SERP scrape, Common Crawl webgraph authority, PageSpeed/CrUX proxy, and keyword difficulty — all behind one signed HTTP API.

## Layout

```
services/omnidata/
  src/           Express API + DuckDB indexes
  package.json   webgraph:ingest CLI
```

## Capacity ceiling (honest limits)

OmniData uses a **single DuckDB file** per deployment volume (`/data`). Practical limits:

| Resource | Ceiling |
|----------|---------|
| Webgraph index | ~50–80GB disk per CC-MAIN release |
| Concurrent queries | Bounded by Railway CPU/RAM — not horizontally sharded |
| DuckDB connections | One writer; readers share the same file |

**Do not promise horizontal sharding** until multiple OmniData instances with partitioned domains are implemented. Scale vertically (larger volume + RAM) or partition by capability (separate SERP vs webgraph services).

## Scripts

```bash
npm run webgraph:ingest -- --release CC-MAIN-2025-18
```

> Note: root docs previously referenced `npm run ingest:webgraph` — the actual script name is **`webgraph:ingest`**.

## Environment

| Variable | Purpose |
|----------|---------|
| `OMNIDATA_API_KEY` | HMAC signing secret for Vercel → OmniData |
| `PORT` | HTTP port (default 8787) |
| `DATA_DIR` | Persistent volume mount (`/data`) |

## Health

`GET /health` returns `webgraphReady`, disk usage, and release tag. Wire into `npm run railway:verify`.

## Related docs

- `docs/ops/common-crawl-runbook.md` — monthly webgraph refresh
- `docs/DATA_CONTRACT.md` — provenance + envelope fields
