# OmniPresence Super Engine — Build Progress

## Phase 1 (complete)

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-24 | build-loop | done | SKILL + manifest + verify:all |
| 2026-06-24 | omnidata-scaffold | done | services/omnidata + Docker |
| 2026-06-24 | omnidata-serp | done | Serper/Bing/Brave + DataForSEO shape |
| 2026-06-24 | omnidata-ranktracker | done | History + striking-distance |
| 2026-06-24 | omnidata-backlinks-kw | done | Common Crawl + OPR + autocomplete |
| 2026-06-24 | omnidata-wire | done | OMNIDATA_BASE_URL in dataforseo.ts |
| 2026-06-24 | tech-crawler | done | site-crawler + technical-audit integration |
| 2026-06-24 | real-measurement | done | Multi-run LLM sampling + coverage SERP |
| 2026-06-24 | execution-content-entity | done | Answer-capsule + Wikidata reconcile |
| 2026-06-24 | execution-publishing | done | GBP UI + Buffer profileIds + ledger |
| 2026-06-24 | guarantee-spine | done | 0011 migration + dashboard + API |
| 2026-06-24 | security | done | HMAC engine auth + SSRF guards |
| 2026-06-24 | tests-prod | done | omnidata tests + OMNIDATA_DEPLOY.md |

## Phase 2 (complete)

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-25 | phase2-spec | done | OMNIPRESENCE_PHASE2_SPEC + WIRING_GUIDE |
| 2026-06-25 | pseo-engine | done | Matrix expansion + API + pSEO tab |
| 2026-06-25 | rank-tracker-ui | done | OmniData rank check + Rankings tab |
| 2026-06-25 | internal-linking | done | PageRank opportunities + tab |
| 2026-06-25 | omnidata-redis-store | done | Dual-write store + ioredis |
| 2026-06-25 | guarantee-cron | done | Daily verify + window_days enforcement |
| 2026-06-25 | llms-txt-pro | done | Sitemap-driven llms.txt |
| 2026-06-25 | phase2-ui | done | pSEO, Rankings, Internal Links tabs |
| 2026-06-25 | public-audit-live | done | Real SERP/AI visibility when keys configured |
| 2026-06-25 | on-page-queue | done | Technical findings → ops_queue |
| 2026-06-25 | omnidata-keywords-volume | done | Autocomplete rank + Serper volume signals |
| 2026-06-25 | trend-discovery | done | Google Trends RSS + /api/trends |
| 2026-06-25 | backlink-monitor | done | Weekly snapshots + /api/backlinks |
| 2026-06-25 | publish-scheduler | done | Hourly Inngest + IndexNow |

## Phase 3 (complete)

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-25 | credential-vault | done | AES-256-GCM + project_integrations migration |
| 2026-06-25 | integrations-api | done | /api/integrations + WordPress auto-publish |
| 2026-06-25 | robots-guard | done | App + OmniData crawlers respect robots.txt |
| 2026-06-25 | direct-scrape | done | cheerio fallback when Firecrawl unavailable |
| 2026-06-25 | indexnow-wire | done | Distribution + scheduler submit IndexNow |
| 2026-06-25 | omnidata-domain-analytics | done | overview/live + instant_pages endpoints |
| 2026-06-25 | prompt-fallback | done | Template prompts when LLM universe empty |
| 2026-06-25 | prompts-csv-api | done | /api/prompts CSV bulk import |
| 2026-06-25 | pseo-matrix-csv | done | matrixCsv row import on /api/pseo |
| 2026-06-25 | backlinks-trends-ui | done | Backlinks + Trends project tabs |
| 2026-06-25 | health-omnidata | done | Health check pings OMNIDATA_BASE_URL |
| 2026-06-25 | publish-scheduler-v2 | done | Integration vault + auto CMS publish |

**Phase 3 manifest complete.**

