#!/usr/bin/env node
/**
 * Lightweight e2e happy-path checks (no auth — structural only).
 * Full signup→scan flow requires seeded credentials.
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const required = [
  "src/lib/providers/dataforseo.ts",
  "services/omnidata/src/index.ts",
  "src/lib/engines/guarantee.ts",
  "src/app/app/projects/[id]/guarantee/page.tsx",
  "supabase/migrations/0011_guarantee.sql",
  ".cursor/skills/omnipresence-loop/SKILL.md",
  "supabase/migrations/0016_phase8.sql",
  "src/app/api/on-page/route.ts",
  "src/components/link-building-panel.tsx",
];

let missing = 0;
for (const file of required) {
  const path = join(root, file);
  if (existsSync(path)) {
    console.log(`✓ ${file}`);
  } else {
    console.log(`✗ missing ${file}`);
    missing++;
  }
}

const omnidataTest = spawnSync("npm", ["test"], {
  cwd: join(root, "services", "omnidata"),
  shell: true,
  stdio: "inherit",
});

if (omnidataTest.status !== 0) missing++;

console.log(missing === 0 ? "\nE2E structure checks passed.\n" : `\n${missing} check(s) failed.\n`);
process.exit(missing > 0 ? 1 : 0);
