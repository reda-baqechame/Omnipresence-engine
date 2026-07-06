import type { ProviderResult } from "./types";
import type { PageSpeedResult } from "./pagespeed";
import { labsApiPost } from "./dataforseo";
import { buildProviderEnvelope } from "./envelope";

const USE_OMNIDATA = Boolean(process.env.OMNIDATA_BASE_URL?.replace(/\/$/, ""));

interface OmniPageSpeed {
  available?: boolean;
  performance_score?: number;
  lcp_ms?: number;
  cls?: number;
  tbt_ms?: number;
  inp_ms?: number;
  has_field_data?: boolean;
  field?: {
    lcp_ms?: number;
    cls?: number;
    inp_ms?: number;
    assessment?: "good" | "needs-improvement" | "poor" | "unknown";
  };
  data_source?: "pagespeed_with_crux" | "lab_only" | "unavailable";
}

/**
 * PageSpeed/CrUX through the unified OmniData /v3 spine. Returns null when
 * OmniData isn't configured or the call fails, so the caller falls back to the
 * direct keyless PSI provider. Keeps the data cloud unified without losing the
 * sovereign keyless fallback.
 */
export async function getPageSpeedViaOmniData(
  url: string,
  strategy: "mobile" | "desktop"
): Promise<ProviderResult<PageSpeedResult> | null> {
  if (!USE_OMNIDATA) return null;
  try {
    const env = await labsApiPost<{ tasks: Array<{ result: OmniPageSpeed[] }> }>(
      "/performance/pagespeed/live",
      [{ url, strategy }]
    );
    const r = env?.tasks?.[0]?.result?.[0];
    if (!r || r.available === false || typeof r.performance_score !== "number") return null;
    const data: PageSpeedResult = {
        performanceScore: r.performance_score,
        lcpMs: r.lcp_ms ?? 0,
        cls: r.cls ?? 0,
        tbtMs: r.tbt_ms ?? 0,
        inpMs: r.inp_ms,
        hasFieldData: Boolean(r.has_field_data),
        field: r.field
          ? {
              lcpMs: r.field.lcp_ms,
              cls: r.field.cls,
              inpMs: r.field.inp_ms,
              assessment: r.field.assessment ?? "unknown",
            }
          : undefined,
        strategy,
      };
    const dataSource =
      r.data_source === "pagespeed_with_crux"
        ? "measured"
        : r.data_source === "lab_only"
          ? "estimated"
          : "unavailable";
    return {
      success: true,
      data,
      creditsUsed: 0,
      envelope: buildProviderEnvelope({
        capability: "pagespeed",
        provider: "omnidata",
        providerClass: "surface_measurement",
        dataSource,
        freshness: "live",
        confidence: r.has_field_data ? 0.95 : 0.8,
        parserVersion: "omnidata-performance@1",
        payload: data,
        sourceUrl: url,
      }),
    };
  } catch {
    return null;
  }
}
