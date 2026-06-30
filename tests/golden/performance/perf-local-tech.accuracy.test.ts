import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { haversineKm, buildGrid } from "../../../src/lib/engines/geo-math.ts";
import { detectFromResponse } from "../../../src/lib/engines/tech-stack-fingerprint.ts";
import { requireService } from "../_lib/env.ts";
import { withinTolerance } from "../_lib/score.ts";

/**
 * Accuracy audit for the sovereign performance/local/tech replacements:
 *  - geo-math.ts (keyless Local Falcon map-grid proximity)
 *  - tech-stack-fingerprint.ts (keyless BuiltWith/Wappalyzer-lite)
 *  - live PageSpeed/CrUX + OSM geocode (keyless, network-gated)
 * Geo + tech run offline (fail CI on regression); geocode/PageSpeed self-skip
 * unless GOLDEN_ALLOW_NETWORK=true.
 */

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "perf-local-tech.golden.json"), "utf8")) as {
  distances: Array<{ a: string; aLat: number; aLng: number; b: string; bLat: number; bLng: number; km: number; tolerance: number }>;
  geocodes: Array<{ query: string; lat: number; lng: number; tolerance: number }>;
  techCases: Array<{ name: string; html: string; headers: Record<string, string>; expect: string[]; forbid: string[] }>;
  pageSpeed: Array<{ url: string; maxLcpMs: number; minPerformanceScore: number }>;
};

test("geo: haversine distances match known great-circle km within tolerance", () => {
  for (const d of golden.distances) {
    const km = haversineKm(d.aLat, d.aLng, d.bLat, d.bLng);
    assert.ok(
      withinTolerance(km, d.km, d.tolerance),
      `${d.a}→${d.b}: ${km.toFixed(0)}km not within ${(d.tolerance * 100).toFixed(0)}% of ${d.km}km`
    );
  }
});

test("geo: map-grid is centered and proximity ranking is correct", () => {
  const size = 5;
  const center = { lat: 40.0, lng: -74.0 };
  const grid = buildGrid(center.lat, center.lng, size, 5);
  assert.equal(grid.length, size * size);
  const mid = grid.find((p) => p.row === 2 && p.col === 2)!;
  assert.ok(withinTolerance(mid.lat, center.lat, 0.0001) && withinTolerance(mid.lng, center.lng, 0.0001));
  // A point nearer the center cell must rank closer than a far corner.
  const near = haversineKm(mid.lat, mid.lng, center.lat, center.lng);
  const corner = grid.find((p) => p.row === 0 && p.col === 0)!;
  const far = haversineKm(corner.lat, corner.lng, center.lat, center.lng);
  assert.ok(near < far, "center cell must be closer to center than a corner cell");
});

test("tech-stack: detects known stacks with zero false positives", () => {
  for (const c of golden.techCases) {
    const result = detectFromResponse(`https://example/${c.name}`, c.html, c.headers);
    const names = result.technologies.map((t) => t.name);
    for (const want of c.expect) {
      assert.ok(names.includes(want), `${c.name}: expected to detect ${want}, got [${names.join(", ")}]`);
    }
    for (const bad of c.forbid) {
      assert.ok(!names.includes(bad), `${c.name}: FALSE POSITIVE — detected ${bad} which is not present`);
    }
    if (c.expect.length === 0) assert.equal(result.available, false, `${c.name}: plain page must report unavailable`);
  }
});

test("local: OSM geocode resolves known landmarks to correct coordinates", async (t) => {
  const svc = requireService("osm");
  if (!svc.ok) {
    t.skip(`OSM geocode not exercised — ${svc.reason}`);
    return;
  }
  const UA = "OmniPresence-GoldenAudit/1.0 (accuracy test)";
  let audited = 0;
  for (const g of golden.geocodes) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(g.query)}&format=jsonv2&limit=1`;
    let data: Array<{ lat?: string; lon?: string }> = [];
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } });
      if (!res.ok) continue;
      data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    } catch {
      continue;
    }
    const hit = data[0];
    if (!hit) continue;
    audited += 1;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    // Compare by absolute distance (km) to the known point — robust to tolerance units.
    const offKm = haversineKm(lat, lng, g.lat, g.lng);
    assert.ok(offKm < 2, `${g.query}: geocode ${offKm.toFixed(2)}km from known point (${lat},${lng})`);
    // Respect Nominatim's 1 req/s policy.
    await new Promise((r) => setTimeout(r, 1100));
  }
  if (audited === 0) t.skip("Nominatim returned no usable results (rate-limited or offline)");
});

test("performance: live PageSpeed CWV for a fast reference site is within range", async (t) => {
  const svc = requireService("pagespeed");
  if (!svc.ok) {
    t.skip(`PageSpeed not exercised — ${svc.reason}`);
    return;
  }
  let audited = 0;
  for (const p of golden.pageSpeed) {
    const key = process.env.PAGESPEED_API_KEY;
    const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(p.url)}&strategy=mobile${key ? `&key=${key}` : ""}`;
    let json: {
      lighthouseResult?: { categories?: { performance?: { score?: number } }; audits?: Record<string, { numericValue?: number }> };
    };
    try {
      const res = await fetch(api);
      if (!res.ok) continue;
      json = await res.json();
    } catch {
      continue;
    }
    const score = (json.lighthouseResult?.categories?.performance?.score ?? 0) * 100;
    const lcp = json.lighthouseResult?.audits?.["largest-contentful-paint"]?.numericValue ?? Infinity;
    if (score === 0 && lcp === Infinity) continue;
    audited += 1;
    assert.ok(score >= p.minPerformanceScore, `${p.url}: perf ${score} < ${p.minPerformanceScore}`);
    assert.ok(lcp <= p.maxLcpMs, `${p.url}: LCP ${lcp}ms > ${p.maxLcpMs}ms`);
  }
  if (audited === 0) t.skip("PageSpeed returned no usable result (quota or offline)");
});
