import { createHmac } from "crypto";

const OMNIDATA_URL = process.env.OMNIDATA_BASE_URL?.replace(/\/$/, "");

function authHeaders(body: unknown): Record<string, string> {
  const key = process.env.OMNIDATA_API_KEY || "dev-local-key";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const secret = process.env.OMNIDATA_SIGNING_SECRET;
  if (secret) {
    const timestamp = String(Date.now());
    const payload = JSON.stringify(body);
    headers["x-omnidata-timestamp"] = timestamp;
    headers["x-omnidata-signature"] = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
  }
  return headers;
}

async function omnidataPost<T>(path: string, body: unknown[]): Promise<T | null> {
  if (!OMNIDATA_URL) return null;
  try {
    const res = await fetch(`${OMNIDATA_URL}/v3${path}`, {
      method: "POST",
      headers: authHeaders(body),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function extractResult<T>(data: {
  tasks?: Array<{ result?: Array<Record<string, unknown>> }>;
}): T | null {
  const block = data.tasks?.[0]?.result?.[0];
  return (block as T) || null;
}

export async function researchKeywordsLive(seed: string): Promise<{
  seed: string;
  suggestions: Array<{ keyword: string; volume_estimate?: number; source?: string }>;
  related: Array<{ keyword: string; volume_estimate?: number }>;
} | null> {
  const data = await omnidataPost<{ tasks: Array<{ result: Array<Record<string, unknown>> }> }>(
    "/keywords/suggestions/live",
    [{ keyword: seed }]
  );
  if (!data) return null;
  const result = extractResult<{ seed: string; suggestions: unknown[]; related: unknown[] }>(data);
  if (!result) return null;
  return result as {
    seed: string;
    suggestions: Array<{ keyword: string; volume_estimate?: number; source?: string }>;
    related: Array<{ keyword: string; volume_estimate?: number }>;
  };
}

export async function keywordDifficultyLive(keyword: string) {
  const data = await omnidataPost<{ tasks: Array<{ result: Array<Record<string, unknown>> }> }>(
    "/keywords/difficulty/live",
    [{ keyword }]
  );
  if (!data) return null;
  return extractResult<{
    keyword: string;
    difficulty: number;
    intent: string;
    top_domains: string[];
    serp_features: string[];
    has_ai_overview: boolean;
  }>(data);
}

export async function contentGapsLive(domain: string, competitors: string[], seeds: string[]) {
  const data = await omnidataPost<{ tasks: Array<{ result: Array<{ gaps: unknown[] }> }> }>(
    "/labs/content_gaps/live",
    [{ domain, competitors, seeds }]
  );
  if (!data) return null;
  const result = extractResult<{ gaps: unknown[]; total: number }>(data);
  return result?.gaps || null;
}

export async function backlinkGapsLive(domain: string, competitors: string[]) {
  const data = await omnidataPost<{ tasks: Array<{ result: Array<{ gaps: unknown[] }> }> }>(
    "/backlinks/gap/live",
    [{ domain, competitors }]
  );
  if (!data) return null;
  const result = extractResult<{ gaps: unknown[] }>(data);
  return result?.gaps || null;
}

export async function keywordOpportunitiesLive(domain: string, keywords: string[]) {
  const data = await omnidataPost<{ tasks: Array<{ result: Array<{ opportunities: unknown[] }> }> }>(
    "/labs/keyword_opportunities/live",
    [{ domain, keywords }]
  );
  if (!data) return null;
  const result = extractResult<{ opportunities: unknown[] }>(data);
  return result?.opportunities || null;
}

export function hasIntelligenceApi(): boolean {
  return Boolean(OMNIDATA_URL) || Boolean(process.env.SERPER_API_KEY);
}
