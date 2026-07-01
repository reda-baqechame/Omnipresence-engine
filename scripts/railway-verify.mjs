#!/usr/bin/env node
/**
 * Railway multi-service deployment verifier.
 *
 * Checks the full self-hosted stack is wired correctly:
 *   - app service           (/api/health)
 *   - omnidata API service  (/health)  [optional but recommended]
 *
 * Usage:
 *   node scripts/railway-verify.mjs [appUrl] [omnidataUrl]
 *   RAILWAY_APP_URL=... OMNIDATA_PUBLIC_URL=... node scripts/railway-verify.mjs
 *
 * Exit code is non-zero if a required service is unhealthy or production is not ready.
 */

const appUrl = (process.argv[2] || process.env.RAILWAY_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "")
  .replace(/\/$/, "");
const omnidataUrl = (process.argv[3] || process.env.OMNIDATA_PUBLIC_URL || process.env.OMNIDATA_BASE_URL || "")
  .replace(/\/$/, "");
const aiCaptureUrl = (process.env.AI_UI_CAPTURE_URL || "").replace(/\/$/, "");

let failures = 0;
const ok = (m) => console.log(`  \u2713 ${m}`);
const warn = (m) => console.log(`  \u25cb ${m}`);
const bad = (m) => { console.log(`  \u2717 ${m}`); failures++; };

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), ...opts });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { ok: res.ok, status: res.status, json };
}

if (!appUrl) {
  console.error("\nNo app URL. Pass it as the first arg or set RAILWAY_APP_URL.\n");
  process.exit(1);
}

console.log(`\nRailway stack verification`);
console.log(`  app:      ${appUrl}`);
console.log(`  omnidata: ${omnidataUrl || "(not provided)"}`);
console.log(`  ai-capture: ${aiCaptureUrl || "(not provided)"}\n`);

// 1) App service health
console.log("App service");
try {
  const { ok: healthy, status, json } = await fetchJson(`${appUrl}/api/health`);
  if (!healthy || !json) {
    bad(`/api/health returned ${status}`);
  } else {
    ok(`/api/health ${status} (version ${json.version || "?"})`);
    const prod = json.production;
    if (prod) {
      if (prod.ready) ok(`production ready (score ${prod.score ?? 0}%)`);
      else bad(`production NOT ready (score ${prod.score ?? 0}%)`);
      for (const id of prod.blockers || []) {
        const c = (prod.checks || []).find((x) => x.id === id);
        bad(`blocker: ${c?.label || id} — ${c?.message || ""}`);
      }
    }
    if (json.checks?.omnidata) {
      const s = json.checks.omnidata;
      if (s === "ok") ok(`app sees OmniData: ${s}`);
      else if (s === "error") bad(`app↔OmniData: ${s} (check OMNIDATA_API_KEY/SIGNING_SECRET)`);
      else warn(`app↔OmniData: ${s}`);
    }
  }
} catch (e) {
  bad(`app health failed: ${e instanceof Error ? e.message : e}`);
}

// 2) OmniData service health (public, no auth required)
if (omnidataUrl && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(omnidataUrl)) {
  console.log("\nOmniData service");
  try {
    const { ok: healthy, status, json } = await fetchJson(`${omnidataUrl}/health`);
    if (healthy && json?.ok) ok(`/health ${status} (${json.service} ${json.version || ""})`);
    else bad(`/health returned ${status}`);

    // A protected endpoint should reject an unauthenticated request — proves auth is on.
    const probe = await fetchJson(`${omnidataUrl}/v3/serp/google/organic/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[]",
    });
    if (probe.status === 401) ok("auth enforced (unauthenticated request rejected 401)");
    else warn(`expected 401 on unauthenticated probe, got ${probe.status} — verify auth/keys`);
  } catch (e) {
    bad(`omnidata health failed: ${e instanceof Error ? e.message : e}`);
  }
} else if (omnidataUrl) {
  console.log("\nOmniData service");
  warn("OMNIDATA URL is localhost — skipping remote probe (set OMNIDATA_PUBLIC_URL for a real check)");
}

// 3) AI UI Capture service health
if (aiCaptureUrl && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(aiCaptureUrl)) {
  console.log("\nAI UI Capture service");
  try {
    const { ok: healthy, status, json } = await fetchJson(`${aiCaptureUrl}/health`);
    if (healthy && json?.ok) ok(`/health ${status} (${json.service})`);
    else bad(`/health returned ${status}`);
    if (json?.surfaceHealth) ok(`surface health stats present`);
  } catch (e) {
    bad(`ai-ui-capture health failed: ${e instanceof Error ? e.message : e}`);
  }
} else if (aiCaptureUrl) {
  console.log("\nAI UI Capture service");
  warn("AI_UI_CAPTURE_URL is localhost — skipping remote probe");
}

console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) failed. Fix the above before serving paying users.\n`);
  process.exit(1);
}
console.log("All Railway stack checks passed.\n");
process.exit(0);
