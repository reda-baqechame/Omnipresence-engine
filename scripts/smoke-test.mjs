#!/usr/bin/env node
/**
 * Smoke test for PresenceOS — run after deploy or locally.
 * Usage: node scripts/smoke-test.mjs [baseUrl]
 * Default baseUrl: http://localhost:3000
 */

const base = process.argv[2] || process.env.SMOKE_BASE_URL || "http://localhost:3000";

const checks = [
  { name: "Health", path: "/api/health", method: "GET", expectStatus: [200, 503] },
  { name: "Homepage", path: "/", method: "GET", expectStatus: [200] },
  { name: "Public audit page", path: "/audit", method: "GET", expectStatus: [200] },
  { name: "Free tools", path: "/tools", method: "GET", expectStatus: [200] },
  { name: "Agencies page", path: "/agencies", method: "GET", expectStatus: [200] },
  {
    name: "Public audit API",
    path: "/api/public/audit",
    method: "POST",
    body: {
      domain: "example.com",
      email: "smoke-test@presenceos.app",
      brandName: "Example",
      industry: "SaaS",
    },
    expectStatus: [200],
  },
  {
    name: "Tools robots API",
    path: "/api/tools/robots",
    method: "POST",
    body: { domain: "example.com" },
    expectStatus: [200],
  },
];

let passed = 0;
let failed = 0;

for (const check of checks) {
  try {
    const res = await fetch(`${base}${check.path}`, {
      method: check.method,
      headers: check.body ? { "Content-Type": "application/json" } : undefined,
      body: check.body ? JSON.stringify(check.body) : undefined,
      signal: AbortSignal.timeout(120_000),
    });

    const ok = check.expectStatus.includes(res.status);
    if (ok) {
      console.log(`✓ ${check.name} (${res.status})`);
      passed++;
    } else {
      console.log(`✗ ${check.name} — expected ${check.expectStatus.join("|")}, got ${res.status}`);
      failed++;
    }
  } catch (error) {
    console.log(`✗ ${check.name} — ${error instanceof Error ? error.message : error}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
