import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { requireService } from "../_lib/env.ts";
import { inTopK, normalizeDomain } from "../_lib/score.ts";
import { omnidataPost } from "../_lib/omnidata.ts";

/**
 * Accuracy audit for the sovereign SERP replacement (SearXNG keyless meta-search
 * and the OmniData scrape path), our replacement for paid SERP APIs
 * (Serper/DataForSEO). Ground truth = tests/golden/serp/serp.golden.json
 * (stable branded/navigational #1s). Skips when no SERP provider is configured;
 * fails when one IS configured but returns the wrong top domains.
 */

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "serp.golden.json"), "utf8")) as {
  topDomainInTop3Floor: number;
  exactTop1Floor: number;
  cases: Array<{ query: string; domain: string }>;
};

function searxngInstances(): string[] {
  const multi = process.env.SEARXNG_URLS || "";
  const single = process.env.SEARXNG_URL || "";
  return [...multi.split(","), single]
    .map((u) => u.trim().replace(/\/+$/, ""))
    .filter((u) => u.length > 0 && !u.startsWith("your-"));
}

/** Fetch ranked organic domains for a query from any configured sovereign SERP path. */
async function rankedDomains(query: string): Promise<string[] | null> {
  // Prefer SearXNG (mirrors src/lib/providers/searxng.ts request shape).
  for (const base of searxngInstances()) {
    try {
      const params = new URLSearchParams({
        q: query,
        format: "json",
        language: "en-US",
        safesearch: "0",
        categories: "general",
      });
      const res = await fetch(`${base}/search?${params}`, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: Array<{ url?: string }> };
      const urls = (data.results || []).map((r) => r.url).filter((u): u is string => Boolean(u));
      if (urls.length > 0) return dedupeDomains(urls);
    } catch {
      /* try next instance */
    }
  }
  // Fallback: OmniData scrape SERP.
  const r = await omnidataPost<{ items?: Array<{ url?: string; domain?: string }> }>(
    "/serp/google/organic/live",
    [{ keyword: query, location_name: "United States" }]
  );
  if (r && Array.isArray(r.items) && r.items.length > 0) {
    return dedupeDomains(r.items.map((i) => i.domain || i.url || "").filter(Boolean));
  }
  return null;
}

function dedupeDomains(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const d = normalizeDomain(u);
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

test("SERP: known navigational #1s land in the top results (no parser/ranking drift)", async (t) => {
  const svc = requireService("serp");
  if (!svc.ok) {
    t.skip(`no SERP provider configured — ${svc.reason}`);
    return;
  }

  let audited = 0;
  let inTop3 = 0;
  let exactTop1 = 0;
  const misses: string[] = [];

  for (const c of golden.cases) {
    const ranked = await rankedDomains(c.query);
    if (!ranked || ranked.length === 0) continue;
    audited += 1;
    if (inTopK(ranked, c.domain, 3)) inTop3 += 1;
    else misses.push(`${c.query}→${ranked.slice(0, 3).join(",")} (want ${c.domain})`);
    if (normalizeDomain(ranked[0]) === normalizeDomain(c.domain)) exactTop1 += 1;
  }

  if (audited < Math.ceil(golden.cases.length * 0.6)) {
    t.skip(`SERP provider returned results for only ${audited}/${golden.cases.length} queries`);
    return;
  }

  const top3Rate = inTop3 / audited;
  const top1Rate = exactTop1 / audited;
  assert.ok(
    top3Rate >= golden.topDomainInTop3Floor,
    `top-3 hit rate ${top3Rate.toFixed(2)} < floor ${golden.topDomainInTop3Floor}; misses: ${misses.join(" | ")}`
  );
  assert.ok(
    top1Rate >= golden.exactTop1Floor,
    `exact-#1 rate ${top1Rate.toFixed(2)} < floor ${golden.exactTop1Floor}`
  );
});