## Phase 4 (complete)

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-25 | production-readiness-engine | done | Score + blockers on /api/health and /api/capabilities |
| 2026-06-25 | env-example | done | .env.example with all production vars |
| 2026-06-25 | credential-vault-prod | done | INTEGRATION_ENCRYPTION_KEY required on Vercel prod |
| 2026-06-25 | integrations-ui | done | Encrypted CMS save panel on Distribution tab |
| 2026-06-25 | publish-vault-fallback | done | Publish + scheduler use saved creds |
| 2026-06-25 | scheduler-multi-cms | done | WordPress/Webflow/Shopify auto-publish |
| 2026-06-25 | weekly-gsc-sync | done | Weekly attribution sync Inngest cron |
| 2026-06-25 | prompt-import-ui | done | CSV import on Visibility tab |
| 2026-06-25 | startup-warnings | done | instrumentation.ts logs prod misconfig |
| 2026-06-25 | verify-prod-script | done | verify:prod + check:env hardened |
| 2026-06-25 | setup-checklist-v4 | done | Setup page with readiness score |

**Phase 4 manifest complete. Platform production-ready when env checklist passes.**

## Phase 5 (complete)

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-25 | health-checks-detail | done | Full checks in /api/health for verify:prod |
| 2026-06-25 | gbp-oauth | done | google_business_profile OAuth + location discovery |
| 2026-06-25 | gbp-oauth-publish | done | Distribution GBP uses stored OAuth |
| 2026-06-25 | oauth-status-api | done | /api/oauth/status per project |
| 2026-06-25 | embed-audit | done | /embed/audit + snippet API |
| 2026-06-25 | embed-headers | done | frame-ancestors * for embed routes |
| 2026-06-25 | prod-keygen | done | npm run prod:keygen |

**Phase 5 manifest complete.**

## Phase 6 (complete)

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-25 | keyword-difficulty-engine | done | SERP competition scoring |
| 2026-06-25 | content-gap-engine | done | Competitor ranks / brand absent |
| 2026-06-25 | backlink-gap-engine | done | Common Crawl gap domains |
| 2026-06-25 | omnidata-labs-api | done | Labs-compatible endpoints |
| 2026-06-25 | no-fake-serp | done | No simulated SERP rows |
| 2026-06-25 | keyword-intelligence-app | done | Research orchestrator + persist |
| 2026-06-25 | aeo-metrics | done | Share of voice, citation rate |
| 2026-06-25 | keywords-api | done | /api/keywords + /api/intelligence |
| 2026-06-25 | intelligence-migration | done | 0015_intelligence.sql |
| 2026-06-25 | keywords-intelligence-ui | done | Keywords + AEO Intel tabs |
| 2026-06-25 | wiring-intelligence | done | Architecture in WIRING_GUIDE |

**Phase 6 manifest complete — Intelligence Spine live with OmniData + SERP keys.**

## Phase 7 — Production Launch

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-25 | vercel-encryption-key | done | INTEGRATION_ENCRYPTION_KEY on Vercel production |
| 2026-06-25 | prod-setup-script | done | npm run prod:setup + prod:deploy |
| 2026-06-25 | health-intelligence | done | intelligence_schema + intelligence_api checks |
| 2026-06-25 | weekly-intelligence-cron | done | Monday 04:00 UTC Inngest sync |
| 2026-06-25 | pseo-keyword-seed | done | seedFromKeywords from keyword_opportunities |
| 2026-06-25 | setup-checklist-v7 | done | 0015 + intelligence steps |
| 2026-06-25 | verify-prod-intelligence | done | verify:prod reports schema + API |
| 2026-06-25 | incremental-migrations | done | run-migration.mjs applies pending files |

**Phase 7 complete — verify:prod PASS (89%). Run db:migrate with DATABASE_URL for 0015.**

