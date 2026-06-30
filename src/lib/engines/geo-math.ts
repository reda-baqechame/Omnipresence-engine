/**
 * Pure, dependency-free geo math (no IO, no `@/` imports) for the keyless
 * local map-grid. The proximity ranking that replaces Local Falcon's paid grid
 * depends entirely on correct great-circle distance, so it lives here to be
 * audited directly against known geocode distances.
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

/**
 * Build a `size`×`size` grid of lat/lng points centered on a point, spanning
 * ~`radiusKm`. Longitude steps are scaled by cos(lat) so cells stay ~square.
 */
export function buildGrid(
  centerLat: number,
  centerLng: number,
  size: number,
  radiusKm: number
): { row: number; col: number; lat: number; lng: number }[] {
  const points: { row: number; col: number; lat: number; lng: number }[] = [];
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
