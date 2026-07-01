# Common Crawl Webgraph Refresh (Railway OmniData)

PresenceOS backlink authority and keyword difficulty use the sovereign Common Crawl webgraph index on OmniData. This runbook keeps it production-current.

## Prerequisites

- OmniData deployed on Railway with a **persistent volume** mounted at `/data`
- `OMNIDATA_BASE_URL` + signing secrets configured on Vercel
- Sufficient disk (~50GB+ for a full CC-MAIN release index)

## Refresh schedule

| Cadence | Action |
|---------|--------|
| Monthly | Pull latest CC-MAIN release columnar index |
| Weekly | Verify `/health` + `webgraphReady` via `npm run railway:verify` |
| On deploy | Run `db:migrate` then smoke SERP + backlink graph |

## Railway steps

```bash
# SSH / one-off job on OmniData service
cd /app/services/omnidata
npm run ingest:webgraph -- --release CC-MAIN-2025-18

# Verify
curl -s "$OMNIDATA_BASE_URL/health" | jq .
curl -s -X POST "$OMNIDATA_BASE_URL/v1/presence/authority" \
  -H "Authorization: Bearer $OMNIDATA_API_KEY" \
  -d '{"domain":"example.com"}' | jq .
```

## Labels in UI

- `commoncrawl_candidate` — host seen in CC index, not crawl-verified live
- `crawl_verified` — live fetch confirmed the link

Never show absolute competitor traffic from CC alone — use relative index only unless `panel_observed` or `first_party_measured`.

## Alerts

- Webgraph ingest failure → backlink KD falls back to heuristic (lower confidence)
- Surface in Presence Gate `backlink` score until at least one `backlink_graph_snapshots` row exists
