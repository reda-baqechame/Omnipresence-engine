import type { SupabaseClient } from "@supabase/supabase-js";
import { withJobContext } from "@/lib/observability/job-context";
import { queryLLMForVisibility } from "@/lib/providers/ai-gateway";
import {
  searchLLMMentions,
  type LLMPlatform,
} from "@/lib/providers/dataforseo";
import { hasLLMMentionsCapability } from "@/lib/config/capabilities";
import { queryPerplexitySonar, hasPerplexityCapability } from "@/lib/providers/perplexity";
import { searchGoogleOrganicRouter, searchGoogleSerpAuthentic } from "@/lib/providers/serp-router";
import { hasAiUiCapture, captureAiUiSurface, isCaptureBlocked, type AiUiCaptureSuccess, type AiUiCaptureSurface, type AiUiCaptureOptions } from "@/lib/providers/ai-ui-capture";
import { captureOptionsFromLocation } from "@/lib/providers/location-geo";
import { logProviderError } from "@/lib/observability/log";
import { createServiceClient } from "@/lib/supabase/server";
import { assertTenantSurfaceBudget, trackApiUsage, TenantBudgetExceededError } from "@/lib/metering/api-usage";
import { makeBrandMatcher, makeCompetitorMatcher, sameRegistrableDomain, type EntityMatcher } from "@/lib/engines/brand-matcher";
import type { VisibilityEngine, VisibilityResult } from "@/types/database";
import type { DataSource, DataQuality } from "@/types/database";
import { getActiveScanEngines, isEngineConfigured } from "@/lib/config/scan-engines";
import { hasLangfuse, mirrorTracesToLangfuse } from "@/lib/providers/langfuse";

export interface VisibilityScanConfig {
  projectId: string;
  runId: string;
  /** When set, AI UI captures consume tenant daily surface credits. */
  organizationId?: string;
  brandName: string;
  brandDomain: string;
  competitors: string[];
  location: string;
  prompts: Array<{ id?: string; text: string; priority?: number }>;
  engines?: VisibilityEngine[];
  maxPrompts?: number;
  /**
   * Per-probe timeout override. Time-budgeted callers (e.g. the public
   * no-signup grader) pass a tighter value than the env default so one slow
   * provider can't eat the whole wall-clock budget.
   */
  probeTimeoutMs?: number;
  /**
   * Wall-clock budget override for the whole scan. When exhausted the scan
   * stops and returns the partial-but-honest results measured so far.
   */
  scanBudgetMs?: number;
  /**
   * Number of prompt×engine probes to run in parallel (default 1 = sequential,
   * the safe choice for tenant scans that meter per-provider rate limits).
   * The public grader uses a small pool so it finishes inside its budget.
   */
  concurrency?: number;
  /**
   * Skip the browser UI-capture path and use direct API providers only.
   * UI capture (Playwright on Railway) takes 30-120s per surface — right for
   * tenant evidence panels, fatal for the time-boxed public grader where it
   * turns every probe into a timeout. Results stay honestly labeled with
   * their API surface (e.g. openai_grounded_api, not chatgpt_ui).
   */
  skipUiCapture?: boolean;
  /** Grounded-attempt cap per LLM probe (default env VISIBILITY_GROUNDED_RETRIES or 3). */
  maxGroundedRetries?: number;
  /**
   * Optional persona conditioning (Wave O3). When set, AI probes answer from
   * this persona's perspective and the persona+geo are recorded on the probe
   * trace. The stored prompt_text stays the original (clean) prompt.
   */
  persona?: string;
  /** Persist each probe as it completes (Inngest progress + crash recovery). */
  onProbeResult?: (result: VisibilityScanResult) => void | Promise<void>;
  /**
   * Cooperative cancellation check, polled between prompt/engine iterations
   * (never mid-probe). Return true to stop before the next provider call.
   * Callers should throttle their own DB reads inside this callback — it may
   * be invoked once per prompt×engine pair.
   */
  isCancelled?: () => boolean | Promise<boolean>;
}

export interface VisibilityScanResult extends Omit<VisibilityResult, "id" | "created_at"> {
  data_source: DataQuality;
}

export interface VisibilityScanOutput {
  results: VisibilityScanResult[];
  /** True when the wall-clock scan budget was exhausted before all prompts ran. */
  scanPartial: boolean;
  /** True when a user-initiated cancel stopped the scan before it finished. */
  cancelled: boolean;
}

/**
 * Throttled cooperative-cancellation poller for a visibility_runs row. Reuses
 * the same "cheap check between iterations" pattern already used for the
 * wall-clock scan budget, but backed by a user-settable DB flag instead of a
 * clock. Caches the result for `throttleMs` so a scan with many prompt×engine
 * iterations doesn't hammer the DB once per probe.
 */
export function makeRunCancellationChecker(
  supabase: SupabaseClient,
  runId: string,
  throttleMs = 4000
): () => Promise<boolean> {
  let lastCheck = 0;
  let cached = false;
  return async () => {
    const now = Date.now();
    if (now - lastCheck < throttleMs) return cached;
    lastCheck = now;
    try {
      const { data } = await supabase
        .from("visibility_runs")
        .select("cancel_requested_at")
        .eq("id", runId)
        .maybeSingle();
      cached = Boolean(data?.cancel_requested_at);
    } catch {
      // Fail-open: a transient read error must never itself stop a scan.
      cached = false;
    }
    return cached;
  };
}

const LLM_ENGINES = new Set<VisibilityEngine>(["chatgpt", "claude", "gemini"]);
const LLM_PLATFORM_MAP: Partial<Record<VisibilityEngine, LLMPlatform>> = {
  chatgpt: "chat_gpt",
  google_ai_overview: "google",
};

export async function runVisibilityScan(
  config: VisibilityScanConfig
): Promise<VisibilityScanOutput> {
  // Job context wrapper so every recordSpend()/provider_telemetry call made
  // transitively during this scan (queryLLMForVisibility, captureAiUiSurface,
  // etc.) is attributed to this run_id without threading it through every
  // provider call signature.
  return withJobContext({ runId: config.runId }, () => runVisibilityScanImpl(config));
}