## Phase 8 — Beat AEO Engine (Waves A–E)

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-25 | on-page-automation | done | 6 agents + daily cron 02:00 UTC + WordPress CMS apply |
| 2026-06-25 | internal-link-cms | done | Weekly Tuesday scan + approve/apply via WordPress |
| 2026-06-25 | bulk-indexing-ui | done | IndexNow + Bing bulk submit on Distribution tab |
| 2026-06-25 | distribution-kanban | done | Kanban board by content asset status |
| 2026-06-25 | free-tools-expansion | done | Canonical, sitemap, citation planner, ROI calc |
| 2026-06-25 | public-audit-v2 | done | Coverage grid + authority gaps on /audit |
| 2026-06-25 | link-building-campaigns | done | Monthly cron 10th + 55/25/20 anchor mix |
| 2026-06-25 | reddit-quora-tracker | done | CSV import on Authority tab |
| 2026-06-25 | omnidata-maps-serp | done | `/v3/serp/google/maps/live` via Serper places |
| 2026-06-25 | serp-history-redis | done | `GET /v3/rank_tracker/history/:key` |
| 2026-06-25 | content-repurpose-chain | done | `POST /api/content` action `repurpose_chain` |
| 2026-06-25 | coverage-map-ui | done | New Coverage project tab |
| 2026-06-25 | friday-report-v2 | done | 8 sub-scores + ads equivalent in PDF report |
| 2026-06-25 | phase8-migration | done | `0016_phase8.sql` indexing, link orders, community mentions |

**Phase 8 manifest complete — `npm run verify:all` PASS. `0016_phase8.sql` applied to production DB.**

## Phase 8 wiring pass (complete)

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-25 | ui-wiring | done | Link building, repurpose chain, indexing log, internal link CMS apply, rank history |
| 2026-06-25 | health-phase8 | done | `phase8_schema` check in /api/health + setup checklist |
| 2026-06-25 | migrate-prod-0016 | done | Fixed migrate-production.mjs for Windows paths; 0016 applied |
| 2026-06-25 | wire-diy-expanded | done | OmniData, encryption, IndexNow, Phase 8 crons in wire:diy |

## Phase 9 (complete)

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-25 | prompt-campaign-ui | done | Prompts tab + funnel clustering |
| 2026-06-25 | gsc-prompt-import | done | `import_gsc` action + batch insert 500 rows |
| 2026-06-25 | blog-pipeline-ui | done | 14-step tracker on Content tab |
| 2026-06-25 | llm-referral-chart | done | `/api/attribution/referrals` + chart |
| 2026-06-25 | visitor-identity | done | visitor_sessions + Clearbit optional |
| 2026-06-25 | embed-widget-v2 | done | brand/color/logo query params |
| 2026-06-25 | nap-consistency | done | Entity tab NAP scan |
| 2026-06-25 | guarantee-traffic-rules | done | Qualified traffic rules UI |
| 2026-06-25 | podcast-audio-stub | done | `/api/podcast/generate` OpenAI TTS |
| 2026-06-25 | prompt-heatmap | done | Category ownership grid on Visibility |
| 2026-06-25 | phase9-migration | done | `0017_phase9.sql` visitor_sessions |
| 2026-06-25 | phase9-wiring-docs | done | `npm run audit:phase9` |

**Phase 9 manifest complete — `0017_phase9.sql` applied to production DB.**

## Phase 9 production pass (complete)

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-25 | phase9-health | done | `phase9_schema` in /api/health + setup checklist |
| 2026-06-25 | migrate-prod-0017 | done | visitor_sessions applied via db:migrate:prod |
| 2026-06-25 | prod-deploy | done | Vercel production READY |
| 2026-06-25 | verify-prod | done | 100% ready, phase8 + phase9 schema ok |
| 2026-06-25 | wiring-audit | done | Whitelabel embed, podcast TTS, audit:full, WIRING_GUIDE Phase 9 |

**Full stack audit:** `npm run production:ready` — local CI + e2e + live audit:full + wire:diy.

