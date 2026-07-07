#!/usr/bin/env node
/**
 * Verify OpenAI is configured for live AI visibility (env-only; never prints secrets).
 */
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const key = process.env.OPENAI_API_KEY || "";
const hasKey = key.length > 20 && !key.startsWith("your-");

if (!hasKey) {
  console.log("verify:openai — SKIP (OPENAI_API_KEY not set; wire on Vercel for live ChatGPT probes)");
  process.exit(0);
}

const r = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `import { activeAIEngines } from './src/lib/config/capabilities.ts';
     const engines = activeAIEngines();
     if (!engines.some((e) => /openai|chatgpt/i.test(e))) {
       console.error('verify:openai — FAIL: activeAIEngines does not include OpenAI');
       process.exit(1);
     }
     console.log('verify:openai — OK (engines: ' + engines.join(', ') + ')');`,
  ],
  { cwd: root, encoding: "utf8", env: process.env }
);

if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.status === 0 ? 0 : 1);
