# Patch F.1 — Report-wide no-evidence / no-claim quality gate plan

**Status:** Plan only — **do not implement until repo hardening PR is verified.**  
**Audit finding:** Patch F (merged) guards **only** the LLM-generated executive summary in deep intelligence reports. Report body, PDF, HTML, recommendations, and dollar-value sections are **not** gated.

---

## Current state (Patch F — partial)

| What exists | Where |
|-------------|-------|
| `findForbiddenClaims()` phrase blocklist | `src/lib/config/claims.ts` |
| `detectContentDefects()` AI artifact detection | `src/lib/engines/content-defects.ts` |
| LLM executive summary gate | `src/lib/engines/intelligence-report-narrative.ts` |
| Static CI pin | `scripts/verify-output-quality.mjs` |
| Unit tests | `intelligence-report-narrative-quality-gate.test.ts` |

**On rejection:** discard LLM text, use `deterministicNarrative()` fallback, record `deep_report.narrative_rejected` metric.

**Gap:** deterministic fallback still emits prose derived from report structs without per-claim evidence verification. PDF/HTML templates can still render sections with `available: false` inconsistently.

---

## Target state (Patch F.1)

A **report-wide quality gate** that runs after report data is assembled and before artifacts are persisted/rendered:

1. Every customer-visible claim is classified: `measured` | `estimated` | `model_knowledge` | `simulated` | `unavailable`.
2. Forbidden phrasing is blocked regardless of source (LLM or template).
3. Sections without evidence are **omitted or explicitly labeled unavailable** — never implied as measured.
4. Dollar values require CPC/traffic provenance chain.
5. Gate failure **degrades** (strip section / use fallback copy) — does not silently pass.

---

## Enforcement architecture (proposed)

```
gatherReportData() / gatherIntelligenceReport()
        ↓
  ReportData / IntelligenceReport (typed sections)
        ↓
  validateReportClaims(report)  ← NEW (Patch F.1)
        ↓
  sanitizeReportForRender(report) ← NEW (strip/downgrade)
        ↓
  generateReportNarrative() (existing Patch F)
        ↓
  HTML / PDF render
```

**Single module proposal:** `src/lib/engines/report-quality-gate.ts`  
**Tests:** `src/lib/engines/__tests__/report-quality-gate.test.ts`  
**CI:** extend `scripts/verify-output-quality.mjs` to require import + call before render.

---

## Claim matrix

### Standard PDF report (`report-builder.ts` / `report-generator.ts` / `report-pdf-document.tsx`)

| Claim type | Required evidence | Measured phrasing | Estimated phrasing | Unavailable phrasing | Forbidden phrasing | Test required | Enforcement point |
|------------|-------------------|-------------------|--------------------|-----------------------|-------------------|---------------|-------------------|
| Organic traffic / sessions | GA4 or GSC connector snapshot | "X sessions (GA4, {date range})" | — | "Organic traffic unavailable — connect GA4" | "You get X sessions" without source | Golden fixture with/without GA4 | `validateReportClaims` before `saveReportArtifacts` |
| Ads-replacement dollar value | `cpcSource: "real"` + session counts | "Estimated replacement value $X at $Y CPC (Keyword Planner)" | "Industry estimate $X at ~$Y CPC ({industry})" | Omit dollar line or "Replacement value unavailable — no CPC data" | "You would save $X" as fact; `$0` when null | Extend `report-builder-cpc-cancellation.test.ts` | `calculateAdsEquivalent` output validation |
| AI visibility score | `visibility_runs` + `ratesReliable` | "Mention rate X% (N grounded probes)" | — | "Insufficient probe coverage for rates" | "Guaranteed AI visibility" | `visibility-scanner.test.ts` + new gate test | Section `available` flag |
| Share of voice | Wilson CI + probe counts | "SOV X% ±Y (95% CI, n=)" | — | Hide SOV if n below floor | SOV with n=1 | `share-of-voice.test.ts` | Template conditional |
| Competitor comparison | SERP/backlink evidence per competitor | "Ranks #{n} for {kw} (SERP snapshot)" | — | "Competitor data unavailable" | "You beat {competitor}" without data | New gate test | Competitive section |
| Methodology appendix | Static approved copy | Appendix renders | — | — | Unapproved methodology claims | `report-methodology-appendix.test.ts` | PDF template only |

### HTML report (standard + intelligence)

| Claim type | Required evidence | Measured | Estimated | Unavailable | Forbidden | Test | Enforcement |
|------------|-------------------|----------|-----------|-------------|-----------|------|-------------|
| All standard PDF claims | Same | Same | Same | Same | Same | Shared gate | Pre-render |
| Executive summary (LLM) | Patch F existing | LLM text after gate | Deterministic fallback | Fallback | Forbidden phrases | Existing narrative test | `generateReportNarrative` |
| Executive summary (deterministic) | Underlying section `available` flags | — | Partial sentences OK | Omit sentence | Outcome promises | **New** | `validateReportClaims` on fallback text |
| Recommendations / roadmap | `source_type`, `evidence_label` on items | "Based on {evidence}" | "Suggested action" | Hide item | "Improve SEO" generic | `roadmap-generator` tests | Filter items pre-render |

