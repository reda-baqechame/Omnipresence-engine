import { searchGoogleOrganic as searchGoogleOrganicDataForSEO } from "@/lib/providers/dataforseo";
import { searchGoogleOrganicBrave } from "@/lib/providers/brave-search";
import { searchGoogleOrganicSerper } from "@/lib/providers/serper";
import type { ProviderResult, SERPResult } from "./types";

export type SerpProviderId = "serper" | "brave" | "dataforseo";

function hasEnv(key: string): boolean {
  const v = process.env[key];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

export function getActiveSerpProvider(): SerpProviderId | null {
  if (hasEnv("SERPER_API_KEY")) return "serper";
  if (hasEnv("BRAVE_SEARCH_API_KEY")) return "brave";
  if (hasEnv("DATAFORSEO_LOGIN") && hasEnv("DATAFORSEO_PASSWORD")) return "dataforseo";
  return null;
}

/** Priority: Serper (cheap) → Brave (free tier) → DataForSEO (optional fallback). */
export async function searchGoogleOrganicRouter(
  keyword: string,
  location = "United States",
  brandDomain: string,
  competitors: string[]
): Promise<ProviderResult<SERPResult> & { provider?: SerpProviderId }> {
  const providers: Array<{
    id: SerpProviderId;
    enabled: boolean;
    search: () => Promise<ProviderResult<SERPResult>>;
  }> = [
    {
      id: "serper",
      enabled: hasEnv("SERPER_API_KEY"),
      search: () => searchGoogleOrganicSerper(keyword, location, brandDomain, competitors),
    },
    {
      id: "brave",
      enabled: hasEnv("BRAVE_SEARCH_API_KEY"),
      search: () => searchGoogleOrganicBrave(keyword, location, brandDomain, competitors),
    },
    {
      id: "dataforseo",
      enabled: hasEnv("DATAFORSEO_LOGIN") && hasEnv("DATAFORSEO_PASSWORD"),
      search: () => searchGoogleOrganicDataForSEO(keyword, location, brandDomain, competitors),
    },
  ];

  let lastError = "No SERP provider configured";

  for (const provider of providers) {
    if (!provider.enabled) continue;
    const result = await provider.search();
    if (result.success && result.data) {
      return { ...result, provider: provider.id };
    }
    if (result.error) lastError = result.error;
  }

  return { success: false, error: lastError };
}
