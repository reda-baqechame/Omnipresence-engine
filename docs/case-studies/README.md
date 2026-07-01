# PresenceOS Case Studies

Evidence-backed client outcomes published from the proof ledger. Each study links to `measurement_evidence` rows, rank snapshots, and connector-backed metrics where claimed.

## Template fields

| Field | Source |
|-------|--------|
| Before/after rankings | `rank_snapshots` + evidence hash |
| AI citation rate | `visibility_results` (latest-run scoped) |
| Source graph wins | `source_opportunities` → `results_ledger` |
| Executed tasks | `ops_queue` + verification |
| Traffic/leads | GA4/GSC only when `connector_health.outcomeGuaranteeEligible` |

## Studies

1. [B2B SaaS — AI citation lift](./01-b2b-saas-ai-citations.md)
2. [Local services — map pack recovery](./02-local-services-map-pack.md)
3. [E-commerce — striking-distance ranks](./03-ecommerce-striking-distance.md)
4. [Agency white-label — proof portal](./04-agency-proof-portal.md)
5. [Healthcare — technical + schema deploy](./05-healthcare-schema-deploy.md)
6. [Legal — source graph outreach](./06-legal-source-graph.md)
7. [Hospitality — review velocity](./07-hospitality-reviews.md)
8. [Fintech — attribution ROI](./08-fintech-attribution-roi.md)
9. [Manufacturing — backlink graph moat](./09-manufacturing-backlinks.md)
10. [Education — full closed loop](./10-education-closed-loop.md)

Run `npm run verify:all` before publishing updated studies.
