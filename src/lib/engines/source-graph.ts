/**
 * Source/Citation Graph engine (Phase 23 / manifest v24, Wave A).
 *
 * Turns the already-MEASURED citation data (citation_sources + ai_probe_traces)
 * into a traversable, market-specific graph:
 *
 *   prompt_cluster -> prompt -> engine -> cited source domain -> competitor / brand
 *
 * and a normalized, influence-scored source dimension + a ranked opportunity list.
 * This is the part that beats a generic backlink index: it answers "who does AI
 * learn from in THIS market, who is cited, where is the brand absent, and which
 * source — if influenced — would change the answer?"
 *
 * Honesty: nothing here is invented. If there are no measured citations yet, the
 * graph is empty and the API returns available:false with a reason. Source
 * authority is left unscored (null) rather than faked when not enriched.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { logProviderError } from "@/lib/observability/log";

type SourceType =
  | "directory"
  | "community"
  | "listicle"
  | "review"
  | "news"
  | "video"
  | "wiki"
  | "social"
  | "other";

const DIRECTORY_HINTS = ["g2.com", "capterra", "crunchbase", "producthunt", "trustpilot", "getapp", "softwareadvice", "yelp", "clutch.co"];
const COMMUNITY_HINTS = ["reddit.com", "quora.com", "news.ycombinator", "stackoverflow", "stackexchange"];
const REVIEW_HINTS = ["trustpilot", "g2.com", "yelp", "ratemds", "tripadvisor"];
const NEWS_HINTS = ["techcrunch", "forbes", "businessinsider", "nytimes", "theverge", "wired", "reuters", "bloomberg"];
const VIDEO_HINTS = ["youtube.com", "youtu.be", "vimeo.com"];
const WIKI_HINTS = ["wikipedia.org", "wikidata.org", "fandom.com"];
const SOCIAL_HINTS = ["twitter.com", "x.com", "linkedin.com", "facebook.com", "instagram.com", "tiktok.com", "medium.com"];
const LISTICLE_HINTS = ["best", "top", "review", "compare", "alternative", "vs", "list"];

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function classifySourceType(domain: string, prompts: string[]): SourceType {
  const d = domain.toLowerCase();
  if (DIRECTORY_HINTS.some((h) => d.includes(h))) return "directory";
  if (WIKI_HINTS.some((h) => d.includes(h))) return "wiki";
  if (VIDEO_HINTS.some((h) => d.includes(h))) return "video";
  if (COMMUNITY_HINTS.some((h) => d.includes(h))) return "community";
  if (REVIEW_HINTS.some((h) => d.includes(h))) return "review";
  if (NEWS_HINTS.some((h) => d.includes(h))) return "news";
  if (SOCIAL_HINTS.some((h) => d.includes(h))) return "social";
  const blob = prompts.join(" ").toLowerCase();
  if (LISTICLE_HINTS.some((h) => blob.includes(h) || d.includes(h))) return "listicle";
  return "other";
}

/** Difficulty (0-100, lower = easier to influence) and conversion value by type. */
function typeSignals(type: SourceType): { difficulty: number; reachability: number; conversion: number; tactic: string } {
  switch (type) {
    case "directory": return { difficulty: 20, reachability: 90, conversion: 70, tactic: "product_listing" };
    case "review": return { difficulty: 30, reachability: 80, conversion: 75, tactic: "review_pitch" };
    case "community": return { difficulty: 35, reachability: 75, conversion: 50, tactic: "expert_quote" };
    case "listicle": return { difficulty: 45, reachability: 60, conversion: 80, tactic: "review_pitch" };
    case "video": return { difficulty: 50, reachability: 55, conversion: 45, tactic: "data_contribution" };
    case "news": return { difficulty: 65, reachability: 40, conversion: 60, tactic: "guest_post" };
    case "wiki": return { difficulty: 70, reachability: 35, conversion: 40, tactic: "data_contribution" };
    case "social": return { difficulty: 40, reachability: 70, conversion: 35, tactic: "expert_quote" };
    default: return { difficulty: 55, reachability: 50, conversion: 50, tactic: "guest_post" };
  }
}

