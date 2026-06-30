import { Router } from "express";
import { z } from "zod";
import { enqueueTask, processTask } from "../queue.js";
import { getTask, listReadyTasks } from "../store.js";
import { runSerpLive } from "../engines/serp.js";
import { runBacklinks } from "../engines/backlinks.js";
import { runBacklinkGraph, runLinkIntersection } from "../engines/backlink-graph.js";
import { runKeywords } from "../engines/keywords.js";
import { runRankCheck } from "../engines/rank-tracker.js";
import { crawlSite } from "../engines/crawler.js";
import { runDomainAnalytics, runInstantPage } from "../engines/domain-analytics.js";
import { estimateKeywordDifficulty, scoreKeywordsForDomain } from "../engines/keyword-difficulty.js";
import { findContentGaps } from "../engines/content-gaps.js";
import { findBacklinkGaps } from "../engines/backlink-gaps.js";
import { runMapsLive } from "../engines/maps-serp.js";
import { getRankHistoryHydrated } from "../store.js";
import { isWebgraphReady, getWebgraphMeta, triggerIngestAsync, isIngestInFlight, getDomainAuthority, getReferringDomainCount } from "../engines/webgraph.js";
import { getKeywordMetrics, hasKeywordPlanner, type GoogleAdsCreds } from "../engines/keyword-planner.js";
import { getTrends } from "../engines/trends.js";
import { detectTechStack } from "../engines/techstack.js";
import { runPopularity } from "../engines/popularity.js";
import { getPageSpeed } from "../engines/pagespeed.js";
import { embedTexts, isEmbeddingsReady } from "../engines/embeddings.js";
import { clusterTexts as clusterTopics } from "../engines/clustering.js";
import { dfsResponse } from "./response.js";

const router = Router();

const taskPostSchema = z.array(
  z.object({
    keyword: z.string().optional(),
    location_name: z.string().optional(),
    target: z.string().optional(),
    domain: z.string().optional(),
    seed: z.string().optional(),
    tag: z.string().optional(),
  })
);

// DataForSEO-compatible: task_post
router.post("/v3/serp/google/organic/task_post", async (req, res) => {
  const parsed = taskPostSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const tasks = await Promise.all(
    parsed.data.map(async (item) => {
      const record = await enqueueTask(item.tag || "serp", "serp/google/organic", {
        keyword: item.keyword,
        location: item.location_name || "United States",
      });
      return { id: record.id, status: "pending", tag: record.tag };
    })
  );
  res.json(dfsResponse(tasks));
});

router.get("/v3/serp/google/organic/tasks_ready", (_req, res) => {
  const ready = listReadyTasks().map((t) => ({ id: t.id, tag: t.tag }));
  res.json(dfsResponse(ready));
});

router.post("/v3/serp/google/organic/task_get/:id", async (req, res) => {
  const task = getTask(req.params.id);
  if (!task) {
    res.status(404).json(dfsResponse([], 40400));
    return;
  }
  if (task.status === "pending") await processTask(task.id);
  const updated = getTask(req.params.id)!;
  res.json(
    dfsResponse([
      {
        id: updated.id,
        status: updated.status,
        result: updated.result,
        error: updated.error,
      },
    ])
  );
});

// Live endpoint (immediate)
router.post("/v3/serp/google/organic/live/advanced", async (req, res) => {
  const parsed = taskPostSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data[0]?.keyword) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const item = parsed.data[0];
  const result = await runSerpLive(item.keyword!, item.location_name || "United States");
  res.json(dfsResponse([{ result: result.tasks[0]?.result }]));
});

router.post("/v3/backlinks/summary/live", async (req, res) => {
  const target = (req.body as Array<{ target?: string; domain?: string }>)?.[0];
  const domain = target?.target || target?.domain;
  if (!domain) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await runBacklinks(domain);
  res.json(dfsResponse([{ result: [result] }]));
});

// URL-level Presence Backlink Graph: crawl-verified links with anchor text +
// rel(nofollow/sponsored/ugc) + first/last seen, seeded from the Common Crawl
// webgraph. Heavier than /summary (it fetches source pages), so max_sources caps cost.
router.post("/v3/backlinks/graph/live", async (req, res) => {
  const item = (req.body as Array<{ target?: string; domain?: string; max_sources?: number }>)?.[0];
  const target = item?.target || item?.domain;
  if (!target) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const maxSources = Math.max(1, Math.min(item?.max_sources ?? 40, 100));
  const result = await runBacklinkGraph(target, maxSources);
  res.json(dfsResponse([{ result: [result] }]));
});

// Competitor link intersection: referring domains linking to N+ competitors,
// prioritising brand-gap sources (link to rivals but not you) — real Common
// Crawl referring-domain sets, no paid index.
router.post("/v3/backlinks/intersection/live", async (req, res) => {
  const item = (req.body as Array<{ target?: string; domain?: string; competitors?: string[]; min_overlap?: number }>)?.[0];
  const target = item?.target || item?.domain;
  if (!target || !Array.isArray(item?.competitors) || item.competitors.length === 0) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const minOverlap = Math.max(1, Math.min(item.min_overlap ?? 2, item.competitors.length));
  const result = await runLinkIntersection(target, item.competitors, minOverlap);
  res.json(dfsResponse([{ result: [result] }]));
});

