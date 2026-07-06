import express from "express";
import { verifyAuth, assertProductionAuth } from "./auth.js";
import { capture, isBlocked, type Surface, type CaptureOptions } from "./capture.js";
import { analyzeCapture } from "./analyze.js";
import { getSurfaceHealthSnapshot, markSurfaceBlocked, markSurfaceFailed, markSurfaceSuccess, markSurfaceUngrounded } from "./surface-health.js";
import { retryWithExponentialBackoff } from "./retry-policy.js";
import { writeCaptureEvidence } from "./evidence-writer.js";
import { withCaptureSlot, captureConcurrencySnapshot } from "./concurrency.js";
import { renderHtmlToPdf } from "./render-pdf.js";
import { executeCaptureViaQueue, isQueueEnabled, startCaptureWorker } from "./queue.js";

// Fail fast on insecure production config before binding the port.
assertProductionAuth();

const PORT = Number(process.env.PORT || 8788);
const app = express();
app.use(express.json({ limit: "1mb" }));

// Public, unauthenticated health endpoint for container/orchestrator probes.
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ai-ui-capture",
    version: "0.2.0",
    surfaceHealth: getSurfaceHealthSnapshot(),
    concurrency: captureConcurrencySnapshot(),
  });
});

app.use(verifyAuth);

const VALID_SURFACES: Surface[] = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "bing_copilot"];
const RETRY_ATTEMPTS = Number(process.env.AI_UI_CAPTURE_RETRY_ATTEMPTS || 3);

function shouldRetryCapture(result: Awaited<ReturnType<typeof capture>>): boolean {
  if (!result) return true;
  if (!isBlocked(result)) return false;
  const reason = (result.reason || "").toLowerCase();
  return reason.includes("rate") || reason.includes("traffic") || reason.includes("timeout");
}

/**
 * POST /capture
 * Body: { surface, prompt, brandName, brandDomain, competitors,
 *         geo?, locale?, timezone?, persona?, withEvidence? }
 * Returns the AiUiCaptureResult shape the app's provider client expects,
 * augmented with first-class evidence (responseHash + screenshotBase64 +
 * domHtml) and the effective capture context. Honest non-results:
 *  - 204 when the surface couldn't be grounded (login required / selector miss).
 *  - 409 { blocked, reason } when rate-limited/captcha/consent-walled — we never
 *    fabricate an answer; the caller labels the surface "unavailable".
 */
app.post("/capture", async (req, res) => {
  const { surface, prompt, brandName, brandDomain, competitors, geo, locale, timezone, persona, withEvidence } =
    (req.body || {}) as {
      surface?: string;
      prompt?: string;
      brandName?: string;
      brandDomain?: string;
      competitors?: string[];
      geo?: string;
      locale?: string;
      timezone?: string;
      persona?: "desktop" | "mobile";
      withEvidence?: boolean;
    };

  if (!surface || !VALID_SURFACES.includes(surface as Surface)) {
    return res.status(400).json({ error: `surface must be one of ${VALID_SURFACES.join(", ")}` });
  }
  if (!prompt || !brandName || !brandDomain) {
    return res.status(400).json({ error: "prompt, brandName and brandDomain are required" });
  }

  const options: CaptureOptions = { geo, locale, timezone, persona, withEvidence };
  const selectedSurface = surface as Surface;

  try {
    const raw = isQueueEnabled()
      ? await executeCaptureViaQueue({
          surface: selectedSurface,
          prompt,
          options,
          retryAttempts: RETRY_ATTEMPTS,
        })
      : await withCaptureSlot(() =>
          retryWithExponentialBackoff(
            () => capture(selectedSurface, prompt, options),
            {
              attempts: RETRY_ATTEMPTS,
              shouldRetry: (_error, _attempt, result) => shouldRetryCapture(result ?? null),
            }
          )
        );

    if (!raw) {
      // Not grounded (login required, selector miss). Never fabricate.
      markSurfaceUngrounded(selectedSurface);
      return res.status(204).end();
    }
    if (isBlocked(raw)) {
      // Rate-limited / captcha / consent wall — honest "unavailable", not a fake answer.
      markSurfaceBlocked(selectedSurface);
      return res.status(409).json({ blocked: true, reason: raw.reason });
    }

    const isAbsence = raw.surfacePresent === false;
    markSurfaceSuccess(selectedSurface);

    let evidencePaths: Awaited<ReturnType<typeof writeCaptureEvidence>> | null = null;
    try {
      evidencePaths = await writeCaptureEvidence({
        surface: selectedSurface,
        responseHash: raw.responseHash,
        answer: raw.answer,
        citedUrls: raw.citedUrls,
        screenshotBase64: raw.screenshotBase64,
        domHtml: raw.domHtml,
      });
    } catch {
      // Evidence persistence is best-effort; capture response still succeeds.
    }

    const analysis = analyzeCapture(raw.answer, raw.citedUrls, brandName, brandDomain, competitors || []);
    // Pass evidence + provenance through so the app persists it (ai_capture_evidence).
    return res.json({
      ...analysis,
      surfacePresent: raw.surfacePresent !== false,
      responseHash: raw.responseHash,
      screenshotBase64: raw.screenshotBase64 ?? null,
      domHtml: raw.domHtml ?? null,
      domHash: raw.domHash ?? null,
      captureContext: raw.context,
      evidencePaths,
      evidenceUrl: evidencePaths?.evidencePublicUrl ?? null,
      ...(isAbsence ? { absence: true } : {}),
    });
    } catch (err) {
      console.error("capture failed", err);
      markSurfaceFailed(selectedSurface);
      // Transient infra failure — 204 so callers can fall back honestly (not 502).
      return res.status(204).end();
    }
});

/**
 * POST /render-pdf
 * Body: { html: string }
 * Returns application/pdf — full HTML/CSS rendering via Playwright.
 */
app.post("/render-pdf", async (req, res) => {
  const { html } = (req.body || {}) as { html?: string };
  if (!html || typeof html !== "string") {
    return res.status(400).json({ error: "html (string) is required" });
  }
  if (html.length > 5_000_000) {
    return res.status(413).json({ error: "html payload too large" });
  }

  try {
    const pdf = await withCaptureSlot(() =>
      renderHtmlToPdf({ html, timeoutMs: Number(process.env.REPORT_PDF_TIMEOUT_MS || 90_000) })
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(pdf.length));
    return res.send(pdf);
  } catch (err) {
    console.error("render-pdf failed", err);
    return res.status(500).json({ error: "pdf_render_failed" });
  }
});

if (isQueueEnabled()) {
  startCaptureWorker();
}

app.listen(PORT, () => {
  console.log(`ai-ui-capture listening on :${PORT}${isQueueEnabled() ? " (BullMQ worker active)" : ""}`);
});