async function runVisibilityScanImpl(
  config: VisibilityScanConfig
): Promise<VisibilityScanOutput> {
  const engines = config.engines ?? getActiveScanEngines();
  const results: VisibilityScanResult[] = [];
  const scanLimit = config.maxPrompts ?? 30;

  const promptsToScan = config.prompts
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, scanLimit);

  // Overall wall-clock budget so a slow provider chain can't run the scan past
  // the host's function limit and get hard-killed (which would lose ALL results
  // and leave the run wedged). When the budget is exhausted we stop probing and
  // return what we measured so far — a partial-but-honest result beats a kill.
  const VISIBILITY_SCAN_BUDGET_MS =
    config.scanBudgetMs ??
    Math.max(120000, Number(process.env.VISIBILITY_SCAN_BUDGET_MS) || 600000);
  const deadline = Date.now() + VISIBILITY_SCAN_BUDGET_MS;

  let budgetExhausted = false;
  let cancelled = false;
  const probeTimeoutMs =
    config.probeTimeoutMs ??
    Math.max(15_000, Number(process.env.VISIBILITY_PROBE_TIMEOUT_MS) || 90_000);
  const concurrency = Math.max(1, Math.min(config.concurrency ?? 1, 8));

  const probeCell = async (
    prompt: (typeof promptsToScan)[number],
    engine: VisibilityEngine
  ): Promise<VisibilityScanResult> => {
    let result: VisibilityScanResult | null = null;
    try {
      result = await probeWithTimeout(config, prompt, engine, probeTimeoutMs);
    } catch (error) {
      logProviderError("visibility.probe_failed", error, {
        engine,
        prompt: prompt.text.slice(0, 80),
      });
      result = buildUnavailableProbe(config, prompt, engine, "probe_error");
    }
    if (!result) {
      result = buildUnavailableProbe(config, prompt, engine, "probe_timeout");
    }
    if (config.persona || config.location) {
      result.raw_response = {
        ...(result.raw_response || {}),
        ...(config.persona ? { persona: config.persona } : {}),
        geo: config.location,
      };
    }
    return result;
  };

  if (concurrency <= 1) {
    // Sequential path — the default for tenant scans. Cancellation is polled
    // once per prompt (even with zero engines) and between every probe; this
    // exact contract is pinned by scan-cancellation.test.ts.
    for (const prompt of promptsToScan) {
      if (budgetExhausted || cancelled) break;
      if (config.isCancelled && (await config.isCancelled())) {
        cancelled = true;
        break;
      }
      for (const engine of engines) {
        if (Date.now() >= deadline) {
          budgetExhausted = true;
          logProviderError("visibility.scan_budget_exhausted", new Error("scan budget exhausted"), {
            measured: results.length,
            prompt: prompt.text.slice(0, 80),
          });
          break;
        }
        if (config.isCancelled && (await config.isCancelled())) {
          cancelled = true;
          break;
        }
        const result = await probeCell(prompt, engine);
        results.push(result);
        await config.onProbeResult?.(result);
      }
    }
    return { results, scanPartial: budgetExhausted || cancelled, cancelled };
  }

  // Parallel path — used by time-budgeted callers (the public no-signup
  // grader). A small worker pool drains the flattened prompt×engine cells so
  // one slow provider can't serialize the whole scan past its wall budget.
  const cells: Array<{ prompt: (typeof promptsToScan)[number]; engine: VisibilityEngine }> = [];
  for (const prompt of promptsToScan) {
    for (const engine of engines) {
      cells.push({ prompt, engine });
    }
  }
  const slots: Array<VisibilityScanResult | null> = new Array(cells.length).fill(null);
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= cells.length || budgetExhausted || cancelled) return;
      const { prompt, engine } = cells[index];
      if (Date.now() >= deadline) {
        budgetExhausted = true;
        logProviderError("visibility.scan_budget_exhausted", new Error("scan budget exhausted"), {
          measured: slots.filter(Boolean).length,
          prompt: prompt.text.slice(0, 80),
        });
        return;
      }
      if (config.isCancelled && (await config.isCancelled())) {
        cancelled = true;
        return;
      }
      const result = await probeCell(prompt, engine);
      slots[index] = result;
      await config.onProbeResult?.(result);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, cells.length) }, worker));

  for (const r of slots) {
    if (r) results.push(r);
  }

  return { results, scanPartial: budgetExhausted || cancelled, cancelled };
}

async function probeWithTimeout(
  config: VisibilityScanConfig,
  prompt: { id?: string; text: string },
  engine: VisibilityEngine,
  timeoutMs: number
): Promise<VisibilityScanResult | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      scanSinglePrompt(config, prompt, engine),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildUnavailableProbe(
  config: VisibilityScanConfig,
  prompt: { id?: string; text: string },
  engine: VisibilityEngine,
  reason: string
): VisibilityScanResult {
  return {
    run_id: config.runId,
    project_id: config.projectId,
    prompt_id: prompt.id,
    engine,
    prompt_text: prompt.text,
    brand_mentioned: false,
    brand_cited: false,
    competitor_mentions: {},
    competitor_citations: {},
    source_domains: [],
    cited_urls: [],
    data_source: "unavailable",
    measurement_mode: "unavailable",
    sample_count: 0,
    variance: 0,
    raw_response: { data_source: "unavailable", reason },
  };
}

const CAPTURE_CREDITS = 2;

async function captureWithTenantBudget(
  config: VisibilityScanConfig,
  surface: AiUiCaptureSurface,
  prompt: string,
  options: AiUiCaptureOptions = {}
) {
  if (config.organizationId) {
    try {
      const supabase = await createServiceClient();
      await assertTenantSurfaceBudget(supabase, config.organizationId, CAPTURE_CREDITS);
    } catch (e) {
      if (e instanceof TenantBudgetExceededError) {
        logProviderError("visibility.capture_budget", e, { org: config.organizationId });
        return null;
      }
    }
  }

  const captured = await captureAiUiSurface(
    surface,
    prompt,
    config.brandName,
    config.brandDomain,
    config.competitors,
    options
  ).catch(() => null);

  if (captured && config.organizationId && !isCaptureBlocked(captured)) {
    try {
      const supabase = await createServiceClient();
      await trackApiUsage(supabase, config.organizationId, "ai-ui-capture", surface, CAPTURE_CREDITS);
    } catch {
      // metering is best-effort
    }
  }

  return captured;
}

