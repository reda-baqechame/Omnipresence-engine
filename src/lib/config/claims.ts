/**
 * Claims registry + provenance gate (Phase 23 / manifest v24, Wave F).
 *
 * Every marketing claim is mapped to a capability check. The UI must refuse to
 * render a claim that isn't currently backed by a real capability (see
 * `getBackedClaims` / `isClaimBacked`), and a forbidden-claim guard catches
 * outcome promises we will never make (rank #1, "appear everywhere in AI").
 *
 * This is what keeps the product honest by construction: in Zero-Paid-Keys mode
 * (Wave L) claims that lose their data backing simply stop being advertised
 * instead of becoming lies. The data lives in `claims.json` so the offline
 * benchmark harness (`scripts/benchmark.mjs`) reads the exact same source.
 */
import claimsData from "./claims.json";
import {
  hasSerpCapability,
  hasKeylessSerpCapability,
  hasCitationTrackingCapability,
  hasDirectLLMCapability,
  hasBacklinksIndexCapability,
  isZeroPaidKeysMode,
} from "./capabilities";

export type ClaimProvenance = "measured" | "estimated" | "first_party_when_connected";

export interface Claim {
  id: string;
  text: string;
  metric: string;
  requires?: string[];
  requiresAny?: string[];
  provenance: ClaimProvenance;
  category: string;
}

export const FORBIDDEN_PHRASES: string[] = claimsData.forbiddenPhrases;
export const CLAIMS: Claim[] = claimsData.claims as Claim[];

function hasAiUiCapture(): boolean {
  const url = process.env.AI_UI_CAPTURE_URL;
  return process.env.ENABLE_AI_UI_CAPTURE === "true" && Boolean(url && url.length > 0);
}

/**
 * Platform can offer at least one first-party data connector (analytics/CRM/
 * revenue/ads). This is what makes the attribution_proof claim honest: if NO
 * connector path is configured, the platform cannot prove first-party lift, so
 * the claim must go unbacked rather than rely on the always-on capability.
 */
function hasFirstPartyConnectors(): boolean {
  const env = (k: string) => {
    const v = process.env[k];
    return Boolean(v && v.length > 0 && !v.startsWith("your-"));
  };
  return (
    env("GOOGLE_CLIENT_ID") ||
    env("BING_CLIENT_ID") ||
    env("HUBSPOT_CLIENT_ID") ||
    env("META_CLIENT_ID") ||
    env("LINKEDIN_CLIENT_ID") ||
    env("PLAUSIBLE_API_KEY") ||
    env("POSTHOG_API_KEY")
  );
}

/**
 * Capability-key -> live check (referenced by claims.json). The checks are
 * Zero-Paid-Keys aware: when ZERO_PAID_KEYS is on, paid-only capabilities
 * collapse to their keyless equivalents so claims auto-downgrade instead of
 * silently relying on a paid key that the operator has opted out of.
 */
export const CAPABILITY_CHECKS: Record<string, () => boolean> = {
  always: () => true,
  serp: () => (isZeroPaidKeysMode() ? hasKeylessSerpCapability() : hasSerpCapability()),
  citation: () =>
    isZeroPaidKeysMode()
      ? hasKeylessSerpCapability() ||
        Boolean(process.env.OLLAMA_BASE_URL && process.env.OLLAMA_BASE_URL.trim())
      : hasCitationTrackingCapability(),
  // Measuring the real commercial ChatGPT/Claude/Gemini needs a paid key — it
  // has no honest keyless equivalent, so it is unbacked in Zero-Paid-Keys mode.
  directLLM: () => (isZeroPaidKeysMode() ? false : hasDirectLLMCapability()),
  aiUiCapture: hasAiUiCapture,
  // Referring-domains LIST needs a real index; domain AUTHORITY is keyless-always.
  backlinksIndex: () => hasBacklinksIndexCapability(),
  domainAuthority: () => true,
  // Attribution proof requires that a first-party connector path actually exists.
  firstPartyConnectors: hasFirstPartyConnectors,
};

export function isClaimBacked(claim: Claim): boolean {
  const allOk = (claim.requires ?? []).every((k) => CAPABILITY_CHECKS[k]?.() ?? false);
  const anyOk =
    !claim.requiresAny || claim.requiresAny.length === 0
      ? true
      : claim.requiresAny.some((k) => CAPABILITY_CHECKS[k]?.() ?? false);
  return allOk && anyOk;
}

/** Claims currently backed by real capabilities — the only ones the UI may advertise. */
export function getBackedClaims(): Claim[] {
  return CLAIMS.filter(isClaimBacked);
}

export interface ClaimCoverage {
  claim: Claim;
  backed: boolean;
}

export function getClaimsCoverage(): ClaimCoverage[] {
  return CLAIMS.map((claim) => ({ claim, backed: isClaimBacked(claim) }));
}

/**
 * Forbidden-claim guard: returns the list of forbidden phrases found in a piece
 * of copy. A non-empty result means the copy must NOT be rendered/shipped.
 */
export function findForbiddenClaims(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.filter((p) => lower.includes(p));
}

export function isCopyAllowed(text: string): boolean {
  return findForbiddenClaims(text).length === 0;
}

/**
 * Render gate for a single claim id: only renderable when the claim exists, is
 * currently backed, and its own text contains no forbidden promise.
 */
export function canRenderClaim(claimId: string): boolean {
  const claim = CLAIMS.find((c) => c.id === claimId);
  if (!claim) return false;
  return isClaimBacked(claim) && isCopyAllowed(claim.text);
}
