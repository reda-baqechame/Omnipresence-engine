import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

/**
 * OpenStreetMap providers (Phase 13) — fully keyless local data.
 *  - Nominatim: geocoding / reverse-geocoding for NAP verification.
 *  - Overpass: nearby competitor businesses (POIs) for local discovery.
 * Both are free public services; we respect a single-request, descriptive
 * User-Agent. Degrade gracefully to `available:false`.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const UA = "OmniPresence-LocalSEO/1.0 (https://github.com; contact via app)";

export interface GeoPlace {
  displayName: string;
  lat: number;
  lng: number;
  type?: string;
  address?: {
    road?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

export async function geocode(query: string): Promise<{ available: boolean; reason?: string; results: GeoPlace[] }> {
  if (!query || !query.trim()) return { available: false, reason: "Empty query", results: [] };
  try {
    const url = `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=1&limit=5`;
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, "Accept-Language": "en" }, timeoutMs: 12_000 });
    if (!res.ok) return { available: false, reason: `Nominatim ${res.status}`, results: [] };
    const data = (await res.json()) as Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
      type?: string;
      address?: Record<string, string>;
    }>;
    const results: GeoPlace[] = (data || []).map((d) => ({
      displayName: d.display_name || "",
      lat: Number(d.lat),
      lng: Number(d.lon),
      type: d.type,
      address: d.address
        ? {
            road: d.address.road,
            city: d.address.city || d.address.town || d.address.village,
            state: d.address.state,
            postcode: d.address.postcode,
            country: d.address.country,
          }
        : undefined,
    }));
    return { available: results.length > 0, results };
  } catch (error) {
    logProviderError("osm-nominatim", error, { query });
    return { available: false, reason: error instanceof Error ? error.message : "Nominatim failed", results: [] };
  }
}

export interface NearbyBusiness {
  name: string;
  category: string;
  lat: number;
  lng: number;
  website?: string;
  phone?: string;
}

/**
 * Find nearby businesses (competitors) of a category via Overpass.
 * `category` maps to OSM tags (e.g. "restaurant", "dentist", "plumber").
 */
export async function findNearbyBusinesses(input: {
  lat: number;
  lng: number;
  radiusMeters?: number;
  category?: string;
  limit?: number;
}): Promise<{ available: boolean; reason?: string; businesses: NearbyBusiness[] }> {
  const radius = Math.min(20_000, Math.max(200, input.radiusMeters || 3000));
  const limit = Math.min(100, Math.max(5, input.limit || 40));
  const cat = (input.category || "").toLowerCase().trim();

  // Build a tolerant Overpass filter: shops, amenities, offices, crafts whose
  // name exists; optionally narrow by category keyword.
  const catFilter = cat ? `["name"~"${escapeRegex(cat)}",i]` : `["name"]`;
  const query = `[out:json][timeout:20];
(
  node(around:${radius},${input.lat},${input.lng})["shop"]${cat ? catFilter : `["name"]`};
  node(around:${radius},${input.lat},${input.lng})["amenity"]${cat ? catFilter : `["name"]`};
  node(around:${radius},${input.lat},${input.lng})["office"]${cat ? catFilter : `["name"]`};
  node(around:${radius},${input.lat},${input.lng})["craft"]${cat ? catFilter : `["name"]`};
);
out body ${limit};`;

  try {
    const res = await fetchWithTimeout(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: `data=${encodeURIComponent(query)}`,
      timeoutMs: 25_000,
    });
    if (!res.ok) return { available: false, reason: `Overpass ${res.status}`, businesses: [] };
    const data = (await res.json()) as {
      elements?: Array<{ lat?: number; lon?: number; tags?: Record<string, string> }>;
    };
    const seen = new Set<string>();
    const businesses: NearbyBusiness[] = [];
    for (const el of data.elements || []) {
      const tags = el.tags || {};
      const name = tags.name;
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      businesses.push({
        name,
        category: tags.shop || tags.amenity || tags.office || tags.craft || "business",
        lat: el.lat ?? input.lat,
        lng: el.lon ?? input.lng,
        website: tags.website || tags["contact:website"],
        phone: tags.phone || tags["contact:phone"],
      });
      if (businesses.length >= limit) break;
    }
    return { available: true, businesses };
  } catch (error) {
    logProviderError("osm-overpass", error, { lat: input.lat, lng: input.lng });
    return { available: false, reason: error instanceof Error ? error.message : "Overpass failed", businesses: [] };
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