async function scanSinglePrompt(
  config: VisibilityScanConfig,
  prompt: { id?: string; text: string },
  engine: VisibilityEngine
): Promise<VisibilityScanResult | null> {
  const base = {
    run_id: config.runId,
    project_id: config.projectId,
    prompt_id: prompt.id,
    engine,
    prompt_text: prompt.text,
    brand_mentioned: false,
    brand_cited: false,
    competitor_mentions: {} as Record<string, boolean>,
    competitor_citations: {} as Record<string, boolean>,
    source_domains: [] as string[],
    cited_urls: [] as string[],
    // Default to the honest "unavailable" rather than "simulated": every branch
    // below overrides this, but if a future code path forgets to, an unmeasured
    // probe must never silently read as fabricated data in a real scan.
    data_source: "unavailable" as DataQuality,
  };

  const domainLower = config.brandDomain.replace(/^www\./, "").toLowerCase();
  const brandToken = domainLower.split(".")[0];
  const brandMatcher = makeBrandMatcher(config.brandName, config.brandDomain);

  if (!isEngineConfigured(engine)) {
    return unavailableRow(base, "provider_not_configured");
  }

  // Preferred (when enabled): grounded UI-surface capture for AI engines —
  // the real surface a user sees, not just the model's parametric knowledge.
  // Surface identity is strict: Claude has NO UI-capture surface, so it must
  // never be probed through the ChatGPT surface (that would attribute a
  // ChatGPT answer to Claude). Claude is measured via the Anthropic grounded
  // API path below instead.
  if (!config.skipUiCapture && hasAiUiCapture() && ((LLM_ENGINES.has(engine) && engine !== "claude") || engine === "perplexity" || engine === "google_ai_overview" || engine === "bing_copilot")) {
    const surface = engine as "chatgpt" | "gemini" | "perplexity" | "google_ai_overview" | "bing_copilot";
    const geoOpts = captureOptionsFromLocation(config.location);
    const captured = await captureWithTenantBudget(
      config,
      surface,
      prompt.text,
      geoOpts
    );
    if (isCaptureBlocked(captured)) {
      return unavailableRow(base, "capture_blocked", captured.reason);
    }
    if (captured) {
      return mapCaptureToVisibilityResult(base, captured, config, `${surface}_ui`);
    }
  }

  // Primary: direct LLM queries and cheap SERP providers
  try {
    if (LLM_ENGINES.has(engine)) {
      const sampled = await sampleLLMVisibility(config, prompt, engine, domainLower, brandToken);
      if (sampled) return sampled;
    } else if (engine === "perplexity") {
      if (!config.skipUiCapture && hasAiUiCapture()) {
        const geoOpts = captureOptionsFromLocation(config.location);
        const captured = await captureWithTenantBudget(
          config,
          "perplexity",
          prompt.text,
          geoOpts
        );
        if (isCaptureBlocked(captured)) {
          return unavailableRow(base, "capture_blocked", captured.reason);
        }
        if (captured) {
          return mapCaptureToVisibilityResult(base, captured, config, "perplexity_ui");
        }
      }
      if (hasPerplexityCapability()) {
      const res = await queryPerplexitySonar(prompt.text, config.brandName, config.brandDomain, config.competitors);
      if (res.success && res.data) {
        const sourceDomains = res.data.citations.map((u) => {
          try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
        }).filter(Boolean);
        const answer = res.data.answer || "";
        return {
          ...base,
          brand_mentioned: res.data.brandMentioned,
          brand_cited: res.data.brandCited,
          competitor_mentions: res.data.competitorMentions,
          cited_urls: res.data.citations,
          source_domains: sourceDomains,
          measurement_mode: "grounded",
          sentiment: res.data.brandMentioned ? analyzeSentiment(answer, config.brandName) : "unknown",
          recommendation_strength: res.data.brandMentioned ? recommendationStrength(answer, config.brandName) : 0,
          owned_cited: res.data.brandCited,
          third_party_cited: res.data.brandMentioned && sourceDomains.some((d) => !sameRegistrableDomain(d, config.brandDomain)),
          answer_position: answerPosition(answer, config.brandName, config.competitors),
          sample_count: 1,
          variance: 0,
          raw_response: {
            answer,
            data_source: "measured",
            data_source_detail: "perplexity",
            measurement_mode: "grounded",
            surface: "perplexity_sonar_api",
            entity_prominence: computeEntityProminence(answer, [config.brandName, ...config.competitors]),
          },
          data_source: "measured",
        };
      }
      }
    } else if (engine === "google_organic" || engine === "google_ai_overview") {
      // Surface identity: Google claims require a Google-authentic provider.
      // DuckDuckGo/Brave/SearXNG results must never be presented as Google.
      const res = await searchGoogleSerpAuthentic(
        prompt.text,
        config.location,
        config.brandDomain,
        config.competitors
      );

      if (res.success && res.data) {
        const top = res.data.organicResults.slice(0, 10);
        const hasOrganicSignal = top.length > 0;

        // Honest absence: SERP loaded but no AI Overview block for this query/geo.
        if (engine === "google_ai_overview" && !res.data.aiOverview) {
          if (!hasOrganicSignal) {
            return unavailableRow(base, "serp_no_results", res.provider);
          }
          return serpAbsenceMeasuredRow(base, { provider: res.provider, data: res.data }, config, top, "google_ai_overview_absent");
        }

        const aiDomains = res.data.aiOverview?.citedDomains || [];
        const aiUrls = res.data.aiOverview?.citedUrls || [];
        const aiCited = brandMatcher.citedInDomains(aiDomains);

        // A SERP full of pages ABOUT the brand (G2, Trustpilot, Reddit "Why X?",
        // news) is real brand visibility even when the brand's own domain isn't
        // the URL. Count the brand name appearing in result titles as a mention,
        // not just owning a ranking domain — otherwise strong brands read as
        // "not mentioned" on review/comparison queries (a weak, misleading miss).
        const brandInTitles = top.some((r) => brandMatcher.mentionedIn(r.title || ""));
        const brandInAi = res.data.brandInResults || aiCited;
        const brandPresent = brandInAi || brandInTitles;

        const competitorMentions: Record<string, boolean> = { ...res.data.competitorInResults };
        for (const comp of config.competitors) {
          if (!competitorMentions[comp]) {
            const cm = makeCompetitorMatcher(comp);
            competitorMentions[comp] = top.some((r) => cm.mentionedIn(r.title || ""));
          }
        }

        const organicDomains = top
          .map((r) => tryHostname(r.url))
          .filter(Boolean);
        const organicUrls = top.map((r) => r.url).filter(Boolean);

        // Brand's organic rank = its position in the answer surface (eTLD+1).
        const organicPosition = res.data.organicResults.findIndex(
          (r) => sameRegistrableDomain(r.url, config.brandDomain)
        );

        return {
          ...base,
          brand_mentioned: brandPresent,
          brand_cited: aiCited,
          competitor_mentions: competitorMentions,
          source_domains: [...new Set([...aiDomains, ...organicDomains])],
          cited_urls: [...new Set([...aiUrls, ...organicUrls])],
          measurement_mode: "grounded",
          sentiment: brandPresent ? "neutral" : "unknown",
          recommendation_strength: aiCited ? 1 : brandPresent ? 0.5 : 0,
          owned_cited: aiCited || organicPosition >= 0,
          third_party_cited:
            brandPresent &&
            [...aiDomains, ...organicDomains].some((d) => !sameRegistrableDomain(d, config.brandDomain)),
          answer_position: organicPosition >= 0 ? organicPosition + 1 : undefined,
          sample_count: 1,
          variance: 0,
          raw_response: {
            organic: res.data.organicResults,
            aiOverview: res.data.aiOverview,
            data_source: "measured",
            data_source_detail: res.provider || "serp",
            measurement_mode: "grounded",
            surface: engine === "google_ai_overview" ? "google_ai_overview_serp" : "google_organic_serp",
            // Prominence from the ranked answer surface: result titles in rank
            // order + the AI Overview text. Position in this blob mirrors SERP
            // rank, so an entity in the top result outweighs one ranked #9.
            entity_prominence: computeEntityProminence(
              [...top.map((r) => r.title || ""), res.data.aiOverview?.text || ""].join("\n"),
              [config.brandName, ...config.competitors]
            ),
          },
          data_source: "measured",
        };
      }
    } else if (engine === "bing_copilot") {
      if (!config.skipUiCapture && hasAiUiCapture()) {
        const geoOpts = captureOptionsFromLocation(config.location);
        const captured = await captureWithTenantBudget(
          config,
          "bing_copilot",
          prompt.text,
          geoOpts
        );
        if (isCaptureBlocked(captured)) {
          return unavailableRow(base, "capture_blocked", captured.reason);
        }
        if (captured) {
          return mapCaptureToVisibilityResult(base, captured, config, "bing_copilot_ui");
        }
      }
      return unavailableRow(base, "copilot_requires_ui_capture_backend");
    }
  } catch (error) {
    // Grounded provider failed — log it (never silently render as "not mentioned"),
    // then fall through to the LLM-mentions fallback / null below.
    logProviderError("visibility.grounded", error, { engine, prompt: prompt.text.slice(0, 120) });
  }

  // Optional fallback: DataForSEO LLM Mentions (when keys exist)
  const llmPlatform = LLM_PLATFORM_MAP[engine];
  if (llmPlatform && hasLLMMentionsCapability()) {
    const measured = await scanViaLLMMentions(config, prompt, engine, llmPlatform, domainLower, brandToken);
    if (measured) return measured;
  }

  // Nothing measured this engine. Emit an explicit `unavailable` row rather than
  // dropping it (null), so coverage gaps are honest: "we attempted X engine and
  // couldn't measure it" is different from "X engine says you're not mentioned".
  return unavailableRow(base, "no_provider_for_engine");
}

