import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";

const API_KEY = process.env.OMNIDATA_API_KEY || "dev-local-key";
const SIGNING_SECRET = process.env.OMNIDATA_SIGNING_SECRET || API_KEY;

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