// Live Common Crawl domain authority + referring-domain count. The free DR
// replacement for DataForSEO/Ahrefs: harmonic-centrality authority (0-100) plus
// the real distinct referring-domain total, straight from the ingested webgraph.
router.post("/v3/domain/authority/live", async (req, res) => {
  const item = (req.body as Array<{ target?: string; domain?: string }>)?.[0];
  const raw = item?.target || item?.domain;
  if (!raw) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const clean = raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  const [authority, referringDomains, ready] = await Promise.all([
    getDomainAuthority(clean),
    getReferringDomainCount(clean),
    isWebgraphReady(),
  ]);
  res.json(
    dfsResponse([
      {
        result: [
          {
            target: clean,
            authority: authority?.authority ?? null,
            harmonic_pos: authority?.harmonic_pos ?? null,
            pr_pos: authority?.pr_pos ?? null,
            referring_domains: referringDomains ?? null,
            data_source: ready && authority ? "commoncrawl_webgraph" : "unavailable",
          },
        ],
      },
    ])
  );
});

router.post("/v3/keywords/suggestions/live", async (req, res) => {
  const seed = (req.body as Array<{
    keyword?: string;
    seed?: string;
    geo?: string;
    language?: string;
    credentials?: GoogleAdsCreds;
  }>)?.[0];
  const keyword = seed?.keyword || seed?.seed;
  if (!keyword) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await runKeywords(keyword, {
    creds: seed?.credentials,
    geo: seed?.geo,
    language: seed?.language,
  });
  res.json(dfsResponse([{ result: [result] }]));
});

router.post("/v3/keywords/metrics/live", async (req, res) => {
  const item = (req.body as Array<{
    keywords?: string[];
    keyword?: string;
    geo?: string;
    language?: string;
    credentials?: GoogleAdsCreds;
  }>)?.[0];
  const keywords = item?.keywords || (item?.keyword ? [item.keyword] : []);
  if (!keywords.length) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const opts = { creds: item?.credentials, geo: item?.geo, language: item?.language };
  const metrics = await getKeywordMetrics(keywords, opts);
  res.json(
    dfsResponse([
      {
        result: [
          {
            data_source: hasKeywordPlanner(item?.credentials) && metrics ? "keyword_planner" : "unavailable",
            metrics: metrics || [],
          },
        ],
      },
    ])
  );
});

router.post("/v3/keywords/trends/live", async (req, res) => {
  const item = (req.body as Array<{ keyword?: string; geo?: string; timeframe?: string }>)?.[0];
  if (!item?.keyword) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await getTrends(item.keyword, item.geo || "US", item.timeframe || "today 12-m");
  res.json(dfsResponse([{ result: [result] }]));
});

router.post("/v3/rank_tracker/check/live", async (req, res) => {
  const item = (req.body as Array<{ keyword?: string; domain?: string; location_name?: string }>)?.[0];
  if (!item?.keyword || !item?.domain) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await runRankCheck(item.keyword, item.domain, item.location_name);
  res.json(dfsResponse([{ result: [result] }]));
});

router.post("/v3/on_page/crawl", async (req, res) => {
  const item = (req.body as Array<{ url?: string; max_pages?: number; js_render?: boolean }>)?.[0];
  if (!item?.url) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  try {
    const result = await crawlSite(item.url, {
      maxPages: item.max_pages ?? 25,
      jsRender: item.js_render,
    });
    res.json(dfsResponse([{ result: [result] }]));
  } catch (err) {
    res.status(400).json({
      ...dfsResponse([], 40001),
      status_message: err instanceof Error ? err.message : "Crawl failed",
    });
  }
});

router.post("/v3/keywords/difficulty/live", async (req, res) => {
  const keyword = (req.body as Array<{ keyword?: string }>)?.[0]?.keyword;
  if (!keyword) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await estimateKeywordDifficulty(keyword);
  res.json(dfsResponse([{ result: [result] }]));
});

router.post("/v3/labs/content_gaps/live", async (req, res) => {
  const item = (req.body as Array<{ domain?: string; competitors?: string[]; seeds?: string[] }>)?.[0];
  if (!item?.domain) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const gaps = await findContentGaps(
    item.domain,
    item.competitors || [],
    item.seeds || [item.domain.split(".")[0]]
  );
  res.json(dfsResponse([{ result: [{ gaps, total: gaps.length }] }]));
});

router.post("/v3/backlinks/gap/live", async (req, res) => {
  const item = (req.body as Array<{ domain?: string; competitors?: string[] }>)?.[0];
  if (!item?.domain) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const gaps = await findBacklinkGaps(item.domain, item.competitors || []);
  res.json(dfsResponse([{ result: [{ gaps, total: gaps.length }] }]));
});

