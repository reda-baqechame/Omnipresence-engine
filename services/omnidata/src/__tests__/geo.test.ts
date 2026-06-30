import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { haversineKm, buildLocalGrid, geocodeNominatim } from "../engines/geo.js";

/**
 * Sovereign local-geo accuracy for the OmniData maps engine. The pure grid +
 * great-circle math (the keyless Local Falcon replacement) is audited offline so
 * a regression fails CI; the live OSM/Nominatim geocode self-skips unless network
 * is explicitly allowed (GOLDEN_ALLOW_NETWORK=true), honoring the 1 req/s policy.
 */

const NETWORK_OK = process.env.GOLDEN_ALLOW_NETWORK === "true";

describe("geo math (offline)", () => {
  it("haversine matches known great-circle distances within 1%", () => {
    // NYC (40.7128,-74.0060) → LA (34.0522,-118.2437) ≈ 3936 km.
    const nycLa = haversineKm(40.7128, -74.006, 34.0522, -118.2437);
    assert.ok(Math.abs(nycLa - 3936) / 3936 < 0.01, `NYC→LA ${nycLa.toFixed(0)}km not ≈3936`);
    // London (51.5074,-0.1278) → Paris (48.8566,2.3522) ≈ 343 km.
    const lonParis = haversineKm(51.5074, -0.1278, 48.8566, 2.3522);
    assert.ok(Math.abs(lonParis - 343) / 343 < 0.02, `London→Paris ${lonParis.toFixed(0)}km not ≈343`);
    // Identical points → 0.
    assert.equal(haversineKm(10, 10, 10, 10), 0);
  });

  it("local grid is centered, square-sized, and proximity-correct", () => {
    const size = 5;
    const center = { lat: 40.0, lng: -74.0 };
    const grid = buildLocalGrid(center.lat, center.lng, size, 10);
    assert.equal(grid.length, size * size);
    const mid = grid.find((p) => p.row === 2 && p.col === 2)!;
    assert.ok(Math.abs(mid.lat - center.lat) < 1e-9 && Math.abs(mid.lng - center.lng) < 1e-9);
    // Center cell is strictly closer to the center than any corner.
    const corner = grid.find((p) => p.row === 0 && p.col === 0)!;
    const near = haversineKm(mid.lat, mid.lng, center.lat, center.lng);
    const far = haversineKm(corner.lat, corner.lng, center.lat, center.lng);
    assert.ok(near < far, "center must be closer than a corner");
  });

  it("grid spacing scales with the requested radius (monotonic footprint)", () => {
    const small = buildLocalGrid(40, -74, 5, 5);
    const big = buildLocalGrid(40, -74, 5, 20);
    const smallSpan = haversineKm(small[0].lat, small[0].lng, small[24].lat, small[24].lng);
    const bigSpan = haversineKm(big[0].lat, big[0].lng, big[24].lat, big[24].lng);
    assert.ok(bigSpan > smallSpan, `bigger radius → wider footprint (${bigSpan} > ${smallSpan})`);
  });
});

describe("OSM Nominatim geocode (network-gated)", () => {
  it("resolves a known landmark to correct coordinates", async (t) => {
    if (!NETWORK_OK) {
      t.skip("GOLDEN_ALLOW_NETWORK!=true — OSM geocode not exercised");
      return;
    }
    const geo = await geocodeNominatim("Eiffel Tower, Paris, France");
    assert.ok(geo, "geocode returned a point");
    // Eiffel Tower ≈ 48.8584, 2.2945.
    const offKm = haversineKm(geo!.lat, geo!.lng, 48.8584, 2.2945);
    assert.ok(offKm < 2, `geocode ${offKm.toFixed(2)}km from known point`);
  });

  it("returns null for an empty query without throwing", async () => {
    assert.equal(await geocodeNominatim(""), null);
    assert.equal(await geocodeNominatim("   "), null);
  });
});
