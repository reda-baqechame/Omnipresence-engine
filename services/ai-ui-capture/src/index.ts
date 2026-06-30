import express from "express";
import { verifyAuth, assertProductionAuth } from "./auth.js";
import { capture, isBlocked, type Surface, type CaptureOptions } from "./capture.js";
import { analyzeCapture } from "./analyze.js";

// Fail fast on insecure production config before binding the port.
assertProductionAuth();

const PORT = Number(process.env.PORT || 8788);
const app = express();
app.use(express.json({ limit: "1mb" }));

// Public, unauthenticated health endpoint for container/orchestrator probes.
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ai-ui-capture", version: "0.1.0" });
});

app.use(verifyAuth);

const VALID_SURFACES: Surface[] = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "bing_copilot"];

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

  try {
    const raw = await capture(surface as Surface, prompt, options);
    if (!raw) {
      // Not grounded (login required, selector miss). Never fabricate.
      return res.status(204).end();
    }
    if (isBlocked(raw)) {
      // Rate-limited / captcha / consent wall — honest "unavailable", not a fake answer.
      return res.status(409).json({ blocked: true, reason: raw.reason });
    }
    const analysis = analyzeCapture(raw.answer, raw.citedUrls, brandName, brandDomain, competitors || []);
    // Pass evidence + provenance through so the app persists it (ai_capture_evidence).
    return res.json({
      ...analysis,
      responseHash: raw.responseHash,
      screenshotBase64: raw.screenshotBase64 ?? null,
      domHtml: raw.domHtml ?? null,
      captureContext: raw.context,
    });
  } catch (err) {
    console.error("capture failed", err);
    return res.status(502).json({ error: "capture failed" });
  }
});

app.listen(PORT, () => {
  console.log(`ai-ui-capture listening on :${PORT}`);
});
