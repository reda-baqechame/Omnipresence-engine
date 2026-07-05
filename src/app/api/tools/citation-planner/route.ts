import { NextRequest, NextResponse } from "next/server";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { apiError, readJsonBody } from "@/lib/security/api-response";
import { getMultiSourceSuggestions } from "@/lib/providers/autocomplete-multi";
import { hasSerpCapability } from "@/lib/config/capabilities";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";

export async function POST(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "tools-citation-planner", 20, 60 * 60 * 1000);
  if (limited) return limited;

  let brand: string | undefined;
  let industry: string | undefined;
  let location: string | undefined;
  let domain: string | undefined;
  try {
    ({ brand, industry, location, domain } = await readJsonBody(request));
  } catch {
    return apiError("Invalid JSON body");
  }
  if (!brand || !industry) return apiError("brand and industry required");

  const loc = location ? String(location).slice(0, 80) : "your area";
  const b = String(brand).slice(0, 80);
  const ind = String(industry).slice(0, 80);
  const d = domain ? String(domain).replace(/^https?:\/\//, "").split("/")[0].slice(0, 120) : "";

  const seeds = [
    `best ${ind} in ${loc}`,
    `${b} reviews`,
    `${b} vs competitors`,
    `alternatives to ${b}`,
  ];

  const prompts: Array<{ text: string; source: string; measured: boolean }> = [];

  for (const seed of seeds) {
    const multi = await getMultiSourceSuggestions(seed, ["google", "youtube"]);
    for (const kw of multi.unique.slice(0, 4)) {
      const text = kw.endsWith("?") ? kw : `${kw}?`;
      prompts.push({ text, source: "autocomplete", measured: true });
    }
  }

  if (hasSerpCapability()) {
    const serp = await searchGoogleOrganicRouter(`best ${ind} ${loc}`, "United States", d, []);
    if (serp.success && serp.data?.organicResults?.length) {
      for (const r of serp.data.organicResults.slice(0, 3)) {
        if (r.title) {
          prompts.push({
            text: `What does "${r.title}" recommend for ${ind}?`,
            source: "serp_probe",
            measured: true,
          });
        }
      }
    }

    if (d) {
      const brandSerp = await searchGoogleOrganicRouter(`${b} ${ind}`, "United States", d, []);
      const brandInResults = brandSerp.success && brandSerp.data?.organicResults?.some((r) =>
        r.url.toLowerCase().includes(d.toLowerCase())
      );
      prompts.push({
        text: `Is ${b} recommended for ${ind} in AI and search results?`,
        source: brandInResults ? "serp_probe" : "serp_probe_absent",
        measured: true,
      });
    }
  }

  if (!prompts.length) {
    prompts.push(
      { text: `Who is the best ${ind} in ${loc}?`, source: "template_fallback", measured: false },
      { text: `Is ${b} a good ${ind} company?`, source: "template_fallback", measured: false }
    );
  }

  const surfaces = [
    { platform: "ChatGPT / Perplexity", priority: "high", action: "Earn citations in AI answers", measured: hasSerpCapability() },
    { platform: "Google AI Overview", priority: "high", action: "Structured FAQ + authority pages", measured: hasSerpCapability() },
    { platform: "Reddit", priority: "medium", action: "Authentic community mentions", measured: false },
    { platform: "Quora", priority: "medium", action: "Expert answers linking to hub content", measured: false },
    { platform: "Industry directories", priority: "high", action: "Complete NAP + reviews", measured: false },
  ];

  return NextResponse.json({
    brand: b,
    industry: ind,
    location: loc,
    domain: d || null,
    methodology:
      "Prompts from Google Autocomplete fan-out + SERP title/domain probes when configured. Template fallbacks labeled when providers unavailable.",
    prompts: prompts.slice(0, 12),
    surfaces,
    measured_count: prompts.filter((p) => p.measured).length,
  });
}