router.post("/v3/labs/keyword_opportunities/live", async (req, res) => {
  const item = (req.body as Array<{ domain?: string; keywords?: string[] }>)?.[0];
  if (!item?.domain || !item?.keywords?.length) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const scored = await scoreKeywordsForDomain(item.keywords, item.domain);
  res.json(dfsResponse([{ result: [{ opportunities: scored }] }]));
});

router.post("/v3/serp/google/maps/live", async (req, res) => {
  const item = (req.body as Array<{ keyword?: string; location_name?: string }>)?.[0];
  if (!item?.keyword) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await runMapsLive(item.keyword, item.location_name || "United States");
  res.json(dfsResponse([{ result: [result] }]));
});

router.get("/v3/rank_tracker/history/:key", async (req, res) => {
  const history = await getRankHistoryHydrated(decodeURIComponent(req.params.key));
  res.json(dfsResponse([{ result: [{ history }] }]));
});

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "omnidata", version: "0.5.0" });
});

// Local semantic embeddings (keyless transformers.js).
router.post("/v3/embeddings/batch", async (req, res) => {
  const item = (req.body as Array<{ texts?: string[] }>)?.[0];
  const texts = item?.texts || [];
  if (!Array.isArray(texts) || texts.length === 0) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await embedTexts(texts.slice(0, 64));
  res.json(dfsResponse([{ result: [result] }]));
});

router.get("/v3/embeddings/status", async (_req, res) => {
  const ready = await isEmbeddingsReady();
  res.json(dfsResponse([{ result: [{ embeddings_ready: ready }] }]));
});

router.post("/v3/clustering/topics/live", async (req, res) => {
  const item = (req.body as Array<{ texts?: string[]; threshold?: number }>)?.[0];
  const texts = item?.texts || [];
  if (!Array.isArray(texts) || texts.length === 0) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await clusterTopics(texts.slice(0, 400), item?.threshold);
  res.json(dfsResponse([{ result: [result] }]));
});

router.get("/v3/backlinks/webgraph/status", async (_req, res) => {
  const ready = await isWebgraphReady();
  const meta = await getWebgraphMeta();
  res.json(
    dfsResponse([
      {
        result: [
          {
            webgraph_ready: ready,
            ingest_in_progress: isIngestInFlight(),
            release: meta?.release ?? null,
            ingested_at: meta?.ingested_at ?? null,
            vertex_count: meta?.vertex_count ?? 0,
            edge_count: meta?.edge_count ?? 0,
          },
        ],
      },
    ])
  );
});

// Admin/scheduled re-ingest of a Common Crawl webgraph release. Heavy: runs in
// the background and returns 202. Auth is enforced by the global middleware.
router.post("/v3/backlinks/webgraph/ingest", async (req, res) => {
  const release = (req.body as Array<{ release?: string }>)?.[0]?.release;
  if (!release) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const out = triggerIngestAsync(release);
  res
    .status(out.accepted ? 202 : 409)
    .json(dfsResponse([{ result: [{ accepted: out.accepted, reason: out.reason ?? null }] }]));
});

router.post("/v3/domain_analytics/overview/live", async (req, res) => {
  const domain = (req.body as Array<{ target?: string; domain?: string }>)?.[0]?.target
    || (req.body as Array<{ target?: string; domain?: string }>)?.[0]?.domain;
  if (!domain) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await runDomainAnalytics(domain);
  res.json(dfsResponse([{ result: [result] }]));
});

router.post("/v3/domain/popularity/live", async (req, res) => {
  const domain = (req.body as Array<{ target?: string; domain?: string }>)?.[0]?.target
    || (req.body as Array<{ target?: string; domain?: string }>)?.[0]?.domain;
  if (!domain) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await runPopularity(domain);
  res.json(dfsResponse([{ result: [result] }]));
});

// Real-user Core Web Vitals (CrUX) + lab performance through the unified spine.
router.post("/v3/performance/pagespeed/live", async (req, res) => {
  const item = (req.body as Array<{ url?: string; target?: string; strategy?: "mobile" | "desktop" }>)?.[0];
  const url = item?.url || item?.target;
  if (!url) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await getPageSpeed(url, item?.strategy === "desktop" ? "desktop" : "mobile");
  res.json(dfsResponse([{ result: [result] }]));
});

router.post("/v3/tech/detect", async (req, res) => {
  const url = (req.body as Array<{ url?: string; target?: string }>)?.[0]?.url
    || (req.body as Array<{ url?: string; target?: string }>)?.[0]?.target;
  if (!url) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await detectTechStack(url);
  res.json(dfsResponse([{ result: [result] }]));
});

router.post("/v3/on_page/instant_pages", async (req, res) => {
  const url = (req.body as Array<{ url?: string }>)?.[0]?.url;
  if (!url) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  try {
    const result = await runInstantPage(url);
    res.json(dfsResponse([{ result: [result] }]));
  } catch (err) {
    res.status(400).json({
      ...dfsResponse([], 40001),
      status_message: err instanceof Error ? err.message : "Instant page failed",
    });
  }
});

export default router;
