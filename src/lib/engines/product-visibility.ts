/**
 * Product / Shopping AI visibility engine (Phase 23 / manifest v24, Wave B).
 *
 * Goes beyond feed QA (merchant-feed.ts): measures whether the brand's products
 * actually surface where shoppers look —
 *   - Google Shopping / organic SERP for buy-intent queries  -> data_source "measured"
 *   - AI product recommendations ("best <category>", "what should I buy")
 *     via parametric LLM answers                              -> data_source "model_knowledge"
 *
 * Honest by construction: with no SERP/LLM capability configured the run returns
 * available:false (never a fake zero), and parametric AI answers are labeled
 * model_knowledge rather than passed off as grounded measurement.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { logProviderError } from "@/lib/observability/log";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { queryLLMForVisibility } from "@/lib/providers/ai-gateway";
import { hasSerpCapability, hasDirectLLMCapability } from "@/lib/config/capabilities";

function hasEnv(key: string): boolean {
  const v = process.env[key];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

function pickAiProvider(): "openai" | "gemini" | "claude" | "ollama" | null {
  if (hasEnv("OPENAI_API_KEY")) return "openai";
  if (hasEnv("GOOGLE_GENERATIVE_AI_API_KEY")) return "gemini";
  if (hasEnv("ANTHROPIC_API_KEY")) return "claude";
  if (hasEnv("OLLAMA_BASE_URL")) return "ollama";
  return null;
}

/** Build a small, buy-intent query set from the merchant feed (or category fallback). */
function buildQueries(productTitles: string[], industry: string, limit = 6): string[] {
  const queries = new Set<string>();
  for (const title of productTitles.slice(0, limit)) {
    const clean = title.replace(/\s+/g, " ").trim().slice(0, 70);
    if (clean) queries.add(`best ${clean}`);
  }
  if (queries.size < limit && industry) {
    queries.add(`best ${industry} products`);
    queries.add(`recommended ${industry} products to buy`);
  }
  return [...queries].slice(0, limit);
}

export interface ProductVisibilityResult {
  available: boolean;
  reason?: string;
  queries: number;
  snapshots: number;
  serpPresenceRate: number | null;
  aiPresenceRate: number | null;
}

