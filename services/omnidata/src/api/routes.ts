import { Router } from "express";
import { z } from "zod";
import { enqueueTask, processTask } from "../queue.js";
import { getTask, listReadyTasks } from "../store.js";
import { runSerpLive } from "../engines/serp.js";
import { runBacklinks } from "../engines/backlinks.js";
import { runKeywords } from "../engines/keywords.js";
import { runRankCheck } from "../engines/rank-tracker.js";
import { crawlSite } from "../engines/crawler.js";
import { runDomainAnalytics, runInstantPage } from "../engines/domain-analytics.js";
import { estimateKeywordDifficulty, scoreKeywordsForDomain } from "../engines/keyword-difficulty.js";
import { findContentGaps } from "../engines/content-gaps.js";
import { findBacklinkGaps } from "../engines/backlink-gaps.js";
import { runMapsLive } from "../engines/maps-serp.js";
import { getRankHistoryHydrated } from "../store.js";

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

function dfsResponse(tasks: unknown[], status = 20000) {
  return {
    version: "0.1.20240624",
    status_code: status,
    status_message: "Ok.",
    time: new Date().toISOString(),
    cost: 0,
    tasks_count: tasks.length,
    tasks_error: 0,
    tasks,
  };
}

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

router.post("/v3/keywords/suggestions/live", async (req, res) => {
  const seed = (req.body as Array<{ keyword?: string; seed?: string }>)?.[0];
  const keyword = seed?.keyword || seed?.seed;
  if (!keyword) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  const result = await runKeywords(keyword);
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
  const item = (req.body as Array<{ url?: string; max_pages?: number }>)?.[0];
  if (!item?.url) {
    res.status(400).json(dfsResponse([], 40000));
    return;
  }
  try {
    const result = await crawlSite(item.url, { maxPages: item.max_pages ?? 25 });
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
  res.json({ ok: true, service: "omnidata", version: "0.4.0" });
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
