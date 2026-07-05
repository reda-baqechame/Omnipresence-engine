/**
 * Map human-readable project locations to ISO 3166-1 alpha-2 geo codes for
 * SERP gl/hl params and AI UI capture locale bias.
 */
const LOCATION_TO_GEO: Record<string, string> = {
  "united states": "US",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  canada: "CA",
  "united kingdom": "GB",
  uk: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  ireland: "IE",
  germany: "DE",
  deutschland: "DE",
  france: "FR",
  spain: "ES",
  italy: "IT",
  netherlands: "NL",
  belgium: "BE",
  switzerland: "CH",
  austria: "AT",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  poland: "PL",
  portugal: "PT",
  australia: "AU",
  "new zealand": "NZ",
  india: "IN",
  japan: "JP",
  "south korea": "KR",
  korea: "KR",
  singapore: "SG",
  mexico: "MX",
  brazil: "BR",
  argentina: "AR",
  "south africa": "ZA",
  uae: "AE",
  "united arab emirates": "AE",
};

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Convert a project location string (e.g. "Toronto, Canada", "Germany") to an
 * ISO country code for capture/SERP geo routing. Defaults to US when unknown.
 */
export function locationToGeo(location?: string | null): string {
  const raw = (location || "United States").trim();
  if (!raw) return "US";
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();

  const lower = normalizeKey(raw);
  if (LOCATION_TO_GEO[lower]) return LOCATION_TO_GEO[lower];

  const segments = raw.split(",").map((s) => normalizeKey(s));
  for (let i = segments.length - 1; i >= 0; i--) {
    const hit = LOCATION_TO_GEO[segments[i]];
    if (hit) return hit;
  }

  for (const [key, code] of Object.entries(LOCATION_TO_GEO)) {
    if (lower.includes(key)) return code;
  }

  return "US";
}

export function captureOptionsFromLocation(location?: string | null): {
  geo: string;
  locale: string;
} {
  const geo = locationToGeo(location);
  const locale = /^[A-Z]{2}$/.test(geo) ? `en-${geo}` : "en-US";
  return { geo, locale };
}