## Sovereign 200x Machine (manifest v24.0.0)

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-28 | sourcegraph | done | Wave A: source-graph schema/engine/api/UI (custom SVG graph) |
| 2026-06-28 | merchant-visibility | done | Wave B: product_visibility_snapshots + Shopping/AI probes + merchant UI |
| 2026-06-28 | ai-ui-capture | done | Wave C: Playwright capture microservice + grounding_mode=ui_capture |
| 2026-06-28 | war-room-dashboards | done | Wave D: War Room, Proof Ledger, agency cockpit |
| 2026-06-28 | snapshots-quality | done | Wave E: gsc/gbp/ai_visibility snapshots + data_quality_scores + daily cron |
| 2026-06-28 | claims-harness | done | Wave F: claims registry + forbidden guard + benchmark.mjs in verify:all + deterministic refund shield |
| 2026-06-28 | provider-router | done | Wave H: unified capability router (health/cost/confidence/failover) + ZERO_PAID_KEYS + serp-router delegation |
| 2026-06-28 | sovereign-data | done | Wave I: proxy-pool scraper + multi-instance SearXNG + Common Crawl authority ranks (getDomainAuthority) + parity tests |
| 2026-06-28 | sovereign-ai | done | Wave J: generate-router (Ollama-first + editorial/structural-AEO gates + paid upgrade); generateWithAI delegates |
| 2026-06-28 | sovereign-comms | done | Wave K: SMTP email transport (DKIM) + direct X/LinkedIn posting + free IP->ASN enrichment |
| 2026-06-28 | zero-paid-keys | done | Wave L: zero-paid-keys-aware claim gates + audit:zero-paid-keys (keyless benchmark + sovereign coverage) |
| 2026-06-28 | master-ship | done | Wave M: Phase 24 spec + manifest v24 + loop skill row + .env notes; verify:all + zero-paid-keys audit green (audit:live needs real keys) |

## Production hardening (complete)

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-06-25 | production-ready-gate | done | `npm run production:ready` unified gate |
| 2026-06-25 | combined-migration-0017 | done | `db:combine` includes visitor_sessions |
| 2026-06-25 | capabilities-v0.4.0 | done | Clearbit provider + phase9 production checks |


## ship-10-10 2026-07-01T14:42:36.908Z
```json
{
  "at": "2026-07-01T14:42:36.908Z",
  "gate": "10/10",
  "steps": {
    "verify:all": true,
    "ship-infra": "skipped",
    "generate-case-studies": true
  }
}
```

## ship-10-10 2026-07-01T17:39:32.718Z
```json
{
  "at": "2026-07-01T17:39:32.718Z",
  "gate": "NOT_READY",
  "steps": {
    "verify:all": true,
    "ship-infra": true,
    "railway:verify": false,
    "production:ready": true,
    "check-claims-backed": false,
    "generate-case-studies": true
  }
}
```

## Vercel + Railway production stack 2026-07-01T17:55:00.000Z
```json
{
  "at": "2026-07-01T17:55:00.000Z",
  "railway": {
    "volume": "omnipresence-engine-volume @ /data (5GB hobby — Live Resize to 20GB+ recommended for full DuckDB index)",
    "services": {
      "omnipresence-engine": "https://omnipresence-engine-production.up.railway.app",
      "omnidata-worker": "deployed (node dist/worker.js, Redis + shared secrets)",
      "ai-ui-capture": "https://ai-ui-capture-production.up.railway.app (Supabase evidence upload wired)"
    },
    "webgraph": {
      "release": "cc-main-2024-aug-sep-oct",
      "ingest": "streaming in progress (vertices → edges → ranks, no gzip staging)",
      "status_endpoint": "/v3/backlinks/webgraph/status"
    }
  },
  "vercel": {
    "url": "https://omnipresence-engine.vercel.app",
    "COMMONCRAWL_WEBGRAPH_RELEASE": "cc-main-2024-aug-sep-oct",
    "redeployed": true
  },
  "github_secrets": ["SMOKE_BASE_URL", "OMNIDATA_BASE_URL", "OMNIDATA_API_KEY", "AI_UI_CAPTURE_URL"],
  "gates": {
    "railway:verify": true,
    "production:ready": true,
    "check-claims-backed_strict": "11/12 (attribution_proof needs GOOGLE_CLIENT_ID/SECRET)",
    "ship:pilot": true,
    "ship:case-studies_strict": true
  },
  "blockers": [
    "Google Cloud OAuth app for GSC/GA4 (attribution_proof claim 12/12)",
    "Webgraph ingest runtime ~30–90 min; confirm webgraph_ready:true when complete"
  ]
}
```

