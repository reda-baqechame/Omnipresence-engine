import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";

const DEFAULT_DEV_KEY = "dev-local-key";
const API_KEY = process.env.OMNIDATA_API_KEY || DEFAULT_DEV_KEY;
const SIGNING_SECRET = process.env.OMNIDATA_SIGNING_SECRET || API_KEY;

/**
 * Refuse to boot in a public/production environment with insecure defaults.
 * A self-hosted OmniData with the well-known dev key is an open data endpoint,
 * so we fail loudly at startup rather than silently serving anyone.
 */
export function assertProductionAuth(): void {
  const isProd =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT) ||
    Boolean(process.env.FLY_APP_NAME);
  if (!isProd) return;

  const problems: string[] = [];
  if (!process.env.OMNIDATA_API_KEY) {
    problems.push("OMNIDATA_API_KEY must be set");
  } else if (process.env.OMNIDATA_API_KEY === DEFAULT_DEV_KEY) {
    problems.push("OMNIDATA_API_KEY must not be the default 'dev-local-key'");
  } else if (process.env.OMNIDATA_API_KEY.length < 24) {
    problems.push("OMNIDATA_API_KEY must be at least 24 characters");
  }
  if (!process.env.OMNIDATA_SIGNING_SECRET) {
    problems.push("OMNIDATA_SIGNING_SECRET must be set (do not rely on the API key fallback in production)");
  } else if (process.env.OMNIDATA_SIGNING_SECRET.length < 24) {
    problems.push("OMNIDATA_SIGNING_SECRET must be at least 24 characters");
  }

  if (problems.length > 0) {
    throw new Error(
      `OmniData refused to start — insecure production configuration:\n  - ${problems.join("\n  - ")}\n` +
        "Generate strong secrets (e.g. `openssl rand -hex 32`) and set them before deploying."
    );
  }
}

export function verifyApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-api-key"];
  if (!key || key !== API_KEY) {
    res.status(401).json({ status_code: 40100, status_message: "Unauthorized" });
    return;
  }
  next();
}

export function verifySignedRequest(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers["x-omnidata-signature"] as string | undefined;
  const timestamp = req.headers["x-omnidata-timestamp"] as string | undefined;
  if (!signature || !timestamp) {
    return verifyApiKey(req, res, next);
  }
  const age = Math.abs(Date.now() - Number(timestamp));
  if (Number.isNaN(age) || age > 300_000) {
    res.status(401).json({ status_code: 40101, status_message: "Request expired" });
    return;
  }
  const body = JSON.stringify(req.body ?? {});
  const expected = createHmac("sha256", SIGNING_SECRET)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  try {
    const ok = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!ok) {
      res.status(401).json({ status_code: 40102, status_message: "Invalid signature" });
      return;
    }
  } catch {
    res.status(401).json({ status_code: 40102, status_message: "Invalid signature" });
    return;
  }
  next();
}

export function signPayload(body: unknown): Record<string, string> {
  const timestamp = String(Date.now());
  const payload = JSON.stringify(body);
  const signature = createHmac("sha256", SIGNING_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return {
    "x-omnidata-timestamp": timestamp,
    "x-omnidata-signature": signature,
  };
}
