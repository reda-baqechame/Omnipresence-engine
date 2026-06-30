import { NextRequest, NextResponse } from "next/server";
import { AI_BOTS } from "@/lib/providers/ai-gateway";
import robotsParser from "robots-parser";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError, readJsonBody } from "@/lib/security/api-response";

export async function POST(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "tools-robots", 15, 60 * 60 * 1000);
  if (limited) return limited;

  let domain: string | undefined;
  try {
    ({ domain } = await readJsonBody(request));
  } catch {
    return apiError("Invalid JSON body");
  }
  if (!domain) return apiError("Domain required");

  let normalized: string;
  try {
    normalized = assertPublicDomain(domain);
  } catch (error) {
    if (error instanceof DomainValidationError) return apiError(error.message);
    return apiError("Invalid domain");
  }

  const baseUrl = `https://${normalized}`;
  const robotsUrl = `${baseUrl}/robots.txt`;
  const bots: Array<{ name: string; allowed: boolean }> = [];

  try {
    const response = await fetch(robotsUrl, { signal: AbortSignal.timeout(10000) });
    const robotsTxt = response.ok ? await response.text() : "";
    const robots = robotsParser(robotsUrl, robotsTxt);

    for (const bot of AI_BOTS) {
      bots.push({ name: bot, allowed: robots.isAllowed(baseUrl, bot) !== false });
    }
  } catch {
    for (const bot of AI_BOTS) {
      bots.push({ name: bot, allowed: true });
    }
  }

  return NextResponse.json({ bots, domain: normalized });
}
