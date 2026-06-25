#!/usr/bin/env node
/**
 * Full verification gate for OmniPresence Super Engine build loop.
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, cwd = root) {
  const r = spawnSync(cmd, args, { cwd, shell: true, stdio: "inherit", encoding: "utf8" });
  return r.status === 0;
}

const steps = [
  { name: "typecheck", ok: () => run("npm", ["run", "typecheck"]) },
  { name: "lint", ok: () => run("npm", ["run", "lint"]) },
  { name: "build", ok: () => run("npm", ["run", "build"]) },
];

const omnidataPkg = join(root, "services", "omnidata", "package.json");
if (existsSync(omnidataPkg)) {
  steps.push({
    name: "omnidata-typecheck",
    ok: () => run("npm", ["run", "typecheck"], join(root, "services", "omnidata")),
  });
  steps.push({
    name: "omnidata-parity",
    ok: () => run("npm", ["run", "parity"], join(root, "services", "omnidata")),
  });
}

let failed = 0;
console.log("\n=== OmniPresence verify:all ===\n");
for (const step of steps) {
  process.stdout.write(`${step.name}... `);
  if (step.ok()) {
    console.log("OK");
  } else {
    console.log("FAIL");
    failed++;
  }
}

console.log(failed === 0 ? "\nAll gates passed.\n" : `\n${failed} gate(s) failed.\n`);
process.exit(failed > 0 ? 1 : 0);
