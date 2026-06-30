/**
 * Local/maps SERP — inspired by google-maps-scraper patterns. Prefers Serper
 * places when available, then a keyless Playwright scrape, and is anchored to a
 * REAL OSM/Nominatim geocoded center (keyless) so the local surface is never
 * Serper-only. The geocoded center also seeds a keyless local-rank grid (the
 * Local Falcon replacement) for proximity-aware local tracking.
 */
import { scrapeGoogleMaps } from "./scrape.js";
import { geocodeNominatim, buildLocalGrid, type GridPoint } from "./geo.js";

const SERPER_KEY = process.env.SERPER_API_KEY;

export interface MapsResult {
  keyword: string;
  location: string;
  items: Array<{
    title: string;
    address?: string;
    rating?: number;
    reviews?: number;
    place_id?: string;
    domain?: string;
    position: number;
  }>;
  /** Real OSM-geocoded center for the location, when resolvable (keyless). */
  geo?: { lat: number; lng: number; display_name?: string } | null;
  /** Keyless local-rank grid seeded from the geocoded center, when available. */
  grid?: GridPoint[];
  /** Where the listing came from: serper | scrape | none. */
  source: "serper" | "scrape" | "none";
}

/**
 * Geocode the location via keyless OSM Nominatim and build a proximity grid.
 * Never throws; returns nulls/empties so a maps response is always well-formed.
 */
async function localGeoContext(
  location: string
): Promise<{ geo: MapsResult["geo"]; grid: GridPoint[] }> {
  const geo = await geocodeNominatim(location).catch(() => null);
  if (!geo) return { geo: null, grid: [] };
  // 5×5 grid spanning ~10km — the standard local-rank scan footprint.
  return { geo, grid: buildLocalGrid(geo.lat, geo.lng, 5, 10) };
}

async function mapsViaScrape(keyword: string, location: string): Promise<MapsResult> {
  const [scraped, ctx] = await Promise.all([
    scrapeGoogleMaps(keyword),
    localGeoContext(location),
  ]);
  if (!scraped) {
    return { keyword, location, items: [], geo: ctx.geo, grid: ctx.grid, source: "none" };
  }
  return {
    keyword,
    location,
    items: scraped.map((p) => ({
      title: p.title,
      address: p.address,
      rating: p.rating,
      reviews: p.reviews,
      domain: p.domain,
      position: p.position,
    })),
    geo: ctx.geo,
    grid: ctx.grid,
    source: "scrape",
  };
}

export async function runMapsLive(keyword: string, location = "United States"): Promise<MapsResult> {
  if (!SERPER_KEY) {
    return mapsViaScrape(keyword, location);
  }

  try {
    const res = await fetch("https://google.serper.dev/places", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: keyword, location }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return mapsViaScrape(keyword, location);

    const data = (await res.json()) as {
      places?: Array<{
        title?: string;
        address?: string;
        rating?: number;
        ratingCount?: number;
        placeId?: string;
        website?: string;
      }>;
    };

    const items = (data.places || []).map((p, i) => {
      let domain: string | undefined;
      if (p.website) {
        try {
          domain = new URL(p.website).hostname.replace(/^www\./, "");
        } catch {
          domain = undefined;
        }
      }
      return {
        title: p.title || "",
        address: p.address,
        rating: p.rating,
        reviews: p.ratingCount,
        place_id: p.placeId,
        domain,
        position: i + 1,
      };
    });

    // Anchor even the Serper result to a real keyless geocoded center + grid.
    const ctx = await localGeoContext(location);
    return { keyword, location, items, geo: ctx.geo, grid: ctx.grid, source: "serper" };
  } catch {
    return mapsViaScrape(keyword, location);
  }
}
