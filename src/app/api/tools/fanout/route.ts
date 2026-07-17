import { NextRequest, NextResponse } from "next/server";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError, validateBody } from "@/lib/security/api-response";
import { ToolsFanoutSchema } from "@/lib/validation/schemas";
import { deriveFanoutSubqueries, runFanoutInterception } from "@/lib/engines/fanout-interceptor";
import { hasSerpCapability } from "@/lib/config/capabilities";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";

/**
 * Free query fan-out micro-tool (Master Plan v4 feature 10 — LLMrefs lists
 * this tool but theirs 404s; ours works). Given a prompt, show the Google
 * sub-queries an AI engine would fan it out into; with a domain, also check
 * where that domain ranks for each sub-query (measured via the SERP router).
 */
export async function POST(request: NextRequest) {
  // Tighter cap than other tools: this one can spend LLM + SERP calls.
  const limited = await guardPublicEndpoint(request, "tools-fanout", 10, 60 * 60 * 1000);
  if (limited) return limited;

  const v = await validateBody(request, ToolsFanoutSchema);
  if (v.response) return v.response;
  const { prompt, domain } = v.data;

  let normalizedDomain: string | null = null;
  if (domain) {
    try {
      normalizedDomain = assertPublicDomain(domain);
    } catch (error) {
      if (error instanceof DomainValidationError) return apiError(error.message);
      return apiError("Invalid domain");
    }
  }

  if (normalizedDomain && hasSerpCapability()) {
    const result = await runFanoutInterception(prompt, normalizedDomain);
    return NextResponse.json({
      prompt,
      domain: normalizedDomain,
      available: result.available,
      subqueries: result.subqueries,
      retrievableCount: result.retrievableCount,
      coverage: result.coverage,
      reason: result.reason,
      methodology:
        "Sub-queries modeled by LLM from the prompt; ranks measured live via the SERP router (top 10 = plausibly retrieved by AI engines).",
    });
  }

  const subqueries = await deriveFanoutSubqueries(prompt);
  if (!subqueries.length) {
    return apiError("Could not derive sub-queries — AI generation unavailable right now.", 503);
  }
  return NextResponse.json({
    prompt,
    domain: normalizedDomain,
    available: true,
    subqueries: subqueries.map((s) => ({ subquery: s, position: null, retrievable: null })),
    retrievableCount: null,
    coverage: null,
    methodology:
      "Sub-queries modeled by LLM from the prompt. Add your domain to measure where you rank for each.",
  });
}