/**
 * An honest "we could not measure this" row. Counts toward coverage (lowers
 * measuredRate) but is excluded from mention/citation rates so a failed probe
 * never reads as "brand not mentioned".
 */
function unavailableRow(
  base: Omit<VisibilityScanResult, "data_source"> & { data_source: DataQuality },
  reason: string,
  provider?: string
): VisibilityScanResult {
  return {
    ...base,
    measurement_mode: "unavailable",
    sample_count: 0,
    variance: 0,
    raw_response: {
      data_source: "unavailable",
      reason,
      ...(provider ? { provider } : {}),
    },
    data_source: "unavailable",
  };
}

function mapCaptureToVisibilityResult(
  base: Omit<VisibilityScanResult, "data_source"> & { data_source: DataQuality },
  captured: AiUiCaptureSuccess,
  config: VisibilityScanConfig,
  /** Exact surface probed (e.g. "chatgpt_ui") — surface-identity provenance. */
  surface: string
): VisibilityScanResult {
  const isAbsence = captured.absence === true || captured.surfacePresent === false;
  const sourceDomains = captured.sourceDomains.length
    ? captured.sourceDomains
    : captured.citedUrls.map(tryHostname).filter(Boolean);
  return {
    ...base,
    brand_mentioned: isAbsence ? false : captured.brandMentioned,
    brand_cited: isAbsence ? false : captured.brandCited,
    competitor_mentions: isAbsence ? {} : captured.competitorMentions,
    source_domains: [...new Set(sourceDomains)],
    cited_urls: captured.citedUrls,
    measurement_mode: "grounded",
    sentiment: !isAbsence && captured.brandMentioned ? analyzeSentiment(captured.answer, config.brandName) : "unknown",
    recommendation_strength: !isAbsence && captured.brandMentioned ? recommendationStrength(captured.answer, config.brandName) : 0,
    owned_cited: !isAbsence && captured.brandCited,
    third_party_cited:
      !isAbsence &&
      captured.brandMentioned &&
      [...new Set(sourceDomains)].some((d) => !sameRegistrableDomain(d, config.brandDomain)),
    answer_position: isAbsence ? undefined : answerPosition(captured.answer, config.brandName, config.competitors),
    sample_count: 1,
    variance: 0,
    raw_response: {
      answer: captured.answer,
      absence: isAbsence,
      surfacePresent: !isAbsence,
      data_source: "measured",
      data_source_detail: isAbsence ? "ai_ui_capture_absence" : "ai_ui_capture",
      measurement_mode: "grounded",
      surface,
      entity_prominence: computeEntityProminence(captured.answer, [config.brandName, ...config.competitors]),
      response_hash: captured.responseHash,
      screenshot_base64: captured.screenshotBase64 ?? undefined,
      dom_html: captured.domHtml ?? undefined,
      capture_context: captured.captureContext,
      external_evidence_url: captured.evidenceUrl ?? undefined,
      geo: config.location,
    },
    data_source: "measured",
  };
}

function serpAbsenceMeasuredRow(
  base: Omit<VisibilityScanResult, "data_source"> & { data_source: DataQuality },
  res: { provider?: string; data: NonNullable<Awaited<ReturnType<typeof searchGoogleOrganicRouter>>["data"]> },
  config: VisibilityScanConfig,
  top: Array<{ title?: string; url: string }>,
  reason: string
): VisibilityScanResult {
  const organicDomains = top.map((r) => tryHostname(r.url)).filter(Boolean);
  const organicUrls = top.map((r) => r.url).filter(Boolean);
  return {
    ...base,
    brand_mentioned: false,
    brand_cited: false,
    competitor_mentions: {},
    source_domains: [...new Set(organicDomains)],
    cited_urls: organicUrls,
    measurement_mode: "grounded",
    sentiment: "unknown",
    recommendation_strength: 0,
    owned_cited: false,
    third_party_cited: false,
    sample_count: 1,
    variance: 0,
    raw_response: {
      organic: res.data.organicResults,
      aiOverview: null,
      absence: true,
      surfacePresent: false,
      reason,
      data_source: "measured",
      data_source_detail: res.provider || "serp",
      measurement_mode: "grounded",
      surface: "google_ai_overview_serp",
      geo: config.location,
      entity_prominence: computeEntityProminence(top.map((r) => r.title || "").join("\n"), [config.brandName, ...config.competitors]),
    },
    data_source: "measured",
  };
}