function classifyIntent(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/\b(buy|price|pricing|cost|deal|discount|cheap|order|coupon)\b/.test(p)) return "transactional";
  if (/\b(best|top|review|compare|vs|alternative|which|recommend)\b/.test(p)) return "commercial";
  if (/\b(login|sign in|website|official|contact|near me|hours|location)\b/.test(p)) return "navigational";
  return "informational";
}

interface RawMention {
  domain: string;
  url?: string;
  engine: string;
  promptText: string;
  citesBrand: boolean;
  citesCompetitor: boolean;
  competitorName?: string;
  position?: number;
}

/** Pull the measured mentions from citation_sources + ai_probe_traces. */
async function gatherMentions(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  projectId: string,
): Promise<RawMention[]> {
  const mentions: RawMention[] = [];

  const { data: cs } = await supabase
    .from("citation_sources")
    .select("source_domain, source_url, platform, prompt_text, cites_brand, cites_competitor, competitor_name")
    .eq("project_id", projectId)
    .limit(4000);

  for (const r of cs || []) {
    const domain = (r.source_domain || "").toLowerCase().replace(/^www\./, "");
    if (!domain) continue;
    mentions.push({
      domain,
      url: r.source_url || undefined,
      engine: r.platform || "serp",
      promptText: r.prompt_text || "",
      citesBrand: Boolean(r.cites_brand),
      citesCompetitor: Boolean(r.cites_competitor),
      competitorName: r.competitor_name || undefined,
    });
  }

  const { data: traces } = await supabase
    .from("ai_probe_traces")
    .select("engine, prompt, cited_sources, brand_cited, competitors_mentioned")
    .eq("project_id", projectId)
    .limit(2000);

  for (const t of traces || []) {
    const cited = (t.cited_sources || []) as string[];
    const competitors = (t.competitors_mentioned || []) as string[];
    for (const src of cited) {
      const domain = src.includes("://") ? hostnameFromUrl(src) : src.toLowerCase().replace(/^www\./, "");
      if (!domain) continue;
      mentions.push({
        domain,
        url: src.includes("://") ? src : undefined,
        engine: t.engine || "ai",
        promptText: t.prompt || "",
        citesBrand: Boolean(t.brand_cited),
        citesCompetitor: competitors.length > 0,
        competitorName: competitors[0],
      });
    }
  }

  return mentions;
}

export interface BuildResult {
  available: boolean;
  reason?: string;
  domains: number;
  mentions: number;
  opportunities: number;
  edges: number;
  clusters: number;
}

