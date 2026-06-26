# OmniPresence Phase 11 — The Free Data Moat

Reverse-engineer each incumbent's signature capability (SimilarWeb, Ahrefs,
Semrush, DataForSEO, AEO/GEO tools) using **free / open-source, no-strings**
data sources, wired into OmniData and the app with **strictly honest labeling**
(measured vs estimated-range vs popularity-proxy). This closes the credibility
gaps the competitive analysis identified while keeping our unique AEO/GEO
execution edge.

## Principle: incumbent → free analog (no strings attached)

| Incumbent signal | Free analog (Phase 11) | Honest label |
| --- | --- | --- |
| SimilarWeb tech tracker | Open fingerprint detection (`tech-stack.ts`) | "best-effort fingerprint" |
| SimilarWeb traffic/audience | Popularity Index (Tranco + Common Crawl + Wikipedia + age) | "relative popularity, not visits" |
| Ahrefs DR / backlinks | Authority Rating (Tranco + Common Crawl + OpenPageRank + age) | "free-signal blend" |
| Semrush keyword volume | Google Trends demand index + Keyword Planner bucketed volume | "estimated range" / "real, bucketed" |
| DataForSEO | New DataForSEO-compatible OmniData endpoints | n/a (drop-in) |
| AEO/GEO | Wikipedia/Wikidata entity authority + Hacker News community | n/a |

## Tier 1 — Keyword moat (Google Trends)

- `services/omnidata/src/engines/trends.ts` — keyless Google Trends via the
  public `explore` → `widgetdata/multiline` + `widgetdata/relatedsearches`
  flow. Returns interest-over-time (0-100 **relative** index), momentum, and
  top + rising related queries. Degrades to `available: false` on rate-limits.
- `POST /v3/keywords/trends/live` in OmniData (`{ keyword, geo, timeframe }`).
- `src/lib/providers/google-trends.ts` — prefers OmniData when active, else
  calls Google directly with the same flow.
- `services/omnidata/src/engines/keywords.ts` — when no Keyword Planner data is
  available, attaches a **real** Trends demand index to the top keywords in a
  single comparison request and sets `data_source: "trends_estimated"`.
- `KeywordSuggestion` (OmniData) gains `trend_index`, `trend_momentum`, and the
  `trends_estimated` data-source value. `KeywordOpportunityRow` carries
  `trend_index` to the Keywords UI.

## Tier 2 — SimilarWeb parity (tech stack + honest popularity)

- `services/omnidata/src/engines/techstack.ts` + `src/lib/engines/tech-stack.ts`
  — rule-based open fingerprints over HTML, response headers, cookies and meta
  tags. Detects frameworks (Next/Nuxt/React/Vue/Angular/Svelte/Astro/Remix),
  CMS (WordPress/Wix/Squarespace/Webflow/Drupal/Ghost), ecommerce
  (Shopify/WooCommerce/Magento/BigCommerce), analytics (GA4/GTM/Segment/
  Plausible/PostHog/Hotjar/Amplitude), marketing (HubSpot/Facebook Pixel),
  support (Intercom/Zendesk/Drift), payments (Stripe), CDNs/hosting
  (Cloudflare/Vercel/Netlify/CloudFront/Fastly/Akamai) and web servers.
  `POST /v3/tech/detect`. Surfaced on the Intelligence page as competitor cards.
- `src/lib/engines/popularity-index.ts` — **honest** relative Popularity Index
  (0-100), blending Tranco authority + Common Crawl referring-domain breadth +
  Wikipedia pageviews + domain age. Explicitly **not** an absolute visit count.
  OmniData-side `services/omnidata/src/engines/popularity.ts` +
  `POST /v3/domain/popularity/live` (OpenPageRank + referring domains + crawl).
- `src/lib/providers/wikimedia.ts` — Wikipedia article presence, Wikidata entity
  presence, and Wikimedia Pageviews API interest-over-time. Keyless.

## Tier 3 — Authority depth (Ahrefs parity, honest)

- `src/lib/providers/domain-age.ts` — domain age via RDAP (`rdap.org`) with a
  Wayback CDX first-seen fallback. Keyless.
- `src/lib/engines/authority-rating.ts` — unified Authority Rating (AR 0-100)
  blending Tranco (0.4) + Common Crawl referring domains (0.3) + OpenPageRank
  (0.2, when OmniData is deployed) + domain age (0.1). Feeds
  `calculateOmniPresenceScore` (authority component) and the AEO authority lever
  in `aeo-readiness.ts` via `domainAuthority`, replacing the Tranco-only read in
  `scan-steps.ts`.

## Tier 4 — Community + entity (AEO/GEO moat)

- `src/lib/engines/community-mentions.ts` — adds **real** Hacker News mentions
  via the keyless Algolia HN Search API alongside Reddit/Quora. The
  `community_mentions.platform` CHECK constraint is extended
  (`0019_phase11.sql`) to allow `hacker_news` and `github`.
- `src/lib/engines/aeo-readiness.ts` — Wikipedia (+20) and Wikidata (+15)
  presence boost the entity lever; missing Wikipedia is surfaced as a blocker.
  `scan-steps.ts` fetches presence during scans (graceful, keyless).

## Tier 5 — Hardening, honesty, UI, docs

- **Bug fix**: `runInstantPage` in `domain-analytics.ts` shadowed `word_count`
  and `images_without_alt` with inner `const`s, so both always returned 0. Fixed
  to assign the outer `let` bindings.
- **Capability flags**: `capabilities.ts` advertises the keyless free-signal set
  (always on); `wire-diy-stack.mjs` prints the Free Data Moat status block.
- **UI**: Keywords table shows a relative Demand (Trends) bar; Intelligence page
  shows competitor Tech Stack + relative Popularity Index.
- **Tests**: `parity.test.ts` covers the tech-detect fingerprint engine and its
  DataForSEO-envelope wrapping.

## Honesty guardrails (non-negotiable)

- Never present absolute traffic/visits. The Popularity Index is explicitly
  **relative**.
- Keyword volume is labeled "estimated range" unless Keyword Planner is
  configured (then "real, bucketed"); the Trends demand index is a relative
  0-100 signal, not a volume.
- Tech stack is labeled "best-effort fingerprint"; backlinks remain labeled
  "Common Crawl sample".

## Provisioning (all keyless / free)

| Capability | Requirement | Default |
| --- | --- | --- |
| Google Trends | none (public endpoints) | always on (rate-limited) |
| Tech-stack detection | none | always on |
| Popularity Index | none (Tranco/Common Crawl/Wikipedia/RDAP) | always on |
| Authority Rating | none; OpenPageRank component needs OmniData + `OPENPAGERANK_API_KEY` | always on (OPR optional) |
| Wikipedia/Wikidata entity | none | always on |
| Hacker News mentions | none (Algolia HN) | always on |

All Phase 11 signals work without any paid API. OmniData (`OMNIDATA_BASE_URL` +
`OMNIDATA_API_KEY`) is preferred when deployed for caching, OpenPageRank, and
the Common Crawl webgraph, but the app falls back to direct keyless calls.