## Production hardening 2026-07-01T21:05:00.000Z
```json
{
  "at": "2026-07-01T21:05:00.000Z",
  "fixes": [
    "Auth: /auth/callback + signup emailRedirectTo + login callback errors (useSyncExternalStore)",
    "Webgraph: isWebgraphReady requires meta counts > 0 + not in-flight; test seeds meta",
    "Webgraph: client getWebgraphStatus rejects ready when counts=0 or ingest running",
    "Lint: login page no setState-in-effect",
    "ensure-prod-env: skip false OMNIDATA missing when live /api/health shows ok"
  ],
  "gates": {
    "verify:all": true,
    "production:ready": true,
    "railway:verify": true,
    "check-claims-backed_strict": "11/12 (attribution_proof needs Google OAuth)",
    "webgraph_ingest": "~810M+ edges streamed; deploy OmniData fix after edges complete"
  },
  "user_action": [
    "Supabase → Auth → URL config: Site URL + redirect https://omnipresence-engine.vercel.app/auth/callback",
    "Optional: GOOGLE_CLIENT_ID/SECRET for attribution_proof 12/12",
    "Optional: Railway volume Live Resize to 20GB+ if ENOSPC during ingest"
  ]
}
```

## ship-10-10 2026-07-01T21:22:16.692Z
```json
{
  "at": "2026-07-01T21:22:16.692Z",
  "gate": "NOT_READY",
  "steps": {
    "verify:all": true,
    "ship-infra": "skipped",
    "railway:verify": true,
    "production:ready": false,
    "check-claims-backed": false,
    "generate-case-studies": true
  }
}
```

## ship-10-10 2026-07-01T21:44:03.509Z
```json
{
  "at": "2026-07-01T21:44:03.509Z",
  "gate": "NOT_READY",
  "steps": {
    "verify:all": true,
    "ship-infra": "skipped",
    "railway:verify": true,
    "production:ready": true,
    "check-claims-backed": false,
    "generate-case-studies": true
  }
}
```

## Audit email wiring 2026-07-02T16:58:00.000Z
```json
{
  "at": "2026-07-02T16:58:00.000Z",
  "phase": "audit_report_email",
  "resend": {
    "from": "onboarding@resend.dev",
    "owner_inbox": "redabaquechame58@gmail.com",
    "vercel_env": ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "EMAIL_FROM", "RESEND_OWNER_EMAIL"]
  },
  "code": {
    "audit_route": "await sendAuditLeadEmail; returns emailSent (+ emailError in debug)",
    "production_check": "email ok when hasResendCapability || hasSmtpCapability",
    "scripts": ["ensure-email-env.mjs", "verify-audit-email.mjs", "provision-resend-key.mjs"]
  },
  "gates": {
    "email:verify": true,
    "api_health_email": "ok",
    "production_score": 100
  },
  "proof": {
    "POST /api/public/audit": "emailSent: true for owner inbox",
    "GET /api/health": "production.checks.email = ok"
  }
}
```

### Custom domain unlock (send to ANY lead email)

Resend test sender `onboarding@resend.dev` only delivers to the **Resend account owner** inbox. To email arbitrary visitors from `/audit`:

