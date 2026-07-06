# PresenceOS Data Contract

This document explains what each **data quality** label means on PresenceOS metrics. Every number in the product carries one of these labels so customers always know whether a value is measured, estimated, or unavailable.

## Quality labels

| Label | Meaning | Safe to cite in client reports? |
|-------|---------|--------------------------------|
| **Measured** | Pulled from a live API, crawl, or first-party connector (GSC, GA4, SERP probe, AI capture) for this project. | Yes — with provider and date. |
| **Estimated** | Derived from industry benchmarks, CPC proxies, or heuristic models. Clearly marked with a "Projected" chip in the UI. | Yes — only when labeled as estimate. |
| **Model knowledge** | LLM general knowledge used as fallback when no live signal exists (e.g. directory presence check without crawl). | Use with caution; cite as directional. |
| **Simulated** | Demo/preview data for onboarding before first scan. Never mixed into production scores. | No — not for client delivery. |
| **Unavailable** | Required connector or provider not configured, or measurement failed. UI shows "—" or empty state — never a fabricated zero. | N/A |

## Capability-specific rules

### OmniPresence Score
- Sub-scores re-normalize when a dimension has no measured data (unavailable dimensions are excluded, not scored as 0).
- `dimension_availability` in score breakdown shows which surfaces were actually measured.

### Rankings & keywords
- Positions from SERP providers are **measured** when a SERP key or OmniData is active.
- Volume/difficulty without a keyword API are **estimated** (log-scale buckets, heuristic difficulty).

### AI visibility
- Probe results are **measured** when an LLM/SERP provider returns a real response.
- Panel runs require sufficient sample size; insufficient samples exclude AI engines from score pool.

### Attribution & ROI
- GSC/GA4/Bing sessions are **measured** when OAuth connectors sync successfully.
- Paid-ad equivalent and CPC-based value are **estimated** (industry CPC benchmarks).
- Revenue requires GA4 or Stripe — otherwise **unavailable**, not $0.

### Backlinks & authority
- Common Crawl webgraph and OmniData crawls are **measured** (self-hosted).
- OpenPageRank/Tranco popularity tiers are **estimated_proxy** — relative, not visit counts.

### Impact estimates & roadmaps
- Task `impact` scores and `estimated_hours` are **projected** heuristics for prioritization, not financial guarantees.

## Support & sales talking points

1. "We never show a zero when we didn't measure — we show unavailable."
2. "Every projection has a yellow Projected chip — your team can't accidentally present benchmarks as audits."
3. "The Data Trust Center lists per-capability provider, last measured date, and measured vs estimated counts."

## Related code

- Provenance spine: `src/lib/engines/provenance.ts`
- Score re-normalization: `src/lib/scoring/omnipresence.ts`
- UI badges: `src/components/provenance-badge.tsx`, `src/components/projection-badge.tsx`
- Trust Center: `/app/projects/[id]/trust`
