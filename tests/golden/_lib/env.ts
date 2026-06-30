/**
 * Service detection for accuracy tests.
 *
 * Accuracy audits hit REAL sovereign services (OmniData webgraph, SearXNG,
 * PageSpeed, OSM, Ollama, ...). In CI those may not be reachable, so each test
 * calls `requireService(...)` and self-skips with a clear reason when the
 * service isn't configured — keeping the gate green locally while still failing
 * hard in any environment where the service IS configured but returns
 * inaccurate data. Dependency-free so it loads under `node --test`.
 */

function has(name: string): boolean {
  const v = process.env[name];
  return Boolean(v && v.trim() && !v.startsWith("your-"));
}

export type ServiceName =
  | "omnidata"
  | "searxng"
  | "serp" // any SERP path: searxng OR omnidata OR serper/brave keys
  | "pagespeed"
  | "osm" // public Nominatim/Overpass — network-only, no key
  | "ollama"
  | "webgraph"; // backlinks via OmniData webgraph

export interface ServiceStatus {
  ok: boolean;
  reason: string;
}

/**
 * Whether OSM/PageSpeed-style keyless public endpoints should be exercised.
 * They need network but no key; gate them behind GOLDEN_ALLOW_NETWORK so CI
 * without egress doesn't flake.
 */
function networkAllowed(): boolean {
  return process.env.GOLDEN_ALLOW_NETWORK === "true";
}

export function requireService(name: ServiceName): ServiceStatus {
  switch (name) {
    case "omnidata":
    case "webgraph":
      return has("OMNIDATA_BASE_URL")
        ? { ok: true, reason: "" }
        : { ok: false, reason: "OMNIDATA_BASE_URL not set" };
    case "searxng":
      return has("SEARXNG_URLS") || has("SEARXNG_URL")
        ? { ok: true, reason: "" }
        : { ok: false, reason: "SEARXNG_URLS not set" };
    case "serp":
      if (has("SEARXNG_URLS") || has("SEARXNG_URL") || has("OMNIDATA_BASE_URL") || has("SERPER_API_KEY") || has("BRAVE_SEARCH_API_KEY")) {
        return { ok: true, reason: "" };
      }
      return { ok: false, reason: "no SERP provider configured (SearXNG/OmniData/Serper/Brave)" };
    case "pagespeed":
      return networkAllowed()
        ? { ok: true, reason: "" }
        : { ok: false, reason: "GOLDEN_ALLOW_NETWORK!=true (PageSpeed needs egress)" };
    case "osm":
      return networkAllowed()
        ? { ok: true, reason: "" }
        : { ok: false, reason: "GOLDEN_ALLOW_NETWORK!=true (OSM needs egress)" };
    case "ollama":
      return has("OLLAMA_BASE_URL")
        ? { ok: true, reason: "" }
        : { ok: false, reason: "OLLAMA_BASE_URL not set" };
    default:
      return { ok: false, reason: `unknown service ${name}` };
  }
}
