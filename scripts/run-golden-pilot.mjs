#!/usr/bin/env node
/**
 * Golden-domain pilot runner — public audit + optional project scan poll.
 */
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.SMOKE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const domain = process.env.PILOT_DOMAIN || "example.com";

async function main() {
  const outDir = join(root, "docs", "pilots");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const res = await fetch(`${base}/api/public/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain, email: "pilot@presenceos.local" }),
  });
  const audit = res.ok ? await res.json() : { error: res.status };

  const pilot = {
    generatedAt: new Date().toISOString(),
    domain,
    base,
    projectId: process.env.PILOT_PROJECT_ID || null,
    audit,
    evidenceCount: 0,
    evidenceHashes: [],
  };

  writeFileSync(join(outDir, "latest-pilot.json"), JSON.stringify(pilot, null, 2));
  console.log(`Pilot written: docs/pilots/latest-pilot.json (${res.status})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
