import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiForbidden, apiNotFound, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { generatePageSchema, validateSchemaLocally } from "@/lib/engines/schema-engine";
import { recordLedgerAction } from "@/lib/engines/results-ledger";
import type { BrandProfile, Project } from "@/types/database";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, pageUrl, pageTitle, pageContent } = await readJsonBody(request);
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (!project) return apiNotFound();

  const { data: brand } = await supabase.from("brand_profiles").select("*").eq("project_id", projectId).single();

  // Pull reconciled identity (Wikidata/Wikipedia/G2/Crunchbase) so the generated
  // Organization schema carries the full sameAs graph, not just social links.
  const { data: entity } = await supabase
    .from("entity_profiles")
    .select("same_as_map, wikidata_qid")
    .eq("project_id", projectId)
    .maybeSingle();

  const entitySameAs = entity?.same_as_map
    ? Object.values(entity.same_as_map as Record<string, string>).filter(Boolean)
    : [];

  const schema = await generatePageSchema({
    project: project as Project,
    brand: (brand || {}) as BrandProfile,
    pageUrl: pageUrl || `https://${project.domain}`,
    pageTitle: pageTitle || project.name,
    pageContent,
    entitySameAs,
    wikidataQid: entity?.wikidata_qid || undefined,
  });

  const validation = await validateSchemaLocally(schema.jsonLd);

  const { data: deployment } = await supabase
    .from("schema_deployments")
    .insert({
      project_id: projectId,
      page_url: pageUrl || `https://${project.domain}`,
      schema_types: schema.schemaTypes,
      json_ld: schema.jsonLd,
      validation_status: validation.valid ? "valid" : "invalid",
    })
    .select()
    .single();

  await recordLedgerAction(supabase, {
    project_id: projectId,
    action_type: "schema_generated",
    action_surface: "website",
    description: `Generated ${schema.schemaTypes.join(", ")} schema for ${pageUrl || project.domain}`,
    status: "completed",
    outcome_snapshot: { validation, deploymentId: deployment?.id },
  });

  return NextResponse.json({ schema, validation, deployment });
}