async function sampleLLMVisibility(
  config: VisibilityScanConfig,
  prompt: { id?: string; text: string },
  engine: VisibilityEngine,
  _domainLower: string,
  _brandToken: string
): Promise<VisibilityScanResult | null> {
  const provider: "openai" | "gemini" | "claude" = engine === "chatgpt" ? "openai" : engine === "gemini" ? "gemini" : "claude";
  const GROUNDED_RETRIES = Math.max(
    1,
    Math.min(
      5,
      // Time-boxed callers (public grader: 25s/probe) can't afford 3 grounded
      // attempts before the direct-API fallback — they'd hit the probe timeout
      // and read "unavailable" despite a healthy provider.
      config.maxGroundedRetries ?? (Number(process.env.VISIBILITY_GROUNDED_RETRIES) || 3)
    )
  );
  let lastError: string | undefined;
  let groundedData: ReturnType<typeof mapAIResult> & { text: string } | null = null;

  for (let attempt = 0; attempt < GROUNDED_RETRIES; attempt++) {
    const res = await queryLLMForVisibility(
      provider,
      prompt.text,
      config.brandName,
      config.brandDomain,
      config.competitors,
      { grounded: true, persona: config.persona }
    );
    if (res.success && res.data?.grounded) {
      groundedData = { ...mapAIResult(res.data), text: res.data.rawResponse || "" };
      break;
    }
    if (res.error) lastError = res.error;
  }

  if (!groundedData && !config.skipUiCapture && hasAiUiCapture() && (engine === "chatgpt" || engine === "gemini")) {
    const surface = engine as "chatgpt" | "gemini";
    const geoOpts = captureOptionsFromLocation(config.location);
    const captured = await captureWithTenantBudget(
      config,
      surface,
      prompt.text,
      geoOpts
    );
    if (!isCaptureBlocked(captured) && captured) {
      return mapCaptureToVisibilityResult(
        {
          run_id: config.runId,
          project_id: config.projectId,
          prompt_id: prompt.id,
          engine,
          prompt_text: prompt.text,
          brand_mentioned: false,
          brand_cited: false,
          competitor_mentions: {},
          competitor_citations: {},
          source_domains: [],
          cited_urls: [],
          data_source: "unavailable",
        },
        captured,
        config,
        `${surface}_ui`
      );
    }
  }

  // Last resort: a live API response (measured provider read — not model_knowledge).
  if (!groundedData) {
    const apiRes = await queryLLMForVisibility(
      provider,
      prompt.text,
      config.brandName,
      config.brandDomain,
      config.competitors,
      { grounded: false, persona: config.persona }
    );
    if (apiRes.success && apiRes.data) {
      const mapped = { ...mapAIResult(apiRes.data), text: apiRes.data.rawResponse || "" };
      return {
        run_id: config.runId,
        project_id: config.projectId,
        prompt_id: prompt.id,
        engine,
        prompt_text: prompt.text,
        brand_mentioned: mapped.brand_mentioned,
        brand_cited: mapped.brand_cited,
        competitor_mentions: mapped.competitor_mentions,
        competitor_citations: mapped.competitor_citations,
        source_domains: mapped.source_domains,
        cited_urls: mapped.cited_urls,
        measurement_mode: "grounded",
        sentiment: mapped.brand_mentioned ? analyzeSentiment(mapped.text, config.brandName) : "unknown",
        recommendation_strength: mapped.brand_mentioned ? recommendationStrength(mapped.text, config.brandName) : 0,
        owned_cited: false,
        third_party_cited: false,
        answer_position: answerPosition(mapped.text, config.brandName, config.competitors),
        confidence: 0.75,
        sample_count: 1,
        variance: 0,
        raw_response: {
          data_source: "measured",
          data_source_detail: "llm_api_direct",
          measurement_mode: "api_direct",
          surface: `${provider === "openai" ? "openai" : provider === "gemini" ? "gemini" : "anthropic"}_api_direct`,
          grounded: false,
          entity_prominence: computeEntityProminence(mapped.text, [config.brandName, ...config.competitors]),
          geo: config.location,
        },
        data_source: "measured",
      };
    }
  }

  if (!groundedData) {
    const reason = lastError?.toLowerCase().includes("quota") ? "llm_quota_exceeded" : "llm_not_grounded";
    return unavailableRow(
      {
        run_id: config.runId,
        project_id: config.projectId,
        prompt_id: prompt.id,
        engine,
        prompt_text: prompt.text,
        brand_mentioned: false,
        brand_cited: false,
        competitor_mentions: {},
        competitor_citations: {},
        source_domains: [],
        cited_urls: [],
        data_source: "unavailable",
      },
      reason,
      lastError?.slice(0, 200)
    );
  }

  const mentionRate = groundedData.brand_mentioned ? 1 : 0;
  const citationRate = groundedData.brand_cited ? 1 : 0;
  const combinedText = groundedData.text;

  const competitorMentions: Record<string, boolean> = {};
  for (const comp of config.competitors) {
    competitorMentions[comp] = groundedData.competitor_mentions[comp];
  }

  const sourceDomains = [...new Set(groundedData.source_domains)];
  const recStrength = groundedData.brand_mentioned ? recommendationStrength(combinedText, config.brandName) : 0;

  return {
    run_id: config.runId,
    project_id: config.projectId,
    prompt_id: prompt.id,
    engine,
    prompt_text: prompt.text,
    brand_mentioned: mentionRate >= 0.5,
    brand_cited: citationRate >= 0.5,
    competitor_mentions: competitorMentions,
    competitor_citations: groundedData.competitor_citations,
    source_domains: sourceDomains,
    cited_urls: [...new Set(groundedData.cited_urls)],
    measurement_mode: "grounded",
    sentiment: mentionRate >= 0.5 ? analyzeSentiment(combinedText, config.brandName) : "unknown",
    recommendation_strength: recStrength,
    owned_cited: citationRate >= 0.5,
    third_party_cited: sourceDomains.some((d) => !sameRegistrableDomain(d, config.brandDomain)),
    answer_position: answerPosition(combinedText, config.brandName, config.competitors),
    confidence: 1,
    sample_count: 1,
    variance: 0,
    raw_response: {
      sample_runs: 1,
      grounded_runs: 1,
      mention_rate: mentionRate,
      citation_rate: citationRate,
      data_source: "measured",
      data_source_detail: "llm_grounded",
      measurement_mode: "grounded",
      surface: `${provider === "openai" ? "openai" : provider === "gemini" ? "gemini" : "anthropic"}_api_grounded`,
      entity_prominence: computeEntityProminence(combinedText, [config.brandName, ...config.competitors]),
      label: "Grounded web search (mandatory)",
      geo: config.location,
    },
    data_source: "measured",
  };
}

