import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { getSerpIntelligence, isOmniDataActive } from "@/lib/providers/dataforseo";
import { getActiveSerpProvider } from "@/lib/providers/serp-router";
import { recordMeasurementEvidence } from "@/lib/engines/evidence";
import { logProviderError } from "@/lib/observability/log";

const SERP_PARSER_VERSION = "serp-intel@1";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  let body: { projectId?: string; keyword?: string; location?: string; device?: "desktop" | "mobile" };
  try {
    body = await readJsonBody(request);
  } catch {
    return apiError("Invalid JSON body");
  }
  const { projectId, keyword } = body;
  const location = body.location || "United States";
  const device = body.device === "mobile" ? "mobile" : "desktop";
  if (!projectId || !keyword?.trim()) return apiError("projectId and keyword required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  // Honest availability: a real SERP backend (OmniData sovereign or DataForSEO) must be active.
  const provider = getActiveSerpProvider();
  if (!isOmniDataActive() && provider !== "omnidata" && provider !== "dataforseo") {
    return NextResponse.json({
      available: false,
      reason: "SERP intelligence needs the sovereign OmniData SERP backend (set OMNIDATA_BASE_URL) or DataForSEO.",
    });
  }

  const serp = await getSerpIntelligence(keyword.trim(), location, device);
  if (!serp) {
    return NextResponse.json({
      available: false,
      reason: "The SERP backend returned no results for this query (try again or adjust location/device).",
    });
  }

  // Persist tamper-evident evidence of the captured SERP.
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
