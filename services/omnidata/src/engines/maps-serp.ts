/**
 * Local/maps SERP — inspired by google-maps-scraper patterns; uses Serper places
 * when available, with an env-gated keyless Playwright fallback.
 */
import { scrapeGoogleMaps } from "./scrape.js";

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
}

async function mapsViaScrape(keyword: string, location: string): Promise<MapsResult> {
  const scraped = await scrapeGoogleMaps(keyword);
  if (!scraped) return { keyword, location, items: [] };
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

    return { keyword, location, items };
  } catch {
    return mapsViaScrape(keyword, location);
  }
}
