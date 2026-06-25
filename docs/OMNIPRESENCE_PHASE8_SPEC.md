# OmniPresence Engine — Phase 8 Spec: Beat AEO Engine

**Goal:** Close every gap vs AEO Engine public feature set while keeping honest, measured guarantees.

**Promise (legal-safe):** Increase probability of discovery, citation, and recommendation across search, AI, social, and authority surfaces — with reimbursement when executed KPIs don't move.

**Current baseline:** Phase 7 complete — `verify:prod` 100%, intelligence spine live, production crons wired.

---

## Competitive scorecard (you vs AEO Engine)

| AEO Engine module | OmniPresence today | Phase 8 target |
|-------------------|-------------------|----------------|
| Brand Intelligence | ✅ `brand-extraction.ts`, entity tab | Continuous DNA sync + voice QC on all content |
| AI Blog Writer (14-step) | ⚠️ `content-generator.ts`, 18 types | Full pipeline UI + bulk schedule + images |
| AI Search Tracking | ✅ visibility + AEO intel + prompts | Win rate dashboard + 300-prompt campaigns |
| Internal Linking Auto | ⚠️ opportunities engine | CMS insert + weekly cron + GSC scoring |
| On-Page SEO Auto | ⚠️ `on-page-queue.ts` stub | Daily cron + 6 agents + CMS PATCH |
| Bulk Indexing | ⚠️ IndexNow on publish | Bing/Yandex + CSV bulk + status UI |
| SEO Reporting | ⚠️ weekly email/Slack | Unified Friday dashboard + LLM referrals |
| Trend Discovery | ⚠️ `trend-discovery.ts` | Viral score + one-click content queue |
| Link Building Auto | ⚠️ authority finder + gaps | Monthly campaigns + anchor mix + vendor CRM |
| Reddit/Quora Seeding | ⚠️ drafts + URL finder | CSV import + mention tracker + stats |
| AI Podcast | ⚠️ script type only | Audio + syndication (Phase 9 or partner API) |
| Visitor Identity | ❌ missing | Phase 9 — Clearbit/Leadfeeder integration |
| Free tools funnel | ⚠️ 4 tools + embed | 10+ tools like AEO hub |
| Managed D4Y ops | ❌ software only | Agency playbook + Slack ops (Phase 9) |
| 90-day guarantee | ✅ `guarantee.ts` + Stripe credits | Marketing + qualified traffic rules UI |
| DataForSEO depth | ⚠️ OmniData partial clone | Task queue + maps SERP + on_page instant |

Legend: ✅ production | ⚠️ partial | ❌ missing

---

## The 8 engines — gap detail

### 1. Brand Entity Engine
**Built:** extraction, Wikidata draft, entity tab, schema engine  
**Missing:** NAP consistency checker, social profile sync drafts, banned-word enforcement on publish, offer capsule library for CTAs

### 2. AI/Search Visibility Tracker
**Built:** 6 LLM probes, citation extraction, share of voice, run comparison, weekly/monthly crons  
**Missing:** Bing Copilot AI Performance API, explicit win-rate metric, YouTube search visibility, prompt ownership heatmap

### 3. Technical Readiness Engine
**Built:** crawl, robots, schema, canonicals, AI bot audit, passage readiness  
**Missing:** JS rendering audit, Core Web Vitals probe, Perplexity-User bot check, Apple Business Connect status

### 4. Prompt Universe Engine
**Built:** generator, CSV import, prompt storage  
**Missing:** 1000-prompt campaign UI, prompt clustering by funnel stage, auto-refresh from GSC queries

### 5. Content Domination Engine
**Built:** 18 content types, pSEO matrices, keyword seeding  
**Missing:** 14-step blog pipeline UI, image generation, multi-language, repurposing chain (1 article → 8 formats)

### 6. Distribution Engine
**Built:** WP/Webflow/Shopify, Buffer/Ayrshare, GBP OAuth, IndexNow, scheduler  
**Missing:** distribution Kanban board, GBP post automation, YouTube upload prep, directory submission tracker

### 7. Authority & Citation Engine
**Built:** authority finder, backlink gaps, backlink monitor, outreach pitch drafts  
**Missing:** link building campaigns (monthly), journalist/HARO finder, anchor mix planner, outreach CRM sequences

