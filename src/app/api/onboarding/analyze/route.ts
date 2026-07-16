import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeDomainForOnboarding } from "@/lib/engines/onboarding-intelligence";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { apiError, apiUnauthorized, apiServerError, validateBody } from "@/lib/security/api-response";
import { OnboardingAnalyzeSchema } from "@/lib/validation/schemas";
import { guardPublicEndpoint } from "@/lib/security/public-guard";

export const maxDuration = 60;

/**
 * Onboarding step 2: domain -> business inference, competitor suggestions
 * (with resolved domains + confidence), and suggested tracking prompts.
 * Authenticated + IP rate-limited: one LLM call and up to 5 SERP lookups per
 * request, so this must not be an uncontrolled-spend vector.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const limited = await guardPublicEndpoint(request, "onboarding-analyze", 12, 60 * 60 * 1000);
  if (limited) return limited;

  const parsed = await validateBody(request, OnboardingAnalyzeSchema);
  if (parsed.response) return parsed.response;

  let domain: string;
  try {
    domain = assertPublicDomain(parsed.data.domain);
  } catch (error) {
    if (error instanceof DomainValidationError) return apiError(error.message);
    return apiError("Invalid domain");
  }

  try {
    const analysis = await analyzeDomainForOnboarding(domain);
    return NextResponse.json({ analysis });
  } catch (error) {
    return apiServerError("onboarding analyze failed", error);
  }
}
