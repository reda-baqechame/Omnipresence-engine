# Free & Open-Source Tool Catalog ("No Strings" Data Moat)

This is the operator-facing proof that the OmniPresence 100X data moat carries
**no hidden cost**. Every tool below is either fully keyless, free-token, or a
permissively/copyleft-licensed package you self-host. Each provider follows the
refund-safety doctrine: when a key/instance is missing it returns
`available:false` / `unavailable` — **never a fabricated zero**.

Legend:
- **Access** — `keyless` (no auth), `free-token` (free API key/registration), or `self-host` (you run it).
- **Fallback** — what the platform does when the tool is not configured.

## NPM packages (bundled)

| Tool | License | Used for | Access | Fallback |
|------|---------|----------|--------|----------|
| `wink-nlp` + `wink-eng-lite-web-model` | MIT | Content optimizer terms/entities, editorial QA | bundled | always on |
| `@huggingface/transformers` (all-MiniLM-L6-v2) | Apache-2.0 / MIT | Semantic embeddings (OmniData) | self-host (optional dep) | `available:false` → lexical only |
| `franc-min` | MIT | Language detection (editorial QA) | bundled | always on |
| `cheerio` | MIT | Accessibility/HTML/Rich-Results parsing | bundled | always on |
| `robots-parser` | MIT | robots.txt analysis | bundled | always on |
| `recharts` | MIT | CWV/score trend charts | bundled | always on |

## Keyless data sources (no auth, no key)

| Source | License/Terms | Used for | Fallback |
|--------|---------------|----------|----------|
| GDELT DOC 2.0 | Open data | News/brand monitoring | `unavailable` |
| Google News RSS | Public feed | News monitoring | `unavailable` |
| Google/YouTube/Bing/Amazon/Play autocomplete | Public endpoints | Keyword universe | source skipped |
| Google Trends (related queries) | Public | Demand/keyword universe | `unavailable` |
| Hacker News (Algolia) | Free API | Community mentions | `[]` |
| Stack Exchange API | CC-BY-SA data, keyless | Community mentions | `[]` |
| Bluesky public AppView | Public API | Social mentions | `[]` |
| Mastodon (public tag timeline) | AGPL service, public | Social mentions | `[]` |
| Wikipedia / Wikidata / DBpedia | CC-BY-SA / CC0 | Entity/KG grounding | `[]` / `unavailable` |
| OpenStreetMap Nominatim + Overpass | ODbL | Local geocoding + competitors | `available:false` |
| W3C Nu HTML Checker | Free API | HTML validity | finding skipped |
| Common Crawl | Open data | Backlinks/webgraph (OmniData) | `unavailable` |

> **Usage etiquette:** Nominatim/Overpass/W3C are courtesy public services with
> rate limits and a required descriptive `User-Agent` (set). For heavy/agency
> volume, self-host these (all are open-source) — documented in `DEPLOY.md`.

## Free-token sources (free registration, graceful fallback)

| Source | License/Terms | Env | Used for | Fallback |
|--------|---------------|-----|----------|----------|
| Microsoft Clarity | Free product | `CLARITY_API_TOKEN` (per-project) | Behavioral analytics | `available:false` |
| YouTube Data API v3 | Free quota | `YOUTUBE_API_KEY` | Video SEO channel coverage | SERP-only opportunities |
| Chrome UX Report / PageSpeed | Free quota | `CRUX_API_KEY` / `PAGESPEED_API_KEY` | CWV history + Lighthouse | `available:false` |
| Google Knowledge Graph Search | Free key | `GOOGLE_KG_API_KEY` | Entity panel presence | keyless Wikidata/DBpedia only |
| Product Hunt | Free dev token | `PRODUCTHUNT_TOKEN` | Mentions | source skipped |
| GitHub Search | Keyless (low) / free token (high) | `GITHUB_TOKEN` | Mentions | low-rate keyless |
| Stack Exchange | Optional key (higher quota) | `STACKEXCHANGE_KEY` | Mentions | keyless |
| Reddit API | Free app creds | `REDDIT_CLIENT_ID/SECRET` | Mentions | keyless `site:reddit.com` SERP |

## Self-hosted services (open-source, you run them — zero per-call cost)

