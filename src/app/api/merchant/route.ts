import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { MerchantPostSchema } from "@/lib/validation/schemas";
import { getOrganizationPlan, hasMerchantAccess } from "@/lib/plans/limits";
import {
  parseProductFeed,
  auditProduct,
  optimizeProduct,
  buildProductJsonLd,
  type FeedFormat,
} from "@/lib/engines/merchant-feed";
import { runProductVisibility, getProductVisibility } from "@/lib/engines/product-visibility";

async function getProjectOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string
): Promise<string | null> {
  const { data } = await supabase.from("projects").select("organization_id").eq("id", projectId).single();
  return data?.organization_id ?? null;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: products } = await supabase
    .from("merchant_products")
    .select("*")
    .eq("project_id", projectId)
    .order("score", { ascending: true })
    .limit(500);

  const rows = products || [];
  const averageScore = rows.length
    ? Math.round(rows.reduce((s, p) => s + (p.score || 0), 0) / rows.length)
    : 0;

  const visibility = await getProductVisibility(projectId);

  return NextResponse.json({ products: rows, summary: { total: rows.length, averageScore }, visibility });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, MerchantPostSchema);
  if (v.response) return v.response;
  const { projectId, action, content, format, optimize, optimizeLimit } = v.data;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const orgId = await getProjectOrg(supabase, projectId);
  if (!orgId) return apiError("Project not found", 404);
  const plan = await getOrganizationPlan(supabase, orgId);
  if (!hasMerchantAccess(plan)) {
    return apiError("The Merchant/Shopping engine requires a higher plan tier.", 402);
  }

  // Product / Shopping AI visibility scan (no feed upload required).
  if (action === "visibility") {
    const result = await runProductVisibility(projectId);
    return NextResponse.json(result);
  }

  if (!content || !format) return apiError("content and format (xml|tsv) required");

  const products = parseProductFeed(content, format as FeedFormat).slice(0, 1000);
  if (products.length === 0) return apiError("No products parsed from feed");

  const audits = products.map(auditProduct);

  // Optionally LLM-optimize the lowest-scoring products (bounded for cost).
  const optimizeN = optimize ? Math.min(Number(optimizeLimit ?? 20), 50) : 0;
  const toOptimize = [...audits].sort((a, b) => a.score - b.score).slice(0, optimizeN);
  const optimizationById = new Map<string, { title: string; description: string }>();
  for (const a of toOptimize) {
    const opt = await optimizeProduct(a.product);
    if (opt.source === "ai") {
      optimizationById.set(a.product.id, {
        title: opt.optimizedTitle,
        description: opt.optimizedDescription,
      });
    }
  }

  const now = new Date().toISOString();
  const rows = audits.map((a) => {
    const opt = optimizationById.get(a.product.id);
    return {
      project_id: projectId,
      product_id: a.product.id,
      title: a.product.title,
      description: a.product.description,
      optimized_title: opt?.title ?? null,
      optimized_description: opt?.description ?? null,
      brand: a.product.brand ?? null,
      price: a.product.price ?? null,
      issues: a.issues,
      score: a.score,
      json_ld: buildProductJsonLd(a.product),
      data_source: "measured",
      audited_at: now,
    };
  });

  await supabase.from("merchant_products").upsert(rows, { onConflict: "project_id,product_id" });

  // Track the worst products as execution tasks (dedup on source_module+source_id).
  const taskSeeds = audits
    .filter((a) => a.issues.some((i) => i.severity === "critical" || i.severity === "high"))
    .slice(0, 100)
    .map((a) => ({
      project_id: projectId,
      organization_id: orgId,
      title: `Fix Shopping feed: ${a.product.title || a.product.id}`,
      description: a.issues.map((i) => `${i.field}: ${i.message}`).join("; "),
      source_module: "merchant" as const,
      source_id: a.product.id,
      category: "merchant",
      priority: a.issues.some((i) => i.severity === "critical") ? ("high" as const) : ("medium" as const),
      impact: Math.max(0, 100 - a.score),
      effort: 1,
      status: "todo" as const,
    }));

  if (taskSeeds.length) {
    const { data: existing } = await supabase
      .from("execution_tasks")
      .select("source_id")
      .eq("project_id", projectId)
      .eq("source_module", "merchant");
    const seen = new Set((existing || []).map((e) => e.source_id));
    const toInsert = taskSeeds.filter((t) => !seen.has(t.source_id));
    if (toInsert.length) await supabase.from("execution_tasks").insert(toInsert);
  }

  const averageScore = audits.length
    ? Math.round(audits.reduce((s, a) => s + a.score, 0) / audits.length)
    : 0;
  const issueCounts = new Map<string, number>();
  for (const a of audits) for (const i of a.issues) issueCounts.set(i.field, (issueCounts.get(i.field) || 0) + 1);
  const topIssues = [...issueCounts.entries()]
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return NextResponse.json({
    success: true,
    totalProducts: products.length,
    averageScore,
    optimized: optimizationById.size,
    topIssues,
  });
}
