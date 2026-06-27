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
