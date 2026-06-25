# OmniPresence Engine — Phase 2 Development Spec

**Goal:** Production-grade organic visibility OS that delivers measurable traffic, citations, and rankings — competitive with AEO Engine and DataForSEO-backed stacks.

**Honest promise:** Increase probability of discovery, citation, and recommendation across search, AI, social, and authority surfaces. Guarantee spine reimburses when executed actions don't move KPIs.

---

## Competitive positioning

| Competitor | Their moat | Our counter |
|------------|-----------|-------------|
| AEO Engine | Managed service + 40 agents + content volume | Same bundle in software + optional D4Y; OmniData replaces $500+/mo API costs |
| DataForSEO | Deep SERP/backlink/keyword APIs | OmniData clone (Serper/Bing/Brave/CC/OPR) + app intelligence layer |
| Semrush/Ahrefs | Rank + backlinks index | Rank tracker + authority finder + guarantee-backed execution |
| Jasper/Copy.ai | Content only | Full loop: audit → content → distribute → measure → guarantee |

---

## Architecture: 8 engines (status)

| Engine | Phase 1 | Phase 2 target |
|--------|---------|----------------|
| 1. Brand Entity | Extraction + Wikidata draft | Continuous monitoring, NAP sync drafts |
| 2. AI/Search Visibility | 6 engines, multi-run sampling | Rank UI, real-time alerts, Copilot probes |
| 3. Technical Readiness | Crawl + audit + bots | On-page auto-fix queue |
| 4. Prompt Universe | Generator from brand | CSV import, 1000-prompt campaigns |
| 5. Content Domination | 18-type factory | **Programmatic SEO matrices** |
| 6. Distribution | CMS/social/GBP/IndexNow | OAuth GBP, publish scheduling |
| 7. Authority & Citation | Finder + CRM | Backlink monitoring, outreach sequences |
| 8. Attribution | GSC/Bing/GA4/Plausible | Multi-touch, ads-equivalent calculator |

---

## OmniData (DataForSEO clone) — reverse-engineered scope

### DataForSEO operates as:
1. **Task queue API** — POST task → poll `tasks_ready` → GET result (async, billed per task)
2. **Live API** — immediate results (higher cost)
3. **Labs** — keyword volume, difficulty, SERP history (biggest gap in our clone)

### Phase 2 OmniData endpoints to add

| Priority | Endpoint | Open-source / cheap stack |
|----------|----------|---------------------------|
| P0 | Redis-persistent tasks + rank history | Redis (already in docker-compose) |
| P1 | `keywords_data/google_ads/search_volume/live` | SerpAPI autocomplete + clickstream estimates |
| P1 | `serp/google/maps/live` | Serper places / Bing local |
| P2 | `backlinks/backlinks/live` | Common Crawl CDX + OPR + `link:` SERP |
| P2 | `on_page/instant_pages` | Existing crawler + schema extract |
| P3 | `ai_optimization/llm_mentions/*` | Perplexity API + visibility scanner (app layer) |
| P3 | `domain_analytics/*` | Tranco rank + OPR + crawl metrics |

### Security (search best practice)
- SSRF: block private IPs, link-local, metadata endpoints (`domain.ts`, OmniData crawler)
- Signed HMAC between app ↔ OmniData (`engine-auth.ts`)
- Rate limits on public tools and guarantee API
- No credential storage in client; OAuth tokens encrypted in Supabase
- Crawl user-agent identification; respect robots.txt on crawl
- Human-review gate for Reddit/Quora/community content

---

## Phase 2 build waves

### Wave A — Real measurement & scale (this sprint)
- [x] Programmatic SEO campaigns (keyword × location matrices)
- [x] Rank tracker UI wired to OmniData
- [x] Internal linking opportunity engine
- [x] OmniData Redis persistence
- [x] Guarantee auto-verify cron
- [x] Production llms.txt from sitemap

### Wave B — Execution automation
- [ ] On-page fix queue (title/meta/schema) with CMS PATCH
- [ ] Internal link injection drafts → CMS
- [ ] Bulk IndexNow on publish
- [ ] Weekly rank + visibility cron (wired)
- [ ] Public audit live visibility when API keys present

### Wave C — OmniData depth
- [ ] Keyword volume from Google Ads API or DataForSEO fallback
- [ ] Maps/local SERP endpoint
- [ ] Backlink monitoring (new/lost)
- [ ] Domain analytics summary

### Wave D — Growth & monetization
- [ ] Embeddable free tools widgets
- [ ] Agency white-label PDF v2
- [ ] Stripe plan gates per feature
- [ ] Trend discovery (Google Trends RSS + news)

### Wave E — Programmatic SEO at scale
- [ ] CSV import for 10k+ page matrices
- [ ] URL pattern engine with slug sanitization
- [ ] WordPress bulk publish with scheduling
- [ ] GSC query → content refresh loop

---

## MVP sellable today (post Phase 2A)

**OmniPresence Audit + Execution Plan** — $99–$299 one-time / $299–$999/mo tracking

1. OmniPresence Score (live technical + visibility with keys)
2. Competitor gap map
3. 100 buyer prompts
4. Programmatic SEO campaign preview
5. Rank tracker for top 50 keywords
6. Internal link opportunities
7. 30-day roadmap
8. White-label PDF
9. Guarantee contract with baseline lock

---

## Accounts you must wire manually

See `docs/WIRING_GUIDE.md` for full checklist. Cannot be fully automated:

- Supabase project + run migrations
- Stripe products + webhook
- Google Cloud OAuth (GSC, GA4, GBP)
- Bing Webmaster OAuth
- Serper / Brave / Bing Search API keys
- OpenAI / Anthropic / Google AI keys
- Firecrawl API key
- Inngest production app
- Resend domain verification
- OmniData Docker on VPS (or OMNIDATA_BASE_URL)
- Buffer/Ayrshare for social (optional)
- Plausible site ID (optional)

---

## Loop protocol

1. Read `docs/BUILD_MANIFEST.json` — first `pending` task
2. Implement one task only
3. Run `npm run verify:all` + `npm run omnidata:test` if OmniData changed
4. Mark done, commit, push (user approved push)
5. Repeat until manifest complete

---

## Success metrics (production)

| Metric | Target |
|--------|--------|
| CI green | `verify:all` + smoke on every push |
| Scan completion | <15 min per project with keys |
| Public audit | Real technical + optional live visibility |
| Rank check | <3s per keyword via OmniData live |
| pSEO campaign | 50 pages/batch without timeout |
| Guarantee | Auto-verify at day 90; claim → Stripe credit |
