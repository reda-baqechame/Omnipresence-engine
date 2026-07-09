import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { SerpExplorerSchema } from "@/lib/validation/schemas";
import {
  routeSerpIntelligence,
  isSerpIntelligenceAvailable,
  serpIntelligenceUnavailableReason,
} from "@/lib/providers/serp-intelligence-router";
import { recordMeasurementEvidence } from "@/lib/engines/evidence";
import { logProviderError } from "@/lib/observability/log";

const SERP_PARSER_VERSION = "serp-intel@1";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, SerpExplorerSchema);
  if (v.response) return v.response;
  const { projectId, keyword } = v.data;
  const location = v.data.location || "United States";
  const device = v.data.device === "mobile" ? "mobile" : "desktop";

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  if (!isSerpIntelligenceAvailable()) {
    return NextResponse.json({
      available: false,
      reason: serpIntelligenceUnavailableReason(),
    });
  }

  const serp = await routeSerpIntelligence(keyword.trim(), location, device);
  if (!serp) {
    return NextResponse.json({
      available: false,
      reason: "The SERP backend returned no results for this query (try again or adjust location/device).",
    });
  }

  await recordMeasurementEvidence(supabase, {
    projectId,
    capability: "serp",
    target: `${keyword.trim()} | ${location} | ${device}`,
    provider: serp.provider,
    sourceUrl: `https://www.google.com/search?q=${encodeURIComponent(keyword.trim())}`,
    parserVersion: SERP_PARSER_VERSION,
    dataSource: "measured",
    rawPayload: serp,
    excerpt: {
      organic: serp.organic.length,
      ads: serp.ads.length,
      paa: serp.peopleAlsoAsk.length,
      local_pack: serp.localPack.length,
      features: serp.featureTypes,
      ai_overview: Boolean(serp.aiOverview?.present),
    },
  }).catch((e) => logProviderError("serpExplorer.recordEvidence", e, { projectId, keyword }));

  return NextResponse.json({ available: true, serp });
}
