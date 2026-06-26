# OmniPresence Phase 12 — Index Expansion & Calibration

Phase 11 derived incumbent signals from free sources. Phase 12 turns those raw
signals into the **credible numbers** the incumbents sell — keyword volume,
domain popularity, and a head-to-head competitive matrix — using the exact
techniques the paid tools use internally, made free and labeled honestly.

## What this closes (from the competitive analysis)

| Gap (Phase 11) | Phase 12 fix | Source (no strings) |
| --- | --- | --- |
| Keyword volume "still estimated" | Trends **proportional extrapolation** anchored to a known-volume keyword → absolute estimate + log bucket + confidence | Google Trends + Google Search Console |
| No traffic/popularity number | **Global domain rank** blended into Popularity Index | rank.to (keyless, no-auth JSON API) |
| No head-to-head view | **Competitive Matrix**: popularity + authority + tech + real-user CWV in one pass | all free signals |
| Lab-only performance | **Real-user Core Web Vitals** (field data) | Chrome UX Report via PageSpeed |

## Tier A — Honest keyword volume (the weakest gap, closed the right way)

The industry-standard free method (used by Ahrefs/Semrush internally and every
free keyword tool): no source gives exact volume, so **calibrate**:

1. **Keyword Planner** → real bucketed volume (Google reports ~60 log-scale
   buckets), high confidence. Already integrated (Phase 10).
2. **Trends proportional extrapolation** → `est = (targetScore / anchorScore) *
   anchorVolume`, ±30% range, medium confidence. The anchor is a real
   known-volume keyword: a **Google Search Console** query the site ranks top-10
   for (where impressions ≈ monthly searches). Trends comparisons are batched in
   groups of 4 targets + the anchor (max 5 per request) so the anchor normalizes
   every batch onto the same scale.
3. **Relative demand index** (Trends 0-100) when no anchor exists, low confidence.
4. **Heuristic bucket** fallback, low confidence.

Files: `src/lib/engines/keyword-volume.ts` (calibration + GSC anchor + log
buckets), `src/lib/providers/google-trends.ts` (`getTrendsComparison`),
`src/lib/engines/keyword-intelligence.ts` (`applyVolumeCalibration`),
`src/app/api/keywords/route.ts` (`deriveVolumeAnchorFromGsc`),
`src/components/keywords-panel.tsx` (Volume column + confidence badge).

Honest labels: every volume shows a **bucket** ("1K–10K") and a **confidence**
chip (high = Keyword Planner, medium = Trends-extrapolated, low = relative).

## Tier B — Global domain rank (rank.to)

`src/lib/providers/rankto.ts` — keyless, no-auth `https://rank.to/api/?d=&n=30`
returning daily global ranks (aggregated public traffic signals; lower = more
popular) with a 30-day trend. Blended into `popularity-index.ts` as the
strongest free SimilarWeb-style proxy (weight 0.4), still labeled **relative,
not visits**. `rankToPopularityScore` maps rank → 0-100 on a log scale.

## Tier C — Competitive matrix + real-user CWV

- `src/lib/providers/pagespeed.ts` — captures **CrUX field data** (origin-level
  preferred): p75 LCP/CLS/INP + an overall assessment (good / needs-improvement
  / poor). Reliable with a free `PAGESPEED_API_KEY`; degrades to "no field data"
  on the shared keyless quota.
- `src/lib/engines/competitive-snapshot.ts` — fetches the shared free signals
  **once per domain** (Tranco, Common Crawl referring domains, domain age,
  rank.to, Wikipedia, tech stack, CrUX) and derives **both** the Popularity
  Index and the Authority Rating from them (no duplicate network).
- `src/components/competitor-intel.tsx` — renders the head-to-head matrix
  (Popularity, Authority, Global rank + trend, CWV field) plus per-domain tech
  stacks, for the brand vs up to 4 competitors.

## Tier D — Real keyword difficulty (Ahrefs-style, keyless)

Ahrefs/Semrush KD is a function of **how strong the pages that already rank
are** (referring domains / authority of the top results), not the average SERP
position. We reproduce that keylessly:

- `src/lib/engines/keyword-difficulty.ts` — for each keyword, fetch the top-10
  organic results (Serper/Brave/OmniData scrape) and compute KD from the
  **Tranco authority of the domains actually ranking** (`difficulty = avgAuth ×
  0.85 + highAuthorityCount × 3 + AI-overview/feature boosts`). This means
  app-only keyless users get **real KD** instead of a flat `50`. Opportunity
  score blends low-KD, striking-distance position, and not-yet-ranking gaps.
- `services/omnidata/src/engines/keyword-difficulty.ts` — `estimateKeywordDifficulty`
  now uses **OpenPageRank** authority of the ranking domains via the pure,
  parity-tested `computeDifficulty()`, with graceful fallback to the prior
  diversity heuristic when no authority data is available.
- Every row is labeled `ranking_authority` (real) vs `heuristic`, and the
  keywords table shows a small **"real"** marker so the source is transparent.

Verified live: a SERP of high-authority domains (wikipedia/forbes/github/
stackoverflow) yields KD ≈ 73 from real Tranco data; a low-authority SERP yields
KD < 30.

## Honesty guardrails (unchanged, reinforced)

- Never present absolute traffic/visits. Popularity Index and global rank are
  explicitly **relative**.
- Keyword volume is always labeled by confidence; extrapolated numbers carry a
  ±30% range and never claim Keyword-Planner precision.
- Authority Rating is a **free-signal blend**, not Ahrefs DR.
- Tech stack is **best-effort fingerprint**; CWV reflects real users only when a
  site has enough Chrome traffic to appear in CrUX.

## Provisioning

| Capability | Requirement | Default |
| --- | --- | --- |
| Keyword volume buckets (relative) | none | always on |
| Keyword volume (extrapolated absolute) | Google Search Console connected (for the anchor) | on when GSC connected |
| Keyword volume (real bucketed) | Google Ads Keyword Planner (Phase 10) | optional upgrade |
| Global domain rank | none (rank.to) | always on |
| Competitive matrix | none | always on |
| Real-user CWV field | `PAGESPEED_API_KEY` (free) for reliability | best-effort keyless |