| Service | License | Env | Used for | Fallback |
|---------|---------|-----|----------|----------|
| SearXNG | **AGPL-3.0** | `SEARXNG_URL` | Keyless SERP source | next SERP provider in router |
| Ollama (+ open model) | MIT (models vary: Llama/Mistral/Qwen) | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Free AI-visibility probe (`model_knowledge`) | paid LLM path / skip |
| PostHog | MIT | `POSTHOG_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_HOST` | First-party traffic/funnels (GA4-free) | other attribution sources |
| LanguageTool | **LGPL-3.0** | `LANGUAGETOOL_URL` | Grammar/style (editorial QA) | public API (rate-limited) |
| OmniData (this repo) | project | `OMNIDATA_BASE_URL` | SERP/backlinks/crawl/embeddings | per-feature `unavailable` |
| Metabase (optional) | AGPL-3.0 / Enterprise | n/a (BI) | Agency dashboards | Looker Studio connector |

## 200x activation engines (license-verified "steroids")

These are the research-backed techniques wired in during the 200x activation. To
avoid any copyleft/runtime risk, permissively-licensed *approaches* are
re-implemented natively in this repo (no GPL/AGPL/NC code is linked into the
bundle); optional self-host services stay network-isolated behind env flags.

| Capability | Source technique | License | How it ships here | Fallback |
|------------|------------------|---------|-------------------|----------|
| Measured GEO rewrite loop | **AutoGEO** (paper +21–51% gen-engine visibility) | MIT (code + Qwen weights) | Distilled rule set in `src/lib/engines/autogeo.ts`; rewrite via `passage-rewriter`; optional `AutoGEO_mini` Qwen served by Ollama (`GEO_REWRITE_USE_OLLAMA`) | answer-first rewrite without AutoGEO rules |
| Deep schema.org / Rich Results validation | **@adobe/structured-data-validator** + Google Rich Results rules | Apache-2.0 | Native dependency-free validator `src/lib/engines/schema-validation.ts` (per-type required/recommended + eligibility) | shallow `@context`/`@type` check |
| Topic clustering | **BERTopic** + UMAP + HDBSCAN | MIT / BSD-3 / BSD-3 | Native c-TF-IDF + agglomerative implementation in `services/omnidata/src/engines/clustering.ts` (`POST /v3/clustering/topics/live`) | greedy clustering in `semantic.ts` |
| Embeddings upgrade | **BGE-M3** / Qwen3-Embedding-0.6B | MIT / Apache-2.0 | `EMBEDDINGS_MODEL` env in OmniData (`Xenova/bge-m3`) | `all-MiniLM-L6-v2` default |
| Merchant / Shopping feed optimization | **FeedGen** approach (titles/attributes via LLM) | Apache-2.0 (approach ported, not the Apps Script harness) | `src/lib/engines/merchant-feed.ts` + `/api/merchant` | `available:false` (plan-gated) |
| AEO prompt observability | **Langfuse** (self-host) | MIT core | First-party `ai_probe_traces` is source of truth; optional mirror via `LANGFUSE_*` env | Supabase-only trace store |
| Headless SPA crawl depth | **Katana** (ProjectDiscovery) | MIT | Optional sidecar; enable with `KATANA_URL` for OmniData JS-render crawl | Playwright/static crawl in OmniData |

> **AutoGEO weights note:** the `cx-cmu/AutoGEO_mini_Qwen1.7B_*` weights are MIT
> and may be pulled into Ollama. The default path uses the distilled rule set as
> an instruction to the existing `ai-gateway` LLMs — zero added infra.

## Copyleft notes ("no strings" caveats)

These are free and fine for an internal, self-hosted SaaS backend, but they are
**copyleft** — documented so there are no surprises:

- **SearXNG (AGPL-3.0)** — running it as a network service you don't distribute
  is fine; if you distribute a modified SearXNG you must share source.
- **LanguageTool (LGPL-3.0)** — used over HTTP as a separate service (no
  linking), so no copyleft obligation on this codebase.
- **Matomo (GPL-2.0)** and **Metabase (AGPL-3.0)** — optional alternatives;
  same network-service reasoning. Prefer **PostHog (MIT)** to avoid copyleft.
- **Ollama models** — Llama (Meta license), Mistral/Qwen (Apache-2.0). Check the
  specific model's license for commercial use; Apache-2.0 models are safest.

Everything **bundled into this application** is MIT/Apache-2.0 (permissive). All
copyleft tools are **optional, network-isolated services** behind env flags.
