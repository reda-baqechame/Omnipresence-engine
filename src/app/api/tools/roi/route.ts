import { NextRequest, NextResponse } from "next/server";
import { calculateAdsEquivalent } from "@/lib/engines/ads-equivalent";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError, readJsonBody } from "@/lib/security/api-response";

export async function POST(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "tools-roi", 20, 60 * 60 * 1000);
  if (limited) return limited;

  let organicSessions: unknown;
  let aiReferralSessions: unknown;
  let monthlyAdSpend: unknown;
  let industry: unknown;
  let customCpc: unknown;
  try {
    ({ organicSessions, aiReferralSessions, monthlyAdSpend, industry, customCpc } = await readJsonBody(request));
  } catch {
    return apiError("Invalid JSON body");
  }

  if (monthlyAdSpend === undefined && organicSessions === undefined) {
    return apiError("monthlyAdSpend or organicSessions required");
  }

  const result = calculateAdsEquivalent({
    organicSessions: Number(organicSessions) || 0,
    aiReferralSessions: Number(aiReferralSessions) || 0,
    monthlyAdSpend: Number(monthlyAdSpend) || 0,
    industry: industry ? String(industry) : undefined,
    customCpc: customCpc !== undefined && customCpc !== null ? Number(customCpc) : undefined,
  });

  return NextResponse.json({
    ...result,
    methodology:
      result.cpcSource === "real"
        ? "ROI uses your supplied CPC (real Keyword Planner or custom CPC)."
        : "ROI uses industry-benchmark CPC estimates — not measured auction data. Pass customCpc for real Keyword Planner CPC.",
  });
}
