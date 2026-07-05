#!/usr/bin/env node
/**
 * Live provider verification for OmniPresence Engine.
 *
 * Unlike check-env.mjs (which only checks PRESENCE), this script makes a REAL
 * call to each configured provider and reports OK / FAIL / not-configured, so
 * you can prove every credential actually works before (or after) deploy.
 *
 * Usage:
 *   node scripts/verify-providers.mjs                 # uses process.env + .env.local
 *   node scripts/verify-providers.mjs <path-to-env>   # parse a specific env file
 *   node --env-file=.env.vercel.production scripts/verify-providers.mjs
 *
 * Flags:
 *   --strict   exit 1 if any CONFIGURED provider fails its live probe
 *   --json     print a machine-readable JSON summary
 *
 * No secrets are ever printed.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname, isAbsolute } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const JSON_OUT = args.includes("--json");
const fileArg = args.find((a) => !a.startsWith("--"));

function parseEnvFile(path) {
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
  return true;
}

// Load env: explicit file arg first, else .env.local as a convenience.
if (fileArg) parseEnvFile(isAbsolute(fileArg) ? fileArg : join(root, fileArg));
parseEnvFile(join(root, ".env.local"));

function has(key) {
  const v = process.env[key];
  return Boolean(v && v.trim() && !v.startsWith("your-") && !v.startsWith("https://your"));
}
function val(key) {
  return (process.env[key] || "").trim();
}
function googleCloudKey() {
  for (const k of ["PAGESPEED_API_KEY", "GOOGLE_CLOUD_API_KEY", "YOUTUBE_API_KEY", "GOOGLE_KG_API_KEY", "CRUX_API_KEY"]) {
    const v = val(k);
    if (v && !v.startsWith("your-")) return v;
  }
  return "";
}
function trimSlash(u) {
  return u.replace(/\/+$/, "");
}

async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

/**
 * Provider catalog. Each entry:
 *  { name, tier, keys: [...required env vars], probe?: async () => detail-string }
 * probe must throw on failure; returning a string = OK detail. Omit probe for
 * presence-only providers (no safe/cheap live check).
 */
