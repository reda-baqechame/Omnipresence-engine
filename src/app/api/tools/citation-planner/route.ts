import { NextRequest, NextResponse } from "next/server";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError, readJsonBody } from "@/lib/security/api-response";

export async function POST(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "tools-citation-planner", 20, 60 * 60 * 1000);
  if (limited) return limited;

  let brand: string | undefined, industry: string | undefined, location: string | undefined;
  try {
    ({ brand, industry, location } = await readJsonBody(request));
  } catch {
    return apiError("Invalid JSON body");
  }
  if (!brand || !industry) return apiError("brand and industry required");

  const loc = location ? String(location).slice(0, 80) : "your area";
  const b = String(brand).slice(0, 80);
  const ind = String(industry).slice(0, 80);

  const prompts = [
    `Who is the best ${ind} in ${loc}?`,
    `Compare top ${ind} providers in ${loc}`,
    `Is ${b} a good ${ind} company?`,
    `Alternatives to ${b} for ${ind}`,
    `What do reviews say about ${b}?`,
    `${b} vs competitors ${ind}`,
    `How to choose a ${ind} in ${loc}`,
    `Reddit recommendations for ${ind} ${loc}`,
  ];

  const surfaces = [
    { platform: "ChatGPT / Perplexity", priority: "high", action: "Earn citations in AI answers" },
    { platform: "Google AI Overview", priority: "high", action: "Structured FAQ + authority pages" },
    { platform: "Reddit", priority: "medium", action: "Authentic community mentions" },
    { platform: "Quora", priority: "medium", action: "Expert answers linking to hub content" },
    { platform: "Industry directories", priority: "high", action: "Complete NAP + reviews" },
  ];

  return NextResponse.json({ brand: b, industry: ind, location: loc, prompts, surfaces });
}