1. Purchase/connect a domain (e.g. `presenceos.app`) on Vercel Domains or Cloudflare.
2. Resend dashboard → **Domains** → Add domain → copy SPF + DKIM DNS records.
3. Add DNS records at your registrar; wait for Resend verification (green).
4. Update Vercel env (`.env.providers` then `npm run env:push`):
   - `RESEND_FROM_EMAIL=reports@yourdomain.com`
   - `EMAIL_FROM=reports@yourdomain.com`
5. Redeploy: `node scripts/ensure-email-env.mjs --deploy`
6. Re-run gate with a **non-owner** test address: `RESEND_OWNER_EMAIL=other@example.com npm run email:verify`

Optional follow-up: `scripts/ensure-email-domain.mjs` (DNS checklist + Resend verification poll).

## ship-10-10 2026-07-02T19:06:34.848Z
```json
{
  "at": "2026-07-02T19:06:34.848Z",
  "gate": "10/10",
  "steps": {
    "verify:all": true,
    "ship-infra": "skipped",
    "railway:verify": true,
    "webgraph:verify": true,
    "production:ready": true,
    "check-claims-backed": true,
    "email:verify": true,
    "generate-case-studies": true
  }
}
```

## Railway Pro + full webgraph 2026-07-02T20:00:00.000Z
```json
{
  "at": "2026-07-02T20:00:00.000Z",
  "phase": "railway_pro_full_webgraph",
  "railway": {
    "plan": "Pro ($20/mo)",
    "project": "omnipresence-engine",
    "volume": "omnipresence-engine-volume @ /data (5GB cap shown — Live Resize to 20GB+ recommended in dashboard)",
    "ingest_mode": "full",
    "release": "cc-main-2024-aug-sep-oct",
    "WEBGRAPH_WIPE_ON_START": false
  },
  "ingest": {
    "status": "re-ingesting after container restart",
    "note": "First run completed 1,679,689,064 edges then restart + WIPE wiped index — WIPE disabled",
    "vertices_first_run": 96021021,
    "edges_first_run": 1679689064,
    "eta_minutes": "90-120"
  },
  "scripts_added": [
    "scripts/verify-webgraph.mjs",
    "scripts/ensure-railway-webgraph.mjs",
    "scripts/ingest-provider-keys.mjs"
  ],
  "gates": {
    "verify:all": true,
    "ship:10-10": "10/10",
    "production:ready": true,
    "railway:verify": true,
    "email:verify": true,
    "webgraph:verify_strict": "pending ingest completion"
  },
  "key_onboarding": "npm run keys:ingest -- --push --verify"
}
```

### Key checklist (paste into `.env.providers` when ready)

| Priority | Keys | Unlocks |
|----------|------|---------|
| P0 | `OPENAI_API_KEY`, `SERPER_API_KEY` | AI citations + live SERP |
| P1 | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | GSC/GA4 attribution (12/12 claims) |
| P1 | `PAGESPEED_API_KEY` | Core Web Vitals in technical audit |
| P2 | `FIRECRAWL_API_KEY`, `BRAVE_SEARCH_API_KEY` | Scrape + alternate SERP |
| P2 | Custom domain + Resend DNS | Audit emails to any visitor |

Run: `npm run keys:ingest -- --push --verify`

### After webgraph ingest completes

1. `WEBGRAPH_REQUIRE_FULL=1 npm run webgraph:verify`
2. `npm run ship:10-10 -- --skip-infra`
3. Railway dashboard → Live Resize volume to 20GB+ for headroom

## ship-10-10 2026-07-02T23:37:19.581Z
```json
{
  "at": "2026-07-02T23:37:19.581Z",
  "gate": "10/10",
  "steps": {
    "verify:all": true,
    "ship-infra": "skipped",
    "railway:verify": true,
    "webgraph:verify": true,
    "production:ready": true,
    "check-claims-backed": true,
    "email:verify": true,
    "generate-case-studies": true
  }
}
```
