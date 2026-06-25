import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  expandPseoMatrix,
  estimatePseoMatrixSize,
  parseCsvLines,
  parsePseoMatrixCsv,
  type PseoTemplateType,
} from "@/lib/engines/programmatic-seo";
import { generateContent } from "@/lib/engines/content-generator";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

const VALID_TYPES = new Set<PseoTemplateType>([
  "location_page",
  "service_page",
  "best_of_page",
  "comparison_page",
]);

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("pseo_campaigns")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return NextResponse.json({ campaigns: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await request.json();
  const {
    projectId,
    name,
    templateType,
    urlPattern,
    servicesCsv,
    locationsCsv,
    keywordsCsv,
    matrixCsv,
    maxPages,
    previewOnly,
    generateContent: shouldGenerate,
    seedFromKeywords,
  } = body as {
    projectId: string;
    name: string;
    templateType: PseoTemplateType;
    urlPattern?: string;
    servicesCsv?: string;
    locationsCsv?: string;
    keywordsCsv?: string;
    matrixCsv?: string;
    maxPages?: number;
    previewOnly?: boolean;
    generateContent?: boolean;
    seedFromKeywords?: boolean;
  };

  if (!projectId || !name || !templateType) {
    return apiError("projectId, name, templateType required");
  }
  if (!VALID_TYPES.has(templateType)) return apiError("Invalid templateType");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const matrix = matrixCsv ? parsePseoMatrixCsv(matrixCsv) : null;
  const services = matrix?.services.length ? matrix.services : parseCsvLines(servicesCsv || "");
  const locations = matrix?.locations.length ? matrix.locations : parseCsvLines(locationsCsv || "");

  let keywordList = matrix?.keywords.length
    ? matrix.keywords
    : keywordsCsv
      ? parseCsvLines(keywordsCsv)
      : [];

  if (!keywordList.length && seedFromKeywords) {
    const { data: opportunities } = await supabase
      .from("keyword_opportunities")
      .select("keyword")
      .eq("project_id", projectId)
      .order("opportunity_score", { ascending: false })
      .limit(30);
    keywordList = (opportunities || []).map((o) => o.keyword);
  }

  const input = {
    name,
    templateType,
    urlPattern,
    services,
    locations,
    keywords: keywordList,
    maxPages: maxPages ?? 50,
  };

  const estimated = estimatePseoMatrixSize(input);
  const specs = expandPseoMatrix(input, project.domain);

  if (previewOnly) {
    return NextResponse.json({ estimated, preview: specs.slice(0, 20), total: specs.length });
  }

  const { data: campaign, error } = await supabase
    .from("pseo_campaigns")
    .insert({
      project_id: projectId,
      name,
      template_type: templateType,
      url_pattern: urlPattern || "/{slug}",
      services,
      locations,
      keywords: keywordList,
      max_pages: maxPages ?? 50,
      status: shouldGenerate ? "generating" : "draft",
      metadata: { estimated },
    })
    .select()
    .single();

  if (error) return apiError(error.message);

  const { data: brandProfile } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("project_id", projectId)
    .single();

  let generated = 0;
  if (shouldGenerate && brandProfile) {
    for (const spec of specs.slice(0, 10)) {
      const content = await generateContent(spec.type, brandProfile, spec.topic);
      await supabase.from("content_assets").insert({
        project_id: projectId,
        title: content.title,
        type: spec.type,
        content: content.content,
        status: "drafted",
        metadata: { ...spec.metadata, pseo_campaign_id: campaign.id, target_url: spec.url },
      });
      generated++;
    }
    await supabase
      .from("pseo_campaigns")
      .update({ status: "completed", generated_count: generated, updated_at: new Date().toISOString() })
      .eq("id", campaign.id);
  }

  return NextResponse.json({ campaign, specs: specs.length, generated });
}
