/**
 * Sovereign local-geo primitives for the maps/local engine: keyless OSM /
 * Nominatim geocoding plus the pure local-rank-grid math (the keyless Local
 * Falcon replacement). This removes the hard Serper dependency for the local
 * surface — we can anchor a real geocoded center and build a proximity grid with
 * zero paid keys.
 *
 * Pure math (haversineKm/buildLocalGrid) is dependency-free and unit-tested.
 * geocodeNominatim is network-only (public OSM, no key) and degrades to null.
 */

/** Haversine great-circle distance in km between two lat/lng points. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface GridPoint {
  row: number;
  col: number;
  lat: number;
  lng: number;
}

/**
 * Build a `size`×`size` grid of lat/lng points centered on a point, spanning
 * ~`radiusKm`. Longitude steps are scaled by cos(lat) so cells stay ~square.
 */
export function buildLocalGrid(
  centerLat: number,
  centerLng: number,
  size: number,
  radiusKm: number
): GridPoint[] {
  const points: GridPoint[] = [];
  const half = Math.floor(size / 2);
  const latStep = radiusKm / 111 / Math.max(1, half);
  const lngStep = radiusKm / (111 * Math.cos((centerLat * Math.PI) / 180)) / Math.max(1, half);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      points.push({
        row: r,
        col: c,
        lat: centerLat + (r - half) * latStep,
        lng: centerLng + (c - half) * lngStep,
      });
    }
  }
  return points;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  display_name?: string;
}

const NOMINATIM_UA =
  process.env.NOMINATIM_USER_AGENT || "OmniPresence-OmniData/1.0 (+local-geo)";

/**
 * Forward-geocode a location string to lat/lng via the public OSM Nominatim
 * service (keyless). Returns null on any failure so the caller degrades cleanly.
 * Respect Nominatim's usage policy: low volume, identify via User-Agent.
 */
export async function geocodeNominatim(query: string): Promise<GeoPoint | null> {
  if (!query || !query.trim()) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      query
    )}&format=jsonv2&limit=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_UA, "Accept-Language": "en" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    const hit = data[0];
    if (!hit?.lat || !hit?.lon) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, display_name: hit.display_name };
  } catch {
    return null;
  }
}