async function scanViaLLMMentions(
  config: VisibilityScanConfig,
  prompt: { id?: string; text: string },
  engine: VisibilityEngine,
  platform: LLMPlatform,
  _domainLower: string,
  _brandToken: string
): Promise<VisibilityScanResult | null> {
  const res = await searchLLMMentions(prompt.text, platform, config.location);
  if (!res.success || !res.data?.length) return null;

  const allSources = res.data.flatMap((m) => m.sources);
  const citedUrls = allSources.map((s) => s.url || "").filter(Boolean);
  const sourceDomains = allSources
    .map((s) => s.domain || (s.url ? tryHostname(s.url) : ""))
    .filter(Boolean);

  const brandMatcher = makeBrandMatcher(config.brandName, config.brandDomain);
  const brandCited = brandMatcher.citedInDomains(sourceDomains) || brandMatcher.citedInUrls(citedUrls);

  const answerText = res.data.map((m) => m.answer || "").join(" ");
  const brandMentioned = brandCited || brandMatcher.mentionedIn(answerText);

  const competitorMentions: Record<string, boolean> = {};
  const competitorCitations: Record<string, boolean> = {};
  for (const comp of config.competitors) {
    const cm = makeCompetitorMatcher(comp);
    competitorMentions[comp] = cm.mentionedIn(answerText);
    competitorCitations[comp] = cm.citedInDomains(sourceDomains);
  }

  return {
    run_id: config.runId,
    project_id: config.projectId,
    prompt_id: prompt.id,
    engine,
    prompt_text: prompt.text,
    brand_mentioned: brandMentioned,
    brand_cited: brandCited,
    competitor_mentions: competitorMentions,
    competitor_citations: competitorCitations,
    source_domains: [...new Set(sourceDomains)],
    cited_urls: citedUrls,
    measurement_mode: "grounded",
    sentiment: brandMentioned ? analyzeSentiment(answerText, config.brandName) : "unknown",
    recommendation_strength: brandMentioned ? recommendationStrength(answerText, config.brandName) : 0,
    owned_cited: brandCited,
    third_party_cited: brandMentioned && [...new Set(sourceDomains)].some((d) => !sameRegistrableDomain(d, config.brandDomain)),
    answer_position: answerPosition(answerText, config.brandName, config.competitors),
    sample_count: res.data.length,
    variance: 0,
    raw_response: {
      llmMentions: res.data,
      data_source: "measured",
      data_source_detail: "dataforseo",
      measurement_mode: "grounded",
      surface: `dataforseo_llm_mentions_${platform}`,
      aiSearchVolume: res.data[0]?.aiSearchVolume,
      entity_prominence: computeEntityProminence(answerText, [config.brandName, ...config.competitors]),
    },
    data_source: "measured",
  };
}

function tryHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const POSITIVE_TERMS = [
  "best", "top", "leading", "excellent", "great", "recommended", "recommend",
  "reliable", "trusted", "popular", "powerful", "favorite", "favourite", "strong",
  "high-quality", "award", "innovative", "preferred",
];
const NEGATIVE_TERMS = [
  "worst", "avoid", "poor", "unreliable", "scam", "disappointing", "lacking",
  "weak", "outdated", "overpriced", "complaint", "complaints", "issues", "buggy",
];

/** Heuristic sentiment in a window around the brand mention. */
function analyzeSentiment(
  text: string,
  brand: string
): "positive" | "neutral" | "negative" | "unknown" {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(brand.toLowerCase());
  if (idx < 0) return "unknown";
  const window = lower.slice(Math.max(0, idx - 140), idx + 140);
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE_TERMS) if (window.includes(w)) pos++;
  for (const w of NEGATIVE_TERMS) if (window.includes(w)) neg++;
  if (pos > neg) return "positive";
  if (neg > pos) return "negative";
  return "neutral";
}

/** 0-1: strongly recommended (1), merely mentioned (0.5), or absent (0). */
function recommendationStrength(text: string, brand: string): number {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(brand.toLowerCase());
  if (idx < 0) return 0;
  const window = lower.slice(Math.max(0, idx - 90), idx + 90);
  const strong = ["best", "#1", "number one", "top", "recommend", "leading", "first choice", "go-to", "the go to"];
  return strong.some((s) => window.includes(s)) ? 1 : 0.5;
}

/** Ordinal position of the brand among brand+competitors by first appearance. */
function answerPosition(text: string, brand: string, competitors: string[]): number | undefined {
  const lower = text.toLowerCase();
  const entries = [
    { name: brand, idx: lower.indexOf(brand.toLowerCase()) },
    ...competitors.map((c) => ({ name: c, idx: lower.indexOf(c.toLowerCase()) })),
  ]
    .filter((e) => e.idx >= 0)
    .sort((a, b) => a.idx - b.idx);
  const pos = entries.findIndex((e) => e.name === brand);
  return pos >= 0 ? pos + 1 : undefined;
}

export interface EntityProminence {
  /** 1 = strongly recommended near the mention, 0.5 = mentioned in passing. */
  strength: number;
  /** Ordinal slot among all named entities by first appearance (1 = first). */
  position: number;
}

/**
 * Per-entity prominence for a single answer — the symmetric building block of a
 * prominence-weighted Share of Voice. Ranks brand + competitors by first
 * appearance and scores each one's recommendation strength, so a competitor
 * named as the "#1 pick" in sentence one outranks one buried at the bottom. We
 * compute this AT SCAN TIME (where the real answer text exists) and persist it
 * in the freeform raw_response JSON, so SoV can be reconstructed without a
 * schema change and without re-querying the model.
 */
