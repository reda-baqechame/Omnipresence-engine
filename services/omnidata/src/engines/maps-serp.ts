/**
 * Local/maps SERP — inspired by google-maps-scraper patterns; uses Serper places when available.
 */

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

export async function runMapsLive(keyword: string, location = "United States"): Promise<MapsResult> {
  if (!SERPER_KEY) {
    return { keyword, location, items: [] };
  }

  try {
    const res = await fetch("https://google.serper.dev/places", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: keyword, location }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { keyword, location, items: [] };

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
    return { keyword, location, items: [] };
  }
}
