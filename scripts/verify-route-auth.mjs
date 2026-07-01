#!/usr/bin/env node
// Durable IDOR / broken-access-control guard.
//
// Any API route that uses the Supabase SERVICE client bypasses Row-Level
// Security, so it MUST enforce tenant ownership itself. This script fails CI if
// a service-client route is not protected by one of the recognized access
// markers and is not on the documented allowlist of intentionally-public routes.
// It stops a future change from quietly shipping a route that reads/writes any
// tenant's data with the service role and no ownership check.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const apiDir = path.join(root, "src/app/api");

// Markers that prove a service-client route enforces access control itself.
const PROTECTION_MARKERS = [
  "verifyProjectAccess",   // session user owns the project
  "authenticateApiKey",    // public API key scoped to an org (+ org filter)
  "guardPublicEndpoint",   // public beacon: rate-limited + existence-checked
  "constructEvent",        // Stripe webhook: cryptographic signature check
  "stripe-signature",
];

// Intentionally public / specially-authed routes that legitimately use the
// service client without a project-ownership check. Keyed by path suffix, with
// the reason it is safe — keep this list short and justified.
const ALLOWLIST = {
  "api/health/route.ts": "health check — exposes no tenant data",
  "api/oauth/callback/route.ts": "OAuth flow validated via signed state param",
  "api/auth/setup-org/route.ts": "creates an org for the authenticated session user",
  "api/report/[token]/pdf/route.ts": "access gated by an unguessable report token",
  "api/public/audit/route.ts": "intentionally public anonymous audit (no tenant data read)",
  "api/traffic-panel/ingest/route.ts": "opt-in pixel ingest gated by TRAFFIC_PANEL_INGEST_SECRET header",
};

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === "route.ts" || entry.name === "route.tsx") out.push(full);
  }
  return out;
}

const routes = walk(apiDir);
const serviceRoutes = [];
const violations = [];

for (const file of routes) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("createServiceClient")) continue;
  serviceRoutes.push(file);

  const rel = path.relative(root, file).replace(/\\/g, "/");
  const allowKey = Object.keys(ALLOWLIST).find((k) => rel.endsWith(k));
  if (allowKey) continue;

  const hasMarker = PROTECTION_MARKERS.some((m) => text.includes(m));
  if (!hasMarker) violations.push(rel);
}

console.log(`API routes scanned: ${routes.length}`);
console.log(`Service-client (RLS-bypassing) routes: ${serviceRoutes.length}`);
console.log(`Allowlisted public/special routes: ${Object.keys(ALLOWLIST).length}`);

if (violations.length === 0) {
  console.log("\nOK: every service-client route enforces access control or is allowlisted.");
  process.exit(0);
}

console.log(`\nBROKEN ACCESS CONTROL (${violations.length}) — service-client route with no ownership check:`);
for (const v of violations) {
  console.log(`  - ${v}`);
}
console.log(
  "\nFix: add verifyProjectAccess / authenticateApiKey (+ organization_id scoping) /" +
    " guardPublicEndpoint, or add it to ALLOWLIST in scripts/verify-route-auth.mjs with a reason."
);
process.exit(1);