### Deep intelligence report (`intelligence-report-builder.ts` / template)

| Claim type | Required evidence | Measured | Estimated | Unavailable | Forbidden | Test | Enforcement |
|------------|-------------------|----------|-----------|-------------|-----------|------|-------------|
| OmniPresence score | Scoring engine output + inputs | Score with label tier | — | "Score unavailable" | "#1 in industry" | `omnipresence.test.ts` | Executive section |
| AI visibility | `report.visibility.available` + `ratesReliable` | Rates with n | — | `reliabilityNote` | Citation rate without citations | Existing section tests | Template + gate |
| Keywords / opportunities | Keyword planner or SERP evidence | "Volume X (source)" | "Estimated opportunity" | Section hidden | Volume as fact without source | `keyword-intelligence.test.ts` | Section `available` |
| Backlinks / authority | `getBacklinksFree` or measured graph | "RD count (source, date)" | — | `available: false` | DR score without source | Gate test | Competitive section |
| Technical / CWV | PSI/CrUX/Lighthouse evidence | "LCP Xms (CrUX p75)" | Lab-only labeled | "CWV unavailable" | "Fast site" without metrics | `cwv` route tests | Technical section |
| Local / directory | GSC/Bing/local pack data | Pack rank with source | — | Unavailable block | "Dominates local pack" | New | Local section |
| SERP / rank | `searchGoogleOrganicRouter` trail | Position with provider id | — | Unavailable | "#1 ranking" | `rank-tracker` tests | Keywords section |
| CPC / volume | Keyword planner / cache | CPC with `data_source` | Industry CPC | Omit | `$0` CPC | `keyword-cpc-cache.test.ts` | Keywords + ads value |
| Popularity / authority tier | Tranco/CC/OPR resolved source | "Tier X ({source})" | — | Unavailable | "Authority leader" | `domain-authority` tests | Competitive section |

---

## Phrasing rules (global)

### Allowed when measured
- Must include: metric value + source name + freshness hint (date range or `fetched_at`).
- Example: "Referring domains: 142 (Common Crawl webgraph, 2026-06)."

### Allowed when estimated
- Must include: "estimate", "industry benchmark", or `dataQuality: "estimated"` badge.
- Example: "Replacement value ~$4,200/mo (industry CPC estimate)."

### Allowed when unavailable
- Explicit: "Data unavailable — connect {connector}" or section omitted with UI badge.
- **Never:** `0`, `$0`, `N/A` presented as a measured metric in customer PDFs.

### Forbidden (always)
- Phrases in `FORBIDDEN_PHRASES` (`claims.json`)
- Outcome guarantees: "will rank", "guaranteed ROI", "dominate"
- AI self-reference in customer copy
- Competitor superiority without side-by-side evidence
- Labeling estimated/unavailable data as "measured" or "live"

---

## Implementation phases (do not start until hardening PR merged)

### Phase F.1a — Shared validator (no PDF changes)
- Add `validateReportClaims(report): ValidationResult[]`
- Wire into `finalizeIntelligenceReport` and `saveReportArtifacts` — log + metric on failure
- Tests only; no customer-visible change yet

### Phase F.1b — Sanitize + degrade
- Add `sanitizeReportForRender(report)` — strips forbidden sections
- Intelligence HTML template respects sanitized shape
- Extend `verify-output-quality.mjs`

### Phase F.1c — Standard PDF parity
- Apply same gate to `report-pdf-document.tsx` inputs
- Extend `report-pdf-content-parity.test.ts`

### Phase F.1d — Recommendations / roadmap
- Filter `roadmap-generator` output through gate
- Block generic LLM roadmap items (already partially done — extend)

---

## Test plan summary

| Test file | Covers |
|-----------|--------|
| `report-quality-gate.test.ts` | Core validator — measured/estimated/unavailable/forbidden |
| `intelligence-report-narrative-quality-gate.test.ts` | LLM path (existing) |
| `report-pdf-content-parity.test.ts` | PDF byte claims match gated HTML |
| `report-builder-cpc-cancellation.test.ts` | CPC unavailable → no fake `real` label |
| `verify-output-quality.mjs` | Static: gate wired before render |

---

## Non-goals (Patch F.1)

- Do not block report delivery entirely on first gate failure (degrade, don't 500).
- Do not add new data providers.
- Do not claim benchmark parity.
- Do not modify `router.ts` or DataForSEO behavior.

---

## Acceptance criteria for Patch F.1 (future)

- [ ] Validator runs on every report type before persist/render.
- [ ] No measured label without evidence object in report payload.
- [ ] No forbidden phrase in shipped PDF bytes (existing parity test extended).
- [ ] Unavailable sections omitted or explicitly labeled in HTML + PDF.
- [ ] `passed` benchmark rows unrelated — no conflation with report gate.
- [ ] All existing gates still pass.

---

## Related

- Patch F (merged): `intelligence-report-narrative.ts`
- `docs/audits/staging-benchmark-runbook.md` — benchmark evidence (separate concern)
- `docs/audits/dataforseo-bypass-inventory.md` — CPC/backlink evidence sources
