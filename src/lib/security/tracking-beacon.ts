import { createHmac, timingSafeEqual } from "crypto";

/** Compute the expected tracking beacon signature for a raw JSON body. */
export function signTrackingBeacon(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Verify x-tracking-signature against the raw request body. */
export function verifyTrackingBeacon(body: string, secret: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = signTrackingBeacon(body, secret);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(header);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