export function computeEntityProminence(text: string, entities: string[]): Record<string, EntityProminence> {
  if (!text) return {};
  const lower = text.toLowerCase();
  const found = entities
    .filter((name) => name && name.trim())
    .map((name) => ({ name, idx: lower.indexOf(name.toLowerCase()) }))
    .filter((e) => e.idx >= 0)
    .sort((a, b) => a.idx - b.idx);
  const out: Record<string, EntityProminence> = {};
  found.forEach((e, i) => {
    out[e.name] = { strength: recommendationStrength(text, e.name), position: i + 1 };
  });
  return out;
}

function mapAIResult(data: {
  brandMentioned: boolean;
  brandCited: boolean;
  competitorMentions: Record<string, boolean>;
  competitorCitations: Record<string, boolean>;
  sourceDomains: string[];
  citedUrls: string[];
  rawResponse: string;
  grounded?: boolean;
}) {
  return {
    brand_mentioned: data.brandMentioned,
    brand_cited: data.brandCited,
    competitor_mentions: data.competitorMentions,
    competitor_citations: data.competitorCitations,
    source_domains: data.sourceDomains,
    cited_urls: data.citedUrls,
    grounded: Boolean(data.grounded),
    raw_response: {
      text: data.rawResponse,
      data_source: data.grounded ? "measured" : "model_knowledge",
      data_source_detail: data.grounded ? "llm_grounded" : "llm_direct",
    },
  };
}

export function getResultDataSourceLabel(result: Pick<VisibilityResult, "raw_response">): string {
  const detail = result.raw_response?.data_source_detail;
  if (typeof detail === "string") {
    const labels: Record<string, string> = {
      llm_direct: "Live LLM",
      perplexity: "Perplexity",
      serper: "Serper SERP",
      brave: "Brave SERP",
      dataforseo: "DataForSEO",
      omnidata: "OmniData",
    };
    return labels[detail] || detail;
  }
  const ds = result.raw_response?.data_source;
  if (ds === "measured") return "Live (grounded)";
  if (ds === "model_knowledge") return "Model-knowledge";
  return "Simulated";
}

/**
 * Wilson score interval for a binomial proportion — the small-sample-robust 95%
 * CI that polling/analytics tools use (never returns <0 or >1, and stays sane at
 * n=1 unlike the naive normal approximation). z=1.96 ≈ 95% confidence.
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 0 };
  const phat = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (phat + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n)) / denom;
  return {
    low: Math.max(0, Math.round((center - margin) * 1000) / 1000),
    high: Math.min(1, Math.round((center + margin) * 1000) / 1000),
  };
}

/**
 * Safe truthy-check over the competitor_mentions JSON column. The column is
 * typed Record<string,boolean> but is freeform DB JSON, so legacy/partial rows
 * can hold null or the wrong container — a raw Object.values(null) would throw
 * and crash metric computation (which runs on the dashboard and in scoring).
 */
function anyCompetitorMentioned(cm: unknown): boolean {
  if (!cm || typeof cm !== "object" || Array.isArray(cm)) return false;
  return Object.values(cm as Record<string, unknown>).some(Boolean);
}

export function calculateVisibilityMetrics(results: Array<Pick<VisibilityResult, "brand_mentioned" | "brand_cited" | "competitor_mentions" | "raw_response" | "data_source" | "recommendation_strength" | "answer_position" | "confidence">>) {
  const attempted = results.length;
  const EMPTY = {
    mentionRate: 0,
    citationRate: 0,
    shareOfVoice: 0,
    winRate: 0,
    measuredRate: 0,
    prominence: 0,
    avgPosition: null as number | null,
    confidence: 0,
    mentionRateCI: { low: 0, high: 0 },
    sampleSize: 0,
  };
  if (attempted === 0) return EMPTY;

  const dq = (r: { data_source?: DataQuality; raw_response?: Record<string, unknown> }) =>
    r.data_source ?? (r.raw_response?.data_source as DataQuality | undefined);

  // Rates are computed over the COUNTABLE pool (measured + model_knowledge) so an
  // `unavailable` probe never reads as "brand not mentioned". measuredRate keeps
  // the full attempted denominator to expose coverage gaps honestly.
  const pool = results.filter((r) => {
    const ds = dq(r);
    return ds === "measured" || ds === "model_knowledge";
  });
  const total = pool.length;
  const measured = pool.length;
  if (total === 0) return EMPTY;

  const mentions = pool.filter((r) => r.brand_mentioned).length;
  const citations = pool.filter((r) => r.brand_cited).length;

  const brandWins = pool.filter((r) => {
    const compMentioned = anyCompetitorMentioned(r.competitor_mentions);
    return r.brand_mentioned && !compMentioned;
  }).length;

  const brandAndCompBoth = pool.filter((r) => {
    const compMentioned = anyCompetitorMentioned(r.competitor_mentions);
    return r.brand_mentioned && compMentioned;
  }).length;

  const compOnly = pool.filter((r) => {
    const compMentioned = anyCompetitorMentioned(r.competitor_mentions);
    return !r.brand_mentioned && compMentioned;
  }).length;

  const winRate = (brandWins + brandAndCompBoth + compOnly) > 0
    ? brandWins / (brandWins + brandAndCompBoth + compOnly)
    : 0;

  const totalMentions = mentions + compOnly + brandAndCompBoth;
  const shareOfVoice = totalMentions > 0 ? mentions / totalMentions : 0;

  // Prominence (Profound-class): how STRONGLY the brand is recommended when it
  // appears, not just whether it appears. recommendation_strength is 0-1 (1 =
  // top recommendation, lower = mentioned in passing). avgPosition is the mean
  // ordinal slot among answers that name the brand (lower = better). These
  // separate "named but buried" from "named as the #1 pick" — the signal raw
  // mention-count tools miss.
  const mentionedPool = pool.filter((r) => r.brand_mentioned);
  const prominence = mentionedPool.length
    ? mentionedPool.reduce((s, r) => s + (r.recommendation_strength ?? 0), 0) / mentionedPool.length
    : 0;
  const positions = mentionedPool
    .map((r) => r.answer_position)
    .filter((p): p is number => typeof p === "number" && p > 0);
  const avgPosition = positions.length
    ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10
    : null;

  // Run-level 95% confidence interval on the mention rate (Wilson) so the
  // headline number carries a measured uncertainty band — wide when we could
  // only probe a few times, tight when the pool is large. This is the
  // statistical honesty analyst tools (Profound/Peec) charge for.
  const mentionRateCI = wilsonInterval(mentions, total);

  // Aggregate confidence: mean of per-probe confidence (sample agreement for
  // multi-run LLM reads), falling back to the data-quality prior when a probe
  // didn't carry its own confidence. 0-1, higher = more trustworthy run.
  const confidences = pool.map((r) =>
    typeof r.confidence === "number" ? r.confidence : probeConfidence(dq(r) ?? "simulated")
  );
  const confidence = confidences.length
    ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
    : 0;

  return {
    mentionRate: mentions / total,
    citationRate: citations / total,
    shareOfVoice,
    winRate,
    measuredRate: measured / attempted,
    prominence: Math.round(prominence * 100) / 100,
    avgPosition,
    confidence,
    mentionRateCI,
    sampleSize: total,
  };
}