export async function runProductVisibility(projectId: string): Promise<ProductVisibilityResult> {
  try {
    const supabase = await createServiceClient();
    const serpOn = hasSerpCapability();
    const llmProvider = hasDirectLLMCapability() || hasEnv("OLLAMA_BASE_URL") ? pickAiProvider() : null;

    if (!serpOn && !llmProvider) {
      return {
        available: false,
        reason: "No SERP or AI provider configured — connect Serper/Brave/OmniData or an LLM key.",
        queries: 0,
        snapshots: 0,
        serpPresenceRate: null,
        aiPresenceRate: null,
      };
    }

    const { data: project } = await supabase
      .from("projects")
      .select("name, domain, industry, location, competitors")
      .eq("id", projectId)
      .single();
    if (!project) {
      return { available: false, reason: "Project not found.", queries: 0, snapshots: 0, serpPresenceRate: null, aiPresenceRate: null };
    }

    const competitors = (project.competitors || []) as string[];
    const brandDomain = project.domain as string;
    const brandName = (project.name as string) || brandDomain;
    const location = (project.location as string) || "United States";

    const { data: products } = await supabase
      .from("merchant_products")
      .select("title")
      .eq("project_id", projectId)
      .limit(12);
    const titles = (products || []).map((p) => p.title as string).filter(Boolean);
    const queries = buildQueries(titles, (project.industry as string) || "", 6);
    if (queries.length === 0) {
      return { available: false, reason: "No products or category to query. Import a feed first.", queries: 0, snapshots: 0, serpPresenceRate: null, aiPresenceRate: null };
    }

    const now = new Date().toISOString();
    const rows: Array<Record<string, unknown>> = [];
    let serpChecks = 0, serpHits = 0, aiChecks = 0, aiHits = 0;

    for (const query of queries) {
      if (serpOn) {
        const serp = await searchGoogleOrganicRouter(query, location, brandDomain, competitors);
        if (serp.success && serp.data) {
          serpChecks += 1;
          const present = serp.data.brandInResults;
          if (present) serpHits += 1;
          const brandPos = serp.data.organicResults.find((r) => {
            try { return new URL(r.url).hostname.replace(/^www\./, "").includes(brandDomain.replace(/^www\./, "")); }
            catch { return false; }
          })?.position;
          const competitorsPresent = Object.entries(serp.data.competitorInResults || {})
            .filter(([, v]) => v)
            .map(([k]) => k);
          rows.push({
            project_id: projectId,
            query,
            surface: "shopping_serp",
            engine: serp.provider || "serp",
            brand_present: present,
            position: brandPos ?? null,
            competitors_present: competitorsPresent,
            cited_urls: (serp.data.aiOverview?.citedUrls || []).slice(0, 10),
            data_source: "measured",
            confidence: 0.9,
            captured_at: now,
          });
        }
      }

      if (llmProvider) {
        const probe = await queryLLMForVisibility(llmProvider, query, brandName, brandDomain, competitors);
        if (probe.success && probe.data) {
          aiChecks += 1;
          const present = probe.data.brandMentioned;
          if (present) aiHits += 1;
          const competitorsPresent = Object.entries(probe.data.competitorMentions || {})
            .filter(([, v]) => v)
            .map(([k]) => k);
          rows.push({
            project_id: projectId,
            query,
            surface: "ai_recommendation",
            engine: llmProvider,
            brand_present: present,
            position: null,
            competitors_present: competitorsPresent,
            cited_urls: [],
            data_source: "model_knowledge",
            confidence: 0.6,
            captured_at: now,
          });
        }
      }
    }

    if (rows.length === 0) {
      return { available: false, reason: "Probes returned no measurable results (provider error or rate limit).", queries: queries.length, snapshots: 0, serpPresenceRate: null, aiPresenceRate: null };
    }

    await supabase.from("product_visibility_snapshots").insert(rows);

    return {
      available: true,
      queries: queries.length,
      snapshots: rows.length,
      serpPresenceRate: serpChecks ? Math.round((serpHits / serpChecks) * 100) : null,
      aiPresenceRate: aiChecks ? Math.round((aiHits / aiChecks) * 100) : null,
    };
  } catch (error) {
    logProviderError("productVisibility.run", error, { projectId });
    return { available: false, reason: "Product visibility run failed.", queries: 0, snapshots: 0, serpPresenceRate: null, aiPresenceRate: null };
  }
}

export interface ProductVisibilitySnapshotRow {
  query: string;
  surface: string;
  engine: string;
  brand_present: boolean;
  position: number | null;
  competitors_present: string[];
  data_source: string;
  captured_at: string;
}

export async function getProductVisibility(projectId: string): Promise<{
  available: boolean;
  reason?: string;
  serpPresenceRate: number | null;
  aiPresenceRate: number | null;
  snapshots: ProductVisibilitySnapshotRow[];
}> {
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("product_visibility_snapshots")
      .select("query, surface, engine, brand_present, position, competitors_present, data_source, captured_at")
      .eq("project_id", projectId)
      .order("captured_at", { ascending: false })
      .limit(200);

    const rows = (data || []) as ProductVisibilitySnapshotRow[];
    if (rows.length === 0) {
      return { available: false, reason: "No product visibility data yet. Run a product visibility scan.", serpPresenceRate: null, aiPresenceRate: null, snapshots: [] };
    }

    // Use only the most recent capture batch for the headline rates.
    const latestCapture = rows[0].captured_at;
    const latest = rows.filter((r) => r.captured_at === latestCapture);
    const serp = latest.filter((r) => r.surface === "shopping_serp");
    const ai = latest.filter((r) => r.surface === "ai_recommendation");
    const rate = (set: ProductVisibilitySnapshotRow[]) =>
      set.length ? Math.round((set.filter((r) => r.brand_present).length / set.length) * 100) : null;

    return {
      available: true,
      serpPresenceRate: rate(serp),
      aiPresenceRate: rate(ai),
      snapshots: rows.slice(0, 60),
    };
  } catch (error) {
    logProviderError("productVisibility.get", error, { projectId });
    return { available: false, reason: "Failed to read product visibility.", serpPresenceRate: null, aiPresenceRate: null, snapshots: [] };
  }
}
