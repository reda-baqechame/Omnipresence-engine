import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";

const DEFAULT_DEV_KEY = "dev-local-key";
const API_KEY = process.env.AI_UI_CAPTURE_KEY || DEFAULT_DEV_KEY;
const SIGNING_SECRET = process.env.AI_UI_CAPTURE_SIGNING_SECRET || API_KEY;

/**
 * Refuse to boot in a public/production environment with insecure defaults — a
 * capture service with the well-known dev key is an open browser-automation
 * endpoint, so fail loudly at startup rather than silently serving anyone.
 */
export function assertProductionAuth(): void {
  const isProd =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT) ||
    Boolean(process.env.FLY_APP_NAME);
  if (!isProd) return;

  const problems: string[] = [];
  if (!process.env.AI_UI_CAPTURE_KEY) {
    problems.push("AI_UI_CAPTURE_KEY must be set");
  } else if (process.env.AI_UI_CAPTURE_KEY === DEFAULT_DEV_KEY) {
    problems.push("AI_UI_CAPTURE_KEY must not be the default 'dev-local-key'");
  } else if (process.env.AI_UI_CAPTURE_KEY.length < 24) {
    problems.push("AI_UI_CAPTURE_KEY must be at least 24 characters");
  }

  if (problems.length > 0) {
    throw new Error(
      `ai-ui-capture refused to start — insecure production configuration:\n  - ${problems.join("\n  - ")}\n` +
        "Generate a strong key (e.g. `openssl rand -hex 32`) and set it before deploying."
    );
  }
}

function verifyApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers.authorization?.replace(/^Bearer\s+/i, "") || (req.headers["x-api-key"] as string | undefined);
  if (!key || key !== API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * Accepts either a signed request (x-aiuicapture-signature + -timestamp, HMAC
 * over `${timestamp}.${body}`) or a plain Bearer API key. The app's provider
 * client (src/lib/providers/ai-ui-capture.ts) uses the Bearer path by default.
 */
export function verifyAuth(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers["x-aiuicapture-signature"] as string | undefined;
  const timestamp = req.headers["x-aiuicapture-timestamp"] as string | undefined;
  if (!signature || !timestamp) {
    return verifyApiKey(req, res, next);
  }
  const age = Math.abs(Date.now() - Number(timestamp));
  if (Number.isNaN(age) || age > 300_000) {
    res.status(401).json({ error: "Request expired" });
    return;
  }
  const body = JSON.stringify(req.body ?? {});
  const expected = createHmac("sha256", SIGNING_SECRET).update(`${timestamp}.${body}`).digest("hex");
  try {
    const ok = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!ok) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  } catch {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }
  next();
}
