# PR #5 replacement decision

**Date:** 2026-07-08  
**Repository:** `reda-baqechame/Omnipresence-engine`  
**Decision:** **Close and replace — do not merge, rebase, or cherry-pick.**

---

## PR under review

| Field | Value |
|-------|-------|
| **PR** | [#5](https://github.com/reda-baqechame/Omnipresence-engine/pull/5) |
| **Title** | Add zero-license-string live data providers: PageSpeed, Tranco, HN, tech detect |
| **Branch** | `claude/build-capabilities-audit-2o0rqx` |
| **State** | Open |
| **Mergeable** | **No** (`mergeStateStatus: DIRTY`, `mergeable: CONFLICTING`) |
| **Diff** | 8 files, +710 / −0 |

### Files in PR #5

| File | Role |
|------|------|
| `src/app/api/community/live/route.ts` | HN live mention import |
| `src/app/api/domain-authority/route.ts` | Tranco authority HTTP surface |
| `src/app/api/pagespeed/route.ts` | PageSpeed Insights HTTP surface |
| `src/app/api/tech-stack/route.ts` | Tech fingerprint HTTP surface |
| `src/lib/engines/tech-detect.ts` | webappanalyzer-based detector |
| `src/lib/providers/hacker-news.ts` | HN Algolia client |
| `src/lib/providers/pagespeed.ts` | Standalone PSI client |
| `src/lib/providers/tranco.ts` | Standalone Tranco client |

---

## Why it is not mergeable

1. **Behind main** — PR #5 branched before merged PR #6 (144 files) and PR #8 (Patch J). Main has moved substantially.
2. **Hard conflicts** — `git merge-tree` reports **changed in both** on:
   - `src/lib/providers/pagespeed.ts`
   - `src/lib/providers/tranco.ts`
3. **GitHub merge state** — `mergeStateStatus: DIRTY` / `mergeable: CONFLICTING`. A blind rebase would require manual resolution on provider implementations where main is strictly more capable.

---

## What main already has (superior or equivalent)

| PR #5 addition | Main equivalent | Verdict |
|----------------|-----------------|---------|
| `pagespeed.ts` | `src/lib/providers/pagespeed.ts` — OmniData path via `omnidata-performance.ts`, `google-cloud-key`, CrUX field parsing, existing `/api/cwv` for stored CrUX history | **Do not replace** — PR version is a thinner duplicate |
| `tranco.ts` | `src/lib/providers/tranco.ts` — in-process TTL cache, `getDomainAuthority()` | **Do not replace** |
| `hacker-news.ts` | `src/lib/engines/community-mentions.ts` — `searchHackerNewsMentions()` + `POST /api/community` live fetch | **Duplicate** |
| `tech-detect.ts` | `src/lib/engines/tech-stack.ts` + `tech-stack-fingerprint.ts` — OmniData `/tech/detect` + direct fingerprint fallback | **Duplicate** |
| `domain-authority/route.ts` | `src/lib/providers/domain-authority.ts` — multi-source resolver (CC webgraph, OPR, Tranco, rank.to) — **no HTTP route yet** | Route idea valid; **rebuild on main resolver** |
| `pagespeed/route.ts` | PSI provider exists; `/api/cwv` covers CrUX persistence — **no dedicated PSI route** | Route idea valid; **rebuild on main provider** |
| `tech-stack/route.ts` | `detectTechStack()` engine exists — **no HTTP route** | Route idea valid; **rebuild on main engine** |
| `community/live/route.ts` | `POST /api/community` already imports live mentions | **Duplicate** |

---

## Legal / commercial risks of "zero-license-string"

The PR title implies absence of license strings equals safe commercial use. **That is false.**

| Source | Risk |
|--------|------|
| **Google PageSpeed Insights API** | Google API Terms of Service, per-project/daily quota, attribution requirements. Keyless tier is severely rate-limited. Not a grant of unlimited SaaS resale rights. |
| **Tranco list API** | Research-grade ranking list; API terms restrict commercial redistribution. Must verify `tranco-list.eu` terms before customer-facing use. |
| **Hacker News (Algolia)** | Public search API with rate limits; scraping/aggregation ToS constraints. Already used on main — same constraints apply. |
| **webappanalyzer fingerprints** | MIT ruleset for detection logic ≠ license to scrape arbitrary customer domains at scale or resell raw page content. |

**"Zero-license-string" is not a compliance strategy.** Each source needs: TOS review, rate limiting, caching policy, attribution, and provenance labels (`measured` vs `unavailable`).

---

## Why not rebase blindly

A rebase would:

1. **Overwrite** main's richer `pagespeed.ts` and `tranco.ts` with simpler PR versions — a regression.
2. **Introduce** parallel code paths (`tech-detect.ts` vs `tech-stack-fingerprint.ts`) without PresenceData envelope/provenance.
3. **Ship** four new API routes with **zero tests**, no rate-limit wiring, and no `verify-route-auth` review.
4. **Bypass** Patch J's router-first architecture — standalone routes call providers directly.

Cherry-picking individual files is equally unsafe: the PR's provider modules conflict with main's and are not drop-in compatible.

---

## Which pieces may be rebuilt later

If product needs HTTP surfaces for these capabilities, rebuild **on main** using existing engines:

| Capability | Rebuild using | Requirements before ship |
|------------|---------------|--------------------------|
| PageSpeed / CWV | `src/lib/providers/pagespeed.ts`, `recordMeasurementEvidence()` | Auth (`verifyProjectAccess`), `assertPublicDomain`, rate limit, envelope, tests, Google ToS sign-off |
| Domain authority | `resolveDomainAuthority()` in `domain-authority.ts` | Same + provenance `source` field exposed to UI |
| Tech stack | `detectTechStack()` | SSRF guard (PR #5 pattern is good), competitor allowlist, tests |
| HN community | `fetchLiveCommunityMentions()` / extend `POST /api/community` | Already exists — extend, don't duplicate |

---

## Required conclusion

**PR #5 should be closed and replaced, not merged or rebased.**

### Replacement strategy

If PageSpeed, Tranco, HN, or tech-stack HTTP surfaces are needed later:

1. **Do not** resurrect PR #5 branch.
2. Add thin API routes on `main` that call **existing** provider modules.
3. Route all responses through **PresenceData/OmniData envelopes** with `dataQuality`, `freshness`, `confidence`, and `provider_class`.
4. Apply **auth** (`verifyProjectAccess`), **rate limits**, and **budget guards** consistent with other project-scoped routes.
5. Add **tests** (route-level + provider-level) to `verify-all.mjs`.
6. Complete **legal/TOS review** per source before any customer-facing label says "measured".
7. Run **`node scripts/audit-dataforseo-bypasses.mjs`** after any new provider wiring to ensure Patch J bypass inventory stays honest.

---

## Action items

- [x] Close PR #5 on GitHub with link to this document — **attempted 2026-07-09; permission denied** (`Resource not accessible by integration`). PR remains open; treat as abandoned per this doc.
- [ ] Do not delete branch immediately (reference only); archive after team acknowledgment.
- [ ] Track HTTP-surface requests as separate, small PRs against `main` providers — not provider rewrites.

### GitHub close attempt log

| Date | Action | Result |
|------|--------|--------|
| 2026-07-09 | `gh pr close 5 --comment "..."` | Failed — insufficient token permissions |
| 2026-07-09 | `gh pr close 5` (no comment) | Failed — insufficient token permissions |

**Manual action required:** A repo maintainer should close PR #5 and link this document.