/** Rebuild the entire source graph for a project from measured data. */
export async function buildSourceGraph(projectId: string): Promise<BuildResult> {
  try {
    const supabase = await createServiceClient();
    const mentions = await gatherMentions(supabase, projectId);

    if (mentions.length === 0) {
      return { available: false, reason: "No measured citations yet. Run a visibility scan first.", domains: 0, mentions: 0, opportunities: 0, edges: 0, clusters: 0 };
    }

    // ---- Prompt clusters (by intent) ----
    const promptIntent = new Map<string, string>();
    const intentMembers = new Map<string, Set<string>>();
    for (const m of mentions) {
      if (!m.promptText) continue;
      if (!promptIntent.has(m.promptText)) {
        const intent = classifyIntent(m.promptText);
        promptIntent.set(m.promptText, intent);
        if (!intentMembers.has(intent)) intentMembers.set(intent, new Set());
        intentMembers.get(intent)!.add(m.promptText);
      }
    }

    // ---- Aggregate per-domain ----
    const byDomain = new Map<string, {
      ai: number; serp: number; comp: number; brand: number;
      prompts: Set<string>; competitors: Set<string>; brandCited: boolean;
    }>();
    for (const m of mentions) {
      const e = byDomain.get(m.domain) || { ai: 0, serp: 0, comp: 0, brand: 0, prompts: new Set<string>(), competitors: new Set<string>(), brandCited: false };
      const isAiEngine = /perplexity|chatgpt|claude|gemini|ai|llm|copilot|grok/i.test(m.engine);
      if (isAiEngine) e.ai += 1; else e.serp += 1;
      if (m.citesCompetitor) e.comp += 1;
      if (m.citesBrand) { e.brand += 1; e.brandCited = true; }
      if (m.promptText) e.prompts.add(m.promptText);
      if (m.competitorName) e.competitors.add(m.competitorName);
      byDomain.set(m.domain, e);
    }

    const maxAi = Math.max(1, ...[...byDomain.values()].map((v) => v.ai));
    const maxComp = Math.max(1, ...[...byDomain.values()].map((v) => v.comp));

    const now = new Date().toISOString();

    // Wipe & rebuild (idempotent per project).
    await supabase.from("source_edges").delete().eq("project_id", projectId);
    await supabase.from("source_mentions").delete().eq("project_id", projectId);
    await supabase.from("source_opportunities").delete().eq("project_id", projectId);
    await supabase.from("source_domains").delete().eq("project_id", projectId);
    await supabase.from("prompt_clusters").delete().eq("project_id", projectId);

    // ---- Persist clusters ----
    const clusterRows = [...intentMembers.entries()].map(([intent, members]) => ({
      project_id: projectId,
      label: `${intent.charAt(0).toUpperCase()}${intent.slice(1)} prompts`,
      intent,
      prompt_count: members.size,
      member_prompts: [...members].slice(0, 200),
      data_source: "measured",
    }));
    if (clusterRows.length) await supabase.from("prompt_clusters").insert(clusterRows);

    // ---- Persist source domains ----
    const domainRows = [...byDomain.entries()].map(([domain, e]) => {
      const type = classifySourceType(domain, [...e.prompts]);
      const sig = typeSignals(type);
      // Influence: citation frequency (AI-weighted) + competitor overlap + reachability.
      const aiNorm = (e.ai / maxAi) * 50;
      const compNorm = (e.comp / maxComp) * 30;
      const reachNorm = (sig.reachability / 100) * 20;
      const influence = Math.round(Math.min(100, aiNorm + compNorm + reachNorm));
      return {
        project_id: projectId,
        domain,
        source_type: type,
        ai_citation_count: e.ai,
        serp_rank_count: e.serp,
        competitor_mention_count: e.comp,
        brand_mention_count: e.brand,
        authority: null,
        authority_source: null,
        reachability: sig.reachability,
        conversion_value: sig.conversion,
        influence_score: influence,
        last_seen_at: now,
        data_source: "measured",
        confidence: 0.8,
      };
    });
    if (domainRows.length) await supabase.from("source_domains").insert(domainRows);

    // ---- Persist mentions (capped) ----
    const mentionRows = mentions.slice(0, 3000).map((m) => ({
      project_id: projectId,
      source_domain: m.domain,
      source_url: m.url || null,
      engine: m.engine,
      prompt_text: m.promptText || null,
      cites_brand: m.citesBrand,
      cites_competitor: m.citesCompetitor,
      competitor_name: m.competitorName || null,
      position: m.position ?? null,
      data_source: "measured",
    }));
    if (mentionRows.length) await supabase.from("source_mentions").insert(mentionRows);

    // ---- Opportunities: competitor-cited domains the brand is absent from ----
    const oppRows = [...byDomain.entries()]
      .filter(([, e]) => e.comp > 0 && !e.brandCited)
      .map(([domain, e]) => {
        const type = classifySourceType(domain, [...e.prompts]);
        const sig = typeSignals(type);
        const aiNorm = (e.ai / maxAi) * 50;
        const compNorm = (e.comp / maxComp) * 30;
        const reachNorm = (sig.reachability / 100) * 20;
        const influence = Math.round(Math.min(100, aiNorm + compNorm + reachNorm));
        return {
          project_id: projectId,
          source_domain: domain,
          opportunity_type: "citation_gap",
          competitor_citations: e.comp,
          brand_present: false,
          difficulty: sig.difficulty,
          influence_score: influence,
          tactic: sig.tactic,
          recommended_action: `Earn a mention on ${domain} (${type}). It is cited for ${e.competitors.size || "a"} competitor(s) across ${e.prompts.size} prompt(s) but never cites you. Tactic: ${sig.tactic.replace(/_/g, " ")}.`,
          status: "open",
          evidence: { competitors: [...e.competitors].slice(0, 8), prompts: [...e.prompts].slice(0, 8) },
          data_source: "measured",
          confidence: 0.8,
        };
      });
    if (oppRows.length) await supabase.from("source_opportunities").insert(oppRows);

    // ---- Edges ----
    const edgeKey = new Set<string>();
    const edges: Array<{
      project_id: string; edge_type: string; from_kind: string; from_key: string;
      to_kind: string; to_key: string; weight: number; metadata: Record<string, unknown>;
    }> = [];
    const pushEdge = (edge_type: string, from_kind: string, from_key: string, to_kind: string, to_key: string, weight = 1, metadata: Record<string, unknown> = {}) => {
      const k = `${edge_type}|${from_key}|${to_key}`;
      if (edgeKey.has(k)) return;
      edgeKey.add(k);
      edges.push({ project_id: projectId, edge_type, from_kind, from_key, to_kind, to_key, weight, metadata });
    };

    for (const [prompt, intent] of promptIntent.entries()) {
      pushEdge("cluster_prompt", "cluster", `cluster:${intent}`, "prompt", `prompt:${prompt}`.slice(0, 200));
    }
    for (const m of mentions.slice(0, 3000)) {
      if (m.promptText) pushEdge("prompt_engine", "prompt", `prompt:${m.promptText}`.slice(0, 200), "engine", `engine:${m.engine}`);
      pushEdge("engine_domain", "engine", `engine:${m.engine}`, "domain", `domain:${m.domain}`);
      if (m.citesCompetitor && m.competitorName) pushEdge("domain_competitor", "domain", `domain:${m.domain}`, "competitor", `competitor:${m.competitorName}`);
      if (m.citesBrand) pushEdge("domain_brand", "domain", `domain:${m.domain}`, "brand", "brand:self");
    }
    if (edges.length) await supabase.from("source_edges").insert(edges.slice(0, 4000));

    return {
      available: true,
      domains: domainRows.length,
      mentions: mentionRows.length,
      opportunities: oppRows.length,
      edges: Math.min(edges.length, 4000),
      clusters: clusterRows.length,
    };
  } catch (error) {
    logProviderError("sourceGraph.build", error, { projectId });
    return { available: false, reason: "Failed to build source graph.", domains: 0, mentions: 0, opportunities: 0, edges: 0, clusters: 0 };
  }
}

