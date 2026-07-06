import { createHash } from "node:crypto";

/**
 * Strip volatile DOM noise so structurally equivalent pages hash identically.
 * Removes scripts/styles, dynamic ids, nonces, and common timestamp patterns.
 */
export function canonicalizeDom(html: string): string {
  if (!html) return "";

  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/\bid=["'][^"']*["']/gi, 'id=""');
  s = s.replace(
    /\s(?:nonce|data-(?:ts|timestamp|nonce|v|rid|reqid|request-id|session|token))=["'][^"']*["']/gi,
    ""
  );
  s = s.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, "");
  s = s.replace(/\b1\d{12,13}\b/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** sha256 of canonicalized DOM — stable fingerprint for evidence dedup / drift checks. */
export function hashDom(html: string): string {
  return createHash("sha256").update(canonicalizeDom(html), "utf8").digest("hex");
}
