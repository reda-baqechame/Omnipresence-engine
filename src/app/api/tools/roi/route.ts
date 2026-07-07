import { NextRequest, NextResponse } from "next/server";
import { calculateAdsEquivalent } from "@/lib/engines/ads-equivalent";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError, validateBody } from "@/lib/security/api-response";
import { ToolsRoiSchema } from "@/lib/validation/schemas";

export async function POST(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "tools-roi", 20, 60 * 60 * 1000);
  if (limited) return limited;

  const v = await validateBody(request, ToolsRoiSchema);
  if (v.response) return v.response;
  const { organicSessions, aiReferralSessions, monthlyAdSpend, industry, customCpc } = v.data;

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