export interface GraphNode {
  id: string;
  kind: string;
  label: string;
  influence?: number;
  sourceType?: string;
  brandCited?: boolean;
}
export interface GraphEdge {
  from: string;
  to: string;
  type: string;
  weight: number;
}

/** Read the persisted graph for visualization (top-N domains by influence). */
export async function getSourceGraph(
  projectId: string,
  limit = 40,
): Promise<{ available: boolean; reason?: string; nodes: GraphNode[]; edges: GraphEdge[] }> {
  try {
    const supabase = await createServiceClient();
    const { data: domains } = await supabase
      .from("source_domains")
      .select("domain, source_type, influence_score, ai_citation_count, brand_mention_count, competitor_mention_count")
      .eq("project_id", projectId)
      .order("influence_score", { ascending: false })
      .limit(limit);

    if (!domains || domains.length === 0) {
      return { available: false, reason: "Source graph is empty. Build it after a visibility scan.", nodes: [], edges: [] };
    }

    const topDomains = new Set(domains.map((d) => `domain:${d.domain}`));
    const nodes: GraphNode[] = [];
    const nodeIds = new Set<string>();
    const addNode = (n: GraphNode) => { if (!nodeIds.has(n.id)) { nodeIds.add(n.id); nodes.push(n); } };

    for (const d of domains) {
      addNode({
        id: `domain:${d.domain}`,
        kind: "domain",
        label: d.domain,
        influence: Number(d.influence_score) || 0,
        sourceType: d.source_type,
        brandCited: (d.brand_mention_count || 0) > 0,
      });
    }

    const { data: edgeRows } = await supabase
      .from("source_edges")
      .select("edge_type, from_kind, from_key, to_kind, to_key, weight")
      .eq("project_id", projectId)
      .limit(4000);

    const edges: GraphEdge[] = [];
    for (const e of edgeRows || []) {
      // Only keep edges that touch a top domain to keep the viz legible.
      const touches = topDomains.has(e.from_key) || topDomains.has(e.to_key);
      if (!touches) continue;
      addNode({ id: e.from_key, kind: e.from_kind, label: e.from_key.split(":").slice(1).join(":").slice(0, 60) });
      addNode({ id: e.to_key, kind: e.to_kind, label: e.to_key.split(":").slice(1).join(":").slice(0, 60) });
      edges.push({ from: e.from_key, to: e.to_key, type: e.edge_type, weight: Number(e.weight) || 1 });
    }

    return { available: true, nodes, edges };
  } catch (error) {
    logProviderError("sourceGraph.get", error, { projectId });
    return { available: false, reason: "Failed to read source graph.", nodes: [], edges: [] };
  }
}

