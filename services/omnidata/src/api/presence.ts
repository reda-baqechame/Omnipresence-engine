/**
 * Proprietary PresenceOS namespace (`/v1/presence/*`).
 *
 * The `/v3/*` routes exist purely for DataForSEO-shaped wire compatibility. This
 * namespace is our OWN first-class contract for the capabilities incumbents don't
 * have a clean equivalent for — sovereign authority, the URL-level Presence
 * Backlink Graph, competitor link intersection, AI-aware SERP intelligence, and
 * keyword difficulty driven by the Common Crawl webgraph. Responses are clean
 * `{ ok, capability, data, provenance }` envelopes (not DFS task wrappers), so
 * the product can evolve them without breaking compatibility consumers.
 */
import { Router } from "express";
import { runSerpLive } from "../engines/serp.js";
import { runBacklinkGraph, runLinkIntersection } from "../engines/backlink-graph.js";
import { estimateKeywordDifficulty } from "../engines/keyword-difficulty.js";
import { runMapsLive } from "../engines/maps-serp.js";
import { getDomainAuthority, getReferringDomainCount, isWebgraphReady } from "../engines/webgraph.js";

const presence = Router();

function ok(capability: string, data: unknown, provenance = "measured") {
  return { ok: true, capability, provenance, data };
}
function bad(capability: string, message: string) {
  return { ok: false, capability, error: message };
}

function cleanDomain(raw: string): string {
  return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
}

/** Capability discovery — lets the app introspect what this node can do. */
presence.get("/v1/presence/capabilities", async (_req, res) => {
  const webgraphReady = await isWebgraphReady().catch(() => false);
  res.json(
    ok("capabilities", {
      version: "1.0.0",
      capabilities: [
        { name: "serp", path: "/v1/presence/serp", method: "POST" },
        { name: "authority", path: "/v1/presence/authority", method: "POST" },
        { name: "backlink_graph", path: "/v1/presence/backlink-graph", method: "POST" },
        { name: "link_intersection", path: "/v1/presence/link-intersection", method: "POST" },
        { name: "keyword_difficulty", path: "/v1/presence/keyword-difficulty", method: "POST" },
        { name: "local_maps", path: "/v1/presence/local-maps", method: "POST" },
      ],
      webgraph_ready: webgraphReady,
    })
  );
});

presence.post("/v1/presence/serp", async (req, res) => {
  const body = req.body as unknown;
  const item = (Array.isArray(body) ? body[0] : body) as { keyword?: string; location?: string } | undefined;
  const keyword = item?.keyword;
  if (!keyword) return res.status(400).json(bad("serp", "keyword required"));
  const result = await runSerpLive(keyword, item?.location || "United States");
  res.json(ok("serp", result.tasks[0]?.result ?? null));
});

presence.post("/v1/presence/authority", async (req, res) => {
  const body = (req.body as { domain?: string; target?: string }) || {};
  const raw = body.domain || body.target;
  if (!raw) return res.status(400).json(bad("authority", "domain required"));
  const domain = cleanDomain(raw);
  const [authority, referringDomains, ready] = await Promise.all([
    getDomainAuthority(domain),
    getReferringDomainCount(domain),
    isWebgraphReady(),
  ]);
  res.json(
    ok(
      "authority",
      {
        target: domain,
        authority: authority?.authority ?? null,
        harmonic_pos: authority?.harmonic_pos ?? null,
        pr_pos: authority?.pr_pos ?? null,
        referring_domains: referringDomains ?? null,
      },
      ready && authority ? "measured" : "unavailable"
    )
  );
});

presence.post("/v1/presence/backlink-graph", async (req, res) => {
  const body = (req.body as { domain?: string; target?: string; maxSources?: number }) || {};
  const raw = body.domain || body.target;
  if (!raw) return res.status(400).json(bad("backlink_graph", "domain required"));
  const maxSources = Math.max(1, Math.min(body.maxSources ?? 40, 100));
  const result = await runBacklinkGraph(cleanDomain(raw), maxSources);
  res.json(ok("backlink_graph", result));
});

presence.post("/v1/presence/link-intersection", async (req, res) => {
  const body = (req.body as { domain?: string; target?: string; competitors?: string[]; minOverlap?: number }) || {};
  const raw = body.domain || body.target;
  if (!raw || !Array.isArray(body.competitors) || body.competitors.length === 0) {
    return res.status(400).json(bad("link_intersection", "domain and competitors[] required"));
  }
  const minOverlap = Math.max(1, Math.min(body.minOverlap ?? 2, body.competitors.length));
  const result = await runLinkIntersection(cleanDomain(raw), body.competitors, minOverlap);
  res.json(ok("link_intersection", result));
});

presence.post("/v1/presence/keyword-difficulty", async (req, res) => {
  const keyword = (req.body as { keyword?: string })?.keyword;
  if (!keyword) return res.status(400).json(bad("keyword_difficulty", "keyword required"));
  const result = await estimateKeywordDifficulty(keyword);
  res.json(ok("keyword_difficulty", result));
});

presence.post("/v1/presence/local-maps", async (req, res) => {
  const body = (req.body as { keyword?: string; location?: string }) || {};
  if (!body.keyword) return res.status(400).json(bad("local_maps", "keyword required"));
  const result = await runMapsLive(body.keyword, body.location || "United States");
  res.json(ok("local_maps", result, result.source === "none" ? "unavailable" : "measured"));
});

export default presence;
