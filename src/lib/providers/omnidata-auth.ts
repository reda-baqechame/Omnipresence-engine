export const OMNIDATA_DEV_KEY = "dev-local-key";
const MIN_KEY_LENGTH = 24;

function isProductionDeploy(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT)
  );
}

/** True when OmniData is pointed at a non-local host (Railway, public URL). */
export function isRemoteOmniDataUrl(baseUrl?: string): boolean {
  const url = (baseUrl ?? process.env.OMNIDATA_BASE_URL ?? "").replace(/\/$/, "");
  if (!url) return false;
  return !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url);
}

/**
 * Refuse remote OmniData calls with missing, short, or default API keys.
 * Local docker-compose may still use dev-local-key on localhost.
 */
export function assertOmniDataClientConfigured(): void {
  const base = process.env.OMNIDATA_BASE_URL?.replace(/\/$/, "");
  if (!base || !isRemoteOmniDataUrl(base)) return;

  const key = process.env.OMNIDATA_API_KEY;
  if (!key || key === OMNIDATA_DEV_KEY || key.length < MIN_KEY_LENGTH) {
    throw new Error(
      "OMNIDATA_API_KEY must be set to a strong secret (24+ chars, not 'dev-local-key') when OMNIDATA_BASE_URL is remote. " +
        "Sync via: node scripts/sync-ci-secrets.mjs --vercel"
    );
  }

  if (isProductionDeploy() && !process.env.OMNIDATA_SIGNING_SECRET) {
    throw new Error(
      "OMNIDATA_SIGNING_SECRET must be set in production when using remote OmniData. " +
        "Generate with: openssl rand -hex 32"
    );
  }
}

/** Resolve API key for OmniData requests (throws on insecure remote config). */
export function resolveOmniDataApiKey(): string {
  assertOmniDataClientConfigured();
  const base = process.env.OMNIDATA_BASE_URL?.replace(/\/$/, "");
  if (base && isRemoteOmniDataUrl(base)) {
    return process.env.OMNIDATA_API_KEY as string;
  }
  return process.env.OMNIDATA_API_KEY || OMNIDATA_DEV_KEY;
}
