#!/usr/bin/env node
/**
 * Accuracy gate: runs the golden-dataset audits that measure sovereign provider
 * output against known-true values (tests/golden). Individual tests self-skip
 * (with a printed reason) when their live service isn't configured, so this gate
 * is green locally/offline yet fails hard wherever a sovereign service IS
 * configured but returns inaccurate data.
 *
 * Discovers tests/golden/_lib/__tests__/*.test.ts (scoring lib self-test) and
 * every tests/golden/**\/*.accuracy.test.ts, then runs them under node --test.
 */
import { spawnSync } from "child_process";
import { readdirSync, statSync, existsSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const goldenDir = join(root, "tests", "golden");

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (entry.endsWith(".accuracy.test.ts") || entry.endsWith("score.test.ts")) acc.push(full);
  }
  return acc;
}

// Use repo-relative POSIX-style paths: the absolute repo path contains a space
// ("Omnipresence Engine"), and with shell:true unquoted absolute paths would be
// split by node --test. The relative portion has no spaces.
const files = walk(goldenDir).map((f) => relative(root, f).split("\\").join("/"));

// Production/CI mode: an empty golden suite is a HARD FAILURE — shipping with no
// accuracy proof is exactly the gap this gate exists to catch. Locally we keep
// the skip-with-warning so an offline dev run stays green.
const REQUIRE_FILES =
  process.env.CI === "true" ||
  process.env.NODE_ENV === "production" ||
  process.env.VERIFY_REQUIRE_FILES === "1" ||
  process.argv.includes("--required");

if (files.length === 0) {
  if (REQUIRE_FILES) {
    console.error(
      "verify:accuracy — FAIL: zero golden audit files found (tests/golden/**/*.accuracy.test.ts) " +
        "in CI/production mode. Accuracy proof is mandatory before shipping."
    );
    process.exit(1);
  }
  console.log("verify:accuracy — no golden test files found yet (tests/golden). Nothing to run (local skip).");
  process.exit(0);
}

console.log(`\n=== verify:accuracy — ${files.length} golden audit file(s) ===\n`);
for (const f of files) console.log(`  • ${f}`);
console.log("");

const r = spawnSync(
  "node",
  [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--import",
    "./tests/_lib/register-loader.mjs",
    "--test",
    ...files,
  ],
  { cwd: root, shell: true, stdio: "inherit", encoding: "utf8" }
);

process.exit(r.status === 0 ? 0 : 1);
