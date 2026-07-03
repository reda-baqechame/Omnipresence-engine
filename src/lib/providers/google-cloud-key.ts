/**
 * Single Google Cloud API key used across PageSpeed, CrUX, YouTube, KG, NLP, etc.
 * Set PAGESPEED_API_KEY (or GOOGLE_CLOUD_API_KEY) once; enable APIs on the key in GCP.
 */

export function getGoogleCloudApiKey(): string | null {
  for (const env of [
    "PAGESPEED_API_KEY",
    "GOOGLE_CLOUD_API_KEY",
    "YOUTUBE_API_KEY",
    "GOOGLE_KG_API_KEY",
    "CRUX_API_KEY",
  ]) {
    const k = process.env[env];
    if (k && k.trim() && !k.startsWith("your-")) return k.trim();
  }
  return null;
}

export function hasGoogleCloudApiKey(): boolean {
  return getGoogleCloudApiKey() != null;
}