const PROVIDERS = [
  // ---- Core ----
  {
    name: "Supabase (DB/Auth)",
    tier: "Core",
    keys: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    probe: async () => {
      const base = trimSlash(val("NEXT_PUBLIC_SUPABASE_URL"));
      const key = val("SUPABASE_SERVICE_ROLE_KEY");
      const r = await fetchWithTimeout(`${base}/rest/v1/`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
      return "REST reachable";
    },
  },

  // ---- AI / LLM (you provide these) ----
  {
    name: "OpenAI (ChatGPT engine)",
    tier: "AI visibility",
    keys: ["OPENAI_API_KEY"],
    probe: async () => {
      const r = await fetchWithTimeout("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${val("OPENAI_API_KEY")}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return `${j.data?.length ?? 0} models`;
    },
  },
  {
    name: "Anthropic (Claude engine)",
    tier: "AI visibility",
    keys: ["ANTHROPIC_API_KEY"],
    probe: async () => {
      const r = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": val("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "models reachable";
    },
  },
  {
    name: "Google Gemini (Gemini engine)",
    tier: "AI visibility",
    keys: ["GOOGLE_GENERATIVE_AI_API_KEY"],
    probe: async () => {
      const key = val("GOOGLE_GENERATIVE_AI_API_KEY");
      if (key.startsWith("AQ.")) {
        const model = val("AI_GEMINI_MODEL") || "gemini-flash-latest";
        const r = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-goog-api-key": key },
            body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
          }
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return `express REST (${model})`;
      }
      const r = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return `${j.models?.length ?? 0} models`;
    },
  },
  {
    name: "Perplexity (grounded citations)",
    tier: "AI visibility",
    keys: ["PERPLEXITY_API_KEY"],
    probe: async () => {
      const r = await fetchWithTimeout("https://api.perplexity.ai/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${val("PERPLEXITY_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "ping", max_results: 1, max_tokens_per_page: 64 }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "search API reachable";
    },
  },

  // ---- SERP / search data ----
  {
    name: "Serper (Google SERP)",
    tier: "Search data",
    keys: ["SERPER_API_KEY"],
    probe: async () => {
      const r = await fetchWithTimeout("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": val("SERPER_API_KEY"), "Content-Type": "application/json" },
        body: JSON.stringify({ q: "test", num: 1 }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "search ok";
    },
  },
  {
    name: "Brave Search (Google SERP)",
    tier: "Search data",
    keys: ["BRAVE_SEARCH_API_KEY"],
    probe: async () => {
      const r = await fetchWithTimeout("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
        headers: { "X-Subscription-Token": val("BRAVE_SEARCH_API_KEY"), Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "search ok";
    },
  },
  {
    name: "Firecrawl (SERP + scrape)",
    tier: "Search data",
    keys: ["FIRECRAWL_API_KEY"],
    probe: async () => {
      const r = await fetchWithTimeout("https://api.firecrawl.dev/v1/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${val("FIRECRAWL_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test", limit: 1 }),
      }, 30000);
      if (r.status === 402) return "key valid (quota/billing exhausted)";
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return `search ok (${j.data?.length ?? 0} results)`;
    },
  },
  {
    name: "OpenPageRank (domain authority)",
    tier: "Search data",
    keys: [],
    probe: async () => {
      const key = (val("OPEN_PAGERANK_API_KEY") || val("API_OPR_KEY")).trim();
      if (key && !key.startsWith("your-")) {
        const r = await fetchWithTimeout(
          "https://openpagerank.com/api/v1.0/getPageRank?domains[]=google.com",
          { headers: { "API-OPR": key } }
        );
        if (r.ok) {
          const j = await r.json();
          const row = j.response?.[0];
          if (row?.status_code === 200) {
            return `OPR API (google.com PR ${row.page_rank_integer ?? "?"})`;
          }
        }
        if (r.status !== 401 && r.status !== 403) {
          throw new Error(`HTTP ${r.status}`);
        }
      }
      const rt = await fetchWithTimeout("https://rank.to/api/?d=google.com&n=7");
      if (!rt.ok) throw new Error(`rank.to fallback HTTP ${rt.status}`);
      const j = await rt.json();
      const entries = Object.entries(j.ranks || {}).filter(([, v]) => typeof v === "number");
      if (!entries.length) throw new Error("rank.to returned no data");
      const rank = entries[entries.length - 1][1];
      return `rank.to fallback (google.com global rank ${rank})`;
    },
  },
  {
    name: "Cloudflare Radar (popularity signal)",
    tier: "Search data",
    keys: ["CLOUDFLARE_RADAR_API_TOKEN"],
    probe: async () => {
      const r = await fetchWithTimeout("https://api.cloudflare.com/client/v4/user/tokens/verify", {
        headers: { Authorization: `Bearer ${val("CLOUDFLARE_RADAR_API_TOKEN")}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.success) throw new Error(j.errors?.[0]?.message || "token invalid");
      return "token valid";
    },
  },
  {
    name: "Keywords Everywhere (search volume)",
    tier: "Search data",
    keys: ["KEYWORDS_EVERYWHERE_API_KEY"],
    probe: async () => {
      const key = val("KEYWORDS_EVERYWHERE_API_KEY");
      const body = new URLSearchParams({
        dataSource: "gkp",
        country: "us",
        currency: "usd",
      });
      body.append("kw[]", "seo");
      const r = await fetchWithTimeout("https://api.keywordseverywhere.com/v1/get_keyword_data", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });
      if (r.status === 402) return "key valid (insufficient credits)";
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.data?.length) throw new Error("no keyword data");
      return `vol=${j.data[0].vol ?? 0}, credits=${j.credits ?? "?"}`;
    },
  },
  {
    name: "DataForSEO (paid SERP/keywords)",
    tier: "Search data",
    keys: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
    probe: async () => {
      const auth = Buffer.from(`${val("DATAFORSEO_LOGIN")}:${val("DATAFORSEO_PASSWORD")}`).toString("base64");
      const r = await fetchWithTimeout("https://api.dataforseo.com/v3/appendix/user_data", {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.status_code && j.status_code !== 20000) throw new Error(`status ${j.status_code}`);
      return "account ok";
    },
  },

  // ---- Google free keys ----
  {
    name: "PageSpeed / CrUX (Core Web Vitals)",
    tier: "Performance",
    keys: ["PAGESPEED_API_KEY", "GOOGLE_CLOUD_API_KEY", "CRUX_API_KEY"],
    keysMode: "any",
    probe: async () => {
      const key = googleCloudKey();
      if (!key) throw new Error("no Google Cloud API key");
      const r = await fetchWithTimeout(
        `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(key)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: "https://web.dev" }) }
      );
      // 200 = data, 404 = no CrUX data for origin but key is valid. 400/403 = key/API problem.
      if (r.status === 400 || r.status === 403) throw new Error(`HTTP ${r.status} (enable CrUX API on this key)`);
      return "key valid";
    },
  },
  {
    name: "CrUX History API",
    tier: "Performance",
    keys: ["PAGESPEED_API_KEY", "GOOGLE_CLOUD_API_KEY", "CRUX_API_KEY"],
    keysMode: "any",
    probe: async () => {
      const key = googleCloudKey();
      if (!key) throw new Error("no Google Cloud API key");
      const r = await fetchWithTimeout(
        `https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: "https://web.dev",
            metrics: ["largest_contentful_paint"],
          }),
        }
      );
      // 404 = origin not in dataset but key works; 400/403 = key/API problem.
      if (r.status === 400 || r.status === 403) throw new Error(`HTTP ${r.status} (enable CrUX API on this key)`);
      return "history ok";
    },
  },
  {
    name: "YouTube Data API (video SEO)",
    tier: "Data",
    keys: ["YOUTUBE_API_KEY", "PAGESPEED_API_KEY", "GOOGLE_CLOUD_API_KEY"],
    keysMode: "any",
    probe: async () => {
      const key = googleCloudKey();
      if (!key) throw new Error("no Google Cloud API key");
      const r = await fetchWithTimeout(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&maxResults=1&key=${encodeURIComponent(key)}`
      );
      if (!r.ok) throw new Error(`HTTP ${r.status} (enable YouTube Data API on your key)`);
      return "search ok";
    },
  },
  {
    name: "Google Knowledge Graph (entities)",
    tier: "Data",
    keys: ["GOOGLE_KG_API_KEY", "PAGESPEED_API_KEY", "GOOGLE_CLOUD_API_KEY"],
    keysMode: "any",
    probe: async () => {
      const key = googleCloudKey();
      if (!key) throw new Error("no Google Cloud API key");
      const r = await fetchWithTimeout(
        `https://kgsearch.googleapis.com/v1/entities:search?query=google&limit=1&key=${encodeURIComponent(key)}`
      );
      if (!r.ok) throw new Error(`HTTP ${r.status} (enable Knowledge Graph Search API on your key)`);
      return "lookup ok";
    },
  },
  {
    name: "Google Natural Language (content entities)",
    tier: "Data",
    keys: ["PAGESPEED_API_KEY", "GOOGLE_CLOUD_API_KEY"],
    keysMode: "any",
    probe: async () => {
      const key = googleCloudKey();
      if (!key) throw new Error("no Google Cloud API key");
      const r = await fetchWithTimeout(
        `https://language.googleapis.com/v1/documents:analyzeEntities?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            document: { type: "PLAIN_TEXT", content: "OmniPresence Engine audits Core Web Vitals and AI visibility." },
            encodingType: "UTF8",
          }),
        }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status} (enable Cloud Natural Language API on your key)`);
      return "entities ok";
    },
  },

  // ---- Self-hosted / keyless services ----
  {
    name: "OmniData (self-hosted data moat)",
    tier: "Self-hosted",
    keys: ["OMNIDATA_BASE_URL"],
    probe: async () => {
      const r = await fetchWithTimeout(`${trimSlash(val("OMNIDATA_BASE_URL"))}/health`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "healthy";
    },
  },
  {
    name: "SearXNG (keyless SERP)",
    tier: "Self-hosted",
    keys: ["SEARXNG_URL"],
    probe: async () => {
      const r = await fetchWithTimeout(`${trimSlash(val("SEARXNG_URL"))}/search?q=test&format=json`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "search ok";
    },
  },
  {
    name: "Ollama (open-model AI)",
    tier: "Self-hosted",
    keys: ["OLLAMA_BASE_URL"],
    probe: async () => {
      const r = await fetchWithTimeout(`${trimSlash(val("OLLAMA_BASE_URL"))}/api/tags`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return `${j.models?.length ?? 0} models`;
    },
  },
  {
    name: "LanguageTool (editorial QA)",
    tier: "Self-hosted",
    keys: ["LANGUAGETOOL_URL"],
    probe: async () => {
      const r = await fetchWithTimeout(`${trimSlash(val("LANGUAGETOOL_URL"))}/v2/languages`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "reachable";
    },
  },
  {
    name: "Langfuse (AEO observability mirror)",
    tier: "Self-hosted",
    keys: ["LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"],
    probe: async () => {
      const r = await fetchWithTimeout(`${trimSlash(val("LANGFUSE_BASE_URL"))}/api/public/health`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "healthy";
    },
  },

  // ---- Infra / integrations ----
  {
    name: "Resend (email)",
    tier: "Infra",
    keys: ["RESEND_API_KEY"],
    probe: async () => {
      const r = await fetchWithTimeout("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${val("RESEND_API_KEY")}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "account ok";
    },
  },
  {
    name: "Stripe (billing)",
    tier: "Infra",
    keys: ["STRIPE_SECRET_KEY"],
    probe: async () => {
      const r = await fetchWithTimeout("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${val("STRIPE_SECRET_KEY")}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "account ok";
    },
  },
  {
    name: "PostHog (analytics query)",
    tier: "Infra",
    keys: ["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"],
    probe: async () => {
      const host = trimSlash(val("POSTHOG_HOST") || "https://us.posthog.com");
      const r = await fetchWithTimeout(`${host}/api/projects/${val("POSTHOG_PROJECT_ID")}/`, {
        headers: { Authorization: `Bearer ${val("POSTHOG_API_KEY")}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "project ok";
    },
  },
  {
    name: "Reddit (community mentions)",
    tier: "Data",
    keys: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
    probe: async () => {
      const auth = Buffer.from(`${val("REDDIT_CLIENT_ID")}:${val("REDDIT_CLIENT_SECRET")}`).toString("base64");
      const r = await fetchWithTimeout("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": val("REDDIT_USER_AGENT") || "omnipresence-engine/1.0",
        },
        body: "grant_type=client_credentials",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "token ok";
    },
  },
  {
    name: "GitHub (social firehose)",
    tier: "Data",
    keys: ["GITHUB_TOKEN"],
    probe: async () => {
      const r = await fetchWithTimeout("https://api.github.com/rate_limit", {
        headers: { Authorization: `Bearer ${val("GITHUB_TOKEN")}`, "User-Agent": "omnipresence-engine" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "token ok";
    },
  },

  // ---- Presence-only (no safe/cheap live probe) ----
  { name: "Inngest (background jobs)", tier: "Infra", keys: ["INNGEST_EVENT_KEY"] },
  { name: "Google OAuth (GSC/GA4)", tier: "OAuth", keys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] },
  { name: "Bing OAuth (Webmaster)", tier: "OAuth", keys: ["BING_CLIENT_ID", "BING_CLIENT_SECRET"] },
  { name: "Bing Webmaster API", tier: "Indexing", keys: ["BING_WEBMASTER_API_KEY", "BING_SITE_URL"] },
  { name: "IndexNow", tier: "Indexing", keys: ["INDEXNOW_KEY"] },
  { name: "Ayrshare (social posting)", tier: "Distribution", keys: ["AYRSHARE_API_KEY"] },
  { name: "Buffer (social posting)", tier: "Distribution", keys: ["BUFFER_ACCESS_TOKEN"] },
  { name: "Clearbit Reveal (de-anon)", tier: "Attribution", keys: ["CLEARBIT_REVEAL_KEY"] },
  { name: "Microsoft Clarity", tier: "Data", keys: ["CLARITY_API_TOKEN"] },
  { name: "Product Hunt", tier: "Data", keys: ["PRODUCTHUNT_TOKEN"] },
  { name: "Stack Exchange", tier: "Data", keys: ["STACKEXCHANGE_KEY"] },
];

const C = {
  ok: "\x1b[32m",
  fail: "\x1b[31m",
  skip: "\x1b[90m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

async function run() {
  const results = [];
  for (const p of PROVIDERS) {
    const configured =
      p.keysMode === "any" ? p.keys.some((k) => has(k)) : p.keys.every((k) => has(k));
    if (!configured) {
      results.push({ name: p.name, tier: p.tier, status: "skip", detail: "not configured" });
      continue;
    }
    if (!p.probe) {
      results.push({ name: p.name, tier: p.tier, status: "ok", detail: "configured (presence only)" });
      continue;
    }
    const t0 = Date.now();
    try {
      const detail = await p.probe();
      results.push({ name: p.name, tier: p.tier, status: "ok", detail, ms: Date.now() - t0 });
    } catch (e) {
      results.push({ name: p.name, tier: p.tier, status: "fail", detail: e.message || String(e), ms: Date.now() - t0 });
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    let lastTier = "";
    console.log(`\n${C.bold}OmniPresence Engine — Live Provider Verification${C.reset}\n`);
    for (const r of results) {
      if (r.tier !== lastTier) {
        console.log(`${C.bold}## ${r.tier}${C.reset}`);
        lastTier = r.tier;
      }
      const icon =
        r.status === "ok" ? `${C.ok}✓${C.reset}` : r.status === "fail" ? `${C.fail}✗${C.reset}` : `${C.skip}○${C.reset}`;
      const ms = r.ms != null ? ` ${C.skip}(${r.ms}ms)${C.reset}` : "";
      const color = r.status === "fail" ? C.fail : r.status === "skip" ? C.skip : "";
      console.log(`  ${icon} ${r.name} — ${color}${r.detail}${C.reset}${ms}`);
    }
    console.log("");
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "fail");
  const skipped = results.filter((r) => r.status === "skip").length;
  if (!JSON_OUT) {
    console.log(`${C.bold}Summary:${C.reset} ${C.ok}${ok} working${C.reset}, ${C.fail}${failed.length} failing${C.reset}, ${C.skip}${skipped} not configured${C.reset}\n`);
    if (failed.length) {
      console.log(`${C.fail}Failing providers need attention:${C.reset}`);
      for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
      console.log("");
    }
  }

  if (STRICT && failed.length) process.exit(1);
  process.exit(0);
}

run();