export interface SourceOpportunity {
  source_domain: string;
  opportunity_type: string;
  competitor_citations: number;
  difficulty: number;
  influence_score: number;
  tactic: string | null;
  recommended_action: string | null;
  status: string;
  evidence: Record<string, unknown>;
}

export async function getSourceOpportunities(
  projectId: string,
  limit = 50,
): Promise<{ available: boolean; reason?: string; opportunities: SourceOpportunity[] }> {
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("source_opportunities")
      .select("source_domain, opportunity_type, competitor_citations, difficulty, influence_score, tactic, recommended_action, status, evidence")
      .eq("project_id", projectId)
      .order("influence_score", { ascending: false })
      .limit(limit);

    if (!data || data.length === 0) {
      return { available: false, reason: "No source opportunities yet. Build the source graph after a scan.", opportunities: [] };
    }
    return {
      available: true,
      opportunities: data.map((o) => ({
        source_domain: o.source_domain,
        opportunity_type: o.opportunity_type,
        competitor_citations: o.competitor_citations || 0,
        difficulty: o.difficulty || 50,
        influence_score: Number(o.influence_score) || 0,
        tactic: o.tactic,
        recommended_action: o.recommended_action,
        status: o.status,
        evidence: (o.evidence as Record<string, unknown>) || {},
      })),
    };
  } catch (error) {
    logProviderError("sourceGraph.opportunities", error, { projectId });
    return { available: false, reason: "Failed to read opportunities.", opportunities: [] };
  }
}

/** Neighbors of a domain: which engines cite it, for which prompts/competitors. */
export async function getSourceNeighbors(
  projectId: string,
  domain: string,
): Promise<{ available: boolean; domain: string; engines: string[]; prompts: string[]; competitors: string[] }> {
  try {
    const supabase = await createServiceClient();
    const clean = domain.toLowerCase().replace(/^www\./, "");
    const { data } = await supabase
      .from("source_mentions")
      .select("engine, prompt_text, competitor_name, cites_competitor")
      .eq("project_id", projectId)
      .eq("source_domain", clean)
      .limit(500);

    const engines = new Set<string>();
    const prompts = new Set<string>();
    const competitors = new Set<string>();
    for (const m of data || []) {
      if (m.engine) engines.add(m.engine);
      if (m.prompt_text) prompts.add(m.prompt_text);
      if (m.cites_competitor && m.competitor_name) competitors.add(m.competitor_name);
    }
    return { available: (data || []).length > 0, domain: clean, engines: [...engines], prompts: [...prompts].slice(0, 20), competitors: [...competitors] };
  } catch (error) {
    logProviderError("sourceGraph.neighbors", error, { projectId, domain });
    return { available: false, domain, engines: [], prompts: [], competitors: [] };
  }
}

/** Path to citation for a prompt: which engines answered and which domains they cited. */
export async function getPathToCitation(
  projectId: string,
  promptText: string,
): Promise<{ available: boolean; prompt: string; engines: { engine: string; domains: string[]; brandCited: boolean }[] }> {
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("source_mentions")
      .select("engine, source_domain, cites_brand")
      .eq("project_id", projectId)
      .eq("prompt_text", promptText)
      .limit(500);

    const byEngine = new Map<string, { domains: Set<string>; brandCited: boolean }>();
    for (const m of data || []) {
      const e = byEngine.get(m.engine) || { domains: new Set<string>(), brandCited: false };
      if (m.source_domain) e.domains.add(m.source_domain);
      if (m.cites_brand) e.brandCited = true;
      byEngine.set(m.engine, e);
    }
    return {
      available: (data || []).length > 0,
      prompt: promptText,
      engines: [...byEngine.entries()].map(([engine, v]) => ({ engine, domains: [...v.domains].slice(0, 15), brandCited: v.brandCited })),
    };
  } catch (error) {
    logProviderError("sourceGraph.path", error, { projectId, promptText });
    return { available: false, prompt: promptText, engines: [] };
  }
}
