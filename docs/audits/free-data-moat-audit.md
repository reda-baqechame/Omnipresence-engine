# Free / official data moat audit (Phase 5)

**Date:** 2026-07-09  
**Scope:** Remaining paid DataForSEO usage vs legally-safe free/official replacements.

## Summary

| Capability | Current primary | Paid fallback | Free/official deepening opportunity | Legal note |
|------------|-----------------|---------------|-------------------------------------|------------|
| SERP organic | Router (Serper/Brave/SearXNG/OmniData) | DataForSEO `fallback_only` | Keep; expand SearXNG + OmniData SERP | No ToS-violating scrape |
| Backlinks | OmniData Common Crawl webgraph | DataForSEO backlinks adapter | Keep CC ingest fresh; do not claim Ahrefs parity | CC open data OK |
| Authority | CC webgraph + OPR + Tranco + rank.to | none required | Tranco: research/commercial redistribution review before marketing | Documented in FREE_TOOLS |
| Keyword volume/CPC | Cache + Labs / Keywords Everywhere | DataForSEO CPC | **Google Ads Keyword Planner via OAuth** when connected | Official API preferred |
| Rank tracking | `searchGoogleOrganicRouter` | removed direct `checkRankPosition` | GSC first-party position when connected | Already preferred in rank-tracker |
| Local / maps | Serper Places → OmniData maps | Labs maps | OSM Nominatim/Overpass already used elsewhere | Rate-limit + User-Agent |
| CWV | PSI + CrUX | n/a | CrUX History deepen | Google API ToS |
| AI visibility | LLM APIs + UI capture | n/a | Keep paid LLMs — cannot bypass | Required paid |
| LLM mentions | DataForSEO-primary (plan exception) | — | Document; do not fake with scrape | Plan exception |

## Actions taken in this program

1. Sovereign `getBacklinksFree` no longer calls paid Labs (`hasLabsApi` path removed).
2. Rank tracker no longer bypasses router via `checkRankPosition`.
3. Keyword difficulty SERP path uses `searchGoogleOrganicRouter`.
4. Benchmark SERP side-by-side (paid) is **benchmark_only** evidence collection, not customer traffic.

## Do not add without review

- Tranco customer-facing “measured traffic” claims
- Cloudflare Radar absolute visit counts (CC BY-NC — attribution + relative tier only)
- Any scrape that violates Google/Bing ToS

## Next highest-leverage free/official work

1. Wire Google Ads Keyword Planner as primary CPC/volume when OAuth connected.  
2. Expand CrUX History coverage in technical audit.  
3. Keep Common Crawl webgraph release current (`COMMONCRAWL_WEBGRAPH_RELEASE`).  
4. Accumulate real `benchmark_runs` before any demotion of DataForSEO adapters.
