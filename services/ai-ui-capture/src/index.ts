import express from "express";
import { verifyAuth, assertProductionAuth } from "./auth.js";
import { capture, type Surface } from "./capture.js";
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

const VALID_SURFACES: Surface[] = ["chatgpt", "gemini", "perplexity", "google_ai_overview"];

/**
 * POST /capture
 * Body: { surface, prompt, brandName, brandDomain, competitors }
 * Returns the AiUiCaptureResult shape the app's provider client expects, or 204
 * when the surface could not be grounded (caller falls back + labels honestly).
 */
app.post("/capture", async (req, res) => {
  const { surface, prompt, brandName, brandDomain, competitors } = (req.body || {}) as {
    surface?: string;
    prompt?: string;
    brandName?: string;
    brandDomain?: string;
    competitors?: string[];
  };

  if (!surface || !VALID_SURFACES.includes(surface as Surface)) {
    return res.status(400).json({ error: `surface must be one of ${VALID_SURFACES.join(", ")}` });
  }
  if (!prompt || !brandName || !brandDomain) {
    return res.status(400).json({ error: "prompt, brandName and brandDomain are required" });
  }

  try {
    const raw = await capture(surface as Surface, prompt);
    if (!raw) {
      // Not grounded (login required, selector miss, or platform blocked). Never fabricate.
      return res.status(204).end();
    }
    const result = analyzeCapture(raw.answer, raw.citedUrls, brandName, brandDomain, competitors || []);
    return res.json(result);
  } catch (err) {
    console.error("capture failed", err);
    return res.status(502).json({ error: "capture failed" });
  }
});

app.listen(PORT, () => {
  console.log(`ai-ui-capture listening on :${PORT}`);
});
