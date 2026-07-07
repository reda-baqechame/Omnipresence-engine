#!/usr/bin/env node
/**
 * Ensures every API mutation route (POST/PATCH/PUT) calls validateBody unless
 * explicitly allowlisted (non-JSON body, empty body, or Stripe signature verify).
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_ROOT = join(root, "src/app/api");

/** Relative paths from repo root — exempt from validateBody requirement. */
const ALLOWLIST = new Set([
  "src/app/api/webhooks/stripe/route.ts", // constructEvent on raw body
  "src/app/api/auth/signout/route.ts", // redirect-only, no JSON body
  "src/app/api/projects/[id]/scan/route.ts", // project id from URL, no body
]);

const MUTATION_HANDLER = /export\s+async\s+function\s+(POST|PATCH|PUT)\s*\(/;

function walkRouteFiles(dir, acc = []) {
  for (const ent of readdirSync(dir)) {
    const full = join(dir, ent);
    if (statSync(full).isDirectory()) {
      walkRouteFiles(full, acc);
    } else if (ent === "route.ts") {
      acc.push(relative(root, full).replace(/\\/g, "/"));
    }
  }
  return acc;
}

const errors = [];
const routes = walkRouteFiles(API_ROOT);
let mutationCount = 0;

for (const file of routes) {
  const src = readFileSync(join(root, file), "utf8");
  if (!MUTATION_HANDLER.test(src)) continue;
  mutationCount++;

  if (ALLOWLIST.has(file)) continue;

  if (!src.includes("validateBody") && !/\w+Schema\.safeParse\s*\(/.test(src)) {
    errors.push(`${file}: mutation handler(s) missing validateBody or Schema.safeParse`);
  }
}

const schemaSrc = readFileSync(join(root, "src/lib/validation/schemas.ts"), "utf8");
const schemaCount = (schemaSrc.match(/export const \w+Schema/g) || []).length;

console.log(
  `verify:zod-coverage — ${mutationCount} mutation routes, ${schemaCount} schemas, ${errors.length} issue(s)`
);
if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("verify:zod-coverage — OK");
process.exit(0);