export interface ProbeTraceRow {
  run_id?: string;
  project_id: string;
  prompt_id?: string;
  engine: string;
  prompt: string;
  persona: string | null;
  geo: string | null;
  response_excerpt: string | null;
  brand_mentioned: boolean;
  brand_cited: boolean;
  cited_sources: string[];
  competitors_mentioned: string[];
  model: string | null;
  grounding_mode: string | null;
  confidence: number;
  data_source: DataQuality;
  checked_at: string;
}

function probeConfidence(ds: DataQuality): number {
  if (ds === "measured") return 0.9;
  if (ds === "model_knowledge") return 0.6;
  if (ds === "estimated") return 0.4;
  return 0; // simulated / unavailable
}

function probeExcerpt(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null;
  const candidate = (raw.answer ?? raw.text ?? raw.label) as unknown;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 600);
  return null;
}

/**
 * Per-probe AEO observability rows. Each visibility result is one prompt×engine
 * probe; this flattens them into an auditable win/loss history (the proof +
 * "magic" layer). Demo/simulated probes are excluded — only real attempts.
 */
export function buildProbeTraceRows(results: VisibilityScanResult[]): ProbeTraceRow[] {
  const now = new Date().toISOString();
  const rows: ProbeTraceRow[] = [];
  for (const r of results) {
    if (r.data_source === "simulated") continue;
    const competitorsMentioned = Object.entries(r.competitor_mentions || {})
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k);
    const detail = (r.raw_response?.data_source_detail ?? r.raw_response?.provider) as
      | string
      | undefined;
    rows.push({
      run_id: r.run_id,
      project_id: r.project_id,
      prompt_id: r.prompt_id,
      engine: r.engine,
      prompt: r.prompt_text,
      persona: (r.raw_response?.persona as string) ?? null,
      geo: (r.raw_response?.geo as string) ?? null,
      response_excerpt: probeExcerpt(r.raw_response),
      brand_mentioned: Boolean(r.brand_mentioned),
      brand_cited: Boolean(r.brand_cited),
      cited_sources: [...new Set(r.source_domains || [])].slice(0, 25),
      competitors_mentioned: competitorsMentioned,
      model: detail ?? null,
      // Distinguish a real product-UI capture from other grounded paths so the
      // trace honestly records HOW the answer was grounded.
      grounding_mode: detail === "ai_ui_capture" ? "ui_capture" : (r.measurement_mode ?? null),
      confidence: probeConfidence(r.data_source),
      data_source: r.data_source,
      checked_at: now,
    });
  }
  return rows;
}

/** Persist probe traces (best-effort; never throws into the scan pipeline). */
export async function persistProbeTraces(
  supabase: {
    from: (t: string) => { insert: (rows: unknown[]) => PromiseLike<{ error: unknown }> };
  },
  results: VisibilityScanResult[]
): Promise<number> {
  const rows = buildProbeTraceRows(results);
  if (!rows.length) return 0;
  // Optional ops-grade mirror; Supabase stays the source of truth.
  if (hasLangfuse()) {
    void mirrorTracesToLangfuse(
      rows.map((r) => ({
        project_id: r.project_id,
        engine: r.engine,
        prompt: r.prompt,
        response_excerpt: r.response_excerpt,
        brand_mentioned: r.brand_mentioned,
        brand_cited: r.brand_cited,
        competitors_mentioned: r.competitors_mentioned,
        model: r.model,
        grounding_mode: r.grounding_mode,
        checked_at: r.checked_at,
      }))
    );
  }
  try {
    const { error } = await supabase.from("ai_probe_traces").insert(rows);
    if (error) {
      logProviderError("visibility.probeTraces", error);
      return 0;
    }
    return rows.length;
  } catch (error) {
    logProviderError("visibility.probeTraces", error);
    return 0;
  }
}

/** Extract citation source rows for DB persistence */
export function extractCitationSources(
  results: VisibilityScanResult[],
  competitors: string[],
  brandDomain?: string
): Array<{
  prompt_text: string;
  platform: string;
  source_domain: string;
  source_url?: string;
  cites_brand: boolean;
  cites_competitor: boolean;
  competitor_name?: string;
  ai_search_volume?: number;
  data_source: DataSource;
}> {
  const rows: Array<{
    prompt_text: string;
    platform: string;
    source_domain: string;
    source_url?: string;
    cites_brand: boolean;
    cites_competitor: boolean;
    competitor_name?: string;
    ai_search_volume?: number;
    data_source: DataSource;
  }> = [];

  const competitorMatchers = competitors.map((c) => ({ name: c, matcher: makeCompetitorMatcher(c) }));

  for (const r of results) {
    const volume = typeof r.raw_response?.aiSearchVolume === "number"
      ? r.raw_response.aiSearchVolume
      : undefined;

    const srcDomains = Array.isArray(r.source_domains) ? r.source_domains : [];
    const citedUrls = Array.isArray(r.cited_urls) ? r.cited_urls : [];
    for (let i = 0; i < srcDomains.length; i++) {
      const domain = srcDomains[i];
      const url = citedUrls[i];
      const citesBrand =
        r.brand_cited ||
        (brandDomain ? sameRegistrableDomain(domain, brandDomain) : false);
      let citesCompetitor = false;
      let competitorName: string | undefined;

      for (const { name, matcher } of competitorMatchers) {
        if (matcher.citedInDomains([domain])) {
          citesCompetitor = true;
          competitorName = name;
        }
      }

      rows.push({
        prompt_text: r.prompt_text,
        platform: r.engine,
        source_domain: domain,
        source_url: url,
        cites_brand: citesBrand,
        cites_competitor: citesCompetitor,
        competitor_name: competitorName,
        ai_search_volume: volume,
        // citation_sources uses the narrow legacy DataSource; model_knowledge
        // answers are still a real measurement of citation behavior.
        data_source: r.data_source === "simulated" ? "simulated" : "measured",
      });
    }
  }

  return rows;
}