### 8. Attribution & Traffic Engine
**Built:** GSC/Bing/GA4/Plausible sync, results ledger  
**Missing:** paid-ads-equivalent calculator, multi-touch attribution UI, LLM referral breakdown chart

---

## OmniData (DataForSEO clone) — remaining depth

DataForSEO operates as: **task queue → poll → result** + **live endpoints** + **Labs keyword data**.

| Endpoint class | Status | Open-source / cheap stack |
|----------------|--------|---------------------------|
| SERP organic live | ✅ Serper/Bing/Brave | Done |
| AI Overview parse | ⚠️ partial | Serper `aiOverview` blocks |
| Keyword suggestions | ✅ autocomplete + DFS Labs fallback | Done |
| Keyword difficulty | ✅ SERP competition score | Done |
| Content gaps | ✅ competitor top-10 | OmniData only |
| Backlink gaps | ✅ Common Crawl + OPR | OmniData only |
| Rank tracker | ✅ live check | Done |
| Backlinks summary | ✅ DFS/CC | Done |
| Task queue API | ❌ | Redis job store (docker exists) |
| Maps/local SERP | ❌ | Serper places / Bing local |
| On-page instant | ❌ | Firecrawl + cheerio |
| Domain analytics | ⚠️ partial | Tranco + OPR + crawl metrics |
| LLM mentions API | ⚠️ app layer only | Perplexity + visibility scanner |
| Historical SERP | ❌ | Redis time-series |

---

## Phase 8 build waves (loop order)

### Wave A — Execution automation (beats AEO daily ops)
1. On-page fix queue + daily cron + CMS apply
2. Internal link injection drafts → CMS with approval
3. Bulk indexing UI (IndexNow + Bing URL submission + CSV)
4. Distribution Kanban (drafted → published → indexed → traffic)

### Wave B — Growth funnel (beats AEO free tools)
5. Free tools: canonical checker, sitemap validator, citation planner, ROI calculator
6. Public audit v2: platform coverage map + competitor comparison chart
7. Embeddable widget pack for agencies

### Wave C — Authority machine (beats AEO link building)
8. Link building campaign module (monthly cron, anchor mix, vendor orders)
9. Authority CRM (pipeline: prospect → pitched → published → measured)
10. Reddit/Quora mention CSV import + tracking dashboard

### Wave D — OmniData depth
11. Async task queue API (`POST task → GET tasks_ready`)
12. Maps/local SERP endpoint
13. On-page instant pages endpoint
14. SERP history in Redis (rank charts over time)

### Wave E — Results proof (beats AEO reporting)
15. OmniPresence composite dashboard (8 sub-scores on overview)
16. Paid ads replacement calculator
17. Friday unified report v2 (PDF + Slack + email)

---

## Security requirements (every new endpoint)

- SSRF block on all crawl/fetch (`assertPublicDomain`)
- HMAC signing app ↔ OmniData
- Rate limits on `/api/public/*` and `/api/tools/*`
- Human-review gate before Reddit/Quora/community publish
- Encrypted integration vault for CMS credentials
- robots.txt respect on crawler
- No simulated data in production paths (`preferLiveData()`)

---

## Manual wiring (cannot automate — user action)

| Item | Action |
|------|--------|
| OmniData VPS | `docker compose up` in `services/omnidata`, set Vercel env |
| Google OAuth | Console → credentials → redirect URI |
| Bing Webmaster OAuth | App registration |
| Stripe products/prices | Dashboard → webhook to `/api/webhooks/stripe` |
| Inngest | Register app → `/api/inngest` |
| Serper API key | serper.dev → OmniData VPS |
| DataForSEO (optional) | Already on Vercel — powers intelligence fallback |
| Buffer/Ayrshare | API keys in integrations panel |
| Slack webhooks | Incoming webhook URL in settings |
| GBP OAuth | Connected via distribution tab |
| Apple Business Connect | Manual — no public API yet |
| Podcast syndication | Spotify for Podcasters / RSS — Phase 9 |
| Visitor identity | Clearbit Reveal / Leadfeeder — Phase 9 |

---

## Success metrics (Phase 8 done when)

- [ ] `verify:prod` stays 100%
- [ ] All 8 engine tabs show **live** data badge when keys configured
- [ ] On-page + internal link crons run without demo fallback
- [ ] Public audit matches AEO free report depth
- [ ] Guarantee cron verifies real KPI movement from results_ledger
- [ ] OmniData passes parity test suite vs DataForSEO live samples
