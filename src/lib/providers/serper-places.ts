/**
 * Serper Places helper supporting coordinate-based queries (Phase 12).
 * Used for map-grid (Local Falcon style) rank tracking where each grid cell is
 * queried from a different lat/lng to see how local ranking varies by location.
 */

export interface PlaceResult {
  position?: number;
  title?: string;
  address?: string;
  rating?: number;
  ratingCount?: number;
  website?: string;
  latitude?: number;
  longitude?: number;
  category?: string;
  phoneNumber?: string;
}

function serperKey(): string | null {
  const k = process.env.SERPER_API_KEY;
  return k && !k.startsWith("your-") ? k : null;
}

export function hasPlacesProvider(): boolean {
  return Boolean(serperKey());
}

export async function searchPlaces(
  query: string,
  options?: { location?: string; ll?: string }
): Promise<PlaceResult[] | null> {
  const key = serperKey();
  if (!key) return null;
  try {
    const body: Record<string, string> = { q: query };
    if (options?.location) body.location = options.location;
    if (options?.ll) body.ll = options.ll; // "@lat,lng,zoom"
    const res = await fetch("https://google.serper.dev/places", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { places?: PlaceResult[] };
    return (data.places || []).map((p, i) => ({ ...p, position: p.position ?? i + 1 }));
  } catch {
    return null;
  }
}
