import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Resolve a competitor name to its official domain via SERP (free/cheap stack). */
export async function resolveCompetitorDomainFree(
  competitor: string,
  industry: string
): Promise<string | null> {
  const query = `${competitor} ${industry} official website`.trim();
  const res = await searchGoogleOrganicRouter(query, "United States", "", []);

  if (!res.success || !res.data?.organicResults.length) {
    return null;
  }

  const first = res.data.organicResults[0];
  const domain = hostnameFromUrl(first.url);
  return domain || null;
}
