import type { SupabaseClient } from "@supabase/supabase-js";
import { searchPlaces, hasPlacesProvider, type PlaceResult } from "@/lib/providers/serper-places";

/**
 * Local SEO engine (Phase 12): GBP audit, map-grid rank tracking (Local Falcon
 * style), NAP consistency, review velocity, and local landing-page generation.
 * Everything uses real Places data; when no Places provider is configured we
 * return available:false rather than fabricated local rankings.
 */

function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchesBrand(place: PlaceResult, brandNorm: string, domainNorm: string): boolean {
  const t = normalize(place.title || "");
  const w = normalize((place.website || "").replace(/^https?:\/\//, "").split("/")[0]);
  return (
    (brandNorm.length > 0 && (t.includes(brandNorm) || brandNorm.includes(t))) ||
    (domainNorm.length > 0 && w.includes(domainNorm))
  );
}

// ---------- GBP audit ----------

export interface GbpAudit {
  available: boolean;
  reason?: string;
  matched?: PlaceResult;
  center?: { lat: number; lng: number };
  checks: { label: string; ok: boolean; recommendation?: string }[];
  completeness: number; // 0-100
}

export async function auditGbpProfile(input: {
  name: string;
  domain: string;
  location?: string;
}): Promise<GbpAudit> {
  if (!hasPlacesProvider()) {
    return {
      available: false,
      reason: "Set SERPER_API_KEY to audit your Google Business Profile.",
      checks: [],
      completeness: 0,
    };
  }

  const brandNorm = normalize(input.name);
  const domainNorm = normalize((input.domain || "").replace(/^https?:\/\//, "").split("/")[0]);
  const places = await searchPlaces(input.name, { location: input.location });
  if (!places) {
    return { available: false, reason: "Places lookup failed.", checks: [], completeness: 0 };
  }
  const matched = places.find((p) => matchesBrand(p, brandNorm, domainNorm));
  if (!matched) {
    return {
      available: true,
      reason: "No matching Google Business Profile found. Claim/verify your profile first.",
      checks: [
        { label: "Profile claimed & on the map", ok: false, recommendation: "Create/verify your GBP at business.google.com." },
      ],
      completeness: 0,
    };
  }

  const checks: GbpAudit["checks"] = [
    { label: "Website linked", ok: Boolean(matched.website), recommendation: matched.website ? undefined : "Add your website URL to the profile." },
    { label: "Address present", ok: Boolean(matched.address), recommendation: matched.address ? undefined : "Add a complete, consistent address." },
    { label: "Phone number", ok: Boolean(matched.phoneNumber), recommendation: matched.phoneNumber ? undefined : "Add a local phone number." },
    { label: "Primary category set", ok: Boolean(matched.category), recommendation: matched.category ? undefined : "Choose the most specific primary category." },
    { label: "Has reviews (10+)", ok: (matched.ratingCount ?? 0) >= 10, recommendation: (matched.ratingCount ?? 0) >= 10 ? undefined : "Run a review-request campaign to build social proof." },
    { label: "Strong rating (4.0+)", ok: (matched.rating ?? 0) >= 4.0, recommendation: (matched.rating ?? 0) >= 4.0 ? undefined : "Address negative feedback and improve service quality." },
  ];

  const passed = checks.filter((c) => c.ok).length;
  return {
    available: true,
    matched,
    center:
      matched.latitude != null && matched.longitude != null
        ? { lat: matched.latitude, lng: matched.longitude }
        : undefined,
    checks,
    completeness: Math.round((passed / checks.length) * 100),
  };
}

// ---------- Map-grid rank tracking ----------

export interface GridCell {
  row: number;
  col: number;
  lat: number;
  lng: number;
  rank: number | null; // brand position in Places results, null = not found in top 20
}

export interface MapGridResult {
  available: boolean;
  reason?: string;
  keyword: string;
  center?: { lat: number; lng: number };
  gridSize: number;
  radiusKm: number;
  cells: GridCell[];
  avgRank: number | null;
  foundCells: number;
  totalCells: number;
}

function buildGrid(centerLat: number, centerLng: number, size: number, radiusKm: number): { row: number; col: number; lat: number; lng: number }[] {
  const points: { row: number; col: number; lat: number; lng: number }[] = [];
  const half = Math.floor(size / 2);
  // ~111km per degree latitude; longitude scaled by cos(lat).
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

export async function runMapGrid(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    keyword: string;
    name: string;
    domain: string;
    location?: string;
    center?: { lat: number; lng: number };
    gridSize?: number;
    radiusKm?: number;
  }
): Promise<MapGridResult> {
  const gridSize = Math.min(7, Math.max(3, input.gridSize || 5));
  const radiusKm = Math.min(20, Math.max(0.5, input.radiusKm || 2));

  if (!hasPlacesProvider()) {
    return {
      available: false,
      reason: "Set SERPER_API_KEY to run map-grid local rank tracking.",
      keyword: input.keyword,
      gridSize,
      radiusKm,
      cells: [],
      avgRank: null,
      foundCells: 0,
      totalCells: 0,
    };
  }

  // Resolve a center if not supplied via a GBP lookup.
  let center = input.center;
  if (!center) {
    const audit = await auditGbpProfile({ name: input.name, domain: input.domain, location: input.location });
    center = audit.center;
  }
  if (!center) {
    return {
      available: false,
      reason: "Could not resolve business coordinates. Ensure your GBP is on the map.",
      keyword: input.keyword,
      gridSize,
      radiusKm,
      cells: [],
      avgRank: null,
      foundCells: 0,
      totalCells: 0,
    };
  }

  const brandNorm = normalize(input.name);
  const domainNorm = normalize((input.domain || "").replace(/^https?:\/\//, "").split("/")[0]);
  const points = buildGrid(center.lat, center.lng, gridSize, radiusKm);

  const cells: GridCell[] = [];
  for (const p of points) {
    const places = await searchPlaces(input.keyword, { ll: `@${p.lat},${p.lng},14z` });
    let rank: number | null = null;
    if (places) {
      const idx = places.findIndex((pl) => matchesBrand(pl, brandNorm, domainNorm));
      rank = idx >= 0 ? idx + 1 : null;
    }
    cells.push({ row: p.row, col: p.col, lat: p.lat, lng: p.lng, rank });
  }

  const found = cells.filter((c) => c.rank != null);
  const avgRank = found.length ? found.reduce((s, c) => s + (c.rank as number), 0) / found.length : null;

  await supabase.from("local_grid_scans").insert({
    project_id: input.projectId,
    keyword: input.keyword,
    center_lat: center.lat,
    center_lng: center.lng,
    grid_size: gridSize,
    radius_km: radiusKm,
    avg_rank: avgRank,
    found_cells: found.length,
    total_cells: cells.length,
    cells,
  });

  return {
    available: true,
    keyword: input.keyword,
    center,
    gridSize,
    radiusKm,
    cells,
    avgRank,
    foundCells: found.length,
    totalCells: cells.length,
  };
}

// ---------- Review velocity ----------

export interface ReviewVelocity {
  available: boolean;
  reason?: string;
  rating: number | null;
  reviewCount: number | null;
  previousCount: number | null;
  newReviews: number | null;
  periodDays: number | null;
}

export async function captureReviewSnapshot(
  supabase: SupabaseClient,
  input: { projectId: string; name: string; domain: string; location?: string }
): Promise<ReviewVelocity> {
  if (!hasPlacesProvider()) {
    return { available: false, reason: "Set SERPER_API_KEY to track reviews.", rating: null, reviewCount: null, previousCount: null, newReviews: null, periodDays: null };
  }
  const audit = await auditGbpProfile(input);
  const rating = audit.matched?.rating ?? null;
  const reviewCount = audit.matched?.ratingCount ?? null;

  // Previous snapshot for velocity.
  const { data: prev } = await supabase
    .from("review_snapshots")
    .select("review_count, captured_at")
    .eq("project_id", input.projectId)
    .eq("platform", "google")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase.from("review_snapshots").insert({
    project_id: input.projectId,
    platform: "google",
    rating,
    review_count: reviewCount,
  });

  let newReviews: number | null = null;
  let periodDays: number | null = null;
  if (prev && typeof prev.review_count === "number" && typeof reviewCount === "number") {
    newReviews = reviewCount - prev.review_count;
    periodDays = Math.max(1, Math.round((Date.now() - new Date(prev.captured_at).getTime()) / 86400000));
  }

  return {
    available: true,
    rating,
    reviewCount,
    previousCount: prev?.review_count ?? null,
    newReviews,
    periodDays,
  };
}

// ---------- NAP consistency ----------

export interface NapResult {
  available: boolean;
  reason?: string;
  canonical?: { name?: string; address?: string; phone?: string };
  directories: { name: string; url: string; action: string }[];
}

const NAP_DIRECTORIES = [
  { name: "Google Business Profile", url: "https://business.google.com" },
  { name: "Bing Places", url: "https://www.bingplaces.com" },
  { name: "Apple Business Connect", url: "https://businessconnect.apple.com" },
  { name: "Yelp", url: "https://biz.yelp.com" },
  { name: "Facebook", url: "https://facebook.com" },
  { name: "Yellow Pages", url: "https://www.yellowpages.com" },
];

export async function checkNapConsistency(input: {
  name: string;
  domain: string;
  location?: string;
}): Promise<NapResult> {
  if (!hasPlacesProvider()) {
    return {
      available: false,
      reason: "Set SERPER_API_KEY to detect your canonical NAP.",
      directories: NAP_DIRECTORIES.map((d) => ({ ...d, action: "Verify listing & match NAP." })),
    };
  }
  const audit = await auditGbpProfile(input);
  return {
    available: true,
    canonical: audit.matched
      ? { name: audit.matched.title, address: audit.matched.address, phone: audit.matched.phoneNumber }
      : undefined,
    directories: NAP_DIRECTORIES.map((d) => ({
      ...d,
      action: "Ensure name, address, and phone exactly match your canonical NAP.",
    })),
  };
}

// ---------- Local landing page ----------

export interface LocalLandingPage {
  service: string;
  city: string;
  title: string;
  markdown: string;
  jsonLd: Record<string, unknown>;
}

export function generateLocalLandingPage(input: {
  name: string;
  domain: string;
  service: string;
  city: string;
  phone?: string;
  address?: string;
}): LocalLandingPage {
  const { name, service, city } = input;
  const title = `${service} in ${city} | ${name}`;
  const markdown = `# ${service} in ${city}

${name} provides professional ${service.toLowerCase()} for homes and businesses across ${city} and surrounding areas. Below is what to expect, why locals choose us, and how to get started.

## Why ${city} chooses ${name}
- Local, ${city}-based team that knows the area
- Transparent pricing with no surprise fees
- Fast response times and reliable scheduling

## Our ${service} process
1. Free consultation and on-site assessment
2. Clear, itemized quote
3. Scheduled, professional service
4. Follow-up to ensure you're satisfied

## ${service} FAQs for ${city} customers

**How much does ${service.toLowerCase()} cost in ${city}?**
Pricing depends on scope; we provide a free, no-obligation quote tailored to your needs.

**Do you serve all of ${city}?**
Yes — we cover ${city} and nearby neighborhoods. Contact us to confirm your address.

## Book ${service.toLowerCase()} in ${city}
Call ${input.phone || "us"} or visit ${input.domain} to schedule your ${service.toLowerCase()} in ${city} today.`;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name,
    url: input.domain.startsWith("http") ? input.domain : `https://${input.domain}`,
    ...(input.phone ? { telephone: input.phone } : {}),
    areaServed: city,
    address: input.address
      ? { "@type": "PostalAddress", streetAddress: input.address, addressLocality: city }
      : { "@type": "PostalAddress", addressLocality: city },
    makesOffer: { "@type": "Offer", itemOffered: { "@type": "Service", name: service, areaServed: city } },
  };

  return { service, city, title, markdown, jsonLd };
}
