/**
 * Combines all Supabase migrations into a single SQL file for one-shot apply.
 * Usage: node scripts/combine-migrations.mjs
 * Output: supabase/migrations/combined.sql
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const files = readdirSync(root)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

let combined = `-- PresenceOS combined migration (${files.length} files)\n-- Generated ${new Date().toISOString()}\n\n`;

for (const file of files) {
  combined += `-- ========== ${file} ==========\n\n`;
  combined += readFileSync(join(root, file), "utf8");
  combined += "\n\n";
}

const out = join(root, "combined.sql");
writeFileSync(out, combined);
console.log(`Wrote ${out} (${files.length} migrations)`);
